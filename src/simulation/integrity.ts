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
import { challengeDefinition, isChallengeId } from './challenges';
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
  "ambient", "ambientMode",
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
  if (!isChallengeId(challenge)) return "Unknown challenge.";
  const definition = challengeDefinition(challenge), rules = definition.rules;
  if (p.challenge !== challenge)
    return "The running challenge identity is locked until a new experiment is loaded.";
  if (p.environment && p.environment.ambient !== rules.ambient)
    return "Challenge environment is locked at the assignment ambient temperature.";
  // Custom ratings are rejected before costing: a scored assignment never prices them.
  for (const c of p.components) {
    if (["battery", "contactor", "transformer", "radiator", "circulator", "electricBoiler", "panelRadiator"].includes(c.kind)) return `${c.name}: this component is available in Free Sandbox only.`;
    const error = catalogError(c);
    if (error) return error;
  }
  if (projectCost(p) > definition.budget)
    return `Challenge budget exceeded: €${projectCost(p)} / €${definition.budget}.`;
  if (definition.spatial) return definition.validate?.(p) ?? null;
  if (p.world || p.components.some(c => c.spatial)) return 'Spatial worlds are disabled in the earlier schematic assignments; use a mechanical assignment or sandbox.';
  const fixtureError = definition.validate?.(p);
  if (fixtureError) return fixtureError;
  let tanks = 0;
  for (const c of p.components) {
    if (!rules.allowed.includes(c.kind))
      return `${c.name}: this component is unavailable in the assignment.`;
    if (["battery", "contactor", "transformer", "radiator", "circulator", "electricBoiler", "panelRadiator"].includes(c.kind)) return `${c.name}: this component is available in Free Sandbox only.`;
    const error = catalogError(c);
    if (error) return error;
    if ('ambient' in c.props && prop(c, 'ambient') !== rules.ambient)
      return "Challenge ambient conditions are locked.";
    if (c.kind === "tank") {
      tanks++;
      if (
        !definition.vessels?.matches(c) ||
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
  if (definition.vessels && tanks !== definition.vessels.count) return definition.vessels.countError;
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
  if ((c.kind === "battery" || c.kind === "lfpBattery") && prop(c, "fullVoltage") < prop(c, "emptyVoltage")) return "Battery full voltage must be at least its empty voltage.";
  if (c.kind === "contactor" && prop(c, "dropoutRatio") >= prop(c, "pickupRatio")) return "Contactor dropout must be below pickup.";
  if (c.kind === "motor" && prop(c, "torqueConstant") !== prop(c, "emfConstant")) return "SI motor torque and EMF constants must match for energy consistency.";
  if (c.kind === 'hybridInverter' || c.kind === 'gridInverter') {
    if (prop(c,'gridMinVoltage') >= prop(c,'gridMaxVoltage') || prop(c,'gridMinFrequency') >= prop(c,'gridMaxFrequency')) return 'Grid acceptance bounds must increase.';
    if (prop(c,'minVoltage') >= prop(c,'restartVoltage') || prop(c,'restartVoltage') >= prop(c,'maxInputVoltage')) return 'DC voltage limits must satisfy cutoff < restart < maximum.';
    if (prop(c,'floatVoltage') > prop(c,'absorptionVoltage')) return 'Float voltage must not exceed absorption voltage.';
    if (prop(c,'acInputCurrentLimit') > prop(c,'transferCurrent')) return 'AC input limit must not exceed transfer contact rating.';
  }
  if (c.kind === 'solarPanel' && !(prop(c, 'voc') > prop(c, 'vmp') && prop(c, 'isc') > prop(c, 'imp'))) return 'PV ratings require Voc > Vmpp and Isc > Impp.';
  if (c.kind === 'mpptController' && !(prop(c, 'absorptionVoltage') >= prop(c, 'floatVoltage') && prop(c, 'floatVoltage') > prop(c, 'rebulkVoltage'))) return 'Charge profile requires absorption ≥ float > rebulk voltage.';
  if ((c.kind === 'inverter' || c.kind === 'batteryProtection') && prop(c, 'restartVoltage') <= prop(c, c.kind === 'inverter' ? 'minVoltage' : 'disconnectVoltage')) return 'Restart voltage must exceed disconnect voltage.';
  if (c.kind === 'lfpBattery' && (!Number.isInteger(prop(c, 'cells')) || prop(c, 'bmsLowVoltage') >= prop(c, 'bmsHighVoltage'))) return 'BMS requires an integer cell count and upper voltage above lower voltage.';
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
/**
 * A component's display name: 1–80 characters and unique in the project. Challenge parts (source reservoir,
 * consumer demand, loads, foundations) are identified by name, so names are fixed in challenges.
 */
export function componentNameError(p: Project, id: string, name: string): string | null {
  const trimmed = name.trim();
  if (p.challenge) return "Names identify the assignment's parts. Rename components in Free Sandbox.";
  if (!trimmed) return "A component name cannot be empty.";
  if (trimmed.length > 80) return "Component names are limited to 80 characters.";
  if (p.components.some(c => c.id !== id && c.name === trimmed)) return `Another component is already named "${trimmed}".`;
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
  if (lockedChallenge ?? next.challenge) {
    const names = new Map(previous.components.map(c => [c.id, c.name]));
    if (next.components.some(c => names.has(c.id) && names.get(c.id) !== c.name)) return "Names identify the assignment's parts. Rename components in Free Sandbox.";
  }
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
    for (const field of ['batteryTarget', 'gridMeterTarget']) if (c.props[field]) {
      const target = next.components.find(x => x.id === c.props[field]);
      if (!target || (field === 'batteryTarget' ? !['battery','lfpBattery'].includes(target.kind) : target.kind !== 'gridMeter')) return `${c.name}: invalid ${field} measurement target.`;
    }
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
  const props = applyDerived(c.kind, { ...c.props, ...editEffects(c.kind, key, value), ...(key === "ambient" ? { ambientMode: "override" } : {}), [key]: value });
  return { ...p, components: p.components.map((x) => (x.id === c.id ? { ...x, props } : x)) };
}
