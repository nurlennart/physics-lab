import { describe, it, expect } from "vitest";
import { Builder } from "./scaling-validation";
import { Simulation, DT } from "./engine";
import { thermalTau, fuseMeltTime } from "./parameters";
import type { Project } from "./model";
import { peakOverInterval } from "./electrical";
import type { Property } from "./model";

/** Constant-current source through a breaker into a 1 Ω load. */
function rig(kind: "breaker" | "motorProtector" | "fuse", current: number, props: Record<string, Property> = {}, variant = "standard") {
  const b = new Builder();
  const source = b.add("source", { mode: "cc", current, voltage: 1e4, ratedVoltage: 1e4, maxCurrent: 1e6, maxPower: 1e12 });
  const device = b.add(kind, props, variant), load = b.add("resistor", { resistance: 1, ratedPower: 1e9, heatCapacity: 1e12, maxTemperature: 1e4 });
  b.series(source, device, load);
  return { s: new Simulation(b.p), device, load };
}
const runUntilTrip = (s: Simulation, id: string, limit: number) => {
  while (s.time < limit && !s.breakers[id]?.tripped) s.step();
  return s.time;
};
describe("gG fuse: element and body thermal images", () => {
  const meltTime = (s: Simulation, id: string, limit: number) => { while (s.time < limit && !s.failed[id]) expect(s.step()).toBe(true); return s.failed[id] ? s.time : Infinity; };
  const cold = (x: number) => fuseMeltTime({ theta: 0, body: 0 }, x * x, 0.1);
  // Sets the constant-current source of the rig (the fuse argument only names the rig).
  const setCurrent = (s: Simulation, _fuse: string, current: number) =>
    expect(s.refresh({ ...s.project, components: s.project.components.map((c) => c.kind === "source" ? { ...c, props: { ...c.props, current } } : c) } as Project)).toBe(true);
  const meltedAt = (s: Simulation) => s.events.find((e) => /fuse element melted/.test(e.message))?.time ?? Infinity;
  it("meets the IEC 60269 gG time-current gates (16 A link, normalized) and the 10 × In melting time", () => {
    expect(cold(2.06)).toBeGreaterThanOrEqual(10); // 10 s gate: no melting before 10 s at 2.06 × In
    expect(cold(4.06)).toBeLessThanOrEqual(5); // 5 s gate: melted within 5 s at 4.06 × In
    expect(cold(5.31)).toBeGreaterThanOrEqual(0.1); // 0.1 s gate, lower current
    expect(cold(10)).toBeCloseTo(0.1, 9); // tripTime
    expect(cold(1.25)).toBe(Infinity); // conventional non-fusing current
    expect(cold(1.6)).toBeLessThan(3600); // conventional fusing current
    // Inverse time, and ≈ constant pre-arcing I²t at high current.
    for (const [a, b] of [[2, 3], [3, 5], [5, 10], [10, 30]]) expect(cold(b)).toBeLessThan(cold(a));
    expect(cold(50) * 50 ** 2 / (cold(30) * 30 ** 2)).toBeCloseTo(1, 1);
  });
  it("the engine melts the element at the model's time for overload and short circuit", () => {
    for (const x of [2.4, 10]) {
      const { s, device } = rig("fuse", 10 * x);
      expect(Math.abs(meltTime(s, device.id, 60) - cold(x))).toBeLessThanOrEqual(DT + 1e-9);
      expect(s.electrical.readings[device.id].current).toBe(0);
    }
    const short = rig("fuse", 10 * 30);
    expect(meltTime(short.s, short.device.id, 1)).toBeCloseTo(DT, 12); // 11 ms pre-arcing: within the first step
  });
  it("carries 1.25 × In for hours and melts at 1.6 × In within the conventional hour (adaptive steps)", () => {
    const hold = rig("fuse", 12.5);
    hold.s.advanceAdaptive(3 * 3600);
    expect(hold.s.failed[hold.device.id]).toBeUndefined();
    const melt = rig("fuse", 16);
    melt.s.advanceAdaptive(3600);
    expect(melt.s.failed[melt.device.id]).toBe(true);
    expect(Math.abs(meltedAt(melt.s) - cold(1.6))).toBeLessThan(0.5);
  });
  it("thermal memory: a preloaded fuse melts sooner, and recovers its cold characteristic after cooling", () => {
    const { s, device } = rig("fuse", 12);
    s.advanceAdaptive(1800); // 1.2 × In for 30 min warms the body
    setCurrent(s, device.id, 20);
    const t0 = s.time, warm = meltTime(s, device.id, t0 + 60) - t0;
    expect(warm).toBeLessThan(0.6 * cold(2));
    const cooled = rig("fuse", 12);
    cooled.s.advanceAdaptive(1800);
    setCurrent(cooled.s, cooled.device.id, 0);
    cooled.s.advanceAdaptive(3 * 3600);
    setCurrent(cooled.s, cooled.device.id, 20);
    const t1 = cooled.s.time;
    expect((meltTime(cooled.s, cooled.device.id, t1 + 60) - t1) / cold(2)).toBeCloseTo(1, 1);
  });
  it("repeated 3 × In pulses accumulate heat: a later pulse melts the element although one pulse does not", () => {
    const { s, device } = rig("fuse", 30);
    expect(cold(3)).toBeGreaterThan(4);
    let pulses = 0;
    while (!s.failed[device.id] && pulses < 20) {
      setCurrent(s, device.id, 30); pulses++;
      for (let i = 0; i < 4 / DT && !s.failed[device.id]; i++) expect(s.step()).toBe(true);
      if (s.failed[device.id]) break;
      setCurrent(s, device.id, 0);
      for (let i = 0; i < 4 / DT; i++) expect(s.step()).toBe(true);
    }
    expect(s.failed[device.id]).toBe(true);
    expect(pulses).toBeGreaterThan(1);
  });
});
describe("thermal-magnetic protection", () => {
  it("trips thermally at the analytic I²t time and not below the conventional current", () => {
    const { s, device } = rig("breaker", 32);
    const tau = thermalTau(device), expected = tau * Math.log(4 / (4 - 1.69));
    expect(runUntilTrip(s, device.id, 200)).toBeCloseTo(expected, 1);
    expect(s.electrical.readings[device.id].current).toBe(0);
    expect(s.automation.signals[device.id].value).toBe(false);
    const hold = rig("breaker", 16 * 1.25);
    hold.s.advanceAdaptive(3 * 3600);
    expect(hold.s.breakers[hold.device.id].tripped).toBe(false);
  });
  it("trips magnetically within one step and reports breaking-capacity violations", () => {
    const { s, device } = rig("breaker", 400);
    s.step();
    expect(s.breakers[device.id].tripped).toBe(true);
    expect(s.time).toBeCloseTo(DT, 12);
    const fault = rig("breaker", 20000);
    fault.s.step();
    expect(fault.s.violations.some((v) => /breaking capacity/.test(v))).toBe(true);
  });
  it("re-closes only after the thermal memory cools; a magnetic trip leaves it cold", () => {
    const { s, device } = rig("breaker", 32);
    runUntilTrip(s, device.id, 200);
    expect(s.resetSafety(device.id)).toMatch(/Cannot re-close/);
    s.advanceAdaptive(120);
    expect(s.breakers[device.id].theta).toBeLessThan(1);
    const short = rig("breaker", 400);
    short.s.step();
    expect(short.s.resetSafety(short.device.id)).toBeNull();
    expect(s.resetSafety(device.id)).toBeNull();
    expect(s.breakers[device.id].tripped).toBe(false);
    s.step();
    expect(Math.abs(s.electrical.readings[device.id].current)).toBeCloseTo(32, 6);
  });
  it("motor protector trips class 10 at 7.2 × setting in about 10 s from cold", () => {
    const { s, device } = rig("motorProtector", 20 * 7.2, { magneticTrip: 13 });
    expect(runUntilTrip(s, device.id, 30)).toBeCloseTo(10, 1);
  });
  it("a welded (stuck-closed) breaker does not interrupt the fault", () => {
    const { s, device } = rig("breaker", 400);
    expect(s.injectFault(device.id, "stuckClosed")).toBeNull();
    for (let i = 0; i < 10; i++) s.step();
    expect(Math.abs(s.electrical.readings[device.id].current)).toBeCloseTo(400, 6);
  });
});

describe("magnetic release on AC: instantaneous current", () => {
  it("peakOverInterval is exact for a constant phasor", () => {
    const I: [number, number] = [3, 4]; // |I| = 5 A RMS, φ = atan2(4, 3)
    const phi = Math.atan2(4, 3), amp = 5 * Math.SQRT2;
    expect(peakOverInterval(I, 3, 0, Math.PI / 3)).toBeCloseTo(amp, 12); // a whole peak spacing
    expect(peakOverInterval(I, 1, 0, 2 * Math.PI / 3)).toBeLessThanOrEqual(amp);
    // Narrow interval just after a phase peak: the value at the near end.
    const x0 = Math.PI / 3 - phi + 0.01, x1 = x0 + 0.02;
    expect(peakOverInterval(I, 3, x0, x1)).toBeCloseTo(amp * Math.max(...[0, 1, 2].map((k) => Math.abs(Math.cos(x0 + phi - 2 * Math.PI * k / 3)))), 12);
    expect(peakOverInterval(I, 3, x0, x1)).toBeLessThan(amp);
  });
  function motorStart(magneticTrip: number) {
    const b = new Builder(), src = b.add("source3", { lineVoltage: 400, maxCurrent: 63, maxPower: 1e7 });
    const device = b.add("breaker", { ratedCurrent: 16, magneticTrip }), motor = b.add("inductionMotor", { loadTorque: 0 });
    b.series(src, device, motor);
    return { s: new Simulation(b.p), device, motor };
  }
  it("a 7.5 kW direct-on-line start: the asymmetric first peak trips a setting the symmetric current stays below", () => {
    // Switch-on at θ = 0: first instantaneous peak ≈ 130 A (DC offset); symmetric locked-rotor peak ≈ 105 A,
    // largest RMS phasor sample ≈ 85 A. Setting 5.5 × 16 A = 88 A RMS → 124.5 A instantaneous.
    const { s, device, motor } = motorStart(5.5);
    s.step();
    expect(s.breakers[device.id].tripped).toBe(true);
    expect(s.events.some((e) => /magnetic trip — instantaneous current peak of 13\d\.\d A/.test(e.message))).toBe(true);
    expect(s.multiphysics.motors[motor.id].inrushPeak).toBeGreaterThan(124.5);
    // RMS samples alone would not have reached the 88 A setting.
    const rms = motorStart(1000);
    let largest = 0;
    for (let i = 0; i < 30; i++) { rms.s.step(); largest = Math.max(largest, rms.s.electrical.readings[rms.device.id].current); }
    expect(largest).toBeLessThan(88);
  });
  it("a setting above the asymmetric peak rides through the start; steady AC trips at k·In RMS", () => {
    const { s, device, motor } = motorStart(6); // 96 A RMS → 135.8 A instantaneous
    for (let i = 0; i < 120; i++) s.step();
    expect(s.breakers[device.id].tripped).toBe(false);
    expect(s.multiphysics.motors[motor.id].omega * 30 / Math.PI).toBeGreaterThan(1450);
    const running = s.electrical.readings[device.id]; // steady: the coupled peak is the sinusoid's crest √2·|I|
    expect(Math.abs(running.peakCurrent! / (Math.SQRT2 * running.current) - 1)).toBeLessThan(1e-6);
    // Resistive AC load: the instantaneous peak is √2·|I|, so the trip point is the RMS setting.
    const trip = (resistance: number) => {
      const b = new Builder(), src = b.add("sourceAC", { voltage: 230, maxCurrent: 1e4, maxPower: 1e9 });
      const brk = b.add("breaker", { ratedCurrent: 10, magneticTrip: 10 }), load = b.add("resistor", { resistance, ratedPower: 1e9, heatCapacity: 1e12, maxTemperature: 1e4 });
      b.series(src, brk, load);
      const sim = new Simulation(b.p);
      sim.step();
      return sim.breakers[brk.id]?.tripped ?? false;
    };
    expect(trip(230 / 100.1 - 0.005)).toBe(true); // 100.1 A RMS (the breaker contributes 5 mΩ)
    expect(trip(230 / 99.9 - 0.005)).toBe(false); // 99.9 A RMS
  });
});
