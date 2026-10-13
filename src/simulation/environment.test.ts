import { describe, expect, it } from 'vitest';
import { effectiveAmbient, resolveAmbient } from './environment';
import { definitions, isThermalMass, makeComponent, prop, type Kind } from './model';
import { Simulation } from './engine';
import { Builder } from './scaling-validation';
import { parseProject, starter } from './projects';
import { withProperty } from './integrity';
import { builtinPresets, presetComponentProps, presetProps, validatePreset } from './presets';
import { WATER_CP } from './units';
import { readProbe } from './measurements';
import { filamentCelsius } from './filament';

const boundaryKinds = (Object.keys(definitions) as Kind[]).filter(k => 'ambientMode' in definitions[k].defaults);

describe('environment resolution', () => {
  it.each(Object.keys(definitions) as Kind[])('%s inherits by default and supports the future space precedence', kind => {
    const c = makeComponent(kind, 0, 0), p = { environment: { ambient: 32 } };
    expect(resolveAmbient(p, c)).toEqual({ temperature: 32, source: 'experiment' });
    expect(resolveAmbient(p, c, 18)).toEqual({ temperature: 18, source: 'space' });
    if ('ambientMode' in c.props) {
      c.props.ambientMode = 'override'; c.props.ambient = 7;
      expect(resolveAmbient(p, c, 18)).toEqual({ temperature: 7, source: 'override' });
    }
  });

  it.each(boundaryKinds)('%s preserves legacy local boundaries through import and export', kind => {
    const p = starter('blank'), c = makeComponent(kind, 0, 0);
    delete c.props.ambientMode; c.props.ambient = 12; p.components.push(c);
    p.environment = { ambient: 35 };
    const restored = parseProject(p);
    expect(restored.components[0].props.ambientMode).toBe('override');
    expect(effectiveAmbient(restored, restored.components[0])).toBe(12);
    expect(parseProject(JSON.parse(JSON.stringify(restored)))).toEqual(restored);
  });

  it('preserves legacy 20 °C boundaries and inherits when a legacy component had no ambient field', () => {
    const b = new Builder(), tank = b.add('tank'), motor = b.add('motor');
    delete tank.props.ambientMode; delete motor.props.ambientMode; delete motor.props.ambient;
    b.p.environment = { ambient: 35 };
    const p = parseProject(b.p);
    expect(effectiveAmbient(p, p.components[0])).toBe(20);
    expect(effectiveAmbient(p, p.components[1])).toBe(35);
  });

  it('retains coolant preset boundaries and inheritance when presets are saved', () => {
    const chiller = builtinPresets.find(p => p.kind === 'cooler' && p.props.ambient === 7)!;
    const c = makeComponent('cooler', 0, 0);
    c.props = presetComponentProps(chiller).props;
    expect(effectiveAmbient({ environment: { ambient: 30 } }, c)).toBe(7);
    for (const mode of ['inherit', 'override']) {
      c.props.ambientMode = mode; c.props.ambient = 20;
      const saved = validatePreset({ id: 'test', name: 'Boundary', kind: c.kind, base: 'standard', props: presetProps(c) });
      expect(presetComponentProps(saved).props.ambientMode).toBe(mode);
    }
  });

  it('validates modes and finite override temperatures', () => {
    const b = new Builder(), c = b.add('motor');
    c.props.ambientMode = 'unknown'; expect(() => parseProject(b.p)).toThrow(/ambient environment/);
    c.props.ambientMode = 'override'; c.props.ambient = NaN;
    expect(() => parseProject(b.p)).toThrow();
  });
});

describe('resolved thermal boundaries and conservation', () => {
  it.each(boundaryKinds.filter(k => isThermalMass(makeComponent(k, 0, 0)) && k !== 'tank'))('%s uses resolved ambient for storage and loss', kind => {
    const b = new Builder(), c = b.add(kind, kind === 'battery' ? { selfDischarge: 0 } : {});
    if (kind === 'starDeltaStarter' || kind === 'softStarter') {
      const motor = b.add('inductionMotor', { enabled: false });
      b.wire(c, 'b', motor, 'a');
    }
    b.p.environment = { ambient: 30 };
    const s = new Simulation(b.p);
    expect(s.temperatures[c.id]).toBe(kind === 'thermalMass' ? prop(c, 'initialTemperature') : 30);
    // Place a warm body in the environment; no electrical input or shaft work.
    s.temperatures[c.id] = 50;
    expect(s.step(0.1)).toBe(true);
    const C = prop(c, 'heatCapacity'), ua = prop(c, 'loss');
    expect(s.temperatures[c.id]).toBeCloseTo((C * 50 + 0.1 * ua * 30) / (C + 0.1 * ua), 7);
    expect(s.energyResidual).toBeCloseTo(0, 6);
  });

  it.each(['tank', 'pipe', 'electricBoiler', 'panelRadiator'] as Kind[])('%s responds to a live global change, retains initial state, and conserves energy', kind => {
    const b = new Builder(), c = b.add(kind, { initialTemperature: 60, ...(kind === 'pipe' ? { thermalUA: 10 } : {}) });
    const s = new Simulation(b.p);
    const temperature = () => kind === 'tank' ? s.temperatures[c.id] : s.multiphysics.pipeCells[c.id][0] - 273.15;
    expect(temperature()).toBeCloseTo(60);
    expect(s.step(0.1)).toBe(true);
    const before = temperature(), stored = s.storedEnergy, ambient = s.ambientEnergy;
    expect(s.refresh({ ...s.project, environment: { ambient: 80 } })).toBe(true);
    expect(temperature()).toBe(before);
    expect(s.step(0.1)).toBe(true);
    expect(temperature()).toBeGreaterThan(before);
    expect(s.ambientEnergy).toBeLessThan(ambient);
    expect(s.storedEnergy).toBeGreaterThan(stored);
    expect(s.energyResidual).toBeCloseTo(0, 5);
    expect(s.project.components[0].props.initialTemperature).toBe(60);
  });

  it('keeps local overrides independent across live global edits and releases them back to inheritance', () => {
    const b = new Builder(), a = b.add('tank', { initialTemperature: 50, loss: 10 }), c = b.add('tank', { initialTemperature: 50, loss: 10, ambient: 5 });
    const s = new Simulation(b.p);
    expect(s.step(0.1)).toBe(true);
    expect(s.refresh({ ...s.project, environment: { ambient: 70 } })).toBe(true);
    const oldA = s.temperatures[a.id], oldC = s.temperatures[c.id];
    expect(s.step(0.1)).toBe(true);
    expect(s.temperatures[a.id]).toBeGreaterThan(oldA);
    expect(s.temperatures[c.id]).toBeLessThan(oldC);
    const C = s.multiphysics.tanks[c.id].mass * WATER_CP + prop(c, 'vesselHeatCapacity');
    expect(s.temperatures[c.id]).toBeCloseTo((C * oldC + 0.1 * 10 * 5) / (C + 0.1 * 10), 8);
    const current = s.project.components.find(x => x.id === c.id)!;
    expect(s.refresh(withProperty(s.project, current, 'ambientMode', 'inherit'))).toBe(true);
    const before = s.temperatures[c.id]; expect(s.step(0.1)).toBe(true);
    expect(s.temperatures[c.id]).toBeGreaterThan(before);
    expect(s.energyResidual).toBeCloseTo(0, 5);
  });

  it('uses experiment ambient for a cooling jacket while an explicit coolant remains independent', () => {
    const run = (ambient?: number) => {
      const b = new Builder(), tank = b.add('tank', { initialTemperature: 60, loss: 0 });
      const cooler = b.add('cooler', { conductance: 100, ...(ambient === undefined ? {} : { ambient }) });
      b.wire(cooler, 'heat', tank, 'heat'); b.p.environment = { ambient: 70 };
      const s = new Simulation(b.p); expect(s.step(0.1)).toBe(true);
      expect(s.energyResidual).toBeCloseTo(0, 5); return s.temperatures[tank.id];
    };
    expect(run()).toBeGreaterThan(60); expect(run(7)).toBeLessThan(60);
  });

  it.each(['radiator', 'panelRadiator', 'electricBoiler'] as Kind[])('%s flowing transport agrees with equivalent explicit boundaries and telemetry', kind => {
    const b = new Builder(), hot = b.add('tank', { initialTemperature: 60, elevation: 2, loss: 0 });
    const cold = b.add('tank', { initialTemperature: 20, volume: 10, loss: 0 });
    const pipe = b.add('pipe', { initialTemperature: 60, thermalUA: 10 });
    const emitter = b.add(kind, kind === 'radiator' ? { naturalUA: 100 } : { initialTemperature: 60 });
    b.wire(hot, 'fluid', pipe, 'inlet'); b.wire(pipe, 'outlet', emitter, 'inlet'); b.wire(emitter, 'outlet', cold, 'fluid');
    b.p.environment = { ambient: 35 };
    const inherited = new Simulation(b.p);
    const local = new Simulation({ ...b.p, environment: { ambient: 5 }, components: b.p.components.map(c =>
      'ambientMode' in c.props ? { ...c, props: { ...c.props, ambientMode: 'override', ambient: 35 } } : c) });
    for (let i = 0; i < 10; i++) {
      expect(inherited.step(0.1), inherited.error ?? '').toBe(true);
      expect(local.step(0.1), local.error ?? '').toBe(true);
    }
    expect(inherited.multiphysics.hydraulic.readings[emitter.id].flow).toBeGreaterThan(0);
    expect(inherited.multiphysics.pipeCells).toEqual(local.multiphysics.pipeCells);
    expect(inherited.ambientEnergy).toBeCloseTo(local.ambientEnergy, 8);
    expect(inherited.ambientEnergy).toBeGreaterThan(0);
    expect(inherited.energyResidual).toBeCloseTo(0, 4);
    expect(local.energyResidual).toBeCloseTo(0, 4);
    if (kind === 'electricBoiler') {
      expect(readProbe({ id: 'loss', name: 'Loss', color: '#fff', visible: true, component: emitter.id, measurement: 'heatLoss' }, inherited)).toBeCloseTo(
        prop(emitter, 'loss') * (inherited.fluidTemperatureMeasurement(emitter.id)! - 35), 8);
      expect(inherited.project.components.find(c => c.id === emitter.id)!.props.setpoint).toBe(60);
    }
  });

  it('lamp filament starts at resolved ambient and conserves energy after a live ambient change', () => {
    const b = new Builder(), lamp = b.add('lamp'); b.p.environment = { ambient: -10 };
    const s = new Simulation(b.p);
    expect(s.step(0.1)).toBe(true);
    expect(filamentCelsius(s.filaments[lamp.id])).toBeCloseTo(-10, 8);
    expect(s.refresh({ ...s.project, environment: { ambient: 40 } })).toBe(true);
    expect(s.step(0.1)).toBe(true);
    expect(filamentCelsius(s.filaments[lamp.id])).toBeGreaterThan(-10);
    expect(filamentCelsius(s.filaments[lamp.id])).toBeLessThan(40);
    expect(s.energyResidual).toBeCloseTo(0, 7);
  });

});
