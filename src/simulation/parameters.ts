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
import { kellDensity } from "./water";

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
  fillPressure: { label: "Closed-loop fill pressure", description: "Pressure datum at the boiler inlet for a sealed loop without a finite tank. Represents external precharge and compliant expansion; expansion pressure dynamics are not modeled.", unit: "Pa", display: { unit: "bar", scale: 1e-5 }, group: "configuration", policy: "live", domain: [0, 300000], limitReason: NUMERIC },
  ratedOutput: { label: "Standard heat output Φ₅₀", description: "EN 442 heat output at 75/65 °C water and 20 °C air (log-mean excess 49.83 K). Kermi catalog sizes: registered φ_SL × length.", unit: "W", group: "configuration", policy: "live", domain: [0, 1e7], positive: true, limitReason: POSITIVE, typical: [100, 10000] },
  exponent: { label: "Radiator exponent n", description: "EN 442 characteristic Φ = Φ₅₀·(ΔT_ln/49.83 K)^n, registered per type and height. Steel panel radiators 1.24–1.34.", unit: "1", group: "configuration", policy: "live", domain: [1, 2], limitReason: "Power-law characteristic: n ≥ 1 keeps the conductance finite as the excess temperature goes to zero.", typical: [1.2, 1.45] },
  metalMass: { label: "Steel mass", description: "Radiator mass, lumped at the local water temperature. Kermi catalog weight (covers and side panels included).", unit: "kg", group: "thermal", policy: "reset", domain: [0, 1e5], limitReason: NUMERIC },
  metalSpecificHeat: { label: "Steel specific heat", description: "Assumed 450 J/(kg·K): plain carbon steel near 50 °C (Incropera, Table A.1: 434 at 300 K, 487 at 400 K).", unit: "J/(kg·K)", group: "thermal", policy: "reset", domain: [0, 5000], limitReason: NUMERIC },
  radiantShare: { label: "Radiant share", description: "Kermi published share of the output emitted as radiation. Only splits the reported output; the room-air boundary receives both.", unit: "%", group: "advanced", policy: "live", domain: [0, 100], limitReason: "A share of the output.", simulated: false },
  restartDelay: { label: "Supply recovery delay", description: "Time with healthy phase voltages before stage restart; assumed electronics behavior.", unit: "s", group: "operating", policy: "live", domain: [0, 300], limitReason: NUMERIC },
  waterVolume: { label: "Internal water volume", description: "Bosch TH3000 9: 3.7 L. Fixed inventory at reference density, fully mixed.", unit: "L", group: "configuration", policy: "reset", domain: [0.01, 10000], limitReason: POSITIVE },
  stageDelay: { label: "Stage switching interval", description: "Minimum time between ordinary stage changes. Model approximation.", unit: "s", group: "operating", policy: "live", domain: [0.05, 300], limitReason: POSITIVE },
  antiCycleTime: { label: "Restart inhibit time", description: "Minimum off time after the last stage opens; faults bypass switching delays.", unit: "s", group: "operating", policy: "live", domain: [0, 3600], limitReason: NUMERIC },
  maxStages: { label: "Maximum heating stages", description: "Power restriction: 0, 1, 2 or 3 stages. Each stage is one phase-to-neutral 3 kW element.", unit: "1", group: "operating", policy: "live", domain: [0, 3], limitReason: "Three installed elements." },
  tripTemperature: { ...temperature("Independent limiter", "Bosch STB opens at 95 °C; latches until manual reset below reset temperature.", "ratings"), domain: [40, 99] },
  resetTemperature: { ...temperature("Limiter reset temperature", "Bosch: cool to about 70 °C before manually resetting.", "ratings"), domain: [1, 90] },
  flowInterlock: { label: "Enable flow interlock", description: "Optional modeled flow switch, separate from the Bosch pressure switch; not a manufacturer feature.", group: "operating", policy: "live" },
  minFlow: { label: "Minimum flow", description: "Bosch minimum flow 130 L/h; optional interlock threshold.", unit: "m³/s", display: { unit: "L/min", scale: 60000 }, group: "ratings", policy: "live", domain: [0, 1], limitReason: NUMERIC },
  flowDelay: { label: "Flow proving time", description: "Continuous low-flow demand before the optional interlock latches; model assumption.", unit: "s", group: "operating", policy: "live", domain: [0, 300], limitReason: NUMERIC },
  capacityAh: { label: "Charge capacity", description: "Charge capacity. See the component model and limitations.", unit: "Ah", group: "configuration", policy: "reset", domain: [0, 100000000.0], positive: true, limitReason: NUMERIC },
  initialSOC: { label: "Initial state of charge", description: "Initial state of charge. See the component model and limitations.", unit: "%", group: "configuration", policy: "reset", domain: [0, 100], positive: false, limitReason: NUMERIC },
  emptyVoltage: { label: "Open-circuit voltage at empty", description: "Open-circuit voltage at empty. See the component model and limitations.", unit: "V", group: "configuration", policy: "reset", domain: [0, 1000000.0], positive: false, limitReason: NUMERIC },
  fullVoltage: { label: "Open-circuit voltage at full", description: "Open-circuit voltage at full. See the component model and limitations.", unit: "V", group: "configuration", policy: "reset", domain: [0, 1000000.0], positive: true, limitReason: NUMERIC },
  chemistry: { label: "Open-circuit voltage curve", description: "Shape of the open-circuit voltage between the empty and full voltages. Linear: lead-acid-like. NMC: Li-ion (3.0–4.2 V per cell) rising steeply from empty, then gently. LFP: LiFePO₄ rested open-circuit voltage (2.5–3.40 V per cell), steep below 20 %, a flat plateau and a top knee from 3.35 V at 99 %. The 3.65 V charge cut-off is a charger limit, not an open-circuit voltage. Defines stored chemical energy.", group: "configuration", policy: "reset", options: [{ value: "linear", label: "Linear (lead-acid-like)" }, { value: "nmc", label: "Li-ion NMC" }, { value: "lfp", label: "LiFePO₄ (LFP)" }] },
  coulombicEfficiency: { label: "Coulombic (charge) efficiency", description: "Share of the charging charge that is stored; the rest drives side reactions (gassing) and heats the pack. Typically 85–95 % for lead-acid, above 99 % for Li-ion. Discharge is unaffected.", unit: "%", group: "configuration", policy: "live", domain: [0, 100], positive: true, limitReason: "Percentage of the charging charge.", typical: [85, 100] },
  selfDischarge: { label: "Self-discharge", description: "Internal loss of charge per 30 days while charged; its chemical energy becomes heat. Typically 2–5 %/month for lead-acid and Li-ion.", unit: "%/month", group: "configuration", policy: "live", domain: [0, 100], limitReason: "Percentage of capacity per 30 days.", typical: [0, 10] },
  polarizationResistance: { label: "Polarization resistance R₁ at 20 °C", description: "Charge-transfer and diffusion overpotential (one-RC Thevenin model): under a sustained load the terminal voltage sags further over τ₁ and recovers after the load ends. 0 disables the branch.", unit: "Ω", group: "configuration", policy: "reset", domain: [0, 1e6], limitReason: NUMERIC },
  polarizationTimeConstant: { label: "Polarization time constant τ₁ at 20 °C", description: "Relaxation time R₁·C₁ of the polarization voltage at 20 °C. C₁ = τ₁/R₁ is fixed; τ₁ follows R₁(T).", unit: "s", group: "configuration", policy: "reset", domain: [0, 1e6], positive: true, limitReason: POSITIVE, typical: [5, 300] },
  resistanceActivation: { label: "Resistance activation temperature Eₐ/R", description: "Arrhenius temperature dependence of R₀ and R₁, referenced to 20 °C: R(T) = R₂₀·exp(Eₐ/R·(1/T − 1/293.15 K)). 2,000 K gives 1.65 × at 0 °C and 2.9 × at −20 °C. 0 disables it.", unit: "K", group: "advanced", policy: "live", domain: [0, 20000], limitReason: NUMERIC, typical: [1000, 5000] },
  coilVoltage: { label: "Rated DC coil voltage", description: "Rated DC coil voltage. See the component model and limitations.", unit: "V", group: "configuration", policy: "live", domain: [0, 1000000.0], positive: true, limitReason: NUMERIC },
  coilResistance: { label: "DC coil resistance", description: "DC coil resistance. See the component model and limitations.", unit: "Ω", group: "configuration", policy: "live", domain: [0, 1000000000000.0], positive: true, limitReason: NUMERIC },
  pickupRatio: { label: "Coil pickup fraction", description: "Coil pickup fraction. See the component model and limitations.", unit: "1", group: "configuration", policy: "live", domain: [0, 1], positive: true, limitReason: NUMERIC },
  dropoutRatio: { label: "Coil dropout fraction", description: "Coil dropout fraction. See the component model and limitations.", unit: "1", group: "configuration", policy: "live", domain: [0, 1], positive: false, limitReason: NUMERIC },
  pickupTime: { label: "Pickup delay", description: "Pickup delay. See the component model and limitations.", unit: "s", group: "configuration", policy: "live", domain: [0, 100], positive: false, limitReason: NUMERIC },
  dropoutTime: { label: "Dropout delay", description: "Dropout delay. See the component model and limitations.", unit: "s", group: "configuration", policy: "live", domain: [0, 100], positive: false, limitReason: NUMERIC },
  turnsRatio: { label: "Turns ratio Np/Ns", description: "Turns ratio Np/Ns. See the component model and limitations.", unit: "1", group: "configuration", policy: "live", domain: [0.0001, 10000.0], positive: true, limitReason: NUMERIC },
  windingResistance: { label: "Combined winding resistance, primary-referred", description: "Combined winding resistance, primary-referred. See the component model and limitations.", unit: "Ω", group: "configuration", policy: "live", domain: [0, 100000000.0], positive: false, limitReason: NUMERIC },
  leakageInductance: { label: "Combined leakage inductance, primary-referred", description: "Combined leakage inductance, primary-referred. See the component model and limitations.", unit: "H", group: "configuration", policy: "live", domain: [0, 10000.0], positive: false, limitReason: NUMERIC },
  magnetizingInductance: { label: "Magnetizing inductance, primary shunt", description: "Magnetizing inductance, primary shunt. See the component model and limitations.", unit: "H", group: "configuration", policy: "live", domain: [0, 100000000.0], positive: true, limitReason: NUMERIC },
  coreResistance: { label: "Core-loss resistance, primary shunt", description: "Core-loss resistance, primary shunt. See the component model and limitations.", unit: "Ω", group: "configuration", policy: "live", domain: [0, 1000000000000.0], positive: true, limitReason: NUMERIC },
  fanRatedPower: { label: "Fan power at rated DC voltage", description: "Fan power at rated DC voltage. See the component model and limitations.", unit: "W", group: "configuration", policy: "live", domain: [0, 1000000.0], positive: true, limitReason: NUMERIC },
  naturalUA: { label: "Natural-convection conductance", description: "Natural-convection conductance. See the component model and limitations.", unit: "W/K", group: "configuration", policy: "live", domain: [0, 100000000.0], positive: false, limitReason: NUMERIC },
  forcedUA: { label: "Additional conductance at rated fan voltage", description: "Additional conductance at rated fan voltage. See the component model and limitations.", unit: "W/K", group: "configuration", policy: "live", domain: [0, 100000000.0], positive: false, limitReason: NUMERIC },

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
  inductance: { label: "Inductance", description: "Self-inductance. DC: the current changes as L·di/dt and stores ½·L·I²; interrupting it without a freewheeling path dumps that energy in the switching arc. AC: reactance X = 2πfL. Defines stored energy.", unit: "H", group: "configuration", policy: "reset", domain: [0, 1e3], positive: true, limitReason: POSITIVE },
  capacitance: { label: "Capacitance", description: "DC: stores charge q = C·v and energy ½·C·v², charging and discharging through the circuit. AC: reactance X = −1/(2πfC). Defines stored energy.", unit: "F", group: "configuration", policy: "reset", domain: [0, 10], positive: true, limitReason: POSITIVE },
  polarized: { label: "Polarized (electrolytic)", description: "An aluminium electrolytic capacitor: terminal a is +. Reverse bias beyond 1 V or operation on AC breaks its oxide dielectric down; it vents and fails open. Off: a non-polarized (film) capacitor.", group: "configuration", policy: "reset" },
  chargeVoltage: { label: "Initial charge voltage", description: "Dielectric voltage at reset, terminal a positive. Defines the stored energy ½·C·V².", unit: "V", group: "initial", policy: "reset", domain: [-1e6, 1e6], limitReason: NUMERIC },
  ratedFrequency: { label: "Rated frequency", description: "Frequency at which the machine reactances are specified; reactances scale with the supply frequency.", unit: "Hz", group: "configuration", policy: "live", domain: [0, 1000], positive: true, limitReason: POSITIVE },
  poles: { label: "Poles", description: "Pole count p; synchronous speed n_s = 120·f/p.", unit: "1", group: "configuration", policy: "live", domain: [2, 64], limitReason: "Even pole count between 2 and 64." },
  statorResistance: { label: "Stator resistance R₁", description: "Per-phase (star-equivalent) stator winding resistance.", unit: "Ω", group: "configuration", policy: "live", domain: [0, 1e4], positive: true, limitReason: POSITIVE },
  statorReactance: { label: "Stator leakage X₁", description: "Per-phase stator leakage reactance at rated frequency.", unit: "Ω", group: "configuration", policy: "live", domain: [0, 1e4], limitReason: NUMERIC },
  magnetizingReactance: { label: "Magnetizing reactance Xm", description: "Per-phase magnetizing reactance at rated frequency.", unit: "Ω", group: "configuration", policy: "live", domain: [0, 1e6], positive: true, limitReason: POSITIVE },
  rotorResistance: { label: "Rotor resistance R₂′", description: "Per-phase rotor resistance referred to the stator; sets slip and starting torque.", unit: "Ω", group: "configuration", policy: "live", domain: [0, 1e4], positive: true, limitReason: POSITIVE },
  rotorReactance: { label: "Rotor leakage X₂′", description: "Per-phase rotor leakage reactance referred to the stator at rated frequency.", unit: "Ω", group: "configuration", policy: "live", domain: [0, 1e4], limitReason: NUMERIC },
  rotorResistance2: { label: "Starting-cage resistance R₂s′", description: "Second (outer, starting) rotor cage: high resistance and low leakage, so it carries the rotor current at standstill and gives high starting torque, while the running cage sets the low rated slip (the deep-bar effect). 0: a single cage.", unit: "Ω", group: "configuration", policy: "live", domain: [0, 1e4], limitReason: NUMERIC },
  rotorReactance2: { label: "Starting-cage leakage X₂s′", description: "Leakage reactance of the starting cage referred to the stator at rated frequency.", unit: "Ω", group: "configuration", policy: "live", domain: [0, 1e4], limitReason: NUMERIC },
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
  tripTime: { label: "Melting time at 10 × In", description: "Pre-arcing time at ten times the rated current (cold). Sets the time constant of the fuse element's thermal image; the element carries 1.25 × In indefinitely and melts at 1.6 × In (IEC 60269 gG conventional currents), inverse-time in between and ≈ constant I²t at high current.", unit: "s", group: "ratings", policy: "live", domain: [0, 1e4], positive: true, limitReason: POSITIVE },
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
  ambientMode: { label: "Ambient environment", description: "Inherit the experiment environment or explicitly use a local boundary temperature. This does not set initial or operating temperature.", group: "thermal", policy: "live", options: [{ value: "inherit", label: "Inherit experiment ambient" }, { value: "override", label: "Local ambient override" }] },
  ambient: { label: "Ambient temperature", description: "Local boundary temperature, used only when Local ambient override is selected. Independent of initial temperature and control setpoints.", unit: "°C", group: "thermal", policy: "live", domain: [-100, 500], limitReason: "Environmental boundary envelope." },
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
  opening: { label: "Valve opening", description: "Commanded opening (relative travel). K grows as 1/φ², φ = Kv/Kvs from the inherent characteristic.", unit: "%", group: "operating", policy: "live", domain: [0, 100], limitReason: "Percentage." },
  characteristic: { label: "Inherent characteristic", description: "Kv/Kvs against travel x at constant Δp (Seborg et al., Process Dynamics and Control, ch. 9): linear x; equal percentage R^(x−1), the usual control-valve trim; quick opening √x, for on/off service. The installed characteristic follows from the network.", group: "configuration", policy: "live", options: [{ value: "linear", label: "Linear" }, { value: "equalPercentage", label: "Equal percentage" }, { value: "quickOpening", label: "Quick opening" }] },
  rangeability: { label: "Rangeability R", description: "Equal-percentage trim only: Kvs/Kv at zero travel; typically 20–50. Below φ = 1/R the valve steps to its seat at 0 %.", unit: "1", group: "configuration", policy: "live", domain: [2, 1000], typical: [20, 50], limitReason: "An equal-percentage characteristic needs R > 1; above 1000 no real trim." },
  lossCoefficient: { label: "Loss coefficient K", description: "Fully-open minor-loss coefficient referenced to the bore velocity.", unit: "1", group: "configuration", policy: "live", domain: [0, 1e7], positive: true, limitReason: POSITIVE },
  laminarK: { label: "Laminar coefficient K₁", description: "Hooper two-K low-Reynolds term: K(Re) = K₁/Re + K∞. Typical K₁: ball/gate 300–500, globe/regulator 1500, swing check 1500. Uses the viscosity of the upstream water.", unit: "1", group: "advanced", policy: "live", domain: [0, 1e7], limitReason: NUMERIC },
  crackingPressure: { label: "Cracking pressure", description: "Forward pressure difference needed to open.", unit: "Pa", group: "configuration", policy: "live", domain: [0, 1e8], limitReason: NUMERIC, display: { unit: "kPa", scale: 1e-3 } },
  // — Motor starters and drives —
  starTime: { label: "Star time", description: "Time in star before the changeover; set to the run-up time in star (the motor should be near its star-connection speed). Typical 3–15 s.", unit: "s", group: "operating", policy: "live", domain: [0, 3600], positive: true, limitReason: POSITIVE, typical: [2, 20] },
  transitionTime: { label: "Transition dead time", description: "Open transition: both star and delta contactors open while the star contactor's arc extinguishes. The rotor flux decays meanwhile; reconnecting in delta gives a current and torque transient that depends on the residual flux phase. Typical 30–80 ms.", unit: "s", group: "configuration", policy: "live", domain: [0, 10], positive: true, limitReason: POSITIVE, typical: [0.02, 0.1] },
  initialVoltage: { label: "Initial voltage", description: "Fundamental motor voltage at the start of the ramp, % of the line voltage. Starting torque scales with its square. Typical 30–60 %.", unit: "%", group: "operating", policy: "live", domain: [1, 100], limitReason: "Percentage of the line voltage.", typical: [30, 60] },
  rampTime: { label: "Ramp time", description: "Voltage ramp from the initial voltage to 100 %. The bypass contactor closes when full voltage is reached and the current is within the limit.", unit: "s", group: "operating", policy: "live", domain: [0, 3600], positive: true, limitReason: POSITIVE, typical: [2, 30] },
  stopTime: { label: "Soft-stop time", description: "Voltage ramp-down on stop (pumps: limits pressure surges). 0 = coast to stop.", unit: "s", group: "operating", policy: "live", domain: [0, 3600], limitReason: "Non-negative time." },
  currentLimit: { label: "Current limit", description: "Line current limit while ramping, × rated current. Typical 2.5–4 × In; below about 2 × In a loaded motor may not start.", unit: "× In", group: "operating", policy: "live", domain: [1, 10], limitReason: "Multiple of the rated current.", typical: [2, 5] },
  maxStartTime: { label: "Maximum start time", description: "Trips the starter if full voltage within the current limit is not reached in this time (stalled or overloaded start).", unit: "s", group: "ratings", policy: "live", domain: [0, 3600], positive: true, limitReason: POSITIVE },
  frequencySetpoint: { label: "Frequency setpoint", description: "Commanded output frequency; a wired frequency input overrides it. Synchronous speed = 120·f/poles.", unit: "Hz", group: "operating", policy: "live", domain: [0, 400], limitReason: "Within the drive's output range." },
  accelTime: { label: "Acceleration time", description: "Ramp time from 0 to the base frequency. The current limit extends it when the motor cannot follow.", unit: "s", group: "operating", policy: "live", domain: [0, 3600], positive: true, limitReason: POSITIVE, typical: [1, 60] },
  decelTime: { label: "Deceleration time", description: "Ramp time from the base frequency to 0. Regenerated power goes to the braking resistor.", unit: "s", group: "operating", policy: "live", domain: [0, 3600], positive: true, limitReason: POSITIVE, typical: [1, 60] },
  stopMode: { label: "Stop mode", description: "Ramp: decelerate along the deceleration ramp, output off at the start frequency. Coast: output off immediately.", group: "configuration", policy: "live", options: [{ value: "ramp", label: "Ramp to stop" }, { value: "coast", label: "Coast to stop" }] },
  startFrequency: { label: "Start / stop frequency", description: "Output starts at this frequency and switches off when ramping down below it.", unit: "Hz", group: "configuration", policy: "live", domain: [0, 10], positive: true, limitReason: POSITIVE, typical: [0.2, 2] },
  baseFrequency: { label: "Base frequency", description: "Frequency at which the output reaches the rated voltage (motor rated frequency). Above it the voltage stays constant (field weakening).", unit: "Hz", group: "configuration", policy: "live", domain: [1, 400], limitReason: "Within the drive's output range." },
  maxFrequency: { label: "Maximum frequency", description: "Upper limit of the frequency command.", unit: "Hz", group: "configuration", policy: "live", domain: [1, 400], limitReason: "Within the drive's output range." },
  boost: { label: "Voltage boost", description: "V/f boost at 0 Hz, % of the rated voltage, decreasing linearly to zero at the base frequency; compensates the stator resistance drop at low frequency. Typical 2–6 %.", unit: "%", group: "configuration", policy: "live", domain: [0, 30], limitReason: "Percentage of the rated voltage.", typical: [0, 8] },
  ratedOutputCurrent: { label: "Rated output current", description: "Continuous output current In of the drive.", unit: "A", group: "ratings", policy: "live", domain: [0, 1e6], positive: true, limitReason: POSITIVE },
  overload: { label: "Overload capability", description: "Output current the drive carries for 60 s (heavy duty: 150 %). It is also the current limit: the drive holds or lowers the frequency instead of exceeding it. An I²t image with τ = 60 s / ln(x²/(x²−1)) trips the drive.", unit: "%", group: "ratings", policy: "live", domain: [101, 500], limitReason: "Above the continuous rating." },
  overcurrentTrip: { label: "Instantaneous overcurrent trip", description: "Hardware trip when the instantaneous output current exceeds this multiple of √2·In (output short circuit, stalled transient).", unit: "× √2·In", group: "ratings", policy: "live", domain: [1, 20], limitReason: "Multiple of the rated peak current." },
  ratedLoss: { label: "Losses at rated current", description: "Drive losses at rated output current, % of rated power (set from the datasheet; typically 2–4 % for small drives). Model: P = P₀ + P_r·(0.5·i + 0.5·i²), i = I/In: switching losses ∝ I, conduction losses ∝ I².", unit: "%", group: "advanced", policy: "live", domain: [0, 50], limitReason: "Percentage of rated power." },
  inputTHD: { label: "Input current THD", description: "Total harmonic distortion of the six-pulse rectifier's input current (harmonics 5, 7, 11, 13 … 25 with a 1/h spectrum, scaled to this value). About 30 % for an ideal DC-side inductance, typically 35–45 % with a DC choke or 3 % line reactor, 80–120 % without choke. The harmonic currents flow through the supply network (cables, breakers, supply impedance, capacitors: resonance) and add to their RMS current and heating.", unit: "%", group: "advanced", policy: "live", domain: [0, 200], limitReason: "Percentage of the fundamental.", typical: [30, 120] },
  standbyLoss: { label: "Standby losses", description: "Control electronics and fan while energised (P₀).", unit: "W", group: "advanced", policy: "live", domain: [0, 1e6], limitReason: NUMERIC },
  responseTime: { label: "Full stroke time", description: "Rate-limited actuator travel time 0→100%.", unit: "s", group: "configuration", policy: "live", domain: [0, 1e5], positive: true, limitReason: POSITIVE },
  failOpen: { label: "Fail open", description: "Position on loss of command signal.", group: "configuration", policy: "live" },
  ratedSpeed: { label: "Rated pump speed", description: "Reference speed of the head/flow curve (affinity laws scale from here).", unit: "rad/s", group: "configuration", policy: "live", domain: [0, 1e5], positive: true, limitReason: POSITIVE, display: { unit: "RPM", scale: 30 / Math.PI } },
  ratedFlow: { label: "Rated pump flow", description: "Reference flow at rated speed (head = 50% of shutoff).", unit: "m³/s", group: "configuration", policy: "live", domain: [0, 100], positive: true, limitReason: POSITIVE, display: { unit: "L/min", scale: 60000 } },
  shutoffHead: { label: "Shutoff head", description: "Zero-flow head at rated speed.", unit: "m", group: "configuration", policy: "live", domain: [0, 1e4], positive: true, limitReason: POSITIVE },
  efficiency: { label: "Peak hydraulic efficiency", description: "Best-efficiency-point efficiency; the curve falls off away from rated flow (floor 15%).", unit: "1", group: "configuration", policy: "live", domain: [0.01, 1], limitReason: "Efficiency is a fraction ≤ 1." },
  mechanicalLoss: { label: "Mechanical loss at rating", description: "Bearing and shaft-seal friction as a share of shaft input at rated speed and flow (typically 0.5–2 %, smaller for larger pumps; KSB/DIN EN 12723). Scales with speed as ω^1.6 (rolling-bearing friction torque ∝ (νn)^0.6, SKF model). Disc friction and leakage are part of the hydraulic efficiency.", unit: "%", group: "advanced", policy: "live", domain: [0, 20], limitReason: "Mechanical losses beyond 20 % of shaft input indicate a damaged pump, not a design value." },
  // — Circulator (integrated EC motor and controller) —
  headSetpoint: { label: "Head setpoint H_set", description: "Constant pressure: the head the controller holds. Proportional pressure: the head at rated flow; the setpoint line falls to H_set/2 at zero flow. Limited by the maximum curve.", unit: "m", group: "operating", policy: "live", domain: [0, 1e4], limitReason: NUMERIC, typical: [0.5, 12] },
  speedSetting: { label: "Constant-curve speed", description: "Speed in constant-curve mode, percent of the maximum speed (datasheet speeds I/II/III).", unit: "%", group: "operating", policy: "live", domain: [0, 100], limitReason: "Percentage of the maximum speed." },
  minSpeed: { label: "Minimum speed", description: "Lowest controlled speed, percent of the maximum speed (the datasheet's minimum curve). A speed command below 1 % stops the pump.", unit: "%", group: "configuration", policy: "live", domain: [0, 100], limitReason: "Percentage of the maximum speed." },
  minVoltage: { label: "Undervoltage lockout", description: "Below this supply voltage the electronics switch off and the rotor coasts to rest; they restart once the supply recovers to 105 % of it.", unit: "V", group: "ratings", policy: "live", domain: [0, 1e6], limitReason: NUMERIC },
  standbyPower: { label: "Electronics standby power P₀", description: "Input of the control electronics whenever the supply is on, also while the pump is stopped by command. Assumed value; datasheets give only the lowest running input.", unit: "W", group: "advanced", policy: "live", domain: [0, 1e6], limitReason: NUMERIC },
  motorEfficiency: { label: "Motor and drive efficiency η_m", description: "Constant efficiency of the EC motor and its inverter from electrical input (minus P₀) to shaft power: P1 = P₀ + P_shaft/η_m. Assumed value fitted to the datasheet's maximum input power and EEI; real efficiency varies with load and speed.", unit: "%", group: "advanced", policy: "live", domain: [1, 100], limitReason: "Efficiency in percent." },
  // — Motor —
  torqueConstant: { label: "Torque constant kₜ", description: "Torque per armature ampere. In SI the back-EMF constant is identical.", unit: "N·m/A", group: "configuration", policy: "live", domain: [0, 1000], positive: true, limitReason: POSITIVE },
  emfConstant: { label: "Back-EMF constant kₑ", description: "Equal to kₜ in SI units (energy consistency).", unit: "V·s/rad", group: "configuration", policy: "derived", derivedFrom: ["torqueConstant"] },
  inertia: { label: "Rotor inertia", description: "Rotor moment of inertia; defines stored kinetic energy.", unit: "kg·m²", group: "configuration", policy: "reset", domain: [0, 1e6], positive: true, limitReason: POSITIVE },
  gearRatio: { label: "Gear ratio i", description: "Motor speed / flywheel speed. 1: direct coupling. The motor sees the flywheel inertia as J/i². Defines how stored energy reflects to the motor shaft.", unit: "1", group: "configuration", policy: "reset", domain: [0, 1e4], positive: true, limitReason: POSITIVE, typical: [1, 100] },
  gearEfficiency: { label: "Gear efficiency η", description: "Mesh efficiency of the gear stage for either direction of power flow: the motor supplies T/η to accelerate the flywheel and receives η·T when the flywheel drives back. Typical 96–98 % per helical stage, 100 % for a direct coupling.", unit: "%", group: "configuration", policy: "live", domain: [0, 100], positive: true, limitReason: "Percentage of the transmitted power.", typical: [80, 100] },
  absorber: { label: "Absorber type", description: "Electric: constant torque up to the rated speed, holds a stalled shaft. Eddy-current: the set torque within an envelope that is small at low speed and peaks at the rated speed. Water brake: torque ∝ speed² (the set torque applies at the rated speed). All are power-limited above the rated speed.", group: "configuration", policy: "live", options: [{ value: "electric", label: "Electric (AC dynamometer)" }, { value: "eddyCurrent", label: "Eddy-current brake" }, { value: "waterBrake", label: "Water brake" }] },
  torqueSetpoint: { label: "Set torque", description: "Absorbed torque demand (water brake: at the rated speed); the numeric torque input overrides it when wired. Limited by the absorber envelope.", unit: "N·m", group: "operating", policy: "live", domain: [0, 1e8], limitReason: NUMERIC },
  friction: { label: "Viscous friction", description: "Bearing friction torque per rad/s; dissipated as winding heat.", unit: "N·m·s", group: "advanced", policy: "live", domain: [0, 1e4], limitReason: NUMERIC },
  loadTorque: { label: "External shaft load", description: "Constant opposing torque that exports work from the shaft.", unit: "N·m", group: "operating", policy: "live", domain: [0, 1e7], limitReason: NUMERIC },
  ratedTorque: { label: "Rated torque", description: "Continuous torque rating (overload is reported).", unit: "N·m", group: "ratings", policy: "live", domain: [0, 1e8], positive: true, limitReason: POSITIVE },
  maxSpeed: { label: "Maximum speed", description: "Mechanical speed limit (exceeding it is reported).", unit: "rad/s", group: "ratings", policy: "live", domain: [0, 1e5], positive: true, limitReason: POSITIVE, display: { unit: "RPM", scale: 30 / Math.PI } },
  speedControl: { label: "Enable speed command", description: "PWM speed drive follows the speed command: PI speed controller, armature current limited to 150 % of rated.", group: "operating", policy: "live" },
  speedCommand: { label: "Motor speed command", description: "Speed command of the PWM speed drive (zero steady-state error within the current and voltage limits).", unit: "RPM", group: "operating", policy: "live", domain: [0, 1e6], limitReason: NUMERIC },
  // — Sensors & automation —
  stream: { label: "Exchanger stream", description: "For heat-exchanger targets: A is the hot stream, B is the cold stream. Other targets ignore this selector.", group: "configuration", policy: "reset", options: [{ value: "hot", label: "A / hot stream" }, { value: "cold", label: "B / cold stream" }] },
  quantity: { label: "Measured quantity", description: "Choose the modeled state and measurement point; pressure is gauge pressure, differential is inlet minus outlet (negative for a pump pressure rise).", group: "configuration", policy: "reset", options: [{ value: "auto", label: "Modeled temperature (body/winding or fluid)" }, { value: "temperature", label: "Body / winding (tank: mixed water + vessel)" }, { value: "fluidTemperature", label: "Fluid temperature" }] },
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
const solarParameters: Record<string, [string, string, number, number, EditPolicy?]> = {
 voc: ["STC open circuit voltage", "V", 1, 200], isc: ["STC short circuit current", "A", 0.01, 100], vmp: ["STC MPP voltage", "V", 0.1, 200], imp: ["STC MPP current", "A", 0.001, 100], irradiance: ["Irradiance", "W/m²", 0, 1500], cellTemperature: ["Cell temperature", "°C", -40, 85], voltageCoefficient: ["Voc temperature coefficient", "1/K", -0.01, 0], currentCoefficient: ["Isc temperature coefficient", "1/K", 0, 0.005], area: ["Aperture area", "m²", 0.01, 100], shading: ["Uniform shaded fraction", "%", 0, 100], cells: ["Series cell count", "1", 1, 32, "reset"],
 chargeCurrentLimit: ["Charge current limit", "A", 0.01, 1000], dischargeCurrentLimit: ["Discharge current limit", "A", 0.01, 1000], minChargeTemperature: ["Minimum charging temperature", "°C", -40, 50], minDischargeTemperature: ["Minimum discharge temperature", "°C", -40, 50], bmsLowVoltage: ["BMS discharge cutoff", "V", 0, 200], bmsHighVoltage: ["BMS charging cutoff", "V", 0, 200],
 maxInputVoltage: ["Maximum input voltage", "V", 1, 1000], maxInputCurrent: ["Maximum input current", "A", 0.01, 1000], conversionEfficiency: ["Converter efficiency", "%", 1, 100], absorptionVoltage: ["Absorption voltage", "V", 1, 200], floatVoltage: ["Float voltage", "V", 1, 200], rebulkVoltage: ["Rebulk voltage", "V", 1, 200], absorptionTime: ["Absorption duration (assumed)", "s", 1, 86400], startupHeadroom: ["Startup voltage headroom", "V", 0, 20], runningHeadroom: ["Running voltage headroom", "V", 0, 20], trackingStep: ["P&O voltage perturbation", "V", 0.01, 2], trackingInterval: ["P&O sample interval", "s", 0.05, 10], initialTrackingVoltage: ["Initial PV tracking voltage", "V", 1, 200, "reset"], ratedApparentPower: ["Continuous apparent power", "VA", 1, 100000], surgePower: ["Surge power", "W", 1, 100000], surgeTime: ["Surge duration (assumed)", "s", 0.01, 60], peakEfficiency: ["Peak conversion efficiency", "%", 10, 99], idlePower: ["No-load consumption", "W", 0.01, 1000], restartVoltage: ["Restart voltage", "V", 0.01, 200], disconnectVoltage: ["Load disconnect voltage", "V", 0.01, 200],
};
for (const [key, [label, unit, min, max, policy]] of Object.entries(solarParameters)) if (!base[key]) base[key] = { label, description: label + ". See solar model provenance for manufacturer data and assumptions.", unit, group: "configuration", policy: policy ?? "live", domain: [min, max], limitReason: "Validated averaged solar model envelope." };
base.standby = { label: "Standby", description: "AC output off, DC electronics powered at standby consumption.", group: "operating", policy: "live" };

const hybridParameters: Record<string, [string, string, number, number]> = {
 chargeEfficiency: ['AC to DC efficiency (assumed)', '%', 1, 99], maxDCDischargeCurrent: ['DC input current limit', 'A', 0.1, 1000], maxChargeCurrent: ['Battery charging current limit', 'A', 0.1, 1000], maxACCurrent: ['Converter AC current limit', 'A', 0.1, 1000], transferCurrent: ['Transfer contact rating', 'A', 0.1, 1000], acInputCurrentLimit: ['AC input current limit', 'A', 0.1, 1000], gridMinVoltage: ['Grid minimum voltage', 'V', 1, 1000], gridMaxVoltage: ['Grid maximum voltage', 'V', 1, 1000], gridMinFrequency: ['Grid minimum frequency', 'Hz', 1, 100], gridMaxFrequency: ['Grid maximum frequency', 'Hz', 1, 100], transferTime: ['Backup transfer interruption', 's', 0.001, 10], reconnectDelay: ['Grid qualification delay (assumed)', 's', 0.01, 600], syncTolerance: ['Synchronization phase tolerance', '°', 0.1, 10], phaseSlew: ['Synchronization phase slew (assumed)', '°/s', 1, 360], reserveSOC: ['Grid-connected SOC reserve', '%', 0, 100], gridChargePower: ['Requested grid charging', 'W', 0, 100000], gridChargeSOC: ['Grid charging SOC target', '%', 0, 100], exportLimit: ['Maximum export command', 'W', 0, 100000], gridSetpoint: ['Grid import target', 'W', 0, 100000], reactiveSetpoint: ['Reactive injection command', 'var', -100000, 100000], activeSetpoint: ['Active injection command (+ discharge)', 'W', -100000, 100000], dcTrackingVoltage: ['Initial DC tracking voltage', 'V', 1, 1000], dcTrackingStep: ['DC tracking perturbation', 'V', 0.01, 2], dcTrackingInterval: ['DC tracking interval', 's', 0.05, 10],
};
for (const [key, [label, unit, min, max]] of Object.entries(hybridParameters)) base[key] = { label, description: label + '. See hybrid model provenance and assumptions.', unit, group: 'configuration', policy: key === 'dcTrackingVoltage' ? 'reset' : 'live', domain: [min, max], limitReason: 'Averaged hybrid model envelope.' };
for (const [key, label] of Object.entries({ coordinateSolar: 'Export surplus charger output at full SOC', gridCharge: 'Enable grid charging', allowExport: 'Permit grid export', batteryTarget: 'Battery SOC measurement', gridMeterTarget: 'Point-of-common-coupling meter' })) base[key] = { label, description: label + '. Explicit ESS measurement or command.', group: 'operating', policy: 'live' };
base.energyMode = { label: 'Energy management policy', description: 'Self-consumption, keep charged, or an explicit signed active-power command. Grid input current and converter limits still apply.', group: 'operating', policy: 'live', options: [{ value: 'selfConsumption', label: 'Self-consumption' }, { value: 'keepCharged', label: 'Keep batteries charged' }, { value: 'power', label: 'External active-power setpoint' }] };

const overrides: Partial<Record<Kind, Record<string, Partial<ParamSpec>>>> = {
  solarPanel: { area: { label: 'Aperture area', description: 'Incident sunlight is irradiance times this aperture area; keep area compatible with the STC electrical ratings.', unit: 'm²', domain: [0.01, 100], typical: [1, 3] } },
  lfpBattery: {
    internalResistance: { label: 'Pack ohmic resistance', description: 'Series cell/connector resistance; I²R heats the battery thermal mass.' },
    maxPower: { label: 'BMS terminal power limit', description: 'Maximum absolute charge or discharge terminal power. Exceeding it isolates the pack and latches the electrical-overload trip until Reset.' },
    maxCurrent: { description: 'Additional absolute pack current protection rating; directional charge/discharge BMS thresholds may be lower.' },
  },
  mpptController: {
    maxCurrent: { label: 'Maximum battery output current', description: 'Averaged converter output current limit; excess available solar power is curtailed at the PV port.' },
    minVoltage: { label: 'Minimum battery voltage', description: 'No conversion below this measured battery-side voltage, including a missing or reversed battery.' },
  },
  inverter: {
    voltage: { label: 'AC output RMS voltage', description: 'Regulated sinusoidal AC output RMS voltage.' },
    minVoltage: { label: 'DC shutdown voltage', description: 'Input undervoltage shutdown threshold; restart requires the separately configured higher recovery voltage.' },
    ratedPower: { description: 'Continuous AC active power. A short overload is allowed only within surge power and duration limits.' },
    standbyPower: { description: 'DC consumption with explicit standby enabled and the AC output disabled; automatic ECO polling is omitted.' },
  },
  batteryProtection: { resistance: { label: 'Closed contact resistance', description: 'On-state contact resistance. I²R heats this independent protection device.' } },
  electricBoiler: {
    heatCapacity: { label: "Element heat capacity", description: "Assumed immersed element thermal inertia; defines stored energy.", policy: "reset" },
    vesselHeatCapacity: { description: "Assumed wetted steel thermal inertia, lumped with the fully mixed water." },
    conductance: { label: "Element-to-water conductance", description: "Assumed heat transfer coefficient between the immersed elements and water." },
    ratedCurrent: { description: "Bosch three-phase full-load line rating. In single-phase wiring all stages sum in the bridged live conductor; use the 39.2 A supply rating.", simulated: false },
    setpoint: { domain: [10, 85], description: "Supply temperature target; wired numeric input overrides this within 10–85 °C." },
    hysteresis: { domain: [0.1, 30], description: "Restart at target minus this difference. Bosch SE04 default 7 K (range 3–15 K)." },
  },
  panelRadiator: {
    waterVolume: { label: "Water content", description: "Kermi catalog water content (type 22, 600 × 1000 mm: 6.08 L). Fixed inventory at the reference density in 16 cells.", typical: [0.5, 50] },
    ambientMode: { label: "Room air", description: "Inherit the experiment ambient as room air, or set a local room-air temperature for this radiator. Water and steel initial temperature is separate." },
    ambient: { label: "Room air temperature", description: "Local room-air temperature, used only with the local override; otherwise the radiator exchanges heat with the experiment ambient. Ideal boundary of unlimited capacity. EN 442 output is still calibrated at 20 °C air." },
    initialTemperature: { description: "Water and steel temperature at reset." },
    diameter: { label: "Connection bore", description: "Reference bore of the G½ connections for velocity and the two-K loss (assumed 16 mm)." },
    lossCoefficient: { label: "Turbulent loss K∞", description: "Two-K fit to the Kermi pressure-drop chart (Profil-K types 12–33: 18.6; 10/11: 12.76), referenced to the connection bore." },
    laminarK: { label: "Low-Re coefficient K₁", description: "Two-K fit to the Kermi chart slope (1.987 in log–log; fit at 70 °C viscosity). Types 12–33: 1602; 10/11: 1099." },
    maxPressure: { description: "Kermi maximum operating pressure 10 bar (test pressure 13 bar). Exceeding it is reported." },
    maxTemperature: { label: "Maximum operating temperature", description: "Kermi: 110 °C. Exceeding it is reported (the liquid-water model stops at 100 °C)." },
  },
  source: {
    ratedVoltage: { label: "Maximum output voltage", description: "Highest voltage the supply can produce; the setpoint cannot exceed it." },
    mode: { label: "Source behaviour", description: "Ideal: perfect regulation, protective trip above the current rating. Internal resistance: Thevenin source. CV/CC: regulates voltage until the current limit, then current. Constant current: regulates current until the voltage compliance limit.", options: options.sourceMode },
    enabled: { label: "Output enabled", description: "Disabled output is electrically open." },
  },
  sourceAC: {
    voltage: { label: "RMS voltage", description: "RMS magnitude of the source phasor." },
    ratedVoltage: { label: "Maximum RMS voltage" },
    maxCurrent: { label: "Current rating", description: "Rated current In of the thermal-magnetic output protection (C characteristic): short-time surges such as motor starts are tolerated; sustained overload trips at θ ≥ 1.3², and magneticTrip × In trips instantly." },
    magneticTrip: { description: "Instantaneous output trip at this multiple of the current rating (C characteristic: 10)." },
    thermalTimeConstant: { description: "Time constant τ of the output protection's thermal image θ: dθ/dt = ((I/In)² − θ)/τ; trips at θ ≥ 1.3²." },
    maxPower: { label: "Rated apparent power", unit: "VA", description: "Reported when √(P² + Q²) exceeds it." },
  },
  capacitor: { resistance: { label: "ESR", description: "Equivalent series resistance (dielectric and lead loss)." }, ratedCurrent: { label: "Ripple current rating" } },
  battery: { internalResistance: { label: "Ohmic resistance R₀ at 20 °C", description: "Instantaneous series resistance of the cells and connectors; its I²R heats the pack." } },
  inductor: { resistance: { label: "Winding resistance" } },
  flywheel: {
    inertia: { label: "Flywheel inertia J", description: "Moment of inertia at the flywheel's own shaft; a solid steel disc 400 mm × 50 mm has about 1 kg·m². Defines stored kinetic energy." },
    friction: { label: "Bearing drag", description: "Viscous bearing and windage torque per rad/s at the flywheel shaft; its heat goes to ambient." },
    maxSpeed: { label: "Maximum safe speed", description: "Burst-safe speed of the flywheel (exceeding it is reported)." },
  },
  dynamometer: {
    ratedTorque: { label: "Rated torque", description: "Peak absorber torque, reached at the rated speed (eddy-current) or available up to it (electric)." },
    ratedSpeed: { label: "Rated speed", description: "Speed of peak torque; above it the absorber is power-limited." },
    ratedPower: { label: "Absorption power rating", description: "Continuous absorbed power; above the rated speed the torque falls as P/ω." },
    inertia: { label: "Rotor inertia", description: "Moment of inertia of the dynamometer rotor, coupled directly to the motor shaft." },
    maxSpeed: { label: "Maximum speed", description: "Mechanical speed limit (exceeding it is reported)." },
  },
  inductionMotor: {
    coreResistance: { label: "Iron-loss resistance Rc", description: "Per-phase resistance across the winding voltage at rated frequency: iron (core) loss 3·V²/Rc, heating the motor. Scales with √(f/f_rated), so at constant flux the loss grows as f^1.5." },
    rotorResistance: { label: "Running-cage resistance R₂′", description: "Per-phase resistance of the (inner) running cage referred to the stator; sets the rated slip." },
    rotorReactance: { label: "Running-cage leakage X₂′" },
    ratedVoltage: { label: "Rated line voltage", group: "ratings" },
    ratedPower: { label: "Rated shaft power", description: "Nameplate shaft output; compared with shaft power, not electrical input or starting losses." },
    loadTorque: { description: "Constant opposing torque that exports work from the shaft." },
    heatCapacity: { label: "Winding thermal mass" },
    maxTemperature: { label: "Insulation temperature limit", description: "Class F 155 °C; above it the motor fails open." },
    conductance: { label: "Frame conductance (UA)" },
    enabled: { label: "Contactor closed", description: "Used when the enable input is not wired." },
  },
  circulator: {
    mode: { label: "Control mode", description: "Proportional pressure: head follows H_set·(1 + Q/Q_r)/2. Constant pressure: head held at H_set. Constant curve: fixed speed. The controller acts on the last solved flow (approximated control logic, not the manufacturer's algorithm). A wired speed command (percent) overrides the mode.", options: [{ value: "proportionalPressure", label: "Proportional pressure" }, { value: "constantPressure", label: "Constant pressure" }, { value: "constantSpeed", label: "Constant curve (speed)" }] },
    enabled: { label: "Run", description: "Runs when on; off stops the motor (the electronics stay powered with their standby input). A wired enable input overrides it." },
    ratedSpeed: { label: "Maximum speed", description: "Speed of the maximum curve (affinity laws scale the curve from here). Assumed value: datasheets of circulators rarely state it." },
    ratedFlow: { label: "Curve reference flow Q_r", description: "Flow at which the quadratic maximum curve has fallen to half the shutoff head (zero head at √2·Q_r); also the reference flow of the proportional-pressure line." },
    shutoffHead: { label: "Shutoff head (maximum curve)", description: "Zero-flow head at maximum speed (datasheet Hmax)." },
    efficiency: { description: "Best-efficiency-point efficiency of the impeller and volute; falls off away from the reference flow (floor 15 %). Assumed value fitted together with η_m." },
    inertia: { label: "Rotor inertia", description: "Moment of inertia of the canned rotor and impeller; stores ½·J·ω², supplied by the electronics during run-up." },
    ratedVoltage: { label: "Nominal supply voltage", description: "Nominal voltage (DC or single-phase AC RMS); operation beyond +10 % is reported. The electronics regulate their input power, so the pump runs alike across the tolerance band." },
    ratedPower: { label: "Maximum input power P1,max", description: "Electronic input power limit (datasheet P1 max): above it the controller lowers the speed, so the maximum curve bends down at high flow." },
    rampTime: { label: "Soft-start ramp", group: "configuration", description: "Time the electronics take to ramp the rotor from rest to maximum speed (also the rate of controlled speed changes)." },
    npshRequired: { description: "Required net positive suction head at the reference flow (scales with flow²); the datasheet states minimum inlet pressures instead (0.05 bar at 75 °C for the reference pump). 0 = no check." },
  },
  pressureSensor: { quantity: { options: [{ value: "pressure", label: "Outlet / node gauge pressure" }, { value: "inletPressure", label: "Inlet gauge pressure" }, { value: "differentialPressure", label: "Inlet − outlet (pump rise is negative)" }] } },
  source3: {
    maxCurrent: { label: "Line current rating", description: "Rated line current In of the thermal-magnetic output protection (C characteristic): short-time surges such as a direct-on-line motor start are tolerated; sustained overload trips at θ ≥ 1.3², and magneticTrip × In trips instantly." },
    magneticTrip: { description: "Instantaneous output trip at this multiple of the line current rating (C characteristic: 10)." },
    thermalTimeConstant: { description: "Time constant τ of the output protection's thermal image θ: dθ/dt = ((I/In)² − θ)/τ; trips at θ ≥ 1.3²." },
    maxPower: { label: "Rated apparent power", unit: "VA", description: "Three-phase rating √3·V_LL·I_L (reported when exceeded)." },
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
    ratedVoltage: { description: "Nominal armature voltage." },
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
    ambient: { description: "Local surroundings of the pipe heat-loss UA, used only with the local override; otherwise the pipe inherits the experiment ambient. Independent of the initial water temperature." },
  },
  cooler: {
    conductance: { label: "Cooling conductance (UA)", description: "Conductance to an ideal coolant reservoir (no coolant mass or pump power)." },
    ambientMode: { label: "Coolant", description: "Inherit the experiment ambient as coolant temperature, or set an explicit coolant temperature (e.g. chilled water)." },
    ambient: { label: "Coolant temperature", description: "Temperature of the ideal coolant reservoir, used only with the explicit coolant setting; otherwise the coolant is at the experiment ambient.", domain: [-200, 1000] },
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
  starDeltaStarter: {
    enabled: { label: "Start command", description: "Starts (star, then delta) when on; opens all contactors when off. A wired start input overrides it." },
    ratedCurrent: { label: "Rated current (AC-3)", description: "Line current rating of the contactors. Starting current above it is normal during the start allowance." },
    resistance: { label: "Contact resistance", description: "Per-pole resistance of the conducting contactor path." },
  },
  softStarter: {
    enabled: { label: "Start command", description: "Starts the ramp when on; off stops (soft stop if configured). A wired start input overrides it." },
    ratedCurrent: { label: "Rated current In", description: "Set to the motor full-load current; the current limit is a multiple of it." },
    resistance: { label: "Path resistance", description: "Per-pole resistance of the thyristor/bypass path." },
  },
  vfd: {
    enabled: { label: "Run command", description: "Runs when on; off stops according to the stop mode. A wired run input overrides it." },
    ratedVoltage: { label: "Rated voltage", description: "Rated input line voltage and output voltage at the base frequency (motor rated voltage). Output is also limited to the supply's line voltage." },
    ratedPower: { label: "Rated power", description: "Rated output (motor) power; reference for the loss percentage." },
    maxTemperature: { label: "Heat-sink trip temperature", description: "The drive fails open (trips) above this heat-sink temperature." },
  },
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
  } else if (["pressureSensor", "flowSensor", "levelSensor", "positionSensor", "speedSensor"].includes(kind) && ["minRange", "maxRange", "resolution", "noise"].includes(key)) {
    spec.unit = ({ pressureSensor: "Pa", flowSensor: "m³/s", levelSensor: "%", positionSensor: "m", speedSensor: "RPM" } as Record<string, string>)[kind];
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
  if (kind === 'lfpBattery' && key === 'cells' && typeof value === 'number') return { emptyVoltage: 2.5 * value, fullVoltage: 3.4 * value, bmsLowVoltage: 2.8 * value, bmsHighVoltage: 3.75 * value, internalResistance: 0.0002 * value };
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
    case "panelRadiator": {
      // EN 442: Φ = Φ₅₀·(ΔT_ln/ΔT₅₀)^n, ΔT₅₀ = 10/ln(55/45) K; nominal flow gives the 10 K spread at Φ₅₀.
      const excess = 10 / Math.log(55 / 45), km = n("ratedOutput") / excess ** n("exponent"), capacity = n("waterVolume") * 4180 + n("metalMass") * n("metalSpecificHeat");
      const at = (s: number, r: number, a: number) => km * ((s - r) / Math.log((s - a) / (r - a))) ** n("exponent");
      return [
        { label: "Characteristic coefficient K_m", value: km, unit: "W/Kⁿ", note: "Φ₅₀/ΔT₅₀ⁿ" },
        { label: "Output at 70/55/20 °C", value: at(70, 55, 20), unit: "W", note: "EN 442 conversion" },
        { label: "Output at 55/45/20 °C", value: at(55, 45, 20), unit: "W", note: "EN 442 conversion" },
        { label: "Output at 45/40/20 °C", value: at(45, 40, 20), unit: "W", note: "EN 442 conversion" },
        { label: "Nominal water flow", value: n("ratedOutput") / 41800 * 3600, unit: "kg/h", note: "10 K spread at Φ₅₀" },
        { label: "Heat capacity", value: capacity, unit: "J/K", note: "water + steel" },
        { label: "Cooling time constant at ΔT₅₀", value: capacity * excess / (n("exponent") * n("ratedOutput")) / 60, unit: "min", note: "C/(dΦ/dT), zero flow" },
      ];
    }
    case "tank": {
      const mass = n("volume") / 1000 * kellDensity(n("initialTemperature", 20)), g = vesselGeometry(n("capacity"), n("surfaceArea"));
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
    case "fuse": {
      const t = (x: number) => fuseMeltTime({ theta: 0, body: 0 }, x * x, n("tripTime", 0.1));
      return [
        { label: "Conventional non-fusing current", value: 1.25 * n("ratedCurrent"), unit: "A", note: "carried indefinitely" },
        { label: "Melting time at 1.6 × In (cold)", value: t(1.6), unit: "s" },
        { label: "Melting time at 2 × In (cold)", value: t(2), unit: "s" },
        { label: "Melting time at 3 × In (cold)", value: t(3), unit: "s" },
        { label: "Melting time at 10 × In (cold)", value: t(10), unit: "s" },
        { label: "Pre-arcing I²t at 20 × In", value: t(20) * (20 * n("ratedCurrent")) ** 2, unit: "A²s" },
      ];
    }
    case "breaker": case "motorProtector": {
      const tau = thermalTau(c), k = thermalThreshold(c.kind);
      const t = (x: number) => x * x > k * k ? tau * Math.log(x * x / (x * x - k * k)) : Infinity;
      return [
        { label: "Thermal-image time constant", value: tau, unit: "s" },
        { label: "Trip time at 1.5 × In (cold)", value: t(1.5), unit: "s" },
        { label: "Trip time at 3 × In (cold)", value: t(3), unit: "s" },
        { label: "Trip time at 7.2 × In (cold)", value: t(7.2), unit: "s" },
        { label: "Instantaneous trip above", value: n("ratedCurrent") * n("magneticTrip"), unit: "A", note: "RMS, symmetric; AC trips when the instantaneous current exceeds √2 × this, so a DC offset at switch-on counts" },
      ];
    }
    default: return [];
  }
}

// ---------- Protective thermal image (breaker / motor protector) ----------
// ---------- gG fuse: element and body thermal images ----------
/**
 * Two-body fuse model (normalized temperature rises; steady element rise = (I/In)²). The element (capacity
 * C₁ = 44.16·T, conductance 1/0.15 to the body) heats the body/holder (time constant 400·T to ambient, 85 % of the
 * steady rise); T = melting time at 10 × In ("tripTime"). Fitted to the IEC 60269 gG gates of a 16 A link:
 * ≥ 10 s at 2.06 × In (24 s), ≤ 5 s at 4.06 × In (1.1 s), ≥ 0.1 s at 5.31 × In (0.45 s), conventional currents
 * 1.25/1.6 × In (melting threshold 1.45² as before). A single time constant melted in 3.2 s at 2.06 × In.
 */
const FUSE_ELEMENT_SHARE = 0.15, FUSE_ELEMENT_CAPACITY = 44.162134779, FUSE_BODY_TAU = 400;
export type FuseState = { theta: number; body: number };
function fuseSystem(tripTime: number) {
  const c1 = FUSE_ELEMENT_CAPACITY * tripTime, g1 = 1 / FUSE_ELEMENT_SHARE, g2 = 1 / (1 - FUSE_ELEMENT_SHARE), c2 = FUSE_BODY_TAU * tripTime / (1 - FUSE_ELEMENT_SHARE);
  const a = -g1 / c1, b = g1 / c1, c = g1 / c2, d = -(g1 + g2) / c2;
  const mean = (a + d) / 2, root = Math.sqrt(((a - d) / 2) ** 2 + b * c);
  return { a, b, c, d, l1: mean + root, l2: mean - root };
}
/** Exact update of the fuse thermal images over dt at constant (I/In)² = x2. */
export function fuseStep(state: FuseState, x2: number, dt: number, tripTime: number): FuseState {
  const { a, b, c, d, l1, l2 } = fuseSystem(tripTime), steadyBody = x2 * (1 - FUSE_ELEMENT_SHARE);
  const u = state.theta - x2, v = state.body - steadyBody, e1 = Math.exp(l1 * dt), e2 = Math.exp(l2 * dt);
  // e^{At} = (e^{l1 t}(A − l2 I) − e^{l2 t}(A − l1 I)) / (l1 − l2)
  const k = 1 / (l1 - l2);
  const m11 = k * (e1 * (a - l2) - e2 * (a - l1)), m12 = k * (e1 - e2) * b, m21 = k * (e1 - e2) * c, m22 = k * (e1 * (d - l2) - e2 * (d - l1));
  return { theta: x2 + m11 * u + m12 * v, body: steadyBody + m21 * u + m22 * v };
}
/** Time until the element reaches the melting threshold at constant x2 from `state` (Infinity if it never does). */
export function fuseMeltTime(state: FuseState, x2: number, tripTime: number) {
  const melt = thermalThreshold("fuse") ** 2;
  if (state.theta >= melt) return 0;
  if (x2 <= melt) return Infinity;
  let lo = 0, hi = 1e-4 * tripTime;
  while (fuseStep(state, x2, hi, tripTime).theta < melt) { lo = hi; hi *= 2; if (hi > 1e7) return Infinity; }
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (fuseStep(state, x2, mid, tripTime).theta < melt) lo = mid; else hi = mid; }
  return hi;
}
/**
 * Trip threshold of the thermal image θ = (I/In)² in steady state. Fuses: 1.45, between the IEC 60269 gG
 * conventional non-fusing (1.25 × In) and fusing (1.6 × In) currents.
 */
export const thermalThreshold = (kind: Kind) => (kind === "motorProtector" ? 1.12 : kind === "fuse" ? 1.45 : 1.3);
/**
 * Thermal-image time constant: explicit for breakers, derived from the trip class for motor protectors.
 */
export function thermalTau(c: Component) {
  if (c.kind === "motorProtector") {
    const k2 = thermalThreshold(c.kind) ** 2, x2 = 7.2 * 7.2;
    return num(c.props, "tripClass", 10) / Math.log(x2 / (x2 - k2));
  }
  return num(c.props, "thermalTimeConstant", 60);
}
