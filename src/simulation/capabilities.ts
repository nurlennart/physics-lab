import { definitions, isElectrical, isThermalMass, type Component, type Measurement } from "./model";

const capabilityCache = new Map<string, Measurement[]>();
export function measurements(c: Component): Measurement[] {
  const key = `${c.kind}:${Boolean(c.spatial)}`;
  const cached = capabilityCache.get(key);
  if (cached) return cached;
  const result = componentMeasurements(c);
  capabilityCache.set(key, result);
  return result;
}
function componentMeasurements(c: Component): Measurement[] {
  return [...new Set<Measurement>([
    ...(c.spatial ? ['rpm', 'positionX', 'positionY', 'displacement', 'linearSpeed', 'velocityX', 'velocityY', 'angularVelocity', 'acceleration', 'appliedForce', 'appliedTorque', 'kineticEnergy', 'potentialEnergy', 'mechanicalResidual', 'contactImpulse', 'jointForce'] as Measurement[] : []),
    ...(c.kind === 'forceActuator' ? ['appliedForce', 'appliedTorque', 'energy'] as Measurement[] : []),
    ...(definitions[c.kind].ports.some(p => p.domain === "hydraulic") ? ["pressure", "fluidTemperature", "transferredVolume", "massResidual", "energyResidual"] as Measurement[] : []),
    ...(["pipe", "valve", "actuatedValve", "checkValve", "pump", "pressureReducingValve", "heatExchanger"].includes(c.kind) ? ["differentialPressure", "velocity"] as Measurement[] : []),
    ...(definitions[c.kind].ports.some(p => p.domain === "hydraulic" && p.id === "inlet") || c.kind === "heatExchanger" ? ["flow", "inletPressure"] as Measurement[] : []),
    ...(c.kind === "pipe" ? ["reynolds", "frictionFactor"] as Measurement[] : []),
    ...(c.kind === "tank" ? ["level", "overflow", "overflowVolume"] as Measurement[] : []),
    ...(c.kind === "pump" ? ["hydraulicPower", "impellerPower", "mechanicalLoss", "hydraulicEfficiency"] as Measurement[] : []),
    ...(c.kind === "actuatedValve" || c.kind === "pressureReducingValve" ? ["position"] as Measurement[] : []),
    ...(c.kind === "heatExchanger" ? ["heatDuty"] as Measurement[] : []),
    ...(c.kind === "pump" ? ["npsh"] as Measurement[] : []),
    ...(c.kind === "motor" || c.kind === "inductionMotor" || c.kind === "pump" ? ["rpm", "shaftPower", "efficiency", "energyResidual"] as Measurement[] : []),
    ...(["sourceAC", "source3", "inductor", "capacitor", "inductionMotor"].includes(c.kind) || isElectrical(c) ? ["reactivePower", "powerFactor"] as Measurement[] : []),
    ...(isElectrical(c)
      ? (["voltage", "current", "power", "energy"] as Measurement[])
      : []),
    ...(c.kind === "relay" ? ["currentNC" as const] : []),
    ...(isThermalMass(c) ? ["bodyTemperature"] as Measurement[] : []),
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
  ])];
}

/** Shared target contract for menus, imports and runtime. No synthetic states. */
export function sensorMeasurement(sensor: Component, target: Component): Measurement | null {
  if (["sensor", "thermostat", "safety"].includes(sensor.kind)) {
    const q = String(sensor.props.quantity ?? "auto");
    if (q === "auto") return isThermalMass(target) ? "bodyTemperature" : measurements(target).includes("fluidTemperature") ? "fluidTemperature" : null;
    return q === "temperature" ? "bodyTemperature" : q === "fluidTemperature" ? q : null;
  }
  if (sensor.kind === "pressureSensor") return String(sensor.props.quantity ?? "pressure") as Measurement;
  return ({ flowSensor: "flow", levelSensor: "level", speedSensor: "rpm", positionSensor: sensor.props.axis === "x" ? "positionX" : "positionY" } as Partial<Record<Component["kind"], Measurement>>)[sensor.kind] ?? null;
}
export function compatibleTarget(sensor: Component, target: Component): boolean {
  if (sensor.kind === "forceActuator") return target.spatial?.type === "dynamic";
  const metric = sensorMeasurement(sensor, target);
  // Temperature sensors cannot recursively target other sensors' output signals.
  if (metric === "bodyTemperature" && !isThermalMass(target)) return false;
  if (sensor.kind === "speedSensor" && target.spatial) return true;
  return metric !== null && measurements(target).includes(metric);
}
export function temperatureLabel(c: Component): string {
  return c.kind === "tank" ? "mixed water + vessel temperature" : c.kind === "motor" || c.kind === "inductionMotor" || c.kind === "inductor" ? "winding temperature" : isThermalMass(c) ? "body temperature" : "fluid temperature";
}

/** Older files may retain these traces; show an explicit unavailable reading. */
export function legacyUnavailableMeasurement(c: Component, m: Measurement): boolean {
  return m === "flow" && (c.kind === "tank" || c.kind === "fluidJunction") || m === "hydraulicPower" && (c.kind === "motor" || c.kind === "inductionMotor");
}
export function measurementLabel(c: Component, m: Measurement): string {
  if (m === "bodyTemperature") return temperatureLabel(c);
  if (m === "temperature") return ["sensor", "thermostat", "safety"].includes(c.kind) ? "sensed temperature" : temperatureLabel(c);
  if (m === "fluidTemperature") return c.kind === "pipe" ? "fluid temperature (pipe inventory mean / zero-volume outlet)" : "fluid temperature";
  if (m === "pressure") return c.kind === "tank" ? "bottom gauge pressure" : "outlet / node gauge pressure";
  if (m === "inletPressure") return "inlet gauge pressure";
  if (m === "differentialPressure") return "inlet − outlet pressure (pump rise is negative)";
  if (m === "flow") return "signed branch flow (inlet → outlet)";
  if (m === "voltage") return c.kind === "source3" || c.kind === "inductionMotor" ? "phase-to-neutral RMS voltage" : "voltage (AC: RMS)";
  if (m === "current") return "current (AC: signed RMS line)";
  if (m === "angularVelocity") return "body angular speed";
  if (m === "rpm") return c.kind === "motor" || c.kind === "inductionMotor" || c.kind === "pump" ? "shaft speed" : "body rotational speed";
  if (m === "power") return "real power (3~: total)";
  if (m === "reactivePower") return "reactive power (3~: total)";
  return m;
}
