import type { Project } from "./model";
import type { FaultType } from "./automation";
import { Simulation, DT, AdaptiveRun } from "./engine";
/** Longest recorded experiment (30 simulated days). DT-stepped portions remain costly to replay. */
export const MAX_REPLAY_DURATION = 30 * 86400;
export interface RecordedInput {
  at: number;
  project?: Project;
  fault?: { id: string; type: FaultType | null };
  resetSafety?: string;
  pulse?: string;
  disconnect?: string;
  impulse?: { id: string; x: number; y: number; angular: number };
  /** Adaptive advance started at `at`: same algorithm, same options, same step count. */
  adaptive?: { duration: number; steps: number; tolerance: number; maxStep: number };
}
export function applyRecorded(s: Simulation, input: RecordedInput) {
  let error: string | null = null;
  if (input.project && !s.refresh(structuredClone(input.project)))
    error = s.error;
  if (input.fault) error = s.injectFault(input.fault.id, input.fault.type);
  if (input.resetSafety) error = s.resetSafety(input.resetSafety);
  if (input.pulse) s.pulse(input.pulse);
  if (input.disconnect) error = s.disconnect(input.disconnect);
  if (input.impulse) error = s.applyImpulse(input.impulse.id, { x: input.impulse.x, y: input.impulse.y }, input.impulse.angular);
  if (input.adaptive) {
    const run = new AdaptiveRun(s, input.adaptive.duration, { tolerance: input.adaptive.tolerance, maxStep: input.adaptive.maxStep, maxSteps: input.adaptive.steps });
    if (!run.run() || run.steps !== input.adaptive.steps) error = s.error ?? "Adaptive replay diverged from its recording.";
  }
  if (error) throw Error(error);
}
/** Advance a replay to `duration`, applying recorded inputs at their times. */
function* replaySteps(s: Simulation, inputs: RecordedInput[], duration: number) {
  let cursor = 0;
  const apply = () => { while (cursor < inputs.length && inputs[cursor].at <= s.time + 1e-8) applyRecorded(s, inputs[cursor++]); };
  while (s.time < duration - DT / 2) {
    const before = s.time;
    apply();
    if (s.time !== before) { yield; continue; }
    if (!s.step()) break;
    yield;
  }
  apply();
}
export function replayExperiment(
  origin: Project,
  inputs: RecordedInput[],
  duration: number,
) {
  if (!Number.isFinite(duration) || duration < 0 || duration > MAX_REPLAY_DURATION)
    throw Error("Replay supports experiments up to 30 simulated days.");
  const s = new Simulation(structuredClone(origin));
  for (const _ of replaySteps(s, inputs, duration)) void _;
  s.log("Deterministic replay completed, including control and fault inputs.");
  return s;
}

export interface RunArchive {
  format: 'physics-lab-run';
  version: 1;
  configuration: Project;
  origin: Project;
  inputs: RecordedInput[];
  duration: number;
}
import { parseProject } from './projects';
export function createRunArchive(configuration: Project, origin: Project, inputs: RecordedInput[], duration: number): RunArchive {
  return validateRunArchive({ format: 'physics-lab-run', version: 1, configuration, origin, inputs, duration });
}
export function validateRunArchive(value: unknown): RunArchive {
  const a = structuredClone(value) as RunArchive;
  if (!a || a.format !== 'physics-lab-run' || a.version !== 1 || !Number.isFinite(a.duration) || a.duration < 0 || a.duration > MAX_REPLAY_DURATION || !Array.isArray(a.inputs) || a.inputs.length > 5000) throw Error('Invalid run archive; supports at most 30 simulated days and 5,000 recorded inputs.');
  a.origin = parseProject(a.origin);
  a.configuration = parseProject(a.configuration);
  let previous = 0;
  for (const input of a.inputs) {
    if (!input || !Number.isFinite(input.at) || input.at < previous || input.at > a.duration + 1e-8) throw Error('Invalid replay timestamp.');
    previous = input.at;
    if (input.project) input.project = parseProject(input.project);
    if (input.fault && (typeof input.fault.id !== 'string' || (input.fault.type !== null && typeof input.fault.type !== 'string'))) throw Error('Invalid replay fault.');
    for (const key of ['pulse', 'disconnect', 'resetSafety'] as const) if (input[key] !== undefined && typeof input[key] !== 'string') throw Error('Invalid replay operation.');
    if (input.impulse && (typeof input.impulse.id !== 'string' || ![input.impulse.x, input.impulse.y, input.impulse.angular].every(Number.isFinite))) throw Error('Invalid replay impulse.');
    if (input.adaptive && (![input.adaptive.duration, input.adaptive.steps, input.adaptive.tolerance, input.adaptive.maxStep].every(Number.isFinite) || input.adaptive.duration <= 0 || input.adaptive.steps < 0 || !Number.isInteger(input.adaptive.steps) || input.adaptive.tolerance <= 0 || input.adaptive.maxStep <= 0)) throw Error('Invalid replay adaptive advance.');
    if (!['project', 'fault', 'pulse', 'disconnect', 'resetSafety', 'impulse', 'adaptive'].some(k => k in input)) throw Error('Empty replay operation.');
  }
  return a;
}
/** Yield during long browser restores; every domain is recomputed from validated inputs,
 * so an imported snapshot cannot forge inventory, energy or a challenge score. */
/**
 * Yield to the browser between computation slices. A MessageChannel task is not subject to the ≥ 4 ms clamp that
 * browsers apply to nested zero-delay timers (which cost a quarter of every 12 ms slice); Node falls back to a timer.
 */
export function yieldToBrowser(): Promise<void> {
  if (typeof MessageChannel === "undefined") return new Promise((resolve) => setTimeout(resolve, 0));
  return new Promise((resolve) => { const channel = new MessageChannel(); channel.port1.onmessage = () => { channel.port1.close(); resolve(); }; channel.port2.postMessage(null); });
}
export async function restoreRunArchive(value: unknown, yieldFrame: () => Promise<void> = yieldToBrowser) {
  const a = validateRunArchive(value), s = new Simulation(a.origin);
  let chunk = performance.now();
  for (const _ of replaySteps(s, a.inputs, a.duration)) {
    void _;
    if (performance.now() - chunk > 12) { await yieldFrame(); chunk = performance.now(); }
  }
  if (Math.abs(s.time - a.duration) > DT / 2) throw Error(`Run archive halted early: ${s.error ?? 'inconsistent duration'}`);
  if (JSON.stringify(s.project) !== JSON.stringify(a.configuration)) throw Error('Run configuration does not match its validated replay history.');
  s.log('Saved live experiment restored by deterministic replay, including fluid, shaft, thermal, controller and fault state.');
  return { simulation: s, archive: a };
}
