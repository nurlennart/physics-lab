/** AC phasor network and induction machine tests against independent complex arithmetic. */
import { describe, it, expect } from "vitest";
import { Builder } from "./scaling-validation";
import { Simulation, DT } from "./engine";
import { nodeVoltage } from "./electrical";
import type { Component } from "./model";

type C = [number, number];
const add = (a: C, b: C): C => [a[0] + b[0], a[1] + b[1]];
const mul = (a: C, b: C): C => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const div = (a: C, b: C): C => { const d = b[0] ** 2 + b[1] ** 2; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
const abs = (a: C) => Math.hypot(a[0], a[1]);
const polar = (m: number, deg: number): C => [m * Math.cos(deg * Math.PI / 180), m * Math.sin(deg * Math.PI / 180)];
const rel = (a: number, b: number) => Math.abs(a / b - 1);

describe("single-phase AC impedances", () => {
  it("series R–L load: current, active and reactive power and power factor", () => {
    const b = new Builder(), src = b.add("sourceAC", { voltage: 230, frequency: 50 }), r = b.add("resistor", { resistance: 10, ratedPower: 1e5, heatCapacity: 1e9 }), l = b.add("inductor", { inductance: 0.05, resistance: 0.001, tempCoefficient: 0 });
    b.series(src, r, l);
    const s = new Simulation(b.p);
    const z: C = [10.001, 2 * Math.PI * 50 * 0.05], i = 230 / abs(z);
    expect(rel(s.electrical.readings[r.id].current, i)).toBeLessThan(1e-9);
    expect(rel(s.electrical.readings[r.id].power, i * i * 10)).toBeLessThan(1e-9);
    expect(rel(s.electrical.readings[l.id].reactivePower!, i * i * z[1])).toBeLessThan(1e-9);
    expect(rel(-s.electrical.readings[src.id].power, i * i * 10.001)).toBeLessThan(1e-9);
    expect(rel(s.electrical.readings[src.id].powerFactor!, 10.001 / abs(z))).toBeLessThan(1e-9);
  });
  it("a parallel capacitor sized C = Q/(ωV²) corrects the power factor to unity", () => {
    const b = new Builder(), src = b.add("sourceAC", { voltage: 230, frequency: 50 });
    const r = b.add("resistor", { resistance: 10, ratedPower: 1e5, heatCapacity: 1e9 }), l = b.add("inductor", { inductance: 0.05, resistance: 0.001, tempCoefficient: 0 });
    b.series(src, r, l);
    const z: C = [10.001, 2 * Math.PI * 50 * 0.05], q = 230 ** 2 * z[1] / abs(z) ** 2;
    const cap = b.add("capacitor", { capacitance: q / (2 * Math.PI * 50 * 230 ** 2), resistance: 1e-9 });
    b.wire(src, "a", cap, "a"); b.wire(cap, "b", src, "b");
    const s = new Simulation(b.p);
    expect(s.electrical.readings[src.id].powerFactor!).toBeGreaterThan(0.99999);
    expect(Math.abs(s.electrical.readings[src.id].reactivePower!)).toBeLessThan(1e-3 * q);
  });
  it("a capacitor blocks steady DC (only 1 GΩ insulation leakage)", () => {
    const b = new Builder(), src = b.add("source", { voltage: 24 }), cap = b.add("capacitor"), r = b.add("resistor", { resistance: 10 });
    b.series(src, cap, r);
    const s = new Simulation(b.p);
    expect(Math.abs(s.electrical.readings[r.id].current)).toBeLessThan(1e-7);
  });
});
describe("explicit (unbalanced) three-phase system from three AC sources", () => {
  it("star loads give the independent neutral current and 400 V line-to-line", () => {
    const b = new Builder(), neutral = b.add("ground");
    const loads = [10, 20, 40], angles = [0, -120, 120], sources: Component[] = [], resistors: Component[] = [];
    const star = b.add("junction"), wire = b.add("resistor", { resistance: 1e-4, ratedPower: 1e9 });
    loads.forEach((ohms, k) => {
      const src = b.add("sourceAC", { voltage: 230, phase: angles[k] }), load = b.add("resistor", { resistance: ohms, ratedPower: 1e6, heatCapacity: 1e9 });
      b.wire(src, "b", neutral, "a"); b.wire(src, "a", load, "a"); b.wire(load, "b", star, "a");
      sources.push(src); resistors.push(load);
    });
    b.wire(star, "a", wire, "a"); b.wire(wire, "b", neutral, "a");
    const s = new Simulation(b.p);
    // Neutral conductor of 0.1 mΩ: practically zero star-point shift.
    const expected = abs(loads.reduce<C>((sum, ohms, k) => add(sum, div(polar(230, angles[k]), [ohms, 0])), [0, 0]));
    expect(rel(s.electrical.readings[wire.id].current, expected)).toBeLessThan(1e-3);
    const lineToLine = nodeVoltage(s.electrical, `${sources[0].id}:a`, `${sources[1].id}:a`)!;
    expect(rel(lineToLine, 230 * Math.sqrt(3))).toBeLessThan(1e-9);
    resistors.forEach((load, k) => expect(rel(s.electrical.readings[load.id].power, 230 ** 2 / loads[k])).toBeLessThan(1e-3));
  });
});
describe("three-phase induction motor", () => {
  const rig = (props: Record<string, number> = {}) => {
    const b = new Builder(), src = b.add("source3", { lineVoltage: 400, maxCurrent: 1000, maxPower: 1e7 }), motor = b.add("inductionMotor", props);
    b.series(src, motor);
    return { b, src, motor };
  };
  it("locked-rotor current and torque match the equivalent circuit", () => {
    const { b, motor } = rig({ loadTorque: 1e6 });
    const s = new Simulation(b.p), p = motor.props as Record<string, number>;
    // Dynamic machine: compare after the electromagnetic transient has decayed (slowest mode ~1 s at standstill).
    for (let i = 0; i < 20 / DT; i++) s.step();
    expect(s.multiphysics.motors[motor.id].omega).toBe(0);
    const z2: C = [p.rotorResistance, p.rotorReactance], xm: C = [0, p.magnetizingReactance];
    const z = add([p.statorResistance, p.statorReactance], div(mul(xm, z2), add(xm, z2)));
    const i1 = 400 / Math.sqrt(3) / abs(z), i2 = i1 * abs(xm) / abs(add(xm, z2));
    const torque = 3 * i2 * i2 * p.rotorResistance / (2 * Math.PI * 50 / 2);
    expect(rel(s.electrical.readings[motor.id].current, i1)).toBeLessThan(1e-6);
    expect(rel(s.electrical.readings[motor.id].machine!.torque, torque)).toBeLessThan(1e-6);
  });
  it("runs up to near synchronous speed, balances power and conserves energy", () => {
    const { b, motor } = rig();
    const s = new Simulation(b.p);
    for (let i = 0; i < 5 / DT; i++) s.step();
    const m = s.multiphysics.motors[motor.id], r = s.electrical.readings[motor.id];
    expect(m.omega * 30 / Math.PI).toBeGreaterThan(1490);
    expect(m.omega * 30 / Math.PI).toBeLessThan(1500);
    // Electrical input = stator + rotor copper + mechanical (air-gap torque × speed).
    expect(rel(r.power, r.machine!.statorCopper + r.machine!.rotorCopper + r.machine!.torque * m.omega)).toBeLessThan(1e-6);
    expect(r.powerFactor!).toBeLessThan(0.5);
    expect(Math.abs(s.energyResidual / s.suppliedEnergy)).toBeLessThan(1e-4);
  });
  it("drives a pump through a shaft and reports a loaded slip", () => {
    const { b, motor } = rig();
    const pump = b.add("pump", { ratedSpeed: 157, ratedFlow: 0.02, shutoffHead: 25, efficiency: 0.8 });
    const low = b.add("tank", { capacity: 5000, volume: 4000, surfaceArea: 2, loss: 0 }), high = b.add("tank", { capacity: 5000, volume: 0, surfaceArea: 2, elevation: 5, loss: 0 });
    const suction = b.add("pipe", { diameter: 0.1, length: 5, inventory: false }), discharge = b.add("pipe", { diameter: 0.1, length: 20, inventory: false });
    b.wire(motor, "shaft", pump, "shaft");
    b.wire(low, "fluid", suction, "inlet"); b.wire(suction, "outlet", pump, "inlet"); b.wire(pump, "outlet", discharge, "inlet"); b.wire(discharge, "outlet", high, "fluid");
    const s = new Simulation(b.p);
    for (let i = 0; i < 10 / DT; i++) if (!s.step()) break;
    expect(s.error).toBeNull();
    expect(s.multiphysics.hydraulic.readings[pump.id].flow).toBeGreaterThan(0.005);
    expect(s.electrical.readings[motor.id].machine!.slip).toBeGreaterThan(0.005);
    expect(Math.abs(s.energyResidual / s.suppliedEnergy)).toBeLessThan(1e-4);
    expect(Math.abs(s.multiphysics.massResidual)).toBeLessThan(1e-9);
  });
  it("rejects an induction motor on single-phase or DC supplies", () => {
    const single = new Builder(), ac = single.add("sourceAC"), m1 = single.add("inductionMotor");
    single.series(ac, m1);
    expect(new Simulation(single.p).error).toMatch(/three-phase supply/);
    const dc = new Builder(), source = dc.add("source"), m2 = dc.add("inductionMotor");
    dc.series(source, m2);
    expect(new Simulation(dc.p).error).toMatch(/three-phase AC supply/);
  });
});
describe("AC supply thermal-magnetic output protection", () => {
  const rig = (ohms: number, props: Record<string, number> = {}) => {
    const b = new Builder(), src = b.add("source3", { lineVoltage: 400, maxCurrent: 63, maxPower: 1e9, ...props });
    const load = b.add("resistor", { resistance: ohms, ratedPower: 1e9, heatCapacity: 1e12, tempCoefficient: 0 });
    b.series(src, load);
    return { s: new Simulation(b.p), src, current: 400 / Math.sqrt(3) / ohms };
  };
  it("sustained 2 × In trips at the thermal-image time τ·ln(x²/(x² − 1.3²))", () => {
    const { s, src, current } = rig(400 / Math.sqrt(3) / 126);
    expect(rel(current, 126)).toBeLessThan(1e-12);
    const expected = 60 * Math.log(4 / (4 - 1.69));
    while (!s.failed[src.id] && s.time < 100) s.step();
    expect(Math.abs(s.time - expected)).toBeLessThanOrEqual(DT + 1e-9);
    expect(s.tripped[src.id]).toMatch(/thermal overload at 2\.00 × the 63 A rating/);
  });
  it("1.2 × In for 10 s is tolerated and reported, not tripped", () => {
    const { s, src } = rig(400 / Math.sqrt(3) / (1.2 * 63));
    for (let i = 0; i < 10 / DT; i++) s.step();
    expect(s.failed[src.id]).toBeFalsy();
    expect(s.events.some((e) => /above its 63 A rating \(tolerated/.test(e.message))).toBe(true);
  });
  it("magneticTrip × In trips in the first interval", () => {
    const { s, src } = rig(400 / Math.sqrt(3) / (11 * 63));
    s.step();
    expect(s.failed[src.id]).toBe(true);
    expect(s.tripped[src.id]).toMatch(/instantaneous current peak of 980\.0 A reached √2 × the 630\.0 A RMS setting/);
  });
  it("the default 63 A supply starts and runs the default 7.5 kW motor at rated load", () => {
    const b = new Builder(), src = b.add("source3"), motor = b.add("inductionMotor", { loadTorque: 50 });
    b.series(src, motor);
    const s = new Simulation(b.p);
    for (let i = 0; i < 30 / DT; i++) expect(s.step()).toBe(true);
    expect(s.failed[src.id]).toBeFalsy();
    expect(s.multiphysics.motors[motor.id].omega * 30 / Math.PI).toBeGreaterThan(1400);
  });
});
