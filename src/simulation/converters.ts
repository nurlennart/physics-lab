/**
 * Motor starters (star-delta, soft starter) and variable-frequency drives: discrete control state that
 * evolves with the coupled substeps. The electrical solver receives the resulting contactor modes,
 * soft-starter voltage ratio and drive frequency/voltage through ElectricalRuntime.
 */
import { prop, textProp, type Component } from "./model";
import { peakOverInterval, type ElectricalReading, type StarterMode } from "./electrical";

export interface StarterState {
  mode: StarterMode;
  /** Time in the present mode (s). */
  time: number;
  /** Soft starter: target fundamental voltage ratio (0–1) used for the next substep. */
  ratio: number;
  /** Soft starter: ramping down after a stop command. */
  stopping: boolean;
}
export interface DriveState {
  running: boolean;
  /** Output frequency (Hz) used for the next substep. */
  frequency: number;
  /** Output phase angle ∫2πf dt (rad): the reference of the output network's phasors. */
  angle: number;
  /** I²t image θ = (I/In)² filtered with τ; trips at θ ≥ 1. */
  thermal: number;
}
export const newStarter = (): StarterState => ({ mode: "off", time: 0, ratio: 1, stopping: false });
export const newDrive = (): DriveState => ({ running: false, frequency: 0, angle: 0, thermal: 0 });
const EPS = 1e-12;

/** V/f characteristic with boost: V_LL = V_r·(b + (1 − b)·f/f_base), constant above the base frequency. */
export function driveLineVoltage(c: Component, frequency: number) {
  const b = prop(c, "boost") / 100;
  return prop(c, "ratedVoltage") * Math.min(1, b + (1 - b) * frequency / prop(c, "baseFrequency", 50));
}
/** I²t time constant: from cold, the overload current (e.g. 150 %) trips after 60 s. */
export function driveThermalTau(c: Component) {
  const x2 = (prop(c, "overload", 150) / 100) ** 2;
  return 60 / Math.log(x2 / (x2 - 1));
}

/** Start/stop command edges, applied at the start of a substep. */
export function starterCommand(c: Component, st: StarterState, run: boolean): StarterState {
  if (run && st.mode === "off")
    return c.kind === "starDeltaStarter" ? { mode: "star", time: 0, ratio: 1, stopping: false } : { mode: "ramp", time: 0, ratio: prop(c, "initialVoltage") / 100, stopping: false };
  // Restart during a soft stop: continue the start ramp from the present voltage.
  if (run && st.stopping) {
    const u0 = prop(c, "initialVoltage") / 100;
    return { mode: "ramp", time: Math.max(0, (st.ratio - u0) / (1 - u0 || 1)) * prop(c, "rampTime"), ratio: st.ratio, stopping: false };
  }
  if (!run && st.mode !== "off" && !st.stopping) {
    if (c.kind === "softStarter" && st.mode === "bypass" && prop(c, "stopTime") > 0) return { mode: "ramp", time: 0, ratio: 1, stopping: true };
    return newStarter();
  }
  return st;
}
/** Time (s) until the next timed transition, so substeps end exactly on it. */
export function starterEvent(c: Component, st: StarterState) {
  if (st.mode === "star") return prop(c, "starTime") - st.time;
  if (st.mode === "open") return prop(c, "transitionTime") - st.time;
  if (st.mode === "ramp") {
    if (st.stopping) return prop(c, "stopTime") - st.time;
    const toFull = st.ratio < 1 ? prop(c, "rampTime") - st.time : Infinity;
    return Math.min(toFull > EPS ? toFull : Infinity, prop(c, "maxStartTime") - st.time);
  }
  return Infinity;
}
/** Timers and ramps after an accepted substep of length h; `reading` is that substep's solution. */
export function advanceStarter(c: Component, st: StarterState, h: number, reading?: ElectricalReading): { state: StarterState; trip?: string } {
  const time = st.time + h;
  if (st.mode === "star") return { state: time >= prop(c, "starTime") - EPS ? { ...st, mode: "open", time: 0 } : { ...st, time } };
  if (st.mode === "open") return { state: time >= prop(c, "transitionTime") - EPS ? { ...st, mode: "delta", time: 0 } : { ...st, time } };
  if (st.mode !== "ramp") return { state: { ...st, time } };
  const u0 = prop(c, "initialVoltage") / 100;
  if (st.stopping) {
    const ratio = 1 - (1 - u0) * time / prop(c, "stopTime");
    return { state: ratio <= u0 + EPS ? newStarter() : { ...st, time, ratio } };
  }
  // Bypass once the substep ran at full voltage without the current limit adding reactance.
  if (st.ratio >= 1 - EPS && (reading?.starter?.reactance ?? Infinity) <= 1e-9) return { state: { mode: "bypass", time: 0, ratio: 1, stopping: false } };
  if (time >= prop(c, "maxStartTime") - EPS)
    return { state: newStarter(), trip: `${c.name}: start not completed within ${prop(c, "maxStartTime")} s (the current limit held the motor voltage below 100 %) — starter tripped. Raise the current limit or reduce the load; reset to re-arm.` };
  return { state: { ...st, time, ratio: Math.min(1, u0 + (1 - u0) * time / prop(c, "rampTime")) } };
}

/** Run/stop edges at the start of a substep. The output needs an energised input (DC link charged). */
export function driveCommand(c: Component, d: DriveState, run: boolean, setpoint: number, energized: boolean): DriveState {
  if (!energized) return { ...d, running: false, frequency: 0 };
  if (run && !d.running && setpoint >= prop(c, "startFrequency")) return { ...d, running: true, frequency: prop(c, "startFrequency") };
  if (!run && d.running && textProp(c, "stopMode", "ramp") === "coast") return { ...d, running: false, frequency: 0 };
  return d;
}
/** Steady-state output current (A) of the connected motors at output frequency f, and the frequency of zero slip. */
export interface DriveLimiter { currentAt: (frequency: number) => number; rotorFrequency: number }
/**
 * After an accepted substep: I²t image, instantaneous overcurrent, output angle, and the frequency for
 * the next substep. Ramps follow accelTime/decelTime (0 ↔ base frequency). Current limit (stall
 * prevention while motoring, regenerative limit while braking) as an ideal fast current controller:
 * when the ramped frequency would draw more than the overload current at the motors' present speed,
 * the frequency moves towards zero slip until the steady-state current equals the limit.
 */
export function advanceDrive(c: Component, d: DriveState, h: number, reading: ElectricalReading | undefined, run: boolean, setpoint: number, limiter?: DriveLimiter): { state: DriveState; trip?: string } {
  const out = reading?.drive, rated = prop(c, "ratedOutputCurrent"), current = out?.running ? out.outputCurrent : 0;
  const x2 = (current / rated) ** 2, thermal = x2 + (d.thermal - x2) * Math.exp(-h / driveThermalTau(c));
  const angle = d.angle + (d.running ? 2 * Math.PI * d.frequency * h : 0);
  let trip: string | undefined;
  if (out?.running && peakOverInterval(out.outputCurrentPhasor, 3, d.angle, angle) >= prop(c, "overcurrentTrip") * Math.SQRT2 * rated)
    trip = `${c.name}: instantaneous output overcurrent (above ${prop(c, "overcurrentTrip")} × √2 × ${rated} A) — drive tripped. Check for a short circuit or a stalled motor; reset to re-arm.`;
  else if (thermal >= 1)
    trip = `${c.name}: I²t overload — output current above ${rated} A for too long (${prop(c, "overload")} % allowed for 60 s) — drive tripped. Reduce the load or use a larger drive; reset to re-arm.`;
  if (trip) return { state: { ...newDrive(), angle, thermal }, trip };
  if (!d.running) return { state: { ...d, angle, thermal } };
  const base = prop(c, "baseFrequency", 50), start = prop(c, "startFrequency");
  const target = run ? Math.max(0, Math.min(prop(c, "maxFrequency"), setpoint)) : 0;
  // Feedback on the measured current corrects the steady-state model during electromagnetic transients
  // (rotor-flux build-up at low frequency), as the drive's fast current loop would.
  const rating = prop(c, "overload", 150) / 100 * rated, limit = rating * Math.max(0.7, Math.min(1, current > 0 ? rating / current : 1));
  let f = d.frequency;
  if (f < target) f = Math.min(target, f + base / prop(c, "accelTime") * h);
  else if (f > target) f = Math.max(target, f - base / prop(c, "decelTime") * h);
  if (limiter && limiter.currentAt(f) > limit) {
    // Current grows with |f − f_rotor|; bisect towards zero slip (magnetising current only).
    let over = f, within = limiter.rotorFrequency;
    if (limiter.currentAt(within) > limit) f = within;
    else {
      for (let k = 0; k < 60 && Math.abs(over - within) > 1e-9; k++) {
        const mid = 0.5 * (over + within);
        if (limiter.currentAt(mid) > limit) over = mid; else within = mid;
      }
      f = within;
    }
  }
  if (!run && f <= start + EPS) return { state: { ...d, running: false, frequency: 0, angle, thermal } };
  return { state: { ...d, frequency: Math.max(start, f), angle, thermal } };
}
