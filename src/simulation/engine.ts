import { prop, type Project } from "./model";
import {
  solveElectrical,
  solveLinear,
  type ElectricalResult,
} from "./electrical";
import { challenges } from "./challenges";
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
}
export class Simulation {
  time = 0;
  energy = 0;
  ambientEnergy = 0;
  storedEnergy = 0;
  peakPower = 0;
  peakVoltage = 0;
  lightHold = 0;
  solverMs = 0;
  failed: Record<string, boolean> = {};
  temperatures: Record<string, number> = {};
  overload: Record<string, number> = {};
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
  constructor(public project: Project) {
    this.reset(project);
  }
  log(message: string, level: LogEvent["level"] = "info") {
    this.events.push({ time: this.time, level, message });
    if (this.events.length > 300) this.events.shift();
  }
  reset(project = this.project) {
    this.project = project;
    this.time = 0;
    this.energy = 0;
    this.ambientEnergy = 0;
    this.storedEnergy = 0;
    this.peakPower = 0;
    this.peakVoltage = 0;
    this.lightHold = 0;
    this.failed = {};
    this.overload = {};
    this.temperatures = {};
    this.violations = [];
    this.events = [];
    this.samples = [];
    this.lastSample = -Infinity;
    this.error = null;
    for (const c of project.components)
      this.temperatures[c.id] =
        c.kind === "tank" ? prop(c, "initialTemperature", 20) : 20;
    this.refresh(project);
    this.log("Experiment initialized. Fixed timestep: 1/60 s.");
    this.sample();
  }
  refresh(project: Project) {
    this.project = project;
    for (const c of project.components)
      if (this.temperatures[c.id] === undefined)
        this.temperatures[c.id] =
          c.kind === "tank" ? prop(c, "initialTemperature", 20) : 20;
    try {
      this.electrical = solveElectrical(project, this.failed);
      this.error = null;
    } catch (e) {
      const message = (e as Error).message;
      if (message !== this.error) this.log(message, "error");
      this.error = message;
    }
  }
  fail(id: string, message: string) {
    if (this.failed[id]) return;
    this.failed[id] = true;
    this.violations.push(message);
    this.log(message, "error");
  }
  step(dt = DT): boolean {
    const start = performance.now();
    this.refresh(this.project);
    if (this.error) return false;
    const p = this.project;
    const thermal = p.components.filter(
      (c) => c.kind !== "ground" && c.kind !== "source",
    );
    const index = new Map(thermal.map((c, i) => [c.id, i]));
    const n = thermal.length;
    const a = Array.from({ length: n }, () => Array(n).fill(0)),
      b = Array(n).fill(0);
    const old = thermal.map((c) => this.temperatures[c.id]);
    let loss = 0,
      stored = 0;
    thermal.forEach((c, i) => {
      const cap =
        c.kind === "tank"
          ? prop(c, "volume") * 4180
          : prop(c, "heatCapacity", 20);
      const ua = prop(c, "loss", 0),
        ambient = c.kind === "tank" ? prop(c, "ambient", 20) : 20;
      const power =
        c.kind === "tank" ? 0 : (this.electrical.readings[c.id]?.power ?? 0);
      a[i][i] = cap / dt + ua;
      b[i] = (cap / dt) * old[i] + power + ua * ambient;
    });
    for (const w of p.connections.filter((w) => w.domain === "thermal")) {
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
      const cap =
          c.kind === "tank"
            ? prop(c, "volume") * 4180
            : prop(c, "heatCapacity", 20),
        ambient = c.kind === "tank" ? prop(c, "ambient", 20) : 20;
      stored += cap * (temperatures[i] - old[i]);
      loss += prop(c, "loss", 0) * (temperatures[i] - ambient) * dt;
    });
    this.time += dt;
    this.energy += this.electrical.dissipatedPower * dt;
    this.ambientEnergy += loss;
    this.storedEnergy += stored;
    this.peakPower = Math.max(this.peakPower, this.electrical.sourcePower);
    this.peakVoltage = Math.max(
      this.peakVoltage,
      ...p.components
        .filter((c) => c.kind === "source")
        .map((c) => prop(c, "voltage")),
      0,
    );
    for (const c of p.components) {
      const r = this.electrical.readings[c.id],
        temp = this.temperatures[c.id] ?? 20;
      if (
        c.kind === "source" &&
        Math.abs(r?.current ?? 0) > prop(c, "maxCurrent", 20)
      ) {
        this.error = `${c.name}: supply current exceeds ${prop(c, "maxCurrent")} A. Simulation paused.`;
        if (!this.violations.includes(this.error)) {
          this.violations.push(this.error);
          this.log(this.error, "error");
        }
      }
      if (c.kind === "tank" && (temp > 95 || temp < 1)) {
        this.error = `${c.name}: water left the supported liquid range (1–95°C). Simulation paused.`;
        if (!this.violations.includes(this.error)) {
          this.violations.push(this.error);
          this.log(this.error, "error");
        }
      }
      if (r && c.kind !== "source" && c.kind !== "ground") {
        const over =
          c.kind === "fuse"
            ? Math.abs(r.current) > prop(c, "ratedCurrent")
            : r.power > prop(c, "ratedPower", Infinity) * 1.001;
        this.overload[c.id] = over ? (this.overload[c.id] ?? 0) + dt : 0;
        if ((this.overload[c.id] ?? 0) >= (c.kind === "fuse" ? 0.1 : 0.5))
          this.fail(
            c.id,
            `${c.name}: ${c.kind === "fuse" ? "overcurrent — fuse opened" : "power rating exceeded — element failed open"}.`,
          );
        if (temp > prop(c, "maxTemperature", Infinity))
          this.fail(c.id, `${c.name}: overtemperature — element failed open.`);
      }
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
    const assignment = p.challenge ? challenges[p.challenge] : null;
    for (const rule of assignment?.rules ?? []) {
      const measured =
        rule.metric === "peakVoltage"
          ? this.peakVoltage
          : rule.metric === "peakPower"
            ? this.peakPower
            : null;
      if (
        measured !== null &&
        rule.comparison === "max" &&
        measured > rule.target
      ) {
        const message = `Challenge constraint exceeded: ${rule.label}.`;
        if (!this.violations.includes(message)) {
          this.violations.push(message);
          this.log(message, "warning");
        }
      }
    }
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
        );
    const source = this.project.components.find((c) => c.kind === "source");
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
    });
    if (this.samples.length > 2400) this.samples.shift();
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
