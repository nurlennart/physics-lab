/** Star-delta starter, soft starter and variable-frequency drive on the 7.5 kW induction motor. */
import { describe, it, expect } from "vitest";
import { Builder } from "./scaling-validation";
import { Simulation, DT } from "./engine";
import { driveLineVoltage, driveThermalTau } from "./converters";
import { inductionCircuit } from "./electrical";
import type { Component, Project, Property } from "./model";

const rpm = (s: Simulation, m: Component) => s.multiphysics.motors[m.id].omega * 30 / Math.PI;
const run = (s: Simulation, seconds: number, each?: () => void) => {
  for (let i = 0; i < Math.round(seconds / DT); i++) { expect(s.step(), s.error ?? "").toBe(true); each?.(); }
};
const setProp = (s: Simulation, id: string, key: string, value: Property) =>
  s.refresh({ ...s.project, components: s.project.components.map((c) => c.id === id ? { ...c, props: { ...c.props, [key]: value } } : c) } as Project);
const closes = (s: Simulation, bound = 1e-6) => expect(Math.abs(s.energyResidual / s.suppliedEnergy)).toBeLessThan(bound);

function starterRig(kind: "starDeltaStarter" | "softStarter" | "dol", load: number, props: Record<string, Property> = {}, motorProps: Record<string, Property> = {}) {
  const b = new Builder(), src = b.add("source3", { lineVoltage: 400, maxCurrent: 63, maxPower: 1e7 });
  const motor = b.add("inductionMotor", { loadTorque: load, ...motorProps });
  if (kind === "dol") { b.series(src, motor); return { s: new Simulation(b.p), motor, src, starter: undefined }; }
  const starter = b.add(kind, props);
  b.series(src, starter, motor);
  return { s: new Simulation(b.p), motor, src, starter };
}
function driveRig(load: number, props: Record<string, Property> = {}, motorProps: Record<string, Property> = {}) {
  const b = new Builder(), src = b.add("source3", { lineVoltage: 400, maxCurrent: 63, maxPower: 1e7 });
  const vfd = b.add("vfd", props), motor = b.add("inductionMotor", { loadTorque: load, ...motorProps });
  b.wire(src, "a", vfd, "a"); b.wire(vfd, "b", src, "b"); b.wire(vfd, "oa", motor, "a"); b.wire(motor, "b", vfd, "ob");
  return { s: new Simulation(b.p), b, motor, src, vfd };
}

describe("star-delta starter", () => {
  it("star: line current and torque are one third of direct-on-line", () => {
    // 80 N·m holds the rotor in both cases (steady locked-rotor torque ≈ 54 N·m direct, 18 N·m in star).
    const star = starterRig("starDeltaStarter", 80, { starTime: 100 }), dol = starterRig("dol", 80);
    run(star.s, 4); run(dol.s, 4);
    const ratio = star.s.electrical.readings[star.src.id].current / dol.s.electrical.readings[dol.src.id].current;
    // Exactly 1/3 for a stiff supply; the supply's internal impedance drops less voltage at the lower star
    // current (torque ∝ V², so its ratio deviates twice as much).
    expect(ratio).toBeCloseTo(1 / 3, 3);
    expect(star.s.electrical.readings[star.motor.id].machine!.torque / dol.s.electrical.readings[dol.motor.id].machine!.torque).toBeCloseTo(1 / 3, 2);
    expect(rpm(star.s, star.motor)).toBe(0);
    closes(star.s);
  });
  it("star → open transition → delta at the set times; reconnection surge; final state equals direct-on-line", () => {
    const { s, motor, src, starter } = starterRig("starDeltaStarter", 10, { starTime: 2, transitionTime: 0.05 });
    const dol = starterRig("dol", 10);
    let starPeak = 0, surge = 0;
    run(s, 1.99, () => { starPeak = Math.max(starPeak, s.electrical.readings[src.id].peakCurrent ?? 0); });
    expect(s.multiphysics.starters[starter!.id].mode).toBe("star");
    expect(rpm(s, motor)).toBeGreaterThan(1450); // runs up in star: 10 N·m < star torque
    run(s, 0.02);
    expect(s.multiphysics.starters[starter!.id].mode).toBe("open");
    run(s, 0.03, () => expect(s.electrical.readings[src.id].current).toBe(0));
    run(s, 0.02);
    expect(s.multiphysics.starters[starter!.id].mode).toBe("delta");
    run(s, 0.2, () => { surge = Math.max(surge, s.electrical.readings[src.id].peakCurrent ?? 0); });
    run(s, 3);
    run(dol.s, 5.26);
    // Star first peak ≈ one third of the direct-on-line asymmetric peak (131 A); the reconnection with residual flux surges.
    expect(starPeak).toBeLessThan(50);
    expect(surge).toBeGreaterThan(2 * starPeak);
    expect(rpm(s, motor)).toBeCloseTo(rpm(dol.s, dol.motor), 2);
    closes(s, 1e-8);
  });
  it("a load above the star torque does not start in star (physical limit of the method)", () => {
    const { s, motor } = starterRig("starDeltaStarter", 20, { starTime: 3 });
    run(s, 2.9);
    expect(rpm(s, motor)).toBeLessThan(1);
  });
  it("requires a motor wired directly to its motor terminal", () => {
    const b = new Builder(), src = b.add("source3"), st = b.add("starDeltaStarter"), r = b.add("resistor", { resistance: 50, ratedPower: 1e6 });
    b.series(src, st, r);
    const s = new Simulation(b.p);
    s.step();
    expect(s.error).toMatch(/exactly one induction motor/);
  });
});

describe("soft starter", () => {
  it("holds the line current at the limit, draws reactive power while ramping, then bypasses at full voltage", () => {
    // 60 % initial voltage would draw ≈ 44 A locked; the 2.5 × 16 A = 40 A limit adds reactance.
    const { s, motor, src, starter } = starterRig("softStarter", 15, { initialVoltage: 60, rampTime: 4, currentLimit: 2.5, ratedCurrent: 16 });
    let worst = 0, lowestPf = 1;
    run(s, 0.1);
    run(s, 3.85, () => {
      const r = s.electrical.readings[src.id];
      worst = Math.max(worst, Math.abs(r.current));
      if (s.multiphysics.starters[starter!.id].mode === "ramp") lowestPf = Math.min(lowestPf, r.powerFactor ?? 1);
      // The thyristors are lossless for the fundamental: real power is only the path resistance's I²R
      // (≤ 3·R·I_lim²), while the controlled reactance absorbs reactive power.
      const sr = s.electrical.readings[starter!.id];
      expect(sr.power).toBeLessThan(3 * sr.resistance! * (40 * 1.03) ** 2);
      if (s.multiphysics.starters[starter!.id].mode === "ramp" && sr.starter!.reactance > 0.1) expect(sr.reactivePower!).toBeGreaterThan(50 * sr.power);
    });
    expect(worst).toBeLessThan(40 * 1.03);
    expect(worst).toBeGreaterThan(40 * 0.97);
    expect(lowestPf).toBeLessThan(0.35);
    run(s, 0.3);
    expect(s.multiphysics.starters[starter!.id].mode).toBe("bypass");
    expect(s.electrical.readings[starter!.id].starter!.reactance).toBe(0);
    const dol = starterRig("dol", 15);
    run(dol.s, 3);
    run(s, 3);
    expect(rpm(s, motor)).toBeCloseTo(rpm(dol.s, dol.motor), 2);
    closes(s, 1e-8);
  });
  it("soft stop ramps the voltage down over the stop time, then opens", () => {
    const { s, motor, starter } = starterRig("softStarter", 10, { rampTime: 2, stopTime: 3 });
    run(s, 4);
    expect(s.multiphysics.starters[starter!.id].mode).toBe("bypass");
    setProp(s, starter!.id, "enabled", false);
    run(s, 1.5);
    const st = s.multiphysics.starters[starter!.id];
    expect(st.stopping).toBe(true);
    expect(st.ratio).toBeCloseTo(1 - 0.6 * 1.5 / 3, 6);
    // A start command during the soft stop continues the start ramp from the present voltage.
    setProp(s, starter!.id, "enabled", true);
    run(s, DT);
    const resumed = s.multiphysics.starters[starter!.id];
    expect(resumed.stopping).toBe(false);
    expect(resumed.ratio).toBeGreaterThan(st.ratio);
    expect(resumed.ratio).toBeLessThan(st.ratio + 0.01);
    setProp(s, starter!.id, "enabled", false);
    run(s, 4);
    expect(s.multiphysics.starters[starter!.id].mode).toBe("off");
    run(s, 0.1);
    expect(s.multiphysics.starters[starter!.id].mode).toBe("off");
    run(s, 2);
    expect(rpm(s, motor)).toBe(0);
    closes(s, 1e-8);
  });
  it("trips when the current limit prevents reaching full voltage within the maximum start time", () => {
    const { s, starter } = starterRig("softStarter", 45, { currentLimit: 1.5, maxStartTime: 5, rampTime: 2 });
    run(s, 5.1);
    expect(s.failed[starter!.id]).toBe(true);
    expect(s.tripped[starter!.id]).toMatch(/start not completed within 5 s/);
  });
});

describe("variable-frequency drive", () => {
  it("V/f operation at 25 Hz: output voltage, speed below 750 rpm, input power = output + losses at unity power factor", () => {
    const { s, motor, src, vfd } = driveRig(10, { frequencySetpoint: 25, accelTime: 2 });
    run(s, 5);
    const r = s.electrical.readings[vfd.id], d = r.drive!;
    expect(d.frequency).toBe(25);
    expect(d.outputVoltage).toBeCloseTo(driveLineVoltage(vfd, 25), 6);
    expect(driveLineVoltage(vfd, 25)).toBeCloseTo(400 * (0.03 + 0.97 * 0.5), 9);
    expect(rpm(s, motor)).toBeGreaterThan(700);
    expect(rpm(s, motor)).toBeLessThan(750);
    expect(d.inputPower).toBeCloseTo(d.outputPower + d.losses, 6);
    // Diode rectifier: line current in phase with the voltage, I = P / (3·V_phase).
    const line = s.electrical.readings[src.id];
    expect(line.powerFactor!).toBeGreaterThan(0.999999);
    expect(Math.abs(line.current)).toBeCloseTo(d.inputPower / (3 * 400 / Math.sqrt(3)), 4);
    // Output frequency sets the supply frequency the motor sees.
    expect(s.electrical.readings[motor.id].frequency).toBe(25);
    closes(s);
  });
  it("starts with line current near the running value instead of the direct-on-line surge", () => {
    const drive = driveRig(20, { accelTime: 3 }), dol = starterRig("dol", 20);
    let drivePeak = 0, dolPeak = 0;
    run(drive.s, 4, () => { drivePeak = Math.max(drivePeak, drive.s.electrical.readings[drive.src.id].peakCurrent ?? 0); });
    run(dol.s, 4, () => { dolPeak = Math.max(dolPeak, dol.s.electrical.readings[dol.src.id].peakCurrent ?? 0); });
    expect(dolPeak).toBeGreaterThan(120);
    expect(drivePeak).toBeLessThan(10);
    expect(rpm(drive.s, drive.motor)).toBeGreaterThan(1450);
  });
  it("current limit holds the output current while a high inertia accelerates; regeneration goes to the braking resistor", () => {
    const { s, motor, vfd } = driveRig(0, { accelTime: 1, decelTime: 1 }, { inertia: 2 });
    const limit = 1.5 * 16.5;
    let worst = 0, braking = 0;
    run(s, 0.2);
    run(s, 3.5, () => { worst = Math.max(worst, s.electrical.readings[vfd.id].drive!.outputCurrent); });
    // The limiter uses the steady-state current with measured-current feedback; while the rotor flux builds
    // up at low frequency (first second) the dynamic current exceeds the limit by up to about 6 %.
    expect(worst).toBeLessThan(limit * 1.08);
    expect(rpm(s, motor)).toBeLessThan(1490); // a 1 s ramp would have finished: the limit extends the acceleration
    run(s, 4);
    expect(rpm(s, motor)).toBeGreaterThan(1495);
    const kinetic = 0.5 * (2 + 0) * s.multiphysics.motors[motor.id].omega ** 2, heatBefore = s.temperatures[vfd.id];
    setProp(s, vfd.id, "enabled", false);
    run(s, 0.2);
    run(s, 4, () => {
      const d = s.electrical.readings[vfd.id].drive!;
      if (d.running) worst = Math.max(worst, d.outputCurrent);
      braking += d.braking * DT;
    });
    expect(worst).toBeLessThan(limit * 1.08);
    // Most of the rotor's kinetic energy is dissipated in the braking resistor, outside the drive's heat sink.
    expect(braking).toBeGreaterThan(0.5 * kinetic);
    expect(s.temperatures[vfd.id] - heatBefore).toBeLessThan(2);
    closes(s);
  });
  it("I²t overload trips after 60 s at the 150 % current limit (stalled by an excessive load)", () => {
    const { s, vfd } = driveRig(75, { accelTime: 3 });
    expect(driveThermalTau(vfd)).toBeCloseTo(60 / Math.log(2.25 / 1.25), 9);
    let tripAt = 0;
    while (s.time < 70 && !s.failed[vfd.id]) { expect(s.step()).toBe(true); if (s.failed[vfd.id]) tripAt = s.time; }
    // The limit is reached about a second after start, so the trip follows ≈ 60 s later.
    expect(tripAt).toBeGreaterThan(60);
    expect(tripAt).toBeLessThan(62);
    expect(s.tripped[vfd.id]).toMatch(/I²t overload/);
  });
  it("instantaneous output overcurrent trips on an output short circuit", () => {
    const b = new Builder(), src = b.add("source3"), vfd = b.add("vfd"), r = b.add("resistor", { resistance: 0.05, ratedPower: 1e9, heatCapacity: 1e9 });
    b.wire(src, "a", vfd, "a"); b.wire(vfd, "b", src, "b"); b.wire(vfd, "oa", r, "a"); b.wire(r, "b", vfd, "ob");
    const s = new Simulation(b.p);
    run(s, 0.5);
    expect(s.tripped[vfd.id]).toMatch(/instantaneous output overcurrent/);
  });
  it("needs an energised three-phase input; rejects capacitors on its output and shared outputs", () => {
    const { s, vfd, src } = driveRig(0);
    setProp(s, src.id, "enabled", false);
    run(s, 0.5);
    expect(s.electrical.readings[vfd.id].drive?.running ?? false).toBe(false);
    const b = new Builder(), ac = b.add("sourceAC"), d = b.add("vfd"), m = b.add("inductionMotor");
    b.wire(ac, "a", d, "a"); b.wire(d, "b", ac, "b"); b.wire(d, "oa", m, "a"); b.wire(m, "b", d, "ob");
    const single = new Simulation(b.p);
    expect(single.error).toMatch(/balanced three-phase supply/);
    const c = driveRig(0), cap = c.b.add("capacitor", { capacitance: 1e-5 });
    c.b.wire(c.vfd, "oa", cap, "a"); c.b.wire(cap, "b", c.vfd, "ob");
    const withCap = new Simulation(c.b.p);
    withCap.step();
    expect(withCap.error ?? "").toMatch(/no capacitors on a drive output/);
  });
  it("a wired frequency command sets the speed; field weakening above the base frequency keeps the voltage", () => {
    const { s, b, motor, vfd } = driveRig(5, { accelTime: 2, maxFrequency: 60 });
    const k = b.add("constant", { value: 60 });
    b.wire(k, "out", vfd, "frequency");
    const sim = new Simulation(b.p);
    void s;
    run(sim, 5);
    const d = sim.electrical.readings[vfd.id].drive!;
    expect(d.frequency).toBe(60);
    expect(d.outputVoltage).toBeCloseTo(400, 6);
    expect(rpm(sim, motor)).toBeGreaterThan(1750);
    // Steady current agrees with the equivalent circuit at 60 Hz and the solved speed.
    const z = inductionCircuit(motor, 60, sim.multiphysics.motors[motor.id].omega).impedance;
    expect(d.outputCurrent).toBeCloseTo(400 / Math.sqrt(3) / Math.hypot(z[0], z[1]), 3);
  });
});
