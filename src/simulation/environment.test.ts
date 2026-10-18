import { describe, expect, it } from 'vitest';
import { effectiveAmbient, resolveAmbient, variantAmbient } from './environment';
import { catalog, definitions, isThermalMass, makeComponent, prop, type Kind } from './model';
import { Simulation } from './engine';
import { Builder } from './scaling-validation';
import { parseProject, serializeProject, starter } from './projects';
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

  it('uses a stored ambient only with an explicit override', () => {
    const c = makeComponent('tank', 0, 0), p = { environment: { ambient: 35 } };
    c.props.ambient = 12;
    expect(resolveAmbient(p, c)).toEqual({ temperature: 35, source: 'experiment' });
    delete c.props.ambientMode;
    expect(resolveAmbient(p, c).source).toBe('experiment');
    expect(parseProject({ ...starter('blank'), components: [c] }).components[0].props.ambientMode).toBe('inherit');
  });

  it.each(boundaryKinds)('%s round-trips both modes through the current file format', kind => {
    for (const mode of ['inherit', 'override']) {
      const p = starter('blank'), c = makeComponent(kind, 0, 0);
      c.props.ambientMode = mode; c.props.ambient = kind === 'cooler' ? -150 : 12; p.components.push(c); p.environment = { ambient: 35 };
      const restored = parseProject(JSON.parse(serializeProject(p)));
      expect(restored.components[0].props.ambientMode).toBe(mode);
      expect(restored.components[0].props.ambient).toBe(c.props.ambient);
      expect(effectiveAmbient(restored, restored.components[0])).toBe(mode === 'override' ? c.props.ambient : 35);
      expect(serializeProject(restored)).toBe(serializeProject(p));
    }
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

  it.each(['tank', 'pipe', 'electricBoiler', 'panelRadiator', 'storageTank', 'underfloorHeating'] as Kind[])('%s responds to a live global change, retains initial state, and conserves energy', kind => {
    const b = new Builder(), c = b.add(kind, { initialTemperature: 60, ...(kind === 'pipe' ? { thermalUA: 10 } : {}) });
    const s = new Simulation(b.p);
    // Underfloor water meets the room only through its screed: the screed node responds to the boundary.
    const temperature = () => kind === 'tank' ? s.temperatures[c.id] : s.multiphysics.pipeCells[kind === 'underfloorHeating' ? `${c.id}#screed` : c.id][0] - 273.15;
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

  it.each(['radiator', 'panelRadiator', 'electricBoiler', 'underfloorHeating'] as Kind[])('%s flowing transport agrees with equivalent explicit boundaries and telemetry', kind => {
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

describe('variant changes', () => {
  const props = (variant: string) => catalog({ ...makeComponent('cooler', 0, 0), variant }).props;
  const standard = props('standard'), coil = props('processCoil');

  it('replaces the previous variant boundary with the new one in both directions', () => {
    expect(coil).toMatchObject({ ambientMode: 'override', ambient: 15 });
    expect(variantAmbient(standard, standard, coil)).toEqual({ ambientMode: 'override', ambient: 15 });
    expect(variantAmbient(coil, coil, standard)).toEqual({ ambientMode: 'inherit', ambient: 20 });
    // A value remembered while inheriting is not a user override.
    expect(variantAmbient({ ...standard, ambient: 4 }, standard, coil)).toEqual({ ambientMode: 'override', ambient: 15 });
  });

  it('keeps a boundary the user chose', () => {
    expect(variantAmbient({ ...standard, ambientMode: 'override', ambient: 20 }, standard, coil)).toEqual({ ambientMode: 'override', ambient: 20 });
    expect(variantAmbient({ ...standard, ambientMode: 'override', ambient: 4 }, standard, coil)).toEqual({ ambientMode: 'override', ambient: 4 });
    expect(variantAmbient({ ...coil, ambient: 9 }, coil, standard)).toEqual({ ambientMode: 'override', ambient: 9 });
    expect(variantAmbient({ ...coil, ambientMode: 'inherit' }, coil, standard)).toEqual({ ambientMode: 'inherit', ambient: 15 });
  });

  it('leaves variants of kinds without a boundary untouched', () => {
    const pump = catalog(makeComponent('pump', 0, 0)).props;
    expect(variantAmbient(pump, pump, pump)).toEqual({});
  });
});

describe('global ambient propagation', () => {
  it('thermostaticValve senses live global air through its lag and retains local overrides', () => {
    for (const override of [false, true]) {
      const p = starter('blank'), c = makeComponent('thermostaticValve', 0, 0);
      c.props.ambientMode = override ? 'override' : 'inherit'; c.props.ambient = 12;
      p.environment = { ambient: 15 }; p.components.push(c);
      const s = new Simulation(p); expect(s.step()).toBe(true);
      const before = s.multiphysics.trvSensors[c.id];
      expect(s.refresh({ ...p, environment: { ambient: 40 } })).toBe(true);
      expect(s.multiphysics.trvSensors[c.id]).toBe(before);
      expect(s.step()).toBe(true);
      if (override) expect(s.multiphysics.trvSensors[c.id]).toBe(12);
      else {
        expect(s.multiphysics.trvSensors[c.id]).toBeGreaterThan(before);
        expect(s.multiphysics.trvSensors[c.id]).toBeLessThan(40);
      }
      expect(s.energyResidual).toBe(0);
    }
  });
  const thermalMasses = boundaryKinds.filter(k => isThermalMass(makeComponent(k, 0, 0)));

  it('heatPump draws its evaporator heat at the resolved air temperature: inherited, overridden and live-edited', () => {
    const rig = (props: Record<string, number | string>) => {
      const b = new Builder(); b.p.environment = { ambient: 7 };
      const hp = b.add('heatPump', props), mains = b.add('sourceAC', { voltage: 230, maxCurrent: 63, maxPower: 15000 }), pump = b.add('circulator', { headSetpoint: 4 });
      const sink = b.add('radiator', { naturalUA: 400, forcedUA: 0, ambient: 20, ambientMode: 'override' }), pipe = b.add('pipe', { diameter: 0.028, length: 20, thermalUA: 0 });
      b.wire(mains, 'a', hp, 'L'); b.wire(mains, 'b', hp, 'N'); b.wire(mains, 'a', pump, 'a'); b.wire(mains, 'b', pump, 'b');
      b.wire(hp, 'outlet', pipe, 'inlet'); b.wire(pipe, 'outlet', sink, 'inlet'); b.wire(sink, 'outlet', pump, 'inlet'); b.wire(pump, 'outlet', hp, 'inlet');
      const s = new Simulation(b.p); s.advanceAdaptive(400); expect(s.error).toBeNull(); return { s, hp };
    };
    const inherit = rig({}), cold = rig({ ambient: -5, ambientMode: 'override' });
    expect(inherit.s.multiphysics.heatPumpView[inherit.hp.id].inputs.air).toBe(7);
    expect(cold.s.multiphysics.heatPumpView[cold.hp.id].inputs.air).toBe(-5);
    expect(cold.s.multiphysics.heatPumpView[cold.hp.id].plan.point.evaporating).toBeLessThan(inherit.s.multiphysics.heatPumpView[inherit.hp.id].plan.point.evaporating);
    expect(inherit.s.refresh({ ...inherit.s.project, environment: { ambient: -2 } })).toBe(true);
    inherit.s.advanceAdaptive(60);
    expect(inherit.s.multiphysics.heatPumpView[inherit.hp.id].inputs.air).toBe(-2);
    for (const { s } of [inherit, cold]) expect(Math.abs(s.energyResidual)).toBeLessThan(1e-4);
  });

  it('every boundary component is covered by a behavioural test above', () => {
    const covered = new Set<Kind>([...thermalMasses, 'pipe', 'electricBoiler', 'panelRadiator', 'radiator', 'cooler', 'thermostaticValve', 'heatPump', 'storageTank', 'underfloorHeating']);
    expect(boundaryKinds.filter(k => !covered.has(k))).toEqual([]);
  });

  it('a global edit reaches every inheriting component and no override', () => {
    const b = new Builder();
    for (const kind of boundaryKinds)
      for (const props of [{}, { ambient: kind === 'cooler' ? -150 : 5 }] as Record<string, number>[]) {
        const c = b.add(kind, props);
        // Starters need their motor (as in the per-kind test above).
        if (kind === 'starDeltaStarter' || kind === 'softStarter') b.wire(c, 'b', b.add('inductionMotor', { enabled: false }), 'a');
      }
    b.p.environment = { ambient: 37 };
    const s = new Simulation(b.p);
    for (const c of s.project.components) {
      const local = c.props.ambientMode === 'override';
      expect(effectiveAmbient(s.project, c), `${c.kind} ${c.props.ambientMode}`).toBe(local ? c.props.ambient : 37);
      if (isThermalMass(c) && !('initialTemperature' in c.props)) expect(s.temperatures[c.id], c.kind).toBe(local ? c.props.ambient : 37);
    }
    expect(s.step(0.1), s.error ?? '').toBe(true);
    expect(s.refresh({ ...s.project, environment: { ambient: -5 } })).toBe(true);
    for (const c of s.project.components)
      expect(effectiveAmbient(s.project, c), c.kind).toBe(c.props.ambientMode === 'override' ? c.props.ambient : -5);
    expect(s.step(0.1), s.error ?? '').toBe(true);
    expect(s.energyResidual).toBeCloseTo(0, 4);
  });
});
