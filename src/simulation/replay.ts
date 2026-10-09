import type { Project } from "./model";
import type { FaultType } from "./automation";
import { Simulation, DT } from "./engine";
export interface RecordedInput {
  at: number;
  project?: Project;
  fault?: { id: string; type: FaultType | null };
  resetSafety?: string;
  pulse?: string;
  disconnect?: string;
}
export function applyRecorded(s: Simulation, input: RecordedInput) {
  let error: string | null = null;
  if (input.project && !s.refresh(structuredClone(input.project)))
    error = s.error;
  if (input.fault) error = s.injectFault(input.fault.id, input.fault.type);
  if (input.resetSafety) error = s.resetSafety(input.resetSafety);
  if (input.pulse) s.pulse(input.pulse);
  if (input.disconnect) error = s.disconnect(input.disconnect);
  if (error) throw Error(error);
}
export function replayExperiment(
  origin: Project,
  inputs: RecordedInput[],
  duration: number,
) {
  if (!Number.isFinite(duration) || duration < 0 || duration > 7200)
    throw Error("Replay supports experiments up to two simulation hours.");
  const s = new Simulation(structuredClone(origin));
  let cursor = 0;
  const apply = () => {
    while (cursor < inputs.length && inputs[cursor].at <= s.time + 1e-8)
      applyRecorded(s, inputs[cursor++]);
  };
  for (let i = 0; i < Math.round(duration / DT); i++) {
    apply();
    if (!s.step()) break;
  }
  apply();
  s.log("Deterministic replay completed, including control and fault inputs.");
  return s;
}
