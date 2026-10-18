import { describe, it, expect } from 'vitest';
import { Builder } from './scaling-validation';
import { Simulation } from './engine';
import { Multiphysics } from './multiphysics';
import { solveHydraulic, pipeEnthalpy, frictionFactor } from './hydraulic';
import { viscosityK } from './water';
import { catalog, type Component, type Project, type Property } from './model';
import { transitionError } from './integrity';
import { parseProject, serializeProject } from './projects';
import { starter } from './projects';
import { makeEnvelope, makeThermalSpace, opaqueArea, thermalSpaceError } from './thermal-spaces';
import { FLOOR_CELLS, characteristic, floorWaterMass, floortec, limitFlux, screedCapacity, screedKey, surfaceTemperature, upwardResistance } from './underfloor-heating';

// References are computed here from the FLOORTEC tables, EN 1264 formulas and closed-form solutions; they do not call the
// transport (underfloor-heating.ts is only used for the characteristic under test, capacities and catalog data).
const CP = 4180;
const lmtd = (s: number, r: number, a: number) => (s - r) / Math.log((s - a) / (r - a));
const floorOf = (variant = 'standard', props: Record<string, Property> = {}) => {
  const c = { kind: 'underfloorHeating', variant, props: {} } as unknown as Component;
  c.props = { ...catalog(c).props, ...props };
  return c;
};

/** Loop between two very large vented tanks: supply temperature fixed, flow set by the tank head. */
function tankRig(props: Record<string, Property> = {}, supply = 45, air = 20) {
  const b = new Builder(), common = { capacity: 300000, volume: 100000, surfaceArea: 100000, loss: 0, maxPressure: 1e7 };
  const hot = b.add('tank', { ...common, initialTemperature: supply }), cold = b.add('tank', { ...common, initialTemperature: air });
  const floor = b.add('underfloorHeating', { initialTemperature: air, ambient: air, ...props });
  b.wire(hot, 'fluid', floor, 'inlet'); b.wire(floor, 'outlet', cold, 'fluid');
  return { b, hot, cold, floor };
}
function tuneFlow(p: Project, hot: Component, floor: Component, massFlow: number) {
  let lo = 0, hi = 5;
  for (let i = 0; i < 80; i++) {
    hot.props.elevation = (lo + hi) / 2;
    const m = new Multiphysics(); m.initialize(p);
    if (solveHydraulic(p, m.tanks).readings[floor.id].flow * 1000 > massFlow) hi = (lo + hi) / 2; else lo = (lo + hi) / 2;
  }
}
const reading = (s: Simulation, c: Component) => s.multiphysics.hydraulic.readings[c.id];

describe('EN 1264 characteristic', () => {
  it('reproduces the FLOORTEC 16 × 2 tables (4 coverings × 5 spacings) with the fitted system constant', () => {
    let worst = 0;
    floortec.flux.forEach((row, r) => row.forEach((q, j) => {
      const model = characteristic(floorOf('standard', { coveringResistance: [0, 0.05, 0.1, 0.15][r], pipeSpacing: floortec.spacings[j] })) * floortec.excess;
      worst = Math.max(worst, Math.abs(model / q - 1));
      expect(Math.abs(model - q), `R ${r} T ${floortec.spacings[j]}`).toBeLessThan(0.65); // tables rounded to 1 W/m²
    }));
    expect(worst).toBeLessThan(0.0085);
  });
  it('the catalog variants carry the FLOORTEC configuration', () => {
    for (const [variant, spacing, covering] of [['standard', 0.15, 0.1], ['spacing100', 0.1, 0.1], ['spacing200', 0.2, 0.1], ['tiles', 0.15, 0]] as const) {
      const c = floorOf(variant);
      expect([c.props.pipeSpacing, c.props.coveringResistance, c.props.outerDiameter, c.props.diameter, c.props.screedCover, c.props.roughness]).toEqual([spacing, covering, 0.016, 0.012, 0.045, 0.000007]);
      expect(c.props.length).toBeCloseTo(15 / spacing, 9);
      expect(floorWaterMass(c) / (c.props.length as number)).toBeCloseTo(floortec.water, 3); // 0.113 L/m (data sheet)
    }
  });
  it('upward resistance and the EN 1264 base curve', () => {
    expect(upwardResistance(floorOf())).toBeCloseTo(1 / 10.8 + 0.045 / 1.2 + 0.1, 12);
    expect(limitFlux(29, 20)).toBeCloseTo(8.92 * 9 ** 1.1, 9); // ≈ 100 W/m², the EN 1264 living-zone limit
    expect(Math.abs(limitFlux(29, 20) - 100)).toBeLessThan(1);
    expect(surfaceTemperature(8.92 * 6 ** 1.1, 20)).toBeCloseTo(26, 9);
  });
});

describe('Steady loop against EN 1264', () => {
  it('delivers q = K_H·Δθ_H up and q_u = R_o·q/R_u down, with the exact exponential return temperature', () => {
    for (const [variant, supply, kgh] of [['standard', 45, 80], ['spacing100', 35, 120], ['tiles', 40, 60]] as const) {
      const { b, hot, floor } = tankRig({}, supply, 20);
      const c = b.p.components.find(x => x.id === floor.id)!;
      Object.assign(c, { variant }); c.props = { ...catalog(c).props, initialTemperature: 20, ambient: 20, ambientMode: 'override' };
      tuneFlow(b.p, hot, c, kgh / 3600);
      const s = new Simulation(b.p);
      s.advanceAdaptive(72 * 3600);
      expect(s.error).toBeNull();
      const h = reading(s, c), m = h.flow * 1000, k = characteristic(c), ro = upwardResistance(c), ru = c.props.downwardResistance as number, area = c.props.heatedArea as number;
      // Uniform conductance G = K_H·(1 + R_o/R_u)·A from water to the room (space below at room temperature), with the
      // hydraulic dissipation P = Δp·Q spread uniformly along the loop: θ_out = P/G + (θ_in − P/G)·e^(−G/ṁc).
      const G = k * (1 + ro / ru) * area, P = h.differentialPressure * h.flow, ret = 20 + P / G + (supply - 20 - P / G) * Math.exp(-G / (m * CP));
      expect(Math.abs(h.returnTemperature! - 273.15 - ret), variant).toBeLessThan(2e-4);
      expect(Math.abs(h.duty! / ((m * CP * (supply - ret) + P) * ru / (ru + ro)) - 1), variant).toBeLessThan(2e-4);
      expect(Math.abs(h.duty! / (k * area * lmtd(supply, ret, 20)) - 1), variant).toBeLessThan(2e-3); // EN 1264 form, dissipation-free
      expect(Math.abs(h.downwardLoss! / (h.duty! * ro / ru) - 1), variant).toBeLessThan(2e-4);
      expect(Math.abs((h.heatInput! + h.differentialPressure * h.flow) / (h.duty! + h.downwardLoss!) - 1), variant).toBeLessThan(2e-4);
      expect(Math.abs(s.energyResidual)).toBeLessThan(0.05);
    }
  });
  it('heats the same in reverse flow', () => {
    const forward = tankRig({}, 40, 20);
    forward.hot.props.elevation = 0.3;
    const b = new Builder(), common = { capacity: 300000, volume: 100000, surfaceArea: 100000, loss: 0, maxPressure: 1e7 };
    const hot = b.add('tank', { ...common, initialTemperature: 40, elevation: 0.3 }), cold = b.add('tank', { ...common, initialTemperature: 20 }), floor = b.add('underfloorHeating', { initialTemperature: 20, ambient: 20 });
    b.wire(cold, 'fluid', floor, 'inlet'); b.wire(floor, 'outlet', hot, 'fluid');
    const sf = new Simulation(forward.b.p), sr = new Simulation(b.p);
    sf.advanceAdaptive(48 * 3600); sr.advanceAdaptive(48 * 3600);
    const f = reading(sf, forward.floor), r = reading(sr, floor);
    expect(r.flow).toBeLessThan(0);
    expect(r.flow / f.flow).toBeCloseTo(-1, 6);
    expect(r.duty! / f.duty!).toBeCloseTo(1, 5);
    expect(r.supplyTemperature! - 273.15).toBeCloseTo(40, 6);
  });
});

describe('Hydraulics', () => {
  it('splits the flow over identical loops, each a Darcy–Colebrook pipe of the derived length', () => {
    for (const loops of [1, 4]) {
      const { b, hot, floor } = tankRig({ loops, heatedArea: 15 * loops }, 40, 40);
      hot.props.elevation = 0.8;
      const m = new Multiphysics(); m.initialize(b.p);
      const h = solveHydraulic(b.p, m.tanks).readings[floor.id], d = 0.012, q = h.flow / loops, v = q / (Math.PI * d * d / 4);
      const mu = viscosityK(313.15), re = 1000 * v * d / mu;
      const dp = re <= 2300 ? 128 * mu * 100 * q / (Math.PI * d ** 4) : frictionFactor(re, 0.000007 / d) * 100 / d * 1000 * v * v / 2;
      expect(h.differentialPressure / dp, `${loops} loops`).toBeCloseTo(1, 6);
      expect(h.velocity).toBeCloseTo(v, 9);
    }
  });
});

describe('Finite water and screed', () => {
  it('cools at zero flow along the analytic two-node solution', () => {
    // Per cell: C_w·dθ_w/dt = −g_wp·(θ_w − θ_s), C_s·dθ_s/dt = g_wp·(θ_w − θ_s) − (g_up + g_dn)·θ_s, both cells start at θ₀.
    const b = new Builder(), floor = b.add('underfloorHeating', { initialTemperature: 40, ambient: 20 });
    const k = characteristic(floor), ro = upwardResistance(floor), ru = floor.props.downwardResistance as number, a = (floor.props.heatedArea as number) / FLOOR_CELLS;
    const gwp = k * (1 + ro / ru) / (1 - ro * k) * a, G = (1 / ro + 1 / ru) * a, cw = floorWaterMass(floor) / FLOOR_CELLS * CP, cs = screedCapacity(floor);
    const A = [[-gwp / cw, gwp / cw], [gwp / cs, -(gwp + G) / cs]], tr = A[0][0] + A[1][1], det = A[0][0] * A[1][1] - A[0][1] * A[1][0];
    const l1 = tr / 2 + Math.sqrt(tr * tr / 4 - det), l2 = tr / 2 - Math.sqrt(tr * tr / 4 - det);
    const theta = (t: number) => { // e^{At}·[20, 20] by Sylvester's formula
      const e1 = Math.exp(l1 * t), e2 = Math.exp(l2 * t), f = (i: number, j: number) => ((A[i][j] - (i === j ? l2 : 0)) * e1 - (A[i][j] - (i === j ? l1 : 0)) * e2) / (l1 - l2);
      return [20 * (f(0, 0) + f(0, 1)), 20 * (f(1, 0) + f(1, 1))];
    };
    const s = new Simulation(b.p), hours = 6;
    for (let i = 0; i < hours * 360; i++) expect(s.step(10, true)).toBe(true);
    const [water, screed] = theta(hours * 3600);
    expect(Math.abs(s.fluidTemperatureMeasurement(floor.id)! - 20 - water)).toBeLessThan(0.02);
    const plane = s.multiphysics.pipeCells[screedKey(floor.id)].reduce((x, t) => x + t, 0) / FLOOR_CELLS - 293.15;
    expect(Math.abs(plane - screed)).toBeLessThan(0.02);
    const released = FLOOR_CELLS * (cw * (20 - water) + cs * (20 - screed));
    expect(Math.abs(s.ambientEnergy - released) / released).toBeLessThan(2e-3);
    expect(Math.abs(s.energyResidual)).toBeLessThan(1e-3);
  });
  it('holds the water and screed inventory', () => {
    const { b, floor } = tankRig();
    const m = new Multiphysics(); m.initialize(b.p);
    expect(m.pipeCells[floor.id]).toHaveLength(FLOOR_CELLS);
    expect(m.pipeCells[screedKey(floor.id)]).toHaveLength(FLOOR_CELLS);
    expect(screedCapacity(floor) * FLOOR_CELLS).toBeCloseTo(15 * (0.045 + 0.016) * 2000 * 1000, 6);
    expect(pipeEnthalpy(b.p, m.pipeCells)).toBeCloseTo((floorWaterMass(floor) * CP + screedCapacity(floor) * FLOOR_CELLS) * 293.15, 0);
  });
  it('conserves energy through warm-up and stays between room and supply temperature', () => {
    const { b, hot, floor } = tankRig({}, 45, 20);
    tuneFlow(b.p, hot, floor, 80 / 3600);
    const s = new Simulation(b.p), cells0 = pipeEnthalpy(s.project, s.multiphysics.pipeCells);
    let up = 0, down = 0, input = 0;
    for (let i = 0; i < 1200; i++) {
      expect(s.step(3, true)).toBe(true);
      const h = reading(s, floor); up += h.duty! * 3; down += h.downwardLoss! * 3; input += (h.heatInput! + h.differentialPressure * h.flow) * 3;
      for (const t of [...s.multiphysics.pipeCells[floor.id], ...s.multiphysics.pipeCells[screedKey(floor.id)]]) { expect(t).toBeGreaterThanOrEqual(293.15 - 1e-9); expect(t).toBeLessThanOrEqual(318.15 + 1e-9); }
    }
    const stored = pipeEnthalpy(s.project, s.multiphysics.pipeCells) - cells0;
    expect(Math.abs(up + down - s.ambientEnergy) / (up + down)).toBeLessThan(1e-9);
    expect(Math.abs(input - up - down - stored) / input).toBeLessThan(1e-6);
    expect(Math.abs(s.energyResidual)).toBeLessThan(0.05);
    expect(stored / input).toBeGreaterThan(0.5); // the screed takes most of the first hour's heat
  });
  it('stays bounded at very low flow (weight capped for non-negative coefficients)', () => {
    const { b, hot, floor } = tankRig({}, 45, 20);
    tuneFlow(b.p, hot, floor, 0.5 / 3600);
    const s = new Simulation(b.p);
    for (let i = 0; i < 240; i++) expect(s.step(30, true)).toBe(true);
    for (const t of [...s.multiphysics.pipeCells[floor.id], ...s.multiphysics.pipeCells[screedKey(floor.id)]]) { expect(t).toBeGreaterThanOrEqual(293.15 - 1e-9); expect(t).toBeLessThanOrEqual(318.15 + 1e-9); }
    expect(Math.abs(s.energyResidual)).toBeLessThan(0.05);
  });
  it('converges at first order in the timestep during warm-up', () => {
    const outlet = (h: number) => {
      const { b, hot, floor } = tankRig({}, 45, 20);
      tuneFlow(b.p, hot, floor, 80 / 3600);
      const s = new Simulation(b.p);
      for (let i = 0; i < Math.round(240 / h); i++) expect(s.step(h, h > 0.1)).toBe(true);
      return s.multiphysics.pipeCells[floor.id][FLOOR_CELLS - 1];
    };
    const reference = outlet(0.05), errors = [8, 4, 2].map(h => Math.abs(outlet(h) - reference));
    expect(errors[0] / errors[1]).toBeGreaterThan(1.7); expect(errors[0] / errors[1]).toBeLessThan(2.4);
    expect(errors[1] / errors[2]).toBeGreaterThan(1.7); expect(errors[1] / errors[2]).toBeLessThan(2.4);
    expect(errors[2]).toBeLessThan(1);
  });
});

function roomRig() {
  const { b, hot, floor } = tankRig({}, 40, 20);
  hot.props.elevation = 0.5;
  const up = makeThermalSpace(0, 0, 5, 4), down = makeThermalSpace(0, 600, 5, 4);
  Object.assign(up, { name: 'Upper', initialTemperature: 18 }); Object.assign(down, { name: 'Lower', initialTemperature: 15 });
  const slab = { id: 'slab', name: 'Slab', kind: 'ceiling' as const, from: down.id, to: up.id, side: 'ceiling' as const, uValue: 1.5, heatCapacity: 0 };
  b.p = { ...b.p, version: 5, environment: { ambient: 0 }, thermalSpaces: [up, down],
    thermalElements: [...makeEnvelope(up).filter(e => e.side !== 'floor'), ...makeEnvelope(down).filter(e => e.side !== 'ceiling'), slab] };
  const c = b.p.components.find(x => x.id === floor.id)!;
  c.thermalSpaceId = up.id; c.props = { ...c.props, ambientMode: 'inherit' };
  return { b, floor: c, up, down, slab };
}

describe('Thermal Spaces', () => {
  it('heats its room, loses heat into the room below and replaces that area of the shared floor', () => {
    const { b, floor, up, down, slab } = roomRig();
    expect(thermalSpaceError(b.p)).toBeNull();
    expect(opaqueArea(b.p, slab)).toBeCloseTo(20 - 15, 12);
    const s = new Simulation(b.p);
    let upper = 0, lower = 0;
    for (let i = 0; i < 360; i++) {
      expect(s.step(30, true)).toBe(true);
      const h = reading(s, floor);
      upper += h.duty! * 30; lower += h.downwardLoss! * 30;
      expect(s.spaceReadings[up.id].deviceFlows[floor.id]).toBeCloseTo(h.duty!, 6);
      expect(s.spaceReadings[down.id].deviceFlows[floor.id]).toBeCloseTo(h.downwardLoss!, 6);
    }
    expect(upper).toBeGreaterThan(0); expect(lower).toBeGreaterThan(0);
    expect(Math.abs(s.energyResidual)).toBeLessThan(0.05);
  });
  it('rejects a heated area larger than the floor element or the room', () => {
    const { b, floor } = roomRig();
    floor.props.heatedArea = 25;
    expect(thermalSpaceError(b.p)).toMatch(/Underfloor heating covers more|more than the 20.0 m² floor/);
  });
  it('outside a room the ambient stands for room and the space below', () => {
    const { b, hot, floor } = tankRig({ ambient: 18 }, 40, 18);
    hot.props.elevation = 0.5;
    const s = new Simulation(b.p);
    let released = 0;
    for (let i = 0; i < 120; i++) { expect(s.step(30, true)).toBe(true); const h = reading(s, floor); released += (h.duty! + h.downwardLoss!) * 30; }
    expect(Math.abs(s.ambientEnergy - released) / released).toBeLessThan(1e-9);
    expect(Math.abs(s.energyResidual)).toBeLessThan(0.05);
  });
});

describe('Configuration and persistence', () => {
  it('rejects characteristics beyond the one-node screed model and out-of-domain values', () => {
    const { b, floor } = tankRig();
    const next = structuredClone(b.p), c = next.components.find(x => x.id === floor.id)!;
    Object.assign(c.props, { pipeSpacing: 0.05, coveringResistance: 0, screedCover: 0.015, outerDiameter: 0.03, wallThickness: 0.003, systemConstant: 9 });
    c.props.diameter = 0.024; c.props.length = 15 / 0.05;
    expect(transitionError(b.p, next, 0)).toMatch(/one-node screed model/);
    const wide = structuredClone(b.p); wide.components.find(x => x.id === floor.id)!.props.pipeSpacing = 0.5;
    expect(transitionError(b.p, wide, 0)).toMatch(/Pipe spacing/);
  });
  it('round-trips through a saved project with its room assignment', () => {
    const { b, floor, up } = roomRig();
    const loaded = parseProject(JSON.parse(JSON.stringify(b.p)));
    const c = loaded.components.find(x => x.id === floor.id)!;
    expect(c.thermalSpaceId).toBe(up.id);
    expect(c.props).toEqual(floor.props);
  });
  it('heats the heat-pump house through twelve loops under the whole floor', () => {
    const p = starter('heatPumpHouse'), c = p.components.find(x => x.kind === 'underfloorHeating')!, room = p.thermalSpaces![0];
    expect(c.thermalSpaceId).toBe(room.id);
    expect(c.props.length).toBeCloseTo(100, 9);
    expect(thermalSpaceError(p)).toBeNull();
    expect(opaqueArea(p, p.thermalElements!.find(e => e.kind === 'floor')!)).toBeCloseTo(0, 9);
    // Its floor probes (heat to the house, surface temperature) survive save and load.
    expect(serializeProject(parseProject(JSON.parse(serializeProject(p))))).toBe(serializeProject(p));
  });
});
