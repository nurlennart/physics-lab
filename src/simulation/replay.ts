import type { Project } from "./model";
import { Simulation, DT } from "./engine";
export interface RecordedInput {
  at: number;
  project: Project;
}
export function replayExperiment(
  origin: Project,
  inputs: RecordedInput[],
  duration: number,
): Simulation {
  if (!Number.isFinite(duration) || duration < 0 || duration > 3600)
    throw Error("Replay supports experiments up to one simulation hour.");
  const s = new Simulation(structuredClone(origin));
  let cursor = 0;
  const apply = () => {
    while (cursor < inputs.length && inputs[cursor].at <= s.time + 1e-8) {
      s.refresh(structuredClone(inputs[cursor].project));
      s.log("Recorded editor input applied.");
      cursor++;
    }
  };
  for (let i = 0; i < Math.round(duration / DT); i++) {
    apply();
    if (!s.step()) break;
  }
  apply();
  s.log("Deterministic replay completed.");
  return s;
}
