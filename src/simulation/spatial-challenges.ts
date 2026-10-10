import { economyFactor } from "./scoring";
import { catalog, projectCost, prop, type Project } from './model';
import { configuredMass, shaftBody } from './spatial-model';
import type { Simulation } from './engine';
import { catalogError } from './integrity';
export const mechanicalIds = ['descent', 'lift', 'rotation'] as const;
export function mechanicalChallengeError(p: Project): string | null {
  const id = p.challenge;
  if (!id || !mechanicalIds.includes(id as typeof mechanicalIds[number])) return null;
  if (!p.world || p.world.gravity.x !== 0 || p.world.gravity.y !== -9.80665) return 'Mechanical assignment gravity is locked at 9.80665 m/s² downward.';
  const expected = id === 'descent' ? { name: 'Suspended load', mass: 10, x: 2, y: 5 } : id === 'lift' ? { name: 'Lift load', mass: 10, x: 6, y: 1 } : { name: 'Driven rotor', mass: Math.PI * 0.2 ** 2 * 0.02 * 2700, x: 3, y: 3 };
  const targets = p.components.filter(c => c.name === expected.name), load = targets[0];
  if (targets.length !== 1 || load.kind !== 'rigidBody' || !load.spatial || load.spatial.type !== 'dynamic' || Math.abs(configuredMass(load.spatial) - expected.mass) > 1e-7 || load.spatial.x !== expected.x || load.spatial.y !== expected.y || load.spatial.angle !== 0 || load.spatial.vx || load.spatial.vy || load.spatial.omega || !load.spatial.collision) return 'The assignment load, initial pose, mass and collision configuration are locked.';
  if (id === 'descent' && (load.spatial.width !== 0.5 || load.spatial.height !== 0.5)) return 'Suspended load dimensions are locked.';
  if (id === 'rotation' && (load.spatial.shape !== 'wheel' || load.spatial.width !== 0.4 || load.spatial.height !== 0.4)) return 'Assignment rotor geometry is locked.';
  const floor = p.components.filter(c => c.name === 'Foundation');
  if (floor.length !== 1 || floor[0].spatial?.type !== 'static' || floor[0].spatial.y !== (id === 'descent' ? 0.5 : -0.25) || floor[0].spatial.height !== 0.5) return 'The assignment support elevation and height are locked.';
  for (const c of p.components) {
    const allowed = id === 'descent' ? ['rigidBody', 'forceActuator', 'positionSensor', 'comparator', 'pid', 'constant'] : id === 'lift' ? ['rigidBody', 'source', 'motor', 'positionSensor', 'speedSensor', 'pid', 'comparator', 'hysteresis', 'and', 'or', 'not', 'constant', 'relay', 'switch', 'fuse', 'ground', 'junction'] : ['rigidBody', 'source', 'motor', 'speedSensor', 'pid', 'forceActuator', 'comparator', 'constant', 'ground', 'junction'];
    if (!allowed.includes(c.kind)) return `${c.name}: unavailable in this mechanical assignment.`;
    const catalogViolation = catalogError(c); if (catalogViolation) return catalogViolation;
    if (c.spatial && (c.spatial.vx || c.spatial.vy || c.spatial.omega)) return 'Assignment bodies must start from rest.';
    if (c.kind === 'rigidBody' && (prop(c, 'forceX') || prop(c, 'forceY') || prop(c, 'appliedTorque') || prop(c, 'brakeDamping'))) return 'Use the purchased brake/actuator; free body forces are disabled in assignments.';
    if (c.kind === 'source' && prop(c, 'voltage') > 48) return 'Assignment source voltage must not exceed 48 V.';
    const model = catalog(c).props;
    if (c.kind === 'motor' && c.props.resistance !== model.resistance) return `${c.name}: motor armature resistance belongs to the purchased catalog variant.`;
    for (const key of ['ratedVoltage', 'ratedCurrent', 'ratedPower', 'torqueConstant', 'emfConstant', 'inertia', 'friction', 'maxForce']) if (key in model && c.props[key] !== model[key]) return `${c.name}: rating or model coefficient belongs to the purchased catalog variant.`;
    if (c.kind === 'forceActuator') {
      if (id === 'descent' && (c.props.target !== load.id || c.props.axis !== 'y' || prop(c, 'value') !== 0 || p.connections.some(w => w.domain === 'control' && w.to.component === c.id))) return 'Controlled descent allows only passive vertical braking on the load.';
      if (id === 'lift') return 'The lift must be powered through its electrical motor, not an external force source.';
      if (id === 'rotation' && (c.name !== 'Variable shaft load' || c.props.target !== load.id || c.props.axis !== 'torque' || prop(c, 'value') !== -0.4 || prop(c, 'damping') !== 0 || p.components.filter(x => x.kind === 'forceActuator').length !== 1)) return 'The changing shaft-load actuator is locked.';
    }
  }
  if (id === 'rotation' && p.components.filter(c => c.kind === 'forceActuator').length !== 1) return 'Keep the physical changing shaft load in the assignment.';
  return null;
}
function ancestry(p: Project, id: string, target: string, seen = new Set<string>()): boolean { if (id === target) return true; if (seen.has(id)) return false; seen.add(id); return p.connections.filter(w => w.domain === 'control' && w.to.component === id).some(w => ancestry(p, w.from.component, target, seen)); }
export function updateMechanicalChallenge(s: Simulation, dt: number) {
  const id = s.project.challenge; if (!mechanicalIds.includes(id as typeof mechanicalIds[number])) return;
  const r = s.mechanicalChallenge, p = s.project, target = p.components.find(c => c.name === (id === 'descent' ? 'Suspended load' : id === 'lift' ? 'Lift load' : 'Driven rotor'))!;
  const b = s.spatial.readings[target.id]; if (!b) return;
  if (s.peakPower > 2000.01) s.violation('Mechanical assignment exceeds 2,000 W electrical limit.');
  if (id === 'descent' || id === 'lift') {
    const error = Math.abs(b.y - (id === 'descent' ? 1 : 3)), stable = error <= 0.08 && Math.hypot(b.vx, b.vy) <= 0.05;
    r.hold = stable ? r.hold + dt : 0;
    if (id === 'descent' && s.spatial.maxImpactSpeed > 0.6) s.violation('Descent impact velocity exceeds 0.6 m/s.');
    if (id === 'descent' && s.spatial.dampingLoss > 500) s.violation('Descent braking heat exceeds 500 J.');
    if (id === 'lift' && b.y < 0.2) s.violation('Lift load fell below the safe travel region.');
  } else {
    const phase = Math.floor(s.time / 15);
    if (r.lastLoadPhase !== phase) { if (r.lastLoadPhase >= 0) r.loadChanges++; r.lastLoadPhase = phase; s.log(`Rotational assignment shaft load: ${phase % 2 ? '1.2' : '0.4'} N·m.`); }
    if (s.time >= 10) {
      const rpm = b.omega * 30 / Math.PI, error = rpm - 1200;
      r.evaluated += dt; r.squaredError += error ** 2 * dt; r.peakError = Math.max(r.peakError, Math.abs(error));
      if (Math.abs(error) <= 60) r.inBand += dt;
    }
  }
  if (s.time > (id === 'rotation' ? 90 : 120)) s.violation('Mechanical assignment time limit exceeded.');
}
export function evaluateMechanical(p: Project, s: Simulation) {
  const id = p.challenge!, r = s.mechanicalChallenge, target = p.components.find(c => c.name === (id === 'descent' ? 'Suspended load' : id === 'lift' ? 'Lift load' : 'Driven rotor'));
  const b = target && s.spatial.readings[target.id];
  const motors = p.components.filter(c => c.kind === 'motor'), powered = motors.some(c => shaftBody(p, c.id) && s.componentEnergy[c.id] > 10);
  const valid = !mechanicalChallengeError(p) && projectCost(p) <= (id === 'descent' ? 250 : id === 'lift' ? 900 : 750) && !s.error && !s.violations.length && !Object.keys(s.failed).length;
  const sensor = p.components.some(c => c.kind === (id === 'rotation' ? 'speedSensor' : 'positionSensor') && (id === 'rotation' || c.props.axis === 'y') && c.props.target === target?.id && motors.some(m => ancestry(p, m.id, c.id)));
  const checks = [
    { label: 'Locked load/environment, catalog ratings, budget and safety respected', ok: valid },
    ...(id === 'descent' ? [
      { label: 'Load rests at 1.00 ±0.08 m with speed ≤0.05 m/s for 3 s', ok: !!b && r.hold >= 3 - 1e-8 },
      { label: 'Impact ≤0.6 m/s, passive braking ≤500 J, finish within 120 s', ok: s.spatial.maxImpactSpeed <= 0.6 && s.spatial.dampingLoss > 1 && s.spatial.dampingLoss <= 500 && s.time <= 120 },
    ] : id === 'lift' ? [
      { label: 'Powered motor, real transmission and position feedback; ≥100 J shaft work', ok: powered && sensor && s.spatial.shaftWork >= 100 && !!p.world?.joints.some(j => j.kind === 'gear') },
      { label: '10 kg load raised to 3.00 ±0.08 m, stable for 3 s', ok: !!b && r.hold >= 3 - 1e-8 && s.time <= 120 },
    ] : [
      { label: 'Electrical motor, rotor and actual speed sensor feed control', ok: powered && sensor },
      { label: '60 s scored, ≥95% within ±60 RPM, RMS ≤60 RPM, changing load exercised', ok: r.evaluated >= 60 - 1e-8 && r.inBand / Math.max(1, r.evaluated) >= 0.95 && Math.sqrt(r.squaredError / Math.max(1, r.evaluated)) <= 60 && r.loadChanges >= 4 },
    ]),
  ];
  const complete = checks.every(c => c.ok), costLimit = id === 'descent' ? 250 : id === 'lift' ? 900 : 750;
  const energy = id === 'descent' ? s.spatial.dampingLoss : s.suppliedEnergy;
  const ideal = id === 'descent' ? 400 : id === 'lift' ? 500 : 8000;
  const score = complete ? Math.round(60 + 20 * Math.min(1, ideal / Math.max(1, energy)) + 10 * economyFactor(p.challenge!, projectCost(p), costLimit) + 10 * Math.min(1, (id === 'rotation' ? 70 : 15) / Math.max(1, s.time))) : 0;
  return { checks, complete, failed: !valid, score, stars: complete ? score >= 90 ? 3 : score >= 80 ? 2 : 1 : 0, progress: Math.min(1, id === 'rotation' ? r.evaluated / 60 : id === 'lift' ? Math.max(0, ((b?.y ?? 1) - 1) / 2) : Math.max(0, (5 - (b?.y ?? 5)) / 4)) };
}
