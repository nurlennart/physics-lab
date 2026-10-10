import { Multiphysics } from "./multiphysics";
import { unitsSI as U, WATER_CP, WATER_RHO } from "./units";
import { updateScenario, recordFeedbackTransitions } from "./challenges";
import { prop, isThermalMass, isSource, perPoleKinds, projectAmbient, portConductance, type Component, type Project, type ChallengeId } from "./model";
import {
  solveElectrical,
  solveLinear,
  sourceMode,
  type ElectricalResult,
} from "./electrical";
import { warnOnlyTemperature, thermalTau, thermalThreshold } from "./parameters";
import { transitionError } from "./integrity";
import { Automation, allowedFaults, type FaultType } from "./automation";
import { readProbe } from "./measurements";
import { SpatialDynamics } from './spatial';
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
export class Simulation {
  private ownedProject!: Project;
  private electricalKey = "";
  private acceptedProject!: Project;
  private lockedChallenge?: ChallengeId;
  hydraulicChallenge = { inBand: 0, evaluated: 0, squaredError: 0, maxOvershoot: 0, faultInjected: false, switches: 0, previousOn: false, responseTime: 0, settledAt: 0, lowDemandFlow: 0, highDemandFlow: 0, lowDemandTime: 0, highDemandTime: 0 };
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
  breakers: Record<string, { theta: number; tripped: boolean }> = {};
  /** Tanks currently spilling over their rim (for start/stop events). */
  overflowing: Record<string, boolean> = {};
  /** Largest |dT/dt| of any thermal mass in the last step (K/s). */
  thermalRate = Infinity;
  sampleInterval = 0.25;
  temperatures: Record<string, number> = {};
  overload: Record<string, number> = {};
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
    this.overflowing = {};
    this.thermalRate = Infinity;
    this.sampleInterval = 0.25;
    this.faults = {};
    this.disconnected = new Set();
    this.componentEnergy = {};
    this.overload = {};
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
    if (this.time === 0) { this.spatial = new SpatialDynamics(); this.spatial.initialize(this.project); this.multiphysics = new Multiphysics(); this.multiphysics.initialize(this.project); }
    for (const c of project.components)
      if (isThermalMass(c) && (this.time === 0 || this.temperatures[c.id] === undefined))
        this.temperatures[c.id] =
          c.kind === "tank" || c.kind === "thermalMass" ? prop(c, "initialTemperature", 20) : projectAmbient(project);
    return this.solve(true, 0);
  }
  private solve(control: boolean, dt: number) {
    try {
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
          contacts: this.automation.contacts,
          faults: this.faults,
          disconnected: this.disconnected,
          temperatures: this.temperatures,
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
  temperatureDependent() {
    return this.project.components.some((c) => prop(c, "tempCoefficient") !== 0);
  }
  /** Null when adaptive stepping is valid for this experiment; otherwise the reason. */
  adaptiveUnavailable(): string | null {
    if (this.project.challenge) return "Scored challenges always use the fixed 1/60 s step.";
    if (this.spatial.count > 0) return "Rigid-body dynamics use the fixed 1/60 s step with contact substeps.";
    return null;
  }
  /** Step bound from controller, protection and thermal time scales. */
  adaptiveLimit(tolerance: number) {
    let limit = MAX_ADAPTIVE_STEP;
    if (this.automation.pulses.size) return DT;
    for (const c of this.project.components) {
      if (c.kind === "timer") limit = Math.min(limit, prop(c, "delay") / 20);
      if (prop(c, "sampleInterval") > 0) limit = Math.min(limit, prop(c, "sampleInterval"));
      if (c.kind === "pid") limit = Math.min(limit, 0.5, prop(c, "kd") ? prop(c, "derivativeFilter") / 2 : Infinity);
      if (c.kind === "filter") limit = Math.min(limit, Math.max(DT, prop(c, "timeConstant") / 5));
      if (prop(c, "lag") > 0) limit = Math.min(limit, Math.max(DT, prop(c, "lag") * 2));
      if ((this.overload[c.id] ?? 0) > 0) return DT;
      const r = this.electrical.readings[c.id];
      if ((c.kind === "breaker" || c.kind === "motorProtector") && r) {
        const x2 = (Math.abs(r.contactCurrent ?? r.current) / prop(c, "ratedCurrent")) ** 2;
        if (x2 > 0.8 * thermalThreshold(c.kind) ** 2) limit = Math.min(limit, thermalTau(c) / 200);
      }
      // Below rating a fuse cannot trip without an event (which restarts at 1/60 s); near it, resolve the trip time.
      if (c.kind === "fuse" && r && Math.abs(r.current) > 0.95 * prop(c, "ratedCurrent")) limit = Math.min(limit, prop(c, "tripTime", 0.1) / 10);
    }
    // Hydraulic storage: at most 1% of a tank's height (≥ 5 mm) per step; explicit level update.
    for (const c of this.project.components) {
      if (c.kind === "tank") {
        const q = Math.abs(this.multiphysics.hydraulic.readings[c.id]?.flow ?? 0), area = prop(c, "surfaceArea");
        const full = (this.multiphysics.tanks[c.id]?.volume ?? 0) >= prop(c, "capacity") / 1000 - 1e-9;
        if (q > 1e-12 && !(full && (this.multiphysics.overflowRate[c.id] ?? 0) > 0)) limit = Math.min(limit, Math.max(0.005, 0.01 * prop(c, "capacity") / 1000 / area) * area / q);
      }
      if (c.kind === "actuatedValve" || c.kind === "pressureReducingValve") limit = Math.min(limit, prop(c, "responseTime") / 50);
      const motor = c.kind === "motor" ? this.multiphysics.motors[c.id] : undefined;
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
    return this.spatial.hasMovingBodies || this.project.components.some(c => ["motor", "pump", "pipe", "valve", "checkValve", "actuatedValve", "heatExchanger", "pressureReducingValve"].includes(c.kind));
  }
  get energyResidual() {
    return this.suppliedEnergy + this.spatial.externalWork - this.storedEnergy - this.ambientEnergy
      - (this.spatial.energy - this.spatial.initialEnergy) - this.spatial.contactLoss - this.spatial.limitLoss - this.spatial.dampingLoss
      - this.multiphysics.kineticEnergy(this.project)
      - (this.multiphysics.potential(this.project) - this.multiphysics.initialPotential)
      - this.multiphysics.externalShaftWork - this.multiphysics.removedEnergy;
  }
  mechanicalMeasurement = (id: string, metric: string): number | undefined => {
    const b = this.spatial.readings[id];
    if (metric === 'rpm') return (b?.omega ?? this.multiphysics.motors[id]?.omega) === undefined ? undefined : (b?.omega ?? this.multiphysics.motors[id].omega) * 30 / Math.PI;
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
  hydraulicMeasurement(id: string, metric: string): number | undefined {
    const m = this.multiphysics, r = m.hydraulic.readings[id], t = m.tanks[id];
    if (metric === "level") {
      const c = this.project.components.find(c => c.id === id);
      return c?.kind === "tank" && t ? U.m3ToLiters(t.volume) / prop(c, "capacity") * 100 : undefined;
    }
    if (metric === "flow") return r?.flow;
    if (metric === "pressure") {
      if (r) return r.pressure;
      const c = this.project.components.find(c => c.id === id);
      return c?.kind === "tank" && t ? WATER_RHO * 9.80665 * t.volume / prop(c, "surfaceArea") : undefined;
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
      const potential = WATER_RHO * 9.80665 * (prop(c, "elevation") * tank.volume + tank.volume ** 2 / (2 * prop(c, "surfaceArea")));
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
      } catch (e) { Object.assign(this.multiphysics, checkpoint); if (spatialBefore) this.spatial.restore(spatialBefore); Object.assign(this.spatial, spatialLedger); this.temperatures = temperaturesBefore; this.error = (e as Error).message; this.log(this.error, "error"); return false; }
    }
    const p = this.project,
      thermal = p.components.filter(c => isThermalMass(c) && (c.kind !== "tank" || (this.multiphysics.tanks[c.id]?.mass ?? 0) > 1e-10)),
      index = new Map(thermal.map((c, i) => [c.id, i])),
      n = thermal.length;
    const a = Array.from({ length: n }, () => Array(n).fill(0)),
      b = Array(n).fill(0),
      old = thermal.map((c) => this.temperatures[c.id]);
    // Per-pole devices in a three-phase island are three identical poles/conductors.
    const poles = (c: Component) => (perPoleKinds.has(c.kind) && this.electrical.readings[c.id]?.phases === 3 ? 3 : 1);
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
    thermal.forEach((c, i) => {
      a[i][i] = caps[i] / dt;
      b[i] =
        (caps[i] / dt) * old[i] + (c.kind === "motor" ? coupled?.heatPower[c.id] ?? 0 : this.electrical.readings[c.id]?.power ?? 0);
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
    this.thermalRate = n ? Math.max(0, ...thermal.map((_, i) => Math.abs(temperatures[i] - old[i]) / dt)) : 0;
    thermal.forEach((c, i) => {
      this.temperatures[c.id] = temperatures[i];
      if (c.kind === "tank" && this.multiphysics.tanks[c.id]) this.multiphysics.tanks[c.id].temperature = U.celsiusToK(temperatures[i]);
      const stored = caps[i] * (temperatures[i] - old[i]);
      this.storedEnergy += stored;
      if (c.kind === "tank") this.waterStored += stored;
      if (c.kind === "heater") this.heaterStored += stored;
      for (const l of losses[i])
        this.ambientEnergy += l.ua * (temperatures[i] - l.ambient) * dt;
    });
    if (coupled) {
      for (const c of p.components.filter(c => ["tank", "pipe", "pump", "valve", "checkValve", "actuatedValve", "fluidJunction", "heatExchanger", "pressureReducingValve"].includes(c.kind))) {
        const r = this.multiphysics.hydraulic.readings[c.id];
        if (r && Math.max(r.pressure, r.inletPressure) > prop(c, "maxPressure")) this.violation(`${c.name}: hydraulic pressure rating exceeded.`, "error");
      }
      for (const c of p.components.filter((c) => c.kind === "tank")) {
        const rate = this.multiphysics.overflowRate[c.id] ?? 0, spilling = rate > 1e-9;
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
      this.componentEnergy[c.id] =
        (this.componentEnergy[c.id] ?? 0) +
        (isSource(c) ? -(r?.power ?? 0) : (r?.power ?? 0)) * dt;
      if (isSource(c) && r && !this.failed[c.id]) {
        const mode = sourceMode(c);
        if ((mode === "ideal" || mode === "internal") && Math.abs(r.current) > prop(c, "maxCurrent", 20) * (1 + 1e-9)) {
          this.tripped[c.id] = `${c.name}: output current exceeded its ${prop(c, "maxCurrent")} A rating — output protection tripped. Reset the experiment to re-arm.`;
          this.fail(c.id, this.tripped[c.id]);
          changed = true;
        }
        if (Math.abs(r.power) > prop(c, "maxPower", Infinity) * 1.001)
          this.violation(`${c.name}: output power above its rated ${prop(c, "maxPower")} W (no supply thermal model; reported only).`);
      }
      if (c.kind === "tank" && (this.hydraulicMeasurement(c.id, "pressure") ?? 0) > prop(c, "maxPressure")) this.violation(`${c.name}: hydraulic pressure rating exceeded.`, "error");
      if (c.kind === "tank" && (temp > 95 || temp < 1)) {
        this.error = `${c.name}: water left the supported liquid range (1–95°C). Simulation paused.`;
        this.violation(this.error, "error");
      }
      if (r && !isSource(c)) {
        // Ratings: protective devices act on them; other elements report operation
        // outside rating and fail only through their modelled temperature.
        const overPower = r.power > prop(c, "ratedPower", Infinity) * 1.001,
          overCurrent = Math.abs(r.contactCurrent ?? r.current) > prop(c, "ratedCurrent", Infinity),
          overVoltage = c.kind !== "heater" && r.voltageValid !== false && Math.abs(r.voltage) > prop(c, "ratedVoltage", Infinity);
        const protective = c.kind === "fuse" || c.kind === "breaker" || c.kind === "motorProtector";
        const over = protective ? overCurrent : overPower || overCurrent || overVoltage;
        this.overload[c.id] = over ? (this.overload[c.id] ?? 0) + dt : 0;
        if (over && !this.failed[c.id])
          this.automation.status[c.id] = "overloaded";
        if (over && !protective && !this.failed[c.id])
          this.violation(`${c.name}: operated outside its ${overPower ? "power" : overCurrent ? "current" : "voltage"} rating. Consequences follow from its modelled temperature.`);
        if (c.kind === "fuse" && this.overload[c.id] >= prop(c, "tripTime", 0.1) - 1e-12 && !this.failed[c.id]) {
          this.fail(c.id, `${c.name}: overcurrent — fuse opened.`);
          changed = true;
        }
        if ((c.kind === "breaker" || c.kind === "motorProtector") && !this.failed[c.id]) {
          const b = (this.breakers[c.id] ??= { theta: 0, tripped: false });
          const current = Math.abs(r.contactCurrent ?? r.current), x2 = (current / prop(c, "ratedCurrent")) ** 2;
          // Exact thermal-image update for the current held over the interval.
          b.theta = x2 + (b.theta - x2) * Math.exp(-dt / thermalTau(c));
          const magnetic = current >= prop(c, "ratedCurrent") * prop(c, "magneticTrip");
          if (!b.tripped && (magnetic || b.theta >= thermalThreshold(c.kind) ** 2) && this.faults[c.id] !== "stuckClosed") {
            b.tripped = true;
            changed = true;
            this.log(`${c.name}: ${magnetic ? `magnetic trip at ${current.toFixed(1)} A` : `thermal overload trip (${(current / prop(c, "ratedCurrent")).toFixed(2)} × In)`}. Re-close after cooling.`, "warning");
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
