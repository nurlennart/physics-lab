import { definitions, isMotor, prop, type Component, type Project, type Point } from './model';
export type MaterialId = 'steel' | 'aluminum' | 'copper' | 'wood' | 'glass' | 'plastic' | 'rubber' | 'concrete' | 'custom';
export interface Material { label: string; density: number; friction: number; restitution: number; conductivity: number; specificHeat: number; color: string }
/** Representative room-temperature presets; contact coefficients depend on surface pairing.
 * Conductivity and heat capacity are metadata: visual contact does not create thermal links. */
export const materials: Record<Exclude<MaterialId, 'custom'>, Material> = {
  steel: { label: 'Steel', density: 7850, friction: 0.5, restitution: 0.1, conductivity: 45, specificHeat: 470, color: '#899dab' },
  aluminum: { label: 'Aluminum', density: 2700, friction: 0.4, restitution: 0.15, conductivity: 205, specificHeat: 900, color: '#b0bcc5' },
  copper: { label: 'Copper', density: 8960, friction: 0.45, restitution: 0.1, conductivity: 390, specificHeat: 385, color: '#b88468' },
  wood: { label: 'Wood', density: 600, friction: 0.5, restitution: 0.15, conductivity: 0.12, specificHeat: 1700, color: '#a99974' },
  glass: { label: 'Glass', density: 2500, friction: 0.3, restitution: 0.2, conductivity: 1, specificHeat: 840, color: '#89adb2' },
  plastic: { label: 'Plastic', density: 950, friction: 0.35, restitution: 0.2, conductivity: 0.2, specificHeat: 1900, color: '#8c9eb5' },
  rubber: { label: 'Rubber', density: 1100, friction: 0.9, restitution: 0.7, conductivity: 0.16, specificHeat: 1800, color: '#6a817a' },
  concrete: { label: 'Concrete', density: 2400, friction: 0.7, restitution: 0.05, conductivity: 1.4, specificHeat: 880, color: '#858b8d' },
};
export type ShapeKind = 'rectangle' | 'circle' | 'polygon' | 'beam' | 'platform' | 'wall' | 'floor' | 'wheel';
export interface SpatialBody {
  type: 'static' | 'dynamic' | 'kinematic'; shape: ShapeKind;
  x: number; y: number; angle: number; width: number; height: number; depth: number;
  material: MaterialId; custom?: Material; mass: number;
  vx: number; vy: number; omega: number; fixedRotation: boolean; bullet: boolean; collision: boolean;
  category: number; mask: number; locked: boolean; elevationLinked: boolean; elevationOffset: number;
  vertices?: Point[];
}
export type JointKind = 'fixed' | 'revolute' | 'prismatic' | 'distance' | 'spring' | 'gear';
export interface MechanicalJoint {
  id: string; name: string; kind: JointKind; a: string; b: string;
  anchorA: Point; anchorB: Point; axis: Point; referenceAngle: number;
  limits: boolean; lower: number; upper: number; length: number; stiffness: number; damping: number;
  joint1?: string; joint2?: string; ratio: number; collideConnected: boolean;
}
export interface SpatialWorld { gravity: Point; joints: MechanicalJoint[]; }
export const defaultWorld = (): SpatialWorld => ({ gravity: { x: 0, y: -9.80665 }, joints: [] });
export const physicalKinds = new Set(['rigidBody', 'motor', 'pump', 'tank', 'heater', 'cooler', 'source', 'resistor', 'lamp', 'valve', 'actuatedValve', 'thermostaticValve', 'checkValve', 'pipe']);
export function makeSpatial(shape: ShapeKind = 'rectangle', x = 3, y = 3): SpatialBody {
  const structural = ['platform', 'wall', 'floor'].includes(shape);
  return { type: structural ? 'static' : 'dynamic', shape, x, y, angle: 0, width: shape === 'floor' ? 16 : shape === 'beam' || shape === 'platform' ? 3 : shape === 'wall' ? 0.3 : 1,
    height: shape === 'floor' || shape === 'beam' || shape === 'platform' ? 0.3 : shape === 'wall' ? 4 : 1, depth: 0.05,
    material: structural ? 'concrete' : 'aluminum', mass: 0, vx: 0, vy: 0, omega: 0, fixedRotation: false,
    bullet: true, collision: true, category: 1, mask: 65535, locked: false, elevationLinked: false, elevationOffset: 0,
    ...(shape === 'polygon' ? { vertices: [{ x: -0.5, y: -0.5 }, { x: 0.5, y: -0.5 }, { x: 0, y: 0.5 }] } : {}) };
}
export function materialOf(b: SpatialBody): Material { return b.material === 'custom' ? b.custom! : materials[b.material]; }
export function areaOf(b: SpatialBody) {
  if (b.shape === 'circle' || b.shape === 'wheel') return Math.PI * (b.width / 2) ** 2;
  if (b.shape === 'polygon') return Math.abs(b.vertices!.reduce((a, v, i, arr) => { const next = arr[(i + 1) % arr.length]; return a + v.x * next.y - v.y * next.x; }, 0)) / 2;
  return b.width * b.height;
}
export function configuredMass(b: SpatialBody) { return b.mass > 0 ? b.mass : areaOf(b) * b.depth * materialOf(b).density; }
export function shaftBody(p: Project, motor: string) {
  const w = p.connections.find(w => w.domain === 'mechanical' && [w.from.component, w.to.component].includes(motor) && p.components.some(c => c.kind === 'rigidBody' && [w.from.component, w.to.component].includes(c.id)));
  return w ? (w.from.component === motor ? w.to.component : w.from.component) : undefined;
}
export function toWorld(local: Point, b: Pick<SpatialBody, 'x' | 'y' | 'angle'>): Point { const c = Math.cos(b.angle), s = Math.sin(b.angle); return { x: b.x + c * local.x - s * local.y, y: b.y + s * local.x + c * local.y }; }
export function toLocal(world: Point, b: Pick<SpatialBody, 'x' | 'y' | 'angle'>): Point { const c = Math.cos(b.angle), s = Math.sin(b.angle), x = world.x - b.x, y = world.y - b.y; return { x: c * x + s * y, y: -s * x + c * y }; }
const finite = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const point = (v: Point | undefined, limit = 1000) => !!v && finite(v.x, -limit, limit) && finite(v.y, -limit, limit);
export function spatialError(p: Project): string | null {
  if (p.world && (!point(p.world.gravity, 30) || !Array.isArray(p.world.joints) || p.world.joints.length > 100)) return 'Spatial world supports gravity ≤30 m/s² per axis and at most 100 joints.';
  const ids = new Set<string>();
  for (const c of p.components) {
    const b = c.spatial;
    if (!b) { if (c.kind === 'rigidBody') return `${c.name}: a rigid body needs spatial geometry.`; continue; }
    if (!physicalKinds.has(c.kind)) return `${c.name}: this abstract component has no physical body.`;
    if (!['static', 'dynamic', 'kinematic'].includes(b.type) || !['rectangle', 'circle', 'polygon', 'beam', 'platform', 'wall', 'floor', 'wheel'].includes(b.shape)) return `${c.name}: unsupported body or shape type.`;
    if (['circle', 'wheel'].includes(b.shape) && b.width !== b.height) return `${c.name}: circular bodies require equal diameter and height.`;
    if (!point(b) || !finite(b.angle, -1e4, 1e4) || !finite(b.width, 0.05, 100) || !finite(b.height, 0.05, 100) || !finite(b.depth, 0.001, 10) || !finite(b.mass, 0, 10000) || !finite(b.vx, -100, 100) || !finite(b.vy, -100, 100) || !finite(b.omega, -350, 350) || !finite(b.elevationOffset, -1000, 1000)) return `${c.name}: spatial dimensions, mass or initial state out of range.`;
    if (!['fixedRotation', 'bullet', 'collision', 'locked', 'elevationLinked'].every(k => typeof b[k as keyof SpatialBody] === 'boolean') || ![b.category, b.mask].every(v => Number.isInteger(v) && v >= 0 && v <= 65535)) return `${c.name}: invalid collision or build configuration.`;
    if (b.material === 'custom') {
      if (!b.custom || typeof b.custom.label !== 'string' || !finite(b.custom.density, 1, 30000) || !finite(b.custom.friction, 0, 2) || !finite(b.custom.restitution, 0, 1) || !finite(b.custom.conductivity, 0, 1000) || !finite(b.custom.specificHeat, 1, 10000) || !/^#[\da-fA-F]{6}$/.test(b.custom.color)) return `${c.name}: invalid custom material.`;
    } else if (!Object.hasOwn(materials, b.material)) return `${c.name}: unknown material.`;
    if (b.shape === 'polygon') {
      const v = b.vertices;
      if (!v || v.length < 3 || v.length > 8 || !v.every(pt => point(pt, 50))) return `${c.name}: polygons need 3–8 convex counterclockwise vertices.`;
      if (v.some((a, i) => { const b = v[(i + 1) % v.length], c = v[(i + 2) % v.length]; return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) <= 1e-5; })) return `${c.name}: polygon must be strictly convex and counterclockwise.`;
      if (areaOf(b) < 0.0025) return `${c.name}: polygon area is too small.`;
    }
    const mass = configuredMass(b);
    if (!finite(mass, 0.001, 10000)) return `${c.name}: derived mass must be 0.001–10,000 kg; adjust depth, size or explicit mass.`;
    if (c.kind !== 'rigidBody' && b.type !== 'static') return `${c.name}: engineering equipment is mounted static in this phase; attach a separate rotor for motion. Finite moving tank inertia is unsupported.`;
    if (b.elevationLinked && (!('elevation' in definitions[c.kind].defaults) || b.type !== 'static' || Math.abs(prop(c, 'elevation') - b.y - b.elevationOffset) > 1e-9)) return `${c.name}: hydraulic elevation must equal the static body's y plus its configured offset.`;
    if (b.type === 'static' && (b.vx || b.vy || b.omega)) return `${c.name}: static bodies cannot have initial velocity.`;
  }
  for (const j of p.world?.joints ?? []) {
    if (!j || typeof j.id !== 'string' || ids.has(j.id) || typeof j.name !== 'string' || j.name.length > 80 || !['fixed', 'revolute', 'prismatic', 'distance', 'spring', 'gear'].includes(j.kind)) return 'Invalid or duplicate mechanical joint.';
    ids.add(j.id);
    const a = p.components.find(c => c.id === j.a)?.spatial, b = p.components.find(c => c.id === j.b)?.spatial;
    if (!a || !b || j.a === j.b || (a.type === 'static' && b.type === 'static')) return `${j.name}: connect distinct bodies with at least one movable body.`;
    if (a.type === 'kinematic' || b.type === 'kinematic') return `${j.name}: joints currently support static and dynamic bodies; kinematic bodies support contact-driven interaction only.`;
    if (!point(j.anchorA, 100) || !point(j.anchorB, 100) || !point(j.axis, 1) || !finite(j.referenceAngle, -1e4, 1e4) || !finite(j.lower, -1000, 1000) || !finite(j.upper, -1000, 1000) || j.lower > j.upper || !finite(j.length, 0.05, 1000) || !finite(j.stiffness, 0.01, 1e6) || !finite(j.damping, 0, 1e5) || !finite(j.ratio, -1000, 1000) || Math.abs(j.ratio) < 1e-6 || typeof j.limits !== 'boolean' || typeof j.collideConnected !== 'boolean') return `${j.name}: invalid anchors, limits or mechanical coefficients.`;
    if (j.kind === 'prismatic' && Math.abs(Math.hypot(j.axis.x, j.axis.y) - 1) > 1e-6) return `${j.name}: slide axis must be a unit vector in body A coordinates.`;
    if (j.kind === 'gear') {
      const first = p.world!.joints.find(x => x.id === j.joint1), second = p.world!.joints.find(x => x.id === j.joint2);
      if (!first || !second || first.id === second.id || !['revolute', 'prismatic'].includes(first.kind) || !['revolute', 'prismatic'].includes(second.kind) || first.b !== j.a || second.b !== j.b || p.components.find(c => c.id === first.a)?.spatial?.type !== 'static' || p.components.find(c => c.id === second.a)?.spatial?.type !== 'static') return `${j.name}: gear/rack needs two distinct grounded revolute or prismatic joints, with matching driven bodies.`;
    }
  }
  for (const motor of p.components.filter(isMotor)) {
    const id = shaftBody(p, motor.id); if (!id) continue;
    if (!(p.world?.joints ?? []).some(j => j.kind === 'revolute' && j.b === id && p.components.find(c => c.id === j.a)?.spatial?.type === 'static')) return `${motor.name}: spatial rotor requires a grounded revolute bearing (body B is the rotor).`;
  }
  for (const c of p.components.filter(c => ['positionSensor', 'speedSensor', 'forceActuator'].includes(c.kind))) {
    const target = p.components.find(x => x.id === c.props.target);
    if (c.props.target && !(target?.spatial || (c.kind === 'speedSensor' && (target?.kind === 'motor' || target?.kind === 'inductionMotor')))) return `${c.name}: target needs compatible physical state.`;
    if (c.kind === 'forceActuator' && target?.spatial?.type !== 'dynamic' && c.props.target) return `${c.name}: forces require a dynamic target.`;
    if (c.kind !== 'speedSensor' && !['x', 'y', ...(c.kind === 'forceActuator' ? ['torque'] : [])].includes(String(c.props.axis))) return `${c.name}: invalid measurement or force axis.`;
  }
  return null;
}
export function spatialSignature(p: Project) { return JSON.stringify({ world: p.world, bodies: p.components.filter(c => c.spatial).map(c => ({ id: c.id, spatial: c.spatial })) }); }
