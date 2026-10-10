import { actions, getState, simulation } from "./store";
interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: object;
  annotations: { readOnlyHint: boolean };
  execute: (input: unknown) => unknown;
}
export function registerLabTools() {
  const context = (
    document as Document & {
      modelContext?: {
        registerTool: (
          tool: Tool,
          options: { signal: AbortSignal },
        ) => void | Promise<void>;
      };
    }
  ).modelContext;
  if (!context?.registerTool) return () => {};
  const lifecycle = new AbortController();
  const tools: Tool[] = [
    {
      name: "read_lab_measurements",
      title: "Read laboratory measurements",
      description:
        "Read calculated voltages, currents, temperatures, energy, and simulation status. Hydraulic readings are SI; pump hydraulicPower is net Δp·Q, impellerPower is ρgH·Q, efficiency is overall net/shaft as a fraction (null when undefined).",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: () => ({
        time: simulation.time,
        running: getState().running,
        project: getState().project.name,
        readings: simulation.electrical.readings,
        temperatures: simulation.temperatures,
        hydraulics: simulation.multiphysics.hydraulic,
        tanks: simulation.multiphysics.tanks,
        /** Spill over tank rims: rate over the last step (m³/s) and cumulative volume (m³). */
        overflow: { rateM3s: simulation.multiphysics.overflowRate, volumeM3: simulation.multiphysics.overflowed },
        motors: simulation.multiphysics.motors,
        spatial: { bodies: simulation.spatial.readings, joints: simulation.spatial.jointReadings, contacts: simulation.spatial.contacts, residual: simulation.spatial.residual, externalWork: simulation.spatial.externalWork, dampingLoss: simulation.spatial.dampingLoss, contactLoss: simulation.spatial.contactLoss, limitLoss: simulation.spatial.limitLoss },
        massResidualKg: simulation.multiphysics.massResidual,
        energyResidualJ: simulation.energyResidual,
        energyJ: simulation.energy,
        error: simulation.error,
      }),
    },
    {
      name: "set_lab_running",
      title: "Run or pause the experiment",
      description:
        "Set the simulation running state using the workspace Run and Pause actions.",
      inputSchema: {
        type: "object",
        properties: { running: { type: "boolean" } },
        required: ["running"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
      execute: async (input) => {
        if (
          !input ||
          typeof input !== "object" ||
          typeof (input as { running: unknown }).running !== "boolean"
        )
          throw Error("running must be a boolean.");
        const desired = (input as { running: boolean }).running;
        if (desired !== getState().running) actions.run();
        return { running: getState().running, error: simulation.error };
      },
    },
    {
      name: "advance_lab_simulation",
      title: "Advance the paused experiment",
      description:
        "Advance the paused experiment. Thermal/electrical/control experiments use event-aware adaptive steps; hydraulic, motor and rigid-body experiments use fixed 1/60 second steps.",
      inputSchema: {
        type: "object",
        properties: { seconds: { type: "integer", minimum: 1, maximum: 86400 } },
        required: ["seconds"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
      execute: async (input) => {
        const seconds = (input as { seconds?: unknown })?.seconds;
        if (
          typeof seconds !== "number" ||
          !Number.isInteger(seconds) ||
          seconds < 1 ||
          seconds > 86400
        )
          throw Error("seconds must be an integer from 1 to 86,400.");
        if (getState().running) throw Error("Pause the experiment first.");
        await actions.advance(seconds);
        return {
          time: simulation.time,
          energyJ: simulation.energy,
          error: simulation.error,
        };
      },
    },
  ];
  for (const tool of tools) {
    try {
      Promise.resolve(
        context.registerTool(tool, { signal: lifecycle.signal }),
      ).catch((e) => console.warn("Lab tool registration failed.", e));
    } catch (e) {
      console.warn("Lab tool registration failed.", e);
    }
  }
  return () => lifecycle.abort();
}
