/**
 * Shaft-train elements on a motor shaft: a flywheel (driven inertia, optionally behind a gear stage) and a
 * dynamometer (test-bench brake). Both attach directly to the motor shaft, next to an optional pump.
 *
 * Flywheel through a gear stage of ratio i (motor speed / flywheel speed) and efficiency η:
 *   reflected inertia J/i², reflected bearing drag b/i² (viscous, at the flywheel shaft).
 *   Power flowing to the flywheel needs T/η at the motor shaft; power flowing back delivers only η·T.
 * The transmitted torque at the motor side is T_t = (J/i²)·α + (b/i²)·ω; the motor shaft equation becomes
 *   J_m·α = T_e − b_m·ω − T_load − k·T_t,   k = 1/η if T_t·ω ≥ 0 (motor drives the flywheel), else η,
 * and the mesh loss (k − 1)·T_t·ω ≥ 0 leaves as heat. Kinetic energy ½·J·(ω/i)².
 *
 * Dynamometer absorbers (brakes: torque always opposes rotation, absorbed power leaves through the cooling):
 *   electric      constant set torque up to the rated speed (holds a stalled shaft), constant power above;
 *   eddyCurrent   the set torque within the envelope T_r·2x/(1 + x²), x = ω/ω_r (small at low speed, peak at
 *                 the rated speed), and P_r/ω above it;
 *   waterBrake    T = T_set·x² (the set torque applies at the rated speed), within T_r and P_r/ω.
 */
import { prop, type Component, type Project } from "./model";

export interface ShaftTrain { pump?: Component; flywheel?: Component; dynamometer?: Component }
const trains = new WeakMap<Project, Map<string, ShaftTrain>>();
/** Elements mechanically connected to a motor's shaft (cached per immutable project). */
export function shaftTrain(project: Project, motorId: string, disconnected: Set<string> = new Set()): ShaftTrain {
  const key = `${motorId}|${[...disconnected].sort().join(",")}`, byProject = trains.get(project) ?? new Map<string, ShaftTrain>();
  trains.set(project, byProject);
  const cached = byProject.get(key);
  if (cached) return cached;
  const train: ShaftTrain = {};
  for (const w of project.connections) {
    if (w.domain !== "mechanical" || disconnected.has(w.id) || (w.from.component !== motorId && w.to.component !== motorId)) continue;
    const other = project.components.find((c) => c.id === (w.from.component === motorId ? w.to.component : w.from.component));
    if (other?.kind === "pump" || other?.kind === "flywheel" || other?.kind === "dynamometer") train[other.kind === "pump" ? "pump" : other.kind] = other;
  }
  byProject.set(key, train);
  return train;
}
/** Flywheel reflected to the motor shaft. */
export function reflectedFlywheel(c: Component) {
  const ratio = prop(c, "gearRatio", 1);
  return { inertia: prop(c, "inertia") / ratio ** 2, drag: prop(c, "friction") / ratio ** 2, ratio, efficiency: prop(c, "gearEfficiency", 100) / 100 };
}
/** Total inertia on a motor shaft without gear losses (motor rotor, flywheel J/i², dynamometer rotor). */
export function shaftInertia(motor: Component, train: ShaftTrain) {
  return prop(motor, "inertia") + (train.flywheel ? reflectedFlywheel(train.flywheel).inertia : 0) + (train.dynamometer ? prop(train.dynamometer, "inertia") : 0);
}
/** Kinetic energy of the shaft-train elements other than the motor rotor (J). */
export function trainKineticEnergy(train: ShaftTrain, omega: number) {
  return 0.5 * omega * omega * ((train.flywheel ? reflectedFlywheel(train.flywheel).inertia : 0) + (train.dynamometer ? prop(train.dynamometer, "inertia") : 0));
}
/**
 * Motor-shaft acceleration with the train's inertia. `free` is the net torque without the flywheel coupling
 * (T_e − b_m·ω − T_load, dynamometer drag included in T_load); the gear factor k is chosen consistent with
 * the direction of the transmitted power. Returns the acceleration, the transmitted torque T_t and k.
 */
export function trainAcceleration(motorInertia: number, train: ShaftTrain, free: number, omega: number) {
  const dyno = train.dynamometer ? prop(train.dynamometer, "inertia") : 0;
  if (!train.flywheel) return { acceleration: free / (motorInertia + dyno), transmitted: 0, gear: 1 };
  const f = reflectedFlywheel(train.flywheel);
  const solve = (k: number) => {
    const acceleration = (free - k * f.drag * omega) / (motorInertia + dyno + k * f.inertia);
    return { acceleration, transmitted: f.inertia * acceleration + f.drag * omega, gear: k };
  };
  const forward = solve(1 / f.efficiency);
  if (forward.transmitted * omega >= 0 || f.efficiency === 1) return forward;
  const back = solve(f.efficiency);
  // Neither direction consistent (transmitted power crosses zero within the gear's friction band): the mesh is
  // momentarily loss-free at zero transmitted power.
  return back.transmitted * omega < 0 ? back : solve(1);
}
/** Absorber torque magnitude of a dynamometer at |ω| for a set torque (N·m, ≥ 0). */
export function dynamometerTorque(c: Component, omega: number, setTorque: number) {
  const speed = Math.abs(omega), rated = prop(c, "ratedTorque"), ratedSpeed = prop(c, "ratedSpeed"), power = prop(c, "ratedPower");
  const x = speed / ratedSpeed, powerLimit = speed > 0 ? power / speed : Infinity, set = Math.max(0, setTorque);
  switch (String(c.props.absorber ?? "eddyCurrent")) {
    case "electric": return Math.min(set, rated, powerLimit);
    case "waterBrake": return Math.min(set * x * x, rated, powerLimit);
    default: return Math.min(set, rated * 2 * x / (1 + x * x), powerLimit);
  }
}
/** Electric dynamometers hold a stalled shaft like static friction; the others absorb nothing at standstill. */
export const holdsAtStandstill = (c: Component) => String(c.props.absorber ?? "eddyCurrent") === "electric";
