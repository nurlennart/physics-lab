import {
  catalog,
  definitions,
  projectCost,
  prop,
  textProp,
  type Component,
  type Project,
  type Property,
  type ChallengeId,
} from "./model";
export const liveProperties = new Set([
  "closed",
  "voltage",
  "setpoint",
  "hysteresis",
  "low",
  "high",
  "reference",
  "value",
  "enabled",
]);
export const configurableProperties = new Set([
  "resistance",
  "volume",
  "initialTemperature",
  "ambient",
  "target",
  "minRange",
  "maxRange",
  "resolution",
  "lag",
  "noise",
  "mode",
  "delay",
  "threshold",
  "resetMargin",
  "failOnSensor",
  "initialOn",
]);
export const ranges: Record<string, [number, number]> = {
  voltage: [0, 500],
  maxCurrent: [0.01, 10000],
  ratedVoltage: [1, 10000],
  resistance: [0.001, 1e7],
  ratedPower: [0.01, 1e5],
  heatCapacity: [1, 1e6],
  loss: [0, 10000],
  maxTemperature: [21, 1000],
  conductance: [0.01, 10000],
  volume: [0.1, 10000],
  capacity: [0.1, 10000],
  initialTemperature: [1, 95],
  ambient: [1, 95],
  ratedCurrent: [0.01, 10000],
  minRange: [-100, 1000],
  maxRange: [-99, 2000],
  resolution: [0.000001, 10],
  lag: [0, 1000],
  noise: [0, 10],
  reference: [-1000000, 1000000],
  low: [-1000, 1000],
  high: [-1000, 1000],
  setpoint: [1, 95],
  hysteresis: [0.01, 50],
  delay: [0.001, 3600],
  value: [-1000000, 1000000],
  threshold: [1, 95],
  resetMargin: [0.01, 50],
};
export const challengePolicies: Record<
  ChallengeId,
  {
    budget: number;
    ambient: number;
    initial: number;
    volume: number;
    maxVoltage: number;
    maxPower: number;
    allowed: string[];
  }
> = {
  light: {
    budget: 100,
    ambient: 20,
    initial: 20,
    volume: 10,
    maxVoltage: 12,
    maxPower: Infinity,
    allowed: [
      "source",
      "resistor",
      "switch",
      "lamp",
      "ground",
      "junction",
      "fuse",
      "meter",
    ],
  },
  heat: {
    budget: 180,
    ambient: 20,
    initial: 20,
    volume: 10,
    maxVoltage: 240,
    maxPower: 2000.01,
    allowed: [
      "source",
      "resistor",
      "switch",
      "heater",
      "tank",
      "ground",
      "junction",
      "fuse",
      "meter",
    ],
  },
  runaway: {
    budget: 500,
    ambient: 20,
    initial: 20,
    volume: 10,
    maxVoltage: 240,
    maxPower: 2000.01,
    allowed: Object.keys(definitions),
  },
};
// Ratings and model coefficients come from a paid catalog variant, never editable free upgrades.
export function catalogError(c: Component): string | null {
  const expected = catalog(c).props;
  for (const [key, value] of Object.entries(expected)) {
    if (
      !liveProperties.has(key) &&
      !configurableProperties.has(key) &&
      c.props[key] !== value
    )
      return `${c.name}: ${key} belongs to its catalog model. Select a paid variant.`;
  }
  if (c.kind === "source" && prop(c, "voltage") > prop(c, "ratedVoltage"))
    return `${c.name}: voltage exceeds the catalog supply range.`;
  if (
    ["heater", "switch", "fuse", "meter", "relay", "safety"].includes(c.kind) &&
    c.props.resistance !== expected.resistance
  )
    return `${c.name}: contact/element resistance belongs to its catalog model.`;
  return null;
}
export function challengeError(
  p: Project,
  challenge = p.challenge,
): string | null {
  if (!challenge) return null;
  const rules = challengePolicies[challenge];
  if (!rules) return "Unknown challenge.";
  if (p.challenge !== challenge)
    return "The running challenge identity is locked until a new experiment is loaded.";
  if (projectCost(p) > rules.budget)
    return `Challenge budget exceeded: €${projectCost(p)} / €${rules.budget}.`;
  let tanks = 0;
  for (const c of p.components) {
    if (!rules.allowed.includes(c.kind))
      return `${c.name}: this component is unavailable in the assignment.`;
    const error = catalogError(c);
    if (error) return error;
    if (c.kind === "tank") {
      tanks++;
      if (
        prop(c, "volume") !== rules.volume ||
        prop(c, "initialTemperature") !== rules.initial ||
        prop(c, "ambient") !== rules.ambient
      )
        return "Challenge water mass, initial temperature, and ambient conditions are locked.";
    }
    if (c.kind === "cooler" && prop(c, "ambient") !== rules.ambient)
      return "Challenge coolant temperature is locked.";
    if (c.kind === "source" && prop(c, "voltage") > rules.maxVoltage)
      return `Challenge supply voltage must not exceed ${rules.maxVoltage} V.`;
    if (c.kind === "safety" && !c.props.failOnSensor)
      return "Challenge safety sensing must trip on invalid measurement.";
  }
  if (challenge !== "light" && tanks !== 1)
    return "This assignment requires exactly one 10 L process vessel.";
  return null;
}
export function physicsSignature(p: Project) {
  return JSON.stringify(
    p.components
      .map((c) => ({
        id: c.id,
        kind: c.kind,
        variant: c.variant ?? "standard",
        props: Object.fromEntries(
          Object.entries(c.props)
            .filter(([k]) => !liveProperties.has(k))
            .sort(([a], [b]) => a.localeCompare(b)),
        ),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  );
}
export function transitionError(
  previous: Project,
  next: Project,
  time: number,
  lockedChallenge?: ChallengeId,
): string | null {
  for (const c of next.components) {
    if (!definitions[c.kind]) return "Unknown component kind.";
    for (const [k, v] of Object.entries(definitions[c.kind].defaults))
      if (typeof c.props[k] !== typeof v) return `${c.name}: invalid ${k}.`;
    if (
      c.kind === "timer" &&
      !["onDelay", "offDelay", "pulse"].includes(textProp(c, "mode"))
    )
      return "Unknown timer mode.";
    if (
      c.kind === "comparator" &&
      !["lt", "lte", "gt", "gte"].includes(textProp(c, "mode"))
    )
      return "Unknown comparator mode.";
    for (const [k, v] of Object.entries(c.props)) {
      if (
        typeof v === "number" &&
        (!Number.isFinite(v) ||
          (ranges[k] && (v < ranges[k][0] || v > ranges[k][1])))
      )
        return `${c.name}: ${k} is out of range.`;
    }
    if (c.kind === "tank" && prop(c, "volume") > prop(c, "capacity"))
      return "Water volume exceeds tank capacity.";
    if (c.kind === "hysteresis" && prop(c, "low") >= prop(c, "high"))
      return "Low threshold must be below high threshold.";
    if (
      ["sensor", "thermostat", "safety"].includes(c.kind) &&
      prop(c, "minRange") >= prop(c, "maxRange")
    )
      return "Sensor minimum must be below maximum.";
  }
  const violation = challengeError(next, lockedChallenge ?? next.challenge);
  if (violation) return violation;
  if (time > 1e-10 && physicsSignature(previous) !== physicsSignature(next))
    return "Reset the experiment before changing physical configuration, thermal mass, sensor assignment, component models, or inventory.";
  return null;
}
export function propertyError(
  p: Project,
  c: Component,
  key: string,
  value: Property,
  time: number,
): string | null {
  if (!(key in definitions[c.kind].defaults))
    return "Unknown component property.";
  if (typeof value !== typeof definitions[c.kind].defaults[key])
    return "Invalid property type.";
  const range = ranges[key];
  if (
    typeof value === "number" &&
    (!Number.isFinite(value) ||
      (range && (value < range[0] || value > range[1])))
  )
    return "That value is outside the supported range.";
  if (!liveProperties.has(key) && !configurableProperties.has(key))
    return "This specification is defined by the catalog variant.";
  const next = {
    ...p,
    components: p.components.map((x) =>
      x.id === c.id ? { ...c, props: { ...c.props, [key]: value } } : x,
    ),
  };
  return transitionError(p, next, time);
}
