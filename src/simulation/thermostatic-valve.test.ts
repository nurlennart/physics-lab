import { describe, expect, it, vi } from 'vitest';
import { trvPosition, trvSensorStep, trvSetpoint, trvTemperatureLabel } from './thermostatic-valve';
import { Builder } from './scaling-validation';
import { makeComponent } from './model';
import { Simulation } from './engine';
import { parseProject, serializeProject, starter } from './projects';
import { createRunArchive, restoreRunArchive } from './replay';
import { makeThermalSpace } from './thermal-spaces';

function rig(temperature = 20) {
  const b = new Builder(); b.p.environment = { ambient: temperature };
  const high = b.add('tank', { capacity: 1e6, volume: 9e5, surfaceArea: 1000, elevation: 0.5, loss: 0 });
  const low = b.add('tank', { capacity: 1e6, volume: 1e3, surfaceArea: 1000, loss: 0 });
  const valve = b.add('thermostaticValve');
  b.wire(high, 'fluid', valve, 'inlet'); b.wire(valve, 'outlet', low, 'fluid');
  return { p: b.p, valve };
}

describe('self-acting RA 2910 / RA-FN 15 reference valve', () => {
  it('maps the manufacturer dial and interpolates fractional settings', () => {
    const c = makeComponent('thermostaticValve', 0, 0);
    for (const [dial, t] of [7, 13, 17, 20, 23, 26].entries()) {
      c.props.dial = dial; expect(trvSetpoint(c)).toBe(t);
    }
    c.props.dial = 2.5; expect(trvSetpoint(c)).toBe(18.5);
  });
  it('labels fractional dial temperatures without interpolation round-off', () => {
    const c = makeComponent('thermostaticValve', 0, 0); c.props.dial = 4.1;
    expect(trvSetpoint(c)).not.toBe(23.3);
    expect(trvTemperatureLabel(trvSetpoint(c))).toBe('23.3'); expect(trvTemperatureLabel(trvSetpoint(c) + 2)).toBe('25.3');
    c.props.dial = 3; expect(trvTemperatureLabel(trvSetpoint(c))).toBe('20');
  });
  it('reproduces published Kv points at deviations from closure and seats exactly', () => {
    const c = makeComponent('thermostaticValve', 0, 0);
    for (const [deviation, kv] of [[0, 0], [0.5, 0.22], [1, 0.43], [1.5, 0.57], [2, 0.73], [3, 0.9]])
      expect(trvPosition(c, 22 - deviation) / 100 * 0.9).toBeCloseTo(kv, 12);
    expect(trvPosition(c, 25)).toBe(0); expect(trvPosition(c, -20)).toBe(100);
  });
  it('has an exact, stable sensing response for both small and large timesteps', () => {
    const c = makeComponent('thermostaticValve', 0, 0);
    expect(trvSensorStep(c, 15, 25, 600)).toBeCloseTo(25 - 10 / Math.E, 12);
    let t = 15; for (let i = 0; i < 100; i++) t = trvSensorStep(c, t, 25, 6);
    expect(t).toBeCloseTo(trvSensorStep(c, 15, 25, 600), 12);
    expect(trvSensorStep(c, 15, 25, 1e8)).toBe(25);
  });
  it('solves Q = Kv sqrt(Δp/bar) at published operating points, including full closure', () => {
    for (const temperature of [19, 20, 20.5, 21, 21.5, 22, 23]) {
      const { p, valve } = rig(temperature), s = new Simulation(p);
      expect(s.step(0.02), s.error ?? '').toBe(true);
      const r = s.multiphysics.hydraulic.readings[valve.id];
      const kv = trvPosition(valve, temperature) / 100 * 0.9;
      expect(r.flow).toBeCloseTo(kv * Math.sqrt(r.differentialPressure / 1e5) / 3600, 12);
      expect(s.multiphysics.massResidual).toBeCloseTo(0, 8);
      expect(Math.abs(s.energyResidual)).toBeLessThan(1e-5);
    }
  });
  it('senses the assigned room, with override and outside-room fallbacks', () => {
    const { p, valve } = rig(0), room = makeThermalSpace(); room.initialTemperature = 21;
    p.thermalSpaces = [room]; p.thermalElements = []; valve.thermalSpaceId = room.id;
    let s = new Simulation(p); expect(s.multiphysics.trvSensors[valve.id]).toBe(21);
    valve.props.ambientMode = 'override'; valve.props.ambient = 15;
    s = new Simulation(p); expect(s.multiphysics.trvSensors[valve.id]).toBe(15);
    valve.props.ambientMode = 'inherit'; delete valve.thermalSpaceId;
    s = new Simulation(p); expect(s.multiphysics.trvSensors[valve.id]).toBe(0);
  });
  it('refreshes without advancing sensing state; rolls back rejected accepted-state updates', () => {
    const { p, valve } = rig(20), s = new Simulation(p);
    expect(s.step(0.02)).toBe(true); // A Build edit at t = 0 intentionally reinitializes all components.
    expect(s.refresh({ ...p, environment: { ambient: 25 } })).toBe(true);
    expect(s.multiphysics.trvSensors[valve.id]).toBe(20);
    const before = s.multiphysics.checkpoint(), advance = s.multiphysics.advance.bind(s.multiphysics);
    const spy = vi.spyOn(s.multiphysics, 'advance').mockImplementation((...args) => {
      advance(...args); throw Error('Injected rejection after TRV advance');
    });
    expect(s.step(0.02)).toBe(false); spy.mockRestore();
    expect(s.multiphysics.trvSensors).toEqual(before.trvSensors);
    expect(s.multiphysics.positions).toEqual(before.positions);
  });
  it('supports stuck-valve faults and resumes temperature regulation when cleared', () => {
    const { p, valve } = rig(23), s = new Simulation(p);
    expect(s.injectFault(valve.id, 'stuckOpen')).toBeNull(); expect(s.step()).toBe(true);
    expect(s.multiphysics.hydraulic.readings[valve.id].flow).toBeGreaterThan(0);
    expect(s.injectFault(valve.id, 'stuckClosed')).toBeNull(); expect(s.step()).toBe(true);
    expect(s.multiphysics.hydraulic.readings[valve.id].flow).toBe(0);
    expect(s.injectFault(valve.id, null)).toBeNull(); expect(s.step()).toBe(true);
    expect(s.multiphysics.positions[valve.id]).toBe(0);
  });
  it('persists dial and assignment, rejects invalid parameters and replays sensing state', async () => {
    const { p, valve } = rig(20), origin = parseProject(JSON.parse(serializeProject(p))), s = new Simulation(origin);
    expect(s.step()).toBe(true); const changedAt = s.time;
    const changed = structuredClone(origin); changed.environment = { ambient: 25 }; changed.components.find(c => c.id === valve.id)!.props.dial = 2.5;
    expect(s.refresh(changed)).toBe(true); for (let i = 0; i < 20; i++) expect(s.step()).toBe(true);
    expect(s.multiphysics.trvSensors[valve.id]).toBeGreaterThan(20);
    expect(s.multiphysics.trvSensors[valve.id]).toBeLessThan(25);
    const archive = createRunArchive(s.project, origin, [{ at: changedAt, project: changed }], s.time);
    const restored = (await restoreRunArchive(archive, async () => {})).simulation;
    expect(restored.multiphysics.trvSensors).toEqual(s.multiphysics.trvSensors);
    expect(restored.multiphysics.positions).toEqual(s.multiphysics.positions);
    expect(restored.energyResidual).toBe(s.energyResidual);
    for (const [key, value] of [['dial', 6], ['kvs', 0], ['sensorTimeConstant', 0]] as const) {
      const bad = structuredClone(p); bad.components.find(c => c.id === valve.id)!.props[key] = value;
      expect(() => parseProject(bad)).toThrow();
    }
  });
  it('reports the published regulating differential-pressure limit', () => {
    const { p } = rig(20); p.components.find(c => c.kind === 'tank')!.props.elevation = 10;
    const s = new Simulation(p); expect(s.step()).toBe(true);
    expect(s.violations.some(v => v.includes('regulating differential pressure'))).toBe(true);
  });
  it('retains Bosch circulation through the bypass with the radiator valve closed', () => {
    const p = starter('thermostaticRoom'), valve = p.components.find(c => c.kind === 'thermostaticValve')!;
    p.thermalSpaces![0].initialTemperature = 23;
    const s = new Simulation(p), run = s.advanceAdaptive(120);
    const boiler = p.components.find(c => c.kind === 'electricBoiler')!;
    expect(run.done, s.error ?? '').toBe(true); expect(s.violations).toEqual([]);
    expect(s.multiphysics.positions[valve.id]).toBe(0);
    expect(s.multiphysics.hydraulic.readings[valve.id].flow).toBe(0);
    expect(s.multiphysics.hydraulic.readings[boiler.id].flow).toBeGreaterThan(Number(boiler.props.minFlow));
    expect(s.multiphysics.boilers[boiler.id].fault).toBe('');
    expect(s.fluidTemperatureMeasurement(boiler.id)).toBeGreaterThan(20);
    expect(Math.abs(s.energyResidual)).toBeLessThan(0.5);
    expect(s.multiphysics.massResidual).toBeCloseTo(0, 8);
  });
  it('throttles hydraulic flow as its assigned room warms and converges under timestep refinement', () => {
    const run = (h: number) => {
      const { p, valve } = rig(20), room = makeThermalSpace(0, 0, 1, 1);
      room.height = 1; room.addedHeatCapacity = 1e4; room.airChangesPerHour = 0; room.internalGain = 1000;
      p.thermalSpaces = [room]; p.thermalElements = []; valve.thermalSpaceId = room.id; valve.props.sensorTimeConstant = 1;
      const s = new Simulation(p), initial = s.multiphysics.positions[valve.id];
      for (let t = 0; t < 30 - 1e-9; t += h) expect(s.step(h, true), s.error ?? '').toBe(true);
      expect(s.spaceTemperatures[room.id]).toBeGreaterThan(22);
      expect(s.multiphysics.positions[valve.id]).toBe(0);
      expect(s.multiphysics.hydraulic.readings[valve.id].flow).toBe(0);
      expect(initial).toBeGreaterThan(50); expect(Math.abs(s.energyResidual)).toBeLessThan(1e-5);
      return s.multiphysics.trvSensors[valve.id];
    };
    const reference = run(0.025), coarse = run(0.2), fine = run(0.1);
    expect(Math.abs(fine - reference)).toBeLessThan(Math.abs(coarse - reference));
  });
});
