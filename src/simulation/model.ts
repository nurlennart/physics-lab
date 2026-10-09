export type Kind =
  | "source"
  | "resistor"
  | "switch"
  | "lamp"
  | "heater"
  | "tank"
  | "ground"
  | "fuse"
  | "meter";
export type Domain = "electrical" | "thermal";
export interface Component {
  id: string;
  kind: Kind;
  name: string;
  x: number;
  y: number;
  rotation: number;
  props: Record<string, number | boolean>;
}
export interface Terminal {
  component: string;
  port: string;
}
export interface Connection {
  id: string;
  domain: Domain;
  from: Terminal;
  to: Terminal;
}
export interface Project {
  version: 1;
  id: string;
  name: string;
  components: Component[];
  connections: Connection[];
  challenge?: "light" | "heat";
}
export interface Definition {
  label: string;
  category: string;
  description: string;
  spec: string;
  cost: number;
  prefix: string;
  ports: { id: string; domain: Domain; label: string }[];
  defaults: Record<string, number | boolean>;
}
const electric = [
  { id: "a", domain: "electrical" as const, label: "Positive / input" },
  { id: "b", domain: "electrical" as const, label: "Negative / output" },
];
export const definitions: Record<Kind, Definition> = {
  source: {
    label: "DC power supply",
    category: "Electrical",
    description: "Ideal regulated DC voltage source",
    spec: "24 V · 20 A",
    cost: 45,
    prefix: "PS",
    ports: electric,
    defaults: { voltage: 24, maxCurrent: 20 },
  },
  resistor: {
    label: "Resistor",
    category: "Electrical",
    description: "Constant resistance with thermal mass",
    spec: "6 Ω · 50 W",
    cost: 8,
    prefix: "R",
    ports: electric,
    defaults: {
      resistance: 6,
      ratedPower: 50,
      heatCapacity: 50,
      loss: 1,
      maxTemperature: 150,
    },
  },
  switch: {
    label: "Switch",
    category: "Electrical",
    description: "Single-pole circuit isolation",
    spec: "SPST · 0.01 Ω",
    cost: 8,
    prefix: "S",
    ports: electric,
    defaults: {
      closed: true,
      resistance: 0.01,
      ratedPower: 20,
      heatCapacity: 20,
      loss: 1,
      maxTemperature: 150,
    },
  },
  lamp: {
    label: "Filament lamp",
    category: "Electrical",
    description: "Resistive lamp with visible power output",
    spec: "6 Ω · 30 W",
    cost: 15,
    prefix: "L",
    ports: electric,
    defaults: {
      resistance: 6,
      ratedPower: 30,
      heatCapacity: 20,
      loss: 1,
      maxTemperature: 120,
    },
  },
  heater: {
    label: "Immersion heater",
    category: "Thermal",
    description: "Resistive element with a thermal interface",
    spec: "28.8 Ω · 2 kW",
    cost: 65,
    prefix: "H",
    ports: [
      ...electric,
      { id: "heat", domain: "thermal", label: "Immersion heat interface" },
    ],
    defaults: {
      resistance: 28.8,
      ratedPower: 2000,
      heatCapacity: 300,
      loss: 0.5,
      conductance: 180,
      maxTemperature: 150,
    },
  },
  tank: {
    label: "Water tank",
    category: "Thermal",
    description: "Well-mixed liquid water and ambient losses",
    spec: "10 L · 4,180 J/kg·K",
    cost: 40,
    prefix: "TK",
    ports: [
      { id: "heat", domain: "thermal", label: "Immersion heat interface" },
    ],
    defaults: {
      volume: 10,
      capacity: 20,
      initialTemperature: 20,
      loss: 2.2,
      ambient: 20,
    },
  },
  ground: {
    label: "Ground reference",
    category: "Electrical",
    description: "Defines the 0 V circuit reference",
    spec: "0 V reference",
    cost: 0,
    prefix: "G",
    ports: [{ id: "a", domain: "electrical", label: "Reference" }],
    defaults: {},
  },
  fuse: {
    label: "Protective fuse",
    category: "Electrical",
    description: "Opens after excess current for 0.1 seconds",
    spec: "10 A · 0.02 Ω",
    cost: 5,
    prefix: "F",
    ports: electric,
    defaults: {
      resistance: 0.02,
      ratedCurrent: 10,
      ratedPower: 20,
      heatCapacity: 20,
      loss: 1,
      maxTemperature: 150,
    },
  },
  meter: {
    label: "Voltmeter",
    category: "Sensors",
    description: "High-impedance differential measurement",
    spec: "10 MΩ input",
    cost: 12,
    prefix: "VM",
    ports: electric,
    defaults: {
      resistance: 10000000,
      ratedPower: 1,
      heatCapacity: 20,
      loss: 1,
      maxTemperature: 150,
    },
  },
};
export const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
export function makeComponent(
  kind: Kind,
  x: number,
  y: number,
  components: Component[] = [],
): Component {
  const d = definitions[kind];
  let n = 1;
  while (
    components.some(
      (c) => c.name === `${d.prefix}-${String(n).padStart(2, "0")}`,
    )
  )
    n++;
  return {
    id: uid(),
    kind,
    name: `${d.prefix}-${String(n).padStart(2, "0")}`,
    x,
    y,
    rotation: 0,
    props: { ...d.defaults },
  };
}
export const prop = (c: Component, key: string, fallback = 0) =>
  typeof c.props[key] === "number" ? (c.props[key] as number) : fallback;
export const terminalKey = (t: Terminal) => `${t.component}:${t.port}`;
export function connectionError(
  project: Project,
  from: Terminal,
  to: Terminal,
): string | null {
  const a = project.components.find((c) => c.id === from.component),
    b = project.components.find((c) => c.id === to.component);
  const pa = a && definitions[a.kind].ports.find((p) => p.id === from.port),
    pb = b && definitions[b.kind].ports.find((p) => p.id === to.port);
  if (!pa || !pb) return "This terminal does not exist.";
  if (from.component === to.component)
    return "Connect terminals on different components.";
  if (pa.domain !== pb.domain)
    return "Electrical and thermal terminals cannot be connected.";
  if (
    project.connections.some(
      (w) =>
        (terminalKey(w.from) === terminalKey(from) &&
          terminalKey(w.to) === terminalKey(to)) ||
        (terminalKey(w.to) === terminalKey(from) &&
          terminalKey(w.from) === terminalKey(to)),
    )
  )
    return "These terminals are already connected.";
  if (pa.domain === "thermal") {
    if (
      !(
        (a!.kind === "heater" && b!.kind === "tank") ||
        (a!.kind === "tank" && b!.kind === "heater")
      )
    )
      return "An immersion interface connects a heater to a water tank.";
    const heater = a!.kind === "heater" ? a! : b!;
    if (
      project.connections.some(
        (w) =>
          w.domain === "thermal" &&
          (w.from.component === heater.id || w.to.component === heater.id),
      )
    )
      return "A heater can be immersed in one tank at a time.";
  }
  return null;
}
export function connect(
  project: Project,
  from: Terminal,
  to: Terminal,
): Project {
  const error = connectionError(project, from, to);
  if (error) throw Error(error);
  const c = project.components.find((c) => c.id === from.component)!;
  const domain = definitions[c.kind].ports.find(
    (p) => p.id === from.port,
  )!.domain;
  return {
    ...project,
    connections: [...project.connections, { id: uid(), domain, from, to }],
  };
}
export const projectCost = (p: Project) =>
  p.components.reduce((n, c) => n + definitions[c.kind].cost, 0);
