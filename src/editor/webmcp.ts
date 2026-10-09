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
        "Read calculated voltages, currents, temperatures, energy, and simulation status.",
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
        "Execute the requested duration in fixed 1/60 second steps while the experiment is paused.",
      inputSchema: {
        type: "object",
        properties: { seconds: { type: "integer", minimum: 1, maximum: 600 } },
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
          seconds > 600
        )
          throw Error("seconds must be an integer from 1 to 600.");
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
