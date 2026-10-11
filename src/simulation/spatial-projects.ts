import { catalog, connect, makeComponent, uid, type Component, type Kind, type Project, type Point } from './model';
import { defaultWorld, makeSpatial, toLocal, type MechanicalJoint, type JointKind, type ShapeKind } from './spatial-model';
export type MechanicalMode = 'mechanism' | 'rotor' | 'descent' | 'lift' | 'rotation';
export function makeJoint(p: Project, kind: JointKind, a: Component, b: Component, pointA: Point, pointB = pointA): MechanicalJoint {
  const distance = Math.hypot(pointA.x - pointB.x, pointA.y - pointB.y);
  return { id: uid(), name: `${kind} ${(p.world?.joints.length ?? 0) + 1}`, kind, a: a.id, b: b.id, anchorA: toLocal(pointA, a.spatial!), anchorB: toLocal(pointB, b.spatial!), axis: { x: 0, y: 1 }, referenceAngle: b.spatial!.angle - a.spatial!.angle,
    limits: false, lower: -Math.PI, upper: Math.PI, length: Math.max(0.05, distance), stiffness: 100, damping: 2, ratio: 1, collideConnected: false };
}
export function mechanicalStarter(mode: MechanicalMode = 'mechanism', challenge = false): Project {
  let p: Project = { version: 4, id: uid(), name: mode === 'descent' ? 'Controlled descent laboratory' : mode === 'lift' ? 'Motorized rack lift' : mode === 'rotation' ? 'Rotational feedback laboratory' : mode === 'rotor' ? 'Electrically driven rotor' : 'Mechanical construction laboratory', components: [], connections: [], world: defaultWorld(), probes: [], assemblies: [], ...(challenge && ['descent', 'lift', 'rotation'].includes(mode) ? { challenge: mode as 'descent' | 'lift' | 'rotation' } : {}) };
  const add = (kind: Kind, x: number, y: number, props: Component['props'] = {}, name?: string) => { const c = makeComponent(kind, x, y, p.components); c.props = { ...c.props, ...props }; if (name) c.name = name; p.components.push(c); return c; };
  const body = (name: string, shape: ShapeKind, x: number, y: number, overrides: Partial<NonNullable<Component['spatial']>> = {}) => { const c = add('rigidBody', 40 + p.components.length * 220, 380, {}, name); c.spatial = { ...makeSpatial(shape, x, y), ...overrides }; return c; };
  const wire = (a: Component, ap: string, b: Component, bp: string) => { p = connect(p, { component: a.id, port: ap }, { component: b.id, port: bp }); };
  const joint = (kind: JointKind, a: Component, b: Component, point: Point, pointB = point) => { const j = makeJoint(p, kind, a, b, point, pointB); p.world!.joints.push(j); return j; };
  const floor = body('Foundation', 'floor', 5, -0.25, { width: 16, height: 0.5, locked: true });
  if (mode === 'mechanism') {
    body('Falling block', 'rectangle', 2, 5, { width: 0.7, height: 0.7, material: 'wood' });
    const arm = body('Hinged beam', 'beam', 6, 4, { width: 3, height: 0.18, material: 'wood' });
    joint('revolute', floor, arm, { x: 4.5, y: 4 }); arm.props.brakeDamping = 30;
    const springMass = body('Spring mass', 'rectangle', 10, 3, { width: 0.6, height: 0.6, mass: 2 });
    const spring = joint('spring', floor, springMass, { x: 10, y: 6 }, { x: 10, y: 3 }); spring.length = 2.5; spring.stiffness = 50; spring.damping = 1;
    p.probes = [{ id: uid(), name: 'Spring position', component: springMass.id, measurement: 'positionY', color: '#59b99b', visible: true }, { id: uid(), name: 'Spring velocity', component: springMass.id, measurement: 'velocityY', color: '#3ba6d8', visible: true }];
    return p;
  }
  if (mode === 'descent') {
    floor.spatial = { ...floor.spatial!, x: 2, y: 0.5, width: 8, height: 0.5 };
    const load = body('Suspended load', 'rectangle', 2, 5, { width: 0.5, height: 0.5, mass: 10, material: 'steel', fixedRotation: true });
    const guide = joint('prismatic', floor, load, { x: 2, y: 5 }); guide.collideConnected = true; guide.limits = true; guide.lower = -4.5; guide.upper = 0;
    add('forceActuator', 340, 70, { target: load.id, axis: 'y', damping: challenge ? 0 : 200 }, 'Descent brake');
    const sense = add('positionSensor', 560, 70, { target: load.id }, 'Load position');
    p.probes = [{ id: uid(), name: 'Load height', component: load.id, measurement: 'positionY', color: '#59b99b', visible: true }, { id: uid(), name: 'Descent velocity', component: load.id, measurement: 'velocityY', color: '#3ba6d8', visible: true }, { id: uid(), name: 'Brake energy', component: p.components.find(c => c.kind === 'forceActuator')!.id, measurement: 'energy', color: '#e9bd6a', visible: true }];
    sense.name = 'Load position';
    return p;
  }
  const source = add('source', 30, 70), motor = add('motor', 280, 70);
  for (const [c, variant] of [[source, 'motorSupply'], [motor, 'traction48']] as const) { c.variant = variant; c.props = { ...catalog(c).props }; }
  source.props.voltage = 48;
  source.spatial = { ...makeSpatial('rectangle', 1, 1), type: 'static', width: 1, height: 0.7, mass: 15 };
  motor.spatial = { ...makeSpatial('rectangle', 3, 1), type: 'static', width: 0.9, height: 0.6, mass: 20, collision: false };
  const rotor = body('Driven rotor', 'wheel', 3, mode === 'lift' ? 1 : 3, { width: mode === 'lift' ? 0.5 : 0.4, height: mode === 'lift' ? 0.5 : 0.4, depth: 0.02, material: 'aluminum' });
  const bearing = joint('revolute', floor, rotor, { x: rotor.spatial!.x, y: rotor.spatial!.y });
  wire(source, 'a', motor, 'a'); wire(motor, 'b', source, 'b'); wire(motor, 'shaft', rotor, 'shaft');
  const sensor = add(mode === 'lift' ? 'positionSensor' : 'speedSensor', 540, 70, { target: rotor.id });
  if (mode === 'lift') {
    const load = body('Lift load', 'rectangle', 6, 1, { width: 0.8, height: 0.5, mass: 10, fixedRotation: true, material: 'steel' });
    const guide = joint('prismatic', floor, load, { x: 6, y: 1 }); guide.limits = true; guide.lower = -0.5; guide.upper = 2.5;
    const rack = makeJoint(p, 'gear', rotor, load, { x: 3, y: 1 }, { x: 6, y: 1 }); rack.joint1 = bearing.id; rack.joint2 = guide.id; rack.ratio = -50; rack.name = 'Rack transmission · 20 mm/rad'; p.world!.joints.push(rack);
    sensor.props.target = load.id;
    const pi = add('pid', 780, 70, { reference: 3, feedforward: 0, kp: 150, ki: 0, maxOutput: 400 });
    wire(sensor, 'out', pi, 'in'); wire(pi, 'out', motor, 'speed');
    p.probes = [{ id: uid(), name: 'Lift height', component: load.id, measurement: 'positionY', color: '#59b99b', visible: true }, { id: uid(), name: 'Lift velocity', component: load.id, measurement: 'velocityY', color: '#3ba6d8', visible: true }];
  } else if (mode === 'rotation') {
    const pi = add('pid', 780, 70, { reference: 1200, kp: 0.8, ki: 2, maxOutput: 3000 });
    wire(sensor, 'out', pi, 'in'); wire(pi, 'out', motor, 'speed');
    add('forceActuator', 1020, 70, { target: rotor.id, axis: 'torque', value: -0.4 }, 'Variable shaft load');
  } else {
    motor.props.speedControl = true; motor.props.speedCommand = 1200;
    add('forceActuator', 780, 70, { target: rotor.id, axis: 'torque', damping: 0.005 }, 'Rotor brake');
  }
  p.probes!.push({ id: uid(), name: 'Rotor speed', component: rotor.id, measurement: 'angularVelocity', color: '#a58ae3', visible: true }, { id: uid(), name: 'Motor current', component: motor.id, measurement: 'current', color: '#e9bd6a', visible: true }, { id: uid(), name: 'Mechanical energy', component: rotor.id, measurement: 'kineticEnergy', color: '#c9d3dc', visible: true });
  // Mechanical assignments expose actual construction; scored motor circuits must be wired by the learner.
  if (challenge) p.connections = [];
  return p;
}
