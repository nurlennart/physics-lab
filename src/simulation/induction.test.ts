/** Dynamic induction machine equations, independent of the network. */
import { describe, it, expect } from "vitest";
import { makeComponent } from "./model";
import { machineParams, midpointState, magneticEnergy, airGapTorque, openStatorStep, openStatorFlux, currents, rotorCopper, steadyCircuit, noRotorFlux, cabs, type Cx } from "./induction";
import { expm } from "./linear-algebra";
import { inductionCircuit } from "./electrical";

const c = makeComponent("inductionMotor", 0, 0), m = machineParams(c, 50), v: Cx = [400 / Math.sqrt(3), 0];
const double = (x: Cx[], y: Cx[]) => x.map((p, k): Cx => [2 * p[0] - y[k][0], 2 * p[1] - y[k][1]]);
const run = (omega: number, steps: number, h: number, psi: { s: Cx; r: Cx[] } = { s: [0, 0], r: noRotorFlux(m) }) => {
  let last: ReturnType<typeof midpointState> | undefined;
  for (let i = 0; i < steps; i++) {
    last = midpointState(m, psi.s, psi.r, h, omega, v);
    psi = { s: double([last.psiS], [psi.s])[0], r: double(last.psiR, psi.r) };
  }
  return { psi, last: last! };
};
/** Rotor flux magnitudes after t with an open stator: |e^(−R·L⁻¹·t)·ψ₀| per cage (the slip rotation is a common phase). */
function openDecay(psi: Cx[], t: number) {
  const [l11, l22, lm] = [m.cages[0].L, m.cages[1].L, m.Lm], det = l11 * l22 - lm * lm;
  const inverse = [[l22 / det, -lm / det], [-lm / det, l11 / det]];
  const rate = inverse.map((row, i) => row.map((v) => -m.cages[i].R * v * t)), e = expm(rate);
  return [0, 1].map((k) => cabs([e[k][0] * psi[0][0] + e[k][1] * psi[1][0], e[k][0] * psi[0][1] + e[k][1] * psi[1][1]]));
}

describe("dynamic induction machine", () => {
  it("the catalog motor has a running and a starting cage and an iron-loss resistance", () => {
    expect(m.cages).toHaveLength(2);
    expect(m.cages[1].R).toBeGreaterThan(m.cages[0].R * 0.99); // starting cage: high resistance …
    expect(m.cages[1].L).toBeLessThan(m.cages[0].L); // … and low leakage
    expect(Number.isFinite(m.Rc)).toBe(true);
  });
  for (const rpm of [0, 1200, 1450]) it(`settles to the equivalent-circuit current and torque at ${rpm} rpm`, () => {
    // At standstill one coupled stator/rotor mode decays slowly (~1 s), so allow 16 s to settle.
    const omega = rpm * Math.PI / 30, { last } = run(omega, rpm === 0 ? 16000 : 4000, 1e-3);
    const steady = steadyCircuit(m, omega).split(v);
    expect(Math.abs(cabs(last.is) / cabs(steady.is) - 1)).toBeLessThan(1e-9);
    expect(Math.abs(airGapTorque(m, last.psiS, last.is) / steady.torque - 1)).toBeLessThan(1e-9);
    expect(Math.abs(rotorCopper(m, last.ir) / steady.rotorCopper - 1)).toBeLessThan(1e-9);
  });
  it("reduces to the single-cage machine and its classic circuit without a starting cage", () => {
    const single = machineParams({ ...c, props: { ...c.props, rotorResistance2: 0 } }, 50), omega = 150;
    const z1: Cx = [single.Rs, 2 * Math.PI * 50 * (single.Ls - single.Lm)], xm: Cx = [0, 2 * Math.PI * 50 * single.Lm], slip = (single.ws - 2 * omega) / single.ws;
    const z2: Cx = [single.cages[0].R / slip, 2 * Math.PI * 50 * (single.cages[0].L - single.Lm)];
    const div = (a: Cx, b: Cx): Cx => { const d = b[0] ** 2 + b[1] ** 2; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
    const mul = (a: Cx, b: Cx): Cx => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
    const parallel = div(mul(xm, z2), [xm[0] + z2[0], xm[1] + z2[1]]), z: Cx = [z1[0] + parallel[0], z1[1] + parallel[1]];
    expect(single.cages).toHaveLength(1);
    expect(Math.abs(cabs(steadyCircuit(single, omega).split(v).is) / (cabs(v) / cabs(z)) - 1)).toBeLessThan(1e-12);
  });
  it("balances energy exactly in every midpoint step during the switch-on transient", () => {
    let psi = { s: [0, 0] as Cx, r: noRotorFlux(m) };
    const h = 5e-4, omega = 50;
    for (let i = 0; i < 200; i++) {
      const w0 = magneticEnergy(m, psi.s, psi.r), mid = midpointState(m, psi.s, psi.r, h, omega, v);
      const next = { s: double([mid.psiS], [psi.s])[0], r: double(mid.psiR, psi.r) };
      const pin = 3 * (v[0] * mid.is[0] + v[1] * mid.is[1]);
      const losses = 3 * m.Rs * cabs(mid.is) ** 2 + rotorCopper(m, mid.ir) + airGapTorque(m, mid.psiS, mid.is) * omega;
      const dw = magneticEnergy(m, next.s, next.r) - w0;
      expect(Math.abs(pin * h - losses * h - dw)).toBeLessThan(1e-9 * Math.max(1, pin * h));
      psi = next;
    }
  });
  it("open stator: both cages' fluxes decay as e^(−R·L⁻¹·t), dissipating exactly their field energy", () => {
    const { psi } = run(150, 3000, 1e-3), t = 0.2, exact = openDecay(psi.r, t);
    const error = (h: number) => { let r = psi.r; for (let i = 0; i < t / h; i++) r = openStatorStep(m, r, h, 150).psiR; return Math.max(...r.map((x, k) => Math.abs(cabs(x) / exact[k] - 1))); };
    // Midpoint integration of the rotating, decaying flux: second-order accurate.
    expect(error(1e-3)).toBeLessThan(5e-5);
    expect(error(1e-3) / error(5e-4)).toBeCloseTo(4, 1);
    let r = psi.r, heat = 0;
    const w0 = magneticEnergy(m, openStatorFlux(m, r), r);
    for (let i = 0; i < t / 1e-3; i++) { const step = openStatorStep(m, r, 1e-3, 150); heat += step.rotorCopper * 1e-3; r = step.psiR; }
    expect(cabs(currents(m, openStatorFlux(m, r), r).is)).toBeLessThan(1e-9);
    expect(Math.abs(w0 - magneticEnergy(m, openStatorFlux(m, r), r) - heat)).toBeLessThan(1e-9 * w0);
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

  it("inrush: only the iron-loss current at switch-on, asymmetric first peak above the symmetric √2·I_locked", () => {
    const { s, motor } = rig();
    expect(s.electrical.readings[motor.id].current).toBeCloseTo(cabs(v) / m.Rc, 6); // winding current cannot jump
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
    const torque = (omega: number) => steadyCircuit(m, omega).split(v).torque;
    while (w * 30 / Math.PI < 1400) { w += 1e-5 * (torque(w) - 35 - 0.002 * w) / 0.045; t += 1e-5; }
    expect(dynamic).toBeGreaterThan(0.05);
    expect(Math.abs(dynamic / t - 1)).toBeGreaterThan(0.02); // electromagnetic dynamics matter for a 0.045 kg·m² rotor
  });
  it("opening the contactor: residual rotor flux decays with T0', energy closes through reconnection", () => {
    const { s, motor } = rig(5);
    for (let i = 0; i < 3 / DT; i++) s.step();
    toggle(s, motor.id, false);
    s.step();
    const psi0 = s.multiphysics.motors[motor.id].psiR!, t0 = s.time;
    for (let i = 0; i < 0.3 / DT; i++) s.step();
    const expected = openDecay(psi0, s.time - t0);
    s.multiphysics.motors[motor.id].psiR!.forEach((psi, k) => expect(Math.abs(cabs(psi) / expected[k] - 1)).toBeLessThan(1e-3));
    expect(s.multiphysics.switchingLoss).toBeGreaterThan(0);
    toggle(s, motor.id, true);
    for (let i = 0; i < 3 / DT; i++) s.step();
    expect(s.multiphysics.motors[motor.id].omega * 30 / Math.PI).toBeGreaterThan(1450);
    expect(Math.abs(s.energyResidual / s.suppliedEnergy)).toBeLessThan(1e-9);
  });
});

describe("catalog motors against IE3 datasheet data (400 V, 50 Hz, 4-pole)", () => {
  // Ranges from published IE3 data sheets of 132M (7.5 kW) and 225M (45 kW) motors: efficiency at 100/75/50 % load,
  // power factor, starting current, locked-rotor and breakdown torque (ABB M3KP, TEC, Universal UM3C, Baldor).
  const targets = {
    standard: { speed: [1455, 1470], eta: [[0.900, 0.910], [0.905, 0.915], [0.895, 0.915]], pf: [0.80, 0.85], isIn: [6.5, 9], tsTn: [2.0, 2.6], tmTn: [2.3, 3.5], i0: [0.3, 0.5] },
    im45: { speed: [1475, 1488], eta: [[0.939, 0.945], [0.942, 0.948], [0.938, 0.948]], pf: [0.82, 0.87], isIn: [7, 8.6], tsTn: [2.0, 3.5], tmTn: [2.3, 3.75], i0: [0.25, 0.45] },
  };
  for (const [variant, t] of Object.entries(targets)) it(`${variant}: efficiency, power factor, starting and breakdown torque fall in the datasheet ranges`, () => {
    const motor = new Builder().add("inductionMotor", {}, variant), mp = machineParams(motor, 50), b = Number(motor.props.friction);
    const tn = Number(motor.props.ratedPower) / (t.speed[0] * Math.PI / 30), inRated = Number(motor.props.ratedCurrent);
    const at = (omega: number) => {
      const circuit = steadyCircuit(mp, omega), split = circuit.split(v), z = circuit.impedance, d = z[0] ** 2 + z[1] ** 2;
      const current = Math.hypot(v[0] * z[0] / d, v[0] * z[1] / d), input = 3 * v[0] * v[0] * z[0] / d, shaft = (split.torque - b * omega) * omega;
      return { current, input, shaft, torque: split.torque, pf: input / (3 * v[0] * current) };
    };
    // Operating point for a shaft output: bisection on the stable branch near synchronous speed.
    const load = (power: number) => { let lo = 1300 * Math.PI / 30, hi = 157.0796; for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (at(mid).shaft > power) lo = mid; else hi = mid; } return { omega: lo, ...at(lo) }; };
    const within = (x: number, [low, high]: number[]) => { expect(x).toBeGreaterThanOrEqual(low); expect(x).toBeLessThanOrEqual(high); };
    const full = load(Number(motor.props.ratedPower));
    within(full.omega * 30 / Math.PI, t.speed);
    within(full.pf, t.pf);
    [1, 0.75, 0.5].forEach((share, k) => { const p = load(share * Number(motor.props.ratedPower)); within(p.shaft / p.input, t.eta[k]); });
    expect(Math.abs(full.current / inRated - 1)).toBeLessThan(0.03); // nameplate current
    within(at(0).current / inRated, t.isIn);
    within(at(0).torque / tn, t.tsTn);
    let breakdown = 0; for (let n = 0; n < 1500; n += 2) breakdown = Math.max(breakdown, at(n * Math.PI / 30).torque);
    within(breakdown / tn, t.tmTn);
    within(at(157.0796 * (1 - 1e-6)).current / inRated, t.i0);
  });
});

describe("project files written before the double cage", () => {
  it("load as the single-cage machine they describe, with iron loss added", async () => {
    const { parseProject, serializeProject } = await import("./projects");
    const b = new Builder(), src = b.add("source3"), motor = b.add("inductionMotor");
    b.series(src, motor);
    const file = JSON.parse(serializeProject(b.p));
    const old = file.components.find((x: { id: string }) => x.id === motor.id).props;
    delete old.rotorResistance2; delete old.rotorReactance2; delete old.coreResistance;
    const loaded = parseProject(file).components.find((x) => x.id === motor.id)!;
    expect(loaded.props.rotorResistance2).toBe(0);
    expect(machineParams(loaded, 50).cages).toHaveLength(1);
    expect(loaded.props.coreResistance).toBe(1160);
  });
});
