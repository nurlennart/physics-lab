import { Devices } from "./devices";
import { Multiphysics } from "./multiphysics";
import { unitsSI as U, WATER_CP, WATER_RHO } from "./units";
import { updateScenario, recordFeedbackTransitions } from "./challenges";
import { prop, isThermalMass, isSource, isMotor, perPoleKinds, projectAmbient, portConductance, type Component, type Project, type ChallengeId } from "./model";
import {
  solveElectrical,
  solveLinear,
  sourceMode,
  type ElectricalResult,
  type ElectricalReading,
} from "./electrical";
import { FILAMENT_COLD, filamentEnergy, filamentRatio, filamentStep } from "./filament";
import { warnOnlyTemperature, thermalTau, thermalThreshold, fuseStep, fuseMeltTime } from "./parameters";
import { inventoryVolume } from "./water";
import { transitionError } from "./integrity";
import { Automation, allowedFaults, type FaultType } from "./automation";
import { readProbe, measurements } from "./measurements";
import { SpatialDynamics } from './spatial';
/** Time (s) a motor may draw more than rated current before it is reported (locked-rotor withstand, class 10). */
export const MOTOR_START_ALLOWANCE = 10;
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) freeze(v);
    Object.freeze(value);
  }
  return value;
}
export const DT = 1 / 60;
/** Largest step the adaptive integrator may take (thermal/electrical/control systems only). */
export const MAX_ADAPTIVE_STEP = 30;
/** Reverse dielectric voltage an aluminium electrolytic capacitor withstands (V). */
export const ELECTROLYTIC_REVERSE_LIMIT = 1;
export interface AdaptiveOptions {
  /** Largest temperature change of any thermal mass per step (K). */
  tolerance?: number;
  maxStep?: number;
  /** Stop after exactly this many steps (deterministic replay of a cancelled run). */
  maxSteps?: number;
}
/**
 * Event-aware adaptive time advancement for slow thermal systems. The thermal
 * network is integrated implicitly (backward Euler) and the energy ledger uses
 * the same implicit values, so conservation holds for every step size; the step
 * is bounded by a temperature-change tolerance, timer/sampling/PI/protection
 * time scales, and restarts at 1/60 s after every discrete event.
 */
export class AdaptiveRun {
  steps = 0;
  done = false;
  minStep = Infinity;
  maxTaken = 0;
  events = 0;
  private h = DT;
  readonly start: number;
  readonly end: number;
  readonly tolerance: number;
  readonly maxStep: number;
  constructor(private sim: Simulation, duration: number, readonly options: AdaptiveOptions = {}) {
    this.start = sim.time;
    this.end = sim.time + duration;
    this.tolerance = options.tolerance ?? 0.05;
    this.maxStep = Math.min(MAX_ADAPTIVE_STEP, options.maxStep ?? MAX_ADAPTIVE_STEP);
  }
  get progress() { return this.end > this.start ? Math.min(1, (this.sim.time - this.start) / (this.end - this.start)) : 1; }
  run(budgetMs = Infinity) {
    const s = this.sim, started = performance.now();
    while (!this.done) {
      if (this.options.maxSteps !== undefined && this.steps >= this.options.maxSteps) { this.done = true; break; }
      const remaining = this.end - s.time;
      if (remaining <= 1e-9) { this.done = true; break; }
      let h = Math.min(this.maxStep, 2 * this.h, s.adaptiveLimit(this.tolerance));
      h = Math.max(DT, h);
      if (remaining < h + DT / 2) h = remaining;
      const before = s.discreteSignature();
      if (!s.step(h, true)) { this.done = true; return false; }
      this.steps++;
      this.minStep = Math.min(this.minStep, h);
      this.maxTaken = Math.max(this.maxTaken, h);
      if (s.discreteSignature() !== before) { this.events++; this.h = DT; } else this.h = h;
      if (performance.now() - started >= budgetMs) break;
    }
    return true;
  }
}
export interface LogEvent {
  time: number;
  level: "info" | "warning" | "error" | "success";
  message: string;
}
export interface Sample {
  time: number;
  temperature: number;
  heaterTemperature: number;
  voltage: number;
  current: number;
  power: number;
  energy: number;
  values: Record<string, number | null>;
  kinetic: number;
  potential: number;
  shaftExport: number;
  massResidual: number;
  energyResidual: number;
  copper: number;
  pumpWork: number;
  hydraulicWork: number;
  dissipation: number;
  supplied: number;
  waterStored: number;
  heaterStored: number;
  stored: number;
  ambient: number;
  spatialEnergy: number; spatialExternal: number; mechanicalLoss: number;
}
export interface RunawayState {
  phase:
    | "warmup"
    | "regulating"
    | "fault"
    | "cooldown"
    | "recovery"
    | "complete";
  normalTime: number;
  inBand: number;
  recoveryTime: number;
  faultAt: number;
  cutoffAt: number;
  maxTemperature: number;
  switches: number;
  automaticSwitches: number;
  recoverySwitches: number;
  faultTargets: string[];
  safetyId: string;
  reduced: boolean;
  overshoot: number;
}
/**
 * Magnetic (instantaneous) release. The setting k·In is the RMS value of a symmetric current, as on
 * breaker curves (IEC 60898/60947-2); the release responds to the instantaneous current, so on AC it
 * trips when |i(t)| ≥ √2·k·In. An asymmetric switch-on current (DC offset of a motor inrush) can
 * therefore trip a release whose setting lies above the symmetric RMS current. DC: peak |i| ≥ k·In.
 */
function magneticRelease(r: ElectricalReading, current: number, setting: number) {
  // DC: the step's largest instantaneous current when storage transients resolve it (capacitor inrush), else |i|.
  if (!r.ac) { const peak = Math.max(current, r.peakCurrent ?? 0); return { trip: peak >= setting, message: `${peak.toFixed(1)} A reached the instantaneous setting of ${setting.toFixed(1)} A` }; }
  const peak = r.peakCurrent ?? Math.SQRT2 * current, threshold = Math.SQRT2 * setting;
  return { trip: peak >= threshold, message: `instantaneous current peak of ${peak.toFixed(1)} A reached √2 × the ${setting.toFixed(1)} A RMS setting (${threshold.toFixed(1)} A)` };
}
export class Simulation {
  private ownedProject!: Project;
  private electricalKey = "";
  private acceptedProject!: Project;
  private lockedChallenge?: ChallengeId;
  hydraulicChallenge = { inBand: 0, evaluated: 0, squaredError: 0, maxOvershoot: 0, faultInjected: false, switches: 0, previousOn: false, responseTime: 0, settledAt: 0, lowDemandFlow: 0, highDemandFlow: 0, lowDemandTime: 0, highDemandTime: 0 };
  devices = new Devices();
  multiphysics = new Multiphysics();
  spatial = new SpatialDynamics();
  mechanicalChallenge = { hold: 0, evaluated: 0, inBand: 0, squaredError: 0, peakError: 0, loadChanges: 0, lastLoadPhase: -1 };
  time = 0;
  energy = 0;
  suppliedEnergy = 0;
  ambientEnergy = 0;
  storedEnergy = 0;
  waterStored = 0;
  heaterStored = 0;
  peakPower = 0;
  peakVoltage = 0;
  lightHold = 0;
  solverMs = 0;
  failed: Record<string, boolean> = {};
  /** Latched protective trips (supply output protection), a subset of `failed`. */
  tripped: Record<string, string> = {};
  /** Thermal image θ = (I/In)² memory and trip state of breakers and motor protectors. */
  breakers: Record<string, { theta: number; tripped: boolean; body?: number }> = {};
  /** Lamp filament states u = T/T_op (see filament.ts); missing = cold. */
  filaments: Record<string, number> = {};
  /** Tanks currently spilling over their rim (for start/stop events). */
  overflowing: Record<string, boolean> = {};
  /** Inductors whose current is being interrupted with no path but the switching arc (logged once each time). */
  interruptions: Record<string, boolean> = {};
  /** Largest |dT/dt| of any thermal mass in the last step (K/s). */
  thermalRate = Infinity;
  sampleInterval = 0.25;
  temperatures: Record<string, number> = {};
  overload: Record<string, number> = {};
  /** Continuous time above rated current (s), for the motor starting allowance. */
  overCurrentTime: Record<string, number> = {};
  faults: Record<string, FaultType> = {};
  disconnected = new Set<string>();
  componentEnergy: Record<string, number> = {};
  automation = new Automation();
  violations: string[] = [];
  events: LogEvent[] = [];
  samples: Sample[] = [];
  electrical: ElectricalResult = {
    readings: {},
    nodes: {},
    sourcePower: 0,
    dissipatedPower: 0,
    residual: 0,
    islands: 0,
  };
  error: string | null = null;
  lastSample = -Infinity;
  runaway: RunawayState = {
    phase: "warmup",
    normalTime: 0,
    inBand: 0,
    recoveryTime: 0,
    faultAt: 0,
    cutoffAt: 0,
    maxTemperature: 20,
    switches: 0,
    automaticSwitches: 0,
    recoverySwitches: 0,
    faultTargets: [],
    safetyId: "",
    reduced: false,
    overshoot: 0,
  };
  constructor(public project: Project) {
    this.reset(project);
  }
  log = (message: string, level: LogEvent["level"] = "info") => {
    this.events.push({ time: this.time, level, message });
    if (this.events.length > 500) this.events.shift();
  };
  reset(project = this.project) {
    const invalid = transitionError(project, project, 0, project.challenge);
    if (invalid) throw Error(invalid);
    this.lockedChallenge = project.challenge;
    this.acceptedProject = structuredClone(project);
    this.project = freeze(structuredClone(project));
    this.ownedProject = this.project;
    this.time =
      this.energy =
      this.suppliedEnergy =
      this.ambientEnergy =
      this.storedEnergy =
      this.waterStored =
      this.heaterStored =
      this.peakPower =
      this.peakVoltage =
      this.lightHold =
        0;
    this.failed = {};
    this.tripped = {};
    this.breakers = {};
    this.filaments = {};
    this.overflowing = {};
    this.interruptions = {};
    this.thermalRate = Infinity;
    this.sampleInterval = 0.25;
    this.faults = {};
    this.disconnected = new Set();
    this.componentEnergy = {};
    this.overload = {};
    this.overCurrentTime = {};
    this.temperatures = {};
    this.violations = [];
    this.events = [];
    this.samples = [];
    this.lastSample = -Infinity;
    this.error = null;
    this.automation = new Automation();
    this.electricalKey = "";
    this.multiphysics = new Multiphysics();
    this.spatial = new SpatialDynamics(); this.spatial.initialize(this.project);
    this.multiphysics.initialize(this.project);
    this.devices = new Devices(); this.devices.initialize(this.project);
    this.mechanicalChallenge = { hold: 0, evaluated: 0, inBand: 0, squaredError: 0, peakError: 0, loadChanges: 0, lastLoadPhase: -1 };
    this.hydraulicChallenge = { inBand: 0, evaluated: 0, squaredError: 0, maxOvershoot: 0, faultInjected: false, switches: 0, previousOn: false, responseTime: 0, settledAt: 0, lowDemandFlow: 0, highDemandFlow: 0, lowDemandTime: 0, highDemandTime: 0 };
    this.runaway = {
      phase: "warmup",
      normalTime: 0,
      inBand: 0,
      recoveryTime: 0,
      faultAt: 0,
      cutoffAt: 0,
      maxTemperature: 20,
      switches: 0,
      automaticSwitches: 0,
      recoverySwitches: 0,
      faultTargets: [],
      safetyId: "",
      reduced: false,
      overshoot: 0,
    };
    for (const c of this.project.components)
      if (isThermalMass(c))
        this.temperatures[c.id] =
          c.kind === "tank" || c.kind === "thermalMass" ? prop(c, "initialTemperature", 20) : projectAmbient(this.project);
    this.solve(true, 0);
    this.log("Experiment initialized. Fixed timestep: 1/60 s.");
    this.sample();
  }
  refresh(project: Project): boolean {
    if (!this.lockedChallenge && project.challenge && this.time > 1e-10) {
      this.error = "Reset before entering a scored challenge.";
      return false;
    }
    const invalid = transitionError(
      this.acceptedProject,
      project,
      this.time,
      this.lockedChallenge,
    );
    if (invalid) {
      if (this.error !== invalid) this.log(invalid, "error");
      this.error = invalid;
      return false;
    }
    this.lockedChallenge ??= project.challenge;
    this.acceptedProject = structuredClone(project);
    this.project = freeze(structuredClone(project));
    this.ownedProject = this.project;
    this.electricalKey = "";
    if (this.time === 0) {
      this.spatial = new SpatialDynamics(); this.spatial.initialize(this.project); this.multiphysics = new Multiphysics(); this.multiphysics.initialize(this.project);
      // Build-mode edits must not leave latched controller state (e.g. a cutoff that tripped while its
      // sensor target was still unassigned): at t = 0 the state reflects only the final configuration.
      // Recorded pulses and injected faults stay; failures and trips cannot occur before time advances.
      const pulses = this.automation.pulses;
      this.automation = new Automation();
      this.automation.pulses = pulses;
      this.breakers = {};
    this.filaments = {};
      this.devices = new Devices(); this.devices.initialize(this.project);
    }
    for (const c of project.components)
      if (isThermalMass(c) && (this.time === 0 || this.temperatures[c.id] === undefined))
        this.temperatures[c.id] =
          c.kind === "tank" || c.kind === "thermalMass" ? prop(c, "initialTemperature", 20) : projectAmbient(project);
    const solved = this.solve(true, 0);
    // The recorded start reflects only the final build-mode configuration, not a superseded one
    // (e.g. 2 kW from a switch that was opened before the run).
    if (solved && this.time === 0) { this.samples = []; this.lastSample = -Infinity; this.sample(); }
    return solved;
  }
  private solve(control: boolean, dt: number) {
    try {
      // At initialization and paused edits, establish modeled measurements before sensing.
      // Advancing controls still sample the start of each physical integration interval.
      if (control && dt === 0 && this.hasFluidsOrMotors()) this.electrical = this.multiphysics.refresh(this);
      if (control) this.automation.evaluate(this, dt);
      const key = JSON.stringify([
        [...this.openDevices()],
        this.automation.contacts,
        this.failed,
        this.faults,
        [...this.disconnected],
      ]);
      if (this.hasFluidsOrMotors()) {
        this.electrical = this.multiphysics.refresh(this);
        this.electricalKey = "";
      } else if (key !== this.electricalKey || this.temperatureDependent()) {
        this.electrical = solveElectrical(this.project, this.failed, {
          ...this.devices.runtime(dt),
          contacts: this.automation.contacts,
          faults: this.faults,
          disconnected: this.disconnected,
          temperatures: this.temperatures,
          filaments: this.filamentRatios(),
          open: this.openDevices(),
        });
        this.electricalKey = key;
      }
      this.error = null;
      return true;
    } catch (e) {
      const message = (e as Error).message;
      if (message !== this.error) this.log(message, "error");
      this.error = message;
      return false;
    }
  }
  /** Tripped protective devices (a welded/stuck-closed fault keeps the contact conducting). */
  openDevices() {
    return new Set(Object.entries(this.breakers).filter(([id, b]) => b.tripped && this.faults[id] !== "stuckClosed").map(([id]) => id));
  }
  /** Re-close a tripped breaker after its thermal image has cooled below the rated level. */
  resetBreaker(id: string): string | null {
    const c = this.project.components.find((c) => c.id === id), b = this.breakers[id];
    if (!c || !b?.tripped) return "This breaker is not tripped.";
    if (b.theta > 1) return `Cannot re-close yet: thermal memory at ${(b.theta / thermalThreshold(c.kind) ** 2 * 100).toFixed(0)}% of trip level; let it cool below rated heating.`;
    b.tripped = false;
    this.log(`${c.name}: breaker re-closed manually.`, "success");
    return null;
  }
  /** Resistance depends on the simulated temperature (explicit coupling per step). */
  /** Lamp resistance relative to the configured hot resistance (filament temperature). */
  filamentRatios() {
    return Object.fromEntries(this.project.components.filter(c => c.kind === "lamp").map(c => [c.id, filamentRatio(this.filaments[c.id] ?? FILAMENT_COLD)]));
  }
  temperatureDependent() {
    return this.project.components.some((c) => c.kind === "lamp" || prop(c, "tempCoefficient") !== 0);
  }
  /** Null when adaptive stepping is valid for this experiment; otherwise the reason. */
  adaptiveUnavailable(): string | null {
    if (this.project.challenge) return "Scored challenges always use the fixed 1/60 s step.";
    if (this.spatial.hasMovingBodies) return "Rigid-body dynamics use the fixed 1/60 s step with contact substeps.";
    return null;
  }
  /** Step bound from controller, protection and thermal time scales. */
  adaptiveLimit(tolerance: number) {
    let limit = Math.min(MAX_ADAPTIVE_STEP, this.multiphysics.electricalStepLimit(this));
    if (this.automation.pulses.size) return DT;
    for (const c of this.project.components) {
      if (c.kind === "timer") limit = Math.min(limit, prop(c, "delay") / 20);
      if (prop(c, "sampleInterval") > 0) limit = Math.min(limit, prop(c, "sampleInterval"));
      if (c.kind === "pid") limit = Math.min(limit, 0.5, prop(c, "kd") ? prop(c, "derivativeFilter") / 2 : Infinity);
      if (c.kind === "filter") limit = Math.min(limit, Math.max(DT, prop(c, "timeConstant") / 5));
      if (prop(c, "lag") > 0) limit = Math.min(limit, Math.max(DT, prop(c, "lag") * 2));
      // Battery: at most 0.2 % state-of-charge change per step (its open-circuit voltage follows the charge).
      if (c.kind === "battery") {
        const current = Math.abs(this.electrical.readings[c.id]?.current ?? 0);
        if (current > 1e-12) limit = Math.min(limit, 0.002 * 3600 * prop(c, "capacityAh") / current);
      }
      // Capacitor: at most 1 % of its voltage scale (≥ 1 V) per step, so supply regulation changes, sensors and
      // thresholds that follow its voltage are resolved; each step is itself exact for the linear network.
      if (c.kind === "capacitor") {
        const current = Math.abs(this.electrical.readings[c.id]?.chargeCurrent ?? 0);
        if (current > 1e-15) limit = Math.min(limit, 0.01 * Math.max(1, Math.abs(this.devices.capacitors[c.id] ?? 0)) * prop(c, "capacitance") / current);
      }
      // Inductor: at most 1 % of its current scale (≥ 1 % of its rating) per step.
      if (c.kind === "inductor") {
        const voltage = Math.abs(this.electrical.readings[c.id]?.inductanceVoltage ?? 0);
        if (voltage > 1e-15) limit = Math.min(limit, 0.01 * Math.max(0.01 * prop(c, "ratedCurrent"), Math.abs(this.devices.inductors[c.id] ?? 0)) * prop(c, "inductance") / voltage);
      }
      // Contactor coil near a pickup or dropout threshold: resolve the crossing (timers then end substeps exactly).
      if (c.kind === "contactor") {
        const state = this.devices.contactors[c.id], voltage = Math.abs(this.electrical.readings[c.id]?.coilVoltage ?? 0), rated = prop(c, "coilVoltage");
        const threshold = rated * prop(c, state?.closed ? "dropoutRatio" : "pickupRatio");
        if (Math.abs(voltage - threshold) < 0.05 * rated) limit = Math.min(limit, 1);
      }
      // A starting allowance in progress: resolve its end (the over-current report).
      const overTime = this.overCurrentTime[c.id] ?? 0;
      if (overTime > 0 && overTime <= MOTOR_START_ALLOWANCE) limit = Math.min(limit, MOTOR_START_ALLOWANCE / 100);
      const r = this.electrical.readings[c.id];
      // Fuse: exact integration at constant current; resolve the melting instant if this current melts it.
      if (c.kind === "fuse" && r) {
        const b = this.breakers[c.id], x2 = (Math.abs(r.current) / prop(c, "ratedCurrent")) ** 2;
        const melt = fuseMeltTime({ theta: b?.theta ?? 0, body: b?.body ?? 0 }, x2, prop(c, "tripTime", 0.1));
        if (Number.isFinite(melt)) limit = Math.min(limit, Math.max(DT, melt / 10));
      }
      if ((c.kind === "breaker" || c.kind === "motorProtector") && r) {
        const x2 = (Math.abs(r.contactCurrent ?? r.current) / prop(c, "ratedCurrent")) ** 2;
        if (x2 > 0.8 * thermalThreshold(c.kind) ** 2) limit = Math.min(limit, thermalTau(c) / 200);
      }
      if ((c.kind === "sourceAC" || c.kind === "source3") && r && Math.abs(r.current) > 0.8 * prop(c, "maxCurrent"))
        limit = Math.min(limit, prop(c, "thermalTimeConstant", 60) / 200);
    }
    // Hydraulic storage: at most 1% of a tank's height (≥ 5 mm) per step; explicit level update.
    for (const c of this.project.components) {
      if (c.kind === "tank") {
        const q = Math.abs(this.multiphysics.hydraulic.readings[c.id]?.flow ?? 0), area = prop(c, "surfaceArea");
        if (q > 1e-12) limit = Math.min(limit, Math.max(0.005, 0.01 * prop(c, "capacity") / 1000 / area) * area / q);
        // Surcharged weir: explicit level update stays well inside its time constant A/(dQ/dh), dQ/dh = 1.5·Q/h.
        const reading = this.multiphysics.hydraulic.readings[c.id];
        if ((reading?.surcharge ?? 0) > 1e-9 && (reading?.overflow ?? 0) > 0) limit = Math.min(limit, 0.3 * area / (1.5 * reading!.overflow! / reading!.surcharge!));
      }
      if (c.kind === "actuatedValve" || c.kind === "pressureReducingValve") limit = Math.min(limit, prop(c, "responseTime") / 50);
      const motor = isMotor(c) ? this.multiphysics.motors[c.id] : undefined;
      if (motor && Math.abs(motor.acceleration) > 1e-9) limit = Math.min(limit, (0.002 * Math.abs(motor.omega) + 0.5) / Math.abs(motor.acceleration));
    }
    if (Number.isFinite(this.thermalRate) && this.thermalRate > 0) limit = Math.min(limit, tolerance / this.thermalRate);
    else if (!Number.isFinite(this.thermalRate)) limit = DT;
    return Math.max(DT, limit);
  }
  /** Discrete state used to detect events (switching, trips, failures, validity changes). */
  discreteSignature() {
    return JSON.stringify([
      this.automation.contacts,
      Object.keys(this.failed),
      [...this.openDevices()],
      Object.entries(this.automation.signals).map(([id, v]) => [id, v.valid, typeof v.value === "boolean" ? v.value : null]),
      Object.values(this.electrical.readings).map((r) => r.regulation ?? ""),
    ]);
  }
  /** Advance a fixed simulated duration with the adaptive integrator (blocking). */
  advanceAdaptive(duration: number, options: AdaptiveOptions = {}) {
    const run = new AdaptiveRun(this, duration, options);
    run.run();
    return run;
  }
  private hasFluidsOrMotors() {
    return this.spatial.hasMovingBodies || this.project.components.some(c => ["battery", "capacitor", "inductor", "contactor", "motor", "inductionMotor", "starDeltaStarter", "softStarter", "vfd", "pump", "pipe", "valve", "checkValve", "actuatedValve", "heatExchanger", "radiator", "pressureReducingValve"].includes(c.kind)
      // A tank whose inventory (e.g. by thermal expansion) rises above its rim needs the coupled step for weir overflow.
      || (c.kind === "tank" && (this.multiphysics.tanks[c.id]?.volume ?? 0) > prop(c, "capacity") / 1000 + 1e-12));
  }
  get energyResidual() {
    return this.suppliedEnergy + this.spatial.externalWork - this.storedEnergy - this.ambientEnergy
      - (this.spatial.energy - this.spatial.initialEnergy) - this.spatial.contactLoss - this.spatial.limitLoss - this.spatial.dampingLoss
      - this.multiphysics.kineticEnergy(this.project) - this.multiphysics.magneticEnergy(this.project)
      - (this.multiphysics.potential(this.project) - this.multiphysics.initialPotential)
      - this.multiphysics.externalShaftWork - this.multiphysics.removedEnergy;
  }
  mechanicalMeasurement = (id: string, metric: string): number | undefined => {
    const component = this.project.components.find(c => c.id === id);
    if (!component) return undefined;
    const b = this.spatial.readings[id];
    if (metric === 'rpm' && component.kind === 'pump') {
      const shaft = this.project.connections.find(w => w.domain === 'mechanical' && (w.from.component === id || w.to.component === id) && !this.disconnected.has(w.id));
      const driver = shaft && (shaft.from.component === id ? shaft.to.component : shaft.from.component);
      return driver ? this.mechanicalMeasurement(driver, 'rpm') : undefined;
    }
    if (metric === 'rpm') {
      const omega = isMotor(component) ? this.multiphysics.motors[id]?.omega : b?.omega;
      return omega === undefined ? undefined : omega * 30 / Math.PI;
    }
    return metric === 'x' ? b?.x : metric === 'y' ? b?.y : undefined;
  };
  mechanicalDemand(id: string, configured: number) {
    return this.project.challenge === 'rotation' && this.project.components.find(c => c.id === id)?.name === 'Variable shaft load' ? (Math.floor(this.time / 15) % 2 ? -1.2 : -0.4) : configured;
  }
  applyImpulse(id: string, impulse: { x: number; y: number }, angular = 0) {
    if (this.project.challenge) return 'External impulses are disabled in scored assignments.';
    if (![impulse.x, impulse.y, angular].every(Number.isFinite) || Math.hypot(impulse.x, impulse.y) > 10000 || Math.abs(angular) > 10000) return 'Impulse must be finite and at most 10,000 N·s / N·m·s.';
    const error = this.spatial.impulse(id, impulse, angular);
    if (!error) { this.log(`External impulse to ${id}: ${impulse.x}, ${impulse.y} N·s; ${angular} N·m·s.`); this.solve(true, 0); }
    return error;
  }
  fluidTemperatureMeasurement = (id: string): number | undefined => {
    const t = this.multiphysics.tanks[id], r = this.multiphysics.hydraulic.readings[id], cells = this.multiphysics.pipeCells[id];
    if (cells?.length) return cells.reduce((sum, temperature) => sum + temperature, 0) / cells.length - 273.15;
    if (t) return t.mass > 1e-10 ? t.temperature - 273.15 : undefined;
    const component = this.project.components.find(c => c.id === id || c.kind === "heatExchanger" && (id === `${c.id}#hot` || id === `${c.id}#cold`));
    // Match the hydraulic solver's stagnant-flow threshold: numerical leakage does not
    // establish a fluid temperature in a zero-inventory branch.
    if (component && measurements(component).includes("flow") && (!r || Math.abs(r.flow) < 1e-12)) return undefined;
    return r?.temperatureValid ? r.temperature - 273.15 : undefined;
  };
  hydraulicMeasurement(id: string, metric: string): number | undefined {
    const m = this.multiphysics, r = m.hydraulic.readings[id], t = m.tanks[id];
    if (metric === "level") {
      const c = this.project.components.find(c => c.id === id);
      return c?.kind === "tank" && t ? U.m3ToLiters(t.volume) / prop(c, "capacity") * 100 : undefined;
    }
    if (metric === "flow") return r?.flow;
    if (metric === "inletPressure") return r?.inletPressure;
    if (metric === "differentialPressure") return r?.differentialPressure;
    if (metric === "pressure") {
      if (r) return r.pressure;
      const c = this.project.components.find(c => c.id === id);
      // Bottom gauge pressure g·m/A (exact for any water density).
      return c?.kind === "tank" && t ? 9.80665 * t.mass / prop(c, "surfaceArea") : undefined;
    }
    return undefined;
  }
  fail(id: string, message: string) {
    if (this.failed[id]) return;
    this.failed[id] = true;
    this.violation(message, "error");
  }
  violation(message: string, level: LogEvent["level"] = "warning") {
    if (!this.violations.includes(message)) {
      this.violations.push(message);
      this.log(message, level);
    }
  }
  injectFault(
    id: string,
    fault: FaultType | null,
    scenario = false,
  ): string | null {
    if (this.project.challenge && !scenario)
      return "Fault injection is controlled by the scored scenario.";
    const c = this.project.components.find((c) => c.id === id);
    if (!c || (fault && !allowedFaults(c).includes(fault)))
      return "Unsupported fault for this component.";
    if ((c.kind === "actuatedValve" || c.kind === "pressureReducingValve") && (fault === "stuckClosed" || fault === "stuckOpen")) this.multiphysics.positions[id] = fault === "stuckOpen" ? 100 : 0;
    if (fault === "depleted" && c.kind === "tank") {
      const tank = this.multiphysics.tanks[id];
      this.multiphysics.removedMass += tank.mass;
      // Explicit draining operation: exported enthalpy uses the same CP*T datum as transport;
      // its potential energy leaves the system too.
      const referenceVolume = tank.mass / WATER_RHO;
      const potential = WATER_RHO * 9.80665 * (prop(c, "elevation") * referenceVolume + referenceVolume ** 2 / (2 * prop(c, "surfaceArea")));
      const removedHeat = tank.mass * WATER_CP * tank.temperature;
      this.multiphysics.removedEnergy += removedHeat + potential;
      this.storedEnergy -= removedHeat;
      this.waterStored -= removedHeat;
      tank.volume = tank.mass = 0;
    }
    if (fault) this.faults[id] = fault;
    else delete this.faults[id];
    this.log(
      `${c.name}: ${fault ? "fault injected — " + fault : "injected fault cleared"}.`,
      "warning",
    );
    this.solve(true, 0);
    return null;
  }
  disconnect(id: string): string | null {
    if (this.project.challenge)
      return "Wire faults are disabled in scored challenges.";
    if (!this.project.connections.some((w) => w.id === id))
      return "Connection not found.";
    const wire = this.project.connections.find(w => w.id === id)!;
    if (wire.domain === 'mechanical' && this.project.components.some(c => c.kind === 'rigidBody' && [wire.from.component, wire.to.component].includes(c.id))) return 'Reset to Build mode to detach a spatial shaft. Inject motor power loss to remove electrical torque while retaining rotor inertia.';
    this.disconnected.add(id);
    this.log(`Connection ${id} disconnected by experiment fault.`, "warning");
    this.solve(true, 0);
    return null;
  }
  resetSafety(id: string) {
    const kind = this.project.components.find((c) => c.id === id)?.kind;
    if (kind === "breaker" || kind === "motorProtector") {
      const error = this.resetBreaker(id);
      if (!error) this.solve(true, 0);
      return error;
    }
    const error = this.automation.manualReset(id, this);
    if (!error) this.solve(false, 0);
    return error;
  }
  pulse(id: string) {
    this.automation.pulses.add(id);
  }
  step(dt = DT, adaptive = false): boolean {
    if (!Number.isFinite(dt) || dt <= 0 || dt > (adaptive ? MAX_ADAPTIVE_STEP : 0.1)) {
      this.error = "Timestep must be finite, positive, and at most 0.1 s.";
      return false;
    }
    if (adaptive && dt > 0.1 + 1e-12 && this.adaptiveUnavailable()) {
      this.error = this.adaptiveUnavailable();
      return false;
    }
    // Editor/import transitions are checked once at refresh; the engine owns its validated copy.
    if (this.project !== this.ownedProject && !this.refresh(this.project))
      return false;
    const start = performance.now(),
      oldContacts = { ...this.automation.contacts },
      oldHeaterPower = this.project.components
        .filter((c) => c.kind === "heater")
        .reduce((n, c) => n + (this.electrical.readings[c.id]?.power ?? 0), 0);
    if (this.project.challenge === "pressure") {
      const demand = this.project.components.find(c => c.name === "Consumer demand");
      if (demand) this.multiphysics.positions[demand.id] = Math.floor(this.time / 60) % 2 ? 80 : 40;
    }
    if (!this.solve(true, dt)) return false;
    const deviceStorageBefore = this.devices.storedChange;
    const devicesBefore = this.devices.active ? this.devices.checkpoint() : undefined;
    recordFeedbackTransitions(this, oldContacts, oldHeaterPower);

    let coupled: ReturnType<Multiphysics["advance"]> | undefined;
    if (this.hasFluidsOrMotors()) {
      const state = this.multiphysics;
      const checkpoint = {
        tanks: Object.fromEntries(Object.entries(state.tanks).map(([id, t]) => [id, { ...t }])), motors: { ...state.motors }, positions: { ...state.positions },
        pipeCells: Object.fromEntries(Object.entries(state.pipeCells).map(([id, t]) => [id, [...t]])),
        overflowed: { ...state.overflowed }, overflowRate: { ...state.overflowRate }, removedMass: state.removedMass, removedEnergy: state.removedEnergy,
        hydraulic: state.hydraulic, transferred: { ...state.transferred }, copperEnergy: state.copperEnergy, frictionEnergy: state.frictionEnergy,
        pumpWork: state.pumpWork, hydraulicWork: state.hydraulicWork, dissipation: state.dissipation, externalShaftWork: state.externalShaftWork, dryLoss: state.dryLoss,
        starters: structuredClone(state.starters), drives: structuredClone(state.drives),
      };
      const temperaturesBefore = { ...this.temperatures };
      const spatialBefore = this.spatial.hasMovingBodies ? this.spatial.checkpoint() : undefined;
      const spatialLedger = { externalWork: this.spatial.externalWork, shaftWork: this.spatial.shaftWork, contactLoss: this.spatial.contactLoss, limitLoss: this.spatial.limitLoss, dampingLoss: this.spatial.dampingLoss, brakeEnergy: { ...this.spatial.brakeEnergy } };
      try {
        coupled = this.multiphysics.advance(this, dt);
        this.electrical = coupled.electrical;
        this.ambientEnergy += coupled.ambient;
        this.storedEnergy += coupled.thermalGain;
        this.waterStored += coupled.thermalGain;
      } catch (e) { Object.assign(this.devices, devicesBefore); Object.assign(this.multiphysics, checkpoint); if (spatialBefore) this.spatial.restore(spatialBefore); Object.assign(this.spatial, spatialLedger); this.temperatures = temperaturesBefore; this.error = (e as Error).message; this.log(this.error, "error"); return false; }
    }
    const p = this.project,
      thermal = p.components.filter(c => isThermalMass(c) && (c.kind !== "tank" || (this.multiphysics.tanks[c.id]?.mass ?? 0) > 1e-10 || prop(c, "vesselHeatCapacity") > 0)),
      index = new Map(thermal.map((c, i) => [c.id, i])),
      n = thermal.length;
    const a = Array.from({ length: n }, () => Array(n).fill(0)),
      b = Array(n).fill(0),
      old = thermal.map((c) => this.temperatures[c.id]);
    // Per-pole devices in a three-phase island are three identical poles/conductors.
    // Star-delta motor leads: a cable there stands for both lead sets (six conductors).
    const poles = (c: Component) => this.electrical.readings[c.id]?.conductors ?? (perPoleKinds.has(c.kind) && this.electrical.readings[c.id]?.phases === 3 ? 3 : 1);
    const caps = thermal.map((c) =>
      c.kind === "tank"
        ? (this.multiphysics.tanks[c.id]?.mass ?? prop(c, "volume")) * WATER_CP + prop(c, "vesselHeatCapacity")
        : prop(c, "heatCapacity", 20) * poles(c),
    );
    const environment = projectAmbient(p);
    const losses = thermal.map((c) => [
      {
        ua: prop(c, "loss", 0) * poles(c),
        ambient: c.kind === "tank" ? prop(c, "ambient", 20) : environment,
      },
    ]);
    for (const cooler of p.components.filter((c) => c.kind === "cooler")) {
      const signal = this.automation.input(cooler, "in", this),
        wired = p.connections.some(
          (w) => w.domain === "control" && w.to.component === cooler.id,
        );
      const active = wired
        ? signal.valid && signal.value === true
        : Boolean(cooler.props.enabled);
      const fault = this.faults[cooler.id];
      if (!active || fault === "coolingFailed") continue;
      const w = p.connections.find(
        (w) =>
          w.domain === "thermal" &&
          (w.from.component === cooler.id || w.to.component === cooler.id) &&
          !this.disconnected.has(w.id),
      );
      if (!w) continue;
      const target =
          w.from.component === cooler.id ? w.to.component : w.from.component,
        i = index.get(target);
      if (i !== undefined)
        losses[i].push({
          ua:
            prop(cooler, "conductance") *
            (fault === "coolingReduced" ? 0.5 : 1),
          ambient: prop(cooler, "ambient", 20),
        });
    }
    // Lamp filaments store part of the step's electrical energy; the rest heats the lamp body.
    const filaments: Record<string, { u: number; heat: number }> = {};
    for (const c of p.components.filter(c => c.kind === "lamp"))
      filaments[c.id] = filamentStep(c, this.filaments[c.id] ?? FILAMENT_COLD, this.failed[c.id] ? 0 : this.electrical.readings[c.id]?.power ?? 0, dt);
    thermal.forEach((c, i) => {
      a[i][i] = caps[i] / dt;
      b[i] =
        (caps[i] / dt) * old[i] + (isMotor(c) ? coupled?.heatPower[c.id] ?? 0 : filaments[c.id]?.heat ?? this.electrical.readings[c.id]?.heatPower ?? this.electrical.readings[c.id]?.power ?? 0);
      for (const l of losses[i]) {
        a[i][i] += l.ua;
        b[i] += l.ua * l.ambient;
      }
    });
    for (const w of p.connections.filter(
      (w) => w.domain === "thermal" && !this.disconnected.has(w.id),
    )) {
      const i = index.get(w.from.component),
        j = index.get(w.to.component);
      if (i === undefined || j === undefined) continue;
      // Series combination of both port conductances (a tank side is ideal).
      const ua = 1 / (1 / (portConductance(thermal[i]) * poles(thermal[i])) + 1 / (portConductance(thermal[j]) * poles(thermal[j])));
      a[i][i] += ua;
      a[j][j] += ua;
      a[i][j] -= ua;
      a[j][i] -= ua;
    }
    let temperatures: number[];
    try {
      temperatures = n ? solveLinear(a, b) : [];
    } catch (e) {
      this.error = `Thermal solver: ${(e as Error).message}`;
      return false;
    }
    this.storedEnergy += this.devices.storedChange - deviceStorageBefore;
    for (const [id, f] of Object.entries(filaments)) {
      const c = p.components.find(c => c.id === id)!;
      this.storedEnergy += filamentEnergy(c, f.u) - filamentEnergy(c, this.filaments[id] ?? FILAMENT_COLD);
      this.filaments[id] = f.u;
    }
    this.ambientEnergy += p.components.filter(c => c.kind === "radiator").reduce((sum, c) => sum + (this.electrical.readings[c.id]?.fanPower ?? 0) * dt, 0);
    this.thermalRate = n ? Math.max(0, ...thermal.map((_, i) => Math.abs(temperatures[i] - old[i]) / dt)) : 0;
    thermal.forEach((c, i) => {
      this.temperatures[c.id] = temperatures[i];
      if (c.kind === "tank" && this.multiphysics.tanks[c.id]) {
        const tank = this.multiphysics.tanks[c.id];
        tank.temperature = U.celsiusToK(temperatures[i]);
        // Thermal expansion: the inventory's volume (and level) follows the water density.
        tank.volume = inventoryVolume(tank.mass, tank.temperature);
      }
      const stored = caps[i] * (temperatures[i] - old[i]);
      this.storedEnergy += stored;
      if (c.kind === "tank") this.waterStored += stored;
      if (c.kind === "heater") this.heaterStored += stored;
      for (const l of losses[i])
        this.ambientEnergy += l.ua * (temperatures[i] - l.ambient) * dt;
    });
    if (coupled) {
      for (const c of p.components.filter(c => ["tank", "pipe", "pump", "valve", "checkValve", "actuatedValve", "fluidJunction", "heatExchanger", "radiator", "pressureReducingValve"].includes(c.kind))) {
        const r = this.multiphysics.hydraulic.readings[c.id];
        if (r && Math.max(r.pressure, r.inletPressure) > prop(c, "maxPressure")) this.violation(`${c.name}: hydraulic pressure rating exceeded.`, "error");
      }
      for (const c of p.components.filter((c) => c.kind === "tank")) {
        // Start/stop events use a 1e-6 m³/s (0.06 L/min) reporting threshold: a draining weir decays
        // asymptotically (h ~ 1/t²). The cumulative overflow volume is exact regardless.
        const rate = this.multiphysics.overflowRate[c.id] ?? 0, spilling = rate > (this.overflowing[c.id] ? 1e-6 : 2e-6);
        if (spilling !== !!this.overflowing[c.id]) {
          this.overflowing[c.id] = spilling;
          this.log(spilling
            ? `${c.name}: full — overflowing at ${U.m3sToLpm(rate).toFixed(2)} L/min over the rim (water, enthalpy and potential energy leave the system).`
            : `${c.name}: overflow stopped (${U.m3ToLiters(this.multiphysics.overflowed[c.id] ?? 0).toFixed(2)} L spilled in total).`, spilling ? "warning" : "info");
        }
      }
      for (const warning of this.multiphysics.hydraulic.diagnostics) {
        if (warning.includes("dry-run")) this.violation(warning);
        else if (!this.events.some(e => e.message === warning)) this.log(warning, "warning");
      }
    }
    this.time += dt;
    this.energy += this.electrical.dissipatedPower * dt;
    this.suppliedEnergy += this.electrical.sourcePower * dt;
    this.peakPower = Math.max(this.peakPower, this.electrical.sourcePower);
    this.peakVoltage = Math.max(
      this.peakVoltage,
      ...p.components
        .filter((c) => c.kind === "source")
        .map((c) => prop(c, "voltage")),
      0,
    );
    let changed = false;
    for (const c of p.components) {
      const r = this.electrical.readings[c.id],
        temp = this.temperatures[c.id] ?? 20;
      if (c.kind === "inductor") {
        const energy = -(r?.fieldPower ?? 0) * dt;
        if (r?.interrupted && !this.interruptions[c.id] && energy > 1e-9)
          this.log(`${c.name}: ${Math.sqrt(2 * energy / prop(c, "inductance")).toPrecision(3)} A interrupted with no current path — its field energy ½·L·I² = ${energy.toPrecision(3)} J went into the switching arc (booked as inductor heat). A freewheeling path across the inductor protects the switch.`, "warning");
        this.interruptions[c.id] = !!r?.interrupted;
      }
      this.componentEnergy[c.id] =
        (this.componentEnergy[c.id] ?? 0) +
        (isSource(c) ? -(r?.power ?? 0) : (r?.power ?? 0)) * dt;
      if (isSource(c) && r && !this.failed[c.id]) {
        const mode = sourceMode(c);
        const current = Math.abs(r.current), rating = prop(c, "maxCurrent", 20);
        if (c.kind === "sourceAC" || c.kind === "source3") {
          // Mains supplies: thermal-magnetic output protection with In = current rating, the same
          // characteristic as the breaker (thermal image θ, trip at θ ≥ 1.3²; instantaneous trip at
          // magneticTrip × In, compared with the instantaneous peak). Motor starting surges below the magnetic
          // threshold are tolerated.
          const b = (this.breakers[c.id] ??= { theta: 0, tripped: false }), x2 = (current / rating) ** 2;
          b.theta = x2 + (b.theta - x2) * Math.exp(-dt / prop(c, "thermalTimeConstant", 60));
          const release = magneticRelease(r, current, rating * prop(c, "magneticTrip", 10));
          if (release.trip || b.theta >= thermalThreshold("breaker") ** 2) {
            this.tripped[c.id] = `${c.name}: output protection tripped — ${release.trip ? release.message : `thermal overload at ${(current / rating).toFixed(2)} × the ${rating} A rating`}. Reduce the load or use a supply with a higher current rating; reset to re-arm.`;
            this.fail(c.id, this.tripped[c.id]);
            changed = true;
          } else if (current > rating * (1 + 1e-9))
            this.violation(`${c.name}: line current above its ${rating} A rating (tolerated short-term by the thermal overload characteristic).`);
        } else if ((mode === "ideal" || mode === "internal") && current > rating * (1 + 1e-9)) {
          this.tripped[c.id] = `${c.name}: ${current.toFixed(2)} A output current exceeded its ${rating} A rating — electronic output protection tripped. Reduce the load or use a supply with a higher current rating; reset to re-arm.`;
          this.fail(c.id, this.tripped[c.id]);
          changed = true;
        }
        if ((r.ac ? Math.hypot(r.power, r.reactivePower ?? 0) : Math.abs(r.power)) > prop(c, "maxPower", Infinity) * 1.001)
          this.violation(`${c.name}: ${r.ac ? "apparent" : "output"} power above its rated ${prop(c, "maxPower")} ${r.ac ? "VA" : "W"} (no supply thermal model; reported only).`);
      }
      if (c.kind === "tank" && (this.hydraulicMeasurement(c.id, "pressure") ?? 0) > prop(c, "maxPressure")) this.violation(`${c.name}: hydraulic pressure rating exceeded.`, "error");
      if (c.kind === "tank" && (temp > 95 || temp < 1)) {
        this.error = `${c.name}: water left the supported liquid range (1–95°C). Simulation paused.`;
        this.violation(this.error, "error");
      }
      // An electrolytic capacitor's oxide dielectric withstands only about 1 V of reverse bias.
      if (c.kind === "capacitor" && c.props.polarized && !this.failed[c.id] && (r?.ac || (this.devices.capacitors[c.id] ?? 0) < -ELECTROLYTIC_REVERSE_LIMIT)) {
        this.fail(c.id, `${c.name}: ${r?.ac ? "electrolytic capacitor on AC, reverse-biased every half cycle" : `electrolytic capacitor reverse-biased to ${(this.devices.capacitors[c.id] ?? 0).toFixed(2)} V`} — dielectric breakdown, vented and failed open. Mind its polarity (terminal a is +) or use a non-polarized capacitor.`);
        changed = true;
      }
      if (c.kind === "battery" && temp > prop(c, "maxTemperature") && !this.failed[c.id]) { this.fail(c.id, `${c.name}: battery overtemperature; protection disconnected the pack.`); changed = true; }
      if (r && !isSource(c)) {
        // Ratings: protective devices act on them; other elements report operation
        // outside rating and fail only through their modelled temperature.
        // A lamp's rating is its filament temperature at rated power: the cold-filament switch-on surge is not an overload.
        const overPower = c.kind === "lamp" ? (this.filaments[c.id] ?? FILAMENT_COLD) > 1.001 : (isMotor(c) ? this.multiphysics.motors[c.id]?.shaftPower ?? 0 : c.kind === "transformer" ? (r.phases ?? 1) * r.voltage * Math.abs(r.current) : r.power) > prop(c, "ratedPower", Infinity) * 1.001,
          rawOverCurrent = Math.abs(r.contactCurrent ?? r.current) > prop(c, "ratedCurrent", Infinity),
          overVoltage = c.kind !== "heater" && r.voltageValid !== false && Math.abs(r.voltage) * ((c.kind === "inductionMotor" || c.kind === "vfd") && r.phases === 3 ? Math.sqrt(3) : 1) * (c.kind === "motor" ? this.multiphysics.motors[c.id]?.duty ?? 1 : 1) > prop(c, "ratedVoltage", Infinity) * (c.kind === "inductionMotor" ? 1.05 : 1 + 1e-9); // motors: IEC 60034-1 zone A, ±5 %; a PWM-driven DC armature sees duty × bus voltage
        // Motors draw several times rated current while starting direct-on-line; that is normal operation.
        // Current above rating is reported only once it persists beyond the starting allowance; winding
        // temperature still decides failure.
        this.overCurrentTime[c.id] = rawOverCurrent ? (this.overCurrentTime[c.id] ?? 0) + dt : 0;
        // Starters carry the motor's starting current by design (AC-3 rating); a cable's rating is its continuous
        // ampacity and its conductor temperature is modelled. Both get the motor starting allowance.
        const startTolerant = isMotor(c) || c.kind === "starDeltaStarter" || c.kind === "softStarter" || c.kind === "cable";
        const overCurrent = startTolerant ? this.overCurrentTime[c.id] > MOTOR_START_ALLOWANCE : rawOverCurrent;
        const protective = c.kind === "fuse" || c.kind === "breaker" || c.kind === "motorProtector";
        const over = protective ? overCurrent : overPower || overCurrent || overVoltage;
        this.overload[c.id] = over ? (this.overload[c.id] ?? 0) + dt : 0;
        if (over && !this.failed[c.id])
          this.automation.status[c.id] = "overloaded";
        if (over && !protective && !this.failed[c.id]) {
          for (const [quantity, exceeded] of [["power", overPower], ["current", overCurrent], ["voltage", overVoltage]] as const)
            if (exceeded) this.violation(quantity === "current" && startTolerant ? `${c.name}: above its rated current for more than ${MOTOR_START_ALLOWANCE} s (normal starting current is tolerated). Consequences follow from its modelled temperature.` : `${c.name}: operated outside its ${quantity} rating. Consequences follow from its modelled temperature.`);
        }
        if (c.kind === "fuse" && !this.failed[c.id]) {
          // Element and body thermal images (exact update over the interval); the element melts at θ ≥ 1.45².
          const b = (this.breakers[c.id] ??= { theta: 0, tripped: false }), x2 = (Math.abs(r.current) / prop(c, "ratedCurrent")) ** 2;
          const next = fuseStep({ theta: b.theta, body: b.body ?? 0 }, x2, dt, prop(c, "tripTime", 0.1));
          b.theta = next.theta; b.body = next.body;
          if (b.theta >= thermalThreshold("fuse") ** 2) {
            this.fail(c.id, `${c.name}: overcurrent — fuse element melted (${Math.sqrt(x2).toFixed(2)} × In).`);
            changed = true;
          }
        }
        if ((c.kind === "breaker" || c.kind === "motorProtector") && !this.failed[c.id]) {
          const b = (this.breakers[c.id] ??= { theta: 0, tripped: false });
          const current = Math.abs(r.contactCurrent ?? r.current), x2 = (current / prop(c, "ratedCurrent")) ** 2;
          // Exact thermal-image update for the current held over the interval.
          b.theta = x2 + (b.theta - x2) * Math.exp(-dt / thermalTau(c));
          const release = magneticRelease(r, current, prop(c, "ratedCurrent") * prop(c, "magneticTrip"));
          if (!b.tripped && (release.trip || b.theta >= thermalThreshold(c.kind) ** 2) && this.faults[c.id] !== "stuckClosed") {
            b.tripped = true;
            changed = true;
            this.log(`${c.name}: ${release.trip ? `magnetic trip — ${release.message}` : `thermal overload trip (${(current / prop(c, "ratedCurrent")).toFixed(2)} × In)`}. Re-close after cooling.`, "warning");
            if (current > prop(c, "breakingCapacity"))
              this.violation(`${c.name}: interrupted current above its breaking capacity (arc and destruction are not modelled).`, "error");
          }
        }
        if (temp > prop(c, "maxTemperature", Infinity) && !this.failed[c.id]) {
          if (warnOnlyTemperature.has(c.kind))
            this.violation(`${c.name}: conductor above its insulation temperature limit (insulation damage is not modelled).`);
          else {
            this.fail(
              c.id,
              `${c.name}: overtemperature — component failed open.`,
            );
            changed = true;
          }
        }
      }
    }
    // Failures take effect at the interval boundary; retain the correctly integrated pre-trip energy.
    if (changed) {
      const error = this.error;
      this.solve(true, 0);
      this.error = error;
    }
    const lamp = p.components.some(
      (c) =>
        c.kind === "lamp" &&
        !this.failed[c.id] &&
        (this.electrical.readings[c.id]?.power ?? 0) >=
          prop(c, "ratedPower") * 0.5 &&
        (this.electrical.readings[c.id]?.power ?? 0) <= prop(c, "ratedPower"),
    );
    this.lightHold = lamp ? this.lightHold + dt : 0;
    if (
      p.challenge &&
      this.peakPower > (p.challenge === "light" ? Infinity : 2000.01)
    )
      this.violation(
        "Challenge constraint exceeded: Electrical input at most 2,000 W.",
      );
    if (p.challenge === "light" && this.peakVoltage > 12)
      this.violation(
        "Challenge constraint exceeded: Supply voltage at most 12 V.",
      );
    if (coupled) {
      this.multiphysics.residual = this.energyResidual;
      if (Math.abs(this.multiphysics.massResidual) > 1e-6) this.violation("Mass conservation residual exceeds 1 mg.", "error");
      const mechanicalScale = this.spatial.count ? Math.abs(this.spatial.initialEnergy) + Math.abs(this.spatial.externalWork) : 0;
      if (Math.abs(this.energyResidual) > Math.max(0.5, (Math.abs(this.suppliedEnergy) + mechanicalScale) * 0.005)) this.violation("Energy conservation residual exceeds 0.5 J / 0.5% of supplied and initial mechanical energy tolerance.", "error");
    }
    if (p.challenge) updateScenario(this, dt);
    if (this.time - this.lastSample >= this.sampleInterval - 1e-9) this.sample();
    this.solverMs = performance.now() - start;
    return !this.error;
  }
  sample() {
    const tank = this.project.components.find((c) => c.kind === "tank"),
      heater = this.project.components.find((c) => c.kind === "heater"),
      load =
        heater ??
        this.project.components.find(
          (c) => c.kind === "lamp" || c.kind === "resistor",
        ),
      source = this.project.components.find((c) => c.kind === "source");
    this.samples.push({
      time: this.time,
      temperature: tank ? this.temperatures[tank.id] : 20,
      heaterTemperature: heater ? this.temperatures[heater.id] : 20,
      voltage: source ? (this.electrical.readings[source.id]?.voltage ?? 0) : 0,
      current: load
        ? Math.abs(this.electrical.readings[load.id]?.current ?? 0)
        : 0,
      power: this.electrical.sourcePower,
      energy: this.energy,
      values: Object.fromEntries(
        (this.project.probes ?? []).map((p) => [p.id, readProbe(p, this)]),
      ),
      kinetic: this.multiphysics.kineticEnergy(this.project),
      potential: this.multiphysics.potential(this.project) - this.multiphysics.initialPotential,
      shaftExport: this.multiphysics.externalShaftWork + this.multiphysics.removedEnergy,
      massResidual: this.multiphysics.massResidual,
      energyResidual: this.energyResidual,
      copper: this.multiphysics.copperEnergy,
      pumpWork: this.multiphysics.pumpWork,
      hydraulicWork: this.multiphysics.hydraulicWork,
      dissipation: this.multiphysics.dissipation,
      supplied: this.suppliedEnergy,
      spatialEnergy: this.spatial.energy,
      spatialExternal: this.spatial.externalWork,
      mechanicalLoss: this.spatial.contactLoss + this.spatial.limitLoss + this.spatial.dampingLoss,
      waterStored: this.waterStored,
      heaterStored: this.heaterStored,
      stored: this.storedEnergy,
      ambient: this.ambientEnergy,
    });
    // Long experiments keep their full history at progressively coarser spacing.
    if (this.samples.length > 14400) {
      this.samples = this.samples.filter((_, i, all) => i % 2 === 0 || i === all.length - 1);
      this.sampleInterval *= 2;
    }
    this.lastSample = this.time;
  }
}
export class FixedClock {
  accumulator = 0;
  dropped = 0;
  advance(
    elapsed: number,
    speed: number,
    running: boolean,
    step: () => boolean,
    budgetMs = Infinity,
  ) {
    if (!running) {
      this.accumulator = 0;
      return 0;
    }
    this.accumulator += Math.min(Math.max(elapsed, 0), 0.25) * speed;
    // Preserve fixed physics steps while bounding catch-up work on a slow browser.
    if (this.accumulator > 1) { this.dropped += this.accumulator - 1; this.accumulator = 1; }
    const started = performance.now();
    let steps = 0;
    while (this.accumulator + 1e-10 >= DT && steps < 600) {
      if (steps > 0 && performance.now() - started >= budgetMs) break;
      if (!step()) {
        this.accumulator = 0;
        break;
      }
      this.accumulator -= DT;
      steps++;
    }
    if (steps === 600 && this.accumulator > DT) {
      this.dropped += this.accumulator;
      this.accumulator = 0;
    }
    return steps;
  }
}
