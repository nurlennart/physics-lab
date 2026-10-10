import { describe, expect, it } from 'vitest';
import { Simulation, FixedClock } from './engine';
import { makeComponent, connect, uid, type Project, type Component } from './model';
import { defaultWorld, makeSpatial, configuredMass, materials, spatialError } from './spatial-model';
import { makeJoint, mechanicalStarter } from './spatial-projects';
import { parseProject, serializeProject } from './projects';
import { transitionError } from './integrity';
import { replayExperiment, createRunArchive, restoreRunArchive } from './replay';
import { hydraulicStarter } from './hydraulic-projects';
import { readProbe } from './measurements';
import type { Probe } from './model';
const blank = (gravity = -9.80665): Project => ({ version: 4, id: uid(), name: 'Mechanical reference', components: [], connections: [], world: { ...defaultWorld(), gravity: { x: 0, y: gravity } }, probes: [], assemblies: [] });
function body(p: Project, x = 0, y = 5, overrides: Partial<NonNullable<Component['spatial']>> = {}) { const c = makeComponent('rigidBody', 0, 0, p.components); c.spatial = { ...makeSpatial('rectangle', x, y), mass: 1, collision: false, ...overrides }; p.components.push(c); return c; }
function run(s: Simulation, t: number, dt = 1 / 60) { for (let i = 0; i < Math.round(t / dt); i++) { if (!s.step(dt)) throw Error(s.error ?? 'step failed'); } return s; }

describe('spatial SI mechanics', () => {
  it('matches free fall and fixed rendering-independent scheduling', () => {
    const p = blank(), c = body(p), s = run(new Simulation(p), 1), r = s.spatial.readings[c.id];
    expect(r.vy).toBeCloseTo(-9.80665, 8);
    expect(r.y).toBeCloseTo(5 - 0.5 * 9.80665, 1);
    expect(Math.abs(s.energyResidual)).toBeLessThan(0.21);
    const a = new Simulation(p), b = new Simulation(p), ca = new FixedClock(), cb = new FixedClock();
    for (let i = 0; i < 30; i++) ca.advance(1 / 30, 1, true, () => a.step());
    for (let i = 0; i < 144; i++) cb.advance(1 / 144, 1, true, () => b.step());
    expect(a.spatial.readings).toEqual(b.spatial.readings);
  });
  it('derives SI mass and inertia from depth/material, and accelerates under torque', () => {
    const p = blank(0), c = body(p, 0, 0, { shape: 'circle', width: 0.4, height: 0.4, depth: 0.02, mass: 0 });
    c.props.appliedTorque = 2;
    const mass = configuredMass(c.spatial!), s = run(new Simulation(p), 1), b = s.spatial.readings[c.id];
    expect(b.mass).toBeCloseTo(Math.PI * 0.2 ** 2 * 0.02 * materials.aluminum.density, 8);
    expect(b.inertia).toBeCloseTo(0.5 * mass * 0.2 ** 2, 8);
    expect(b.omega).toBeCloseTo(2 / b.inertia, 7);
    expect(Math.abs(s.energyResidual)).toBeLessThan(1e-7);
  });
  it('collides, conserves linear momentum and accounts for restitution loss', () => {
    for (const restitution of [0, 1]) {
      const p = blank(0), custom = { ...materials.steel, density: 1000, friction: 0, restitution };
      const a = body(p, -1, 0, { shape: 'circle', width: 0.5, height: 0.5, vx: 2, collision: true, material: 'custom', custom }), b = body(p, 1, 0, { shape: 'circle', width: 0.5, height: 0.5, vx: -1, collision: true, material: 'custom', custom });
      const s = run(new Simulation(p), 1), ra = s.spatial.readings[a.id], rb = s.spatial.readings[b.id];
      expect(ra.vx + rb.vx).toBeCloseTo(1, 8);
      expect(ra.vx).toBeCloseTo(restitution ? -1 : 0.5, 7);
      expect(s.spatial.kinetic + s.spatial.contactLoss).toBeCloseTo(2.5, 7);
      expect(Math.abs(s.energyResidual)).toBeLessThan(1e-6);
    }
  });
  it('rests on a platform, sleeps and applies collision filtering', () => {
    const p = blank(), floor = body(p, 0, -0.25, { type: 'static', width: 10, height: 0.5, collision: true }), c = body(p, 0, 2, { collision: true });
    const s = run(new Simulation(p), 5);
    expect(s.spatial.readings[c.id].y).toBeCloseTo(0.515, 2);
    expect(s.spatial.readings[c.id].vy).toBeCloseTo(0, 7);
    expect(s.spatial.readings[c.id].awake).toBe(false);
    const filtered = structuredClone(p); filtered.components.find(x => x.id === floor.id)!.spatial!.mask = 0;
    expect(run(new Simulation(filtered), 1).spatial.readings[c.id].y).toBeLessThan(0);
  });
  it('oscillates at sqrt(k/m), with explicit spring potential and damping heat', () => {
    const p = blank(0), anchor = body(p, 0, 0, { type: 'static' }), c = body(p, 2.2, 0);
    const spring = makeJoint(p, 'spring', anchor, c, { x: 0, y: 0 }, { x: 2.2, y: 0 }); spring.length = 2; spring.stiffness = 25; spring.damping = 0; p.world!.joints.push(spring);
    const s = new Simulation(p), crossings: number[] = []; let last = 0.2;
    for (let i = 0; i < 5 * 60; i++) { s.step(); const value = s.spatial.readings[c.id].x - 2; if (last > 0 && value <= 0) crossings.push(s.time); last = value; }
    expect(crossings[1] - crossings[0]).toBeCloseTo(2 * Math.PI / 5, 1);
    expect(Math.abs(s.energyResidual)).toBeLessThan(0.02);
    spring.damping = 1; const damped = run(new Simulation(p), 5);
    expect(damped.spatial.dampingLoss).toBeGreaterThan(0.4);
    expect(damped.spatial.springEnergy).toBeLessThan(0.01);
  });
  it('keeps fixed, revolute, distance and prismatic constraints functional', () => {
    for (const kind of ['fixed', 'revolute', 'distance', 'prismatic'] as const) {
      const p = blank(), anchor = body(p, 0, 5, { type: 'static' }), c = body(p, 0, 3);
      const j = makeJoint(p, kind, anchor, c, { x: 0, y: 5 }, kind === 'distance' ? { x: 0, y: 3 } : { x: 0, y: 5 });
      if (kind === 'prismatic') { j.limits = true; j.lower = -1; j.upper = 1; } p.world!.joints.push(j);
      const s = run(new Simulation(p), 2), r = s.spatial.readings[c.id];
      expect(r.x).toBeCloseTo(0, 5); expect(s.spatial.jointReadings[j.id]).toBeDefined();
      if (kind === 'prismatic') expect(r.y).toBeGreaterThan(1.99); else expect(r.y).toBeCloseTo(3, 2);
    }
  });
});
describe('unified spatial engineering', () => {
  it('uses a shared motor/body speed and counts rotor inertia once', () => {
    const p = mechanicalStarter('rotor'), motor = p.components.find(c => c.kind === 'motor')!, rotor = p.components.find(c => c.name === 'Driven rotor')!;
    const s = run(new Simulation(p), 3), m = s.multiphysics.motors[motor.id], b = s.spatial.readings[rotor.id];
    expect(m.omega).toBe(b.omega); expect(b.omega).toBeGreaterThan(50);
    expect(b.angle).toBeGreaterThan(2 * Math.PI);
    expect(s.multiphysics.kineticEnergy(p)).toBe(0);
    const expectedInertia = configuredMass(rotor.spatial!) * 0.2 ** 2 / 2 + Number(motor.props.inertia);
    expect(b.inertia).toBeCloseTo(expectedInertia, 8);
    expect(Math.abs(s.energyResidual)).toBeLessThan(0.001);
    expect(m.load).toBeCloseTo(m.torque - Number(motor.props.friction) * (m.omega - m.acceleration / 960) - Number(motor.props.inertia) * m.acceleration, 6);
    expect(m.shaftPower).toBeCloseTo(m.load * (m.omega - m.acceleration / 960), 6);
    const loaded = structuredClone(p); loaded.components.find(c => c.kind === 'forceActuator')!.props.damping = 0.02;
    const load = run(new Simulation(loaded), 3);
    expect(load.multiphysics.motors[motor.id].current).toBeGreaterThan(m.current);
    expect(load.spatial.readings[rotor.id].omega).toBeLessThan(b.omega);
  });
  it('shares a motor-pump-rotor shaft without changing fluid or electrical ownership', () => {
    let p = hydraulicStarter('transfer'); p.version = 4; p.world = defaultWorld();
    const anchor = body(p, 4, 1, { type: 'static' }), rotor = body(p, 4, 3, { shape: 'wheel', width: 0.3, height: 0.3, mass: 0.5 });
    p.world.joints.push(makeJoint(p, 'revolute', anchor, rotor, { x: 4, y: 3 }));
    const motor = p.components.find(c => c.kind === 'motor')!, pump = p.components.find(c => c.kind === 'pump')!;
    p = connect(p, { component: motor.id, port: 'shaft' }, { component: rotor.id, port: 'shaft' });
    const s = run(new Simulation(p), 3);
    expect(s.spatial.readings[rotor.id].omega).toBe(s.multiphysics.motors[motor.id].omega);
    expect(s.multiphysics.hydraulic.readings[pump.id].flow).toBeGreaterThan(0);
    expect(Math.abs(s.energyResidual)).toBeLessThan(0.1);
    expect(Math.abs(s.multiphysics.massResidual)).toBeLessThan(1e-7);
  });
  it('persists geometry and replays impulses, shaft/controller state and fault coasting', async () => {
    const p = mechanicalStarter('rotor'), s = run(new Simulation(p), 1), rotor = p.components.find(c => c.name === 'Driven rotor')!, motor = p.components.find(c => c.kind === 'motor')!;
    expect(parseProject(JSON.parse(serializeProject(p)))).toEqual(p);
    const inputs = [{ at: s.time, impulse: { id: rotor.id, x: 0, y: 0, angular: 0.3 } }, { at: 2, fault: { id: motor.id, type: 'powerLoss' as const } }];
    s.applyImpulse(rotor.id, { x: 0, y: 0 }, 0.3); run(s, 1); s.injectFault(motor.id, 'powerLoss'); run(s, 1);
    const replay = replayExperiment(p, inputs, 3);
    expect(replay.spatial.readings).toEqual(s.spatial.readings);
    expect(replay.multiphysics.motors).toEqual(s.multiphysics.motors);
    const restored = await restoreRunArchive(createRunArchive(p, p, inputs, 3), async () => {});
    expect(restored.simulation.spatial.readings).toEqual(s.spatial.readings);
  });
  it('rejects invalid geometry, dangling references, unsupported moving tanks and live mass edits', () => {
    const p = mechanicalStarter('mechanism'), c = p.components.find(c => c.name === 'Falling block')!, next = structuredClone(p);
    next.components.find(x => x.id === c.id)!.spatial!.mass = 100;
    expect(transitionError(p, next, 1)).toMatch(/Reset.*Build/);
    next.world!.joints[0].a = 'missing'; expect(spatialError(next)).toMatch(/bodies/);
    const fluid = hydraulicStarter('transfer'), tank = fluid.components.find(c => c.kind === 'tank')!; tank.spatial = makeSpatial();
    expect(spatialError(fluid)).toMatch(/mounted static/);
    c.spatial!.shape = 'polygon'; c.spatial!.vertices = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.2, y: 0.1 }, { x: 0, y: 1 }]; expect(spatialError(p)).toMatch(/convex/);
  });
  it('exposes actual spatial probes and the same thermal state for represented equipment', () => {
    const p = hydraulicStarter('circulation'), motor = p.components.find(c => c.kind === 'motor')!; motor.spatial = { ...makeSpatial(), type: 'static' };
    const s = run(new Simulation(p), 1);
    expect(readProbe({ component: motor.id, measurement: 'temperature' } as Probe, s)).toBe(s.temperatures[motor.id]);
    expect(readProbe({ component: motor.id, measurement: 'positionY' } as Probe, s)).toBe(3);
  });
});
