import { World, Body, Box, Circle, Polygon, Vec2, WeldJoint, RevoluteJoint, PrismaticJoint, DistanceJoint, GearJoint, Serializer, type Joint, type Contact, type ContactImpulse, type MassData } from 'planck';
import { isMotor, prop, type Project, type Point } from './model';
import { configuredMass, materialOf, defaultWorld, shaftBody, type MechanicalJoint } from './spatial-model';
import type { Simulation } from './engine';
export interface BodyReading { x: number; y: number; cx: number; cy: number; angle: number; vx: number; vy: number; omega: number; mass: number; inertia: number; ax: number; ay: number; forceX: number; forceY: number; torque: number; kinetic: number; potential: number; awake: boolean; contactImpulse: number }
export interface JointReading { anchorA: Point; anchorB: Point; force: Point; torque: number; coordinate: number; speed: number; extension: number }
export interface ContactReading { a: string; b: string; point: Point; normal: Point; normalImpulse: number; tangentImpulse: number; impactSpeed: number }
interface Force { x: number; y: number; torque: number; dampingX: number; dampingY: number; dampingT: number }
interface Trial { world: World; bodies: Record<string, Body>; joints: Record<string, Joint>; contacts: ContactReading[]; forces: Record<string, Force>; old: Record<string, BodyReading>; duration: number; actuatorForces: Record<string, number>; springDamping: { id: string; a: string; b: string; direction: Point; damping: number; va: Point; vb: Point }[] }
export interface SpatialCheckpoint { json: object[]; }
const serializer = new Serializer<World>({ rootClass: World,
  postSerialize(data, object) {
    if (object instanceof Body) { const mass: MassData = { mass: 0, center: Vec2(), I: 0 }; object.getMassData(mass); return { ...data, userData: object.getUserData(), angle: object.getAngle(), massData: mass, fixedRotation: object.isFixedRotation(), awake: object.isAwake(), sleepingAllowed: object.isSleepingAllowed() }; }
    if (object instanceof GearJoint) return { ...data, userData: object.getUserData(), gearConstant: (object as unknown as { m_constant: number }).m_constant };
    if (object && typeof object.getUserData === 'function') return { ...data, userData: object.getUserData() };
    return data;
  },
  postDeserialize(object, data) {
    if (object instanceof Body) { object.setUserData(data.userData); object.setFixedRotation(data.fixedRotation); if (object.isDynamic()) object.setMassData(data.massData); object.setSleepingAllowed(data.sleepingAllowed); object.setAwake(data.awake); const sweep = (object as unknown as { m_sweep: { a: number; a0: number } }).m_sweep; sweep.a = sweep.a0 = data.angle; }
    else if (object && typeof object.setUserData === 'function') { object.setUserData(data.userData); if (object instanceof GearJoint) (object as unknown as { m_constant: number }).m_constant = data.gearConstant; }
    return object;
  },
});
function index(world: World) { const bodies: Record<string, Body> = {}, joints: Record<string, Joint> = {}; for (let b = world.getBodyList(); b; b = b.getNext()) bodies[String(b.getUserData())] = b; for (let j = world.getJointList(); j; j = j.getNext()) joints[String(j.getUserData())] = j; return { bodies, joints }; }
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const sub = (a: Point, b: Point) => ({ x: a.x - b.x, y: a.y - b.y });
function velocityAt(r: BodyReading, p: Point) { return { x: r.vx - r.omega * (p.y - r.cy), y: r.vy + r.omega * (p.x - r.cx) }; }
export class SpatialDynamics {
  world = new World(Vec2(0, -9.80665));
  bodies: Record<string, Body> = {};
  joints: Record<string, Joint> = {};
  readings: Record<string, BodyReading> = {};
  jointReadings: Record<string, JointReading> = {};
  contacts: ContactReading[] = [];
  initialEnergy = 0;
  externalWork = 0;
  shaftWork = 0;
  contactLoss = 0;
  limitLoss = 0;
  dampingLoss = 0;
  brakeEnergy: Record<string, number> = {};
  actuatorReadings: Record<string, number> = {};
  maxImpactSpeed = 0;
  stepMs = 0;
  warnings: string[] = [];
  private lastContacts = new Set<string>();
  private stepped = false;
  private project!: Project;
  initialize(p: Project) {
    this.project = p; this.world = new World({ gravity: p.world?.gravity ?? defaultWorld().gravity, allowSleep: true, continuousPhysics: true });
    for (const c of p.components.filter(c => c.spatial)) {
      const b = c.spatial!, m = materialOf(b), body = this.world.createBody({ type: b.type, position: Vec2(b.x, b.y), angle: b.angle, linearVelocity: Vec2(b.vx, b.vy), angularVelocity: b.omega, fixedRotation: b.fixedRotation, bullet: b.bullet, userData: c.id });
      const shape = ['circle', 'wheel'].includes(b.shape) ? new Circle(b.width / 2) : b.shape === 'polygon' ? new Polygon(b.vertices!) : new Box(b.width / 2, b.height / 2);
      const sweep = (body as unknown as { m_sweep: { a: number; a0: number } }).m_sweep; sweep.a = sweep.a0 = b.angle;
      body.createFixture({ shape, density: m.density * b.depth, friction: m.friction, restitution: m.restitution, filterCategoryBits: b.collision ? b.category : 0, filterMaskBits: b.collision ? b.mask : 0 });
      if (body.isDynamic()) { const md: MassData = { mass: 0, center: Vec2(), I: 0 }; body.getMassData(md); const mass = configuredMass(b); body.setMassData({ ...md, mass, I: md.I * mass / md.mass }); }
    }
    Object.assign(this, index(this.world));
    // Rotor inertia appears exactly once, in the shared rigid body's mass matrix.
    for (const c of p.components.filter(isMotor)) {
      const id = shaftBody(p, c.id), body = id && this.bodies[id];
      if (body) { const md: MassData = { mass: 0, center: Vec2(), I: 0 }; body.getMassData(md); body.setMassData({ ...md, I: md.I + prop(c, 'inertia') }); }
    }
    for (const j of (p.world?.joints ?? []).filter(j => !['gear', 'spring'].includes(j.kind))) this.createJoint(j);
    for (const j of (p.world?.joints ?? []).filter(j => j.kind === 'gear')) this.createJoint(j);
    this.refresh(p); this.initialEnergy = this.energy;
  }
  private createJoint(j: MechanicalJoint) {
    const a = this.bodies[j.a], b = this.bodies[j.b], common = { bodyA: a, bodyB: b, localAnchorA: j.anchorA, localAnchorB: j.anchorB, collideConnected: j.collideConnected, userData: j.id };
    let joint: Joint;
    if (j.kind === 'fixed') joint = new WeldJoint({ ...common, referenceAngle: j.referenceAngle });
    else if (j.kind === 'revolute') joint = new RevoluteJoint({ ...common, referenceAngle: j.referenceAngle, enableLimit: j.limits, lowerAngle: j.lower, upperAngle: j.upper });
    else if (j.kind === 'prismatic') joint = new PrismaticJoint({ ...common, localAxisA: j.axis, referenceAngle: j.referenceAngle, enableLimit: j.limits, lowerTranslation: j.lower, upperTranslation: j.upper });
    else if (j.kind === 'gear') joint = new GearJoint({ bodyA: a, bodyB: b, joint1: this.joints[j.joint1!] as RevoluteJoint | PrismaticJoint, joint2: this.joints[j.joint2!] as RevoluteJoint | PrismaticJoint, ratio: j.ratio, userData: j.id });
    else joint = new DistanceJoint({ ...common, length: j.length, frequencyHz: 0 });
    this.joints[j.id] = this.world.createJoint(joint)!;
  }
  get count() { return Object.keys(this.bodies).length; }
  get hasMovingBodies() { return Object.values(this.bodies).some(b => !b.isStatic()); }
  get kinetic() { return Object.values(this.readings).reduce((sum, b) => sum + b.kinetic, 0); }
  get potential() { return Object.values(this.readings).reduce((sum, b) => sum + b.potential, 0); }
  get springEnergy() { return (this.project?.world?.joints ?? []).filter(j => j.kind === 'spring').reduce((sum, j) => { const a = this.bodies[j.a].getWorldPoint(j.anchorA), b = this.bodies[j.b].getWorldPoint(j.anchorB); return sum + 0.5 * j.stiffness * (Math.hypot(a.x - b.x, a.y - b.y) - j.length) ** 2; }, 0); }
  get energy() { return this.kinetic + this.potential + this.springEnergy; }
  get residual() { return this.externalWork + this.shaftWork - (this.energy - this.initialEnergy) - this.contactLoss - this.limitLoss - this.dampingLoss; }
  checkpoint(): SpatialCheckpoint { return { json: serializer.toJson(this.world) }; }
  restore(checkpoint: SpatialCheckpoint) { this.world = serializer.fromJson(checkpoint.json); Object.assign(this, index(this.world)); this.stepped = false; this.refresh(this.project); }
  maxStep(p: Project) {
    // Half the legacy shaft interval bounds semi-implicit gravity error in short drops.
    let h = this.hasMovingBodies ? 1 / 480 : 1 / 240;
    for (const c of p.components) {
      const b = c.spatial; if (!b || b.type !== 'dynamic') continue;
      const m = this.bodies[c.id]?.getMass() ?? configuredMass(b), I = this.bodies[c.id]?.getInertia() ?? 1;
      const damping = prop(c, 'brakeDamping'); if (damping > 0) h = Math.min(h, 0.2 * I / damping);
      for (const a of p.components.filter(a => a.kind === 'forceActuator' && a.props.target === c.id && prop(a, 'damping') > 0)) h = Math.min(h, 0.2 * (a.props.axis === 'torque' ? I : m) / prop(a, 'damping'));
      for (const j of (p.world?.joints ?? []).filter(j => j.kind === 'spring' && [j.a, j.b].includes(c.id))) h = Math.min(h, 0.15 * Math.sqrt(m / j.stiffness), j.damping > 0 ? 0.2 * m / j.damping : h);
    }
    if (h < 1 / 30000) throw Error('Mechanical stiffness/damping requires unsupported substeps. Reduce stiffness/damping or increase mass.');
    return h;
  }
  trial(s: Simulation, h: number, torques: Record<string, number>, checkpoint?: SpatialCheckpoint): Trial {
    const started = performance.now();
    const world = checkpoint ? serializer.fromJson(checkpoint.json) : this.world;
    const { bodies, joints } = checkpoint ? index(world) : this;
    const old = this.readWorld(bodies), forces: Record<string, Force> = {}, actuatorForces: Record<string, number> = {}, springDamping: Trial['springDamping'] = [];
    for (const c of s.project.components.filter(c => c.spatial)) {
      const r = old[c.id];
      forces[c.id] = { x: prop(c, 'forceX'), y: prop(c, 'forceY'), torque: prop(c, 'appliedTorque'), dampingX: 0, dampingY: 0, dampingT: prop(c, 'brakeDamping') };
      if (!r) throw Error(`${c.name}: missing rigid body state.`);
    }
    for (const c of s.project.components.filter(c => c.kind === 'forceActuator' && c.props.enabled && !s.failed[c.id] && !s.faults[c.id])) {
      const id = String(c.props.target), f = forces[id]; if (!f) continue;
      const wired = s.project.connections.some(w => w.domain === 'control' && w.to.component === c.id), input = s.automation.input(c, 'in', s);
      let value = wired ? input.valid && typeof input.value === 'number' ? input.value : 0 : prop(c, 'value');
      value = s.mechanicalDemand(c.id, value);
      value = Math.max(-prop(c, 'maxForce'), Math.min(prop(c, 'maxForce'), value));
      const axis = String(c.props.axis);
      if (axis === 'torque') { f.torque += value; f.dampingT += prop(c, 'damping'); }
      else if (axis === 'x') { f.x += value; f.dampingX += prop(c, 'damping'); }
      else { f.y += value; f.dampingY += prop(c, 'damping'); }
      actuatorForces[c.id] = value;
    }
    for (const j of (s.project.world?.joints ?? []).filter(j => j.kind === 'spring')) {
      const a = bodies[j.a], b = bodies[j.b], pa = a.getWorldPoint(j.anchorA), pb = b.getWorldPoint(j.anchorB), d = sub(pb, pa), length = Math.hypot(d.x, d.y);
      if (length < 1e-6) throw Error(`${j.name}: coincident spring anchors are unsupported.`);
      const direction = { x: d.x / length, y: d.y / length }, va = a.getLinearVelocityFromWorldPoint(pa), vb = b.getLinearVelocityFromWorldPoint(pb);
      const magnitude = j.stiffness * (length - j.length) + j.damping * dot(sub(vb, va), direction), force = Vec2(direction.x * magnitude, direction.y * magnitude);
      if (a.isDynamic()) a.applyForce(force, pa, true); if (b.isDynamic()) b.applyForce(Vec2(-force.x, -force.y), pb, true);
      springDamping.push({ id: j.id, a: j.a, b: j.b, direction, damping: j.damping, va: { ...va }, vb: { ...vb } });
    }
    for (const [id, body] of Object.entries(bodies)) {
      const f = forces[id], r = old[id]; if (!body.isDynamic()) continue;
      const fx = f.x - f.dampingX * r.vx, fy = f.y - f.dampingY * r.vy, tau = f.torque - f.dampingT * r.omega + (torques[id] ?? 0);
      if (fx || fy) body.applyForceToCenter(Vec2(fx, fy), true); if (tau) body.applyTorque(tau, true);
    }
    const contacts: ContactReading[] = [];
    const report = (contact: Contact, impulse: ContactImpulse) => {
      const manifold = contact.getWorldManifold(null); if (!manifold) return;
      const a = String(contact.getFixtureA().getBody().getUserData()), b = String(contact.getFixtureB().getBody().getUserData());
      for (let i = 0; i < contact.getManifold().pointCount; i++) {
        const point = { ...manifold.points[i] }, normal = { ...manifold.normal };
        const relative = sub(velocityAt(old[b], point), velocityAt(old[a], point));
        contacts.push({ a, b, point, normal, normalImpulse: impulse.normalImpulses[i], tangentImpulse: impulse.tangentImpulses[i], impactSpeed: Math.max(0, -dot(relative, normal)) });
      }
    };
    world.on('post-solve', report);
    world.step(h, 16, 8);
    world.off('post-solve', report);
    this.stepMs += performance.now() - started;
    return { world, bodies, joints, contacts, forces, old, duration: h, actuatorForces, springDamping };
  }
  accept(trial: Trial, s: Simulation, torques: Record<string, number>) {
    const started = performance.now();
    this.world = trial.world; this.bodies = trial.bodies; this.joints = trial.joints; this.contacts = trial.contacts; this.stepped = true;
    this.project = s.project;
    const next = this.readWorld(this.bodies), h = trial.duration;
    this.actuatorReadings = {};
    for (const [id, b] of Object.entries(next)) {
      const old = trial.old[id], f = trial.forces[id], body = this.bodies[id];
      const vx = (b.vx + old.vx) / 2, vy = (b.vy + old.vy) / 2, w = (b.omega + old.omega) / 2;
      b.ax = (b.vx - old.vx) / h; b.ay = (b.vy - old.vy) / h;
      b.forceX = f.x - f.dampingX * old.vx; b.forceY = f.y - f.dampingY * old.vy;
      b.torque = f.torque - f.dampingT * old.omega + (torques[id] ?? 0);
      if (!body.isDynamic()) continue;
      this.externalWork += (f.x * vx + f.y * vy + f.torque * w) * h;
      this.shaftWork += (torques[id] ?? 0) * w * h;
      // Actual work of the modeled viscous force. Its explicit evaluation is bounded by maxStep.
      this.dampingLoss += (f.dampingX * old.vx * vx + f.dampingY * old.vy * vy + f.dampingT * old.omega * w) * h;
    }
    for (const spring of trial.springDamping) {
      const j = s.project.world!.joints.find(j => j.id === spring.id)!;
      const pa = this.bodies[j.a].getWorldPoint(j.anchorA), pb = this.bodies[j.b].getWorldPoint(j.anchorB);
      const relativeOld = dot(sub(spring.vb, spring.va), spring.direction), relativeNew = dot(sub(velocityAt(next[j.b], pb), velocityAt(next[j.a], pa)), spring.direction);
      this.dampingLoss += spring.damping * relativeOld * (relativeOld + relativeNew) / 2 * h;
    }
    for (const c of s.project.components.filter(c => c.kind === 'forceActuator' && c.props.target && trial.actuatorForces[c.id] !== undefined)) {
      const id = String(c.props.target), b = next[id], old = trial.old[id], axis = c.props.axis;
      const v0 = axis === 'torque' ? old.omega : axis === 'x' ? old.vx : old.vy, v1 = axis === 'torque' ? b.omega : axis === 'x' ? b.vx : b.vy;
      this.actuatorReadings[c.id] = trial.actuatorForces[c.id] - prop(c, 'damping') * v0;
      this.brakeEnergy[c.id] = (this.brakeEnergy[c.id] ?? 0) + prop(c, 'damping') * v0 * (v0 + v1) / 2 * h;
    }
    const pairs = new Set<string>();
    for (const c of this.contacts) {
      const a0 = velocityAt(trial.old[c.a], c.point), b0 = velocityAt(trial.old[c.b], c.point), a1 = velocityAt(next[c.a], c.point), b1 = velocityAt(next[c.b], c.point);
      const impulse = { x: c.normal.x * c.normalImpulse + c.normal.y * c.tangentImpulse, y: c.normal.y * c.normalImpulse - c.normal.x * c.tangentImpulse };
      // Contact impulse work, not a fitted energy correction. Inelastic and friction losses leave as heat.
      const relativeMid = { x: (b0.x + b1.x - a0.x - a1.x) / 2, y: (b0.y + b1.y - a0.y - a1.y) / 2 };
      this.contactLoss -= dot(impulse, relativeMid);
      if (this.bodies[c.a].isKinematic()) this.externalWork += dot(impulse, a1);
      if (this.bodies[c.b].isKinematic()) this.externalWork -= dot(impulse, b1);
      next[c.a].contactImpulse += Math.hypot(c.normalImpulse, c.tangentImpulse); next[c.b].contactImpulse += Math.hypot(c.normalImpulse, c.tangentImpulse);
      this.maxImpactSpeed = Math.max(this.maxImpactSpeed, c.impactSpeed);
      const key = [c.a, c.b].sort().join(':'); pairs.add(key);
      if (!this.lastContacts.has(key) && c.impactSpeed > 0.05) s.log(`Contact: ${s.project.components.find(x => x.id === c.a)?.name} / ${s.project.components.find(x => x.id === c.b)?.name}; approach ${c.impactSpeed.toFixed(3)} m/s, impulse ${c.normalImpulse.toFixed(3)} N·s.`);
    }
    this.lastContacts = pairs;
    this.readings = next; this.refreshJoints(h);
    // Rigid travel stops are inelastic constraints. Integrate their measured impulse work;
    // other ideal joint reaction work stays in the numerical residual, not fitted heat.
    for (const j of (s.project.world?.joints ?? []).filter(j => j.limits && ['revolute', 'prismatic'].includes(j.kind))) {
      const r = this.jointReadings[j.id];
      if (Math.min(Math.abs(r.coordinate - j.lower), Math.abs(r.coordinate - j.upper)) > 0.03) continue;
      const a0 = trial.old[j.a], b0 = trial.old[j.b], a1 = next[j.a], b1 = next[j.b];
      if (j.kind === 'revolute') this.limitLoss -= r.torque * (b0.omega + b1.omega - a0.omega - a1.omega) / 2 * h;
      else {
        const axis = this.bodies[j.a].getWorldVector(j.axis), va0 = velocityAt(a0, r.anchorA), vb0 = velocityAt(b0, r.anchorB), va1 = velocityAt(a1, r.anchorA), vb1 = velocityAt(b1, r.anchorB);
        const relative = { x: (vb0.x + vb1.x - va0.x - va1.x) / 2, y: (vb0.y + vb1.y - va0.y - va1.y) / 2 };
        this.limitLoss -= dot(r.force, axis) * dot(relative, axis) * h;
        if (Math.abs(dot(r.force, axis)) > 1e-6) this.maxImpactSpeed = Math.max(this.maxImpactSpeed, Math.abs(dot(sub(vb0, va0), axis)));
      }
    }
    for (const b of Object.values(next)) if (![b.x, b.y, b.angle, b.vx, b.vy, b.omega].every(Number.isFinite) || Math.abs(b.x) > 2000 || Math.abs(b.y) > 2000 || Math.hypot(b.vx, b.vy) > 200 || Math.abs(b.omega) > 370) throw Error('Spatial body left the supported position/speed range. Reset and reduce forcing.');
    this.stepMs += performance.now() - started;
  }
  private readWorld(bodies: Record<string, Body>) {
    return Object.fromEntries(Object.entries(bodies).map(([id, b]) => {
      const p = b.getPosition(), center = b.getWorldCenter(), v = b.getLinearVelocity(), mass = b.getMass(), inertia = b.getInertia() - mass * b.getLocalCenter().lengthSquared(), omega = b.getAngularVelocity(), g = this.world.getGravity();
      return [id, { x: p.x, y: p.y, cx: center.x, cy: center.y, angle: b.getAngle(), vx: v.x, vy: v.y, omega, mass, inertia, ax: 0, ay: 0, forceX: 0, forceY: 0, torque: 0, kinetic: b.isDynamic() ? 0.5 * mass * v.lengthSquared() + 0.5 * inertia * omega ** 2 : 0, potential: b.isDynamic() ? -mass * (g.x * center.x + g.y * center.y) : 0, awake: b.isAwake(), contactImpulse: 0 }];
    }));
  }
  refresh(p: Project) { this.project = p; this.readings = this.readWorld(this.bodies); this.refreshJoints(1 / 240); }
  private refreshJoints(h: number) {
    for (const j of this.project.world?.joints ?? []) {
      const joint = this.joints[j.id], a = this.bodies[j.a].getWorldPoint(j.anchorA), b = this.bodies[j.b].getWorldPoint(j.anchorB), length = Math.hypot(a.x - b.x, a.y - b.y);
      const force = joint && this.stepped ? joint.getReactionForce(1 / h) : { x: j.stiffness * (length - j.length) * (b.x - a.x) / Math.max(length, 1e-9), y: j.stiffness * (length - j.length) * (b.y - a.y) / Math.max(length, 1e-9) };
      this.jointReadings[j.id] = { anchorA: { ...a }, anchorB: { ...b }, force: { ...force }, torque: joint && this.stepped ? joint.getReactionTorque(1 / h) : 0, coordinate: joint instanceof RevoluteJoint ? joint.getJointAngle() : joint instanceof PrismaticJoint ? joint.getJointTranslation() : length, speed: joint instanceof RevoluteJoint || joint instanceof PrismaticJoint ? joint.getJointSpeed() : 0, extension: length - j.length };
    }
  }
  impulse(id: string, impulse: Point, angular = 0) {
    const b = this.bodies[id]; if (!b?.isDynamic()) return 'Apply impulses to a dynamic body.';
    const before = this.energy;
    b.applyLinearImpulse(impulse, b.getWorldCenter(), true); b.applyAngularImpulse(angular, true);
    this.refresh(this.project); this.externalWork += this.energy - before; return null;
  }
}
