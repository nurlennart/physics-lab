import { compatibleTarget } from "./capabilities";
import {
  connectionError,
  catalog,
  definitions,
  projectCost,
  prop,
  type Component,
  type Project,
  type Property,
  type ChallengeId,
} from "./model";
import { spatialError, spatialSignature } from './spatial-model';
import { applyDerived, derivedError, domainError, editEffects, paramSpec, type EditPolicy } from "./parameters";
import { mechanicalChallengeError } from './spatial-challenges';
import { parsePumpPoints } from "./hydraulic";
/**
 * Challenge-mode editing sets (unchanged from the scored assignments). In a
 * challenge only these keys may differ from the purchased catalog model, and only
 * `challengeLiveProperties` may change after the clock starts. Free Sandbox mode
 * uses the parameter metadata in parameters.ts instead.
 */
export const liveProperties = new Set([
  'forceX', 'forceY', 'appliedTorque', 'brakeDamping',
  "opening", "speedCommand", "speedControl",
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
  'axis', 'quantity', 'stream', 'damping', 'feedforward',
  "capacity", "elevation", "surfaceArea", "length", "diameter", "roughness", "material", "conductivity", "insulation", "thermalUA", "loadTorque", "responseTime", "failOpen", "kp", "ki", "minOutput", "maxOutput",
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
export const challengeLiveProperties = liveProperties;
/** Effective editing policy of one property in the given mode. */
export function editPolicy(c: Component, key: string, challenge?: ChallengeId): EditPolicy | "catalog" {
  const spec = paramSpec(c.kind, key);
  if (spec?.policy === "derived" || spec?.policy === "fixed") return spec.policy;
  if (challenge) {
    if (liveProperties.has(key)) return "live";
    if (configurableProperties.has(key) && !(c.kind === "source" && key === "mode") && !(c.kind === "cable")) return "reset";
    return "catalog";
  }
  return spec?.policy ?? "reset";
}
/** Keys whose change after t = 0 alters stored energy, mass or initial state. */
function stateDefining(c: Component, key: string, challenge?: ChallengeId): boolean {
  const spec = paramSpec(c.kind, key);
  if (challenge) return !liveProperties.has(key);
  if (!spec) return true;
  if (spec.policy === "derived") return (spec.derivedFrom ?? []).some((k): boolean => stateDefining(c, k));
  return spec.policy !== "live";
}
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
  descent: { budget: 250, ambient: 20, initial: 20, volume: 0, maxVoltage: 48, maxPower: 2000, allowed: ['rigidBody', 'forceActuator', 'positionSensor', 'comparator', 'pid', 'constant'] },
  lift: { budget: 900, ambient: 20, initial: 20, volume: 0, maxVoltage: 48, maxPower: 2000, allowed: ['rigidBody', 'source', 'motor', 'positionSensor', 'speedSensor', 'pid', 'comparator', 'hysteresis', 'and', 'or', 'not', 'constant', 'relay', 'switch', 'fuse', 'ground', 'junction'] },
  rotation: { budget: 750, ambient: 20, initial: 20, volume: 0, maxVoltage: 48, maxPower: 2000, allowed: ['rigidBody', 'source', 'motor', 'speedSensor', 'pid', 'forceActuator', 'comparator', 'constant', 'ground', 'junction'] },
  transfer: { budget: 650, ambient: 20, initial: 20, volume: 150, maxVoltage: 24, maxPower: 500, allowed: Object.keys(definitions).filter(k => !["heater", "cooler"].includes(k)) },
  pressure: { budget: 750, ambient: 20, initial: 20, volume: 150, maxVoltage: 24, maxPower: 500, allowed: Object.keys(definitions).filter(k => !["heater", "cooler"].includes(k)) },
  supply: { budget: 850, ambient: 20, initial: 20, volume: 150, maxVoltage: 24, maxPower: 500, allowed: Object.keys(definitions).filter(k => !["heater", "cooler"].includes(k)) },
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
  if (c.kind === "source" && c.props.mode !== expected.mode)
    return `${c.name}: source behaviour belongs to its catalog model. Select a paid variant.`;
  if (
    ["heater", "switch", "fuse", "meter", "relay", "safety", "cable"].includes(c.kind) &&
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
  if (p.environment && p.environment.ambient !== rules.ambient)
    return "Challenge environment is locked at the assignment ambient temperature.";
  // Custom ratings are rejected before costing: a scored assignment never prices them.
  for (const c of p.components) {
    if (["battery", "contactor", "transformer", "radiator", "circulator", "electricBoiler"].includes(c.kind)) return `${c.name}: this component is available in Free Sandbox only.`;
    const error = catalogError(c);
    if (error) return error;
  }
  if (projectCost(p) > rules.budget)
    return `Challenge budget exceeded: €${projectCost(p)} / €${rules.budget}.`;
  if (['descent', 'lift', 'rotation'].includes(challenge)) return mechanicalChallengeError(p);
  if (p.world || p.components.some(c => c.spatial)) return 'Spatial worlds are disabled in the earlier schematic assignments; use a mechanical assignment or sandbox.';
  const hydraulicChallenge = ["transfer", "pressure", "supply"].includes(challenge);
  if (hydraulicChallenge) {
    for (const name of ["Source reservoir", "Destination tank"]) {
      const matches = p.components.filter(c => c.name === name);
      if (matches.length !== 1 || matches[0].kind !== "tank") return "Hydraulic assignments require unique locked source/destination vessels.";
    }
    if (challenge === "pressure" || challenge === "supply") {
      const demand = p.components.filter(c => c.name === "Consumer demand");
      if (demand.length !== 1 || demand[0].kind !== "valve" || prop(demand[0], "diameter") !== (challenge === "pressure" ? 0.018 : 0.012) || prop(demand[0], "opening") !== (challenge === "pressure" ? 40 : 35)) return "The challenge consumer-demand valve is locked.";
    }
  }
  let tanks = 0;
  for (const c of p.components) {
    if (!rules.allowed.includes(c.kind))
      return `${c.name}: this component is unavailable in the assignment.`;
    if (["battery", "contactor", "transformer", "radiator", "circulator", "electricBoiler"].includes(c.kind)) return `${c.name}: this component is available in Free Sandbox only.`;
    const error = catalogError(c);
    if (error) return error;
    if (c.kind === "tank") {
      tanks++;
      if (
        (!hydraulicChallenge && prop(c, "volume") !== rules.volume) ||
        (hydraulicChallenge && (prop(c, "volume") !== (c.name === "Source reservoir" ? 150 : 0) || prop(c, "capacity") !== (c.name === "Source reservoir" ? 150 : 120) || prop(c, "surfaceArea") !== 0.1 || prop(c, "elevation") !== (c.name === "Source reservoir" ? 0 : challenge === "pressure" ? 0 : 2))) ||
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
  if (hydraulicChallenge && tanks !== 2) return "Hydraulic assignments require the two locked source/destination vessels.";
  if (!hydraulicChallenge && challenge !== "light" && tanks !== 1)
    return "This assignment requires exactly one 10 L process vessel.";
  return null;
}
export function physicsSignature(p: Project, challenge = p.challenge) {
  return JSON.stringify(
    p.components
      .map((c) => ({
        id: c.id,
        kind: c.kind,
        variant: c.variant ?? "standard",
        props: Object.fromEntries(
          Object.entries(c.props)
            .filter(([k]) => stateDefining(c, k, challenge))
            .sort(([a], [b]) => a.localeCompare(b)),
        ),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  );
}
/** Physical-validity errors of one component configuration (mode independent). */
export function componentError(c: Component): string | null {
  if (!definitions[c.kind]) return "Unknown component kind.";
  for (const [k, v] of Object.entries(definitions[c.kind].defaults))
    if (typeof c.props[k] !== typeof v) return `${c.name}: invalid ${k}.`;
  for (const [k, v] of Object.entries(c.props)) {
    if (typeof v === "number" && !Number.isFinite(v)) return `${c.name}: ${k} is out of range.`;
    const error = domainError(c.kind, k, v);
    if (error) return `${c.name}: ${error}`;
  }
  if (c.kind === 'electricBoiler') {
    if (!Number.isInteger(prop(c, 'maxStages'))) return 'Boiler stage limit must be an integer.';
    if (prop(c, 'resetTemperature') >= prop(c, 'tripTemperature')) return 'Boiler reset temperature must be below its trip temperature.';
  }
  if (c.kind === "battery" && prop(c, "fullVoltage") < prop(c, "emptyVoltage")) return "Battery full voltage must be at least its empty voltage.";
  if (c.kind === "contactor" && prop(c, "dropoutRatio") >= prop(c, "pickupRatio")) return "Contactor dropout must be below pickup.";
  if (c.kind === "motor" && prop(c, "torqueConstant") !== prop(c, "emfConstant")) return "SI motor torque and EMF constants must match for energy consistency.";
  const derived = derivedError(c);
  if (derived) return derived;
  if (c.kind === "tank" && c.props.vented !== true) return "Sealed pressurized tanks are unsupported; use a vented tank.";
  if (c.kind === "tank" && prop(c, "density") !== 1000) return "Only constant-density water is supported.";
  if (c.kind === "pid" && prop(c, "minOutput") >= prop(c, "maxOutput")) return "PI output minimum must be below maximum.";
  if (c.kind === "tank" && prop(c, "volume") > prop(c, "capacity"))
    return "Water volume exceeds tank capacity.";
  if (c.kind === "source" && prop(c, "voltage") > prop(c, "ratedVoltage"))
    return `${c.name}: voltage setpoint exceeds the supply's maximum output voltage (${prop(c, "ratedVoltage")} V). Raise the maximum output voltage or choose a larger supply.`;
  if (c.kind === "circulator" && prop(c, "minVoltage") >= prop(c, "ratedVoltage"))
    return `${c.name}: the undervoltage lockout must lie below the nominal supply voltage.`;
  if (c.kind === "circulator" && prop(c, "standbyPower") >= prop(c, "ratedPower"))
    return `${c.name}: the electronics standby power must be below the maximum input power P1,max.`;
  if ((c.kind === "pump" || c.kind === "circulator") && typeof c.props.curvePoints === "string" && c.props.curvePoints.trim()) {
    const parsed = parsePumpPoints(c.props.curvePoints);
    if (typeof parsed === "string") return `${c.name}: ${parsed}`;
  }
  if (c.kind === "pipe" && prop(c, "roughness") > 0.05 * prop(c, "diameter"))
    return `${c.name}: relative roughness ε/D above 0.05 is outside the friction-factor correlation.`;
  if (c.kind === "hysteresis" && prop(c, "low") >= prop(c, "high"))
    return "Low threshold must be below high threshold.";
  if (
    ["sensor", "thermostat", "safety", "pressureSensor", "flowSensor", "levelSensor", "positionSensor", "speedSensor"].includes(c.kind) &&
    prop(c, "minRange") >= prop(c, "maxRange")
  )
    return "Invalid sensor range: minimum must be below maximum.";
  return null;
}
export function transitionError(
  previous: Project,
  next: Project,
  time: number,
  lockedChallenge?: ChallengeId,
): string | null {
  if (next.components.length > 100 || next.connections.length > 300) return 'Scene limit: 100 components/bodies and 300 connections.';
  if (next.environment !== undefined && (!next.environment || typeof next.environment.ambient !== "number" || !Number.isFinite(next.environment.ambient) || next.environment.ambient < -100 || next.environment.ambient > 500))
    return "Environment ambient temperature must be between −100 and 500 °C.";
  const spatialViolation = spatialError(next);
  if (spatialViolation) return spatialViolation;
  if (time > 1e-10 && spatialSignature(previous) !== spatialSignature(next)) return 'Reset to Build mode before changing geometry, mass, materials, gravity, joints or spatial placement.';
  if (lockedChallenge ?? next.challenge)
    for (const c of next.components) {
      if (!definitions[c.kind]) return "Unknown component kind.";
      const error = catalogError(c);
      if (error) return error;
    }
  for (const c of next.components) {
    const error = componentError(c);
    if (error) return error;
  }
  const ids = new Set<string>();
  for (const c of next.components) {
    if (ids.has(c.id)) return "Duplicate component ID.";
    ids.add(c.id);
    if (typeof c.props.target === "string" && c.props.target) {
      const target = next.components.find(x => x.id === c.props.target);
      if (!target || !compatibleTarget(c, target)) return `${c.name}: target has no compatible modeled quantity. Clear or reassign the target first.`;
    }
  }
  const checked: Project = { ...next, connections: [] };
  for (const w of next.connections) {
    const error = connectionError(checked, w.from, w.to);
    if (error) return error;
    const c = next.components.find(c => c.id === w.from.component)!;
    if (definitions[c.kind].ports.find(p => p.id === w.from.port)?.domain !== w.domain) return "Invalid connection domain.";
    checked.connections.push(w);
  }
  const violation = challengeError(next, lockedChallenge ?? next.challenge);
  if (violation) return violation;
  if (time > 1e-10 && next.challenge && ["transfer", "pressure", "supply", "descent", "lift", "rotation"].includes(next.challenge)) {
    const autonomous = (p: Project) => JSON.stringify({
      components: p.components.map(c => ({ id: c.id, kind: c.kind, name: c.name, props: c.props, variant: c.variant })),
      connections: p.connections.map(w => ({ id: w.id, domain: w.domain, from: w.from, to: w.to })),
    });
    if (autonomous(previous) !== autonomous(next)) return "Scored hydraulic runs must operate autonomously. Reset before changing actuators, controllers, environment or connections.";
  }
  const mode = lockedChallenge ?? next.challenge;
  if (time > 1e-10 && physicsSignature(previous, mode) !== physicsSignature(next, mode))
    return mode
      ? "Reset the experiment before changing physical configuration, thermal mass, sensor assignment, component models, or inventory."
      : "Reset the experiment before changing stored-energy or initial-state parameters (thermal mass, inertia, inventory, geometry, sensor assignment, catalog model).";
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
  const domain = domainError(c.kind, key, value);
  if (domain) return domain;
  const policy = editPolicy(c, key, p.challenge);
  if (policy === "derived") return `${paramSpec(c.kind, key)?.label ?? key} is calculated from ${(paramSpec(c.kind, key)?.derivedFrom ?? []).map((k) => paramSpec(c.kind, k)?.label ?? k).join(", ")}; edit those instead.`;
  if (policy === "fixed") return `${paramSpec(c.kind, key)?.label ?? key} is a constant of the implemented model.`;
  if (policy === "catalog") return "This specification is defined by the catalog variant.";
  if (time > 1e-10 && policy === "reset") return "Reset the experiment first: this parameter defines stored energy, mass or the initial state.";
  return transitionError(p, withProperty(p, c, key, value), time);
}
/** Apply one property edit with its defined side effects and derived values. */
export function withProperty(p: Project, c: Component, key: string, value: Property): Project {
  const props = applyDerived(c.kind, { ...c.props, ...editEffects(c.kind, key, value), [key]: value });
  return { ...p, components: p.components.map((x) => (x.id === c.id ? { ...x, props } : x)) };
}
