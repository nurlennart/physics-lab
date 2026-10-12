import { layoutEquipment } from '../editor/spatial-layout';
import { describe, expect, it } from 'vitest';
import { starter, parseProject, serializeProject } from './projects';
import { makeComponent, catalog, connect, connectionError, type Probe } from './model';
import { compatibleTarget, measurements } from './capabilities';
import { readProbe } from './measurements';
import { Simulation } from './engine';
import { Automation } from './automation';
import { Builder } from './scaling-validation';

const probe = (id: string, measurement: Probe['measurement']) => ({ component: id, measurement } as Probe);
describe('functional integration regressions', () => {
  it('standard induction motor draws ~97 A RMS inrush at startup; both the standard and the 250 A supply run 35 Nm load', () => {
    const p = starter('induction'), motor = p.components.find(c => c.kind === 'inductionMotor')!, source = p.components.find(c => c.kind === 'source3')!;
    const s = new Simulation(parseProject(JSON.parse(serializeProject(p))));
    // Winding current cannot jump: before the first step only the resistive iron-loss current V/Rc flows.
    expect(s.electrical.readings[motor.id].current / (400 / Math.sqrt(3) / Number(motor.props.coreResistance)) - 1).toBeLessThan(1e-4); // supply impedance drop
    let inrush = 0;
    for (let i = 0; i < 6; i++) { expect(s.step()).toBe(true); inrush = Math.max(inrush, s.electrical.readings[motor.id].current); }
    expect(inrush).toBeGreaterThan(85);
    expect(inrush).toBeLessThan(110);
    expect(s.electrical.readings[motor.id].phases).toBe(3);
    for (let i = 0; i < 594; i++) expect(s.step()).toBe(true);
    expect(s.failed).toEqual({});
    expect(readProbe(probe(motor.id, 'rpm'), s)).toBeGreaterThan(1400);
    expect(s.electrical.readings[motor.id].current).toBeLessThan(Number(motor.props.ratedCurrent));
    expect(s.multiphysics.motors[motor.id].shaftPower).toBeGreaterThan(5000);
    expect(Math.abs(s.energyResidual / s.suppliedEnergy)).toBeLessThan(1e-4);
    // The standard 63 A supply tolerates the ~1.2 × In starting surge (thermal-magnetic output protection).
    source.variant = 'standard'; source.props = { ...catalog(source).props };
    const standard = new Simulation(p);
    for (let i = 0; i < 600; i++) expect(standard.step()).toBe(true);
    expect(standard.failed).toEqual({});
    expect(readProbe(probe(motor.id, 'rpm'), standard)).toBeGreaterThan(1400);
  });
  it('flow menus include PRV and exchanger branches, exclude tanks and junctions', () => {
    const sensor = makeComponent('flowSensor', 0, 0, []);
    for (const kind of ['pipe', 'pump', 'valve', 'checkValve', 'actuatedValve', 'heatExchanger', 'pressureReducingValve'] as const) expect(compatibleTarget(sensor, makeComponent(kind, 0, 0, []))).toBe(true);
    for (const kind of ['tank', 'fluidJunction', 'source'] as const) expect(compatibleTarget(sensor, makeComponent(kind, 0, 0, []))).toBe(false);
  });
  it('pipe fluid temperature reaches sensor, controller and chart; body-only and missing targets are invalid', () => {
    const p = starter('circulation'), pipe = p.components.find(c => c.kind === 'pipe')!, sensor = makeComponent('sensor', 0, 0, p.components);
    sensor.props.target = pipe.id; p.components.push(sensor);
    const s = new Simulation(parseProject(JSON.parse(serializeProject(p))));
    s.advanceAdaptive(5);
    expect(s.automation.sensors[sensor.id].valid).toBe(true);
    expect(Number(s.automation.sensors[sensor.id].value)).toBeCloseTo(readProbe(probe(pipe.id, 'fluidTemperature'), s)!, 0);
    expect(s.automation.signals[sensor.id].valid).toBe(true);
    sensor.props.quantity = 'temperature';
    expect(compatibleTarget(sensor, pipe)).toBe(false);
    expect(() => serializeProject(p)).toThrow(/compatible modeled quantity/);
    const world = { project: p, time: 0, temperatures: { [pipe.id]: 0 }, faults: {}, failed: {}, disconnected: new Set<string>(), log() {} };
    expect(new Automation().sense(sensor, world, 0).valid).toBe(false);
    sensor.props.target = 'removed';
    expect(new Automation().sense(sensor, world, 0)).toMatchObject({ valid: false, value: null });
    expect(readProbe(probe(pipe.id, 'temperature'), s)).toBeNull();
  });
  it('pressure points retain SI control units and chart conversion, empty water remains unavailable', () => {
    const p = starter('transfer'), pipe = p.components.find(c => c.kind === 'pipe')!, sensor = makeComponent('pressureSensor', 0, 0, p.components);
    sensor.props.target = pipe.id; sensor.props.quantity = 'inletPressure'; p.components.push(sensor);
    const s = new Simulation(p); for (let i = 0; i < 60; i++) s.step();
    // Controllers sample before the physical integration step; compare a fresh sensor sample at the chart time.
    expect(Number(s.automation.sense(s.project.components.find(c => c.id === sensor.id)!, s, 0).value) / 100000).toBeCloseTo(readProbe(probe(pipe.id, 'inletPressure'), s)!, 7);
    const tank = p.components.find(c => c.kind === 'tank')!;
    s.multiphysics.tanks[tank.id].mass = 0;
    expect(s.fluidTemperatureMeasurement(tank.id)).toBeUndefined();
    expect(readProbe(probe(tank.id, 'fluidTemperature'), s)).toBeNull();
    expect(measurements(tank)).not.toContain('flow');
  });
  it('AC supply rating compares apparent power, and its probe reports delivered real power', () => {
    const b = new Builder(), src = b.add('sourceAC', { maxPower: 100, maxCurrent: 100 }), l = b.add('inductor', { inductance: 0.5 }); b.series(src, l);
    const s = new Simulation(b.p); s.step();
    expect(s.violations.some(v => v.includes('apparent power'))).toBe(true);
    expect(readProbe(probe(src.id, 'power'), s)).toBeGreaterThan(0);
  });
});

it('sensor sampling interval holds values, but faults and missing targets invalidate immediately', () => {
  const sensor = makeComponent('sensor', 0, 0, []), tank = makeComponent('tank', 0, 0, [sensor]);
  sensor.props.target = tank.id; sensor.props.sampleInterval = 1;
  const a = new Automation(), world = { project: { version: 3 as const, id: 'p', name: 'sampling', components: [sensor, tank], connections: [] }, time: 0, temperatures: { [tank.id]: 20 }, faults: {}, failed: {}, disconnected: new Set<string>(), log() {} };
  expect(a.sense(sensor, world, 0).value).toBe(20);
  world.time = 0.5; world.temperatures[tank.id] = 30;
  expect(a.sense(sensor, world, 0.5).value).toBe(20);
  world.time = 1;
  expect(a.sense(sensor, world, 0.5).value).toBe(30);
  world.project.components = [sensor];
  expect(a.sense(sensor, world, 0).valid).toBe(false);
  world.project.components.push(tank);
  expect(a.sense(sensor, world, 0).value).toBe(30);
});
it('heat exchanger sensors and chart probes select either stream without inventing body state', () => {
  const p = starter('exchanger'), hx = p.components.find(c => c.kind === 'heatExchanger')!, sensor = makeComponent('sensor', 0, 0, p.components);
  sensor.props.target = hx.id; sensor.props.stream = 'cold'; p.components.push(sensor);
  const s = new Simulation(p); s.advanceAdaptive(2);
  const cold = readProbe({ ...probe(hx.id, 'fluidTemperature'), port: 'cold' }, s)!;
  const hot = readProbe({ ...probe(hx.id, 'fluidTemperature'), port: 'hot' }, s)!;
  expect(cold).toBeLessThan(hot);
  expect(Number(s.automation.sensors[sensor.id].value)).toBeCloseTo(cold, 0);
  expect(readProbe(probe(hx.id, 'bodyTemperature'), s)).toBeNull();
});
it('paused hydraulic refresh and fault recovery preserve valid fluid sensors and chart readings', () => {
  const p = starter('circulation'), pipe = p.components.find(c => c.kind === 'pipe')!, sensor = makeComponent('sensor', 0, 0, p.components);
  sensor.props.target = pipe.id; p.components.push(sensor);
  const s = new Simulation(p);
  expect(s.automation.sensors[sensor.id].valid).toBe(true);
  s.advanceAdaptive(2);
  expect(s.injectFault(sensor.id, 'sensorFault')).toBeNull();
  expect(s.automation.sensors[sensor.id].valid).toBe(false);
  expect(readProbe(probe(pipe.id, 'fluidTemperature'), s)).not.toBeNull();
  const pump = p.components.find(c => c.kind === 'pump')!;
  expect(readProbe(probe(pump.id, 'npsh'), s)).not.toBeNull();
  expect(s.injectFault(sensor.id, null)).toBeNull();
  expect(s.automation.sensors[sensor.id].valid).toBe(true);
  expect(readProbe(probe(pipe.id, 'fluidTemperature'), s)).not.toBeNull();
});
it('induction nameplate voltage compares line voltage, not the lower phase voltage', () => {
  const p = starter('induction'), source = p.components.find(c => c.kind === 'source3')!;
  source.variant = 'mv690'; source.props = { ...catalog(source).props };
  const s = new Simulation(p); s.step();
  expect(s.violations.some(v => v.includes('voltage rating'))).toBe(true);
});
it('AC RLC example remains inside catalog thermal limits and measures whole-circuit reactive power', () => {
  const p = starter('acRlc'), s = new Simulation(p);
  s.advanceAdaptive(60);
  expect(s.failed).toEqual({}); expect(s.violations).toEqual([]);
  expect(readProbe(p.probes!.find(p => p.measurement === 'powerFactor')!, s)).toBeGreaterThan(0.95);
  expect(readProbe(p.probes!.find(p => p.measurement === 'reactivePower')!, s)).toBeGreaterThan(20);
});
it('legacy unavailable traces survive save/load as invalid rather than fabricated zero readings', () => {
  const p = starter('transfer'), motor = p.components.find(c => c.kind === 'motor')!, tank = p.components.find(c => c.kind === 'tank')!;
  p.probes!.push({ id: 'old-flow', name: 'Old tank branch flow', component: tank.id, measurement: 'flow', color: '#ffffff', visible: true }, { id: 'old-power', name: 'Old motor hydraulic power', component: motor.id, measurement: 'hydraulicPower', color: '#ffffff', visible: true });
  const loaded = parseProject(JSON.parse(serializeProject(p))), s = new Simulation(loaded);
  for (const id of ['old-flow', 'old-power']) expect(readProbe(loaded.probes!.find(p => p.id === id)!, s)).toBeNull();
});

it('motor speed measurements use the shaft rather than the static physical housing', () => {
  const p = layoutEquipment(starter('rotor')), motor = p.components.find(c => c.kind === 'motor')!, sensor = makeComponent('speedSensor', 0, 0, p.components);
  sensor.props.target = motor.id; p.components.push(sensor);
  const s = new Simulation(p); for (let i = 0; i < 120; i++) s.step();
  expect(s.spatial.readings[motor.id].omega).toBe(0);
  expect(s.mechanicalMeasurement(motor.id, 'rpm')).toBeGreaterThan(100);
  expect(readProbe(probe(motor.id, 'rpm'), s)).toBeCloseTo(s.multiphysics.motors[motor.id].omega * 30 / Math.PI, 8);
  expect(Number(s.automation.sense(s.project.components.find(c => c.id === sensor.id)!, s, 0).value)).toBeCloseTo(readProbe(probe(motor.id, 'rpm'), s)!, 2);
});

it('tank overflow routing requires a physical pipe and transfers inventory to its receiver', () => {
  let p = starter('transfer');
  const dest = p.components.find(c => c.name === 'Destination tank')!;
  dest.props.volume = 119;
  const receiver = makeComponent('tank', 900, 600, p.components);
  receiver.props = { ...receiver.props, capacity: 500, volume: 0, elevation: -1, surfaceArea: 1 };
  p.components.push(receiver);
  expect(connectionError(p, { component: dest.id, port: 'fluid' }, { component: receiver.id, port: 'fluid' })).toMatch(/physical pipe/);
  expect(connectionError(p, { component: dest.id, port: 'overflow' }, { component: receiver.id, port: 'overflow' })).toMatch(/another overflow/);
  expect(connectionError(p, { component: dest.id, port: 'overflow' }, { component: receiver.id, port: 'fluid' })).toMatch(/including overflow/);
  const drain = makeComponent('pipe', 650, 600, p.components);
  drain.props = { ...drain.props, diameter: 0.05, length: 2, inventory: false };
  p.components.push(drain);
  p = connect(p, { component: dest.id, port: 'overflow' }, { component: drain.id, port: 'inlet' });
  p = connect(p, { component: drain.id, port: 'outlet' }, { component: receiver.id, port: 'fluid' });
  const s = new Simulation(parseProject(JSON.parse(serializeProject(p))));
  s.advanceAdaptive(10);
  expect(s.error).toBeNull();
  expect(s.multiphysics.overflowRate[dest.id]).toBeGreaterThan(0);
  expect(s.multiphysics.tanks[receiver.id].volume).toBeGreaterThan(0.001);
  expect(Math.abs(s.multiphysics.massResidual)).toBeLessThan(1e-6);
});
