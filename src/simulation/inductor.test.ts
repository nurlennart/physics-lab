import { describe, it, expect } from 'vitest';
import { Builder } from './scaling-validation';
import { Simulation, DT } from './engine';
import { INDUCTOR_BREAKDOWN } from './electrical';
import type { Component, Project } from './model';

const run = (s: Simulation, seconds: number) => { for (let i = 0; i < Math.round(seconds / DT); i++) expect(s.step(), s.error ?? '').toBe(true); };
const parallel = (a: number, b: number) => a * b / (a + b);
const rel = (actual: number, expected: number) => Math.abs(actual / expected - 1);
const resistor = (resistance: number) => ({ resistance, tempCoefficient: 0, tolerance: 0, ratedPower: 1e6, heatCapacity: 100, loss: 0 });
const coil = (inductance: number, resistance = 0.1) => ({ inductance, resistance, tempCoefficient: 0, ratedCurrent: 100, heatCapacity: 100, loss: 0 });
const closes = (s: Simulation, scale: number) => expect(Math.abs(s.energyResidual)).toBeLessThan(1e-9 * scale);
const setSwitch = (s: Simulation, sw: Component, closed: boolean) => s.refresh({ ...s.project, components: s.project.components.map(c => c.id === sw.id ? { ...c, props: { ...c.props, closed } } : c) } as Project);

describe('DC inductor', () => {
  it('builds its current along the exact RL exponential and stores ½·L·I²', () => {
    const b = new Builder(), source = b.add('source', { voltage: 12 }), r = b.add('resistor', resistor(10)), l = b.add('inductor', coil(1));
    b.series(source, r, l);
    const s = new Simulation(b.p);
    // The winding sees its own resistance plus R ∥ R_breakdown, driven by the divided source voltage.
    const rth = parallel(10, INDUCTOR_BREAKDOWN), vth = 12 * INDUCTOR_BREAKDOWN / (10 + INDUCTOR_BREAKDOWN), tau = 1 / (rth + 0.1), final = vth / (rth + 0.1);
    for (const t of [0.05, 0.1, 0.5]) {
      run(s, t - s.time);
      expect(rel(s.devices.inductors[l.id], final * -Math.expm1(-s.time / tau))).toBeLessThan(1e-11);
    }
    expect(s.devices.storedChange).toBeCloseTo(0.5 * s.devices.inductors[l.id] ** 2, 12);
    closes(s, 10);
  });

  it('decays through a freewheeling resistor when the supply is switched off', () => {
    const b = new Builder(), source = b.add('source', { voltage: 12 }), sw = b.add('switch'), l = b.add('inductor', coil(1)), freewheel = b.add('resistor', resistor(100)), r = b.add('resistor', resistor(10));
    b.series(source, sw, r, l); b.wire(r, 'b', freewheel, 'a'); b.wire(freewheel, 'b', source, 'b');
    const s = new Simulation(b.p);
    run(s, 1);
    const before = s.devices.inductors[l.id];
    expect(setSwitch(s, sw, false)).toBe(true);
    const start = s.time, tau = 1 / (parallel(100, INDUCTOR_BREAKDOWN) + 0.1);
    run(s, 0.1);
    expect(rel(s.devices.inductors[l.id], before * Math.exp(-(s.time - start) / tau))).toBeLessThan(1e-10);
    expect(s.events.some(e => /interrupted/.test(e.message))).toBe(false);
    closes(s, 20);
  });

  it('dumps its energy into the switching arc when the current is interrupted without a path', () => {
    const b = new Builder(), source = b.add('source', { voltage: 12 }), sw = b.add('switch'), r = b.add('resistor', resistor(6)), l = b.add('inductor', coil(2));
    b.series(source, sw, r, l);
    const s = new Simulation(b.p);
    run(s, 3);
    const current = s.devices.inductors[l.id], energy = 0.5 * 2 * current ** 2;
    expect(current).toBeCloseTo(12 / 6.11, 3); // 6 Ω + 0.01 Ω switch + 0.1 Ω winding, after 9 τ
    expect(setSwitch(s, sw, false)).toBe(true);
    run(s, DT);
    // τ = L / R_breakdown = 2 µs: the current is gone within the step and its energy heats the inductor.
    expect(Math.abs(s.devices.inductors[l.id])).toBeLessThan(1e-9);
    expect(s.electrical.readings[l.id].heatPower! * DT).toBeCloseTo(energy, 6);
    expect(s.events.some(e => /interrupted with no current path/.test(e.message))).toBe(true);
    closes(s, 50);
  });

  it('rings in a series RLC circuit along the exact underdamped response', () => {
    const b = new Builder(), source = b.add('source', { voltage: 10 }), sw = b.add('switch'), r = b.add('resistor', resistor(1.89));
    const l = b.add('inductor', coil(0.1, 0.05)), cap = b.add('capacitor', { capacitance: 1e-3, resistance: 0.05, heatCapacity: 100 });
    b.series(source, sw, r, l, cap);
    const s = new Simulation(b.p);
    // R_total = 1.89 + 0.01 (switch) + 0.05 + 0.05 = 2 Ω: σ = R/2L = 10 s⁻¹, ω₀ = 1/√(LC) = 100 rad/s.
    const sigma = 10, wd = Math.sqrt(100 ** 2 - sigma ** 2);
    const v = (t: number) => 10 * (1 - Math.exp(-sigma * t) * (Math.cos(wd * t) + sigma / wd * Math.sin(wd * t)));
    let overshoot = 0;
    for (let i = 0; i < 30; i++) {
      run(s, DT);
      overshoot = Math.max(overshoot, s.devices.capacitors[cap.id]);
      // The breakdown path (1 MΩ across L) perturbs the ideal response by about ωL/R_b = 1e-5 of 10 V.
      expect(Math.abs(s.devices.capacitors[cap.id] - v(s.time))).toBeLessThan(3e-4);
    }
    expect(overshoot).toBeGreaterThan(17); // ≈ 1 + e^(−σπ/ω_d) = 1.73 × 10 V
    closes(s, 0.2);
  });
});

describe('within-step transients: heat placement, RMS and inrush', () => {
  it('splits a fast charging loss over the loop resistances in proportion to them', () => {
    // 100 µF onto 12 V through a 0.01 Ω switch and 0.05 Ω ESR (τ = 6 µs): ½·C·V² = 7.2 mJ, 1/6 in the switch.
    const b = new Builder(), source = b.add('source', { voltage: 12 }), sw = b.add('switch', { heatCapacity: 100, loss: 0 }), cap = b.add('capacitor', { heatCapacity: 100, loss: 0 });
    b.series(source, sw, cap);
    const s = new Simulation(b.p);
    run(s, DT);
    expect(s.componentEnergy[sw.id]).toBeCloseTo(7.2e-3 / 6, 8);
    expect(s.electrical.readings[sw.id].peakCurrent).toBeCloseTo(12 / 0.06, 6);
    // Step RMS current: √(∫i²/h) with i = 200 A·e^(−t/τ).
    const rms = 200 * Math.sqrt(6e-6 / (2 * DT));
    expect(s.electrical.readings[sw.id].current).toBeCloseTo(rms, 6);
    closes(s, 0.015);
  });

  it('heats a charging resistor by its exact ∫i²R within a step comparable to τ', () => {
    const tau = DT, b = new Builder(), source = b.add('source', { voltage: 10 }), r = b.add('resistor', resistor(100)), cap = b.add('capacitor', { capacitance: tau / 100, resistance: 1e-9, heatCapacity: 100 });
    b.series(source, r, cap);
    const s = new Simulation(b.p);
    run(s, DT);
    const exact = 10 ** 2 / 100 * tau / 2 * -Math.expm1(-2 * DT / tau);
    expect(rel(s.componentEnergy[r.id], exact)).toBeLessThan(1e-6);
  });

  it('trips a DC breaker magnetically on capacitor inrush, but not through a precharge resistor', () => {
    for (const precharge of [false, true]) {
      const b = new Builder(), source = b.add('source', { voltage: 48, maxCurrent: 1e4, maxPower: 1e9 }), breaker = b.add('breaker', { ratedCurrent: 10, magneticTrip: 10 }), cap = b.add('capacitor', { capacitance: 0.01, ratedVoltage: 63 });
      if (precharge) b.series(source, breaker, b.add('resistor', resistor(10)), cap); else b.series(source, breaker, cap);
      const s = new Simulation(b.p);
      run(s, 0.2);
      expect(s.breakers[breaker.id]?.tripped ?? false).toBe(!precharge);
      if (!precharge) expect(s.events.some(e => /magnetic trip/.test(e.message))).toBe(true);
    }
  });
});
