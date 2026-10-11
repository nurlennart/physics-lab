import { describe, it, expect } from 'vitest';
import { Builder } from './scaling-validation';
import { Simulation, DT } from './engine';
import { solveElectrical, solveLinear, solveComplex, nodeVoltage } from './electrical';
import { batteryEnergy } from './devices';
import { parseProject } from './projects';
import { readProbe } from './measurements';

const run = (s: Simulation, seconds: number) => { for (let i = 0; i < Math.round(seconds / DT); i++) expect(s.step(), s.error ?? '').toBe(true); };
describe('finite battery', () => {
  it('discharges with midpoint OCV, stores I²R as heat and closes the whole-system ledger', () => {
    const b = new Builder(), battery = b.add('battery', { capacityAh: 0.1, initialSOC: 50, heatCapacity: 1000, loss: 0 }), load = b.add('resistor', { resistance: 6, loss: 0 });
    b.series(battery, load);
    const s = new Simulation(b.p), initial = batteryEnergy(battery, 0.5);
    expect(s.error).toBeNull(); run(s, 1);
    const soc = s.devices.batteries[battery.id];
    expect(soc).toBeLessThan(0.5);
    // Independent solution of Q ds/dt = −(11 + 2s)/(6 + 0.02).
    const analyticSOC = (0.5 + 11 / 2) * Math.exp(-2 / (360 * 6.02)) - 11 / 2;
    expect(soc).toBeCloseTo(analyticSOC, 11);
    expect(s.temperatures[battery.id]).toBeGreaterThan(20);
    expect(s.suppliedEnergy).toBeCloseTo(0, 10);
    expect(s.storedEnergy).toBeCloseTo(0, 8); // Chemical loss exactly becomes load and pack heat.
    expect(s.energyResidual).toBeCloseTo(0, 8);
    expect(initial - batteryEnergy(battery, soc)).toBeGreaterThan(20);
  });
  it('limits charge at empty/full boundaries while allowing the opposite current direction', () => {
    for (const initialSOC of [0, 100]) {
      const b = new Builder(), battery = b.add('battery', { capacityAh: 0.00001, initialSOC, internalResistance: 0.2 }), charger = b.add('source', { voltage: 15, ratedVoltage: 30, maxCurrent: 1e5 });
      b.series(charger, battery);
      const s = new Simulation(b.p); run(s, 0.1);
      expect(s.devices.batteries[battery.id]).toBeCloseTo(1, 12);
      expect(s.electrical.readings[battery.id].current).toBeCloseTo(0, 10);
      expect(Math.abs(s.energyResidual)).toBeLessThan(1e-8);
    }
    const b = new Builder(), battery = b.add('battery', { initialSOC: 0 }), load = b.add('resistor', { resistance: 10 }); b.series(battery, load);
    const s = new Simulation(b.p); run(s, 0.1);
    expect(s.devices.batteries[battery.id]).toBe(0); expect(s.electrical.readings[load.id].power).toBeCloseTo(0, 12);
  });
  it('advances a long discharge adaptively: analytic SOC, exact empty boundary, closed ledger', () => {
    const b = new Builder(), battery = b.add('battery', { capacityAh: 1, initialSOC: 80, heatCapacity: 1e6, loss: 0 }), load = b.add('resistor', { resistance: 6, ratedPower: 1e3, heatCapacity: 1e6, loss: 0 });
    b.series(battery, load);
    const s = new Simulation(b.p);
    expect(s.adaptiveUnavailable()).toBeNull();
    // Q ds/dt = −(11 + 2s)/6.02 with Q = 3600 C: s(t) = (s₀ + 5.5)·exp(−2t/(6.02·3600)) − 5.5, empty at t_e ≈ 1,471 s.
    const tau = 6.02 * 3600 / 2, analytic = (t: number) => (0.8 + 5.5) * Math.exp(-t / tau) - 5.5;
    const first = s.advanceAdaptive(1000);
    expect(s.devices.batteries[battery.id]).toBeCloseTo(analytic(s.time), 5);
    expect(first.steps).toBeLessThan(1000);
    s.advanceAdaptive(2600);
    expect(s.devices.batteries[battery.id]).toBe(0);
    expect(s.electrical.readings[load.id].current).toBeCloseTo(0, 12);
    expect(Math.abs(s.energyResidual)).toBeLessThan(1e-6 * 3600 * 12);
  });
  it('does not mutate SOC on paused refresh and restores initial charge on reset', () => {
    const b = new Builder(), battery = b.add('battery'), load = b.add('resistor'); b.series(battery, load);
    const s = new Simulation(parseProject(b.p)); run(s, 0.1); const soc = s.devices.batteries[battery.id];
    expect(s.refresh(s.project)).toBe(true); expect(s.devices.batteries[battery.id]).toBe(soc);
    expect(readProbe({ id: 'soc', name: 'SOC', component: battery.id, measurement: 'stateOfCharge', color: '#fff', visible: true }, s)).toBeCloseTo(soc * 100, 12);
    s.reset(); expect(s.devices.batteries[battery.id]).toBe(0.8);
  });
});
describe('powered DC contactor', () => {
  it('loads its isolated coil supply and switches the power circuit after pickup/dropout delays', () => {
    const b = new Builder(), coil = b.add('source', { voltage: 24 }), mains = b.add('sourceAC', { voltage: 120 }), contactor = b.add('contactor'), load = b.add('resistor', { resistance: 12 });
    b.series(mains, contactor, load); b.wire(coil, 'a', contactor, 'ca'); b.wire(coil, 'b', contactor, 'cb');
    const s = new Simulation(b.p); expect(s.error).toBeNull();
    expect(s.electrical.readings[contactor.id].coilPower).toBeCloseTo(4, 12);
    expect(s.electrical.readings[load.id].current).toBe(0);
    expect(nodeVoltage(s.electrical, `${contactor.id}:ca`, `${contactor.id}:a`)).toBeNull();
    expect(s.step()).toBe(true); expect(s.devices.contactors[contactor.id].closed).toBe(false);
    run(s, 0.05); expect(s.electrical.readings[load.id].current).toBeCloseTo(120 / 12.01, 10);
    expect(s.refresh({ ...s.project, components: s.project.components.map(c => c.id === coil.id ? { ...c, props: { ...c.props, enabled: false } } : c) })).toBe(true);
    run(s, 0.05); expect(s.devices.contactors[contactor.id].closed).toBe(false);
    expect(s.electrical.readings[load.id].current).toBe(0); expect(Math.abs(s.energyResidual)).toBeLessThan(1e-7);
  });
  it('closes exactly at the end of the pickup delay (the timer ends a substep)', () => {
    const b = new Builder(), coil = b.add('source', { voltage: 24 }), mains = b.add('sourceAC', { voltage: 120 }), contactor = b.add('contactor'), load = b.add('resistor', { resistance: 12, loss: 0 });
    b.series(mains, contactor, load); b.wire(coil, 'a', contactor, 'ca'); b.wire(coil, 'b', contactor, 'cb');
    const s = new Simulation(b.p);
    expect(s.step()).toBe(true); expect(s.step()).toBe(true);
    // Energised at t = 0, pickup 20 ms: the load conducts from 0.020 s to the end of the second step (1/30 s).
    const power = (120 / 12.01) ** 2 * 12;
    expect(s.componentEnergy[load.id] / (power * (2 / 60 - 0.02)) - 1).toBeCloseTo(0, 6);
  });
  it('rejects AC coil excitation explicitly', () => {
    const b = new Builder(), coil = b.add('sourceAC'), c = b.add('contactor'); b.wire(coil, 'a', c, 'ca'); b.wire(coil, 'b', c, 'cb');
    expect(new Simulation(b.p).error).toMatch(/DC coil/);
  });
});
function transformerRig() {
  const b = new Builder(), src = b.add('sourceAC', { voltage: 120 }), tr = b.add('transformer', { turnsRatio: 10, windingResistance: 2, leakageInductance: 0, coreResistance: 12000, magnetizingInductance: 10 }), load = b.add('resistor', { resistance: 6, loss: 0 });
  b.series(src, tr); b.wire(tr, 'sa', load, 'a'); b.wire(tr, 'sb', load, 'b'); return { b, src, tr, load };
}
describe('isolated transformer', () => {
  it('reflects impedance, includes core and copper heat, and retains galvanic isolation', () => {
    const { b, tr, load } = transformerRig(), s = new Simulation(b.p), primaryCurrent = 120 / (2 + 100 * 6), secondaryCurrent = primaryCurrent * 10;
    expect(s.error).toBeNull(); expect(s.electrical.readings[load.id].current).toBeCloseTo(secondaryCurrent, 10);
    expect(s.electrical.readings[tr.id].secondaryVoltage).toBeCloseTo(secondaryCurrent * 6, 10);
    expect(s.electrical.readings[tr.id].power).toBeCloseTo(primaryCurrent ** 2 * 2 + 120 ** 2 / 12000, 10);
    expect(nodeVoltage(s.electrical, `${tr.id}:a`, `${tr.id}:sa`)).toBeNull();
    expect(s.electrical.powerResidual).toBeCloseTo(0, 10); run(s, 0.1); expect(Math.abs(s.energyResidual)).toBeLessThan(1e-8);
  });
  it('operates backwards and with an explicitly grounded secondary', () => {
    const { b, tr, src, load } = transformerRig(), ground = b.add('ground'); b.wire(tr, 'sb', ground, 'a');
    expect(new Simulation(b.p).error).toBeNull();
    const reverse = new Builder(), source = reverse.add('sourceAC', { voltage: 12 }), t = reverse.add('transformer', { turnsRatio: 10, windingResistance: 0, leakageInductance: 0 }), r = reverse.add('resistor', { resistance: 600 });
    reverse.wire(source, 'a', t, 'sa'); reverse.wire(source, 'b', t, 'sb'); reverse.wire(t, 'a', r, 'a'); reverse.wire(t, 'b', r, 'b');
    const solved = solveElectrical(reverse.p); expect(solved.readings[r.id].voltage).toBeCloseTo(120, 10); expect(solved.powerResidual).toBeCloseTo(0, 10);
    expect(src).toBeDefined(); expect(load).toBeDefined();
  });
  it('draws magnetizing and core-loss current with its secondary open; rejects DC', () => {
    const b = new Builder(), src = b.add('sourceAC', { voltage: 120 }), tr = b.add('transformer', { coreResistance: 12000, magnetizingInductance: 10 }); b.series(src, tr);
    const r = solveElectrical(b.p); expect(r.readings[tr.id].power).toBeCloseTo(1.2, 10); expect(r.readings[tr.id].secondaryCurrent).toBeCloseTo(0, 12);
    const d = new Builder(), dc = d.add('source'), t = d.add('transformer'); d.series(dc, t); expect(new Simulation(d.p).error).toMatch(/requires AC/);
  });
});
describe('fan-cooled radiator', () => {
  function rig(voltage: number, reverse = false) {
    const b = new Builder(), hot = b.add('tank', { capacity: 200, volume: 100, elevation: 2, initialTemperature: 60, loss: 0 }), cold = b.add('tank', { capacity: 200, volume: 100, initialTemperature: 20, loss: 0 }), rad = b.add('radiator'), supply = b.add('source', { voltage, ratedVoltage: 24 });
    b.wire(hot, 'fluid', rad, reverse ? 'outlet' : 'inlet'); b.wire(rad, reverse ? 'inlet' : 'outlet', cold, 'fluid'); b.series(supply, rad); return { s: new Simulation(b.p), rad };
  }
  it('uses actual fan voltage, bounds outlet temperature, and accounts for fan heat', () => {
    const off = rig(0), on = rig(24);
    for (const { s, rad } of [off, on]) {
      expect(s.error).toBeNull();
      const initial = s.multiphysics.hydraulic.readings[rad.id], branch = s.multiphysics.hydraulic.branches.find(b => b.component === rad.id)!;
      const capacityRate = Math.abs(initial.flow) * 1000 * 4180, ua = s === on.s ? 100 : 5;
      expect(initial.temperature).toBeCloseTo(293.15 + 40 * Math.exp(-ua / capacityRate) + branch.loss / capacityRate, 10);
      expect(s.step()).toBe(true);
      const r = s.multiphysics.hydraulic.readings[rad.id]; expect(r.flow).toBeGreaterThan(0);
      expect(r.temperature).toBeGreaterThan(293.15); expect(r.temperature).toBeLessThan(333.15);
      expect(Math.abs(s.energyResidual)).toBeLessThan(0.01);
    }
    expect(on.s.multiphysics.hydraulic.readings[on.rad.id].duty).toBeGreaterThan(off.s.multiphysics.hydraulic.readings[off.rad.id].duty!);
    expect(on.s.electrical.readings[on.rad.id].fanPower).toBeCloseTo(30, 10);
    expect(on.s.ambientEnergy).toBeGreaterThan(30 * DT);
  });
  it('handles reverse water flow without reversing heat transfer', () => {
    const { s, rad } = rig(24, true); expect(s.step()).toBe(true); const r = s.multiphysics.hydraulic.readings[rad.id];
    expect(r.flow).toBeLessThan(0); expect(r.duty).toBeGreaterThan(0); expect(Math.abs(s.energyResidual)).toBeLessThan(0.01);
  });
});

describe('solver robustness', () => {
  it('solves well-conditioned real and complex equations regardless of absolute coefficient scale', () => {
    for (const scale of [1e-18, 1, 1e18]) {
      const a = [[2 * scale, scale], [scale, 3 * scale]], b = [4 * scale, 7 * scale];
      expect(solveLinear(a, b)[0]).toBeCloseTo(1, 12); expect(solveLinear(a, b)[1]).toBeCloseTo(2, 12);
      const x = solveComplex(a.map(row => row.map(v => [v, v] as [number, number])), b.map(v => [v, v]));
      expect(x[0][0]).toBeCloseTo(1, 12); expect(x[1][0]).toBeCloseTo(2, 12); expect(x[0][1]).toBeCloseTo(0, 12);
    }
    expect(() => solveLinear([[1, 2], [2, 4]], [1, 2])).toThrow(/singular/i);
    expect(() => solveComplex([[[1, 0], [2, 0]], [[2, 0], [4, 0]]], [[1, 0], [2, 0]])).toThrow(/singular/i);
  });
  it('resolves interacting regulated supplies and verifies both current and compliance constraints', () => {
    const b = new Builder(), one = b.add('source', { mode: 'cvcc', voltage: 12, maxCurrent: 1, internalResistance: 0.1 }), two = b.add('source', { mode: 'cvcc', voltage: 10, maxCurrent: 2, internalResistance: 0.1 }), load = b.add('resistor', { resistance: 2 });
    b.series(one, load); b.wire(two, 'a', one, 'a'); b.wire(two, 'b', one, 'b');
    const r = solveElectrical(b.p);
    expect(r.readings[one.id].regulation).toBe('cc'); expect(r.readings[two.id].regulation).toBe('cc');
    expect(r.readings[load.id].current).toBeCloseTo(3, 12); expect(r.powerResidual).toBeCloseTo(0, 12);
  });
});

it('replays battery charge, contactor mechanics and radiator transport deterministically', async () => {
  const { replayExperiment } = await import('./replay');
  const { starter } = await import('./projects');
  for (const mode of ['battery', 'contactor', 'radiator', 'transformer'] as const) {
    const p = starter(mode), s = new Simulation(p); run(s, 1);
    const replay = replayExperiment(p, [], 1);
    expect(replay.error).toBeNull(); expect(replay.devices.batteries).toEqual(s.devices.batteries);
    expect(replay.devices.contactors).toEqual(s.devices.contactors); expect(replay.temperatures).toEqual(s.temperatures);
    expect(replay.electrical.readings).toEqual(s.electrical.readings); expect(replay.energyResidual).toBe(s.energyResidual);
  }
});

it('fan failure removes electrical consumption and retains passive cooling', () => {
  const b = new Builder(), src = b.add('source', { voltage: 24 }), radiator = b.add('radiator'); b.series(src, radiator);
  const s = new Simulation(b.p); expect(s.electrical.readings[radiator.id].fanPower).toBeCloseTo(30, 10);
  expect(s.injectFault(radiator.id, 'coolingFailed')).toBeNull(); expect(s.step()).toBe(true);
  expect(s.electrical.readings[radiator.id].fanPower).toBe(0); expect(s.energyResidual).toBeCloseTo(0, 12);
});

it('current limiting supports absorption without cycling between CV and CC', () => {
  const b = new Builder(), limited = b.add('source', { mode: 'cvcc', voltage: 10, maxCurrent: 1, internalResistance: 0.1 }), supply = b.add('source', { voltage: 20, ratedVoltage: 30 }), load = b.add('resistor', { resistance: 20 });
  b.series(supply, load); b.wire(limited, 'a', supply, 'a'); b.wire(limited, 'b', supply, 'b');
  const result = solveElectrical(b.p); expect(result.readings[limited.id].current).toBeCloseTo(1, 12); expect(result.readings[limited.id].regulation).toBe('cc'); expect(result.powerResidual).toBeCloseTo(0, 12);
});

it('transformer carries rectifier harmonics and books their heat without duplicating transferred power', () => {
  const b = new Builder(), src = b.add('source3'), tr = b.add('transformer', { turnsRatio: 1, windingResistance: 0.1, leakageInductance: 0.0001 }), drive = b.add('vfd'), motor = b.add('inductionMotor');
  b.series(src, tr); b.wire(tr, 'sa', drive, 'a'); b.wire(tr, 'sb', drive, 'b'); b.wire(drive, 'oa', motor, 'a'); b.wire(drive, 'ob', motor, 'b');
  const result = solveElectrical(b.p, {}, { drives: { [drive.id]: { running: true, frequency: 50, voltage: 400 / Math.sqrt(3) } }, inductionMotors: { [motor.id]: { enabled: true, omega: 1450 * Math.PI / 30 } } });
  expect(result.readings[tr.id].harmonicCurrent).toBeGreaterThan(0);
  expect(result.readings[tr.id].harmonicLoss).toBeGreaterThan(0);
  expect(result.readings[tr.id].secondaryCurrent).toBeCloseTo(result.readings[drive.id].current, 10);
  expect(result.readings[tr.id].inputPower).toBeGreaterThan(result.readings[tr.id].power);
  expect(Math.abs(result.powerResidual!)).toBeLessThan(1e-8);
});
