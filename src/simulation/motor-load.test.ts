/** Opposing shaft load, coast-down, restart, rotor angle and stopped-pump flow. */
import { describe, it, expect } from "vitest";
import { Builder } from "./scaling-validation";
import { Simulation, DT } from "./engine";
import { readProbe } from "./measurements";
import type { Component, Project } from "./model";

const rpm = (s: Simulation, m: Component) => s.multiphysics.motors[m.id].omega * 30 / Math.PI;
const setProp = (s: Simulation, id: string, key: string, value: number | boolean) =>
  s.refresh({ ...s.project, components: s.project.components.map((c) => c.id === id ? { ...c, props: { ...c.props, [key]: value } } : c) } as Project);
const run = (s: Simulation, seconds: number, each?: () => void) => { for (let i = 0; i < Math.round(seconds / DT); i++) { expect(s.step()).toBe(true); each?.(); } };
function motorRig(load: number) {
  const b = new Builder(), src = b.add("source3", { lineVoltage: 400, maxCurrent: 63, maxPower: 1e7 }), motor = b.add("inductionMotor", { loadTorque: load });
  b.series(src, motor);
  return { s: new Simulation(b.p), motor };
}

describe("opposing external shaft load", () => {
  it("loaded motor: run, open contactor, stop at the analytic time, stay stopped, restart", () => {
    const { s, motor } = motorRig(35);
    run(s, 5);
    const w0 = s.multiphysics.motors[motor.id].omega;
    expect(rpm(s, motor)).toBeGreaterThan(1400);
    setProp(s, motor.id, "enabled", false);
    const J = 0.045, b = 0.002, tl = 35, tStop = (J / b) * Math.log(1 + (b * w0) / tl), t0 = s.time;
    let stoppedAt: number | null = null, minOmega = Infinity, work = s.multiphysics.externalShaftWork;
    run(s, 3, () => {
      const w = s.multiphysics.motors[motor.id].omega;
      minOmega = Math.min(minOmega, w);
      if (stoppedAt === null && w === 0) stoppedAt = s.time - t0;
      expect(s.multiphysics.externalShaftWork).toBeGreaterThanOrEqual(work - 1e-9); // the load never supplies energy
      work = s.multiphysics.externalShaftWork;
    });
    expect(stoppedAt).not.toBeNull();
    expect(Math.abs(stoppedAt! - tStop)).toBeLessThanOrEqual(DT + 1e-6);
    expect(minOmega).toBe(0); // never driven backwards
    run(s, 10, () => expect(s.multiphysics.motors[motor.id].omega).toBe(0));
    setProp(s, motor.id, "enabled", true);
    run(s, 5);
    expect(rpm(s, motor)).toBeGreaterThan(1400);
    expect(Math.abs(s.energyResidual / s.suppliedEnergy)).toBeLessThan(1e-6);
  });
  it("zero-load coasting decays exponentially with τ = J/b and never reverses", () => {
    const { s, motor } = motorRig(0);
    run(s, 4);
    const w0 = s.multiphysics.motors[motor.id].omega;
    setProp(s, motor.id, "enabled", false);
    run(s, 20);
    const w = s.multiphysics.motors[motor.id].omega;
    expect(w).toBeGreaterThan(0);
    expect(Math.abs(w / (w0 * Math.exp(-20 * 0.002 / 0.045)) - 1)).toBeLessThan(1e-4);
    expect(Math.abs(s.energyResidual / s.suppliedEnergy)).toBeLessThan(1e-6);
  });
  it("a load above the steady locked-rotor torque is held after the switch-on transient, never reversed", () => {
    const { s, motor } = motorRig(150); // steady locked-rotor torque ≈ 108 N·m (deep-bar double cage)
    // At standstill the switch-on DC flux decays slowly and makes the torque oscillate at 50 Hz around the
    // 108 N·m mean, so the rotor twitches forward for a moment before the load holds it.
    run(s, 1, () => expect(s.multiphysics.motors[motor.id].omega).toBeGreaterThanOrEqual(0));
    run(s, 2, () => expect(s.multiphysics.motors[motor.id].omega).toBe(0));
    expect(Math.abs(s.energyResidual / s.suppliedEnergy)).toBeLessThan(1e-6);
  });
  it("legitimate reverse rotation: a reversed DC motor runs backwards against the load", () => {
    const b = new Builder(), src = b.add("source", { voltage: 24, maxCurrent: 100 }), m = b.add("motor", { loadTorque: 0.2 });
    b.wire(src, "a", m, "b"); b.wire(m, "a", src, "b");
    const s = new Simulation(b.p);
    run(s, 5);
    expect(s.multiphysics.motors[m.id].omega).toBeLessThan(-10);
    expect(s.multiphysics.externalShaftWork).toBeGreaterThan(0);
    expect(Math.abs(s.energyResidual / s.suppliedEnergy)).toBeLessThan(1e-6);
  });
  it("rotor angle accumulates ∫ω dt, freezes while paused and restarts at zero on reset", () => {
    const { s, motor } = motorRig(10);
    let integral = 0;
    run(s, 3, () => { integral += s.multiphysics.motors[motor.id].omega * DT; });
    const angle = s.multiphysics.motors[motor.id].angle;
    expect(Math.abs(angle / integral - 1)).toBeLessThan(0.01);
    s.refresh(s.project);
    expect(s.multiphysics.motors[motor.id].angle).toBe(angle);
    s.reset();
    expect(s.multiphysics.motors[motor.id].angle).toBe(0);
  });
});

describe("elevation-driven flow through a stopped pump", () => {
  function pumpRig(upstream: "inlet" | "outlet", driver: "free" | "restrained") {
    const b = new Builder();
    const pump = b.add("pump", { ratedSpeed: 157, ratedFlow: 0.02, shutoffHead: 25, efficiency: 0.8 });
    const high = b.add("tank", { capacity: 5000, volume: 4000, surfaceArea: 2, elevation: 6, loss: 0 }), low = b.add("tank", { capacity: 5000, volume: 500, surfaceArea: 2, loss: 0 });
    const p1 = b.add("pipe", { diameter: 0.1, length: 5, inventory: false }), p2 = b.add("pipe", { diameter: 0.1, length: 5, inventory: false });
    const [into, outOf] = upstream === "inlet" ? [high, low] : [low, high];
    b.wire(into, "fluid", p1, "inlet"); b.wire(p1, "outlet", pump, "inlet"); b.wire(pump, "outlet", p2, "inlet"); b.wire(p2, "outlet", outOf, "fluid");
    let motor: Component | undefined;
    if (driver === "restrained") {
      const src = b.add("source3"); motor = b.add("inductionMotor", { loadTorque: 20, enabled: false });
      b.series(src, motor); b.wire(motor, "shaft", pump, "shaft");
    }
    return { s: new Simulation(b.p), pump, motor };
  }
  it("free shaft: passive forward flow, no fabricated speed, mass and energy close", () => {
    const { s, pump } = pumpRig("inlet", "free");
    run(s, 10);
    expect(s.multiphysics.hydraulic.readings[pump.id].flow).toBeGreaterThan(0.005);
    expect(readProbe({ id: "x", name: "x", component: pump.id, measurement: "rpm", color: "#fff", visible: true }, s)).toBeNull();
    expect(Math.abs(s.multiphysics.massResidual)).toBeLessThan(1e-9);
    // No electrical supply: compare the residual with the potential energy dissipated by the flow.
    expect(s.multiphysics.dissipation).toBeGreaterThan(1000);
    expect(Math.abs(s.energyResidual) / s.multiphysics.dissipation).toBeLessThan(1e-4);
  });
  it("restrained shaft: the coupled motor stays at rest (no hydraulic torque is modelled)", () => {
    const { s, pump, motor } = pumpRig("inlet", "restrained");
    run(s, 10, () => expect(s.multiphysics.motors[motor!.id].omega).toBe(0));
    expect(s.multiphysics.hydraulic.readings[pump.id].flow).toBeGreaterThan(0.005);
    expect(readProbe({ id: "x", name: "x", component: pump.id, measurement: "rpm", color: "#fff", visible: true }, s)).toBe(0);
  });
  it("reverse head: the built-in check blocks flow and holds the pressure difference", () => {
    const { s, pump } = pumpRig("outlet", "free");
    run(s, 5);
    const r = s.multiphysics.hydraulic.readings[pump.id];
    expect(r.flow).toBe(0);
    expect(r.pressure - r.inletPressure).toBeGreaterThan(5 * 9.81 * 990);
  });
});
