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
    ...(["pipe", "valve", "actuatedValve", "thermostaticValve", "checkValve", "pump", "circulator", "pressureReducingValve", "heatExchanger", "radiator", "electricBoiler", "panelRadiator", "heatPump"].includes(c.kind) ? ["differentialPressure", "velocity"] as Measurement[] : []),
    ...(definitions[c.kind].ports.some(p => p.domain === "hydraulic" && p.id === "inlet") || c.kind === "heatExchanger" ? ["flow", "inletPressure"] as Measurement[] : []),
    ...(c.kind === "electricBoiler" ? ["returnTemperature", "elementTemperature", "heatingStages", "heatingPower", "heatLoss", "heatDuty"] as Measurement[] : []),
    ...(c.kind === "heatPump" ? ["targetTemperature", "returnTemperature", "heatOutput", "cop", "compressorSpeed", "evaporatingTemperature", "condensingTemperature", "environmentHeat", "frostMass", "defrosting", "backupPower", "elementTemperature", "heatDuty", "heatLoss", "seasonalCop", "heatEnergy", "compressorStarts"] as Measurement[] : []),
    ...(c.kind === "panelRadiator" ? ["supplyTemperature", "returnTemperature", "excessTemperature", "heatDuty", "heatInput"] as Measurement[] : []),
    ...(c.kind === "storageTank" ? ["flow", "topTemperature", "bottomTemperature", "storedHeat", "heatDuty", "heatLoss"] as Measurement[] : []),
    ...(c.kind === "expansionVessel" ? ["vesselWater", "expansionVolume"] as Measurement[] : []),
    ...(c.kind === "safetyValve" ? ["differentialPressure", "position", "dischargedVolume"] as Measurement[] : []),
    ...(c.kind === "pipe" ? ["reynolds", "frictionFactor"] as Measurement[] : []),
    ...(c.kind === "tank" ? ["level", "overflow", "overflowVolume"] as Measurement[] : []),
    ...(c.kind === "pump" || c.kind === "circulator" ? ["hydraulicPower", "impellerPower", "mechanicalLoss", "hydraulicEfficiency"] as Measurement[] : []),
    ...(c.kind === "actuatedValve" || c.kind === "thermostaticValve" || c.kind === "pressureReducingValve" ? ["position"] as Measurement[] : []),
    ...(c.kind === "heatExchanger" ? ["heatDuty"] as Measurement[] : []),
    ...(c.kind === "pump" || c.kind === "circulator" ? ["npsh"] as Measurement[] : []),
    ...(c.kind === "motor" || c.kind === "inductionMotor" || c.kind === "pump" || c.kind === "circulator" ? ["rpm", "shaftPower", "efficiency", "energyResidual"] as Measurement[] : []),
    ...(c.kind === "motor" || c.kind === "inductionMotor" ? ["torque"] as Measurement[] : []),
    ...(c.kind === "flywheel" ? ["rpm", "torque", "kineticEnergy"] as Measurement[] : []),
    ...(c.kind === "dynamometer" ? ["rpm", "torque", "shaftPower", "energy"] as Measurement[] : []),
    ...(["sourceAC", "source3", "inductor", "capacitor", "inductionMotor"].includes(c.kind) || isElectrical(c) ? ["reactivePower", "powerFactor"] as Measurement[] : []),
    ...(['solarPanel', 'mpptController', 'inverter', 'batteryProtection'].includes(c.kind) ? ['inputPower', 'outputPower', 'conversionLoss', 'efficiency', 'generatedEnergy', 'outputEnergy', 'lostEnergy'] as Measurement[] : []),
    ...(['gridInverter', 'hybridInverter', 'gridMeter'].includes(c.kind) ? ['acInputPower', 'acOutputPower', 'converterLossEnergy', 'transferLossEnergy', 'gridPower', 'gridReactivePower', 'gridImportPower', 'gridExportPower', 'gridImportEnergy', 'gridExportEnergy', 'gridVoltage', 'gridFrequency', 'synchronized', 'backupAvailable', 'dcPower', 'acConversionPower', 'conversionLoss', 'secondaryVoltage', 'secondaryCurrent'] as Measurement[] : []),
    ...(c.kind === 'solarPanel' ? ['mppPower', 'mppVoltage', 'mppCurrent', 'incidentPower', 'incidentEnergy'] as Measurement[] : []),
    ...(c.kind === 'mpptController' ? ['trackingEfficiency', 'secondaryVoltage', 'secondaryCurrent'] as Measurement[] : []),
    ...(c.kind === 'inverter' ? ['secondaryVoltage', 'secondaryCurrent'] as Measurement[] : []),
    ...(isElectrical(c)
      ? (["voltage", "current", "power", "energy"] as Measurement[])
      : []),
    ...((c.kind === "battery" || c.kind === "lfpBattery") ? ["stateOfCharge", "chemicalEnergy", "polarizationVoltage", "batteryHeatEnergy"] as Measurement[] : []),
    ...(c.kind === "capacitor" ? ["chargeVoltage", "fieldEnergy"] as Measurement[] : []),
    ...(c.kind === "inductor" ? ["fieldEnergy"] as Measurement[] : []),
    ...(c.kind === "contactor" ? ["coilVoltage", "coilCurrent"] as Measurement[] : []),
    ...(c.kind === "transformer" ? ["secondaryVoltage", "secondaryCurrent"] as Measurement[] : []),
    ...(c.kind === "radiator" ? ["fanPower", "heatDuty"] as Measurement[] : []),
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
/** `ac` (when known, e.g. in the live inspector) selects DC or AC wording for electrical quantities. */
export function measurementLabel(c: Component, m: Measurement, ac?: boolean): string {
  if (ac === false && (m === "voltage" || m === "current" || m === "power")) return m;
  const three = c.kind === "source3" || c.kind === "inductionMotor";
  if (m === "bodyTemperature") return temperatureLabel(c);
  if (m === "temperature") return ["sensor", "thermostat", "safety"].includes(c.kind) ? "sensed temperature" : temperatureLabel(c);
  if (c.kind === "storageTank") {
    if (m === "fluidTemperature") return "water temperature at the upper sensor";
    if (m === "bottomTemperature") return "water temperature at the lower sensor";
    if (m === "topTemperature") return "top-layer water temperature";
    if (m === "heatDuty") return "coil heat into the store";
    if (m === "heatLoss") return "standby heat loss to the surroundings";
    if (m === "flow") return "throughflow (sum of inflows)";
    if (m === "pressure") return "gauge pressure at the tank base";
  }
  if (c.kind === "expansionVessel") {
    if (m === "pressure") return "system gauge pressure at the vessel";
    if (m === "fluidTemperature") return "vessel water temperature";
  }
  if (c.kind === "safetyValve" && m === "position") return "valve lift";
  if (c.kind === "heatPump") {
    if (m === "fluidTemperature") return "flow (outlet) water temperature";
    if (m === "returnTemperature") return "return (inlet) water temperature";
    if (m === "heatDuty") return "heat delivered to the water flow, ṁ·c_p·(T_out − T_in)";
    if (m === "heatLoss") return "water-module casing heat loss";
    if (m === "elementTemperature") return "condenser / backup heater node temperature";
    if (m === "power") return "electrical input (outdoor unit + backup heater)";
    if (m === "current") return "outdoor-unit line current";
  }
  if (c.kind === "panelRadiator") {
    if (m === "fluidTemperature") return "mean water temperature";
    if (m === "returnTemperature") return "return (outlet) water temperature";
    if (m === "heatDuty") return "heat output to the room air";
  }
  if (m === "fluidTemperature") return c.kind === "pipe" ? "fluid temperature (pipe inventory mean / zero-volume outlet)" : "fluid temperature";
  if (m === "pressure") return c.kind === "tank" ? "bottom gauge pressure" : "outlet / node gauge pressure";
  if (m === "inletPressure") return "inlet gauge pressure";
  if (m === "differentialPressure") return "inlet − outlet pressure (pump rise is negative)";
  if (m === "flow") return "signed branch flow (inlet → outlet)";
  if (m === "voltage") return three ? "phase-to-neutral RMS voltage" : ac ? "RMS voltage" : "voltage (AC: RMS)";
  if (m === "current") return three ? "RMS line current" : ac ? "RMS current" : "current (AC: signed RMS line)";
  if (m === "angularVelocity") return "body angular speed";
  if (m === "rpm") return c.kind === "circulator" ? "rotor speed" : ["motor", "inductionMotor", "pump", "flywheel", "dynamometer"].includes(c.kind) ? "shaft speed" : "body rotational speed";
  if (m === "efficiency" && c.kind === "circulator") return "wire-to-water efficiency (net hydraulic power / P1)";
  if (m === "torque") return c.kind === "dynamometer" ? "absorbed torque" : c.kind === "flywheel" ? "flywheel shaft torque" : "electromagnetic torque";
  if (c.kind === "dynamometer" && m === "shaftPower") return "absorbed power";
  if (c.kind === "dynamometer" && m === "energy") return "absorbed energy";
  if (m === "power" && c.kind === "transformer") return "transformer loss power";
  if (m === "power") return three ? "real power (3~ total)" : ac ? "real power" : "real power (3~: total)";
  if (m === "reactivePower") return three ? "reactive power (3~ total)" : "reactive power";
  return plainLabels[m] ?? m;
}
const plainLabels: Partial<Record<Measurement, string>> = {
  storedHeat: "stored heat since reset", vesselWater: "water in the vessel", expansionVolume: "thermal expansion of the circuit since fill", dischargedVolume: "water discharged",
  acInputPower: 'AC grid-port power (+ into device)', acOutputPower: 'AC output power', converterLossEnergy: 'converter loss energy', transferLossEnergy: 'transfer contact loss energy', batteryHeatEnergy: 'battery heat generated',
  gridPower: 'grid power (+ import)', gridReactivePower: 'grid reactive power', gridImportPower: 'grid import', gridExportPower: 'grid export', gridImportEnergy: 'imported grid energy', gridExportEnergy: 'exported grid energy', gridVoltage: 'grid RMS voltage', gridFrequency: 'grid frequency', synchronized: 'grid synchronized and connected', backupAvailable: 'backup output available', dcPower: 'DC power (+ discharge)', acConversionPower: 'AC conversion (+ injection)',
  incidentEnergy: 'incident solar energy', inputPower: 'input power', outputPower: 'output power', conversionLoss: 'conversion loss / rejected sunlight', mppPower: 'available MPP power', mppVoltage: 'MPP voltage', mppCurrent: 'MPP current', trackingEfficiency: 'MPP tracking efficiency', incidentPower: 'incident sunlight', generatedEnergy: 'generated / input electrical energy', outputEnergy: 'output electrical energy', lostEnergy: 'dissipated / rejected energy',
  supplyTemperature: "supply (inlet) water temperature", excessTemperature: "excess temperature over the air (EN 442 ΔT)", heatInput: "heat delivered by the water flow, ṁ·c_p·(T_in − T_out)",
  heatOutput: "condenser heat output (negative while defrosting)", backupPower: "backup heater electrical power", environmentHeat: "heat drawn from the outdoor air", cop: "instantaneous COP (outdoor unit)", compressorSpeed: "compressor speed",
  evaporatingTemperature: "evaporating temperature", condensingTemperature: "condensing temperature", frostMass: "frost on the outdoor coil", defrosting: "defrost active", targetTemperature: "effective flow target",
  seasonalCop: "seasonal performance factor (net heat / outdoor-unit electricity)", heatEnergy: "net heat delivered by the compressor", compressorStarts: "compressor starts",
  returnTemperature: "return temperature", elementTemperature: "element temperature", heatingStages: "active heating stages", heatingPower: "element electrical power", heatLoss: "shell heat loss",
  stateOfCharge: "state of charge", chemicalEnergy: "stored chemical energy", polarizationVoltage: "polarization overpotential", chargeVoltage: "dielectric (charge) voltage", fieldEnergy: "stored field energy", coilVoltage: "DC coil voltage", coilCurrent: "DC coil current", secondaryVoltage: "secondary RMS voltage", secondaryCurrent: "secondary RMS current", fanPower: "fan electrical power",
  positionX: "position x", positionY: "position y", displacement: "displacement", linearSpeed: "speed", velocityX: "velocity x", velocityY: "velocity y",
  acceleration: "acceleration", appliedForce: "applied force", appliedTorque: "applied torque", kineticEnergy: "kinetic energy", potentialEnergy: "potential energy",
  mechanicalResidual: "mechanical energy residual", contactImpulse: "contact impulse", jointForce: "joint force",
  level: "level", heatDuty: "heat duty", npsh: "NPSH available", powerFactor: "power factor", impellerPower: "impeller power", mechanicalLoss: "mechanical loss",
  hydraulicEfficiency: "hydraulic efficiency", overflow: "overflow rate", overflowVolume: "overflow volume", shaftPower: "shaft power", hydraulicPower: "hydraulic power",
  efficiency: "efficiency", transferredVolume: "transferred volume", massResidual: "mass balance residual", energyResidual: "energy balance residual",
  velocity: "flow velocity", reynolds: "Reynolds number", frictionFactor: "friction factor", position: "valve position", currentNC: "NC contact current",
  energy: "energy", state: "state", signal: "signal", nodeVoltage: "node voltage",
};
/**
 * Rows worth showing in a component's live inspector. Charts and sensors keep the full capability
 * list; the inspector hides AC-only quantities on DC networks, global balance residuals (shown in the
 * energy panel) and fluid-transport quantities of components with no hydraulic connection.
 */
export function inspectorMeasurements(c: Component, ac: boolean, hydraulicConnected: boolean): Measurement[] {
  return measurements(c).filter((m) => m !== "nodeVoltage"
    && !(!ac && (m === "reactivePower" || m === "powerFactor"))
    && m !== "massResidual" && m !== "energyResidual" && m !== "mechanicalResidual"
    // Thermal masses list the same state as bodyTemperature and temperature; show it once.
    && !(m === "temperature" && measurements(c).includes("bodyTemperature"))
    && !(!hydraulicConnected && (m === "transferredVolume" || m === "flow" || m === "inletPressure" || m === "differentialPressure" || m === "overflow" || m === "overflowVolume")));
}

/**
 * Operating quantities exist only while the experiment runs (currents, powers, flows, speeds). Before
 * the first Run the interface shows them as unavailable so the setup does not look already running;
 * state quantities (temperatures, levels, positions, residuals) stay visible.
 */
export const operatingMeasurements = new Set<Measurement>([
  'inputPower', 'outputPower', 'conversionLoss', 'trackingEfficiency',
  "heatOutput", "backupPower", "environmentHeat", "cop", "compressorSpeed", "evaporatingTemperature", "condensingTemperature",
  "heatingPower", "heatingStages", "heatLoss", "coilVoltage", "coilCurrent", "secondaryVoltage", "secondaryCurrent", "fanPower", "voltage", "current", "currentNC", "power", "reactivePower", "powerFactor", "energy", "nodeVoltage",
  "flow", "velocity", "reynolds", "frictionFactor", "differentialPressure", "inletPressure", "heatDuty", "heatInput", "npsh",
  "impellerPower", "mechanicalLoss", "hydraulicEfficiency", "hydraulicPower", "shaftPower", "efficiency", "rpm",
  "overflow", "transferredVolume", "signal",
]);
