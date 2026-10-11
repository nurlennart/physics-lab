export type Kind =
  | "rigidBody" | "positionSensor" | "speedSensor" | "forceActuator"
  | "motor" | "pump" | "pipe" | "valve" | "checkValve" | "actuatedValve"
  | "fluidJunction" | "pressureSensor" | "flowSensor" | "levelSensor" | "pid"
  | "source"
  | "source3"
  | "sourceAC"
  | "inductor"
  | "capacitor"
  | "inductionMotor"
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
export type ChallengeId = "light" | "heat" | "runaway" | "transfer" | "pressure" | "supply" | "descent" | "lift" | "rotation";
import type { SpatialBody, SpatialWorld, MechanicalJoint } from './spatial-model';
import { makeSpatial } from './spatial-model';
import { applyDerived } from "./parameters";
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
  | "positionX" | "positionY" | "displacement" | "linearSpeed" | "velocityX" | "velocityY" | "angularVelocity" | "acceleration" | "appliedForce" | "appliedTorque" | "kineticEnergy" | "potentialEnergy" | "mechanicalResidual" | "contactImpulse" | "jointForce"
  | "pressure" | "inletPressure" | "differentialPressure" | "flow" | "level" | "fluidTemperature"
  | "heatDuty" | "npsh" | "reactivePower" | "powerFactor" | "impellerPower" | "mechanicalLoss" | "hydraulicEfficiency" | "overflow" | "overflowVolume"
  | "rpm" | "shaftPower" | "hydraulicPower" | "efficiency" | "transferredVolume"
  | "massResidual" | "energyResidual" | "velocity" | "reynolds" | "frictionFactor" | "position"
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
export const definitions: Record<Kind, Definition> = {
  rigidBody: { label: 'Rigid body', category: 'Mechanical', description: 'Spatial rectangle, circle, convex polygon, beam, wheel or structural boundary; real mass, inertia and collision geometry', spec: 'SI geometry · static / dynamic / kinematic', cost: 25, prefix: 'RB', ports: [shaft], defaults: { forceX: 0, forceY: 0, appliedTorque: 0, brakeDamping: 0 } },
  positionSensor: { label: 'Position sensor', category: 'Sensors', description: 'Actual world position of the target body; selected x or y axis in metres', spec: 'm output', cost: 12, prefix: 'XS', ports: [output('number', 'm')], defaults: { ...sensing, axis: 'y', resolution: 0.00001 } },
  speedSensor: { label: 'Shaft speed sensor', category: 'Sensors', description: 'Calculated target body or motor rotational speed; same shaft state in both views', spec: 'RPM output', cost: 12, prefix: 'WS', ports: [output('number', 'RPM')], defaults: { ...sensing, resolution: 0.001 } },
  forceActuator: { label: 'Force / brake actuator', category: 'Mechanical', description: 'Explicit external force or torque source with optional control input and viscous brake; work and heat are accounted', spec: 'N or N·m · declared external supply', cost: 18, prefix: 'FA', ports: [input('in', 'number', true)], defaults: { target: '', axis: 'y', value: 0, damping: 0, maxForce: 10000, enabled: true } },
  motor: { label: "DC motor", category: "Electrical", description: "Brushed DC motor: 24 V laboratory, 48 V traction and 180 V industrial models; quasi-steady armature, back EMF, shaft inertia and copper heat; ideal PWM drive on optional speed command", spec: "24 V · 20 A · 0.08 N·m/A", cost: 65, prefix: "M", ports: [...electric, shaft, heat, input("enable", "boolean", true), input("speed", "number", true)], defaults: { conductance: 20, resistance: 1.2, torqueConstant: 0.08, emfConstant: 0.08, inertia: 0.006, friction: 0.0005, loadTorque: 0, ratedVoltage: 24, ratedCurrent: 20, ratedTorque: 1.6, ratedPower: 500, maxSpeed: 400, heatCapacity: 500, loss: 2, maxTemperature: 120, enabled: true, speedControl: false, speedCommand: 2500 }, variants: [
    { id: "traction48", label: "Traction DC 48 V", cost: 180, spec: "48 V · 40 A limit · 6 N·m torque limit", overrides: { torqueConstant: 0.15, emfConstant: 0.15, inertia: 0.025, friction: 0.001, ratedVoltage: 48, ratedCurrent: 40, ratedTorque: 6, ratedPower: 2000, heatCapacity: 1800, loss: 5 } },
    { id: "industrial180", label: "Industrial DC 180 V", cost: 480, spec: "180 V · 60 A limit · 33 N·m torque limit", overrides: { resistance: 3, torqueConstant: 0.55, emfConstant: 0.55, inertia: 0.12, friction: 0.002, ratedVoltage: 180, ratedCurrent: 60, ratedTorque: 33, ratedPower: 11000, heatCapacity: 6000, loss: 15, maxTemperature: 150 } },
    { id: "industrial440", label: "Industrial DC 440 V · 75 kW", cost: 6800, spec: "440 V · 190 A · 437 N·m · 1,750 RPM", overrides: { resistance: 0.1, torqueConstant: 2.3, emfConstant: 2.3, inertia: 1.2, friction: 0.02, ratedVoltage: 440, ratedCurrent: 190, ratedTorque: 437, ratedPower: 84000, maxSpeed: 230, heatCapacity: 60000, loss: 60, maxTemperature: 155, speedCommand: 1500 } },
  ] },
  pump: { label: "Centrifugal pump", category: "Hydraulic", description: "Shaft-driven quadratic head curve with affinity scaling and built-in reverse-flow check; zero-volume wetted inventory", spec: "8 m shutoff · 60 L/min · 2,865 RPM", cost: 70, prefix: "P", ports: [...fluid, shaft], defaults: { ratedSpeed: 300, ratedFlow: 0.001, shutoffHead: 8, efficiency: 0.7, mechanicalLoss: 2, maxPressure: 1000000, elevation: 0, curvePoints: "", npshRequired: 2 }, variants: [
    { id: "industrial", label: "Industrial transfer pump", cost: 360, spec: "35 m shutoff · 360 L/min reference flow · 2,865 RPM", overrides: { ratedFlow: 0.006, shutoffHead: 35, efficiency: 0.78, mechanicalLoss: 1.9 } },
    { id: "highCapacity", label: "High-capacity process pump", cost: 2400, spec: "30 m shutoff · 3,000 L/min reference flow · 1,475 RPM", overrides: { ratedSpeed: 154.5, ratedFlow: 0.05, shutoffHead: 30, efficiency: 0.82, mechanicalLoss: 1.5, maxPressure: 1600000 } },
  ] },
  pipe: { label: "Pipe", category: "Hydraulic", description: "Darcy–Weisbach pipe with laminar/transition/turbulent friction, explicit physical length and water inventory in mixing cells (thermal transport delay)", spec: "5 m · Ø25 mm", cost: 12, prefix: "PL", ports: fluid, defaults: { length: 5, diameter: 0.025, roughness: 0.000045, maxPressure: 1000000, material: "steel", conductivity: 45, insulation: 0, thermalUA: 0, ambient: 20, elevation: 0, inventory: true, segments: 4, initialTemperature: 20 } },
  heatExchanger: { label: "Heat exchanger", category: "Hydraulic", description: "Two-stream ε-NTU heat exchanger (counter- or parallel-flow); each stream is a hydraulic branch with quadratic pressure loss; no wetted inventory", spec: "2 kW/K · counterflow", cost: 160, prefix: "HX", ports: [
    { id: "hotIn", domain: "hydraulic", label: "Stream A (hot) inlet" }, { id: "hotOut", domain: "hydraulic", label: "Stream A (hot) outlet" },
    { id: "coldIn", domain: "hydraulic", label: "Stream B (cold) inlet" }, { id: "coldOut", domain: "hydraulic", label: "Stream B (cold) outlet" },
  ], defaults: { ua: 2000, arrangement: "counterflow", diameter: 0.025, lossCoefficient: 10, laminarK: 1000, maxPressure: 1000000, elevation: 0 }, variants: [
    { id: "plate", label: "Plate heat exchanger 20 kW/K", cost: 950, spec: "20 kW/K · DN50 · 16 bar", overrides: { ua: 20000, diameter: 0.05, lossCoefficient: 15, maxPressure: 1600000 } },
    { id: "shellTube", label: "Shell-and-tube 100 kW/K", cost: 4200, spec: "100 kW/K · DN100", overrides: { ua: 100000, diameter: 0.1, lossCoefficient: 12, maxPressure: 1600000 } },
  ] },
  pressureReducingValve: { label: "Pressure-reducing valve", category: "Hydraulic", description: "Pilot-style regulator: integral action drives the opening until the outlet gauge pressure equals the setpoint; forward-only", spec: "2 bar setpoint · 5 s stroke", cost: 120, prefix: "PRV", ports: fluid, defaults: { pressureSetpoint: 200000, proportionalBand: 20000, responseTime: 5, diameter: 0.025, lossCoefficient: 8, laminarK: 1500, maxPressure: 1600000, elevation: 0 } },
  valve: { label: "Manual valve", category: "Hydraulic", description: "Quadratic loss K/opening²; exact isolation at zero opening", spec: "0–100% · bidirectional", cost: 14, prefix: "V", ports: fluid, defaults: valveDefaults },
  checkValve: { label: "Check valve", category: "Hydraulic", description: "Forward-only hydraulic branch with cracking pressure and reverse isolation", spec: "1 kPa cracking", cost: 18, prefix: "CV", ports: fluid, defaults: { ...valveDefaults, laminarK: 1500, crackingPressure: 1000 } },
  actuatedValve: { label: "Actuated valve", category: "Hydraulic", description: "Rate-limited ideal external actuator; numeric percent command, defined fail position; actuator supply power omitted", spec: "5 s full stroke", cost: 35, prefix: "AV", ports: [...fluid, input("position", "number", true)], defaults: { ...valveDefaults, responseTime: 5, failOpen: false } },
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
    description: "Inductance with series winding resistance: Z = R + jωL in AC networks; its winding resistance only in steady DC",
    spec: "10 mH · 0.1 Ω · 10 A",
    cost: 20,
    prefix: "L",
    ports: [...electric, heat],
    defaults: { inductance: 0.01, resistance: 0.1, ratedCurrent: 10, heatCapacity: 200, loss: 1, conductance: 5, maxTemperature: 150, tempCoefficient: 0.00393, tolerance: 0 },
  },
  capacitor: {
    label: "Capacitor",
    category: "Electrical",
    description: "Capacitance with series ESR: Z = ESR − j/(ωC) in AC networks; open circuit in steady DC (no charging transient is modelled)",
    spec: "100 µF · 450 V",
    cost: 12,
    prefix: "C",
    ports: electric,
    defaults: { capacitance: 0.0001, resistance: 0.05, ratedVoltage: 450, ratedCurrent: 20, heatCapacity: 50, loss: 0.5, maxTemperature: 85, tempCoefficient: 0, tolerance: 0 },
  },
  inductionMotor: {
    label: "Three-phase induction motor",
    category: "Electrical",
    description: "Squirrel-cage machine on a balanced three-phase supply: dynamic dq model (stator and rotor flux transients: inrush with DC offset, transient torque, residual flux) whose steady state is the per-phase equivalent circuit (R1, X1, Xm, R2/s, X2); copper losses; shaft drives pumps and spatial rotors",
    spec: "400 V 3~ · 7.5 kW · 4-pole",
    cost: 420,
    prefix: "IM",
    ports: [...electric, shaft, heat, input("enable", "boolean", true)],
    defaults: { ratedVoltage: 400, ratedFrequency: 50, poles: 4, ratedPower: 7500, ratedCurrent: 15, ratedTorque: 50, statorResistance: 0.75, statorReactance: 1.3, magnetizingReactance: 48, rotorResistance: 0.55, rotorReactance: 1.6, inertia: 0.045, friction: 0.002, loadTorque: 0, maxSpeed: 330, heatCapacity: 25000, loss: 18, conductance: 30, maxTemperature: 155, enabled: true },
    variants: [
      { id: "im45", label: "Induction motor 45 kW", cost: 2200, spec: "400 V 3~ · 45 kW · 4-pole", overrides: { ratedPower: 45000, ratedCurrent: 82, ratedTorque: 290, statorResistance: 0.07, statorReactance: 0.27, magnetizingReactance: 9, rotorResistance: 0.06, rotorReactance: 0.33, inertia: 0.38, friction: 0.01, heatCapacity: 150000, loss: 90 } },
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
  motor: p => +p.ratedPower, pump: p => +p.ratedFlow * +p.shutoffHead, tank: p => +p.capacity,
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
export const isSource = (c: Component) => c.kind === "source" || c.kind === "source3" || c.kind === "sourceAC";
/** Machines with a rotating shaft driven by the electrical network. */
export const isMotor = (c: Component) => c.kind === "motor" || c.kind === "inductionMotor";
export const isThermalMass = (c: Component) =>
  c.kind === "tank" || c.kind === "thermalMass" || (isElectrical(c) && !isSource(c));
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
    if (!motor || !['pump', 'rigidBody'].includes(load.kind)) return 'Connect a motor shaft to a pump or spatial rotor.';
    if (load.kind === 'rigidBody' && (!load.spatial || load.spatial.type !== 'dynamic' || load.spatial.fixedRotation)) return 'A spatial shaft needs a dynamic body with free rotation.';
    if (project.connections.some(w => w.domain === 'mechanical' && (w.from.component === load.id || w.to.component === load.id || ([w.from.component, w.to.component].includes(motor.id) && project.components.some(c => [w.from.component, w.to.component].includes(c.id) && c.kind === load.kind))))) return 'A shaft supports one motor, one pump and one spatial rotor; a load accepts one shaft.';
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
