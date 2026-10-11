/** Dynamic induction machine equations, independent of the network. */
import { describe, it, expect } from "vitest";
import { makeComponent } from "./model";
import { inductionCircuit } from "./electrical";
import { machineParams, midpointState, magneticEnergy, airGapTorque, openStatorStep, currents, cabs, type Cx } from "./induction";

const c = makeComponent("inductionMotor", 0, 0), m = machineParams(c, 50), v: Cx = [400 / Math.sqrt(3), 0];
const run = (omega: number, steps: number, h: number, psi: { s: Cx; r: Cx } = { s: [0, 0], r: [0, 0] }) => {
  let last: ReturnType<typeof midpointState> | undefined;
  for (let i = 0; i < steps; i++) {
    last = midpointState(m, psi.s, psi.r, h, omega, v);
    psi = { s: [2 * last.psiS[0] - psi.s[0], 2 * last.psiS[1] - psi.s[1]], r: [2 * last.psiR[0] - psi.r[0], 2 * last.psiR[1] - psi.r[1]] };
  }
  return { psi, last: last! };
};

describe("dynamic induction machine", () => {
  for (const rpm of [0, 1200, 1450]) it(`settles to the equivalent-circuit current and torque at ${rpm} rpm`, () => {
    // At standstill one coupled stator/rotor mode decays slowly (~1 s), so allow 16 s to settle.
    const omega = rpm * Math.PI / 30, { last } = run(omega, rpm === 0 ? 16000 : 4000, 1e-3);
    const circuit = inductionCircuit(c, 50, omega), current = cabs(v) / cabs(circuit.impedance);
    expect(Math.abs(cabs(last.is) / current - 1)).toBeLessThan(1e-9);
    // Static torque 3·I2²·R2/(s·ωs,mech) from the circuit's rotor branch.
    const z2 = circuit.z2!, xm = circuit.xm, i2 = current * cabs(xm) / Math.hypot(z2[0], z2[1] + xm[1]);
    const static_ = 3 * i2 * i2 * (z2[0]) / circuit.syncSpeed;
    expect(Math.abs(airGapTorque(m, last.psiS, last.is) / static_ - 1)).toBeLessThan(1e-9);
  });
  it("balances energy exactly in every midpoint step during the switch-on transient", () => {
    let psi = { s: [0, 0] as Cx, r: [0, 0] as Cx };
    const h = 5e-4, omega = 50;
    for (let i = 0; i < 200; i++) {
      const w0 = magneticEnergy(m, psi.s, psi.r), mid = midpointState(m, psi.s, psi.r, h, omega, v);
      const next = { s: [2 * mid.psiS[0] - psi.s[0], 2 * mid.psiS[1] - psi.s[1]] as Cx, r: [2 * mid.psiR[0] - psi.r[0], 2 * mid.psiR[1] - psi.r[1]] as Cx };
      const pin = 3 * (v[0] * mid.is[0] + v[1] * mid.is[1]);
      const losses = 3 * m.Rs * cabs(mid.is) ** 2 + 3 * m.Rr * cabs(mid.ir) ** 2 + airGapTorque(m, mid.psiS, mid.is) * omega;
      const dw = magneticEnergy(m, next.s, next.r) - w0;
      expect(Math.abs(pin * h - losses * h - dw)).toBeLessThan(1e-9 * Math.max(1, pin * h));
      psi = next;
    }
  });
  it("open stator: rotor flux magnitude decays with the open-circuit time constant T0' = Lr/Rr", () => {
    const { psi } = run(150, 3000, 1e-3);
    const t = 0.2, exact = cabs(psi.r) * Math.exp(-t * m.Rr / m.Lr);
    const error = (h: number) => { let r = psi.r; for (let i = 0; i < t / h; i++) r = openStatorStep(m, r, h, 150).psiR; return Math.abs(cabs(r) / exact - 1); };
    // Midpoint integration of the rotating, decaying flux: second-order accurate.
    expect(error(1e-3)).toBeLessThan(5e-5);
    expect(error(1e-3) / error(5e-4)).toBeCloseTo(4, 1);
    let r = psi.r; for (let i = 0; i < t / 1e-3; i++) r = openStatorStep(m, r, 1e-3, 150).psiR;
    expect(cabs(currents(m, [r[0] * m.Lm / m.Lr, r[1] * m.Lm / m.Lr], r).is)).toBeLessThan(1e-9);
  });
});

import { Builder } from "./scaling-validation";
import { Simulation, DT } from "./engine";
import type { Project } from "./model";

describe("dynamic induction motor in the engine", () => {
  const rig = (load = 35) => {
    const b = new Builder(), src = b.add("source3"), motor = b.add("inductionMotor", { loadTorque: load });
    b.series(src, motor);
    return { s: new Simulation(b.p), motor };
  };
  const toggle = (s: Simulation, id: string, enabled: boolean) => s.refresh({ ...s.project, components: s.project.components.map((x) => x.id === id ? { ...x, props: { ...x.props, enabled } } : x) } as Project);
  const lockedRms = () => cabs(v) / cabs(inductionCircuit(c, 50, 0).impedance);

  it("inrush: zero at switch-on, asymmetric first peak above the symmetric √2·I_locked", () => {
    const { s, motor } = rig();
    expect(s.electrical.readings[motor.id].current).toBe(0);
    for (let i = 0; i < 6; i++) s.step(); // 0.1 s
    const peak = s.multiphysics.motors[motor.id].inrushPeak!;
    expect(peak).toBeGreaterThan(1.1 * Math.SQRT2 * lockedRms());
    expect(peak).toBeLessThan(2 * Math.SQRT2 * lockedRms());
  });
  it("runs up and settles at exactly the equivalent-circuit operating point", () => {
    const { s, motor } = rig();
    for (let i = 0; i < 5 / DT; i++) expect(s.step()).toBe(true);
    const omega = s.multiphysics.motors[motor.id].omega, circuit = inductionCircuit(c, 50, omega);
    expect(Math.abs(s.electrical.readings[motor.id].current / (cabs(v) / cabs(circuit.impedance)) - 1)).toBeLessThan(1e-6);
    expect(Math.abs(s.multiphysics.motors[motor.id].torque / (35 + 0.002 * omega) - 1)).toBeLessThan(1e-6);
  });
  it("run-up time differs from the quasi-stationary torque curve (transient torque, flux build-up)", () => {
    const { s, motor } = rig();
    let dynamic = NaN;
    for (let i = 0; i < 2 / DT && Number.isNaN(dynamic); i++) { s.step(); if (s.multiphysics.motors[motor.id].omega * 30 / Math.PI >= 1400) dynamic = s.time; }
    // Quasi-stationary reference: J dω/dt = T_static(ω) − 35 − bω, integrated finely.
    let w = 0, t = 0;
    const torque = (omega: number) => { const k = inductionCircuit(c, 50, omega), i1 = cabs(v) / cabs(k.impedance), i2 = i1 * cabs(k.xm) / Math.hypot(k.z2![0], k.z2![1] + k.xm[1]); return 3 * i2 * i2 * k.z2![0] / k.syncSpeed; };
    while (w * 30 / Math.PI < 1400) { w += 1e-5 * (torque(w) - 35 - 0.002 * w) / 0.045; t += 1e-5; }
    expect(dynamic).toBeGreaterThan(0.1);
    expect(Math.abs(dynamic / t - 1)).toBeGreaterThan(0.02); // electromagnetic dynamics matter for a 0.045 kg·m² rotor
  });
  it("opening the contactor: residual rotor flux decays with T0', energy closes through reconnection", () => {
    const { s, motor } = rig(5);
    for (let i = 0; i < 3 / DT; i++) s.step();
    toggle(s, motor.id, false);
    s.step();
    const psi0 = cabs(s.multiphysics.motors[motor.id].psiR!), t0 = s.time;
    for (let i = 0; i < 0.3 / DT; i++) s.step();
    const expected = psi0 * Math.exp(-(s.time - t0) * m.Rr / m.Lr);
    expect(Math.abs(cabs(s.multiphysics.motors[motor.id].psiR!) / expected - 1)).toBeLessThan(1e-3);
    expect(s.multiphysics.switchingLoss).toBeGreaterThan(0);
    toggle(s, motor.id, true);
    for (let i = 0; i < 3 / DT; i++) s.step();
    expect(s.multiphysics.motors[motor.id].omega * 30 / Math.PI).toBeGreaterThan(1450);
    expect(Math.abs(s.energyResidual / s.suppliedEnergy)).toBeLessThan(1e-9);
  });
});
