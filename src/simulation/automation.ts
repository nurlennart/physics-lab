import { compatibleTarget, sensorMeasurement } from "./capabilities";
import {
  definitions,
  prop,
  textProp,
  type Project,
  type Component,
} from "./model";
export type FaultType =
  | "powerLoss" | "motorFailure" | "stuckOpen" | "depleted"
  | "failedOpen"
  | "stuckClosed"
  | "sensorFault"
  | "controlLost"
  | "disabled"
  | "coolingFailed"
  | "coolingReduced";
export type Status =
  | "healthy"
  | "overloaded"
  | "tripped"
  | "failedOpen"
  | "stuckClosed"
  | "sensorFault"
  | "controlLost";
export interface Signal {
  valid: boolean;
  value: number | boolean | null;
  reason?: string;
}
export interface ControlMemory {
  on: boolean;
  elapsed: number;
  previous: boolean;
  filtered?: number;
  sampledAt?: number;
  sampledValue?: number;
  tripped: boolean;
  switches: number;
  lastChange: number;
  manualResets: number;
  integral?: number;
  output?: number;
  measurement?: number;
  derivative?: number;
}
export interface ControlWorld {
  mechanicalMeasurement?: (id: string, metric: string) => number | undefined;
  fluidTemperatureMeasurement?: (id: string) => number | undefined;
  hydraulicMeasurement?: (id: string, metric: string) => number | undefined;
  project: Project;
  time: number;
  temperatures: Record<string, number>;
  spaceTemperatures?: Record<string, number>;
  faults: Record<string, FaultType>;
  failed: Record<string, boolean>;
  disconnected: Set<string>;
  breakers?: Record<string, { tripped: boolean }>;
  log: (
    message: string,
    level?: "info" | "warning" | "error" | "success",
  ) => void;
}
const invalid = (reason: string): Signal => ({
  valid: false,
  value: null,
  reason,
});
const signal = (value: number | boolean): Signal => ({ valid: true, value });
export class Automation {
  signals: Record<string, Signal> = {};
  sensors: Record<string, Signal> = {};
  memory: Record<string, ControlMemory> = {};
  contacts: Record<string, boolean> = {};
  status: Record<string, Status> = {};
  pulses = new Set<string>();
  rngState = 123456789;
  private ordered: Component[] = [];
  private cachedProject: Project | null = null;
  getMemory(c: Component) {
    return (
      this.memory[c.id] ??
      (this.memory[c.id] = {
        on: Boolean(c.props.initialOn),
        elapsed: 0,
        previous: false,
        tripped: false,
        switches: 0,
        lastChange: 0,
        manualResets: 0,
      })
    );
  }
  random() {
    this.rngState = (Math.imul(1664525, this.rngState) + 1013904223) >>> 0;
    return this.rngState / 4294967296;
  }
  private unavailableSensor(c: Component, reason: string): Signal {
    const memory = this.getMemory(c);
    memory.filtered = memory.sampledValue = memory.sampledAt = undefined;
    return invalid(reason);
  }
  sense(c: Component, w: ControlWorld, dt: number): Signal {
    const id = textProp(c, "target"), target = w.project.components.find(x => x.id === id);
    const room = w.project.thermalSpaces?.find(s => s.id === id);
    const roomTarget = room && ["sensor", "thermostat", "safety"].includes(c.kind) && c.props.quantity !== "fluidTemperature";
    if (!roomTarget && (!target || !compatibleTarget(c, target)))
      return this.unavailableSensor(c, "No compatible modeled quantity at the assigned target.");
    const metric = target ? sensorMeasurement(c, target) : "bodyTemperature";
    const readingId = target?.kind === "heatExchanger" ? `${id}#${c.props.stream ?? "hot"}` : id;
    const actual = roomTarget ? w.spaceTemperatures?.[id] ?? room.initialTemperature : metric === "positionX" || metric === "positionY" ? w.mechanicalMeasurement?.(id, metric === "positionX" ? "x" : "y")
      : metric === "rpm" ? w.mechanicalMeasurement?.(id, "rpm")
      : metric === "bodyTemperature" ? w.temperatures[id]
      : metric === "fluidTemperature" ? w.fluidTemperatureMeasurement?.(readingId)
      : metric ? w.hydraulicMeasurement?.(readingId, metric) : undefined;
    if (
      w.faults[c.id] === "sensorFault" ||
      w.faults[c.id] === "disabled" ||
      w.faults[c.id] === "controlLost"
    )
      return this.unavailableSensor(c, "Sensor fault.");
    if (!id || actual === undefined || !Number.isFinite(actual))
      return this.unavailableSensor(c, "Target quantity is unavailable (empty fluid inventory or unsolved state).");
    const m = this.getMemory(c);
    const lag = prop(c, "lag");
    if (m.filtered === undefined) m.filtered = actual;
    else if (lag > 0)
      m.filtered += (actual - m.filtered) * -Math.expm1(-dt / lag);
    else m.filtered = actual;
    const interval = prop(c, "sampleInterval");
    if (interval > 0 && m.sampledValue !== undefined && m.sampledAt !== undefined && w.time - m.sampledAt < interval - 1e-9) {
      return m.sampledValue < prop(c, "minRange", 0) || m.sampledValue > prop(c, "maxRange", 120) ? invalid("Measurement outside sensor range.") : signal(m.sampledValue);
    }
    const noise =
      dt > 0 && prop(c, "noise") > 0
        ? prop(c, "noise") * (2 * this.random() - 1)
        : 0;
    const resolution = prop(c, "resolution", 0.01);
    const measured = Math.round((m.filtered + noise) / resolution) * resolution;
    m.sampledAt = w.time;
    m.sampledValue = measured;
    if (
      measured < prop(c, "minRange", 0) ||
      measured > prop(c, "maxRange", 120)
    )
      return invalid("Measurement outside sensor range.");
    return signal(measured);
  }
  input(c: Component, port: string, w: ControlWorld): Signal {
    if (w.faults[c.id] === "controlLost" || w.faults[c.id] === "disabled")
      return invalid("Control signal lost.");
    const wire = w.project.connections.find(
      (x) =>
        x.domain === "control" &&
        x.to.component === c.id &&
        x.to.port === port &&
        !w.disconnected.has(x.id),
    );
    return wire
      ? (this.signals[wire.from.component] ?? invalid("Driver is unavailable."))
      : invalid(`No ${port} input connected.`);
  }
  transition(c: Component, on: boolean, w: ControlWorld) {
    const m = this.getMemory(c);
    if (on !== m.on) {
      m.on = on;
      m.switches++;
      m.lastChange = w.time;
      w.log(`${c.name}: ${on ? "ON" : "OFF"}.`);
    }
  }
  evaluate(w: ControlWorld, dt: number) {
    if (this.cachedProject !== w.project) {
      const remaining = new Map(w.project.components.map((c) => [c.id, c]));
      this.ordered = [];
      const done = new Set<string>();
      while (remaining.size) {
        let progress = false;
        for (const [id, c] of remaining) {
          const deps = w.project.connections.filter(
            (x) => x.domain === "control" && x.to.component === id,
          );
          if (deps.every((x) => done.has(x.from.component))) {
            this.ordered.push(c);
            remaining.delete(id);
            done.add(id);
            progress = true;
          }
        }
        if (!progress)
          throw Error("Control network contains an unsupported cycle.");
      }
      this.cachedProject = w.project;
    }
    for (const c of this.ordered) {
      const m = this.getMemory(c),
        fault = w.faults[c.id];
      let out: Signal | undefined;
      this.status[c.id] =
        w.failed[c.id] || fault === "failedOpen"
          ? "failedOpen"
          : fault === "stuckClosed"
            ? "stuckClosed"
            : fault === "sensorFault"
              ? "sensorFault"
              : fault === "controlLost" || fault === "disabled"
                ? "controlLost"
                : m.tripped
                  ? "tripped"
                  : "healthy";
      switch (c.kind) {
        case 'positionSensor':
        case 'speedSensor':
        case "pressureSensor":
        case "flowSensor":
        case "levelSensor":
        case "sensor":
          out = this.sense(c, w, dt);
          this.sensors[c.id] = out;
          break;
        case "pid": {
          const v = this.input(c, "in", w);
          if (!v.valid || typeof v.value !== "number") { out = invalid("PI feedback invalid; actuator must use its fail state."); break; }
          const error = prop(c, "reference") - v.value, integral = m.integral ?? 0;
          // Derivative on measurement through a first-order filter (exact update on the simulation clock).
          if (dt > 0 && m.measurement !== undefined) {
            const raw = (v.value - m.measurement) / dt;
            m.derivative = (m.derivative ?? 0) + (raw - (m.derivative ?? 0)) * -Math.expm1(-dt / prop(c, "derivativeFilter", 1));
          }
          if (dt > 0) m.measurement = v.value;
          const dTerm = -prop(c, "kd") * (m.derivative ?? 0);
          const trial = integral + prop(c, "ki") * error * dt;
          const raw = prop(c, 'feedforward') + prop(c, "kp") * error + dTerm + trial, min = prop(c, "minOutput"), max = prop(c, "maxOutput");
          if ((raw >= min && raw <= max) || (raw > max && error * prop(c, "ki") < 0) || (raw < min && error * prop(c, "ki") > 0)) m.integral = trial;
          out = signal(Math.max(min, Math.min(max, prop(c, 'feedforward') + prop(c, "kp") * error + dTerm + (m.integral ?? 0))));
          break;
        }
        case "constant":
          out = signal(prop(c, "value"));
          break;
        case "scale":
        case "limiter":
        case "filter":
        case "rateLimiter": {
          const v = this.input(c, "in", w);
          if (!v.valid || typeof v.value !== "number") { out = invalid(v.reason ?? "Numeric input required."); m.output = undefined; break; }
          const x = v.value;
          if (c.kind === "scale") out = signal(prop(c, "gain") * x + prop(c, "offset"));
          else if (c.kind === "limiter") out = signal(Math.max(prop(c, "minOutput"), Math.min(prop(c, "maxOutput"), x)));
          else {
            const previous = m.output ?? x;
            const next = c.kind === "filter"
              ? previous + (x - previous) * -Math.expm1(-dt / prop(c, "timeConstant"))
              : previous + Math.max(-prop(c, "rate") * dt, Math.min(prop(c, "rate") * dt, x - previous));
            m.output = next;
            out = signal(next);
          }
          break;
        }
        case "selector": {
          const a = this.input(c, "in", w), b = this.input(c, "in2", w);
          if (!a.valid || !b.valid || typeof a.value !== "number" || typeof b.value !== "number") { out = invalid(a.reason ?? b.reason ?? "Two numeric inputs required."); break; }
          const mode = textProp(c, "mode");
          if (mode === "switch") {
            const sel = this.input(c, "select", w);
            out = !sel.valid || typeof sel.value !== "boolean" ? invalid(sel.reason ?? "Boolean select input required.") : signal(sel.value ? b.value : a.value);
          } else out = signal(mode === "min" ? Math.min(a.value, b.value) : Math.max(a.value, b.value));
          break;
        }
        case "reset":
          out = signal(this.pulses.has(c.id));
          break;
        case "comparator": {
          const v = this.input(c, "in", w);
          const connected = w.project.connections.some(
            (x) =>
              x.domain === "control" &&
              x.to.component === c.id &&
              x.to.port === "ref",
          );
          const ref = connected
            ? this.input(c, "ref", w)
            : signal(prop(c, "reference"));
          if (
            !v.valid ||
            !ref.valid ||
            typeof v.value !== "number" ||
            typeof ref.value !== "number"
          )
            out = invalid(v.reason ?? ref.reason ?? "Numeric inputs required.");
          else {
            const a = v.value,
              b = ref.value;
            out = signal(
              textProp(c, "mode") === "lt"
                ? a < b
                : textProp(c, "mode") === "lte"
                  ? a <= b
                  : textProp(c, "mode") === "gt"
                    ? a > b
                    : a >= b,
            );
          }
          break;
        }
        case "hysteresis":
        case "thermostat": {
          const hasExternal = w.project.connections.some(
            (x) =>
              x.domain === "control" &&
              x.to.component === c.id &&
              x.to.port === "in",
          );
          const v =
            c.kind === "thermostat" && !hasExternal
              ? this.sense(c, w, dt)
              : this.input(c, "in", w);
          if (c.kind === "thermostat") this.sensors[c.id] = v;
          if (!v.valid || typeof v.value !== "number")
            out = invalid(v.reason ?? "Numeric temperature required.");
          else {
            const low =
                c.kind === "thermostat"
                  ? prop(c, "setpoint") - prop(c, "hysteresis")
                  : prop(c, "low"),
              high =
                c.kind === "thermostat" ? prop(c, "setpoint") : prop(c, "high");
            if (v.value < low) this.transition(c, true, w);
            else if (v.value >= high) this.transition(c, false, w);
            out = signal(m.on);
          }
          break;
        }
        case "and":
        case "or":
        case "not": {
          const a = this.input(c, "in", w),
            b = c.kind === "not" ? signal(false) : this.input(c, "in2", w);
          if (
            !a.valid ||
            !b.valid ||
            typeof a.value !== "boolean" ||
            typeof b.value !== "boolean"
          )
            out = invalid(a.reason ?? b.reason ?? "Boolean inputs required.");
          else
            out = signal(
              c.kind === "not"
                ? !a.value
                : c.kind === "and"
                  ? a.value && b.value
                  : a.value || b.value,
            );
          break;
        }
        case "latch": {
          const set = this.input(c, "set", w),
            reset = this.input(c, "reset", w);
          if (!set.valid || !reset.valid)
            out = invalid(
              set.reason ?? reset.reason ?? "Set/reset inputs required.",
            );
          else {
            if (reset.value === true) this.transition(c, false, w);
            else if (set.value === true) this.transition(c, true, w);
            out = signal(m.on);
          }
          break;
        }
        case "timer": {
          const v = this.input(c, "in", w);
          if (!v.valid || typeof v.value !== "boolean") {
            m.elapsed = 0;
            m.previous = false;
            out = invalid(v.reason ?? "Boolean input required.");
            break;
          }
          const on = v.value,
            delay = prop(c, "delay"),
            mode = textProp(c, "mode");
          let result = false;
          if (mode === "onDelay") {
            m.elapsed = on ? m.elapsed + dt : 0;
            result = on && m.elapsed + 1e-10 >= delay;
          } else if (mode === "offDelay") {
            if (on) {
              m.elapsed = 0;
              result = true;
            } else if (m.previous || m.on) {
              m.elapsed += dt;
              result = m.elapsed + 1e-10 < delay;
            }
          } else {
            if (on && !m.previous && !m.on) {
              m.elapsed = 0;
              this.transition(c, true, w);
            }
            if (m.on) {
              m.elapsed += dt;
              result = m.elapsed <= delay + 1e-10;
            }
          }
          m.previous = on;
          this.transition(c, result, w);
          out = signal(result);
          break;
        }
        case "relay": {
          const v = this.input(c, "in", w);
          let on = v.valid && v.value === true;
          if (!v.valid && !fault && !w.failed[c.id])
            this.status[c.id] = "controlLost";
          if (fault === "stuckClosed") on = true;
          if (fault === "failedOpen" || w.failed[c.id]) on = false;
          this.contacts[c.id] = on;
          this.transition(c, on, w);
          out = signal(on);
          break;
        }
        case "breaker":
        case "motorProtector": {
          const tripped = !!w.breakers?.[c.id]?.tripped && fault !== "stuckClosed";
          if (tripped) this.status[c.id] = "tripped";
          out = signal(!tripped && c.props.closed !== false && fault !== "failedOpen" && !w.failed[c.id]);
          break;
        }
        case "safety": {
          const measured = this.sense(c, w, dt);
          this.sensors[c.id] = measured;
          if (
            (!measured.valid && c.props.failOnSensor) ||
            (measured.valid && Number(measured.value) >= prop(c, "threshold"))
          ) {
            if (!m.tripped) {
              m.tripped = true;
              w.log(
                `${c.name}: independent safety trip (${measured.valid ? `${Number(measured.value).toFixed(2)}°C` : "invalid safety sensor"}). Manual reset required.`,
                "warning",
              );
            }
          }
          let closed = !m.tripped;
          if (fault === "stuckClosed") closed = true;
          if (fault === "failedOpen" || w.failed[c.id]) closed = false;
          this.contacts[c.id] = closed;
          this.transition(c, closed, w);
          if (m.tripped) this.status[c.id] = "tripped";
          if (fault === "stuckClosed") this.status[c.id] = "stuckClosed";
          out = signal(m.tripped);
          break;
        }
      }
      if (out) {
        if (fault === "disabled" || fault === "controlLost")
          out = invalid("Control signal lost.");
        if (
          fault === "stuckClosed" &&
          ["thermostat", "hysteresis", "comparator"].includes(c.kind)
        )
          out = signal(true);
        this.signals[c.id] = out;
        if (!out.valid && this.status[c.id] === "healthy")
          this.status[c.id] =
            c.kind === "sensor" ? "sensorFault" : "controlLost";
      }
    }
    if (dt > 0) this.pulses.clear();
  }
  manualReset(id: string, w: ControlWorld): string | null {
    const c = w.project.components.find((c) => c.id === id);
    if (!c || c.kind !== "safety") return "Select an independent cutoff.";
    const measured = this.sensors[id] ?? this.sense(c, w, 0);
    if (!measured.valid)
      return "Cannot reset: the independent safety measurement is invalid.";
    if (Number(measured.value) > prop(c, "threshold") - prop(c, "resetMargin"))
      return `Cannot reset above ${(prop(c, "threshold") - prop(c, "resetMargin")).toFixed(1)}°C.`;
    if (w.failed[id])
      return "Permanent contact failure requires experiment Reset.";
    const m = this.getMemory(c);
    m.tripped = false;
    m.manualResets++;
    w.log(`${c.name}: safety latch manually reset.`, "success");
    this.evaluate(w, 0);
    return null;
  }
}
export function allowedFaults(c: Component): FaultType[] {
  if (c.kind === "electricBoiler") return ["failedOpen", "stuckClosed", "controlLost"];
  if (c.kind === "contactor") return ["stuckClosed", "stuckOpen", "failedOpen"];
  if (c.kind === "radiator") return ["coolingFailed"];
  if (c.kind === "circulator") return ["motorFailure", "controlLost"];
  if (c.kind === "battery" || c.kind === "transformer") return ["failedOpen"];
  if (c.kind === "breaker" || c.kind === "motorProtector") return ["stuckClosed", "failedOpen"];
  if (["relay", "safety"].includes(c.kind))
    return [
      "stuckClosed",
      "failedOpen",
      "controlLost",
      ...(c.kind === "safety" ? ["sensorFault" as const] : []),
    ];
  if (c.kind === "motor" || c.kind === "inductionMotor") return ["powerLoss", "motorFailure", "controlLost"];
  if (["valve", "actuatedValve", "thermostaticValve", "checkValve", "pressureReducingValve"].includes(c.kind)) return ["stuckOpen", "stuckClosed", ...(c.kind === "actuatedValve" ? ["controlLost" as const] : [])];
  if (c.kind === "tank") return ["depleted"];
  if (["sensor", "thermostat", "pressureSensor", "flowSensor", "levelSensor", "positionSensor", "speedSensor"].includes(c.kind))
    return [
      "sensorFault",
      "disabled",
      ...(c.kind === "thermostat" ? ["stuckClosed" as const] : []),
    ];
  if (c.kind === "cooler") return ["coolingFailed", "coolingReduced"];
  if (
    [
      "pid",
      "scale",
      "limiter",
      "filter",
      "rateLimiter",
      "selector",
      "hysteresis",
      "comparator",
      "timer",
      "and",
      "or",
      "not",
      "latch",
      "constant",
      "reset",
    ].includes(c.kind)
  )
    return [
      "disabled",
      "controlLost",
      ...(c.kind === "hysteresis" ? ["stuckClosed" as const] : []),
    ];
  if (
    ["heater", "resistor", "lamp", "switch", "fuse", "source"].includes(c.kind)
  )
    return ["failedOpen"];
  return [];
}
