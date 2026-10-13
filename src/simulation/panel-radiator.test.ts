import { describe, it, expect } from 'vitest';
import { Builder } from './scaling-validation';
import { Simulation } from './engine';
import { Multiphysics } from './multiphysics';
import { solveHydraulic, pipeEnthalpy } from './hydraulic';
import { viscosityK } from './water';
import { catalog, type Component, type Project, type Property } from './model';
import { kermiHydraulics, kermiModels, panelCapacity, panelCellCapacity, PANEL_CELLS, tablePairs } from './panel-radiator';
import { starter } from './projects';

// References below are computed here from Kermi's published numbers and textbook formulas; they do not call
// the radiator transport (panel-radiator.ts helpers are only used for catalog data and capacities).
const CP = 4180;
const lmtd = (s: number, r: number, a: number) => (s - r) / Math.log((s - a) / (r - a));
/** Kermi Technik p. 24, therm-x2 Profil-K/-V type 22, height 600: W per metre at 16/18/20/22/24 °C air. */
const type22Table: Record<number, [number, number, number]> = { 16: [1506, 1007, 734], 18: [1422, 930, 662], 20: [1338, 854, 593], 22: [1255, 780, 525], 24: [1174, 707, 459] };

/** Radiator between two very large vented tanks: supply temperature fixed, flow set by the tank head. */
function tankRig(props: Record<string, Property> = {}, supply = 75, air = 20, variant = 'standard') {
  const b = new Builder(), common = { capacity: 300000, volume: 100000, surfaceArea: 100000, loss: 0, maxPressure: 1e7 };
  const hot = b.add('tank', { ...common, initialTemperature: supply }), cold = b.add('tank', { ...common, initialTemperature: air });
  const radiator = b.add('panelRadiator', { initialTemperature: air, ambient: air, ...props }, variant);
  b.wire(hot, 'fluid', radiator, 'inlet'); b.wire(radiator, 'outlet', cold, 'fluid');
  return { b, hot, cold, radiator };
}
/** Hot-tank elevation (bisection on the network solve at t = 0) that drives a target mass flow (kg/s). */
function tuneFlow(p: Project, hot: Component, radiator: Component, massFlow: number) {
  let lo = 0, hi = 5;
  for (let i = 0; i < 80; i++) {
    hot.props.elevation = (lo + hi) / 2;
    const m = new Multiphysics(); m.initialize(p);
    if (solveHydraulic(p, m.tanks).readings[radiator.id].flow * 1000 > massFlow) hi = (lo + hi) / 2; else lo = (lo + hi) / 2;
  }
}
function settle(s: Simulation, seconds = 5400) {
  s.advanceAdaptive(seconds);
  expect(s.error).toBeNull();
}
const reading = (s: Simulation, c: Component) => s.multiphysics.hydraulic.readings[c.id];

describe('Kermi therm-x2 catalog data', () => {
  it('reproduces the published tables from the registered output and exponent (data transcription check)', () => {
    for (const m of Object.values(kermiModels)) tablePairs.forEach(([s, r], i) => {
      const formula = m.output / m.length * 1000 * (lmtd(s, r, 20) / 49.83) ** m.exponent;
      expect(Math.abs(formula / m.table[i] - 1)).toBeLessThan(0.0015); // tables are rounded to 1 W
    });
    for (const [air, row] of Object.entries(type22Table)) tablePairs.forEach(([s, r], i) =>
      expect(Math.abs(1666 * (lmtd(s, r, +air) / 49.83) ** 1.293 / row[i] - 1)).toBeLessThan(0.0015));
  });
  it('catalog variants carry the Kermi data unchanged', () => {
    for (const [id, m] of Object.entries(kermiModels)) {
      const props = catalog({ kind: 'panelRadiator', variant: id, props: {} } as unknown as Component).props, h = kermiHydraulics[m.hydraulic];
      expect([props.ratedOutput, props.exponent, props.waterVolume, props.metalMass, props.lossCoefficient, props.laminarK]).toEqual([m.output, m.exponent, m.water, m.mass, h.lossCoefficient, h.laminarK]);
    }
  });
});

describe('EN 442 steady output against Kermi reference points', () => {
  it('matches the published outputs and return temperatures at their flows (type 22, 600 × 1000)', () => {
    const cases: [number, number, number, number][] = [[75, 65, 20, 1666], ...Object.entries(type22Table).flatMap(([air, row]) => tablePairs.map(([s, r], i) => [s, r, +air, row[i]] as [number, number, number, number]))];
    for (const [supply, ret, air, table] of cases.filter((_, i) => i % 2 === 0)) {
      const { b, hot, radiator } = tankRig({}, supply, air);
      tuneFlow(b.p, hot, radiator, table / (CP * (supply - ret)));
      const s = new Simulation(b.p); settle(s);
      const h = reading(s, radiator);
      expect(Math.abs(h.flow * 1000 * CP * (supply - ret) / table - 1)).toBeLessThan(2e-4);
      expect(Math.abs(h.duty! / table - 1)).toBeLessThan(0.002);
      expect(Math.abs(h.returnTemperature! - 273.15 - ret)).toBeLessThan(0.03);
      expect(Math.abs(s.energyResidual)).toBeLessThan(0.5);
    }
  });
  it('matches every catalog size at 55/45/20 °C', () => {
    for (const [id, m] of Object.entries(kermiModels)) {
      const table = m.table[1] * m.length / 1000, { b, hot, radiator } = tankRig({}, 55, 20, id);
      tuneFlow(b.p, hot, radiator, table / (CP * 10));
      const s = new Simulation(b.p); settle(s);
      expect(Math.abs(reading(s, radiator).duty! / table - 1), id).toBeLessThan(0.002);
      expect(Math.abs(reading(s, radiator).returnTemperature! - 273.15 - 45), id).toBeLessThan(0.03);
    }
  });
  it('follows the EN 442 characteristic from 2 % to 200 % of nominal flow (manufacturer conversion method)', () => {
    const nominal = 1666 / (CP * 10);
    for (const share of [0.02, 0.1, 0.5, 2]) {
      const { b, hot, radiator } = tankRig({}, 70, 20);
      tuneFlow(b.p, hot, radiator, share * nominal);
      const s = new Simulation(b.p); settle(s, share < 0.05 ? 24 * 3600 : 4 * 3600); // 2 %: storage time constant ≈ 3.3 h
      const h = reading(s, radiator), m = h.flow * 1000;
      // Independent bisection of ṁ·c·(T_s − T_r) = Φ₅₀·(ΔT_ln/ΔT₅₀)^n for the return temperature.
      let lo = 20, hi = 70;
      for (let i = 0; i < 200; i++) { const t = (lo + hi) / 2; if (m * CP * (70 - t) > 1666 * (lmtd(70, t, 20) / (10 / Math.log(55 / 45))) ** 1.293) lo = t; else hi = t; }
      expect(Math.abs(h.returnTemperature! - 273.15 - lo), `${share}`).toBeLessThan(0.02);
      expect(Math.abs(h.duty! / (m * CP * (70 - lo)) - 1), `${share}`).toBeLessThan(0.001);
      // Water input = output + storage rate, over one more step (near the air temperature the conductance
      // vanishes as ΔT^(n−1), so the last cells settle algebraically, not exponentially).
      const before = pipeEnthalpy(s.project, s.multiphysics.pipeCells);
      expect(s.step(30, true)).toBe(true);
      const after = reading(s, radiator), storage = (pipeEnthalpy(s.project, s.multiphysics.pipeCells) - before) / 30;
      // Hydraulic dissipation Δp·Q also heats the water.
      expect(Math.abs(after.heatInput! + after.differentialPressure * after.flow - after.duty! - storage) / after.duty!).toBeLessThan(1e-7);
      expect(Math.abs(storage / after.duty!)).toBeLessThan(1e-3);
    }
  });
});

describe('Hydraulic resistance', () => {
  it('follows the Kermi pressure-drop chart lines (Profil-K, same-side connection)', () => {
    for (const [variant, group] of [['standard', '12-33'], ['type11', '10/11']] as const) for (const kgh of [50, 100, 143, 300, 600]) {
      const { b, hot, radiator } = tankRig({}, 70, 20, variant);
      tuneFlow(b.p, hot, radiator, kgh / 3600);
      const m = new Multiphysics(); m.initialize(b.p);
      const dp = solveHydraulic(b.p, m.tanks).readings[radiator.id].differentialPressure;
      const chart = kermiHydraulics[group].chartPa100 * (kgh / 100) ** 1.987;
      expect(Math.abs(dp / chart - 1), `${variant} ${kgh} kg/h`).toBeLessThan(0.015);
    }
  });
  it('uses the two-K law with the inlet viscosity, symmetric in reverse flow', () => {
    const { b, hot, cold, radiator } = tankRig({}, 40, 20);
    hot.props.elevation = 0.05;
    const m = new Multiphysics(); m.initialize(b.p);
    const forward = solveHydraulic(b.p, m.tanks).readings[radiator.id], d = 0.016, area = Math.PI * d * d / 4, v = forward.flow / area;
    const re = 1000 * v * d / viscosityK(313.15);
    expect(forward.differentialPressure / ((1602 / re + 18.6) * 1000 * v * v / 2)).toBeCloseTo(1, 9);
    hot.props.elevation = 0; cold.props.elevation = 0.05; cold.props.initialTemperature = 40; hot.props.initialTemperature = 20;
    const m2 = new Multiphysics(); m2.initialize(b.p);
    const reverse = solveHydraulic(b.p, m2.tanks).readings[radiator.id];
    expect(reverse.flow / forward.flow).toBeCloseTo(-1, 9);
  });
});

describe('Finite water and steel inventory', () => {
  it('cools at zero flow along the analytic EN 442 solution', () => {
    // C·dθ/dt = −K_m·θⁿ  ⇒  θ(t) = (θ₀^(1−n) + (n − 1)·K_m·t/C)^(1/(1−n)); unconnected ports carry no flow.
    const b = new Builder(), radiator = b.add('panelRadiator', { initialTemperature: 70, ambient: 20 });
    const s = new Simulation(b.p), C = 6.08 * CP + 29.63 * 450, km = 1666 / (10 / Math.log(55 / 45)) ** 1.293, n = 1.293;
    const theta = (t: number) => (50 ** (1 - n) + (n - 1) * km * t / C) ** (1 / (1 - n));
    for (let i = 0; i < 1800 * 2; i++) expect(s.step(0.5, true)).toBe(true);
    const mean = s.fluidTemperatureMeasurement(radiator.id)! - 20;
    expect(Math.abs(mean - theta(1800))).toBeLessThan(0.02);
    expect(Math.abs(s.ambientEnergy - C * (50 - mean))).toBeLessThan(1e-6 * C * 50);
    expect(reading(s, radiator).duty).toBeCloseTo(km * mean ** n, 0);
    expect(Math.abs(s.energyResidual)).toBeLessThan(1e-6);
  });
  it('lumps the published water content and steel mass (heat capacity and inventory)', () => {
    const { b, radiator } = tankRig();
    expect(panelCapacity(radiator)).toBeCloseTo(6.08 * CP + 29.63 * 450, 9);
    const m = new Multiphysics(); m.initialize(b.p);
    expect(m.pipeCells[radiator.id]).toHaveLength(PANEL_CELLS);
    expect(pipeEnthalpy(b.p, m.pipeCells)).toBeCloseTo(panelCellCapacity(radiator) * PANEL_CELLS * 293.15, 3);
  });
  it('conserves energy through warm-up with an independent enthalpy reconstruction', () => {
    const { b, hot, radiator } = tankRig({}, 75, 20);
    tuneFlow(b.p, hot, radiator, 1666 / (CP * 10));
    const s = new Simulation(b.p), cells0 = pipeEnthalpy(s.project, s.multiphysics.pipeCells);
    let output = 0, input = 0;
    for (let i = 0; i < 6000; i++) {
      expect(s.step(0.1)).toBe(true);
      const h = reading(s, radiator); output += h.duty! * 0.1; input += h.heatInput! * 0.1;
      // No cell leaves the [air, supply] interval while heating (positive-coefficient implicit chain).
      for (const t of s.multiphysics.pipeCells[radiator.id]) { expect(t).toBeGreaterThanOrEqual(293.15 - 1e-9); expect(t).toBeLessThanOrEqual(348.15 + 1e-9); }
    }
    const stored = pipeEnthalpy(s.project, s.multiphysics.pipeCells) - cells0;
    expect(Math.abs(output - s.ambientEnergy) / output).toBeLessThan(1e-9); // all ambient heat is radiator output
    expect(Math.abs(input - output - stored) / input).toBeLessThan(2e-4); // only hydraulic dissipation (≈ mW) differs
    expect(Math.abs(s.energyResidual)).toBeLessThan(0.5);
    expect(Math.abs(s.multiphysics.massResidual)).toBeLessThan(1e-6);
  });
  it('converges at first order in the timestep during warm-up', () => {
    const outlet = (h: number) => {
      const { b, hot, radiator } = tankRig({}, 75, 20);
      tuneFlow(b.p, hot, radiator, 1666 / (CP * 10));
      const s = new Simulation(b.p);
      for (let i = 0; i < Math.round(240 / h); i++) expect(s.step(h, h > 0.1)).toBe(true);
      return s.multiphysics.pipeCells[radiator.id][PANEL_CELLS - 1];
    };
    const reference = outlet(0.05), errors = [8, 4, 2].map(h => Math.abs(outlet(h) - reference));
    expect(errors[0] / errors[1]).toBeGreaterThan(1.7); expect(errors[0] / errors[1]).toBeLessThan(2.4);
    expect(errors[1] / errors[2]).toBeGreaterThan(1.7); expect(errors[1] / errors[2]).toBeLessThan(2.4);
    expect(errors[2]).toBeLessThan(1);
  });
  it('stays bounded and conservative with 30 s steps and long adaptive advances', () => {
    const { b, hot, radiator } = tankRig({}, 75, 20);
    hot.props.elevation = 0.04;
    const s = new Simulation(b.p);
    for (let i = 0; i < 120; i++) expect(s.step(30, true)).toBe(true);
    for (const t of s.multiphysics.pipeCells[radiator.id]) { expect(Number.isFinite(t)).toBe(true); expect(t).toBeGreaterThan(293.15 - 1e-9); expect(t).toBeLessThan(348.15 + 1e-9); }
    expect(Math.abs(s.energyResidual)).toBeLessThan(0.5);
  });
  it('heats the same in reverse flow and reports supply and return by flow direction', () => {
    const forward = tankRig({}, 60, 20);
    forward.hot.props.elevation = 0.03;
    // Reverse: the hot tank feeds the outlet port.
    const b = new Builder(), common = { capacity: 300000, volume: 100000, surfaceArea: 100000, loss: 0, maxPressure: 1e7 };
    const hot = b.add('tank', { ...common, initialTemperature: 60, elevation: 0.03 }), cold = b.add('tank', { ...common, initialTemperature: 20 }), radiator = b.add('panelRadiator', { initialTemperature: 20 });
    b.wire(cold, 'fluid', radiator, 'inlet'); b.wire(radiator, 'outlet', hot, 'fluid');
    const sf = new Simulation(forward.b.p), sr = new Simulation(b.p); settle(sf); settle(sr);
    const f = reading(sf, forward.radiator), r = reading(sr, radiator);
    expect(r.flow).toBeLessThan(0);
    expect(r.flow / f.flow).toBeCloseTo(-1, 6);
    expect(r.duty! / f.duty!).toBeCloseTo(1, 5);
    expect(r.supplyTemperature! - 273.15).toBeCloseTo(60, 6);
    expect(r.returnTemperature!).toBeCloseTo(f.returnTemperature!, 4);
    expect(sr.multiphysics.pipeCells[radiator.id][0]).toBeCloseTo(f.returnTemperature!, 4); // return leaves at the inlet port
  });
});

describe('Bosch boiler, ALPHA2 circulator and Kermi radiator example', () => {
  it('warms up, follows a lower supply target, coasts down after shutdown and conserves energy and mass', () => {
    const s = new Simulation(starter('kermi')), find = (kind: string) => s.project.components.find(c => c.kind === kind)!;
    const radiator = find('panelRadiator'), boiler = find('electricBoiler');
    const edit = (id: string, props: Record<string, Property>) => expect(s.refresh({ ...s.project, components: s.project.components.map(c => c.id === id ? { ...c, props: { ...c.props, ...props } } : c) } as Project), s.error ?? '').toBe(true);
    const healthy = () => {
      expect(s.error).toBeNull(); expect(s.violations).toEqual([]); expect(s.multiphysics.boilers[boiler.id].fault).toBe('');
      expect(Math.abs(s.energyResidual)).toBeLessThan(Math.max(0.5, 0.005 * s.suppliedEnergy));
      expect(Math.abs(s.multiphysics.massResidual)).toBeLessThan(1e-6);
    };
    settle(s, 1200);
    const h = reading(s, radiator), hot = h.duty!;
    expect(h.flow * 3.6e6).toBeGreaterThan(130); expect(h.flow * 3.6e6).toBeLessThan(160); // lockshield preset near 143 kg/h
    expect(h.supplyTemperature! - 273.15).toBeGreaterThan(45);
    expect(h.returnTemperature!).toBeLessThan(h.supplyTemperature!);
    expect(hot).toBeGreaterThan(700);
    healthy();
    // The wired numeric target overrides the boiler's own setpoint property.
    edit(s.project.components.find(c => c.kind === 'constant')!.id, { value: 45 });
    settle(s, 1200);
    expect(reading(s, radiator).duty!).toBeLessThan(0.85 * hot);
    healthy();
    edit(boiler.id, { enabled: false });
    let previous = Infinity;
    for (let i = 0; i < 8; i++) {
      settle(s, 90);
      const mean = s.fluidTemperatureMeasurement(radiator.id)!;
      expect(mean).toBeLessThanOrEqual(previous + 1e-9); previous = mean;
      for (const t of s.multiphysics.pipeCells[radiator.id]) expect(t - 273.15).toBeGreaterThan(20 - 1e-9);
    }
    healthy();
  }, 120000);
});
