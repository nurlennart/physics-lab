import { describe, it, expect } from 'vitest';
import { Builder } from './scaling-validation';
import { Simulation, DT } from './engine';
import { circulatorHead, circulatorModelBasis, circulatorTarget, energyEfficiencyIndex, speedForHead, steadyInput, targetHead } from './circulator';
import { pumpCurve } from './hydraulic';
import { catalog, makeComponent, type Component, type Project, type Property } from './model';
import { WATER_CP } from './units';

const prop = (c: Component, key: string) => c.props[key] as number;
const run = (s: Simulation, seconds: number) => { for (let i = 0; i < Math.round(seconds / DT); i++) expect(s.step(), s.error ?? '').toBe(true); };
const head = (s: Simulation, c: Component) => -s.multiphysics.hydraulic.readings[c.id].differentialPressure / (1000 * 9.80665);
const edit = (s: Simulation, id: string, props: Record<string, Property>) =>
  expect(s.refresh({ ...s.project, components: s.project.components.map(c => c.id === id ? { ...c, props: { ...c.props, ...props } } : c) } as Project), s.error ?? '').toBe(true);

/** Closed heating-style loop with an open expansion tank: tank → circulator → supply pipe → valve → return pipe → tank. */
function loop(props: Record<string, Property> = {}, variant = 'standard', supply: 'ac' | 'dc' = 'ac') {
  const b = new Builder();
  const source = supply === 'ac' ? b.add('sourceAC', {}) : b.add('source', { voltage: 12, ratedVoltage: 30, maxCurrent: 20 });
  const pump = b.add('circulator', props, variant);
  const tank = b.add('tank', { capacity: 200, volume: 100, surfaceArea: 0.25, loss: 0 });
  const supplyPipe = b.add('pipe', { diameter: 0.02, length: 20 }), returnPipe = b.add('pipe', { diameter: 0.02, length: 20 }), valve = b.add('valve', { diameter: 0.02 });
  b.series(source, pump);
  b.wire(tank, 'fluid', pump, 'inlet'); b.wire(pump, 'outlet', supplyPipe, 'inlet'); b.wire(supplyPipe, 'outlet', valve, 'inlet'); b.wire(valve, 'outlet', returnPipe, 'inlet');
  b.wire(returnPipe, 'outlet', tank, 'fluid');
  return { b, source, pump, tank, valve };
}

describe('electric circulator: catalog calibration', () => {
  it('reproduces the reference datasheet figures it was fitted to (ALPHAx 25-60: 6 m, P1 3–34 W, EEI 0.17)', () => {
    const c = makeComponent('circulator', 0, 0);
    expect(circulatorHead(c, 471.24, 0)).toBeCloseTo(6, 6);
    const eei = energyEfficiencyIndex(c)!;
    // Input power on the maximum curve never exceeds P1,max; the lowest curve near zero flow draws about 3 W.
    expect(eei.loads[0].input).toBeCloseTo(34, 6);
    expect(steadyInput(c, 0.25 * 471.24, 0.3 / 3600)).toBeGreaterThan(2.5);
    expect(steadyInput(c, 0.25 * 471.24, 0.3 / 3600)).toBeLessThan(3.5);
    // The model's EEI is close to the declared specific EEI and inside the EU limit of 0.23 (since 2015).
    expect(eei.eei).toBeGreaterThan(0.15);
    expect(eei.eei).toBeLessThan(0.2);
  });
  it('computes the EEI by the regulation method, not as an efficiency', () => {
    const c = makeComponent('circulator', 0, 0), e = energyEfficiencyIndex(c)!;
    // Independent recomputation of P_ref, P_L,avg and EEI from the reported operating points.
    const pref = 1.7 * e.hydraulic + 17 * (1 - Math.exp(-0.3 * e.hydraulic));
    expect(e.reference).toBeCloseTo(pref, 9);
    const average = [0.06, 0.15, 0.35, 0.44].reduce((sum, w, i) => sum + w * e.loads[i].weighted, 0);
    expect(e.eei).toBeCloseTo(average / pref * 0.49, 9);
    // The reference control curve: H_ref = H100·(1 + x)/2 at x·Q100; P_L is scaled by H_ref/H only when the pump stays below it.
    e.loads.forEach((l, i) => {
      const x = [1, 0.75, 0.5, 0.25][i], href = e.h100 * (1 + x) / 2;
      expect(l.flow).toBeCloseTo(x * e.q100, 15);
      expect(l.head).toBeGreaterThanOrEqual(href - 1e-9);
      expect(l.weighted).toBeCloseTo(l.input, 9);
    });
    // A low EEI does not mean high efficiency at every point: the part-load wire-to-water efficiency is far below the best point's.
    const efficiency = (l: typeof e.loads[number]) => 1000 * 9.80665 * l.flow * l.head / l.input;
    expect(efficiency(e.loads[3])).toBeLessThan(0.7 * efficiency(e.loads[0]));
  });
  it('labels manufacturer data, curve basis and approximated control logic separately', () => {
    const c = makeComponent('circulator', 0, 0), basis = circulatorModelBasis(c);
    expect(basis.map(b => b.kind)).toEqual(['manufacturer', 'curve', 'control', 'assumed']);
    expect(basis[0].text).toContain('ALPHAx 25-60');
    expect(basis[1].text).toContain('Quadratic approximation');
    const measured = circulatorModelBasis({ ...c, props: { ...c.props, curvePoints: '0:6; 20:5; 40:3; 50:1' } });
    expect(measured[1].text).toContain('interpolated');
  });
  it('inverts the head curve and respects the input power limit', () => {
    const c = makeComponent('circulator', 0, 0), q = 15 / 60000;
    const omega = speedForHead(c, q, 2);
    expect(circulatorHead(c, omega, q)).toBeCloseTo(2, 9);
    // Proportional pressure: H_set/2 at zero flow, H_set at the reference flow.
    expect(targetHead(c, 0)).toBeCloseTo(2, 12);
    expect(targetHead(c, prop(c, 'ratedFlow'))).toBeCloseTo(4, 12);
    // Demanding more head than the maximum curve gives at most the power-limited speed.
    const high = { ...c, props: { ...c.props, mode: 'constantPressure', headSetpoint: 20 } };
    const target = circulatorTarget(high, 30 / 60000, null);
    expect(steadyInput(high, target, 30 / 60000)).toBeLessThanOrEqual(34 + 1e-9);
  });
});
describe('electric circulator: coupled operation', () => {
  it('soft-starts, circulates and closes the energy ledger on a 230 V AC supply', () => {
    const { b, pump } = loop();
    const s = new Simulation(b.p);
    expect(s.error).toBeNull();
    run(s, 0.5);
    // On the ramp: rated speed in rampTime (2 s).
    expect(s.multiphysics.circulators[pump.id].omega).toBeCloseTo(471.24 * 0.5 / 2, 6);
    run(s, 5.5);
    const r = s.electrical.readings[pump.id], h = s.multiphysics.hydraulic.readings[pump.id];
    expect(h.flow * 60000).toBeGreaterThan(15);
    expect(r.ac).toBe(true);
    expect(r.power).toBeLessThanOrEqual(34 + 1e-6);
    expect(r.current).toBeCloseTo(r.power / r.voltage, 6);
    // Motor loss = P1 − P_shaft at steady speed; overall efficiency below each part.
    expect(h.motorLoss!).toBeCloseTo(r.power - h.shaftPower, 3);
    expect(Math.abs(s.energyResidual)).toBeLessThan(1e-5);
    expect(s.violations).toEqual([]);
  });
  it('turns all electrical input into water enthalpy and rotor energy (wet rotor, no losses to ambient)', () => {
    const { b, pump, tank } = loop({ inertia: 0.002 });
    const s = new Simulation(b.p);
    const enthalpy = () => s.multiphysics.tanks[tank.id].mass * WATER_CP * s.multiphysics.tanks[tank.id].temperature
      // The wet rotor's own water (0.1 L at the reference density) holds part of the motor loss on its way into the loop.
      + s.multiphysics.pipeCells[pump.id][0] * 0.1 * WATER_CP
      + s.project.components.filter(c => c.kind === 'pipe').reduce((sum, c) => sum + s.multiphysics.pipeCells[c.id].reduce((x, T) => x + 1000 * Math.PI * 0.0001 * 20 / s.multiphysics.pipeCells[c.id].length * WATER_CP * T, 0), 0);
    const before = enthalpy();
    run(s, 10);
    const kinetic = 0.5 * 0.002 * s.multiphysics.circulators[pump.id].omega ** 2;
    expect(kinetic).toBeGreaterThan(100);
    // Pipe and tank UA are zero: every joule supplied is in the water (enthalpy, tank level) or the rotor.
    expect(s.ambientEnergy).toBeCloseTo(0, 9);
    const potential = s.multiphysics.potential(s.project) - s.multiphysics.initialPotential;
    expect((enthalpy() - before + kinetic + potential) / s.suppliedEnergy).toBeCloseTo(1, 6);
    expect(Math.abs(s.energyResidual)).toBeLessThan(1e-4);
  });
  it('holds the head in constant-pressure mode while a valve throttles the flow', () => {
    const { b, pump, valve } = loop({ mode: 'constantPressure', headSetpoint: 2.5 });
    const s = new Simulation(b.p);
    run(s, 6);
    const open = { head: head(s, pump), flow: s.multiphysics.hydraulic.readings[pump.id].flow, power: s.electrical.readings[pump.id].power };
    expect(open.head).toBeCloseTo(2.5, 3);
    edit(s, valve.id, { opening: 10 });
    run(s, 6);
    expect(head(s, pump)).toBeCloseTo(2.5, 3);
    expect(s.multiphysics.hydraulic.readings[pump.id].flow).toBeLessThan(0.6 * open.flow);
    expect(s.electrical.readings[pump.id].power).toBeLessThan(open.power);
  });
  it('follows the proportional-pressure line H_set·(1 + Q/Q_r)/2', () => {
    const { b, pump, valve } = loop({ headSetpoint: 2 });
    const s = new Simulation(b.p);
    for (const opening of [100, 30]) {
      edit(s, valve.id, { opening });
      run(s, 6);
      const q = s.multiphysics.hydraulic.readings[pump.id].flow;
      expect(head(s, pump)).toBeCloseTo(targetHead(s.project.components.find(c => c.id === pump.id)!, q), 3);
    }
  });
  it('runs at the constant-curve speed and follows a wired speed command', () => {
    const { b, pump } = loop({ mode: 'constantSpeed', speedSetting: 60 });
    let s = new Simulation(b.p);
    run(s, 4);
    expect(s.multiphysics.circulators[pump.id].omega).toBeCloseTo(0.6 * 471.24, 6);
    expect(s.mechanicalMeasurement(pump.id, 'rpm')).toBeCloseTo(0.6 * 4500, 1);
    const command = b.add('constant', { value: 40 });
    b.wire(command, 'out', pump, 'speed');
    s = new Simulation(b.p);
    run(s, 4);
    expect(s.multiphysics.circulators[pump.id].omega).toBeCloseTo(0.4 * 471.24, 6);
    // A command below 1 % stops the pump; the electronics keep drawing their standby power.
    edit(s, command.id, { value: 0 });
    run(s, 1);
    expect(s.multiphysics.circulators[pump.id].omega).toBe(0);
    expect(s.multiphysics.hydraulic.readings[pump.id].flow).toBeCloseTo(0, 12);
    expect(s.electrical.readings[pump.id].power).toBeCloseTo(2.2, 6);
    expect(Math.abs(s.energyResidual)).toBeLessThan(1e-5);
  });
  it('locks out on undervoltage and restarts after the supply recovers', () => {
    const { b, pump, source } = loop();
    // A weak supply: 230 V behind 2 kΩ cannot hold 180 V at the pump's input.
    source.props = { ...source.props, internalResistance: 2000 };
    const s = new Simulation(b.p);
    run(s, 1);
    expect(s.multiphysics.circulators[pump.id].lockedOut).toBe(true);
    expect(s.events.some(e => e.message.includes('undervoltage lockout'))).toBe(true);
    // Standstill: no flow, no input power (electronics off), and the ledger stays closed.
    run(s, 2);
    expect(s.electrical.readings[pump.id].power).toBeLessThan(10);
    edit(s, source.id, { internalResistance: 1 });
    run(s, 4);
    expect(s.multiphysics.circulators[pump.id].lockedOut).toBe(false);
    expect(s.multiphysics.hydraulic.readings[pump.id].flow).toBeGreaterThan(0);
    expect(s.events.some(e => e.message.includes('electronics restart'))).toBe(true);
    expect(Math.abs(s.energyResidual)).toBeLessThan(1e-5);
  });
  it('runs the 12 V DC variant at its power limit on a DC supply', () => {
    const { b, pump } = loop({}, 'dc12', 'dc');
    expect(catalog(pump).props.ratedVoltage).toBe(12);
    const s = new Simulation(b.p);
    run(s, 4);
    const r = s.electrical.readings[pump.id];
    expect(r.ac).toBeFalsy();
    expect(r.voltage).toBeCloseTo(12, 9);
    expect(r.power).toBeLessThanOrEqual(19 + 1e-6);
    expect(s.multiphysics.hydraulic.readings[pump.id].flow).toBeGreaterThan(0);
    expect(Math.abs(s.energyResidual)).toBeLessThan(1e-5);
  });
  it('reports overvoltage beyond +10 % and rejects a balanced three-phase island', () => {
    const { b, source } = loop();
    source.props = { ...source.props, voltage: 260 };
    const s = new Simulation(b.p);
    run(s, 0.1);
    expect(s.violations.some(v => v.includes('+ 10 % tolerance'))).toBe(true);
    const t = new Builder(), three = t.add('source3', {}), pump = t.add('circulator', {});
    t.series(three, pump);
    const s3 = new Simulation(t.p);
    s3.step();
    expect(s3.error ?? '').toContain('three-phase');
  });
  it('advances adaptively with the same steady state and a closed ledger', () => {
    const { b, pump } = loop({ mode: 'constantPressure', headSetpoint: 2.5 });
    const fixed = new Simulation(b.p), adaptive = new Simulation(b.p);
    run(fixed, 120);
    adaptive.advanceAdaptive(120);
    expect(adaptive.error).toBeNull();
    expect(adaptive.multiphysics.hydraulic.readings[pump.id].flow).toBeCloseTo(fixed.multiphysics.hydraulic.readings[pump.id].flow, 7);
    expect(Math.abs(adaptive.energyResidual)).toBeLessThan(1e-3);
  });
  it('uses the shared pump curve for its hydraulic readings', () => {
    const { b, pump } = loop({ mode: 'constantSpeed', speedSetting: 80 });
    const s = new Simulation(b.p);
    run(s, 4);
    const r = s.multiphysics.hydraulic.readings[pump.id], c = s.project.components.find(c => c.id === pump.id)!;
    const curve = pumpCurve(c, s.multiphysics.circulators[pump.id].omega, r.flow);
    expect(r.shaftPower).toBeCloseTo(curve.shaftPower, 6);
    expect(-r.differentialPressure).toBeCloseTo(curve.pressureRise, 6);
  });
});
