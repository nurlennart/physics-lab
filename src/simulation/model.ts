export type Kind =
  | "source"
  | "resistor"
  | "switch"
  | "lamp"
  | "heater"
  | "tank"
  | "ground"
  | "fuse"
  | "meter"
  | "sensor"
  | "comparator"
  | "hysteresis"
  | "relay"
  | "thermostat"
  | "timer"
  | "and"
  | "or"
  | "not"
  | "constant"
  | "latch"
  | "reset"
  | "safety"
  | "cooler"
  | "junction";
export type Domain = "electrical" | "thermal" | "control";
export type Property = number | boolean | string;
export type ChallengeId = "light" | "heat" | "runaway";
export interface Component {
  id: string;
  kind: Kind;
  name: string;
  x: number;
  y: number;
  rotation: number;
  variant?: string;
  props: Record<string, Property>;
}
export interface Terminal {
  component: string;
  port: string;
}
export interface Point {
  x: number;
  y: number;
}
export interface Connection {
  id: string;
  domain: Domain;
  from: Terminal;
  to: Terminal;
  route?: Point[];
}
export type Measurement =
  | "voltage"
  | "current"
  | "currentNC"
  | "power"
  | "temperature"
  | "energy"
  | "state"
  | "signal"
  | "nodeVoltage";
export interface Probe {
  id: string;
  name: string;
  component: string;
  measurement: Measurement;
  reference?: Terminal;
  terminal?: string;
  port?: string;
  color: string;
  visible: boolean;
}
export interface Assembly {
  id: string;
  name: string;
  components: Component[];
  connections: Connection[];
}
export interface Project {
  version: 1 | 2;
  id: string;
  name: string;
  components: Component[];
  connections: Connection[];
  challenge?: ChallengeId;
  probes?: Probe[];
  assemblies?: Assembly[];
}
export interface Port {
  unit?: string;
  id: string;
  domain: Domain;
  label: string;
  direction?: "in" | "out";
  signalType?: "number" | "boolean";
  optional?: boolean;
}
export interface Variant {
  id: string;
  label: string;
  cost: number;
  spec: string;
  overrides: Record<string, Property>;
}
export interface Definition {
  label: string;
  category: string;
  description: string;
  spec: string;
  cost: number;
  prefix: string;
  ports: Port[];
  defaults: Record<string, Property>;
  variants?: Variant[];
}
const electric: Port[] = [
  { id: "a", domain: "electrical", label: "Positive / input" },
  { id: "b", domain: "electrical", label: "Negative / output" },
];
const heat: Port = {
  id: "heat",
  domain: "thermal",
  label: "Thermal interface",
};
const input = (
  id = "in",
  signalType: "number" | "boolean" = "boolean",
  optional = false,
): Port => ({
  id,
  domain: "control",
  label: `${id} ${signalType} input`,
  direction: "in",
  signalType,
  optional,
});
const output = (
  signalType: "number" | "boolean" = "boolean",
  unit = signalType === "boolean" ? "bool" : "1",
): Port => ({
  unit,
  id: "out",
  domain: "control",
  label: `${signalType} output`,
  direction: "out",
  signalType,
});
const passive = {
  resistance: 6,
  ratedPower: 50,
  heatCapacity: 50,
  loss: 1,
  maxTemperature: 150,
};
export const definitions: Record<Kind, Definition> = {
  source: {
    label: "DC power supply",
    category: "Electrical",
    description: "Ideal adjustable DC supply with rated limits",
    spec: "0–240 V · 20 A",
    cost: 45,
    prefix: "PS",
    ports: electric,
    defaults: { voltage: 24, maxCurrent: 20, ratedVoltage: 240 },
    variants: [
      {
        id: "industrial",
        label: "Industrial 500 V / 40 A",
        cost: 85,
        spec: "0–500 V · 40 A",
        overrides: { maxCurrent: 40, ratedVoltage: 500 },
      },
    ],
  },
  resistor: {
    label: "Resistor",
    category: "Electrical",
    description: "Configurable resistance; catalog power and thermal ratings",
    spec: "6 Ω · 50 W",
    cost: 8,
    prefix: "R",
    ports: electric,
    defaults: passive,
    variants: [
      {
        id: "power",
        label: "Power resistor 250 W",
        cost: 20,
        spec: "250 W · 200 J/K",
        overrides: { ratedPower: 250, heatCapacity: 200, maxTemperature: 200 },
      },
    ],
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
      ...passive,
      closed: true,
      resistance: 0.01,
      ratedPower: 20,
      heatCapacity: 20,
    },
  },
  lamp: {
    label: "Filament lamp",
    category: "Electrical",
    description: "Constant-resistance lamp with measured brightness",
    spec: "6 Ω · 30 W",
    cost: 15,
    prefix: "L",
    ports: electric,
    defaults: {
      ...passive,
      resistance: 6,
      ratedPower: 30,
      heatCapacity: 20,
      maxTemperature: 120,
    },
  },
  heater: {
    label: "Immersion heater",
    category: "Thermal",
    description: "Resistive element with explicit immersion conductance",
    spec: "28.8 Ω · 2 kW",
    cost: 65,
    prefix: "H",
    ports: [...electric, heat],
    defaults: {
      resistance: 28.8,
      ratedPower: 2000,
      heatCapacity: 300,
      loss: 0.5,
      conductance: 180,
      maxTemperature: 150,
    },
    variants: [
      {
        id: "industrial",
        label: "3 kW industrial element",
        cost: 95,
        spec: "19.2 Ω · 3 kW",
        overrides: {
          resistance: 19.2,
          ratedPower: 3000,
          heatCapacity: 450,
          conductance: 240,
          maxTemperature: 180,
        },
      },
    ],
  },
  tank: {
    label: "Water tank",
    category: "Thermal",
    description: "Well-mixed liquid water with ambient heat exchange",
    spec: "10 L · 4,180 J/kg·K",
    cost: 40,
    prefix: "TK",
    ports: [heat],
    defaults: {
      volume: 10,
      capacity: 20,
      initialTemperature: 20,
      loss: 2.2,
      ambient: 20,
    },
    variants: [
      {
        id: "insulated",
        label: "Insulated 20 L vessel",
        cost: 65,
        spec: "20 L · 0.5 W/K",
        overrides: { loss: 0.5 },
      },
    ],
  },
  ground: {
    label: "Ground reference",
    category: "Electrical",
    description: "Shared zero-volt reference",
    spec: "0 V reference",
    cost: 0,
    prefix: "G",
    ports: [electric[0]],
    defaults: {},
  },
  junction: {
    label: "Wire junction",
    category: "Electrical",
    description: "Explicit shared electrical node; crossings never connect",
    spec: "Ideal conductor",
    cost: 0,
    prefix: "J",
    ports: [electric[0]],
    defaults: {},
  },
  fuse: {
    label: "Protective fuse",
    category: "Electrical",
    description: "Fails open after 0.1 s above rated current",
    spec: "10 A · 0.02 Ω",
    cost: 5,
    prefix: "F",
    ports: electric,
    defaults: {
      ...passive,
      resistance: 0.02,
      ratedCurrent: 10,
      ratedPower: 20,
      heatCapacity: 20,
    },
    variants: [
      {
        id: "heavy",
        label: "20 A fuse",
        cost: 9,
        spec: "20 A · 0.01 Ω",
        overrides: { ratedCurrent: 20, resistance: 0.01, ratedPower: 25 },
      },
    ],
  },
  meter: {
    label: "Voltmeter",
    category: "Sensors",
    description: "10 MΩ differential voltmeter with real circuit loading",
    spec: "10 MΩ input",
    cost: 12,
    prefix: "VM",
    ports: electric,
    defaults: {
      ...passive,
      resistance: 10000000,
      ratedPower: 1,
      heatCapacity: 20,
    },
  },
  sensor: {
    label: "Temperature sensor",
    category: "Sensors",
    description:
      "Measured thermal state with optional lag, resolution and seeded noise",
    spec: "0–120°C · 0.01°C",
    cost: 12,
    prefix: "TS",
    ports: [output("number", "°C")],
    defaults: {
      target: "",
      minRange: 0,
      maxRange: 120,
      resolution: 0.01,
      lag: 0,
      noise: 0,
    },
  },
  comparator: {
    label: "Comparator",
    category: "Automation",
    description: "Numeric comparison with explicit invalid-input propagation",
    spec: "< · ≤ · > · ≥",
    cost: 8,
    prefix: "CMP",
    ports: [input("in", "number"), input("ref", "number", true), output()],
    defaults: { reference: 80, mode: "lt" },
  },
  hysteresis: {
    label: "Hysteresis controller",
    category: "Automation",
    description:
      "Demand below low threshold, off at high threshold; retains state between",
    spec: "78 / 80°C",
    cost: 18,
    prefix: "HC",
    ports: [input("in", "number"), output()],
    defaults: { low: 78, high: 80, initialOn: false },
  },
  relay: {
    label: "Control relay",
    category: "Automation",
    description: "SPDT contact; command operates the actual electrical circuit",
    spec: "250 V · 12 A · SPDT",
    cost: 28,
    prefix: "RY",
    ports: [
      ...electric,
      { id: "nc", domain: "electrical", label: "Normally closed contact" },
      input(),
      output(),
    ],
    defaults: {
      resistance: 0.02,
      ratedPower: 14,
      heatCapacity: 40,
      loss: 1,
      maxTemperature: 150,
      ratedCurrent: 12,
      ratedVoltage: 250,
    },
    variants: [
      {
        id: "compact",
        label: "Compact 5 A relay",
        cost: 18,
        spec: "250 V · 5 A",
        overrides: { ratedCurrent: 5, ratedPower: 5 },
      },
      {
        id: "industrial",
        label: "Industrial 25 A relay",
        cost: 45,
        spec: "500 V · 25 A",
        overrides: {
          ratedCurrent: 25,
          ratedVoltage: 500,
          resistance: 0.01,
          ratedPower: 20,
          heatCapacity: 80,
        },
      },
    ],
  },
  thermostat: {
    label: "Thermostat",
    category: "Automation",
    description:
      "Sensor and hysteresis abstraction; optional external numeric sensor",
    spec: "80°C · 2°C band",
    cost: 24,
    prefix: "TH",
    ports: [input("in", "number", true), output()],
    defaults: {
      target: "",
      setpoint: 80,
      hysteresis: 2,
      minRange: 0,
      maxRange: 120,
      resolution: 0.01,
      lag: 0,
      noise: 0,
    },
  },
  timer: {
    label: "Simulation timer",
    category: "Automation",
    description: "Deterministic on-delay, off-delay or non-retriggerable pulse",
    spec: "TON · TOF · PULSE",
    cost: 10,
    prefix: "TM",
    ports: [input(), output()],
    defaults: { mode: "onDelay", delay: 5 },
  },
  and: {
    label: "AND gate",
    category: "Automation",
    description: "Both Boolean inputs required and valid",
    spec: "Boolean · 2 inputs",
    cost: 5,
    prefix: "AND",
    ports: [input("in"), input("in2"), output()],
    defaults: {},
  },
  or: {
    label: "OR gate",
    category: "Automation",
    description: "Either Boolean input; invalid inputs propagate",
    spec: "Boolean · 2 inputs",
    cost: 5,
    prefix: "OR",
    ports: [input("in"), input("in2"), output()],
    defaults: {},
  },
  not: {
    label: "NOT gate",
    category: "Automation",
    description: "Boolean inversion with invalid-input propagation",
    spec: "Boolean · inverter",
    cost: 4,
    prefix: "NOT",
    ports: [input(), output()],
    defaults: {},
  },
  constant: {
    label: "Numeric constant",
    category: "Automation",
    description: "Configurable numeric reference signal",
    spec: "Numeric output",
    cost: 3,
    prefix: "K",
    ports: [output("number")],
    defaults: { value: 80 },
  },
  latch: {
    label: "Set/reset latch",
    category: "Automation",
    description: "Reset-dominant Boolean memory",
    spec: "SET · RESET",
    cost: 9,
    prefix: "SR",
    ports: [input("set"), input("reset"), output()],
    defaults: { initialOn: false },
  },
  reset: {
    label: "Manual reset signal",
    category: "Automation",
    description: "One simulation-step Boolean pulse when pressed",
    spec: "Momentary Boolean",
    cost: 3,
    prefix: "RST",
    ports: [output()],
    defaults: {},
  },
  safety: {
    label: "Independent cutoff",
    category: "Automation",
    description:
      "Independent sensing path and latched series contact; manual reset",
    spec: "90°C · 250 V · 16 A",
    cost: 55,
    prefix: "ST",
    ports: [...electric, output()],
    defaults: {
      target: "",
      threshold: 90,
      resetMargin: 5,
      minRange: 0,
      maxRange: 120,
      resolution: 0.01,
      lag: 0,
      noise: 0,
      failOnSensor: true,
      resistance: 0.01,
      ratedPower: 10,
      heatCapacity: 50,
      loss: 1,
      maxTemperature: 150,
      ratedCurrent: 16,
      ratedVoltage: 250,
    },
  },
  cooler: {
    label: "Cooling jacket",
    category: "Thermal",
    description:
      "Controlled conductance to an ideal coolant reservoir; no fluid solver",
    spec: "8 W/K · 20°C coolant",
    cost: 30,
    prefix: "CJ",
    ports: [heat, input("in", "boolean", true)],
    defaults: { conductance: 8, ambient: 20, enabled: true },
    variants: [
      {
        id: "large",
        label: "16 W/K cooling jacket",
        cost: 48,
        spec: "16 W/K · 20°C coolant",
        overrides: { conductance: 16 },
      },
    ],
  },
};
export const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
export function catalog(c: Component) {
  const d = definitions[c.kind];
  const variant =
    c.variant && c.variant !== "standard"
      ? d.variants?.find((v) => v.id === c.variant)
      : undefined;
  if (c.variant && c.variant !== "standard" && !variant)
    throw Error(`${c.name}: unknown catalog variant.`);
  return {
    label: variant?.label ?? "Standard",
    cost: variant?.cost ?? d.cost,
    spec: variant?.spec ?? d.spec,
    props: { ...d.defaults, ...variant?.overrides },
  };
}
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
    variant: "standard",
    props: { ...d.defaults },
  };
}
export const prop = (c: Component, key: string, fallback = 0) =>
  typeof c.props[key] === "number" ? (c.props[key] as number) : fallback;
export const textProp = (c: Component, key: string, fallback = "") =>
  typeof c.props[key] === "string" ? (c.props[key] as string) : fallback;
export const terminalKey = (t: Terminal) => `${t.component}:${t.port}`;
export const isElectrical = (c: Component) =>
  definitions[c.kind].ports.some((p) => p.domain === "electrical") &&
  !["ground", "junction"].includes(c.kind);
export const isThermalMass = (c: Component) =>
  c.kind === "tank" || (isElectrical(c) && c.kind !== "source");
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
    return "Electrical and thermal terminals cannot be connected; control signals also require matching types.";
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
  if (pa.domain === "control") {
    if (pa.direction !== "out" || pb.direction !== "in")
      return "Connect a control output to a control input.";
    if (pa.signalType !== pb.signalType)
      return "Boolean and numeric control signals cannot be connected.";
    if (
      project.connections.some(
        (w) => w.domain === "control" && terminalKey(w.to) === terminalKey(to),
      )
    )
      return "A control input accepts one driver.";
    const edges = [
      ...project.connections.filter((w) => w.domain === "control"),
      { from, to },
    ];
    const seen = new Set<string>();
    const reaches = (id: string): boolean => {
      if (id === from.component) return true;
      if (seen.has(id)) return false;
      seen.add(id);
      return edges
        .filter((w) => w.from.component === id)
        .some((w) => reaches(w.to.component));
    };
    if (reaches(to.component))
      return "Control cycles are unsupported. Use controller memory without feedback wiring.";
  }
  if (pa.domain === "thermal") {
    const pair = [a!, b!];
    const heater = pair.find((c) => c.kind === "heater"),
      cooler = pair.find((c) => c.kind === "cooler");
    const tank = pair.find((c) => c.kind === "tank");
    if (
      !(heater && tank) &&
      !(cooler && pair.some((c) => c.kind === "tank" || c.kind === "heater"))
    )
      return "Connect a heater to a tank, or a cooling jacket to one thermal mass.";
    const limited = cooler ?? heater!;
    if (
      project.connections.some(
        (w) =>
          w.domain === "thermal" &&
          (w.from.component === limited.id || w.to.component === limited.id),
      )
    )
      return "This thermal interface is already attached to a thermal mass.";
  }
  return null;
}
export function connect(
  project: Project,
  from: Terminal,
  to: Terminal,
): Project {
  let a = project.components.find((c) => c.id === from.component),
    p = a && definitions[a.kind].ports.find((p) => p.id === from.port);
  if (p?.domain === "control" && p.direction === "in") [from, to] = [to, from];
  const error = connectionError(project, from, to);
  if (error) throw Error(error);
  a = project.components.find((c) => c.id === from.component)!;
  return {
    ...project,
    connections: [
      ...project.connections,
      {
        id: uid(),
        domain: definitions[a.kind].ports.find((p) => p.id === from.port)!
          .domain,
        from,
        to,
      },
    ],
  };
}
export const projectCost = (p: Project) =>
  p.components.reduce((n, c) => n + catalog(c).cost, 0);
