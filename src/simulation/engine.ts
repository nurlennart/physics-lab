import { updateScenario, recordFeedbackTransitions } from "./challenges";
import { prop, isThermalMass, type Project, type ChallengeId } from "./model";
import {
  solveElectrical,
  solveLinear,
  type ElectricalResult,
} from "./electrical";
import { transitionError } from "./integrity";
import { Automation, allowedFaults, type FaultType } from "./automation";
import { readProbe } from "./measurements";
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) freeze(v);
    Object.freeze(value);
  }
  return value;
}
export const DT = 1 / 60;
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
  supplied: number;
  waterStored: number;
  heaterStored: number;
  stored: number;
  ambient: number;
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
          c.kind === "tank" ? prop(c, "initialTemperature", 20) : 20;
    this.solve(true, 0);
    this.log("Experiment initialized. Fixed timestep: 1/60 s.");
    this.sample();
  }
  refresh(project: Project): boolean {
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
    this.acceptedProject = structuredClone(project);
    this.project = freeze(structuredClone(project));
    this.ownedProject = this.project;
    this.electricalKey = "";
    for (const c of project.components)
      if (isThermalMass(c) && this.temperatures[c.id] === undefined)
        this.temperatures[c.id] =
          c.kind === "tank" ? prop(c, "initialTemperature", 20) : 20;
    return this.solve(true, 0);
  }
  private solve(control: boolean, dt: number) {
    try {
      if (control) this.automation.evaluate(this, dt);
      const key = JSON.stringify([
        this.automation.contacts,
        this.failed,
        this.faults,
        [...this.disconnected],
      ]);
      if (key !== this.electricalKey) {
        this.electrical = solveElectrical(this.project, this.failed, {
          contacts: this.automation.contacts,
          faults: this.faults,
          disconnected: this.disconnected,
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
    this.disconnected.add(id);
    this.log(`Connection ${id} disconnected by experiment fault.`, "warning");
    this.solve(true, 0);
    return null;
  }
  resetSafety(id: string) {
    const error = this.automation.manualReset(id, this);
    if (!error) this.solve(false, 0);
    return error;
  }
  pulse(id: string) {
    this.automation.pulses.add(id);
  }
  step(dt = DT): boolean {
    if (!Number.isFinite(dt) || dt <= 0 || dt > 0.1) {
      this.error = "Timestep must be finite, positive, and at most 0.1 s.";
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
    if (!this.solve(true, dt)) return false;
    recordFeedbackTransitions(this, oldContacts, oldHeaterPower);

    const p = this.project,
      thermal = p.components.filter(isThermalMass),
      index = new Map(thermal.map((c, i) => [c.id, i])),
      n = thermal.length;
    const a = Array.from({ length: n }, () => Array(n).fill(0)),
      b = Array(n).fill(0),
      old = thermal.map((c) => this.temperatures[c.id]);
    const caps = thermal.map((c) =>
      c.kind === "tank"
        ? prop(c, "volume") * 4180
        : prop(c, "heatCapacity", 20),
    );
    const losses = thermal.map((c) => [
      {
        ua: prop(c, "loss", 0),
        ambient: c.kind === "tank" ? prop(c, "ambient", 20) : 20,
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
        (caps[i] / dt) * old[i] + (this.electrical.readings[c.id]?.power ?? 0);
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
      const h = thermal[i].kind === "heater" ? thermal[i] : thermal[j];
      const ua = prop(h, "conductance", 180);
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
    thermal.forEach((c, i) => {
      this.temperatures[c.id] = temperatures[i];
      const stored = caps[i] * (temperatures[i] - old[i]);
      this.storedEnergy += stored;
      if (c.kind === "tank") this.waterStored += stored;
      if (c.kind === "heater") this.heaterStored += stored;
      for (const l of losses[i])
        this.ambientEnergy += l.ua * (temperatures[i] - l.ambient) * dt;
    });
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
        (c.kind === "source" ? -(r?.power ?? 0) : (r?.power ?? 0)) * dt;
      if (
        c.kind === "source" &&
        Math.abs(r?.current ?? 0) > prop(c, "maxCurrent", 20)
      ) {
        this.error = `${c.name}: supply current exceeds ${prop(c, "maxCurrent")} A. Simulation paused.`;
        this.violation(this.error, "error");
      }
      if (c.kind === "tank" && (temp > 95 || temp < 1)) {
        this.error = `${c.name}: water left the supported liquid range (1–95°C). Simulation paused.`;
        this.violation(this.error, "error");
      }
      if (r && c.kind !== "source") {
        const over =
          c.kind === "fuse"
            ? Math.abs(r.current) > prop(c, "ratedCurrent")
            : r.power > prop(c, "ratedPower", Infinity) * 1.001 ||
              Math.abs(r.contactCurrent ?? r.current) >
                prop(c, "ratedCurrent", Infinity) ||
              (r.voltageValid !== false &&
                Math.abs(r.voltage) > prop(c, "ratedVoltage", Infinity));
        this.overload[c.id] = over ? (this.overload[c.id] ?? 0) + dt : 0;
        if (over && !this.failed[c.id])
          this.automation.status[c.id] = "overloaded";
        if (
          this.overload[c.id] >= (c.kind === "fuse" ? 0.1 : 0.5) &&
          !this.failed[c.id]
        ) {
          this.fail(
            c.id,
            `${c.name}: ${c.kind === "fuse" ? "overcurrent — fuse opened" : "rating exceeded — component failed open"}.`,
          );
          changed = true;
        }
        if (temp > prop(c, "maxTemperature", Infinity) && !this.failed[c.id]) {
          this.fail(
            c.id,
            `${c.name}: overtemperature — component failed open.`,
          );
          changed = true;
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
    if (p.challenge) updateScenario(this, dt);
    if (this.time - this.lastSample >= 0.25 - 1e-9) this.sample();
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
      supplied: this.suppliedEnergy,
      waterStored: this.waterStored,
      heaterStored: this.heaterStored,
      stored: this.storedEnergy,
      ambient: this.ambientEnergy,
    });
    if (this.samples.length > 14400) this.samples.shift();
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
  ) {
    if (!running) {
      this.accumulator = 0;
      return 0;
    }
    this.accumulator += Math.min(Math.max(elapsed, 0), 0.25) * speed;
    let steps = 0;
    while (this.accumulator + 1e-10 >= DT && steps < 600) {
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
