import { describe, expect, it } from 'vitest';
import { Builder } from './scaling-validation';
import { solveElectrical } from './electrical';
import { Simulation } from './engine';

describe('independent electrical audit regressions', () => {
  it('DC capacitor leakage obeys KCL, dissipates V²/R and heats only from leakage', () => {
    const b = new Builder(), source = b.add('source', { voltage: 24 });
    const cap = b.add('capacitor'), load = b.add('resistor', { resistance: 10 });
    b.series(source, cap, load);
    const s = new Simulation(b.p), expected = 24 / (1e9 + 10);
    expect(s.error).toBeNull();
    expect(s.electrical.readings[cap.id].current).toBeCloseTo(expected, 15);
    expect(s.electrical.readings[cap.id].power).toBeCloseTo(expected ** 2 * 1e9, 12);
    expect(s.electrical.readings[source.id].current).toBeCloseTo(-expected, 15);
    expect(s.electrical.powerResidual).toBeCloseTo(0, 12);
    expect(s.step()).toBe(true);
    expect(s.energyResidual).toBeCloseTo(0, 9);
    expect(s.failed[cap.id]).toBeFalsy();
  });

  for (const energized of [false, true]) it(`AC relay ${energized ? 'NO' : 'NC'} contact uses its conducting voltage for real power`, () => {
    const b = new Builder(), source = b.add('sourceAC', { voltage: 24 });
    const relay = b.add('relay', { resistance: 0.1 }), load = b.add('resistor', { resistance: 10 });
    b.wire(source, 'a', relay, 'a'); b.wire(relay, energized ? 'b' : 'nc', load, 'a'); b.wire(load, 'b', source, 'b');
    const r = solveElectrical(b.p, {}, { contacts: { [relay.id]: energized } });
    const current = 24 / 10.1;
    expect(r.readings[relay.id].contactCurrent).toBeCloseTo(current, 12);
    expect(r.readings[relay.id].power).toBeCloseTo(current ** 2 * 0.1, 12);
    expect(r.readings[relay.id].currentNC).toBeCloseTo(energized ? 0 : current, 12);
    expect(r.readings[relay.id].voltageValid).toBe(energized);
    expect(r.powerResidual).toBeCloseTo(0, 10);
  });
});

describe('induction shutdown and disconnected equipment', () => {
  it('an unwired induction machine is unpowered rather than an invalid DC circuit', () => {
    const b = new Builder(), motor = b.add('inductionMotor');
    const s = new Simulation(b.p);
    expect(s.error).toBeNull();
    expect(s.step()).toBe(true);
    expect(s.electrical.readings[motor.id].current).toBe(0);
    expect(s.multiphysics.motors[motor.id].omega).toBe(0);
  });
  it('loss of AC supply coasts the rotor with J/b exponential decay and permits recovery', () => {
    const b = new Builder(), source = b.add('source3'), motor = b.add('inductionMotor');
    b.series(source, motor);
    const s = new Simulation(b.p);
    for (let i = 0; i < 60; i++) expect(s.step()).toBe(true);
    const initial = s.multiphysics.motors[motor.id].omega;
    const off = { ...s.project, components: s.project.components.map(c => c.id === source.id ? { ...c, props: { ...c.props, enabled: false } } : c) };
    expect(s.refresh(off)).toBe(true);
    for (let i = 0; i < 60; i++) expect(s.step()).toBe(true);
    expect(s.multiphysics.motors[motor.id].omega / initial).toBeCloseTo(Math.exp(-0.002 / 0.045), 8);
    expect(s.electrical.readings[motor.id].power).toBe(0);
    expect(s.refresh(b.p)).toBe(true);
    for (let i = 0; i < 60; i++) expect(s.step()).toBe(true);
    expect(s.multiphysics.motors[motor.id].omega).toBeGreaterThan(initial * Math.exp(-0.002 / 0.045));
  });
});

it('tank inspector uses physical inventory mass and heat capacity at 80 °C', async () => {
  const { derivedReadouts } = await import('./parameters');
  const b = new Builder(), tank = b.add('tank', { capacity: 1100, volume: 1000, initialTemperature: 80, vesselHeatCapacity: 5000 });
  const s = new Simulation(b.p), rows = derivedReadouts(tank);
  // Independent tabulated water density at atmospheric pressure: 971.8 kg/m³.
  expect(rows.find(r => r.label === 'Water mass')!.value).toBeCloseTo(971.8, 1);
  expect(rows.find(r => r.label === 'Total heat capacity')!.value).toBeCloseTo(s.multiphysics.tanks[tank.id].mass * 4180 + 5000, 8);
});

it('induction power-loss faults are injectable and clear without resetting the rotor', () => {
  const b = new Builder(), source = b.add('source3'), motor = b.add('inductionMotor');
  b.series(source, motor);
  const s = new Simulation(b.p);
  for (let i = 0; i < 60; i++) expect(s.step()).toBe(true);
  const initial = s.multiphysics.motors[motor.id].omega;
  expect(s.injectFault(motor.id, 'powerLoss')).toBeNull();
  expect(s.step()).toBe(true);
  expect(s.multiphysics.motors[motor.id].omega).toBeLessThan(initial);
  expect(s.multiphysics.motors[motor.id].omega).toBeGreaterThan(0);
  expect(s.injectFault(motor.id, null)).toBeNull();
  expect(s.step()).toBe(true);
  expect(s.electrical.readings[motor.id].current).toBeGreaterThan(0);
});

it('an empty tank retains its vessel heat capacity and cools toward ambient', () => {
  const b = new Builder(), tank = b.add('tank', { volume: 0, initialTemperature: 80, vesselHeatCapacity: 1000, loss: 100, ambient: 20 });
  const temperatures: number[] = [];
  for (const dt of [0.1, 0.05]) {
    const s = new Simulation(b.p);
    for (let i = 0; i < Math.round(1 / dt); i++) expect(s.step(dt)).toBe(true);
    temperatures.push(s.temperatures[tank.id]);
    expect(s.fluidTemperatureMeasurement(tank.id)).toBeUndefined();
    expect(s.energyResidual).toBeCloseTo(0, 8);
  }
  // Newton cooling, vessel alone: C dT/dt = -UA(T-Ta).
  const exact = 20 + 60 * Math.exp(-100 / 1000);
  expect(Math.abs(temperatures[0] - exact)).toBeLessThan(0.03);
  expect(Math.abs(temperatures[1] - exact)).toBeLessThan(Math.abs(temperatures[0] - exact));
});

it('rejects a backed-up overflow route that would require pumping uphill', () => {
  const b = new Builder();
  const source = b.add('tank', { capacity: 50, volume: 50, surfaceArea: 0.1, initialTemperature: 20 });
  const receiver = b.add('tank', { capacity: 1000, volume: 0, surfaceArea: 1, elevation: 10 });
  const pipe = b.add('pipe', { inventory: false, length: 2, diameter: 0.05 });
  b.wire(source, 'overflow', pipe, 'inlet'); b.wire(pipe, 'outlet', receiver, 'fluid');
  const s = new Simulation(b.p);
  // Impose a 1 cm surcharge without manufacturing an out-of-range project file.
  const t = s.multiphysics.tanks[source.id];
  t.mass *= 1.02; t.volume *= 1.02;
  expect(s.step()).toBe(false);
  expect(s.error).toMatch(/overflow.*back|back.*overflow/i);
});

it('AC capacitor ESR uses its configured temperature coefficient for current and heat', () => {
  const b = new Builder(), source = b.add('sourceAC', { voltage: 24, frequency: 50 });
  const cap = b.add('capacitor', { resistance: 0.5, tempCoefficient: 0.01, capacitance: 0.001 });
  b.series(source, cap);
  const r = solveElectrical(b.p, {}, { temperatures: { [cap.id]: 60 } });
  // R(60 °C) = 0.5 × (1 + 0.01 × 40) = 0.7 Ω, Xc = -1/(2πfC).
  const current = 24 / Math.hypot(0.7, 1 / (2 * Math.PI * 50 * 0.001));
  expect(r.readings[cap.id].current).toBeCloseTo(current, 12);
  expect(r.readings[cap.id].power).toBeCloseTo(current ** 2 * 0.7, 12);
  expect(r.powerResidual).toBeCloseTo(0, 10);
});
