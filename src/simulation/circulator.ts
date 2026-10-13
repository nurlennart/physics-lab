/**
 * Standalone electric circulator: a glandless (wet-rotor) centrifugal pump with an integrated electronically
 * commutated permanent-magnet motor and its own controller, as used for heating, solar and cooling circulation
 * (e.g. Grundfos ALPHA2, Wilo Yonos PICO). The hydraulic part is the shared centrifugal pump model
 * (`pumpCurve`); this module adds what the integrated electronics do:
 *
 * - control: constant speed, constant pressure (head held at the setpoint) or proportional pressure (head
 *   H_set·(1 + Q/Q_r)/2), sampled from the last accepted flow, within [minimum speed, rated speed];
 * - an input power limit P1 ≤ P1,max (the "max curve" of a datasheet bends down at high flow);
 * - a soft-start speed ramp; the rotor's ½·J·ω² is stored energy;
 * - electrical input P1 = P₀ + P_mech/η_m (standby electronics plus motor/drive losses), drawn from the network
 *   as a constant-power load; losses are cooled by the pumped water (wet rotor).
 */
import { prop, textProp, type Component } from './model';
import { pumpCurve } from './hydraulic';
import { GRAVITY as G, WATER_RHO as RHO } from './units';
import type { Readout } from './parameters';

export type CirculatorMode = 'proportionalPressure' | 'constantPressure' | 'constantSpeed';
export const circulatorModes: { value: CirculatorMode; label: string }[] = [
  { value: 'proportionalPressure', label: 'Proportional pressure (head falls to ½ at zero flow)' },
  { value: 'constantPressure', label: 'Constant pressure (head held at the setpoint)' },
  { value: 'constantSpeed', label: 'Constant curve (fixed speed)' },
];
/** Electronics restart once the supply has recovered to this multiple of the undervoltage lockout. */
export const RESTART_MARGIN = 1.05;
/** Runtime state of the integrated motor and electronics. */
export interface CirculatorState {
  /** Rotor speed at the end of the last accepted substep (rad/s). */
  omega: number;
  /** Electronics locked out after an undervoltage until the supply recovers. */
  lockedOut: boolean;
  /** Remaining restart delay of a lockout (s). */
  restartIn: number;
  /** Accumulated rotor rotation since reset (rad), for drawing. */
  angle: number;
}
/** One substep's operating plan: speeds at start, midpoint and end, and whether the electronics are supplied. */
export interface CirculatorPlan { powered: boolean; running: boolean; omega0: number; omega1: number; mid: number; target: number }

export const circulatorMode = (c: Component) => textProp(c, 'mode', 'proportionalPressure') as CirculatorMode;
const ratedSpeed = (c: Component) => prop(c, 'ratedSpeed');
export const minimumSpeed = (c: Component) => ratedSpeed(c) * Math.min(100, Math.max(0, prop(c, 'minSpeed'))) / 100;
/** Pressure rise across the pump expressed as head (m), without cavitation: what the controller regulates. */
export const circulatorHead = (c: Component, omega: number, q: number) => pumpCurve(c, omega, q).pressureRise / (RHO * G);
/** Electrical input P1 (W) for a mechanical power demand on the rotor (shaft power plus acceleration power). */
export const circulatorInput = (c: Component, mechanical: number) =>
  prop(c, 'standbyPower') + Math.max(0, mechanical) / Math.min(1, Math.max(0.01, prop(c, 'motorEfficiency') / 100));
/** Steady input power at speed ω and flow q (W). */
export const steadyInput = (c: Component, omega: number, q: number) => circulatorInput(c, pumpCurve(c, omega, Math.max(0, q)).shaftPower);
/** Head the controller aims for at flow q (m): the setpoint, or the proportional-pressure line through it. */
export function targetHead(c: Component, q: number) {
  const set = prop(c, 'headSetpoint');
  return circulatorMode(c) === 'proportionalPressure' ? set * (1 + Math.max(0, q) / prop(c, 'ratedFlow')) / 2 : set;
}
/**
 * Largest speed in [lo, hi] at which `f(ω) ≤ 0`, for f increasing in ω (bisection to 10⁻¹² relative).
 * Returns lo when f(lo) > 0 and hi when f(hi) ≤ 0.
 */
function increasingRoot(f: (omega: number) => number, lo: number, hi: number) {
  if (f(hi) <= 0) return hi;
  if (f(lo) > 0) return lo;
  for (let k = 0; k < 200 && hi - lo > 1e-12 * hi; k++) {
    const mid = (lo + hi) / 2;
    if (f(mid) <= 0) lo = mid; else hi = mid;
  }
  return lo;
}
/** Speed (rad/s) at which the pump delivers `head` at flow q, limited to [lo, hi]. */
export const speedForHead = (c: Component, q: number, head: number, lo = 0, hi = ratedSpeed(c)) =>
  increasingRoot(omega => circulatorHead(c, omega, q) - head, lo, hi);
/** Highest speed at which the steady input power stays within the electronic limit P1,max at flow q. */
export const powerLimitedSpeed = (c: Component, q: number, hi = ratedSpeed(c)) =>
  increasingRoot(omega => steadyInput(c, omega, q) - prop(c, 'ratedPower'), 0, hi);
/**
 * Controller speed target from the last accepted flow. `command` is a wired speed command in percent of the
 * rated (maximum) speed: it overrides the mode like an external PWM/0–10 V speed signal; null = internal mode.
 */
export function circulatorTarget(c: Component, q: number, command: number | null) {
  const max = ratedSpeed(c), min = Math.min(minimumSpeed(c), max), flow = Math.max(0, q);
  let target: number;
  if (command !== null) target = max * Math.min(100, command) / 100;
  else if (circulatorMode(c) === 'constantSpeed') target = max * Math.min(100, Math.max(0, prop(c, 'speedSetting'))) / 100;
  else target = speedForHead(c, flow, targetHead(c, flow), 0, max);
  target = Math.max(min, Math.min(max, target));
  // The electronic power limit has priority over the minimum speed only above it (a stalled limit is not useful).
  return Math.max(Math.min(min, target), Math.min(target, powerLimitedSpeed(c, flow, target)));
}
/** Speed after a substep of length h on the soft-start ramp (rated speed in `rampTime`). */
export function rampedSpeed(c: Component, omega: number, target: number, h: number) {
  const rate = ratedSpeed(c) / Math.max(1e-3, prop(c, 'rampTime'));
  return omega + Math.max(-rate * h, Math.min(rate * h, target - omega));
}
export const circulatorKinetic = (c: Component, omega: number) => 0.5 * prop(c, 'inertia') * omega * omega;

/**
 * Energy efficiency index after Commission Regulation (EC) No 641/2009, Annex II (as amended by (EU) No 622/2012):
 * Q100 %/H100 % where Q·H is largest on the maximum curve (rated speed, power-limited); the reference control
 * curve runs from (Q100 %, H100 %) to (0, H100 %/2); P_L at 100/75/50/25 % flow (time shares 6/15/35/44 %) is the
 * input power on that curve, scaled by H_ref/H when the pump cannot reach it; P_ref = 1.7·P_hyd + 17·(1 − e^(−0.3·P_hyd));
 * EEI = P_L,avg/P_ref · C20 % with C20 % = 0.49. Evaluated on this model's steady operating points.
 */
export function energyEfficiencyIndex(c: Component) {
  const max = ratedSpeed(c), maxCurve = (q: number) => circulatorHead(c, Math.min(max, powerLimitedSpeed(c, q)), q);
  let q100 = 0, h100 = 0;
  // Zero head of the quadratic curve lies at √2·Q_r; data-point curves are searched to three times the rated flow.
  const end = 3 * prop(c, 'ratedFlow'), n = 3000;
  for (let i = 1; i <= n; i++) {
    const q = end * i / n, h = maxCurve(q);
    if (h > 0 && q * h > q100 * h100) { q100 = q; h100 = h; }
  }
  if (!(q100 > 0)) return null;
  const hydraulic = RHO * G * q100 * h100;
  const loads = [1, 0.75, 0.5, 0.25].map(x => {
    const q = x * q100, href = h100 * (1 + x) / 2;
    const omega = Math.max(Math.min(minimumSpeed(c), max), Math.min(speedForHead(c, q, href, 0, max), powerLimitedSpeed(c, q)));
    const head = circulatorHead(c, omega, q), input = steadyInput(c, omega, q);
    return { flow: q, head, input, weighted: head < href ? input * href / Math.max(1e-12, head) : input };
  });
  const average = 0.06 * loads[0].weighted + 0.15 * loads[1].weighted + 0.35 * loads[2].weighted + 0.44 * loads[3].weighted;
  const reference = 1.7 * hydraulic + 17 * (1 - Math.exp(-0.3 * hydraulic));
  return { q100, h100, hydraulic, loads, average, reference, eei: average / reference * 0.49 };
}
/** Calculated figures for the Inspector, from the same functions as live operation. */
export function circulatorRatingReadouts(c: Component): Readout[] {
  const eei = energyEfficiencyIndex(c), max = ratedSpeed(c);
  const rows: Readout[] = [
    { label: "Maximum speed", value: max * 30 / Math.PI, unit: "RPM" },
    { label: "Shutoff head at maximum speed", value: circulatorHead(c, max, 0), unit: "m" },
    { label: "Standstill input power (electronics)", value: prop(c, 'standbyPower'), unit: "W" },
  ];
  if (!eei) return rows;
  return [...rows,
    { label: "Best point on the maximum curve: flow", value: eei.q100 * 60000, unit: "L/min", note: "largest Q·H" },
    { label: "Best point on the maximum curve: head", value: eei.h100, unit: "m" },
    { label: "Input power P1 at the best point", value: eei.loads[0].input, unit: "W" },
    // An instantaneous efficiency at one operating point; it is not what the EEI measures.
    { label: "Wire-to-water efficiency at the best point", value: eei.hydraulic / eei.loads[0].input * 100, unit: "%", note: "ρ·g·Q·H / P1 at this point only" },
    { label: "Weighted average input P_L,avg", value: eei.average, unit: "W", note: "load profile 100/75/50/25 % flow for 6/15/35/44 % of the time" },
    { label: "Reference power P_ref", value: eei.reference, unit: "W", note: "1.7·P_hyd + 17·(1 − e^(−0.3·P_hyd))" },
    { label: "Energy efficiency index (EEI), model", value: eei.eei, unit: "1", note: "P_L,avg/P_ref · 0.49: a profile-weighted index against a reference pump, not an efficiency; calculated from this model's curves. EU limit 0.23" },
  ];
}

/**
 * Where each part of a circulator's behaviour comes from. The catalog models are fitted to the published data
 * listed here; the curve shape and the control logic are approximations and are labelled as such.
 */
export type BasisKind = 'manufacturer' | 'curve' | 'control' | 'assumed';
export const basisLabels: Record<BasisKind, string> = {
  manufacturer: 'Manufacturer data (datasheet)',
  curve: 'Pump curve',
  control: 'Control logic (approximated)',
  assumed: 'Model assumptions (not from a datasheet)',
};
/** Published data each catalog model was fitted to (the configuration may since have been edited). */
export const circulatorReferences: Record<string, { source: string; data: string }> = {
  standard: {
    source: 'Grundfos ALPHA2/ALPHA3 data booklet, ALPHAx 25-60 (50 Hz)',
    data: 'Hmax 6 m at zero flow; Q axis to 3 m³/h; P1 3–34 W, I1 0.04–0.32 A; 1 × 230 V ± 10 %, 50/60 Hz; 4-pole synchronous permanent-magnet motor, canned (wet) rotor; specific EEI 0.17; PP1–3, CP1–3 and speeds I–III. Curves at 60 °C.',
  },
  dc12: {
    source: 'Typical 12 V brushless solar/cooling circulators (retail listings, e.g. AW500S class; no manufacturer curve)',
    data: 'About 5 m maximum head, 800 L/h maximum flow, 19 W at 12 V DC; liquid to 60 °C. Listings disagree; treat as indicative.',
  },
};
export function circulatorModelBasis(c: Component): { kind: BasisKind; text: string }[] {
  const reference = circulatorReferences[c.variant ?? 'standard'];
  const points = typeof c.props.curvePoints === 'string' && c.props.curvePoints.trim() !== '';
  return [
    { kind: 'manufacturer', text: reference ? `Fitted to ${reference.source}: ${reference.data}` : 'None: a custom configuration.' },
    { kind: 'curve', text: points
      ? 'Measured flow:head points at maximum speed, interpolated piecewise linearly and scaled to other speeds by the affinity laws (H ∝ ω², Q ∝ ω).'
      : 'Quadratic approximation H = H₀·[(ω/ω_max)² − ½·(Q/Q_r)²] through the shutoff head and rated flow, scaled by the affinity laws; not a measured curve. The maximum curve additionally bends down where the input power limit P1,max applies.' },
    { kind: 'control', text: 'The controller recomputes its speed target from the last solved flow (one substep of delay) and follows it on the soft-start ramp. Proportional pressure follows the straight line H_set·(1 + Q/Q_r)/2; real pumps estimate head from speed and power and use proprietary curve families (PP1–3, AUTOADAPT), which are not reproduced.' },
    { kind: 'assumed', text: 'Rated speed, hydraulic efficiency, motor and electronics efficiency (constant), standby power, rotor inertia, ramp time and undervoltage lockout are illustrative values chosen so that the maximum input power and EEI match the reference; they are not published data.' },
  ];
}
