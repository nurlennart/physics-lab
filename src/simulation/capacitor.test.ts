import { describe, it, expect } from 'vitest';
import { Builder } from './scaling-validation';
import { Simulation, DT } from './engine';
import { CAPACITOR_LEAKAGE } from './electrical';
import type { Component, Project } from './model';

const run = (s: Simulation, seconds: number) => { for (let i = 0; i < Math.round(seconds / DT); i++) expect(s.step(), s.error ?? '').toBe(true); };
const parallel = (a: number, b: number) => a * b / (a + b);
const rel = (actual: number, expected: number) => Math.abs(actual / expected - 1);
const resistor = (resistance: number) => ({ resistance, tempCoefficient: 0, tolerance: 0, ratedPower: 1e6, heatCapacity: 100, loss: 0 });
// Ledger closure to rounding: temperatures near 20 °C resolve stored heat to about 1e-15 relative per step.
const closes = (s: Simulation, scale: number) => expect(Math.abs(s.energyResidual)).toBeLessThan(1e-9 * scale);

describe('DC capacitor', () => {
  it('charges through a resistor along the exact exponential at the fixed step', () => {
    const b = new Builder(), source = b.add('source', { voltage: 12 }), r = b.add('resistor', resistor(1000));
    const cap = b.add('capacitor', { capacitance: 1e-3, heatCapacity: 100, loss: 0 });
    b.series(source, r, cap);
    const s = new Simulation(b.p);
    // The dielectric sees its ESR plus R ∥ R_leak, driven by the divided source voltage.
    const vth = 12 * CAPACITOR_LEAKAGE / (1000 + CAPACITOR_LEAKAGE), tau = 1e-3 * (0.05 + parallel(1000, CAPACITOR_LEAKAGE));
    for (const t of [0.5, 1, 3]) {
      run(s, t - s.time);
      expect(rel(s.devices.capacitors[cap.id], vth * -Math.expm1(-s.time / tau))).toBeLessThan(1e-11);
    }
    // Step-average current equals the charge moved in the step, C·Δv/h (plus leakage).
    const before = s.devices.capacitors[cap.id];
    run(s, DT);
    expect(rel(s.electrical.readings[cap.id].chargeCurrent!, 1e-3 * (s.devices.capacitors[cap.id] - before) / DT)).toBeLessThan(1e-9);
    expect(rel(s.electrical.readings[r.id].current, s.electrical.readings[cap.id].current)).toBeLessThan(1e-9);
    closes(s, 0.1);
  });

  it('charges and discharges with the textbook energy split: ½·C·V² stored, ½·C·V² lost in the loop', () => {
    const b = new Builder(), source = b.add('source', { voltage: 100, ratedVoltage: 100 }), r = b.add('resistor', resistor(10));
    const cap = b.add('capacitor', { capacitance: 0.01, heatCapacity: 100, loss: 0 });
    b.series(source, r, cap);
    const s = new Simulation(b.p);
    run(s, 2); // 20 τ
    const v = s.devices.capacitors[cap.id], stored = 0.5 * 0.01 * v * v;
    expect(v).toBeCloseTo(100 * CAPACITOR_LEAKAGE / (CAPACITOR_LEAKAGE + 10), 6);
    expect(s.devices.storedChange).toBeCloseTo(stored, 9);
    expect(s.suppliedEnergy).toBeCloseTo(0.01 * v * 100, 4); // Q·V
    expect(s.suppliedEnergy - stored).toBeCloseTo(stored, 3);
    closes(s, 100);
  });

  it('settles a transient far shorter than the step in one step without ringing', () => {
    // 100 µF directly on a 12 V supply through a switch: τ = C·(ESR + switch) = 6 µs, h = 16.7 ms.
    const b = new Builder(), source = b.add('source', { voltage: 12 }), sw = b.add('switch'), cap = b.add('capacitor');
    b.series(source, sw, cap);
    const s = new Simulation(b.p), seen: number[] = [];
    for (let i = 0; i < 10; i++) { run(s, DT); seen.push(s.devices.capacitors[cap.id]); }
    const final = 12 * CAPACITOR_LEAKAGE / (CAPACITOR_LEAKAGE + 0.01);
    for (const v of seen) expect(Math.abs(v - final)).toBeLessThan(1e-9);
    // Charge 1.2 mC and the loss ½·C·V² = 7.2 mJ, regardless of the loop resistance (plus 24 nJ of leakage).
    const leakage = 144 / CAPACITOR_LEAKAGE * s.time;
    expect(s.suppliedEnergy - leakage).toBeCloseTo(1e-4 * 144, 9);
    expect(s.suppliedEnergy - leakage - s.devices.storedChange).toBeCloseTo(0.5e-4 * 144, 9);
    closes(s, 0.01);
  });

  it('discharges a precharged capacitor into a resistor without any source', () => {
    const b = new Builder(), cap = b.add('capacitor', { capacitance: 0.01, chargeVoltage: 10, heatCapacity: 100, loss: 0 }), r = b.add('resistor', resistor(100));
    b.series(cap, r);
    const s = new Simulation(b.p);
    expect(s.electrical.readings[r.id].current).toBeGreaterThan(0.09);
    const tau = 0.01 * (0.05 + parallel(100, CAPACITOR_LEAKAGE));
    run(s, 3);
    expect(rel(s.devices.capacitors[cap.id], 10 * Math.exp(-s.time / tau))).toBeLessThan(1e-11);
    expect(s.suppliedEnergy).toBe(0);
    expect(Math.abs(s.storedEnergy)).toBeLessThan(1e-9 * 0.5); // Field energy became heat in the resistor and ESR.
    closes(s, 0.5);
  });

  it('charges linearly from a current-limited supply, then regulates at its voltage', () => {
    const b = new Builder(), supply = b.add('source', { mode: 'cvcc', voltage: 30, maxCurrent: 1 }), cap = b.add('capacitor', { capacitance: 0.1, heatCapacity: 100 });
    b.series(supply, cap);
    const s = new Simulation(b.p);
    run(s, 1);
    expect(s.electrical.readings[supply.id].regulation).toBe('cc');
    expect(s.devices.capacitors[cap.id]).toBeCloseTo(10, 6); // I·t/C
    run(s, 4);
    expect(s.electrical.readings[supply.id].regulation).toBe('cv');
    expect(s.devices.capacitors[cap.id]).toBeCloseTo(30, 6);
    closes(s, 90);
  });

  it('shares charge between two capacitors: conserved charge, half the energy lost, no ringing', () => {
    const b = new Builder(), full = b.add('capacitor', { capacitance: 1e-3, chargeVoltage: 10 }), link = b.add('resistor', resistor(1)), empty = b.add('capacitor', { capacitance: 1e-3 });
    b.series(full, link, empty);
    const s = new Simulation(b.p), difference: number[] = [];
    for (let i = 0; i < 6; i++) { run(s, DT); difference.push(s.devices.capacitors[full.id] - s.devices.capacitors[empty.id]); }
    // The exchange (τ = 0.55 ms) is far shorter than the step: the difference collapses and never changes sign.
    for (const d of difference) expect(d).toBeGreaterThanOrEqual(-1e-12);
    expect(difference[0]).toBeLessThan(0.5);
    expect(difference[5]).toBeLessThan(1e-6);
    const charge = 1e-3 * (s.devices.capacitors[full.id] + s.devices.capacitors[empty.id]);
    expect(charge).toBeCloseTo(1e-2, 8); // leakage over 0.1 s removes ~1e-12 C
    expect(s.devices.storedChange).toBeCloseTo(-0.025, 6); // ½·C·10² → 2 × ½·C·5²
    closes(s, 0.05);
  });

  it('self-discharges through its insulation leakage when isolated', () => {
    const b = new Builder(), cap = b.add('capacitor', { capacitance: 1e-4, chargeVoltage: 100 });
    const s = new Simulation(b.p);
    expect(s.adaptiveUnavailable()).toBeNull();
    s.advanceAdaptive(3600);
    const tau = 1e-4 * (0.05 + CAPACITOR_LEAKAGE);
    expect(rel(s.devices.capacitors[cap.id], 100 * Math.exp(-s.time / tau))).toBeLessThan(1e-9);
  });

  it('previews the next step while paused and restores its charge voltage on reset', () => {
    const b = new Builder(), source = b.add('source', { voltage: 12 }), r = b.add('resistor', resistor(1000)), cap = b.add('capacitor', { capacitance: 1e-3, chargeVoltage: 2 });
    b.series(source, r, cap);
    const s = new Simulation(b.p), preview = s.electrical.readings[cap.id].chargeCurrent!;
    expect(s.refresh(s.project)).toBe(true);
    expect(s.devices.capacitors[cap.id]).toBe(2); // a paused solve never moves charge
    run(s, DT);
    expect(s.electrical.readings[cap.id].chargeCurrent).toBeCloseTo(preview, 15);
    s.reset();
    expect(s.devices.capacitors[cap.id]).toBe(2);
  });

  it('keeps capacitance Reset-only (it defines stored energy) and the AC phasor model unchanged', () => {
    const b = new Builder(), source = b.add('source', { voltage: 12 }), r = b.add('resistor', resistor(1000)), cap = b.add('capacitor');
    b.series(source, r, cap);
    const s = new Simulation(b.p);
    run(s, 0.1);
    const edited: Project = { ...s.project, components: s.project.components.map((c: Component) => c.id === cap.id ? { ...c, props: { ...c.props, capacitance: 2e-4 } } : c) };
    expect(s.refresh(edited)).toBe(false);
    expect(s.error).toMatch(/reset/i);

    const ac = new Builder(), mains = ac.add('sourceAC', { voltage: 230, frequency: 50 }), c = ac.add('capacitor', { capacitance: 1e-4, chargeVoltage: 50 });
    ac.series(mains, c);
    const t = new Simulation(ac.p);
    const z = Math.hypot(0.05, 1 / (2 * Math.PI * 50 * 1e-4));
    expect(t.electrical.readings[c.id].current).toBeCloseTo(230 / z, 9);
    run(t, 0.1);
    expect(t.devices.capacitors[c.id]).toBe(50); // the phasor solution holds the DC charge
  });
});
