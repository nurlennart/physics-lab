import { expect, it } from 'vitest';
import { Simulation } from './engine';
import { makeComponent, uid, connect, type Component, type Project } from './model';
import { defaultWorld, makeSpatial, materials, spatialError, configuredMass } from './spatial-model';
import { mechanicalStarter, makeJoint } from './spatial-projects';
import { challengeDefinition } from './challenges';
const mechanicalChallengeError = (p: Parameters<NonNullable<ReturnType<typeof challengeDefinition>['validate']>>[0]) => challengeDefinition(p.challenge!).validate!(p);
import { captureAssembly, insertAssembly } from '../editor/assemblies';
import { parseProject, serializeProject } from './projects';
import { transitionError } from './integrity';
import { readProbe } from './measurements';
const blank = (): Project => ({ version: 4, id: uid(), name: 'Integration', components: [], connections: [], world: { ...defaultWorld(), gravity: { x: 0, y: 0 } } });
function add(p: Project, x: number, y: number, config: Partial<NonNullable<Component['spatial']>> = {}) { const c = makeComponent('rigidBody', 0, 0, p.components); c.spatial = { ...makeSpatial('rectangle', x, y), mass: 1, ...config }; p.components.push(c); return c; }
function run(s: Simulation, seconds: number) { for (let i = 0; i < Math.round(seconds * 60); i++) expect(s.step(), s.error ?? '').toBe(true); return s; }

it('conserves isolated angular momentum in an off-center frictionless collision', () => {
  const p = blank(), material = { ...materials.steel, friction: 0, restitution: 1 };
  const a = add(p, -1, 0.15, { shape: 'circle', width: 0.5, height: 0.5, vx: 2, material: 'custom', custom: material }), b = add(p, 1, -0.15, { shape: 'circle', width: 0.5, height: 0.5, vx: -1, material: 'custom', custom: material });
  const s = new Simulation(p), angular = () => Object.values(s.spatial.readings).reduce((v, r) => v + r.mass * (r.cx * r.vy - r.cy * r.vx) + r.inertia * r.omega, 0), before = angular();
  run(s, 1); expect(angular()).toBeCloseTo(before, 6); expect(s.spatial.readings[a.id].vx).toBeLessThan(2); expect(s.spatial.readings[b.id].vx).toBeGreaterThan(-1);
});
it('models frictional sliding with impulse-work heat and continuous thin-wall collision', () => {
  const p = blank(); p.world!.gravity.y = -9.80665;
  add(p, 0, -0.25, { type: 'static', width: 20, height: 0.5 }); const c = add(p, 0, 0.515, { vx: 3, fixedRotation: true });
  const s = run(new Simulation(p), 2); expect(Math.abs(s.spatial.readings[c.id].vx)).toBeLessThan(0.1); expect(s.spatial.contactLoss).toBeGreaterThan(4);
  const q = blank(); add(q, 0, 0, { type: 'static', width: 0.05, height: 3 }); const projectile = add(q, -1, 0, { shape: 'circle', width: 0.1, height: 0.1, vx: 100, bullet: true });
  const hit = run(new Simulation(q), 0.05); expect(hit.spatial.readings[projectile.id].x).toBeLessThan(0); expect(hit.spatial.maxImpactSpeed).toBeGreaterThan(90);
});
it('moves kinematic equipment with accounted contact work and rejects unsupported driven joints', () => {
  const p = blank(), driver = add(p, -1, 0, { type: 'kinematic', vx: 1 }), load = add(p, 0.5, 0);
  const s = run(new Simulation(p), 1); expect(s.spatial.readings[driver.id].x).toBeCloseTo(0, 7); expect(s.spatial.readings[load.id].vx).toBeGreaterThan(0.9); expect(s.spatial.externalWork).toBeGreaterThan(0);
  expect(Math.abs(s.energyResidual)).toBeLessThan(0.01);
  p.world!.joints.push(makeJoint(p, 'fixed', driver, load, { x: 0, y: 0 })); expect(spatialError(p)).toMatch(/kinematic/);
});
it('uses every material density and an asymmetric polygon center of mass correctly', () => {
  for (const material of Object.keys(materials) as (keyof typeof materials)[]) { const p = blank(), c = add(p, 0, 0, { width: 0.2, height: 0.3, depth: 0.01, material, mass: 0 }); expect(new Simulation(p).spatial.readings[c.id].mass).toBeCloseTo(materials[material].density * 0.0006, 8); }
  const p = blank(), c = add(p, 2, 3, { shape: 'polygon', vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }], mass: 3 });
  const r = new Simulation(p).spatial.readings[c.id]; expect(r.cx).toBeCloseTo(2 + 1 / 3, 8); expect(r.cy).toBeCloseTo(3 + 1 / 3, 8); expect(r.inertia).toBeCloseTo(1 / 3, 8);
});
it('preserves complete assembly joints and omits a copied shaft when its bearing is omitted', () => {
  const p = mechanicalStarter('lift'), full = captureAssembly(p, p.components.map(c => c.id)), copy = insertAssembly(p, full);
  expect(spatialError(copy)).toBeNull(); expect(parseProject(JSON.parse(serializeProject(copy)))).toEqual(copy);
  const rotor = p.components.find(c => c.name === 'Driven rotor')!, motor = p.components.find(c => c.kind === 'motor')!;
  const partial = captureAssembly(p, [rotor.id, motor.id]); expect(partial.connections).toHaveLength(0); expect(spatialError(insertAssembly(p, partial))).toBeNull();
});
it('uses a real control signal for force and separates multiple actuator measurements', () => {
  let p = blank(); const b = add(p, 0, 0, { collision: false }), a = makeComponent('forceActuator', 0, 0, p.components), second = makeComponent('forceActuator', 0, 0, p.components), signal = makeComponent('constant', 0, 0, p.components);
  a.props = { ...a.props, target: b.id, axis: 'y' }; second.props = { ...second.props, target: b.id, axis: 'x', value: 4 }; signal.props.value = 3; p.components.push(a, second, signal); p = connect(p, { component: signal.id, port: 'out' }, { component: a.id, port: 'in' });
  const s = run(new Simulation(p), 1); expect(s.spatial.readings[b.id].vy).toBeCloseTo(3, 7); expect(s.spatial.readings[b.id].vx).toBeCloseTo(4, 7);
  expect(readProbe({ id: uid(), name: 'A', component: a.id, measurement: 'appliedForce', visible: true, color: '#fff' }, s)).toBe(3);
});
it('responds to motor stall, power failure and sensor failure without scripted body velocity', () => {
  const p = mechanicalStarter('rotor'), m = p.components.find(c => c.kind === 'motor')!, rotor = p.components.find(c => c.name === 'Driven rotor')!;
  m.props.speedControl = false; const bearing = p.world!.joints.find(j => j.kind === 'revolute')!; bearing.limits = true; bearing.lower = bearing.upper = 0;
  const stalled = run(new Simulation(p), 0.1); expect(Math.abs(stalled.spatial.readings[rotor.id].omega)).toBeLessThan(0.01); expect(stalled.multiphysics.motors[m.id].current).toBeGreaterThan(20);
  const normal = mechanicalStarter('rotation'), motor = normal.components.find(c => c.kind === 'motor')!, wheel = normal.components.find(c => c.name === 'Driven rotor')!, sensor = normal.components.find(c => c.kind === 'speedSensor')!;
  const s = run(new Simulation(normal), 2), speed = s.spatial.readings[wheel.id].omega; s.injectFault(motor.id, 'powerLoss'); expect(s.spatial.readings[wheel.id].omega).toBe(speed); run(s, 0.1); expect(s.spatial.readings[wheel.id].omega).toBeLessThan(speed); expect(s.multiphysics.motors[motor.id].current).toBe(0);
  const sensed = run(new Simulation(normal), 1); sensed.injectFault(sensor.id, 'sensorFault'); run(sensed, 0.1); expect(sensed.automation.signals[sensor.id]?.valid).toBe(false);
});
it('rejects mechanical challenge refilling analogues, rating exploits and live edits', () => {
  const p = mechanicalStarter('lift'); p.challenge = 'lift'; expect(mechanicalChallengeError(p)).toBeNull();
  const load = p.components.find(c => c.name === 'Lift load')!; const n = structuredClone(p); n.components.find(c => c.id === load.id)!.spatial!.mass = 1; expect(mechanicalChallengeError(n)).toMatch(/locked/);
  const force = structuredClone(p); force.components.find(c => c.id === load.id)!.props.forceY = 1000; expect(mechanicalChallengeError(force)).toMatch(/free body forces/);
  const rated = structuredClone(p); rated.components.find(c => c.kind === 'motor')!.props.ratedCurrent = 1e9; expect(mechanicalChallengeError(rated)).toBeTruthy();
  const live = structuredClone(p); live.components.find(c => c.kind === 'pid')!.props.reference = 4; expect(transitionError(p, live, 1)).toBeTruthy();
  const imported = structuredClone(p); imported.world!.joints[0].b = 'missing'; expect(() => parseProject(imported)).toThrow();
  const range = structuredClone(p); const sensor = range.components.find(c => c.kind === 'positionSensor')!; sensor.props.minRange = 10; sensor.props.maxRange = 0; expect(() => parseProject(range)).toThrow(/sensor range/);
});
it('links only explicit static tank elevation and resets spatial initial conditions', () => {
  const p = blank(), tank = makeComponent('tank', 0, 0, []); tank.spatial = { ...makeSpatial('rectangle', 2, 4), type: 'static', elevationLinked: true, elevationOffset: 1 }; tank.props.elevation = 5; p.components.push(tank);
  expect(spatialError(p)).toBeNull(); tank.props.elevation = 2; expect(spatialError(p)).toMatch(/elevation/);
  const q = mechanicalStarter('mechanism'), s = run(new Simulation(q), 1); s.reset(q); expect(s.time).toBe(0); for (const c of q.components.filter(c => c.spatial)) { expect(s.spatial.readings[c.id].x).toBe(c.spatial!.x); expect(s.spatial.readings[c.id].y).toBe(c.spatial!.y); }
  expect(configuredMass(q.components.find(c => c.name === 'Spring mass')!.spatial!)).toBe(2);
});
