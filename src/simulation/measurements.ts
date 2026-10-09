import {
  definitions,
  isElectrical,
  isThermalMass,
  type Component,
  type Measurement,
  type Probe,
  type Project,
} from "./model";
import { nodeVoltage } from "./electrical";
import type { Simulation } from "./engine";
export const units: Record<Measurement, string> = {
  voltage: "V",
  nodeVoltage: "V",
  current: "A",
  currentNC: "A",
  power: "W",
  temperature: "°C",
  energy: "J",
  state: "bool",
  signal: "signal",
};
export function measurements(c: Component): Measurement[] {
  return [
    ...(isElectrical(c)
      ? (["voltage", "current", "power", "energy"] as Measurement[])
      : []),
    ...(c.kind === "relay" ? ["currentNC" as const] : []),
    ...(isThermalMass(c) || ["sensor", "thermostat", "safety"].includes(c.kind)
      ? ["temperature" as const]
      : []),
    ...(definitions[c.kind].ports.some((p) => p.domain === "electrical")
      ? ["nodeVoltage" as const]
      : []),
    "state",
    ...(definitions[c.kind].ports.some(
      (p) => p.domain === "control" && p.direction === "out",
    )
      ? ["signal" as const]
      : []),
  ];
}
export function readProbe(p: Probe, s: Simulation): number | null {
  const c = s.project.components.find((c) => c.id === p.component);
  if (!c) return null;
  const r = s.electrical.readings[c.id];
  switch (p.measurement) {
    case "temperature":
      return ["sensor", "thermostat", "safety"].includes(c.kind)
        ? s.automation.sensors[c.id]?.valid
          ? Number(s.automation.sensors[c.id].value)
          : null
        : (s.temperatures[c.id] ?? null);
    case "energy":
      return s.componentEnergy[c.id] ?? 0;
    case "state": {
      if (s.failed[c.id] || s.faults[c.id] === "failedOpen") return 0;
      if (typeof s.automation.contacts[c.id] === "boolean")
        return Number(s.automation.contacts[c.id]);
      const signal = s.automation.signals[c.id];
      if (signal)
        return signal.valid
          ? typeof signal.value === "boolean"
            ? Number(signal.value)
            : 1
          : null;
      if (c.kind === "switch") return Number(c.props.closed);
      if (c.kind === "cooler") {
        if (s.faults[c.id] === "coolingFailed") return 0;
        const wired = s.project.connections.some(
          (w) => w.domain === "control" && w.to.component === c.id,
        );
        const command = s.automation.input(c, "in", s);
        return wired
          ? command.valid
            ? Number(command.value === true)
            : null
          : Number(c.props.enabled);
      }
      return 1;
    }
    case "signal":
      return s.automation.signals[c.id]?.valid
        ? Number(s.automation.signals[c.id].value)
        : null;
    case "nodeVoltage":
      return s.error
        ? null
        : nodeVoltage(
            s.electrical,
            `${c.id}:${p.terminal ?? "a"}`,
            p.reference
              ? `${p.reference.component}:${p.reference.port}`
              : undefined,
          );
    case "voltage":
      return s.error || r?.voltageValid === false ? null : (r?.voltage ?? null);
    case "current":
      return s.error ? null : (r?.current ?? null);
    case "currentNC":
      return s.error ? null : (r?.currentNC ?? null);
    case "power":
      return s.error
        ? null
        : c.kind === "source"
          ? -(r?.power ?? 0)
          : (r?.power ?? null);
  }
}
export const probeColors = [
  "#ef9975",
  "#e9bd6a",
  "#a58ae3",
  "#59b99b",
  "#3ba6d8",
  "#c9d3dc",
];

export function probeUnit(
  p: Pick<Probe, "component" | "measurement">,
  project: Project,
) {
  if (p.measurement !== "signal") return units[p.measurement];
  const c = project.components.find((c) => c.id === p.component);
  return c
    ? (definitions[c.kind].ports.find((p) => p.id === "out")?.unit ?? "1")
    : "1";
}
