export type Kind =
  | "gridInverter" | "hybridInverter" | "gridMeter"
  | "solarPanel" | "lfpBattery" | "mpptController" | "inverter" | "batteryProtection"
  | "rigidBody" | "positionSensor" | "speedSensor" | "forceActuator" | "flywheel" | "dynamometer"
  | "motor" | "pump" | "pipe" | "valve" | "checkValve" | "actuatedValve"
  | "fluidJunction" | "pressureSensor" | "flowSensor" | "levelSensor" | "pid"
  | "battery" | "contactor" | "transformer" | "radiator" | "circulator"
  | "electricBoiler" | "panelRadiator"
  | "source"
  | "source3"
  | "sourceAC"
  | "inductor"
  | "capacitor"
  | "inductionMotor"
  | "starDeltaStarter"
  | "softStarter"
  | "vfd"
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
  | "cable"
  | "breaker"
  | "motorProtector"
  | "thermalMass"
  | "heatExchanger"
  | "scale" | "limiter" | "filter" | "rateLimiter" | "selector"
  | "pressureReducingValve"
  | "junction";
export type Domain = "electrical" | "thermal" | "control" | "hydraulic" | "mechanical";
export type Property = number | boolean | string;
export type { ChallengeId } from './challenges/ids';
import type { ChallengeId } from './challenges/ids';
import type { SpatialBody, SpatialWorld, MechanicalJoint } from './spatial-model';
import { makeSpatial } from './spatial-model';
import { applyDerived } from "./parameters";
import { kermiHydraulics, kermiModels } from "./panel-radiator-data";
export interface Component {
  id: string;
  kind: Kind;
  name: string;
  x: number;
  y: number;
  rotation: number;
  variant?: string;
  /** Name of the built-in or user preset this configuration was created from (display only). */
  preset?: string;
  props: Record<string, Property>;
  spatial?: SpatialBody;
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
  | "acInputPower" | "acOutputPower" | "converterLossEnergy" | "transferLossEnergy" | "batteryHeatEnergy"
  | "gridPower" | "gridReactivePower" | "gridImportPower" | "gridExportPower" | "gridImportEnergy" | "gridExportEnergy" | "gridVoltage" | "gridFrequency" | "synchronized" | "backupAvailable" | "dcPower" | "acConversionPower"
  | "incidentEnergy" | "inputPower" | "outputPower" | "conversionLoss" | "mppPower" | "mppVoltage" | "mppCurrent" | "trackingEfficiency" | "incidentPower" | "generatedEnergy" | "outputEnergy" | "lostEnergy"
  | "positionX" | "positionY" | "displacement" | "linearSpeed" | "velocityX" | "velocityY" | "angularVelocity" | "acceleration" | "appliedForce" | "appliedTorque" | "kineticEnergy" | "potentialEnergy" | "mechanicalResidual" | "contactImpulse" | "jointForce"
  | "pressure" | "inletPressure" | "differentialPressure" | "flow" | "level" | "fluidTemperature"
  | "returnTemperature" | "elementTemperature" | "heatingStages" | "heatingPower" | "heatLoss"
  | "supplyTemperature" | "excessTemperature" | "heatInput"
  | "heatDuty" | "npsh" | "reactivePower" | "powerFactor" | "impellerPower" | "mechanicalLoss" | "hydraulicEfficiency" | "overflow" | "overflowVolume"
  | "rpm" | "shaftPower" | "hydraulicPower" | "efficiency" | "transferredVolume" | "torque"
  | "massResidual" | "energyResidual" | "velocity" | "reynolds" | "frictionFactor" | "position"
  | "stateOfCharge" | "chemicalEnergy" | "polarizationVoltage" | "chargeVoltage" | "fieldEnergy" | "coilVoltage" | "coilCurrent" | "secondaryVoltage" | "secondaryCurrent" | "fanPower"
  | "voltage"
  | "current"
  | "currentNC"
  | "power"
  | "bodyTemperature" | "temperature"
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
  joints?: MechanicalJoint[];
}
export interface Project {
  version: 1 | 2 | 3 | 4;
  id: string;
  name: string;
  components: Component[];
  connections: Connection[];
  challenge?: ChallengeId;
  probes?: Probe[];
  assemblies?: Assembly[];
  world?: SpatialWorld;
  /** Sandbox environment. Absent = 20 °C standard laboratory ambient. */
  environment?: { ambient: number };
}
export const DEFAULT_AMBIENT = 20;
/**
 * Catalog values revised on 2026-10-10: pump mechanical drag k (k·ω³) was 3e-6 (laboratory) and
 * 1.2e-5 (industrial), i.e. 81 W and 324 W at 300 rad/s — more than the rated hydraulic output.
 * Saved challenge files carrying the old catalog values are mapped to the current catalog.
 */
export const projectAmbient = (p: Pick<Project, "environment">) => p.environment?.ambient ?? DEFAULT_AMBIENT;
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
  tempCoefficient: 0,
  tolerance: 0,
};
const fluid: Port[] = [
  { id: "inlet", domain: "hydraulic", label: "Fluid inlet / reference end" },
  { id: "outlet", domain: "hydraulic", label: "Fluid outlet" },
];
const shaft: Port = { id: "shaft", domain: "mechanical", label: "Rotating shaft" };
const sensing = { target: "", minRange: -1000000, maxRange: 1000000, resolution: 0.001, lag: 0, noise: 0, sampleInterval: 0 };
const valveDefaults = { opening: 100, diameter: 0.025, lossCoefficient: 5, laminarK: 500, maxPressure: 1000000, elevation: 0 };
const hybridDefaults = { voltage: 230, frequency: 50, ratedPower: 2400, ratedApparentPower: 3000, surgePower: 5500, surgeTime: 2, peakEfficiency: 95, chargeEfficiency: 94, idlePower: 11, standbyPower: 2, minVoltage: 38, restartVoltage: 44, maxInputVoltage: 66, maxDCDischargeCurrent: 75, maxChargeCurrent: 35, maxACCurrent: 24, transferCurrent: 32, acInputCurrentLimit: 32, gridMinVoltage: 187, gridMaxVoltage: 265, gridMinFrequency: 45, gridMaxFrequency: 65, transferTime: 0.016, reconnectDelay: 60, syncTolerance: 5, phaseSlew: 90, absorptionVoltage: 56.8, floatVoltage: 54, rebulkVoltage: 52.8, absorptionTime: 1800, reserveSOC: 20, coordinateSolar: true, gridCharge: false, gridChargePower: 1000, gridChargeSOC: 80, allowExport: false, exportLimit: 2400, gridSetpoint: 50, reactiveSetpoint: 0, activeSetpoint: 0, energyMode: 'selfConsumption', batteryTarget: '', gridMeterTarget: '', standby: false, enabled: true, heatCapacity: 8000, loss: 15, conductance: 30, maxTemperature: 65 };
const gridPorts: Port[] = [{ id: 'ga', domain: 'electrical', label: 'Grid line' }, { id: 'gb', domain: 'electrical', label: 'Grid neutral' }];
export const definitions: Record<Kind, Definition> = {
  hybridInverter: { label: 'Hybrid Inverter / Charger', category: 'Electrical', prefix: 'HIC', cost: 900, description: 'Bidirectional battery conversion, measured grid self-consumption and explicitly isolated backup supply. Configure a compatible external battery and point-of-common-coupling meter.', spec: '48 V · 2400 W / 3000 VA · 35 A charger · 32 A transfer', ports: [...electric, ...gridPorts, { id: 'oa', domain: 'electrical', label: 'Backup line' }, { id: 'ob', domain: 'electrical', label: 'Backup neutral' }, heat], defaults: hybridDefaults },
  gridInverter: { label: 'Grid-Connected Inverter', category: 'Electrical', prefix: 'GCI', cost: 400, description: 'Grid-following controlled AC current injection from a real DC input, with PV voltage tracking and grid-loss disconnection. Cannot establish an AC voltage reference.', spec: 'PV DC → grid AC · 2400 W / 3000 VA', ports: [...electric, ...gridPorts, heat], defaults: { ...hybridDefaults, minVoltage: 16, restartVoltage: 20, maxInputVoltage: 145, dcTrackingVoltage: 44.6, dcTrackingStep: 0.25, dcTrackingInterval: 0.2, maxDCDischargeCurrent: 40, allowExport: true } },
  gridMeter: { label: 'Grid Energy Meter', category: 'Electrical', prefix: 'GEM', cost: 90, description: 'Directional three-terminal RMS energy meter. Wire line input a, downstream line b and neutral reference; positive flow is import. The 1 mΩ shunt loss enters the thermal ledger.', spec: 'PCC · signed P/Q · separate import/export energy', ports: [...electric, { id: 'reference', domain: 'electrical', label: 'Neutral reference' }, heat], defaults: { resistance: 0.001, ratedCurrent: 100, enabled: true, heatCapacity: 200, loss: 1, maxTemperature: 85 } },
  solarPanel: { label: "Solar Panel (PV)", category: "Electrical", prefix: "PV", cost: 120, description: "Nonlinear single-diode photovoltaic module. Irradiance and cell temperature set its I–V curve; the connected network determines the operating point.", spec: "450 W · 44.6 V MPP · 52.9 V open circuit", ports: electric, defaults: { voc: 52.9, isc: 10.74, vmp: 44.6, imp: 10.09, irradiance: 1000, cellTemperature: 25, voltageCoefficient: -0.0024, currentCoefficient: 0.0004, area: 1.998108, shading: 0, enabled: true } },
  lfpBattery: { label: "LiFePO4 Battery", category: "Electrical", prefix: "LFP", cost: 700, description: "Finite rechargeable LFP storage with plateau OCV, terminal resistance, current limits and a simplified integrated BMS. Reference pack needs an external BMS; see provenance.", spec: "12.8 V · 100 Ah · 4 cells", ports: [...electric, heat], defaults: { capacityAh: 100, initialSOC: 50, cells: 4, emptyVoltage: 10, fullVoltage: 13.6, internalResistance: 0.0008, chemistry: "lfp", coulombicEfficiency: 99.5, selfDischarge: 0, polarizationResistance: 0, polarizationTimeConstant: 30, resistanceActivation: 0, maxCurrent: 200, chargeCurrentLimit: 50, dischargeCurrentLimit: 100, maxPower: 2560, enabled: true, heatCapacity: 14000, loss: 3, conductance: 20, maxTemperature: 50, minChargeTemperature: 5, minDischargeTemperature: -20, bmsLowVoltage: 11.2, bmsHighVoltage: 15 }, variants: [{ id: "sixteenCell", label: "51.2 V / 100 Ah", cost: 2800, spec: "16 cells · 5.12 kWh nominal", overrides: { cells: 16, emptyVoltage: 40, fullVoltage: 54.4, internalResistance: 0.0032, bmsLowVoltage: 44.8, bmsHighVoltage: 60, heatCapacity: 56000, maxPower: 10240 } }, { id: "eightCell", label: "25.6 V / 100 Ah", cost: 1400, spec: "8 cells · 2.56 kWh nominal", overrides: { cells: 8, emptyVoltage: 20, fullVoltage: 27.2, internalResistance: 0.0016, bmsLowVoltage: 22.4, bmsHighVoltage: 30, heatCapacity: 28000, maxPower: 5120 } }] },
  mpptController: { label: "MPPT Charge Controller", category: "Electrical", prefix: "MPPT", cost: 100, description: "Independent averaged buck converter with perturb-and-observe tracking, current limiting and bulk/absorption/float regulation.", spec: "100 V PV · 20 A output · 12/24 V", ports: [...electric, { id: "oa", domain: "electrical", label: "Battery +" }, { id: "ob", domain: "electrical", label: "Battery −" }, heat], defaults: { maxInputVoltage: 100, maxInputCurrent: 20, maxCurrent: 20, conversionEfficiency: 98, absorptionVoltage: 14.2, floatVoltage: 13.5, absorptionTime: 1800, rebulkVoltage: 13.2, minVoltage: 8, startupHeadroom: 5, runningHeadroom: 1, trackingStep: 0.25, trackingInterval: 0.2, initialTrackingVoltage: 40, enabled: true, heatCapacity: 600, loss: 2, conductance: 20, maxTemperature: 60 }, variants: [{ id: "48V", label: "48 V / 150 V / 35 A", cost: 180, spec: "150 V class · 35 A · 48 V battery", overrides: { maxInputVoltage: 145, maxInputCurrent: 40, maxCurrent: 35, initialTrackingVoltage: 89.2, absorptionVoltage: 56.8, floatVoltage: 54, rebulkVoltage: 52.8, minVoltage: 32 } }, { id: "24V", label: "24 V battery profile", cost: 100, spec: "28.4 V absorption · 27 V float", overrides: { absorptionVoltage: 28.4, floatVoltage: 27, rebulkVoltage: 26.4, minVoltage: 16 } }] },
  inverter: { label: "DC/AC Inverter", category: "Electrical", prefix: "INV", cost: 160, description: "Averaged DC to sinusoidal AC conversion through the electrical network, load-dependent losses and independent undervoltage/overload protection.", spec: "24 V → 230 V / 50 Hz · 400 W · 500 VA", ports: [...electric, { id: "oa", domain: "electrical", label: "AC line" }, { id: "ob", domain: "electrical", label: "AC neutral" }, heat], defaults: { voltage: 230, frequency: 50, ratedPower: 400, ratedApparentPower: 500, surgePower: 900, surgeTime: 2, peakEfficiency: 90, idlePower: 6.5, standbyPower: 1.5, standby: false, minVoltage: 18.6, restartVoltage: 21.8, maxInputVoltage: 34, enabled: true, heatCapacity: 1800, loss: 3, conductance: 20, maxTemperature: 65 } },
  batteryProtection: { label: "Battery Protection Switch", category: "Electrical", prefix: "BPS", cost: 50, description: "Independent downstream DC-load isolation with voltage hysteresis, current and temperature trips. Connect reference to bus negative. Remote enable is optional.", spec: "65 A · low voltage disconnect", ports: [...electric, { id: "reference", domain: "electrical", label: "Bus negative sense" }, input("enable", "boolean", true), heat], defaults: { disconnectVoltage: 11.8, restartVoltage: 12.8, ratedCurrent: 65, resistance: 0.002, enabled: true, heatCapacity: 200, loss: 1, conductance: 10, maxTemperature: 65 } },

  electricBoiler: {
    label: "Electric heating boiler", category: "Thermal", prefix: "EB", cost: 650,
    description: "Bosch Tronic Heat 3000 9 reference: three 3 kW resistive stages, internal water and metal inertia, supply thermostat and independent manual-reset limiter. External pump required.",
    spec: "9 kW · 3 × 3 kW · 3.7 L · 230/400 V · external pump",
    ports: [
      ...["L1", "L2", "L3", "N", "PE"].map(id => ({ id, domain: "electrical" as const, label: id === "PE" ? "Protective earth (chassis; no normal current)" : `${id} mains terminal` })),
      ...fluid, input("enable", "boolean", true), input("setpoint", "number", true), input("reset", "boolean", true),
    ],
    defaults: { ratedPower: 9000, ratedVoltage: 230, ratedCurrent: 13.1, waterVolume: 3.7, vesselHeatCapacity: 3500, heatCapacity: 1500, conductance: 1200, loss: 1.8, standbyPower: 3, initialTemperature: 20, ambient: 20, setpoint: 60, hysteresis: 7, stageDelay: 2, antiCycleTime: 10, maxStages: 3, enabled: true, tripTemperature: 95, resetTemperature: 70, fillPressure: 150000, flowInterlock: false, minFlow: 130 / 3600000, flowDelay: 5, minVoltage: 180, restartDelay: 2, diameter: 0.02, lossCoefficient: 8, laminarK: 1500, elevation: 0, maxPressure: 300000, maxTemperature: 85 },
  },
  panelRadiator: {
    label: "Panel radiator (hydronic)", category: "Thermal", prefix: "PR", cost: 160,
    description: "Kermi therm-x2 Profil-K reference: EN 442 output Φ = K_m·ΔT_ln^n from the registered rating and exponent, finite water and steel inventory (16 cells, serial front-then-rear flow), pressure drop fitted to the Kermi chart; heat goes to its room-air boundary",
    spec: "Type 22 · 600 × 1000 mm · 1,666 W at 75/65/20 °C · 6.08 L",
    ports: fluid,
    defaults: { ratedOutput: 1666, exponent: 1.293, waterVolume: 6.08, metalMass: 29.63, metalSpecificHeat: 450, radiantShare: 30, ambient: 20, initialTemperature: 20, diameter: 0.016, lossCoefficient: 18.6, laminarK: 1602, maxPressure: 1000000, maxTemperature: 110, elevation: 0 },
    variants: (["type11", "type33", "type22tall", "type22long"] as const).map(id => {
      const m = kermiModels[id], h = kermiHydraulics[m.hydraulic];
      return { id, label: `Kermi Profil-K type ${m.type} · ${m.height} × ${m.length} mm`, cost: Math.round(160 * (m.output / 1666) ** 0.6), spec: `Type ${m.type} · ${m.height} × ${m.length} mm · ${m.output.toLocaleString("en-US")} W at 75/65/20 °C · ${m.water.toFixed(2)} L`,
        overrides: { ratedOutput: m.output, exponent: m.exponent, waterVolume: m.water, metalMass: m.mass, radiantShare: m.radiant, lossCoefficient: h.lossCoefficient, laminarK: h.laminarK } };
    }),
  },
  rigidBody: { label: 'Rigid body', category: 'Mechanical', description: 'Spatial rectangle, circle, convex polygon, beam, wheel or structural boundary; real mass, inertia and collision geometry', spec: 'SI geometry · static / dynamic / kinematic', cost: 25, prefix: 'RB', ports: [shaft], defaults: { forceX: 0, forceY: 0, appliedTorque: 0, brakeDamping: 0 } },
  positionSensor: { label: 'Position sensor', category: 'Sensors', description: 'Actual world position of the target body; selected x or y axis in metres', spec: 'm output', cost: 12, prefix: 'XS', ports: [output('number', 'm')], defaults: { ...sensing, axis: 'y', resolution: 0.00001 } },
  speedSensor: { label: 'Shaft speed sensor', category: 'Sensors', description: 'Calculated target body or motor rotational speed; same shaft state in both views', spec: 'RPM output', cost: 12, prefix: 'WS', ports: [output('number', 'RPM')], defaults: { ...sensing, resolution: 0.001 } },
  flywheel: { label: "Flywheel / driven inertia", category: "Mechanical", description: "Rotating inertia on a motor shaft, directly coupled or through a gear stage (ratio, efficiency): stores ½·J·ω², the motor sees J/i²; bearing drag and gear mesh losses go to ambient", spec: "1 kg·m² · Ø400 mm steel disc · direct", cost: 60, prefix: "FW", ports: [shaft], defaults: { inertia: 1, gearRatio: 1, gearEfficiency: 100, friction: 0.002, maxSpeed: 314 } },
  dynamometer: { label: "Dynamometer (test-bench brake)", category: "Mechanical", description: "Shaft brake that absorbs and measures torque: electric (constant torque, holds a stalled shaft), eddy-current (torque rises with speed to its rated speed, constant power above) or water brake (∝ speed²); numeric torque command input; absorbed power leaves through its cooling", spec: "140 N·m · 35 kW · 2,390 RPM eddy-current", cost: 900, prefix: "DY", ports: [shaft, input("torque", "number", true)], defaults: { absorber: "eddyCurrent", torqueSetpoint: 50, ratedTorque: 140, ratedSpeed: 250.3, ratedPower: 35000, maxSpeed: 785.4, inertia: 0.05 } },
  forceActuator: { label: 'Force / brake actuator', category: 'Mechanical', description: 'Explicit external force or torque source with optional control input and viscous brake; work and heat are accounted', spec: 'N or N·m · declared external supply', cost: 18, prefix: 'FA', ports: [input('in', 'number', true)], defaults: { target: '', axis: 'y', value: 0, damping: 0, maxForce: 10000, enabled: true } },
  motor: { label: "DC motor", category: "Electrical", description: "Brushed DC motor: 24 V laboratory, 48 V traction and 180 V industrial models; quasi-steady armature, back EMF, shaft inertia and copper heat; PWM speed drive (PI, 150 % current limit) on optional speed command", spec: "24 V · 20 A · 0.08 N·m/A", cost: 65, prefix: "M", ports: [...electric, shaft, heat, input("enable", "boolean", true), input("speed", "number", true)], defaults: { conductance: 20, resistance: 1.2, torqueConstant: 0.08, emfConstant: 0.08, inertia: 0.006, friction: 0.0005, loadTorque: 0, ratedVoltage: 24, ratedCurrent: 20, ratedTorque: 1.6, ratedPower: 500, maxSpeed: 400, heatCapacity: 500, loss: 2, maxTemperature: 120, enabled: true, speedControl: false, speedCommand: 2500 }, variants: [
    { id: "traction48", label: "Traction DC 48 V", cost: 180, spec: "48 V · 40 A limit · 6 N·m torque limit", overrides: { torqueConstant: 0.15, emfConstant: 0.15, inertia: 0.025, friction: 0.001, ratedVoltage: 48, ratedCurrent: 40, ratedTorque: 6, ratedPower: 2000, heatCapacity: 1800, loss: 5 } },
    { id: "industrial180", label: "Industrial DC 180 V", cost: 480, spec: "180 V · 60 A limit · 33 N·m torque limit", overrides: { resistance: 3, torqueConstant: 0.55, emfConstant: 0.55, inertia: 0.12, friction: 0.002, ratedVoltage: 180, ratedCurrent: 60, ratedTorque: 33, ratedPower: 11000, heatCapacity: 6000, loss: 15, maxTemperature: 150 } },
    { id: "industrial440", label: "Industrial DC 440 V · 75 kW", cost: 6800, spec: "440 V · 190 A · 437 N·m · 1,750 RPM", overrides: { resistance: 0.1, torqueConstant: 2.3, emfConstant: 2.3, inertia: 1.2, friction: 0.02, ratedVoltage: 440, ratedCurrent: 190, ratedTorque: 437, ratedPower: 84000, maxSpeed: 230, heatCapacity: 60000, loss: 60, maxTemperature: 155, speedCommand: 1500 } },
  ] },
  pump: { label: "Centrifugal pump", category: "Hydraulic", description: "Shaft-driven quadratic head curve with affinity scaling and built-in reverse-flow check; zero-volume wetted inventory", spec: "8 m shutoff · 60 L/min · 2,865 RPM", cost: 70, prefix: "P", ports: [...fluid, shaft], defaults: { ratedSpeed: 300, ratedFlow: 0.001, shutoffHead: 8, efficiency: 0.7, mechanicalLoss: 2, maxPressure: 1000000, elevation: 0, curvePoints: "", npshRequired: 2 }, variants: [
    { id: "industrial", label: "Industrial transfer pump", cost: 360, spec: "35 m shutoff · 360 L/min reference flow · 2,865 RPM", overrides: { ratedFlow: 0.006, shutoffHead: 35, efficiency: 0.78, mechanicalLoss: 1.9 } },
    { id: "highCapacity", label: "High-capacity process pump", cost: 2400, spec: "30 m shutoff · 3,000 L/min reference flow · 1,475 RPM", overrides: { ratedSpeed: 154.5, ratedFlow: 0.05, shutoffHead: 30, efficiency: 0.82, mechanicalLoss: 1.5, maxPressure: 1600000 } },
  ] },
  circulator: { label: "Circulator pump (electric)", category: "Hydraulic", description: "Standalone wet-rotor circulator with integrated EC motor and controller: proportional pressure, constant pressure or constant speed; input power limit, soft start and undervoltage lockout; draws its input power from the network, motor losses heat the pumped water", spec: "230 V · 3–34 W · 6 m · 2.8 m³/h", cost: 190, prefix: "CP", ports: [...electric, ...fluid, input("enable", "boolean", true), input("speed", "number", true)], defaults: { mode: "proportionalPressure", headSetpoint: 4, speedSetting: 100, minSpeed: 25, enabled: true, ratedSpeed: 471.24, ratedFlow: 0.00055556, shutoffHead: 6, efficiency: 0.55, mechanicalLoss: 2, curvePoints: "", npshRequired: 0.5, ratedVoltage: 230, minVoltage: 180, ratedPower: 34, standbyPower: 2.2, motorEfficiency: 80, inertia: 0.00002, rampTime: 2, maxPressure: 1000000, elevation: 0 }, variants: [
    { id: "dc12", label: "12 V DC solar circulator", cost: 60, spec: "12 V DC · 19 W · 5 m · 0.8 m³/h · constant speed", overrides: { mode: "constantSpeed", minSpeed: 30, ratedSpeed: 418.88, ratedFlow: 0.00015713, shutoffHead: 5, efficiency: 0.3, ratedVoltage: 12, minVoltage: 9, ratedPower: 19, standbyPower: 0.5, motorEfficiency: 70, inertia: 0.00001, rampTime: 1, maxPressure: 300000 } },
  ] },
  pipe: { label: "Pipe", category: "Hydraulic", description: "Darcy–Weisbach pipe with laminar/transition/turbulent friction, explicit physical length and water inventory in mixing cells (thermal transport delay)", spec: "5 m · Ø25 mm", cost: 12, prefix: "PL", ports: fluid, defaults: { length: 5, diameter: 0.025, roughness: 0.000045, maxPressure: 1000000, material: "steel", conductivity: 45, insulation: 0, thermalUA: 0, ambient: 20, elevation: 0, inventory: true, segments: 4, initialTemperature: 20 } },
  heatExchanger: { label: "Heat exchanger", category: "Hydraulic", description: "Two-stream ε-NTU heat exchanger (counter- or parallel-flow); each stream is a hydraulic branch with quadratic pressure loss; no wetted inventory", spec: "2 kW/K · counterflow", cost: 160, prefix: "HX", ports: [
    { id: "hotIn", domain: "hydraulic", label: "Stream A (hot) inlet" }, { id: "hotOut", domain: "hydraulic", label: "Stream A (hot) outlet" },
    { id: "coldIn", domain: "hydraulic", label: "Stream B (cold) inlet" }, { id: "coldOut", domain: "hydraulic", label: "Stream B (cold) outlet" },
  ], defaults: { ua: 2000, arrangement: "counterflow", diameter: 0.025, lossCoefficient: 10, laminarK: 1000, maxPressure: 1000000, elevation: 0 }, variants: [
    { id: "plate", label: "Plate heat exchanger 20 kW/K", cost: 950, spec: "20 kW/K · DN50 · 16 bar", overrides: { ua: 20000, diameter: 0.05, lossCoefficient: 15, maxPressure: 1600000 } },
    { id: "shellTube", label: "Shell-and-tube 100 kW/K", cost: 4200, spec: "100 kW/K · DN100", overrides: { ua: 100000, diameter: 0.1, lossCoefficient: 12, maxPressure: 1600000 } },
  ] },
  pressureReducingValve: { label: "Pressure-reducing valve", category: "Hydraulic", description: "Pilot-style regulator: integral action drives the opening until the outlet gauge pressure equals the setpoint; forward-only", spec: "2 bar setpoint · 5 s stroke", cost: 120, prefix: "PRV", ports: fluid, defaults: { pressureSetpoint: 200000, proportionalBand: 20000, responseTime: 5, diameter: 0.025, lossCoefficient: 8, laminarK: 1500, characteristic: "linear", rangeability: 50, maxPressure: 1600000, elevation: 0 } },
  valve: { label: "Manual valve", category: "Hydraulic", description: "Quadratic loss K/φ², φ = Kv/Kvs from the selected inherent characteristic (linear, equal percentage, quick opening); exact isolation at zero opening", spec: "0–100% · bidirectional", cost: 14, prefix: "V", ports: fluid, defaults: { ...valveDefaults, characteristic: "linear", rangeability: 50 } },
  checkValve: { label: "Check valve", category: "Hydraulic", description: "Forward-only hydraulic branch with cracking pressure and reverse isolation", spec: "1 kPa cracking", cost: 18, prefix: "CV", ports: fluid, defaults: { ...valveDefaults, laminarK: 1500, crackingPressure: 1000 } },
  actuatedValve: { label: "Actuated valve", category: "Hydraulic", description: "Control valve with equal-percentage trim (R = 50) by default; rate-limited ideal external actuator, numeric percent command, defined fail position; actuator supply power omitted", spec: "5 s full stroke · equal %", cost: 35, prefix: "AV", ports: [...fluid, input("position", "number", true)], defaults: { ...valveDefaults, characteristic: "equalPercentage", rangeability: 50, responseTime: 5, failOpen: false } },
  fluidJunction: { label: "Fluid junction", category: "Hydraulic", description: "Ideal zero-volume mixing junction; pressure and continuity solved from connected branches", spec: "Conservative junction", cost: 2, prefix: "HJ", ports: [{ id: "fluid", domain: "hydraulic", label: "Fluid node" }], defaults: { elevation: 0, maxPressure: 1000000 } },
  pressureSensor: { label: "Pressure sensor", category: "Sensors", description: "Gauge pressure of the target outlet, measured from the hydraulic solution", spec: "Pa output", cost: 12, prefix: "PSN", ports: [output("number", "Pa")], defaults: { ...sensing, quantity: "pressure", stream: "hot" } },
  flowSensor: { label: "Flow sensor", category: "Sensors", description: "Signed target branch flow from the hydraulic solution", spec: "m³/s output", cost: 12, prefix: "FS", ports: [output("number", "m³/s")], defaults: { ...sensing, stream: "hot", resolution: 0.000000001 } },
  levelSensor: { label: "Tank level sensor", category: "Sensors", description: "Actual finite tank inventory as percent of capacity", spec: "% output", cost: 12, prefix: "LS", ports: [output("number", "%")], defaults: { ...sensing, minRange: 0, maxRange: 100 } },
  pid: { label: "PID regulator", category: "Automation", description: "Simulation-clock PID regulator: derivative on measurement with first-order filter, output limits and conditional anti-windup; numeric actuator command", spec: "Numeric feedback", cost: 22, prefix: "PI", ports: [input("in", "number"), output("number")], defaults: { reference: 35000, feedforward: 0, kp: 0.03, ki: 0.01, kd: 0, derivativeFilter: 1, minOutput: 0, maxOutput: 3500 } },
  scale: { label: "Scale / offset", category: "Automation", description: "Linear signal conversion y = gain·x + offset (e.g. 4–20 mA to bar, % to RPM)", spec: "y = k·x + b", cost: 6, prefix: "SC", ports: [input("in", "number"), output("number")], defaults: { gain: 1, offset: 0 } },
  limiter: { label: "Signal limiter", category: "Automation", description: "Clamps a numeric signal to [minimum, maximum]", spec: "min ≤ y ≤ max", cost: 5, prefix: "LIM", ports: [input("in", "number"), output("number")], defaults: { minOutput: 0, maxOutput: 100 } },
  filter: { label: "First-order filter", category: "Automation", description: "Low-pass y' = (x − y)/τ integrated exactly on the simulation clock", spec: "τ = 5 s", cost: 6, prefix: "FLT", ports: [input("in", "number"), output("number")], defaults: { timeConstant: 5 } },
  rateLimiter: { label: "Rate limiter", category: "Automation", description: "Limits the output slew rate |dy/dt| ≤ rate (ramps setpoints and commands)", spec: "10 units/s", cost: 6, prefix: "RL", ports: [input("in", "number"), output("number")], defaults: { rate: 10 } },
  selector: { label: "Signal selector", category: "Automation", description: "Minimum, maximum or Boolean-switched selection of two numeric signals (override and fallback logic)", spec: "min · max · switch", cost: 6, prefix: "SEL", ports: [input("in", "number"), input("in2", "number"), input("select", "boolean", true), output("number")], defaults: { mode: "max" } },
  battery: { label: "Battery", category: "Electrical", description: "Rechargeable DC battery: finite charge, linear open-circuit voltage versus SOC, ohmic and RC polarization overpotential with Arrhenius temperature dependence, charge-boundary protection", spec: "12 V · 20 Ah · 20 mΩ", cost: 65, prefix: "BAT", ports: [...electric, heat], defaults: { capacityAh: 20, initialSOC: 80, emptyVoltage: 11, fullVoltage: 13, internalResistance: 0.02, chemistry: "linear", coulombicEfficiency: 97, selfDischarge: 3, polarizationResistance: 0.015, polarizationTimeConstant: 30, resistanceActivation: 2000, maxCurrent: 100, maxPower: 1500, enabled: true, heatCapacity: 5000, loss: 2, conductance: 20, maxTemperature: 60 } },
  contactor: { label: "Powered contactor", category: "Electrical", description: "Normally-open power contact operated by a separately wired 24 V DC coil; coil power, delays and undervoltage dropout", spec: "24 V DC coil · 25 A contact", cost: 35, prefix: "KM", ports: [...electric, { id: "ca", domain: "electrical", label: "Coil A1 (+)" }, { id: "cb", domain: "electrical", label: "Coil A2 (−)" }, heat], defaults: { coilVoltage: 24, coilResistance: 144, pickupRatio: 0.8, dropoutRatio: 0.3, pickupTime: 0.02, dropoutTime: 0.02, resistance: 0.01, ratedVoltage: 690, ratedCurrent: 25, ratedPower: 20, heatCapacity: 150, loss: 1, conductance: 10, maxTemperature: 120 } },
  transformer: { label: "Transformer", category: "Electrical", description: "Isolated AC transformer with primary-referred winding impedance, magnetizing inductance and core-loss resistance; no saturation or switching inrush", spec: "230 / 24 V · 250 VA", cost: 80, prefix: "TR", ports: [...electric, { id: "sa", domain: "electrical", label: "Secondary S1 (dot)" }, { id: "sb", domain: "electrical", label: "Secondary S2" }, heat], defaults: { turnsRatio: 230 / 24, windingResistance: 2, leakageInductance: 0.015, magnetizingInductance: 20, coreResistance: 20000, ratedVoltage: 230, ratedPower: 250, ratedCurrent: 1.1, heatCapacity: 1500, loss: 2, conductance: 20, maxTemperature: 120 } },
  radiator: { label: "Fan-cooled radiator", category: "Hydraulic", description: "Zero-inventory water-to-ambient radiator with hydraulic loss, natural cooling and separately wired DC fan; fan heat goes to ambient", spec: "24 V / 30 W fan · 100 W/K", cost: 100, prefix: "RAD", ports: [...electric, ...fluid], defaults: { ratedVoltage: 24, fanRatedPower: 30, naturalUA: 5, forcedUA: 95, ambient: 20, diameter: 0.02, lossCoefficient: 8, laminarK: 1500, maxPressure: 1000000, elevation: 0 } },
  source: {
    label: "DC power supply",
    category: "Electrical",
    description: "Adjustable DC source: ideal, internal-resistance, current-limited (CV/CC) or constant-current behaviour",
    spec: "0–240 V · 20 A",
    cost: 45,
    prefix: "PS",
    ports: electric,
    defaults: { voltage: 24, maxCurrent: 20, ratedVoltage: 240, mode: "ideal", internalResistance: 0, current: 1, maxPower: 4800, enabled: true },
    variants: [
      {
        id: "labCVCC",
        label: "Laboratory CV/CC 30 V / 5 A",
        cost: 60,
        spec: "0–30 V · 0–5 A regulated",
        overrides: { voltage: 12, maxCurrent: 5, ratedVoltage: 30, mode: "cvcc", maxPower: 150 },
      },
      {
        id: "motorSupply",
        label: "Motor supply 240 V / 80 A",
        cost: 180,
        spec: "0–240 V · 80 A",
        overrides: { voltage: 180, maxCurrent: 80, ratedVoltage: 240, maxPower: 19200 },
      },
      {
        id: "industrial",
        label: "Industrial 500 V / 40 A",
        cost: 85,
        spec: "0–500 V · 40 A",
        overrides: { maxCurrent: 40, ratedVoltage: 500, maxPower: 20000 },
      },
      {
        id: "powerBus",
        label: "Industrial DC bus 800 V / 250 A",
        cost: 1400,
        spec: "0–800 V · 250 A · CV/CC · 200 kW",
        overrides: { voltage: 400, maxCurrent: 250, ratedVoltage: 800, mode: "cvcc", internalResistance: 0.01, maxPower: 200000 },
      },
    ],
  },
  source3: {
    label: "Three-phase supply",
    category: "Electrical",
    description: "Balanced 3-phase AC supply solved as a per-phase (star-equivalent) network: one wire carries the three phase conductors; RLC loads and induction machines; RMS phase voltage, line current and total three-phase power",
    spec: "400 V 3~ 50 Hz · 63 A",
    cost: 160,
    prefix: "TS3",
    ports: [
      { id: "a", domain: "electrical", label: "Phase conductors L1–L3 (single-line)" },
      { id: "b", domain: "electrical", label: "Neutral / star point" },
    ],
    defaults: { lineVoltage: 400, frequency: 50, internalResistance: 0, maxCurrent: 63, maxPower: 43600, enabled: true, magneticTrip: 10, thermalTimeConstant: 60 },
    variants: [
      { id: "industrial250", label: "Industrial 400 V 3~ 250 A", cost: 900, spec: "400 V · 250 A · 173 kVA", overrides: { maxCurrent: 250, maxPower: 173000, internalResistance: 0.005 } },
      { id: "mv690", label: "690 V 3~ 400 A", cost: 1600, spec: "690 V · 400 A · 478 kVA", overrides: { lineVoltage: 690, maxCurrent: 400, maxPower: 478000, internalResistance: 0.003 } },
    ],
  },
  sourceAC: {
    label: "AC supply (single phase)",
    category: "Electrical",
    description: "Sinusoidal voltage source (RMS phasor) with phase angle and internal impedance; three of them at 0°/−120°/+120° on a common neutral form an explicitly wired, possibly unbalanced, three-phase system",
    spec: "230 V ~ 50 Hz · 16 A",
    cost: 70,
    prefix: "AC",
    ports: [
      { id: "a", domain: "electrical", label: "Line (phase) terminal" },
      { id: "b", domain: "electrical", label: "Neutral terminal" },
    ],
    defaults: { voltage: 230, frequency: 50, phase: 0, internalResistance: 0, internalReactance: 0, ratedVoltage: 400, maxCurrent: 16, maxPower: 3680, enabled: true, magneticTrip: 10, thermalTimeConstant: 60 },
  },
  inductor: {
    label: "Inductor / reactor",
    category: "Electrical",
    description: "Inductance with series winding resistance: stores current and ½·L·I² in DC networks (L·di/dt transients; an interrupted current arcs); Z = R + jωL in AC networks",
    spec: "10 mH · 0.1 Ω · 10 A",
    cost: 20,
    prefix: "L",
    ports: [...electric, heat],
    defaults: { inductance: 0.01, resistance: 0.1, ratedCurrent: 10, heatCapacity: 200, loss: 1, conductance: 5, maxTemperature: 150, tempCoefficient: 0.00393, tolerance: 0 },
  },
  capacitor: {
    label: "Capacitor",
    category: "Electrical",
    description: "Capacitance with series ESR: stores charge and ½·C·V² in DC networks (charging, discharging, 1 GΩ self-discharge leakage); Z = ESR − j/(ωC) in AC networks",
    spec: "100 µF · 450 V",
    cost: 12,
    prefix: "C",
    ports: electric,
    defaults: { capacitance: 0.0001, polarized: false, chargeVoltage: 0, resistance: 0.05, ratedVoltage: 450, ratedCurrent: 20, heatCapacity: 50, loss: 0.5, maxTemperature: 85, tempCoefficient: 0, tolerance: 0 },
  },
  inductionMotor: {
    label: "Three-phase induction motor",
    category: "Electrical",
    description: "Squirrel-cage machine on a balanced three-phase supply: dynamic dq model with a double (deep-bar) cage (stator and rotor flux transients: inrush with DC offset, transient torque, residual flux) whose steady state is the per-phase equivalent circuit; copper, iron and friction losses calibrated to IE3 data; shaft drives pumps and spatial rotors",
    spec: "400 V 3~ · 7.5 kW · 4-pole",
    cost: 420,
    prefix: "IM",
    ports: [...electric, shaft, heat, input("enable", "boolean", true)],
    defaults: { ratedVoltage: 400, ratedFrequency: 50, poles: 4, ratedPower: 7500, ratedCurrent: 14.4, ratedTorque: 49, statorResistance: 0.71, statorReactance: 1.17, magnetizingReactance: 33.5, rotorResistance: 0.809, rotorReactance: 5.79, rotorResistance2: 0.816, rotorReactance2: 0.858, coreResistance: 1160, inertia: 0.045, friction: 0.002, loadTorque: 0, maxSpeed: 330, heatCapacity: 25000, loss: 18, conductance: 30, maxTemperature: 155, enabled: true },
    variants: [
      { id: "im45", label: "Induction motor 45 kW", cost: 2200, spec: "400 V 3~ · 45 kW · 4-pole", overrides: { ratedPower: 45000, ratedCurrent: 80, ratedTorque: 290, statorResistance: 0.0778, statorReactance: 0.215, magnetizingReactance: 8.22, rotorResistance: 0.0436, rotorReactance: 0.766, rotorResistance2: 0.164, rotorReactance2: 0.154, coreResistance: 306, inertia: 0.38, friction: 0.01, heatCapacity: 150000, loss: 90 } },
    ],
  },
  starDeltaStarter: {
    label: "Star-delta starter",
    category: "Electrical",
    description: "Contactor combination for a delta-wound motor: starts in star (each winding at V/√3, line current and torque ÷ 3), switches to delta after the star time with an open transition (dead time); feeds one induction motor wired directly to its motor terminal",
    spec: "16 A · 5 s star · 50 ms transition",
    cost: 160,
    prefix: "SDS",
    ports: [{ id: "a", domain: "electrical", label: "Line (from supply)" }, { id: "b", domain: "electrical", label: "Motor (to motor terminal a)" }, input("start", "boolean", true)],
    defaults: { enabled: true, starTime: 5, transitionTime: 0.05, ratedCurrent: 16, ratedVoltage: 690, resistance: 0.003, heatCapacity: 400, loss: 2, maxTemperature: 120 },
  },
  softStarter: {
    label: "Soft starter",
    category: "Electrical",
    description: "Thyristor voltage controller: ramps the motor's fundamental voltage from an initial value with a current limit, then closes its bypass contactor; optional soft stop. Fundamental-frequency model: the thyristors act as a lossless controlled series reactance (low line power factor while ramping); harmonics are not modelled",
    spec: "16 A · 40 % → 100 % in 10 s · 3.5 × In limit",
    cost: 280,
    prefix: "SS",
    ports: [{ id: "a", domain: "electrical", label: "Line (from supply)" }, { id: "b", domain: "electrical", label: "Motor (to motor terminal a)" }, input("start", "boolean", true)],
    defaults: { enabled: true, initialVoltage: 40, rampTime: 10, stopTime: 0, currentLimit: 3.5, ratedCurrent: 16, maxStartTime: 30, ratedVoltage: 690, resistance: 0.004, heatCapacity: 600, loss: 3, maxTemperature: 120 },
  },
  vfd: {
    label: "Variable-frequency drive",
    category: "Electrical",
    description: "Diode rectifier, DC link and PWM inverter: three-phase output at a commanded frequency with V/f control and boost, acceleration/deceleration ramps, current limit (stall prevention), I²t overload, braking resistor for regenerated power, current-dependent losses into its heat sink. Fundamental-frequency model: input current in phase with the voltage, harmonics and DC-link dynamics not modelled",
    spec: "400 V · 7.5 kW · 16.5 A · 0–60 Hz",
    cost: 650,
    prefix: "VFD",
    ports: [
      { id: "a", domain: "electrical", label: "Line input (phase)" },
      { id: "b", domain: "electrical", label: "Line input (neutral)" },
      { id: "oa", domain: "electrical", label: "Motor output (phase)" },
      { id: "ob", domain: "electrical", label: "Motor output (star point)" },
      input("run", "boolean", true),
      input("frequency", "number", true),
    ],
    defaults: { enabled: true, frequencySetpoint: 50, accelTime: 5, decelTime: 5, stopMode: "ramp", startFrequency: 0.5, baseFrequency: 50, maxFrequency: 60, boost: 3, ratedVoltage: 400, ratedPower: 7500, ratedOutputCurrent: 16.5, overload: 150, overcurrentTrip: 2.5, ratedLoss: 3, standbyLoss: 20, inputTHD: 40, heatCapacity: 3000, loss: 6, maxTemperature: 90 },
    variants: [
      { id: "vfd45", label: "Variable-frequency drive 45 kW", cost: 3200, spec: "400 V · 45 kW · 88 A", overrides: { ratedPower: 45000, ratedOutputCurrent: 88, standbyLoss: 60, heatCapacity: 15000, loss: 30 } },
    ],
  },
  resistor: {
    label: "Resistor",
    category: "Electrical",
    description: "Configurable resistance; catalog power and thermal ratings; optional thermal port for mounting on a heat sink",
    spec: "6 Ω · 50 W",
    cost: 8,
    prefix: "R",
    ports: [...electric, heat],
    defaults: { ...passive, conductance: 2 },
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
    description: "Tungsten filament lamp: cold resistance 10 % of hot, switch-on surge, measured brightness",
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
    description: "Resistive element defined by nominal voltage and power (R = V²/P), with explicit immersion conductance",
    spec: "240 V · 2 kW · 28.8 Ω",
    cost: 65,
    prefix: "H",
    ports: [...electric, heat],
    defaults: {
      resistance: 28.8,
      ratedVoltage: 240,
      ratedPower: 2000,
      heatCapacity: 300,
      loss: 0.5,
      conductance: 180,
      maxTemperature: 150,
    },
    variants: [
      {
        id: "lab100",
        label: "Laboratory 100 W / 24 V element",
        cost: 25,
        spec: "24 V · 100 W · 5.76 Ω",
        overrides: { ratedVoltage: 24, ratedPower: 100, heatCapacity: 15, conductance: 9, loss: 0.1 },
      },
      {
        id: "industrial",
        label: "3 kW industrial element",
        cost: 95,
        spec: "240 V · 3 kW · 19.2 Ω",
        overrides: {
          resistance: 19.2,
          ratedPower: 3000,
          heatCapacity: 450,
          conductance: 240,
          maxTemperature: 180,
        },
      },
      {
        id: "industrial12k",
        label: "12 kW immersion bank (DC/1-phase equivalent)",
        cost: 380,
        spec: "400 V · 12 kW · 13.3 Ω equivalent",
        overrides: { ratedVoltage: 400, ratedPower: 12000, heatCapacity: 1800, conductance: 1080, loss: 2, maxTemperature: 200 },
      },
      {
        id: "bank30k",
        label: "30 kW heating bank (DC/1-phase equivalent)",
        cost: 820,
        spec: "400 V · 30 kW · 5.33 Ω equivalent",
        overrides: { ratedVoltage: 400, ratedPower: 30000, heatCapacity: 4500, conductance: 2700, loss: 4, maxTemperature: 200 },
      },
      {
        id: "bank100k",
        label: "100 kW heating bank (DC/1-phase equivalent)",
        cost: 2400,
        spec: "690 V · 100 kW · 4.76 Ω equivalent",
        overrides: { ratedVoltage: 690, ratedPower: 100000, heatCapacity: 15000, conductance: 9000, loss: 10, maxTemperature: 200 },
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
    ports: [heat, { id: "fluid", domain: "hydraulic", label: "Bottom fluid connection" }, { id: "overflow", domain: "hydraulic", label: "Overflow outlet at the rim (optional)", optional: true }],
    defaults: {
      elevation: 0,
      surfaceArea: 0.1,
      density: 1000,
      maxPressure: 1000000,
      vented: true,
      volume: 10,
      capacity: 20,
      initialTemperature: 20,
      loss: 2.2,
      ambient: 20,
      vesselHeatCapacity: 0,
      weirLength: 0.3,
      lossModel: "manual",
      insulationThickness: 0.05,
      insulationConductivity: 0.04,
    },
    variants: [
      {
        id: "insulated",
        label: "Insulated 20 L vessel",
        cost: 65,
        spec: "20 L · 0.5 W/K",
        overrides: { loss: 0.5 },
      },
      {
        id: "process2000",
        label: "Insulated 2,000 L process tank",
        cost: 2600,
        spec: "2,200 L · Ø1.4 m · 100 mm mineral wool · steel 150 kJ/K",
        overrides: { capacity: 2200, volume: 2000, surfaceArea: 1.54, vesselHeatCapacity: 150000, lossModel: "insulation", insulationThickness: 0.1, insulationConductivity: 0.04, maxPressure: 300000 },
      },
      {
        id: "storage10000",
        label: "Insulated 10,000 L storage tank",
        cost: 7800,
        spec: "11,000 L · Ø2.5 m · 150 mm insulation · steel 600 kJ/K",
        overrides: { capacity: 11000, volume: 10000, surfaceArea: 4.91, vesselHeatCapacity: 600000, lossModel: "insulation", insulationThickness: 0.15, insulationConductivity: 0.04, maxPressure: 300000 },
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
    description: "gG-type fuse: element and body thermal images, carries 1.25 × In, melts at 1.6 × In, inverse-time within the IEC gG gates",
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
      tripTime: 0.1,
    },
    variants: [
      {
        id: "heavy",
        label: "20 A fuse",
        cost: 9,
        spec: "20 A · 0.01 Ω",
        overrides: { ratedCurrent: 20, resistance: 0.01, ratedPower: 25 },
      },
      {
        id: "power63",
        label: "63 A power fuse",
        cost: 24,
        spec: "63 A · 1 mΩ",
        overrides: { ratedCurrent: 63, resistance: 0.001, ratedPower: 40, heatCapacity: 60 },
      },
      {
        id: "power250",
        label: "250 A NH power fuse",
        cost: 70,
        spec: "250 A · 0.25 mΩ",
        overrides: { ratedCurrent: 250, resistance: 0.00025, ratedPower: 80, heatCapacity: 200, loss: 3 },
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
      quantity: "auto",
      stream: "hot",
      minRange: 0,
      maxRange: 120,
      resolution: 0.01,
      lag: 0,
      noise: 0,
      sampleInterval: 0,
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
      {
        id: "contactor250",
        label: "Power contactor 690 V / 250 A",
        cost: 260,
        spec: "690 V · 250 A · 0.2 mΩ",
        overrides: { ratedCurrent: 250, ratedVoltage: 690, resistance: 0.0002, ratedPower: 40, heatCapacity: 800, loss: 3 },
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
      quantity: "auto",
      stream: "hot",
      setpoint: 80,
      hysteresis: 2,
      minRange: 0,
      maxRange: 120,
      resolution: 0.01,
      lag: 0,
      noise: 0,
      sampleInterval: 0,
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
      quantity: "auto",
      stream: "hot",
      threshold: 90,
      resetMargin: 5,
      minRange: 0,
      maxRange: 120,
      resolution: 0.01,
      lag: 0,
      noise: 0,
      sampleInterval: 0,
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
      {
        id: "processCoil",
        label: "Process cooling coil 1 kW/K",
        cost: 650,
        spec: "1,000 W/K · 15°C chilled water",
        overrides: { conductance: 1000, ambient: 15 },
      },
    ],
  },
  breaker: {
    label: "Circuit breaker",
    category: "Electrical",
    description: "Thermal-magnetic breaker: I²t thermal memory trip, instantaneous magnetic trip, breaking capacity; manual re-close after cooling",
    spec: "C16 · 400 V · 6 kA",
    cost: 22,
    prefix: "QF",
    ports: [...electric, output()],
    defaults: { resistance: 0.005, ratedCurrent: 16, ratedVoltage: 400, thermalTimeConstant: 60, magneticTrip: 10, breakingCapacity: 6000, closed: true, heatCapacity: 40, loss: 1, maxTemperature: 150 },
    variants: [
      { id: "b10", label: "B10 lighting breaker", cost: 18, spec: "10 A · 5× In magnetic · 6 kA", overrides: { ratedCurrent: 10, magneticTrip: 5, resistance: 0.008 } },
      { id: "d63", label: "D63 motor-circuit breaker", cost: 75, spec: "63 A · 20× In magnetic · 10 kA", overrides: { ratedCurrent: 63, magneticTrip: 20, resistance: 0.0012, breakingCapacity: 10000, heatCapacity: 120 } },
      { id: "mccb250", label: "Moulded-case breaker 250 A", cost: 480, spec: "250 A · 690 V · 36 kA", overrides: { ratedCurrent: 250, ratedVoltage: 690, magneticTrip: 10, resistance: 0.0002, breakingCapacity: 36000, thermalTimeConstant: 120, heatCapacity: 600, loss: 3 } },
    ],
  },
  motorProtector: {
    label: "Motor-protective breaker",
    category: "Electrical",
    description: "Motor circuit breaker with adjustable overload setting, trip-class thermal image (heating and cooling memory) and magnetic short-circuit trip",
    spec: "20 A setting · class 10 · 13× magnetic",
    cost: 85,
    prefix: "QM",
    ports: [...electric, output()],
    defaults: { resistance: 0.004, ratedCurrent: 20, ratedVoltage: 690, tripClass: 10, magneticTrip: 13, breakingCapacity: 50000, closed: true, heatCapacity: 60, loss: 1, maxTemperature: 150 },
    variants: [
      { id: "mpcb63", label: "Motor protector 63 A class 10", cost: 190, spec: "63 A setting · 50 kA", overrides: { ratedCurrent: 63, resistance: 0.0012, heatCapacity: 150 } },
      { id: "class20", label: "Motor protector 20 A class 20 (heavy start)", cost: 110, spec: "20 A · class 20", overrides: { tripClass: 20 } },
      { id: "mpcb200", label: "Motor protector 200 A class 10", cost: 640, spec: "200 A setting · 690 V · 70 kA", overrides: { ratedCurrent: 200, resistance: 0.0003, breakingCapacity: 70000, heatCapacity: 500, loss: 3 } },
    ],
  },
  thermalMass: {
    label: "Thermal mass / heat sink",
    category: "Thermal",
    description: "Lumped solid body: heat capacity, loss to ambient and a thermal port with contact conductance; links any number of thermal components",
    spec: "1 kg aluminium · 1 W/K",
    cost: 15,
    prefix: "TM",
    ports: [heat],
    defaults: { heatCapacity: 900, loss: 1, conductance: 20, initialTemperature: 20, maxTemperature: 500 },
    variants: [
      { id: "heatSink", label: "Finned aluminium heat sink 0.3 K/W", cost: 35, spec: "0.6 kg · 3.3 W/K to air · 50 W/K contact", overrides: { heatCapacity: 540, loss: 3.3, conductance: 50, maxTemperature: 200 } },
      { id: "steelBlock", label: "Steel block 10 kg", cost: 30, spec: "4.7 kJ/K · 0.5 W/K", overrides: { heatCapacity: 4700, loss: 0.5, conductance: 30, maxTemperature: 800 } },
      { id: "enclosure", label: "Control-cabinet air & housing", cost: 60, spec: "15 kJ/K · 6 W/K to room", overrides: { heatCapacity: 15000, loss: 6, conductance: 10, maxTemperature: 60 } },
    ],
  },
  cable: {
    label: "Power cable",
    category: "Electrical",
    description: "Resistive conductor R = ρL/A with temperature-dependent resistance, conductor heat capacity and ampacity-calibrated cooling",
    spec: "Cu 2.5 mm² · 10 m · 24 A",
    cost: 6,
    prefix: "W",
    ports: [...electric, heat],
    defaults: applyDerived("cable", {
      conductance: 5,
      material: "copper",
      area: 2.5,
      length: 10,
      ratedCurrent: 24,
      maxTemperature: 70,
      resistance: 0,
      heatCapacity: 0,
      loss: 0,
      tempCoefficient: 0,
    }),
  },
};
// Environmental boundaries are opt-in overrides; numeric ambient is retained for
// file compatibility and as the value to use when a local override is enabled.
for (const d of Object.values(definitions)) {
  if ('ambient' in d.defaults || 'heatCapacity' in d.defaults) {
    d.defaults = { ...d.defaults, ambient: d.defaults.ambient ?? DEFAULT_AMBIENT, ambientMode: 'inherit' };
    for (const v of d.variants ?? [])
      if (typeof v.overrides.ambient === 'number') v.overrides = { ...v.overrides, ambientMode: 'override' };
  }
}
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
    props: applyDerived(c.kind, { ...d.defaults, ...variant?.overrides }),
  };
}
/** Properties that size a component and therefore drive its cost. */
const costDrivers: Partial<Record<Kind, (p: Record<string, Property>) => number>> = {
  heater: p => +p.ratedPower, resistor: p => +p.ratedPower, lamp: p => +p.ratedPower, meter: () => 1,
  source: p => +p.ratedVoltage * +p.maxCurrent, fuse: p => +p.ratedCurrent, switch: p => +p.ratedPower,
  relay: p => +p.ratedCurrent * +p.ratedVoltage, safety: p => +p.ratedCurrent * +p.ratedVoltage,
  motor: p => +p.ratedPower, panelRadiator: p => +p.ratedOutput, pump: p => +p.ratedFlow * +p.shutoffHead, circulator: p => +p.ratedFlow * +p.shutoffHead, tank: p => +p.capacity,
  cooler: p => +p.conductance, pipe: p => +p.length * (+p.diameter) ** 1.5, valve: p => (+p.diameter) ** 2,
  checkValve: p => (+p.diameter) ** 2, actuatedValve: p => (+p.diameter) ** 2, cable: p => +p.area * +p.length,
};
/** True when the configuration equals its catalog model (ignoring operating and initial-state values). */
export function isCatalogConfiguration(c: Component, ignored: (key: string) => boolean) {
  const model = catalog(c).props;
  return Object.entries(model).every(([k, v]) => ignored(k) || c.props[k] === v);
}
/**
 * Cost of a component. A catalog configuration costs its catalog price. A custom
 * sandbox configuration is priced from its sizing quantity with the six-tenths
 * rule relative to the closest-sized catalog model of its kind (cable: linear in
 * conductor volume), never below 25% of that model's price. Challenges reject custom configurations, so this
 * estimate cannot be used to buy cheaper ratings in a scored assignment.
 */
export function componentCost(c: Component): { cost: number; estimated: boolean } {
  const model = catalog(c), driver = costDrivers[c.kind];
  if (!driver) return { cost: model.cost, estimated: false };
  const size = driver(c.props);
  if (Math.abs(size / driver(model.props) - 1) < 1e-9) return { cost: model.cost, estimated: false };
  // Scale from the catalog model of closest size so presets and paid variants price consistently.
  const d = definitions[c.kind];
  const bases = [{ cost: d.cost, size: driver(applyDerived(c.kind, { ...d.defaults })) }, ...(d.variants ?? []).map((v) => ({ cost: v.cost, size: driver(applyDerived(c.kind, { ...d.defaults, ...v.overrides })) }))]
    .filter((b) => Number.isFinite(b.size) && b.size > 0);
  if (!Number.isFinite(size) || size <= 0 || !bases.length) return { cost: model.cost, estimated: false };
  const base = bases.reduce((best, b) => (Math.abs(Math.log(size / b.size)) < Math.abs(Math.log(size / best.size)) ? b : best));
  const exponent = c.kind === "cable" ? 1 : 0.6;
  return { cost: Math.max(base.cost * 0.25, Math.round(base.cost * (size / base.size) ** exponent * 100) / 100), estimated: true };
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
    ...(kind === 'rigidBody' ? { spatial: makeSpatial() } : {}),
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
export const isSource = (c: Component) => c.kind === "source" || c.kind === "source3" || c.kind === "sourceAC" || c.kind === "battery" || c.kind === "lfpBattery";
/** Machines with a rotating shaft driven by the electrical network. */
export const isMotor = (c: Component) => c.kind === "motor" || c.kind === "inductionMotor";
export const isThermalMass = (c: Component) =>
  c.kind === "tank" || c.kind === "thermalMass" || c.kind === "battery" || c.kind === "lfpBattery" || (isElectrical(c) && c.kind !== "solarPanel" && !isSource(c) && c.kind !== "radiator" && c.kind !== "circulator" && c.kind !== "electricBoiler");
/** Components whose catalog data describe one pole/conductor; a three-phase island has three. */
export const perPoleKinds = new Set<Kind>(["cable", "fuse", "breaker", "motorProtector", "switch", "relay", "safety", "meter", "inductor", "capacitor"]);
/** Contact conductance of a thermal port (W/K); a well-mixed tank's own side is ideal. */
export const portConductance = (c: Component) => (c.kind === "tank" ? Infinity : prop(c, "conductance", 180));
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
    return "Electrical and thermal terminals cannot be connected. Hydraulic, mechanical and control terminals also require matching domains.";
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
  if (pa.domain === "hydraulic" && pa.id === "overflow" && pb.id === "overflow") return "Connect an overflow outlet to a receiving fluid inlet, not another overflow outlet.";
  if (pa.domain === "hydraulic" && a!.kind === "tank" && b!.kind === "tank") return "Insert a physical pipe between finite tanks, including overflow routes; an ideal wire cannot resolve their pressure difference.";
  if (pa.domain === "mechanical") {
    const motor = isMotor(a!) ? a! : isMotor(b!) ? b! : undefined;
    const load = motor?.id === a!.id ? b! : a!;
    if (!motor || !['pump', 'rigidBody', 'flywheel', 'dynamometer'].includes(load.kind)) return 'Connect a motor shaft to a pump, flywheel, dynamometer or spatial rotor.';
    // A spatial rotor carries the shaft dynamics in the rigid-body world; flywheels and dynamometers act on the motor's own shaft equation.
    const others = project.connections.filter(w => w.domain === 'mechanical' && [w.from.component, w.to.component].includes(motor.id)).map(w => project.components.find(c => c.id === (w.from.component === motor.id ? w.to.component : w.from.component))?.kind);
    if ((load.kind === 'rigidBody' && others.some(k => k === 'flywheel' || k === 'dynamometer')) || (['flywheel', 'dynamometer'].includes(load.kind) && others.includes('rigidBody'))) return 'A shaft driving a spatial rotor cannot also carry a flywheel or dynamometer; the spatial body supplies its inertia and loads.';
    if (load.kind === 'rigidBody' && (!load.spatial || load.spatial.type !== 'dynamic' || load.spatial.fixedRotation)) return 'A spatial shaft needs a dynamic body with free rotation.';
    if (project.connections.some(w => w.domain === 'mechanical' && (w.from.component === load.id || w.to.component === load.id || ([w.from.component, w.to.component].includes(motor.id) && project.components.some(c => [w.from.component, w.to.component].includes(c.id) && c.kind === load.kind))))) return 'A shaft supports one motor and at most one each of pump, flywheel, dynamometer and spatial rotor; a load accepts one shaft.';
  }
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
    const cooler = pair.find((c) => c.kind === "cooler");
    if (pair.every((c) => c.kind === "cooler"))
      return "A cooling jacket connects to one thermal mass, not to another jacket.";
    if (!pair.every((c) => c.kind === "cooler" || isThermalMass(c)))
      return "Thermal ports connect thermal masses (tanks, heaters, heat sinks, resistors, cables, motors) or a cooling jacket to one of them.";
    // Single-surface interfaces: an immersion element or a cooling jacket attaches to one body.
    for (const limited of pair.filter((c) => c.kind === "heater" || c.kind === "cooler"))
      if (
        project.connections.some(
          (w) =>
            w.domain === "thermal" &&
            (w.from.component === limited.id || w.to.component === limited.id),
        )
      )
        return "This thermal interface is already attached to a thermal mass.";
    if (!cooler && pair.every((c) => c.kind === "tank"))
      return "Two well-mixed tanks need a heat-exchanger or a wall model; connect them through a thermal mass.";
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
  p.components.reduce((n, c) => n + componentCost(c).cost, 0) + (p.world?.joints ?? []).reduce((sum, j) => sum + (j.kind === 'gear' ? 40 : j.kind === 'spring' ? 15 : 20), 0);
