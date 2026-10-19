import { describe, it, expect } from 'vitest';
import { Builder } from './scaling-validation';
import { Simulation } from './engine';
import { Multiphysics } from './multiphysics';
import { solveHydraulic, frictionFactor } from './hydraulic';
import { viscosityK } from './water';
import { componentPorts, type Component, type Project, type Property } from './model';
import { transitionError } from './integrity';
import { parseProject, serializeProject, starter } from './projects';
import { balance, circuitKey, meterReading, multidisSF } from './heating-manifold';

// References are computed here from the Kv definition (Q in m³/h at 1 bar) and the Darcy–Weisbach pipe law; they do not
// call the manifold code.
const RHO = 1000;
const pipeDrop = (q: number, length: number, d: number, roughness: number, t = 20) => {
  const area = Math.PI * d * d / 4, v = q / area, re = RHO * Math.abs(v) * d / viscosityK(t + 273.15);
  return frictionFactor(re, roughness / d) * length / d * RHO * v * Math.abs(v) / 2;
};
const kvDrop = (q: number, kv: number) => 1e5 * (q * 3600 / kv) ** 2;
/** Independent circuit flow at a bar-to-bar differential pressure H: bisection on insert + loop drop. */
const circuitFlow = (h: number, kv: number, length: number, d: number, roughness: number) => {
  let lo = 0, hi = 1e-3;
  for (let i = 0; i < 200; i++) { const q = (lo + hi) / 2; if (kvDrop(q, kv) + pipeDrop(q, length, d, roughness) > h) hi = q; else lo = q; }
  return (lo + hi) / 2;
};

/** Constant-head rig: a large elevated tank feeds the manifold through a short wide pipe; the loops are plain pipes. */
function rig(loops: number[], manifold: Record<string, Property> = {}, head = 1.5) {
  const b = new Builder(), common = { capacity: 300000, volume: 100000, surfaceArea: 100000, loss: 0, maxPressure: 1e7, initialTemperature: 20 };
  const hot = b.add('tank', { ...common, elevation: head }), cold = b.add('tank', common);
  const feed = b.add('pipe', { length: 0.5, diameter: 0.05, inventory: false }), drain = b.add('pipe', { length: 0.5, diameter: 0.05, inventory: false });
  const m = b.add('heatingManifold', { circuits: Math.max(2, loops.length), ...manifold });
  b.wire(hot, 'fluid', feed, 'inlet'); b.wire(feed, 'outlet', m, 'supply'); b.wire(m, 'return', drain, 'inlet'); b.wire(drain, 'outlet', cold, 'fluid');
  const pipes = loops.map((length, i) => {
    const p = b.add('pipe', { length, diameter: 0.012, roughness: 7e-6, inventory: false });
    b.wire(m, `flow${i + 1}`, p, 'inlet'); b.wire(p, 'outlet', m, `return${i + 1}`);
    return p;
  });
  return { b, m, pipes };
}
/** Fixed Boolean command: a numeric constant through a comparator (constant < 80 → true). */
function command(b: Builder, open: boolean) {
  const k = b.add('constant', { value: open ? 0 : 100 }), cmp = b.add('comparator', { reference: 80, mode: 'lt' });
  b.wire(k, 'out', cmp, 'in');
  return cmp;
}
const solve = (p: Project, positions: Record<string, number> = {}) => { const mp = new Multiphysics(); mp.initialize(p); return solveHydraulic(p, mp.tanks, {}, { ...mp.positions, ...positions }); };

describe('Multidis SF hydraulics', () => {
  it('splits the flow over circuits by insert Kv and loop resistance', () => {
    const { b, m, pipes } = rig([60, 90, 120], { setting1: 40, setting2: 70, setting3: 100 });
    const r = solve(b.p), h = r.readings[m.id].differentialPressure;
    expect(h).toBeGreaterThan(1000);
    const kv = [0.4, 0.7, 1.0].map(f => f * multidisSF.kvs);
    let total = 0;
    pipes.forEach((p, i) => {
      const q = r.readings[circuitKey(m.id, i + 1)].flow, expected = circuitFlow(h, kv[i], p.props.length as number, 0.012, 7e-6);
      expect(Math.abs(q / expected - 1), `circuit ${i + 1}`).toBeLessThan(1e-4);
      expect(r.readings[circuitKey(m.id, i + 1)].differentialPressure).toBeCloseTo(kvDrop(q, kv[i]), 3);
      total += q;
    });
    expect(r.readings[m.id].flow).toBeCloseTo(total, 15);
    expect(r.readings[pipes[0].id].flow + r.readings[pipes[1].id].flow + r.readings[pipes[2].id].flow).toBeCloseTo(total, 15);
  });
  it('isolates a closed insert exactly and plugs unconnected circuits', () => {
    const { b, m } = rig([80, 80], { setting2: 0 });
    const r = solve(b.p);
    expect(r.readings[circuitKey(m.id, 1)].flow).toBeGreaterThan(0);
    expect(r.readings[circuitKey(m.id, 2)].flow).toBe(0);
    expect(r.branches.filter(x => x.component === m.id)).toHaveLength(2); // circuits 3–4 fitted but not connected: no branch
    expect(r.readings[m.id].flow).toBeCloseTo(r.readings[circuitKey(m.id, 1)].flow, 15);
  });
  it('a half-stroked actuator halves the circuit Kv (linear, as documented)', () => {
    const { b, m, pipes } = rig([80, 80]);
    const r = solve(b.p, { [circuitKey(m.id, 2)]: 50 }), h = r.readings[m.id].differentialPressure;
    expect(r.readings[circuitKey(m.id, 2)].flow / circuitFlow(h, 0.55, pipes[1].props.length as number, 0.012, 7e-6) - 1).toBeLessThan(1e-4);
  });
});

describe('Thermal actuators', () => {
  it('close over the stroke time on a false command, reopen on true, and stay open unwired', () => {
    const { b, m } = rig([80, 80, 80], { actuatorTime: 180 });
    b.wire(command(b, false), 'out', m, 'act1'); b.wire(command(b, true), 'out', m, 'act2');
    const s = new Simulation(b.p);
    expect(s.error).toBeNull();
    s.advanceAdaptive(90);
    expect(s.multiphysics.positions[circuitKey(m.id, 1)]).toBeCloseTo(50, 6);
    expect(s.multiphysics.positions[circuitKey(m.id, 2)]).toBe(100);
    expect(s.multiphysics.positions[circuitKey(m.id, 3)]).toBe(100);
    s.advanceAdaptive(120);
    expect(s.multiphysics.positions[circuitKey(m.id, 1)]).toBe(0);
    expect(s.multiphysics.hydraulic.readings[circuitKey(m.id, 1)].flow).toBe(0);
    expect(s.multiphysics.hydraulic.readings[circuitKey(m.id, 3)].flow).toBeGreaterThan(0);
    expect(s.multiphysics.massResidual).toBe(0);
  });
  it('close on a lost signal (normally closed)', () => {
    const { b, m } = rig([80, 80]);
    b.wire(command(b, true), 'out', m, 'act1');
    const wire = b.p.connections.at(-1)!.id;
    const s = new Simulation(b.p);
    s.advanceAdaptive(30);
    expect(s.multiphysics.positions[circuitKey(m.id, 1)]).toBe(100);
    s.disconnected.add(wire);
    s.advanceAdaptive(200);
    expect(s.multiphysics.positions[circuitKey(m.id, 1)]).toBe(0);
  });
});

describe('Balancing', () => {
  it('reaches the planned flows in a few commissioning rounds', () => {
    const planned = [1.2, 1.8, 2.0]; // circuit 3 (120 m) reaches 2.1 l/min fully open at this head
    const { b, m } = rig([50, 90, 120], Object.fromEntries(planned.map((q, i) => [`planned${i + 1}`, q])), 2);
    let worst = Infinity;
    for (let round = 0; round < 4; round++) {
      const r = solve(b.p), flows = Object.fromEntries([1, 2, 3].map(k => [k, r.readings[circuitKey(m.id, k)].flow]));
      worst = Math.max(...planned.map((q, i) => Math.abs(flows[i + 1] * 60000 / q - 1)));
      for (const c of balance(m, flows, {}, r.readings[m.id].differentialPressure)) m.props[`setting${c.circuit}`] = c.next;
    }
    expect(worst).toBeLessThan(0.01);
    // The longest loop (index circuit) stays most open.
    expect(m.props.setting3).toBeGreaterThan(m.props.setting1 as number);
  });
  it('reports a planned flow the insert cannot reach fully open', () => {
    const { b, m } = rig([120, 120], { planned1: 1.5, planned2: 30 }, 2);
    const r = solve(b.p), flows = { 1: r.readings[circuitKey(m.id, 1)].flow, 2: r.readings[circuitKey(m.id, 2)].flow };
    const out = balance(m, flows, {}, r.readings[m.id].differentialPressure);
    expect(out[1]).toMatchObject({ reachable: false, next: 100 });
    expect(out[0].reachable).toBe(true);
  });
});

describe('Meters, ports and persistence', () => {
  it('flow meters read l/min and peg at their range', () => {
    expect(meterReading(2 / 60000, 5)).toEqual({ value: 2, beyond: false });
    expect(meterReading(7 / 60000, 5)).toEqual({ value: 5, beyond: true });
  });
  it('fits only its configured circuits; reducing them with loops attached is refused', () => {
    const { b, m } = rig([80, 80, 80]);
    expect(componentPorts(m).filter(p => p.domain === 'hydraulic')).toHaveLength(2 + 2 * 3);
    const next = structuredClone(b.p); next.components.find(c => c.id === m.id)!.props.circuits = 2;
    expect(transitionError(b.p, next, 0)).toMatch(/circuit/i);
    const json = JSON.parse(serializeProject(b.p)) as Project;
    json.connections.push({ id: 'bad', domain: 'hydraulic', from: { component: m.id, port: 'flow7' }, to: { component: (b.p.components.at(-1) as Component).id, port: 'inlet' } });
    expect(() => parseProject(json)).toThrow();
    expect(parseProject(JSON.parse(serializeProject(b.p))).components.find(c => c.id === m.id)!.props).toEqual(m.props);
  });
  it('conserves energy carrying warm water through heat-losing loops', () => {
    const { b, pipes } = rig([60, 90]);
    b.p.components.forEach(c => { if (c.kind === 'tank' && (c.props.elevation as number) > 0) c.props.initialTemperature = 45; });
    pipes.forEach(p => Object.assign(p.props, { inventory: true, thermalUA: 5, ambient: 20 }));
    const s = new Simulation(b.p);
    s.advanceAdaptive(1800);
    expect(s.error).toBeNull();
    expect(Math.abs(s.energyResidual)).toBeLessThan(0.05);
    expect(Math.abs(s.multiphysics.massResidual)).toBeLessThan(1e-6); // the engine's 1 mg criterion (1e8 kg test tanks)
  });
});

describe('Three-room example', () => {
  it('starts unbalanced and balances to the planned flows in three running rounds', () => {
    const s = new Simulation(starter('manifoldRooms')), id = s.project.components.find(c => c.kind === 'heatingManifold')!.id;
    const flows = () => { const r = s.multiphysics.hydraulic.readings; return Object.fromEntries([1, 2, 3].map(k => [k, r[circuitKey(id, k)].flow])); };
    s.advanceAdaptive(60);
    expect(s.error).toBeNull();
    const before = flows();
    expect(before[3]).toBeGreaterThan(before[1]); // the short bathroom loop takes the most water
    for (let round = 0; round < 3; round++) {
      const m = s.project.components.find(c => c.id === id)!, r = s.multiphysics.hydraulic.readings;
      const next = structuredClone(s.project), mc = next.components.find(c => c.id === id)!;
      for (const b of balance(m, flows(), {}, r[id].differentialPressure)) mc.props[`setting${b.circuit}`] = b.next;
      s.refresh(next); s.advanceAdaptive(30);
    }
    const after = flows();
    [1.8, 1.3, 0.7].forEach((q, i) => expect(Math.abs(after[i + 1] * 60000 / q - 1), `circuit ${i + 1}`).toBeLessThan(0.01));
    expect(s.violations).toEqual([]);
  });
});
