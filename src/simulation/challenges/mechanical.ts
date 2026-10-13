import { economyFactor } from '../scoring';
import { catalog, projectCost, prop, type Component, type Project } from '../model';
import { configuredMass, shaftBody, type SpatialBody } from '../spatial-model';
import { catalogError } from '../integrity';
import { mechanicalStarter } from '../spatial-projects';
import type { Simulation } from '../engine';
import { controlledBy, fixturesOnly, lockedRules, standardLimits } from './common';
import { starsFor, type ChallengeDefinition } from './types';
import type { ChallengeId } from './ids';

export interface MechanicalState { hold: number; evaluated: number; inBand: number; squaredError: number; peakError: number; loadChanges: number; lastLoadPhase: number }
const initialState = (): MechanicalState => ({ hold: 0, evaluated: 0, inBand: 0, squaredError: 0, peakError: 0, loadChanges: 0, lastLoadPhase: -1 });
/** Tracking state of a running mechanical assignment. */
export const mechanicalState = (s: Simulation) => s.challengeState as MechanicalState;

type BodyReading = Simulation['spatial']['readings'][string];
/** What a mission's checks see: the load's reading, whether a motor did shaft work, and feedback wiring. */
interface Context { p: Project; s: Simulation; state: MechanicalState; body?: BodyReading; powered: boolean; sensor: boolean }
interface MechanicalMission {
  id: ChallengeId;
  starter(challenge?: boolean): Project;
  number: string; title: string; difficulty: string; description: string; objectives: string[];
  budget: number; economyTarget: number; guide: ChallengeDefinition['guide'];
  allowed: string[];
  /** The locked assignment body and its initial pose. */
  load: { name: string; mass: number; x: number; y: number };
  loadError?(load: SpatialBody): string | null;
  /** Locked foundation centre height (m). */
  floorY: number;
  /** Rules for a force actuator in the build. */
  actuatorError(c: Component, load: Component, p: Project): string | null;
  finalError?(p: Project): string | null;
  /** Feedback sensor the motor's control must descend from. */
  sensor: { kind: string; axis?: string };
  timeLimit: number;
  idealEnergy: number;
  idealTime: number;
  /** Energy scored against idealEnergy (J). */
  energy(s: Simulation): number;
  track(s: Simulation, state: MechanicalState, dt: number, body: BodyReading): void;
  checks(ctx: Context): { label: string; ok: boolean }[];
  progress(state: MechanicalState, body?: BodyReading): number;
  actuatorValue?(s: Simulation, id: string, configured: number): number;
  onAdd?(c: Component, p: Project): void;
}

function validateMechanical(m: MechanicalMission, p: Project): string | null {
  if (!p.world || p.world.gravity.x !== 0 || p.world.gravity.y !== -9.80665) return 'Mechanical assignment gravity is locked at 9.80665 m/s² downward.';
  const targets = p.components.filter(c => c.name === m.load.name), load = targets[0], body = load?.spatial;
  const lockedLoad = targets.length === 1 && load.kind === 'rigidBody' && body?.type === 'dynamic' && body.collision &&
    !(Math.abs(configuredMass(body) - m.load.mass) > 1e-7) &&
    body.x === m.load.x && body.y === m.load.y && body.angle === 0 && !body.vx && !body.vy && !body.omega;
  if (!lockedLoad) return 'The assignment load, initial pose, mass and collision configuration are locked.';
  const loadError = m.loadError?.(body);
  if (loadError) return loadError;
  const floor = p.components.filter(c => c.name === 'Foundation');
  if (floor.length !== 1 || floor[0].spatial?.type !== 'static' || floor[0].spatial.y !== m.floorY || floor[0].spatial.height !== 0.5) return 'The assignment support elevation and height are locked.';
  for (const c of p.components) {
    if (!m.allowed.includes(c.kind)) return `${c.name}: unavailable in this mechanical assignment.`;
    const catalogViolation = catalogError(c); if (catalogViolation) return catalogViolation;
    if (c.spatial && (c.spatial.vx || c.spatial.vy || c.spatial.omega)) return 'Assignment bodies must start from rest.';
    if (c.kind === 'rigidBody' && (prop(c, 'forceX') || prop(c, 'forceY') || prop(c, 'appliedTorque') || prop(c, 'brakeDamping'))) return 'Use the purchased brake/actuator; free body forces are disabled in assignments.';
    if (c.kind === 'source' && prop(c, 'voltage') > 48) return 'Assignment source voltage must not exceed 48 V.';
    const model = catalog(c).props;
    if (c.kind === 'motor' && c.props.resistance !== model.resistance) return `${c.name}: motor armature resistance belongs to the purchased catalog variant.`;
    for (const key of ['ratedVoltage', 'ratedCurrent', 'ratedPower', 'torqueConstant', 'emfConstant', 'inertia', 'friction', 'maxForce']) if (key in model && c.props[key] !== model[key]) return `${c.name}: rating or model coefficient belongs to the purchased catalog variant.`;
    if (c.kind === 'forceActuator') {
      const error = m.actuatorError(c, load, p);
      if (error) return error;
    }
  }
  return m.finalError?.(p) ?? null;
}
function updateMechanical(m: MechanicalMission, s: Simulation, r: MechanicalState, dt: number) {
  const target = s.project.components.find(c => c.name === m.load.name)!;
  const b = s.spatial.readings[target.id]; if (!b) return;
  if (s.peakPower > 2000.01) s.violation('Mechanical assignment exceeds 2,000 W electrical limit.');
  m.track(s, r, dt, b);
  if (s.time > m.timeLimit) s.violation('Mechanical assignment time limit exceeded.');
}
function evaluateMechanical(m: MechanicalMission, p: Project, s: Simulation, r: MechanicalState) {
  const target = p.components.find(c => c.name === m.load.name);
  const b = target && s.spatial.readings[target.id];
  const motors = p.components.filter(c => c.kind === 'motor'), powered = motors.some(c => shaftBody(p, c.id) && s.componentEnergy[c.id] > 10);
  const valid = !validateMechanical(m, p) && projectCost(p) <= m.budget && !s.error && !s.violations.length && !Object.keys(s.failed).length;
  const sensor = p.components.some(c => c.kind === m.sensor.kind && (m.sensor.axis === undefined || c.props.axis === m.sensor.axis) && c.props.target === target?.id && motors.some(motor => controlledBy(p, motor.id, x => x.id === c.id)));
  const checks = [
    { label: 'Locked load/environment, catalog ratings, budget and safety respected', ok: valid },
    ...m.checks({ p, s, state: r, body: b, powered, sensor }),
  ];
  const complete = checks.every(c => c.ok);
  const energy = Math.min(1, m.idealEnergy / Math.max(1, m.energy(s))),
    economy = economyFactor(m.economyTarget, projectCost(p), m.budget),
    time = Math.min(1, m.idealTime / Math.max(1, s.time));
  const score = complete ? Math.round(60 + 20 * energy + 10 * economy + 10 * time) : 0;
  return { checks, complete, failed: !valid, score, stars: starsFor(complete, score), progress: Math.min(1, m.progress(r, b)) };
}

/** Physical-view assignment with a locked load. Score 60 + 20 × energy + 10 × economy + 10 × time. */
function mechanicalMission(m: MechanicalMission): ChallengeDefinition<MechanicalState> {
  return {
    id: m.id, number: m.number, title: m.title, difficulty: m.difficulty, description: m.description, objectives: m.objectives, family: 'mechanical',
    budget: m.budget, economyTarget: m.economyTarget, guide: m.guide,
    rules: lockedRules(48, m.allowed),
    limits: standardLimits,
    spatial: true,
    validate: (p) => validateMechanical(m, p),
    scaffold: () => fixturesOnly(m.starter(true)),
    reference: () => m.starter(),
    onAdd: m.onAdd,
    createState: initialState,
    update: (s, state, dt) => updateMechanical(m, s, state, dt),
    actuatorValue: m.actuatorValue,
    evaluate: (p, s, state) => evaluateMechanical(m, p, s, state),
  };
}
/** Count stable time at height y (±0.08 m, ≤0.05 m/s). */
const holdAt = (r: MechanicalState, b: BodyReading, y: number, dt: number) => {
  const error = Math.abs(b.y - y), stable = error <= 0.08 && Math.hypot(b.vx, b.vy) <= 0.05;
  r.hold = stable ? r.hold + dt : 0;
};

export const descent = mechanicalMission({
  id: 'descent', starter: (challenge) => mechanicalStarter('descent', challenge), number: '007', title: 'Controlled Descent', difficulty: 'FOUNDATION', budget: 250, economyTarget: 100,
  description: 'Lower a 10 kg guided load from 5 m to the 1 m landing using a passive brake. Set the brake damping before running; impact speed must stay below 0.6 m/s.',
  objectives: ['Land at 1.00 ±0.08 m and rest for 3 s', 'Impact ≤0.6 m/s; braking heat ≤500 J', 'Complete within 120 s and €250'],
  guide: { mission: 'Ten kilograms. Four metres to fall. Engineer a landing worth applauding.', kit: 'The guided load and landing are supplied. Add a force actuator as a passive brake.', hints: ['The brake must target Suspended load on the y axis; force value stays zero.', 'Weight is about 98 N. Damping of 200 N·s/m gives a terminal speed near 0.49 m/s.', 'Set damping before running. Watch the landing speed and allow 3 s to settle.'] },
  allowed: ['rigidBody', 'forceActuator', 'positionSensor', 'comparator', 'pid', 'constant'],
  load: { name: 'Suspended load', mass: 10, x: 2, y: 5 },
  loadError: (load) => load.width !== 0.5 || load.height !== 0.5 ? 'Suspended load dimensions are locked.' : null,
  floorY: 0.5,
  actuatorError: (c, load, p) => c.props.target !== load.id || c.props.axis !== 'y' || prop(c, 'value') !== 0 || p.connections.some(w => w.domain === 'control' && w.to.component === c.id) ? 'Controlled descent allows only passive vertical braking on the load.' : null,
  sensor: { kind: 'positionSensor', axis: 'y' },
  timeLimit: 120, idealEnergy: 400, idealTime: 15,
  energy: (s) => s.spatial.dampingLoss,
  track: (s, r, dt, b) => {
    holdAt(r, b, 1, dt);
    if (s.spatial.maxImpactSpeed > 0.6) s.violation('Descent impact velocity exceeds 0.6 m/s.');
    if (s.spatial.dampingLoss > 500) s.violation('Descent braking heat exceeds 500 J.');
  },
  checks: ({ s, state: r, body }) => [
    { label: 'Load rests at 1.00 ±0.08 m with speed ≤0.05 m/s for 3 s', ok: !!body && r.hold >= 3 - 1e-8 },
    { label: 'Impact ≤0.6 m/s, passive braking ≤500 J, finish within 120 s', ok: s.spatial.maxImpactSpeed <= 0.6 && s.spatial.dampingLoss > 1 && s.spatial.dampingLoss <= 500 && s.time <= 120 },
  ],
  progress: (_r, b) => Math.max(0, (5 - (b?.y ?? 5)) / 4),
  // A new brake starts as the passive vertical brake on the load.
  onAdd: (c, p) => {
    if (c.kind !== 'forceActuator') return;
    c.props.target = p.components.find(c => c.name === 'Suspended load')!.id;
    c.props.axis = 'y';
    c.props.value = 0;
  },
});

export const lift = mechanicalMission({
  id: 'lift', starter: (challenge) => mechanicalStarter('lift', challenge), number: '008', title: 'Motorized Lift', difficulty: 'INTERMEDIATE', budget: 900, economyTarget: 549,
  description: 'Wire a 48 V motor and position feedback to raise a 10 kg load by 2 m through a real rack transmission. Tune the PI controller to hold the target safely.',
  objectives: ['Wire source, shared rotor shaft and position feedback', 'Lift to 3.00 ±0.08 m and hold for 3 s', 'Respect 48 V, 2 kW, €900 and 120 s limits'],
  guide: { mission: 'Build an elevator for a 10 kg payload. Smooth arrival earns the applause.', kit: 'The rack, rotor and guided load are supplied. Add a 48 V supply, traction motor, position sensor and PI controller.', hints: ['Choose the 48 V traction motor and a source model that supports 48 V. Couple motor shaft to Driven rotor.', 'Target Lift load with a y-position sensor; controller output goes to motor speed.', 'Try reference 3 m, feedforward 135 RPM, Kp 70, Ki 0 and max output 400 RPM. Tune and hold the landing for 3 s.'] },
  allowed: ['rigidBody', 'source', 'motor', 'positionSensor', 'speedSensor', 'pid', 'comparator', 'hysteresis', 'and', 'or', 'not', 'constant', 'relay', 'switch', 'fuse', 'ground', 'junction'],
  load: { name: 'Lift load', mass: 10, x: 6, y: 1 },
  floorY: -0.25,
  actuatorError: () => 'The lift must be powered through its electrical motor, not an external force source.',
  sensor: { kind: 'positionSensor', axis: 'y' },
  timeLimit: 120, idealEnergy: 500, idealTime: 15,
  energy: (s) => s.suppliedEnergy,
  track: (s, r, dt, b) => {
    holdAt(r, b, 3, dt);
    if (b.y < 0.2) s.violation('Lift load fell below the safe travel region.');
  },
  checks: ({ p, s, state: r, body, powered, sensor }) => [
    { label: 'Powered motor, real transmission and position feedback; ≥100 J shaft work', ok: powered && sensor && s.spatial.shaftWork >= 100 && !!p.world?.joints.some(j => j.kind === 'gear') },
    { label: '10 kg load raised to 3.00 ±0.08 m, stable for 3 s', ok: !!body && r.hold >= 3 - 1e-8 && s.time <= 120 },
  ],
  progress: (_r, b) => Math.max(0, ((b?.y ?? 1) - 1) / 2),
});

export const rotation = mechanicalMission({
  id: 'rotation', starter: (challenge) => mechanicalStarter('rotation', challenge), number: '009', title: 'Rotational Control', difficulty: 'ADVANCED', budget: 750, economyTarget: 482,
  description: 'Wire closed-loop speed control for 1,200 RPM while a physical shaft load alternates between 0.4 and 1.2 N·m every 15 s.',
  objectives: ['Use motor, spatial rotor, speed sensor and controller', 'After 10 s startup, regulate for 60 s: ≥95% within ±60 RPM', 'RMS ≤60 RPM; 48 V, 2 kW, €750 limits'],
  guide: { mission: 'The shaft load keeps shifting. Build a cruise control that refuses to wobble.', kit: 'The rotor, bearing and changing load are supplied. Add a 48 V supply, traction motor, speed sensor and PI controller.', hints: ['Couple the motor shaft to Driven rotor. Target that rotor with the speed sensor.', 'Start with reference 1200 RPM, Kp 0.8, Ki 2 and output limit 3000 RPM.', 'The load changes every 15 s. After 10 s startup, stay within ±60 RPM for at least 95% of the next 60 s.'] },
  allowed: ['rigidBody', 'source', 'motor', 'speedSensor', 'pid', 'forceActuator', 'comparator', 'constant', 'ground', 'junction'],
  load: { name: 'Driven rotor', mass: Math.PI * 0.2 ** 2 * 0.02 * 2700, x: 3, y: 3 },
  loadError: (load) => load.shape !== 'wheel' || load.width !== 0.4 || load.height !== 0.4 ? 'Assignment rotor geometry is locked.' : null,
  floorY: -0.25,
  actuatorError: (c, load, p) => c.name !== 'Variable shaft load' || c.props.target !== load.id || c.props.axis !== 'torque' || prop(c, 'value') !== -0.4 || prop(c, 'damping') !== 0 || p.components.filter(x => x.kind === 'forceActuator').length !== 1 ? 'The changing shaft-load actuator is locked.' : null,
  finalError: (p) => p.components.filter(c => c.kind === 'forceActuator').length !== 1 ? 'Keep the physical changing shaft load in the assignment.' : null,
  sensor: { kind: 'speedSensor' },
  timeLimit: 90, idealEnergy: 8000, idealTime: 70,
  energy: (s) => s.suppliedEnergy,
  track: (s, r, dt, b) => {
    const phase = Math.floor(s.time / 15);
    if (r.lastLoadPhase !== phase) { if (r.lastLoadPhase >= 0) r.loadChanges++; r.lastLoadPhase = phase; s.log(`Rotational assignment shaft load: ${phase % 2 ? '1.2' : '0.4'} N·m.`); }
    if (s.time >= 10) {
      const rpm = b.omega * 30 / Math.PI, error = rpm - 1200;
      r.evaluated += dt; r.squaredError += error ** 2 * dt; r.peakError = Math.max(r.peakError, Math.abs(error));
      if (Math.abs(error) <= 60) r.inBand += dt;
    }
  },
  checks: ({ state: r, powered, sensor }) => {
    const band = r.inBand / Math.max(1, r.evaluated), rms = Math.sqrt(r.squaredError / Math.max(1, r.evaluated));
    return [
      { label: 'Electrical motor, rotor and actual speed sensor feed control', ok: powered && sensor },
      { label: '60 s scored, ≥95% within ±60 RPM, RMS ≤60 RPM, changing load exercised', ok: r.evaluated >= 60 - 1e-8 && band >= 0.95 && rms <= 60 && r.loadChanges >= 4 },
    ];
  },
  progress: (r) => r.evaluated / 60,
  // The shaft load alternates between 0.4 and 1.2 N·m every 15 s.
  actuatorValue: (s, id, configured) => s.project.components.find(c => c.id === id)?.name === 'Variable shaft load' ? (Math.floor(s.time / 15) % 2 ? -1.2 : -0.4) : configured,
});
