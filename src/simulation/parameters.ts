/**
 * Engineering parameter metadata.
 *
 * Every editable component property is described here once: meaning, SI unit,
 * group, editing policy and the *physical/numerical validity domain*. The domain
 * is not an engineering rating. Ratings (rated power, current, pressure …) are
 * ordinary parameters whose violation produces warnings or modelled failures in
 * the engine; challenge restrictions live in integrity.ts / challenges.ts.
 */
import type { Component, Kind, Property } from "./model";

export type ParamGroup = "operating" | "configuration" | "ratings" | "thermal" | "initial" | "advanced";
/**
 * live    – conservation-safe; editable at any time, including while running.
 * reset   – defines stored energy, mass or initial state; editable only at t = 0.
 * derived – calculated from other parameters; shown read-only.
 * fixed   – a model constant of the implemented physics; not editable.
 */
export type EditPolicy = "live" | "reset" | "derived" | "fixed";
export interface ParamSpec {
  key: string;
  label: string;
  description: string;
  unit?: string;
  group: ParamGroup;
  policy: EditPolicy;
  /** Inclusive validity domain of the mathematical model or numerical envelope. */
  domain?: [number, number];
  /** Lower bound is exclusive (strictly positive quantities). */
  positive?: boolean;
  /** Why the domain exists; shown when a value is rejected. */
  limitReason?: string;
  /** Typical engineering range; outside it the Inspector shows a hint, never an error. */
  typical?: [number, number];
  /** Display conversion: shown = stored × scale. */
  display?: { unit: string; scale: number };
  options?: { value: string; label: string }[];
  /** False for informational metadata that does not enter any equation. */
  simulated?: boolean;
  derivedFrom?: string[];
}
type Base = Omit<ParamSpec, "key">;
const NUMERIC = "Finite numerical envelope of the solver (double-precision conditioning).";
const POSITIVE = "Must be strictly positive for the model to be defined.";
const ABSOLUTE_ZERO = -273.15;
const temperature = (label: string, description: string, group: ParamGroup = "thermal", policy: EditPolicy = "live"): Base => ({
  label, description, unit: "°C", group, policy, domain: [ABSOLUTE_ZERO, 10000], limitReason: "Temperature must be above absolute zero.",
});
const base: Record<string, Base> = {
  // — Spatial actuators (Planck rigid-body solver envelope, unchanged) —
  forceX: { label: "Force X", description: "External force applied at the body centre.", unit: "N", group: "operating", policy: "live", domain: [-100000, 100000], limitReason: "Rigid-body solver stability envelope." },
  forceY: { label: "Force Y", description: "External force applied at the body centre.", unit: "N", group: "operating", policy: "live", domain: [-100000, 100000], limitReason: "Rigid-body solver stability envelope." },
  appliedTorque: { label: "Applied torque", description: "External torque about the body centre.", unit: "N·m", group: "operating", policy: "live", domain: [-10000, 10000], limitReason: "Rigid-body solver stability envelope." },
  brakeDamping: { label: "Rotational brake", description: "Viscous rotational damping; dissipated work becomes heat.", unit: "N·m·s", group: "operating", policy: "live", domain: [0, 10000], limitReason: "Rigid-body solver stability envelope." },
  damping: { label: "Brake damping", description: "Viscous damping of the actuator; work dissipates as heat.", unit: "N·s/m", group: "operating", policy: "live", domain: [0, 10000], limitReason: "Rigid-body solver stability envelope." },
  maxForce: { label: "Actuator limit", description: "Saturation of the commanded actuator force or torque.", unit: "N", group: "ratings", policy: "live", domain: [0.01, 10000], limitReason: "Rigid-body solver stability envelope." },
  axis: { label: "Axis", description: "Measured or actuated axis.", group: "configuration", policy: "reset", options: [{ value: "x", label: "x" }, { value: "y", label: "y" }, { value: "torque", label: "torque" }] },
  value: { label: "Value", description: "Numeric output value.", group: "operating", policy: "live", domain: [-1e9, 1e9], limitReason: NUMERIC },
  enabled: { label: "Enabled", description: "Operating command. Disabled equipment is electrically or thermally inactive.", group: "operating", policy: "live" },
  // — Electrical sources —
  voltage: { label: "Voltage setpoint", description: "Output voltage setpoint (constant-voltage regulation, or compliance limit in constant-current mode). Cannot exceed the supply's maximum output voltage.", unit: "V", group: "operating", policy: "live", domain: [0, 1e6], limitReason: NUMERIC, typical: [0, 1000] },
  phase: { label: "Phase angle", description: "Phasor angle of the source voltage (0°, −120°, +120° for the three lines of a three-phase system).", unit: "°", group: "operating", policy: "live", domain: [-360, 360], limitReason: "Angle in degrees." },
  internalReactance: { label: "Internal reactance", description: "Series source reactance X at the source frequency (transformer leakage).", unit: "Ω", group: "configuration", policy: "live", domain: [0, 1e6], limitReason: NUMERIC },
  inductance: { label: "Inductance", description: "Self-inductance; reactance X = 2πfL in AC networks. Steady DC sees only the winding resistance (no L·di/dt transients).", unit: "H", group: "configuration", policy: "live", domain: [0, 1e3], positive: true, limitReason: POSITIVE },
  capacitance: { label: "Capacitance", description: "Reactance X = −1/(2πfC) in AC networks; open circuit in steady DC (no charging transients).", unit: "F", group: "configuration", policy: "live", domain: [0, 10], positive: true, limitReason: POSITIVE },
  ratedFrequency: { label: "Rated frequency", description: "Frequency at which the machine reactances are specified; reactances scale with the supply frequency.", unit: "Hz", group: "configuration", policy: "live", domain: [0, 1000], positive: true, limitReason: POSITIVE },
  poles: { label: "Poles", description: "Pole count p; synchronous speed n_s = 120·f/p.", unit: "1", group: "configuration", policy: "live", domain: [2, 64], limitReason: "Even pole count between 2 and 64." },
  statorResistance: { label: "Stator resistance R₁", description: "Per-phase (star-equivalent) stator winding resistance.", unit: "Ω", group: "configuration", policy: "live", domain: [0, 1e4], positive: true, limitReason: POSITIVE },
  statorReactance: { label: "Stator leakage X₁", description: "Per-phase stator leakage reactance at rated frequency.", unit: "Ω", group: "configuration", policy: "live", domain: [0, 1e4], limitReason: NUMERIC },
  magnetizingReactance: { label: "Magnetizing reactance Xm", description: "Per-phase magnetizing reactance at rated frequency (core loss neglected).", unit: "Ω", group: "configuration", policy: "live", domain: [0, 1e6], positive: true, limitReason: POSITIVE },
  rotorResistance: { label: "Rotor resistance R₂′", description: "Per-phase rotor resistance referred to the stator; sets slip and starting torque.", unit: "Ω", group: "configuration", policy: "live", domain: [0, 1e4], positive: true, limitReason: POSITIVE },
  rotorReactance: { label: "Rotor leakage X₂′", description: "Per-phase rotor leakage reactance referred to the stator at rated frequency.", unit: "Ω", group: "configuration", policy: "live", domain: [0, 1e4], limitReason: NUMERIC },
  lineVoltage: { label: "Line voltage (RMS)", description: "Line-to-line RMS voltage. The per-phase network uses V_LL/√3 phase-to-neutral; element powers are three-phase totals.", unit: "V", group: "operating", policy: "live", domain: [0, 1e6], limitReason: NUMERIC, typical: [100, 35000] },
  frequency: { label: "Frequency", description: "Supply frequency: sets inductor, capacitor and machine reactances (X = ωL, −1/ωC) and the induction-motor synchronous speed. All AC sources in one network must share it.", unit: "Hz", group: "configuration", policy: "live", domain: [0, 1e4], positive: true, limitReason: POSITIVE },
  current: { label: "Current setpoint", description: "Regulated output current in constant-current mode.", unit: "A", group: "operating", policy: "live", domain: [0, 1e6], limitReason: NUMERIC },
  mode: { label: "Mode", description: "Operating mode.", group: "configuration", policy: "live" },
  maxCurrent: { label: "Current limit / rating", description: "Ideal and internal-resistance modes: output protection trips above this current. Current-limited mode: the supply regulates to this current (CV→CC crossover).", unit: "A", group: "ratings", policy: "live", domain: [0, 1e9], positive: true, limitReason: POSITIVE },
  maxPower: { label: "Rated output power", description: "Continuous output power rating. Exceeding it is reported; no thermal model of the supply is simulated.", unit: "W", group: "ratings", policy: "live", domain: [0, 1e15], positive: true, limitReason: POSITIVE },
  internalResistance: { label: "Internal resistance", description: "Series source resistance. Terminal voltage sags as V − I·R; internal loss stays inside the supply (outside the energy boundary).", unit: "Ω", group: "configuration", policy: "live", domain: [0, 1e6], limitReason: NUMERIC },
  ratedVoltage: { label: "Rated voltage", description: "Nominal / maximum operating voltage.", unit: "V", group: "ratings", policy: "live", domain: [0, 1e6], positive: true, limitReason: POSITIVE },
  ratedCurrent: { label: "Rated current", description: "Continuous current rating.", unit: "A", group: "ratings", policy: "live", domain: [0, 1e9], positive: true, limitReason: POSITIVE },
  ratedPower: { label: "Power rating", description: "Continuous power rating. Operation above it is permitted and reported; failure follows from the modelled element temperature.", unit: "W", group: "ratings", policy: "live", domain: [0, 1e15], positive: true, limitReason: POSITIVE },
  // — Passive electrical / thermal elements —
  resistance: { label: "Resistance", description: "Nominal resistance at 20 °C.", unit: "Ω", group: "configuration", policy: "live", domain: [0, 1e12], positive: true, limitReason: POSITIVE, typical: [1e-4, 1e9] },
  tempCoefficient: { label: "Temperature coefficient", description: "Linear coefficient α: R(T) = R₂₀·(1 + α·(T − 20 °C)), evaluated at the element's simulated temperature.", unit: "1/K", group: "advanced", policy: "live", domain: [-0.1, 0.1], limitReason: "Linear model validity; resistance must stay positive at the simulated temperature." },
  tolerance: { label: "Tolerance", description: "Manufacturing tolerance band. The simulated part uses a fixed, reproducible deviation inside ±tolerance derived from its identity.", unit: "%", group: "advanced", policy: "live", domain: [0, 50], limitReason: "A deviation of more than ±50% is not a tolerance." },
  heatCapacity: { label: "Thermal capacity", description: "Lumped heat capacity of the element (C = m·c). Defines stored thermal energy.", unit: "J/K", group: "thermal", policy: "reset", domain: [0, 1e12], positive: true, limitReason: POSITIVE },
  loss: { label: "Ambient loss (UA)", description: "Thermal conductance from this body to ambient.", unit: "W/K", group: "thermal", policy: "live", domain: [0, 1e8], limitReason: NUMERIC },
  conductance: { label: "Contact conductance (UA)", description: "Thermal conductance through the thermal port.", unit: "W/K", group: "thermal", policy: "live", domain: [0, 1e8], positive: true, limitReason: POSITIVE },
  maxTemperature: temperature("Temperature limit", "Maximum operating temperature. Above it the element fails open (overtemperature).", "ratings"),
  closed: { label: "Switch state", description: "Contact closed (conducting) or open.", group: "operating", policy: "live" },
  tripTime: { label: "Trip delay", description: "Definite-time characteristic: the fuse opens after the current exceeds its rating continuously for this long.", unit: "s", group: "ratings", policy: "live", domain: [0, 1e4], positive: true, limitReason: POSITIVE },
  // — Pipe inventory, heat exchanger, regulator, pump data —
  inventory: { label: "Water inventory", description: "Pipe holds its water (ρ·A·L) in well-mixed cells: thermal transport delay and stored heat. Off = ideal zero-volume pipe.", group: "configuration", policy: "reset" },
  segments: { label: "Mixing cells", description: "Number of well-mixed cells along the pipe. More cells approach plug flow (sharper delay).", unit: "1", group: "advanced", policy: "reset", domain: [1, 50], limitReason: "Solver cost grows with cells; 50 approximates plug flow closely." },
  ua: { label: "Heat-transfer conductance UA", description: "Overall U·A of the exchanger surface; NTU = UA/C_min.", unit: "W/K", group: "configuration", policy: "live", domain: [0, 1e9], limitReason: NUMERIC },
  arrangement: { label: "Flow arrangement", description: "Counterflow or parallel-flow ε-NTU relation.", group: "configuration", policy: "live", options: [{ value: "counterflow", label: "Counterflow" }, { value: "parallel", label: "Parallel flow" }] },
  pressureSetpoint: { label: "Outlet pressure setpoint", description: "Downstream gauge pressure the regulator maintains (when the inlet pressure allows).", unit: "Pa", group: "operating", policy: "live", domain: [0, 1e9], limitReason: NUMERIC, display: { unit: "bar", scale: 1e-5 } },
  proportionalBand: { label: "Pilot band", description: "Pressure error that drives the valve at full stroke rate (integral regulator gain).", unit: "Pa", group: "advanced", policy: "live", domain: [0, 1e9], positive: true, limitReason: POSITIVE, display: { unit: "bar", scale: 1e-5 } },
  curvePoints: { label: "Head curve points", description: "Optional measured curve at rated speed as flow:head pairs in L/min:m, e.g. \"0:8; 30:7; 60:4; 75:0\". Empty = quadratic model from shutoff head and rated flow. Affinity laws scale it with speed.", group: "configuration", policy: "live" },
  npshRequired: { label: "NPSH required", description: "Required net positive suction head at rated flow (scales with flow²). A warning is logged when the available NPSH is lower; cavitation performance loss is not modelled. 0 = no check.", unit: "m", group: "ratings", policy: "live", domain: [0, 1000], limitReason: NUMERIC },
  // — Protective breakers —
  thermalTimeConstant: { label: "Thermal time constant", description: "Time constant τ of the bimetal thermal image θ: dθ/dt = ((I/In)² − θ)/τ. Trips at θ ≥ 1.3² (conventional tripping current 1.3 In); cools with the same τ.", unit: "s", group: "ratings", policy: "live", domain: [0, 1e5], positive: true, limitReason: POSITIVE },
  tripClass: { label: "Trip class", description: "IEC 60947-4-1 class: trip time at 7.2 × setting from cold (10, 20, 30 s). Sets the thermal-image time constant; trip threshold 1.12 × setting.", unit: "s", group: "ratings", policy: "live", domain: [0, 1e4], positive: true, limitReason: POSITIVE, typical: [2, 40] },
  magneticTrip: { label: "Magnetic trip", description: "Instantaneous trip at this multiple of the rated current (B 3–5, C 5–10, D 10–20, motor 12–14).", unit: "× In", group: "ratings", policy: "live", domain: [1, 1e4], limitReason: "The magnetic threshold must be at least the rated current." },
  breakingCapacity: { label: "Breaking capacity", description: "Largest current the device can interrupt. A trip above it is reported; arc and destruction are not modelled.", unit: "A", group: "ratings", policy: "live", domain: [0, 1e9], positive: true, limitReason: POSITIVE, display: { unit: "kA", scale: 1e-3 } },
  // — Cable —
  material: { label: "Material", description: "Material.", group: "configuration", policy: "live" },
  area: { label: "Cross-section", description: "Conductor cross-sectional area.", unit: "mm²", group: "configuration", policy: "live", domain: [0, 1e5], positive: true, limitReason: POSITIVE, typical: [0.1, 1000] },
  length: { label: "Length", description: "Physical length.", unit: "m", group: "configuration", policy: "live", domain: [0, 1e6], positive: true, limitReason: POSITIVE },
  // — Thermal vessel —
  volume: { label: "Initial water volume", description: "Water inventory at reset. Independent of capacity.", unit: "L", group: "initial", policy: "reset", domain: [0, 1e9], limitReason: NUMERIC },
  capacity: { label: "Tank capacity", description: "Geometric vessel capacity (overflow boundary).", unit: "L", group: "configuration", policy: "reset", domain: [0, 1e9], positive: true, limitReason: POSITIVE },
  initialTemperature: { label: "Initial temperature", description: "Water temperature at reset.", unit: "°C", group: "initial", policy: "reset", domain: [1, 95], limitReason: "Liquid-water model: constant properties, no freezing, boiling or evaporation (1–95 °C)." },
  ambient: { label: "Ambient temperature", description: "Temperature of the surroundings that exchange heat with this body.", unit: "°C", group: "thermal", policy: "live", domain: [-100, 500], limitReason: "Environmental boundary envelope." },
  weirLength: { label: "Overflow weir length", description: "Crest length of the overflow (rim or standpipe circumference). A full tank's surface rises h above the rim and discharges Q = ⅔·C_d·√(2g)·L·h^1.5 (C_d = 0.62, free overfall), into the overflow port's network if connected, else out of the system.", unit: "m", group: "configuration", policy: "live", domain: [0, 1000], positive: true, limitReason: POSITIVE },
  vesselHeatCapacity: { label: "Vessel thermal mass", description: "Heat capacity of the vessel wall, lumped at the water temperature (e.g. 50 kg steel ≈ 25 kJ/K).", unit: "J/K", group: "thermal", policy: "reset", domain: [0, 1e12], limitReason: NUMERIC },
  lossModel: { label: "Heat-loss model", description: "Explicit UA, or UA derived from cylindrical geometry and insulation.", group: "thermal", policy: "live", options: [{ value: "manual", label: "Explicit UA" }, { value: "insulation", label: "Derived from insulation" }] },
  insulationThickness: { label: "Insulation thickness", description: "Uniform insulation on walls, base and lid.", unit: "m", group: "thermal", policy: "live", domain: [0, 10], limitReason: "Thin-wall conduction model.", display: { unit: "mm", scale: 1000 } },
  insulationConductivity: { label: "Insulation conductivity", description: "Thermal conductivity of the insulation (mineral wool ≈ 0.04 W/m·K).", unit: "W/m·K", group: "thermal", policy: "live", domain: [0, 1000], positive: true, limitReason: POSITIVE },
  density: { label: "Water density", description: "Constant-density water model.", unit: "kg/m³", group: "advanced", policy: "fixed", domain: [1000, 1000], limitReason: "Only constant-density water is modelled." },
  vented: { label: "Vented tank", description: "Free surface at atmospheric pressure. Sealed vessels need a gas-headspace model that is not implemented.", group: "advanced", policy: "fixed" },
  surfaceArea: { label: "Free-surface area", description: "Horizontal cross-section (cylindrical vessel footprint). Sets level and hydrostatic pressure.", unit: "m²", group: "configuration", policy: "reset", domain: [0, 1e6], positive: true, limitReason: POSITIVE },
  elevation: { label: "Elevation", description: "Base / port elevation. Defines gravitational potential.", unit: "m", group: "configuration", policy: "reset", domain: [-1000, 10000], limitReason: NUMERIC },
  maxPressure: { label: "Pressure rating", description: "Maximum operating gauge pressure. Exceeding it is reported as a rating violation; burst/leak is not modelled.", unit: "Pa", group: "ratings", policy: "live", domain: [0, 1e10], positive: true, limitReason: POSITIVE, display: { unit: "bar", scale: 1e-5 } },
  // — Hydraulic —
  diameter: { label: "Internal diameter", description: "Hydraulic internal diameter.", unit: "m", group: "configuration", policy: "live", domain: [0, 10], positive: true, limitReason: POSITIVE, display: { unit: "mm", scale: 1000 } },
  roughness: { label: "Surface roughness", description: "Absolute wall roughness for the Swamee–Jain friction factor.", unit: "m", group: "advanced", policy: "live", domain: [0, 0.1], limitReason: "Colebrook-type correlations need ε/D < 0.05.", display: { unit: "µm", scale: 1e6 } },
  conductivity: { label: "Wall conductivity", description: "Informational material property. Not used: pipe heat loss is the explicit UA.", unit: "W/m·K", group: "advanced", policy: "live", domain: [0, 1e4], simulated: false },
  insulation: { label: "Insulation fraction", description: "Informational. Not used: pipe heat loss is the explicit UA.", unit: "1", group: "advanced", policy: "live", domain: [0, 1], simulated: false },
  thermalUA: { label: "Pipe heat loss (UA)", description: "Total conductance from the flowing water to ambient.", unit: "W/K", group: "thermal", policy: "live", domain: [0, 1e8], limitReason: NUMERIC },
  opening: { label: "Valve opening", description: "Commanded opening. K grows as 1/opening².", unit: "%", group: "operating", policy: "live", domain: [0, 100], limitReason: "Percentage." },
  lossCoefficient: { label: "Loss coefficient K", description: "Fully-open minor-loss coefficient referenced to the bore velocity.", unit: "1", group: "configuration", policy: "live", domain: [0, 1e7], positive: true, limitReason: POSITIVE },
  laminarK: { label: "Laminar coefficient K₁", description: "Hooper two-K low-Reynolds term: K(Re) = K₁/Re + K∞. Typical K₁: ball/gate 300–500, globe/regulator 1500, swing check 1500. Uses the viscosity of the upstream water.", unit: "1", group: "advanced", policy: "live", domain: [0, 1e7], limitReason: NUMERIC },
  crackingPressure: { label: "Cracking pressure", description: "Forward pressure difference needed to open.", unit: "Pa", group: "configuration", policy: "live", domain: [0, 1e8], limitReason: NUMERIC, display: { unit: "kPa", scale: 1e-3 } },
  responseTime: { label: "Full stroke time", description: "Rate-limited actuator travel time 0→100%.", unit: "s", group: "configuration", policy: "live", domain: [0, 1e5], positive: true, limitReason: POSITIVE },
  failOpen: { label: "Fail open", description: "Position on loss of command signal.", group: "configuration", policy: "live" },
  ratedSpeed: { label: "Rated pump speed", description: "Reference speed of the head/flow curve (affinity laws scale from here).", unit: "rad/s", group: "configuration", policy: "live", domain: [0, 1e5], positive: true, limitReason: POSITIVE, display: { unit: "RPM", scale: 30 / Math.PI } },
  ratedFlow: { label: "Rated pump flow", description: "Reference flow at rated speed (head = 50% of shutoff).", unit: "m³/s", group: "configuration", policy: "live", domain: [0, 100], positive: true, limitReason: POSITIVE, display: { unit: "L/min", scale: 60000 } },
  shutoffHead: { label: "Shutoff head", description: "Zero-flow head at rated speed.", unit: "m", group: "configuration", policy: "live", domain: [0, 1e4], positive: true, limitReason: POSITIVE },
  efficiency: { label: "Peak hydraulic efficiency", description: "Best-efficiency-point efficiency; the curve falls off away from rated flow (floor 15%).", unit: "1", group: "configuration", policy: "live", domain: [0.01, 1], limitReason: "Efficiency is a fraction ≤ 1." },
  mechanicalDrag: { label: "Pump drag coefficient", description: "Windage/disc friction torque coefficient (P = k·ω³).", unit: "W·s³", group: "advanced", policy: "live", domain: [0, 1e3], limitReason: NUMERIC },
  // — Motor —
  torqueConstant: { label: "Torque constant kₜ", description: "Torque per armature ampere. In SI the back-EMF constant is identical.", unit: "N·m/A", group: "configuration", policy: "live", domain: [0, 1000], positive: true, limitReason: POSITIVE },
  emfConstant: { label: "Back-EMF constant kₑ", description: "Equal to kₜ in SI units (energy consistency).", unit: "V·s/rad", group: "configuration", policy: "derived", derivedFrom: ["torqueConstant"] },
  inertia: { label: "Rotor inertia", description: "Rotor moment of inertia; defines stored kinetic energy.", unit: "kg·m²", group: "configuration", policy: "reset", domain: [0, 1e6], positive: true, limitReason: POSITIVE },
  friction: { label: "Viscous friction", description: "Bearing friction torque per rad/s; dissipated as winding heat.", unit: "N·m·s", group: "advanced", policy: "live", domain: [0, 1e4], limitReason: NUMERIC },
  loadTorque: { label: "External shaft load", description: "Constant opposing torque that exports work from the shaft.", unit: "N·m", group: "operating", policy: "live", domain: [0, 1e7], limitReason: NUMERIC },
  ratedTorque: { label: "Rated torque", description: "Continuous torque rating (overload is reported).", unit: "N·m", group: "ratings", policy: "live", domain: [0, 1e8], positive: true, limitReason: POSITIVE },
  maxSpeed: { label: "Maximum speed", description: "Mechanical speed limit (exceeding it is reported).", unit: "rad/s", group: "ratings", policy: "live", domain: [0, 1e5], positive: true, limitReason: POSITIVE, display: { unit: "RPM", scale: 30 / Math.PI } },
  speedControl: { label: "Enable speed command", description: "Ideal PWM drive follows the speed command.", group: "operating", policy: "live" },
  speedCommand: { label: "Motor speed command", description: "Speed command of the ideal PWM drive.", unit: "RPM", group: "operating", policy: "live", domain: [0, 1e6], limitReason: NUMERIC },
  // — Sensors & automation —
  target: { label: "Physical target", description: "Component whose physical state is measured or actuated.", group: "configuration", policy: "reset" },
  minRange: { label: "Minimum reading", description: "Lower measurement range; readings below are invalid.", group: "configuration", policy: "live", domain: [-1e12, 1e12], limitReason: NUMERIC },
  maxRange: { label: "Maximum reading", description: "Upper measurement range; readings above are invalid.", group: "configuration", policy: "live", domain: [-1e12, 1e12], limitReason: NUMERIC },
  resolution: { label: "Resolution", description: "Quantization step of the output.", group: "advanced", policy: "live", domain: [0, 1e9], positive: true, limitReason: POSITIVE },
  lag: { label: "Measurement lag", description: "First-order time constant (exact exponential update).", unit: "s", group: "advanced", policy: "live", domain: [0, 1e6], limitReason: NUMERIC },
  noise: { label: "Noise amplitude", description: "Uniform seeded noise ± amplitude, one draw per solver step.", group: "advanced", policy: "live", domain: [0, 1e9], limitReason: NUMERIC },
  sampleInterval: { label: "Sampling interval", description: "Zero-order hold: the output updates every interval (0 = every solver step).", unit: "s", group: "advanced", policy: "live", domain: [0, 1e6], limitReason: NUMERIC },
  reference: { label: "Reference", description: "Comparison or regulation reference.", group: "operating", policy: "live", domain: [-1e12, 1e12], limitReason: NUMERIC },
  feedforward: { label: "Feedforward output", description: "Constant output added before limiting.", group: "operating", policy: "live", domain: [-1e12, 1e12], limitReason: NUMERIC },
  kp: { label: "Proportional gain", description: "Output per unit error.", group: "operating", policy: "live", domain: [-1e9, 1e9], limitReason: NUMERIC },
  ki: { label: "Integral gain", description: "Output per unit error·second.", group: "operating", policy: "live", domain: [-1e9, 1e9], limitReason: NUMERIC },
  minOutput: { label: "Minimum output", description: "Lower output clamp (anti-windup aware).", group: "operating", policy: "live", domain: [-1e12, 1e12], limitReason: NUMERIC },
  maxOutput: { label: "Maximum output", description: "Upper output clamp (anti-windup aware).", group: "operating", policy: "live", domain: [-1e12, 1e12], limitReason: NUMERIC },
  kd: { label: "Derivative gain", description: "Output per unit (measurement rate). Derivative acts on the measurement, not the error (no setpoint kick).", group: "operating", policy: "live", domain: [-1e9, 1e9], limitReason: NUMERIC },
  derivativeFilter: { label: "Derivative filter", description: "First-order filter time constant of the derivative term.", unit: "s", group: "advanced", policy: "live", domain: [0, 1e6], positive: true, limitReason: POSITIVE },
  gain: { label: "Gain", description: "Multiplier k in y = k·x + b.", group: "operating", policy: "live", domain: [-1e12, 1e12], limitReason: NUMERIC },
  offset: { label: "Offset", description: "Constant b in y = k·x + b (output units).", group: "operating", policy: "live", domain: [-1e12, 1e12], limitReason: NUMERIC },
  timeConstant: { label: "Time constant", description: "Filter time constant τ (exact exponential update).", unit: "s", group: "operating", policy: "live", domain: [0, 1e8], positive: true, limitReason: POSITIVE },
  rate: { label: "Maximum rate", description: "Largest output change per second.", unit: "units/s", group: "operating", policy: "live", domain: [0, 1e12], positive: true, limitReason: POSITIVE },
  low: { label: "ON below", description: "Demand switches on below this input value.", group: "operating", policy: "live", domain: [-1e12, 1e12], limitReason: NUMERIC },
  high: { label: "OFF at or above", description: "Demand switches off at or above this input value.", group: "operating", policy: "live", domain: [-1e12, 1e12], limitReason: NUMERIC },
  initialOn: { label: "Initial output", description: "Controller memory at reset.", group: "initial", policy: "reset" },
  setpoint: temperature("Setpoint", "Switch-off temperature; demand resumes below setpoint − hysteresis.", "operating"),
  hysteresis: { label: "Hysteresis band", description: "Width of the switching band.", unit: "K", group: "operating", policy: "live", domain: [0, 1e4], positive: true, limitReason: POSITIVE },
  delay: { label: "Delay", description: "Timer duration on the simulation clock.", unit: "s", group: "operating", policy: "live", domain: [0, 1e8], positive: true, limitReason: POSITIVE },
  threshold: temperature("Safety cutoff", "Trip temperature of the independent sensing path.", "ratings"),
  resetMargin: { label: "Reset margin", description: "Manual reset permitted below threshold − margin.", unit: "K", group: "ratings", policy: "live", domain: [0, 1e4], positive: true, limitReason: POSITIVE },
  failOnSensor: { label: "Trip on sensor fault", description: "Fail-safe trip when the measurement is invalid.", group: "ratings", policy: "live" },
};
const options = {
  sourceMode: [
    { value: "ideal", label: "Ideal voltage source (trip above current rating)" },
    { value: "internal", label: "Voltage source with internal resistance" },
    { value: "cvcc", label: "Current-limited supply (CV / CC)" },
    { value: "cc", label: "Constant-current source (voltage compliance)" },
  ],
  timer: [{ value: "onDelay", label: "On-delay (TON)" }, { value: "offDelay", label: "Off-delay (TOF)" }, { value: "pulse", label: "Pulse" }],
  comparator: [{ value: "lt", label: "<" }, { value: "lte", label: "≤" }, { value: "gt", label: ">" }, { value: "gte", label: "≥" }],
  conductor: [{ value: "copper", label: "Copper" }, { value: "aluminium", label: "Aluminium" }],
  pipeMaterial: [{ value: "steel", label: "Commercial steel (ε 45 µm)" }, { value: "stainless", label: "Stainless steel (ε 15 µm)" }, { value: "copper", label: "Copper (ε 1.5 µm)" }, { value: "pvc", label: "PVC / PE (ε 1.5 µm)" }, { value: "castIron", label: "Cast iron (ε 260 µm)" }, { value: "concrete", label: "Concrete (ε 1 mm)" }],
};
const overrides: Partial<Record<Kind, Record<string, Partial<ParamSpec>>>> = {
  source: {
    ratedVoltage: { label: "Maximum output voltage", description: "Highest voltage the supply can produce; the setpoint cannot exceed it." },
    mode: { label: "Source behaviour", description: "Ideal: perfect regulation, protective trip above the current rating. Internal resistance: Thevenin source. CV/CC: regulates voltage until the current limit, then current. Constant current: regulates current until the voltage compliance limit.", options: options.sourceMode },
    enabled: { label: "Output enabled", description: "Disabled output is electrically open." },
  },
  sourceAC: {
    voltage: { label: "RMS voltage", description: "RMS magnitude of the source phasor." },
    ratedVoltage: { label: "Maximum RMS voltage" },
    maxCurrent: { label: "Current rating", description: "Output protection trips above this RMS current." },
    maxPower: { label: "Rated apparent power", description: "Reported when the real power exceeds it." },
  },
  capacitor: { resistance: { label: "ESR", description: "Equivalent series resistance (dielectric and lead loss)." }, ratedCurrent: { label: "Ripple current rating" } },
  inductor: { resistance: { label: "Winding resistance" } },
  inductionMotor: {
    ratedVoltage: { label: "Rated line voltage", group: "ratings" },
    ratedPower: { label: "Rated shaft power", description: "Nameplate output (reported when the electrical input far exceeds it)." },
    loadTorque: { description: "Constant opposing torque that exports work from the shaft." },
    heatCapacity: { label: "Winding thermal mass" },
    maxTemperature: { label: "Insulation temperature limit", description: "Class F 155 °C; above it the motor fails open." },
    conductance: { label: "Frame conductance (UA)" },
    enabled: { label: "Contactor closed", description: "Used when the enable input is not wired." },
  },
  source3: {
    maxCurrent: { label: "Line current rating", description: "Output protection trips above this RMS line current." },
    maxPower: { label: "Rated apparent power", description: "Three-phase rating √3·V_LL·I_L (reported when exceeded)." },
    internalResistance: { label: "Source resistance per phase", description: "Per-phase series resistance of the supply (transformer/cable short-circuit resistance)." },
    enabled: { label: "Output enabled" },
  },
  heater: {
    ratedVoltage: { label: "Nominal voltage", description: "Design voltage of the element (line voltage for a three-phase bank). With nominal power it defines R = V²/P — the element resistance on DC/single phase, or the star-equivalent resistance per phase on a three-phase supply. A different supply voltage gives a different actual power.", group: "configuration" },
    ratedPower: { label: "Nominal heating power", description: "Power at nominal voltage. Not enforced: actual power is V²/R of the actual circuit. Operation above it is reported; failure follows from element temperature.", group: "configuration", typical: [10, 1e6] },
    resistance: { policy: "derived", derivedFrom: ["ratedVoltage", "ratedPower"], description: "Element resistance R = V²ₙₒₘ / Pₙₒₘ (derived, not independent)." },
    conductance: { label: "Immersion conductance (UA)", description: "Element-to-water heat-transfer conductance h·A." },
    heatCapacity: { label: "Element thermal mass" },
    loss: { description: "Loss from the element directly to ambient (dry or exposed surface)." },
    maxTemperature: { label: "Element temperature limit", description: "Sheath temperature at which the element burns out (fails open)." },
  },
  motor: {
    resistance: { label: "Armature resistance", description: "Winding resistance; I²R heats the winding thermal mass." },
    ratedVoltage: { description: "Nominal armature voltage; also the reference of the ideal PWM speed drive." },
    heatCapacity: { label: "Winding thermal mass" },
    maxTemperature: { label: "Winding temperature limit", description: "Insulation class limit; above it the motor fails open." },
    ratedPower: { description: "Continuous electrical input rating (overload is reported; heating follows from I²R)." },
    conductance: { label: "Frame conductance (UA)", description: "Conductance from the winding through the motor's thermal port (used only when connected)." },
  },
  thermalMass: {
    heatCapacity: { label: "Heat capacity", description: "m·c of the body (aluminium 900, steel 470, copper 385 J/kg·K)." },
    loss: { label: "Loss to ambient (UA)", description: "Convection/radiation conductance to the laboratory ambient (heat-sink rating 1/R_th)." },
    conductance: { label: "Contact conductance (UA)", description: "Conductance of this body's thermal port (mounting surface). A link uses the series combination of both ports." },
    initialTemperature: { label: "Initial temperature", domain: [-273.15, 5000], limitReason: "Above absolute zero; lumped solid model.", description: "Body temperature at reset." },
    maxTemperature: { label: "Temperature limit", description: "Exceeding it is reported (no melting model)." },
  },
  resistor: { conductance: { label: "Mounting conductance (UA)", description: "Conductance from the resistor body through its thermal port (used only when the port is connected, in series with the other port)." } },
  cable: {
    conductance: { label: "Port conductance (UA)", description: "Conductance from the conductor through its thermal port, e.g. to a duct or tray modelled as a thermal mass." },
    material: { label: "Conductor material", description: "Sets resistivity (Cu 1.724e-8, Al 2.82e-8 Ω·m at 20 °C), α and density. Changes conductor thermal mass, so it is set before the run.", options: options.conductor, policy: "reset" },
    area: { policy: "reset", description: "Conductor cross-section. Changes resistance and conductor thermal mass, so it is set before the run." },
    length: { label: "Conductor length", description: "Length of the modelled conductor path. For a two-wire circuit, place a cable in each leg or use the loop length.", policy: "reset" },
    ratedCurrent: { label: "Ampacity", description: "Installation-dependent continuous current. The ambient loss UA is calibrated so that this current reaches the insulation limit at 30 °C ambient.", group: "ratings" },
    maxTemperature: { label: "Insulation temperature limit", description: "PVC 70 °C, XLPE/EPR 90 °C. Exceeding it is reported; insulation ageing/fire is not modelled." },
    resistance: { policy: "derived", derivedFrom: ["material", "area", "length"], description: "R₂₀ = ρ·L/A." },
    heatCapacity: { policy: "derived", derivedFrom: ["material", "area", "length"], label: "Conductor thermal mass", description: "Conductor mass × specific heat (insulation mass neglected)." },
    loss: { policy: "derived", derivedFrom: ["ratedCurrent", "maxTemperature", "resistance"], description: "Calibrated from ampacity: UA = I²ᵣ·R(Tmax)/(Tmax − 30 °C)." },
    tempCoefficient: { policy: "derived", derivedFrom: ["material"] },
  },
  tank: {
    loss: { label: "Ambient loss (UA)", description: "Total conductance from water to ambient. Derived when the insulation model is selected." },
    maxPressure: { description: "Hydrostatic pressure rating at the bottom port." },
  },
  pipe: {
    initialTemperature: { description: "Temperature of the water held in the pipe at reset (used when water inventory is on)." },
    material: { label: "Pipe material", description: "Selecting a material applies its typical roughness. Material does not otherwise enter the model.", options: options.pipeMaterial },
    ambient: { description: "Ambient temperature for the pipe heat-loss UA." },
  },
  cooler: {
    conductance: { label: "Cooling conductance (UA)", description: "Conductance to an ideal coolant reservoir (no coolant mass or pump power)." },
    ambient: { label: "Coolant temperature", domain: [-200, 1000] },
    enabled: { description: "Used when the control input is not wired." },
  },
  timer: { mode: { label: "Timer mode", options: options.timer } },
  selector: { mode: { label: "Selection", options: [{ value: "min", label: "Minimum of inputs" }, { value: "max", label: "Maximum of inputs" }, { value: "switch", label: "Switch: select ? in2 : in" }] } },
  limiter: { minOutput: { label: "Minimum" }, maxOutput: { label: "Maximum" } },
  comparator: { mode: { label: "Comparison", options: options.comparator } },
  constant: { value: { label: "Signal value", description: "Constant numeric output." } },
  forceActuator: { value: { label: "Commanded force / torque", domain: [-1e6, 1e6], description: "Used when the control input is not wired." } },
  fuse: { ratedCurrent: { description: "Rated current; above it the definite-time trip runs." } },
  breaker: { ratedCurrent: { label: "Rated current In", description: "Thermal trip reference current." }, closed: { label: "Handle closed", description: "Manual operating handle. A trip opens the breaker until it is reset after cooling." }, resistance: { label: "Contact resistance" } },
  motorProtector: { ratedCurrent: { label: "Overload setting Ir", description: "Set to the motor full-load current." }, closed: { label: "Handle closed", description: "Manual operating handle." }, resistance: { label: "Contact resistance" } },
  relay: { ratedCurrent: { label: "Contact current rating" }, ratedVoltage: { label: "Contact voltage rating" }, resistance: { label: "Contact resistance" } },
  safety: { ratedCurrent: { label: "Contact current rating" }, ratedVoltage: { label: "Contact voltage rating" }, resistance: { label: "Contact resistance" } },
  switch: { resistance: { label: "Contact resistance" } },
  meter: { resistance: { label: "Input resistance", description: "Instrument loading resistance." } },
  lamp: { resistance: { label: "Filament resistance", description: "Constant (hot) filament resistance." } },
  hysteresis: { low: { description: "Demand on below this value (input signal units)." }, high: { description: "Demand off at or above this value (input signal units)." } },
};
/** Engineering units for control-signal fields depend on the wired signal. */
const signalUnitKeys = new Set(["low", "high", "reference", "resolution", "noise", "minRange", "maxRange", "value", "feedforward", "minOutput", "maxOutput"]);
export function paramSpec(kind: Kind, key: string): ParamSpec | undefined {
  const b = base[key];
  if (!b) return undefined;
  const spec: ParamSpec = { key, ...b, ...overrides[kind]?.[key] };
  if (kind === "sensor" || kind === "thermostat" || kind === "safety") {
    if (["minRange", "maxRange", "resolution", "noise"].includes(key)) spec.unit = key === "resolution" || key === "noise" ? "K" : "°C";
  } else if (signalUnitKeys.has(key) && !spec.unit) spec.unit = "signal unit";
  return spec;
}
export const knownParameter = (key: string) => key in base;
/** Kinds whose temperature limit has no failure model: exceeding it is a warning. */
export const warnOnlyTemperature = new Set<Kind>(["cable", "thermalMass"]);

export function domainError(kind: Kind, key: string, value: Property): string | null {
  const spec = paramSpec(kind, key);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return `${spec?.label ?? key} must be a finite number.`;
    const d = spec?.domain;
    if (d && (value < d[0] || value > d[1] || (spec?.positive && value <= 0)))
      return `${spec?.label ?? key} is out of range: it must be ${spec?.positive ? `> ${d[0]}` : `≥ ${d[0]}`} and ≤ ${d[1]} ${spec?.unit ?? ""}. ${spec?.limitReason ?? ""}`.replace(/\s+/g, " ").trim();
  }
  if (typeof value === "string" && spec?.options && !spec.options.some((o) => o.value === value)) return `Unknown ${spec.label.toLowerCase()}.`;
  return null;
}

// ---------- Derived relationships ----------
export const conductors = {
  copper: { resistivity: 1.724e-8, alpha: 0.00393, density: 8960, specificHeat: 385 },
  aluminium: { resistivity: 2.82e-8, alpha: 0.00403, density: 2700, specificHeat: 897 },
} as const;
export const pipeRoughness: Record<string, number> = { steel: 0.000045, stainless: 0.000015, copper: 0.0000015, pvc: 0.0000015, castIron: 0.00026, concrete: 0.001 };
/** Approximate PVC-insulated single conductor in free air, 30 °C ambient. */
export const cableAmpacity = (areaMm2: number) => 13.5 * areaMm2 ** 0.625;
export const FILM_COEFFICIENT = 10; // W/m²K, combined outer convection + radiation
/** Cylindrical vessel: footprint A, height = capacity / A. */
export function vesselGeometry(capacityL: number, footprint: number) {
  const height = capacityL / 1000 / footprint, radius = Math.sqrt(footprint / Math.PI);
  return { height, radius, wallArea: 2 * footprint + 2 * Math.PI * radius * height };
}
const num = (props: Record<string, Property>, key: string, fallback = 0) => typeof props[key] === "number" ? props[key] as number : fallback;
/**
 * Recompute derived properties so that dependent values never contradict their
 * inputs. Returns a new props object; inputs are never silently adjusted.
 */
export function applyDerived(kind: Kind, props: Record<string, Property>): Record<string, Property> {
  const p = { ...props };
  if (kind === "heater" && num(p, "ratedVoltage") > 0 && num(p, "ratedPower") > 0) p.resistance = num(p, "ratedVoltage") ** 2 / num(p, "ratedPower");
  if (kind === "motor" && typeof p.torqueConstant === "number") p.emfConstant = p.torqueConstant;
  if (kind === "cable") {
    const m = conductors[(p.material as keyof typeof conductors)] ?? conductors.copper;
    const area = num(p, "area", 2.5) * 1e-6, length = num(p, "length", 10);
    p.tempCoefficient = m.alpha;
    p.resistance = m.resistivity * length / area;
    p.heatCapacity = m.density * area * length * m.specificHeat;
    const tmax = num(p, "maxTemperature", 70), hot = (p.resistance as number) * (1 + m.alpha * (tmax - 20));
    p.loss = tmax > 30 ? num(p, "ratedCurrent") ** 2 * hot / (tmax - 30) : 0;
  }
  if (kind === "tank" && p.lossModel === "insulation") {
    const g = vesselGeometry(num(p, "capacity", 20), num(p, "surfaceArea", 0.1));
    const thickness = num(p, "insulationThickness"), k = num(p, "insulationConductivity", 0.04);
    p.loss = g.wallArea / (1 / FILM_COEFFICIENT + (k > 0 ? thickness / k : 0));
  }
  return p;
}
/** Side effects of editing one key that are part of its definition (e.g. a material preset). */
export function editEffects(kind: Kind, key: string, value: Property): Record<string, Property> {
  if (kind === "pipe" && key === "material" && typeof value === "string" && value in pipeRoughness) return { roughness: pipeRoughness[value] };
  if (kind === "cable" && key === "area" && typeof value === "number" && value > 0) return { ratedCurrent: Math.round(cableAmpacity(value) * 10) / 10 };
  return {};
}
export function derivedError(c: Component): string | null {
  const expected = applyDerived(c.kind, c.props);
  for (const [k, v] of Object.entries(expected)) {
    const actual = c.props[k];
    if (typeof v === "number" && typeof actual === "number" && Math.abs(v - actual) > 1e-9 * Math.max(1, Math.abs(v)))
      return `${c.name}: ${paramSpec(c.kind, k)?.label ?? k} contradicts its defining parameters.`;
  }
  return null;
}
/** Deterministic deviation in [-1, 1] from a component identity (manufactured sample). */
export function sampleDeviation(id: string) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) / 4294967295) * 2 - 1;
}
/** Actual resistance including tolerance sample and linear temperature dependence. */
export function actualResistance(c: Component, temperature = 20) {
  const r0 = num(c.props, "resistance", 1) * (1 + num(c.props, "tolerance") / 100 * (num(c.props, "tolerance") ? sampleDeviation(c.id) : 0));
  const alpha = num(c.props, "tempCoefficient");
  return alpha ? r0 * (1 + alpha * (temperature - 20)) : r0;
}

// ---------- Engineering readouts (calculated, never editable) ----------
export interface Readout { label: string; value: number; unit: string; note?: string }
export function derivedReadouts(c: Component): Readout[] {
  const p = c.props, n = (k: string, f = 0) => num(p, k, f);
  switch (c.kind) {
    case "heater": return [
      { label: "Element resistance", value: n("resistance"), unit: "Ω", note: "V²ₙₒₘ/Pₙₒₘ" },
      { label: "Rated current", value: n("ratedPower") / n("ratedVoltage"), unit: "A", note: "Pₙₒₘ/Vₙₒₘ" },
      { label: "Element rise at rating", value: n("ratedPower") / n("conductance"), unit: "K", note: "above water, Pₙₒₘ/UA" },
      { label: "Element time constant", value: n("heatCapacity") / Math.max(1e-12, n("conductance") + n("loss")), unit: "s" },
    ];
    case "source": return [
      { label: "Output capability", value: n("ratedVoltage") * n("maxCurrent"), unit: "W", note: "Vmax × Ilimit" },
      ...(n("internalResistance") > 0 ? [{ label: "Short-circuit current", value: n("voltage") / n("internalResistance"), unit: "A", note: "V/Rᵢ (ideal/internal modes)" }] : []),
    ];
    case "resistor": case "lamp": return [
      { label: "Rated current", value: Math.sqrt(n("ratedPower") / n("resistance")), unit: "A", note: "√(P/R)" },
      { label: "Rated voltage", value: Math.sqrt(n("ratedPower") * n("resistance")), unit: "V", note: "√(P·R)" },
      ...(n("loss") > 0 ? [{ label: "Rise at rated power", value: n("ratedPower") / n("loss"), unit: "K" }, { label: "Thermal time constant", value: n("heatCapacity") / n("loss"), unit: "s" }] : []),
    ];
    case "cable": return [
      { label: "Resistance at 20 °C", value: n("resistance"), unit: "Ω" },
      { label: "Resistance per km", value: n("resistance") / n("length") * 1000, unit: "Ω/km" },
      { label: "Voltage drop at ampacity", value: n("ratedCurrent") * n("resistance") * (1 + n("tempCoefficient") * (n("maxTemperature") - 20)), unit: "V" },
      { label: "Loss at ampacity", value: n("ratedCurrent") ** 2 * n("resistance") * (1 + n("tempCoefficient") * (n("maxTemperature") - 20)), unit: "W" },
      { label: "Thermal time constant", value: n("loss") > 0 ? n("heatCapacity") / n("loss") : Infinity, unit: "s" },
    ];
    case "tank": {
      const mass = n("volume"), g = vesselGeometry(n("capacity"), n("surfaceArea"));
      return [
        { label: "Water mass", value: mass, unit: "kg" },
        { label: "Total heat capacity", value: mass * 4180 + n("vesselHeatCapacity"), unit: "J/K", note: "water + vessel" },
        { label: "Energy per 10 K rise", value: (mass * 4180 + n("vesselHeatCapacity")) * 10 / 3.6e6, unit: "kWh" },
        { label: "Vessel height", value: g.height, unit: "m", note: "capacity / footprint" },
        { label: "Wall + base + lid area", value: g.wallArea, unit: "m²" },
        { label: "Effective loss UA", value: n("loss"), unit: "W/K" },
        { label: "Cooling time constant", value: n("loss") > 0 ? (mass * 4180 + n("vesselHeatCapacity")) / n("loss") / 3600 : Infinity, unit: "h" },
      ];
    }
    case "motor": return [
      { label: "No-load speed", value: n("ratedVoltage") / n("torqueConstant") * 30 / Math.PI, unit: "RPM", note: "V/k" },
      { label: "Stall current", value: n("ratedVoltage") / n("resistance"), unit: "A", note: "V/R — limit with a CV/CC supply" },
      { label: "Stall torque", value: n("torqueConstant") * n("ratedVoltage") / n("resistance"), unit: "N·m" },
      { label: "Torque at rated current", value: n("torqueConstant") * n("ratedCurrent"), unit: "N·m" },
    ];
    // Pump rating readouts are computed by pumpRatingReadouts() in hydraulic.ts with the same
    // operating-point function as live readings (kept there to avoid an import cycle).
    case "pipe": return [
      { label: "Flow area", value: Math.PI * n("diameter") ** 2 / 4 * 1e4, unit: "cm²" },
      { label: "Relative roughness", value: n("roughness") / n("diameter"), unit: "1" },
      { label: "Flow at 1 m/s", value: Math.PI * n("diameter") ** 2 / 4 * 60000, unit: "L/min" },
    ];
    case "fuse": return [{ label: "Trip current", value: n("ratedCurrent"), unit: "A", note: `after ${n("tripTime", 0.1)} s` }];
    case "breaker": case "motorProtector": {
      const tau = thermalTau(c), k = thermalThreshold(c.kind);
      const t = (x: number) => x * x > k * k ? tau * Math.log(x * x / (x * x - k * k)) : Infinity;
      return [
        { label: "Thermal-image time constant", value: tau, unit: "s" },
        { label: "Trip time at 1.5 × In (cold)", value: t(1.5), unit: "s" },
        { label: "Trip time at 3 × In (cold)", value: t(3), unit: "s" },
        { label: "Trip time at 7.2 × In (cold)", value: t(7.2), unit: "s" },
        { label: "Instantaneous trip above", value: n("ratedCurrent") * n("magneticTrip"), unit: "A" },
      ];
    }
    default: return [];
  }
}

// ---------- Protective thermal image (breaker / motor protector) ----------
/** Trip threshold of the thermal image θ = (I/In)² in steady state. */
export const thermalThreshold = (kind: Kind) => (kind === "motorProtector" ? 1.12 : 1.3);
/** Thermal-image time constant: explicit for breakers, derived from the trip class for motor protectors. */
export function thermalTau(c: Component) {
  if (c.kind === "motorProtector") {
    const k2 = thermalThreshold(c.kind) ** 2, x2 = 7.2 * 7.2;
    return num(c.props, "tripClass", 10) / Math.log(x2 / (x2 - k2));
  }
  return num(c.props, "thermalTimeConstant", 60);
}
