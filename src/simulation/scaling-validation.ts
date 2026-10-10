/**
 * Scale-focused validation campaign (sandbox freedom milestone). Every row is an
 * executed simulation compared with an analytical expectation or a conservation
 * identity. Used by scripts/validate-scaling.mjs and by sandbox.test.ts.
 */
import { catalog, connect, definitions, makeComponent, uid, type Component, type Kind, type Project, type Property } from "./model";
import { applyDerived, paramSpec, thermalTau } from "./parameters";
import { effectiveness } from "./hydraulic";
import { starter } from "./projects";
import { componentError } from "./integrity";
import { Simulation, DT } from "./engine";
import { WATER_CP, unitsSI as U } from "./units";

export interface ScalingRow {
  name: string;
  domain: string;
  expected: number;
  measured: number;
  absoluteError: number;
  relativeError: number | null;
  tolerance: string;
  pass: boolean;
  assumptions: string;
}
const row = (name: string, domain: string, expected: number, measured: number, relTol: number, assumptions: string, absTol = 0): ScalingRow => {
  const absoluteError = Math.abs(measured - expected), relativeError = expected !== 0 ? absoluteError / Math.abs(expected) : null;
  const pass = Number.isFinite(measured) && (absoluteError <= absTol || (relativeError !== null && relativeError <= relTol));
  return { name, domain, expected, measured, absoluteError, relativeError, tolerance: `${relTol ? `${(relTol * 100).toPrecision(2)}%` : ""}${relTol && absTol ? " or " : ""}${absTol ? `±${absTol}` : ""}`, pass, assumptions };
};
const check = (name: string, domain: string, ok: boolean, measured: number, assumptions: string): ScalingRow =>
  ({ name, domain, expected: 1, measured: ok ? 1 : 0, absoluteError: ok ? 0 : 1, relativeError: null, tolerance: "pass/fail", pass: ok, assumptions: `${assumptions} (value ${Number(measured.toPrecision(6))})` });

/** Small project builder using the public model API. */
export class Builder {
  p: Project = { version: 3, id: uid(), name: "Scaling experiment", components: [], connections: [], probes: [], assemblies: [] };
  add(kind: Kind, props: Record<string, Property> = {}, variant = "standard", name?: string): Component {
    const c = makeComponent(kind, 40 + this.p.components.length * 30, 40, this.p.components);
    c.variant = variant;
    c.props = applyDerived(kind, { ...catalog(c).props, ...props });
    if (name) c.name = name;
    this.p.components.push(c);
    return c;
  }
  wire(a: Component, ap: string, b: Component, bp: string) {
    this.p = connect(this.p, { component: a.id, port: ap }, { component: b.id, port: bp });
  }
  series(source: Component, ...elements: Component[]) {
    let previous = source, port = "a";
    for (const e of elements) { this.wire(previous, port, e, "a"); previous = e; port = "b"; }
    this.wire(previous, port, source, "b");
  }
}
const ledgerResidual = (s: Simulation) => s.suppliedEnergy - s.storedEnergy - s.ambientEnergy;
const tankCapacity = (s: Simulation, tank: Component) => (s.multiphysics.tanks[tank.id]?.mass ?? 0) * WATER_CP + (tank.props.vesselHeatCapacity as number);

/** Heater on a tank with an ideal supply at nominal voltage; no ambient losses. */
export function heatingRig(liters: number, power: number, voltage = power > 5000 ? 400 : 230) {
  const b = new Builder();
  const source = b.add("source", { voltage, ratedVoltage: voltage, maxCurrent: 1e5, maxPower: 1e9 });
  const heater = b.add("heater", { ratedVoltage: voltage, ratedPower: power, heatCapacity: Math.max(10, 0.15 * power), conductance: Math.max(5, 0.09 * power), loss: 0 });
  const tank = b.add("tank", { capacity: liters * 1.1, volume: liters, surfaceArea: Math.max(0.005, liters / 1000), loss: 0 });
  b.series(source, heater);
  b.wire(heater, "heat", tank, "heat");
  return { p: b.p, source, heater, tank };
}
/** Experiment B: 30 kW bank, fuse, contactor, cable and thermostat on an insulated 2,000 L tank. */
export function industrialHeating(power = 30000) {
  const b = new Builder();
  const source = b.add("source", { voltage: 400 }, "powerBus", "DC bus");
  const fuse = b.add("fuse", { ratedCurrent: 125, resistance: 0.0005, ratedPower: 60, heatCapacity: 120, tripTime: 0.2 }, "power63", "Main fuse");
  const contactor = b.add("relay", {}, "contactor250", "Contactor");
  const cable = b.add("cable", { area: 35, length: 30, ratedCurrent: 124, maxTemperature: 90 }, "standard", "Feeder");
  const heater = b.add("heater", { ratedVoltage: 400, ratedPower: power, heatCapacity: 0.15 * power, conductance: 0.09 * power, loss: power / 10000, maxTemperature: 200 }, "standard", "Heating bank");
  const tank = b.add("tank", {}, "process2000", "Process tank");
  const thermostat = b.add("thermostat", { target: tank.id, setpoint: 80, hysteresis: 2 }, "standard", "Thermostat");
  b.series(source, fuse, contactor, cable, heater);
  b.wire(heater, "heat", tank, "heat");
  b.wire(thermostat, "out", contactor, "in");
  return { p: b.p, source, fuse, contactor, cable, heater, tank, thermostat };
}
/** Experiment C: three independently controlled 12 kW stages on one tank. */
export function multiStage() {
  const b = new Builder();
  const source = b.add("source", { voltage: 400 }, "powerBus", "DC bus");
  const tank = b.add("tank", {}, "process2000", "Process tank");
  const stages = [60, 70, 80].map((setpoint, i) => {
    const relay = b.add("relay", {}, "contactor250", `Stage ${i + 1} contactor`);
    const heater = b.add("heater", {}, "industrial12k", `Stage ${i + 1} heater`);
    const thermostat = b.add("thermostat", { target: tank.id, setpoint, hysteresis: 2 }, "standard", `Stage ${i + 1} thermostat`);
    b.series(source, relay, heater);
    b.wire(heater, "heat", tank, "heat");
    b.wire(thermostat, "out", relay, "in");
    return { relay, heater, thermostat, setpoint };
  });
  return { p: b.p, source, tank, stages };
}
/** Experiment D: 75 kW motor drives a 3,000 L/min pump between two 10,000 L tanks. */
export function largePumping() {
  const b = new Builder();
  const source = b.add("source", { voltage: 440, ratedVoltage: 800, maxCurrent: 250 }, "powerBus", "DC bus");
  const motor = b.add("motor", {}, "industrial440", "Drive motor");
  const pump = b.add("pump", {}, "highCapacity", "Process pump");
  const lower = b.add("tank", { volume: 10000, initialTemperature: 20, elevation: 0 }, "storage10000", "Lower reservoir");
  const upper = b.add("tank", { volume: 0, initialTemperature: 20, elevation: 5 }, "storage10000", "Upper reservoir");
  const suction = b.add("pipe", { diameter: 0.15, length: 20 }, "standard", "Suction");
  const discharge = b.add("pipe", { diameter: 0.15, length: 50 }, "standard", "Discharge");
  b.series(source, motor);
  b.wire(motor, "shaft", pump, "shaft");
  b.wire(lower, "fluid", suction, "inlet");
  b.wire(suction, "outlet", pump, "inlet");
  b.wire(pump, "outlet", discharge, "inlet");
  b.wire(discharge, "outlet", upper, "fluid");
  return { p: b.p, source, motor, pump, lower, upper };
}
function stepFor(s: Simulation, seconds: number) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) if (!s.step()) break;
}
/** Advance adaptively until a predicate holds (checked between 60 s chunks). */
function advanceUntil(s: Simulation, limit: number, done: () => boolean, chunk = 60) {
  while (s.time < limit - 1e-9 && !done() && !s.error) s.advanceAdaptive(Math.min(chunk, limit - s.time));
}

export function runScalingValidation(): ScalingRow[] {
  const rows: ScalingRow[] = [];
  // — Electrical scaling: Ohm's law and power across 18 decades of R·V combinations —
  for (const r of [1e-3, 1, 1e3, 1e6]) for (const v of [1, 230, 1e4, 1e5]) {
    const b = new Builder(), source = b.add("source", { voltage: v, ratedVoltage: v, maxCurrent: 1e9, maxPower: 1e15 }), load = b.add("resistor", { resistance: r, ratedPower: 1e15 });
    b.series(source, load);
    const s = new Simulation(b.p), reading = s.electrical.readings[load.id];
    rows.push(row(`Ohm's law ${r} Ω at ${v} V`, "electrical", v / r, reading.current, 1e-9, "Ideal source, constant R"));
    rows.push(row(`Power ${r} Ω at ${v} V`, "electrical", v * v / r, s.electrical.sourcePower, 1e-9, "P = V²/R = source power"));
  }
  // — Source behaviours —
  {
    const b = new Builder(), source = b.add("source", {}, "labCVCC"), load = b.add("resistor", { resistance: 1 });
    b.series(source, load);
    const s = new Simulation(b.p);
    rows.push(row("CV/CC supply limits into 1 Ω", "electrical", 5, s.electrical.readings[load.id].current, 1e-9, "12 V setpoint, 5 A limit → CC at 5 A, 5 V"));
  }
  {
    const b = new Builder(), source = b.add("source", { mode: "cc", current: 2, voltage: 60, ratedVoltage: 60 }), load = b.add("resistor", { resistance: 100 });
    b.series(source, load);
    const s = new Simulation(b.p);
    rows.push(row("Constant-current source at compliance", "electrical", 0.6, s.electrical.readings[load.id].current, 1e-9, "2 A setpoint needs 200 V > 60 V compliance → CV at 60 V"));
  }
  {
    const b = new Builder(), source = b.add("source", { mode: "internal", voltage: 12, ratedVoltage: 14.4, internalResistance: 0.02, maxCurrent: 600, maxPower: 7500 }), load = b.add("resistor", { resistance: 0.1, ratedPower: 1e4 });
    b.series(source, load);
    const s = new Simulation(b.p);
    rows.push(row("Internal-resistance terminal voltage", "electrical", 10, s.electrical.readings[source.id].voltage, 1e-9, "12 V, 20 mΩ into 100 mΩ: V = 12·0.1/0.12"));
  }
  // — Experiment A: small water heater —
  {
    const b = new Builder();
    const source = b.add("source", {}, "labCVCC");
    b.p.components[0].props.voltage = 24;
    const heater = b.add("heater", {}, "lab100"), tank = b.add("tank", { capacity: 1.2, volume: 1, surfaceArea: 0.008, loss: 0.05 });
    b.series(source, heater);
    b.wire(heater, "heat", tank, "heat");
    const s = new Simulation(b.p);
    rows.push(row("A: 24 V / 100 W element actual power", "thermal", 100, s.electrical.readings[heater.id].power, 1e-9, "V²/R with derived R = 5.76 Ω (supply 5 A limit not reached: 4.17 A)"));
    s.advanceAdaptive(600);
    const water = (s.temperatures[tank.id] - 20) * tankCapacity(s, tank);
    rows.push(row("A: water energy equals supplied − element − losses", "thermal", s.suppliedEnergy - s.heaterStored - s.ambientEnergy, water, 1e-9, "Implicit thermal ledger"));
    rows.push(row("A: energy residual", "thermal", 0, ledgerResidual(s), 0, "J", 1e-6 * s.suppliedEnergy));
  }
  // — Thermal scaling: tank × heater matrix —
  for (const liters of [1, 10, 100, 2000, 10000]) for (const power of [100, 3000, 30000, 100000]) {
    const { p, tank, heater } = heatingRig(liters, power), s = new Simulation(p);
    const capacity = liters * WATER_CP, ideal = capacity * 30 / power;
    if (ideal < 2) {
      // Far outside the lumped model: a 100 kW element in 1 L boils locally in < 2 s.
      advanceUntil(s, 600, () => false);
      rows.push(check(`Scale ${liters} L × ${power / 1000} kW: diagnostic`, "thermal", /supported liquid range/.test(s.error ?? ""), s.temperatures[tank.id], "Water leaves the 1–95 °C model; simulation pauses with an explicit diagnostic"));
      continue;
    }
    const horizon = Math.min(ideal, 6 * 3600);
    s.advanceAdaptive(horizon);
    const rise = s.temperatures[tank.id] - 20, expected = (s.suppliedEnergy - s.heaterStored) / capacity;
    rows.push(row(`Scale ${liters} L × ${power / 1000} kW: ΔT vs energy`, "thermal", expected, rise, 1e-9, `${(horizon / 3600).toFixed(2)} h adaptive; no losses`));
    // Exact two-node solution: θ = Tₑ − T_w relaxes with τ = 1/(UA(1/Cₑ + 1/C)), θ∞ = P·τ/Cₑ.
    const ce = heater.props.heatCapacity as number, ua = heater.props.conductance as number;
    const tau = 1 / (ua * (1 / ce + 1 / capacity)), theta = power * tau / ce * -Math.expm1(-horizon / tau);
    rows.push(row(`Scale ${liters} L × ${power / 1000} kW: ΔT vs two-node analytic`, "thermal", (power * horizon - ce * theta) / (capacity + ce), rise, 0.02, "Element thermal mass Cₑ = 0.15 J/K per W and UA = 0.09 W/K per W; backward-Euler adaptive integration"));
  }
  // — Experiment B: industrial heating bank —
  {
    const e = industrialHeating(), s = new Simulation(e.p);
    const heaterPower = s.electrical.readings[e.heater.id].power;
    const series = 0.01 + 0.0005 + 0.0002 + (e.cable.props.resistance as number), rh = 400 ** 2 / 30000;
    rows.push(row("B: 30 kW bank electrical power at start", "electrical", rh * (400 / (rh + series)) ** 2, heaterPower, 1e-9, "400 V bus with 10 mΩ internal R, 0.5 mΩ fuse, 0.2 mΩ contactor, 35 mm² × 30 m Cu feeder at 20 °C"));
    rows.push(row("B: 30 kW nominal vs actual power", "electrical", 30000, heaterPower, 0.015, "Actual power is below nominal because of real series drops — not forced to the rating"));
    const capacity = tankCapacity(s, e.tank), mean = heaterPower * 0.999;
    const ua = e.tank.props.loss as number, tau = capacity / ua, rise = 60;
    const expected = -tau * Math.log(1 - ua * rise / mean);
    advanceUntil(s, expected * 1.05, () => (s.automation.memory[e.thermostat.id]?.switches ?? 0) >= 2, 900);
    const off = s.automation.memory[e.thermostat.id]?.lastChange ?? NaN;
    rows.push(row("B: time to 80 °C (2,000 L, 30 kW, insulated)", "thermal", expected, off, 0.01, "C = water + 150 kJ/K steel; UA from 100 mm mineral wool; element stored heat neglected in expectation"));
    rows.push(row("B: energy residual over heat-up", "thermal", 0, ledgerResidual(s), 0, "J", 1e-6 * s.suppliedEnergy));
    rows.push(check("B: no protection trip or failure", "electrical", !Object.keys(s.failed).length && !s.error, Object.keys(s.failed).length, "75 A in 125 A fuse, 250 A contactor, 124 A feeder"));
  }
  // — Experiment C: multi-stage heating —
  {
    const e = multiStage(), s = new Simulation(e.p);
    const rh = 400 ** 2 / 12000, rb = rh + 0.0002, ri = 0.01;
    const stagePower = (n: number) => { const req = rb / n, i = 400 / (req + ri), branch = i * req / rb; return n * branch * branch * rh; };
    rows.push(row("C: three stages combined heater power", "electrical", stagePower(3), e.stages.reduce((sum, x) => sum + s.electrical.readings[x.heater.id].power, 0), 1e-9, "3 × 13.33 Ω elements + 0.2 mΩ contactors behind the bus' 10 mΩ internal resistance"));
    advanceUntil(s, 6 * 3600, () => (s.automation.memory[e.stages[0].thermostat.id]?.switches ?? 0) >= 2, 600);
    const firstOff = s.temperatures[e.tank.id];
    rows.push(row("C: stage 1 switches off at its 60 °C setpoint", "control", 60, firstOff, 0.01, "Adaptive step ≤ 0.05 K per step; checked at a 600 s chunk boundary"));
    const heaters = e.stages.map((x) => s.electrical.readings[x.heater.id].power);
    rows.push(row("C: remaining stages after stage 1 off", "electrical", stagePower(2), heaters[1] + heaters[2], 1e-9, "Stages 2 and 3 still demand heat; bus sag recomputed for two branches"));
    rows.push(row("C: energy residual", "thermal", 0, ledgerResidual(s), 0, "J", 1e-6 * s.suppliedEnergy));
  }
  // — Experiment D: large pumping system —
  {
    const e = largePumping(), s = new Simulation(e.p);
    stepFor(s, 60);
    const moved = (s.multiphysics.tanks[e.upper.id]?.volume ?? 0) * 1000;
    rows.push(check("D: water delivered to the upper reservoir", "hydraulic", moved > 100 && !s.error, moved, `litres after 60 s; ${s.error ?? "no solver error"}`));
    rows.push(row("D: mass residual", "hydraulic", 0, s.multiphysics.massResidual, 0, "kg", 1e-6));
    rows.push(row("D: coupled energy residual", "multiphysics", 0, s.energyResidual, 0, "J", Math.max(0.5, 0.005 * s.suppliedEnergy)));
    rows.push(check("D: start-up current limited by CV/CC bus", "electrical", s.peakPower <= 440 * 250 * 1.001, s.peakPower, "W peak ≤ 440 V × 250 A"));
  }
  // — Mechanical scaling: steady no-load speed V·k/(k² + R·b) —
  for (const variant of ["standard", "traction48", "industrial180", "industrial440"]) {
    const b = new Builder(), motor = b.add("motor", {}, variant), v = motor.props.ratedVoltage as number;
    const source = b.add("source", { voltage: v, ratedVoltage: Math.max(240, v), maxCurrent: 1e5, maxPower: 1e9 });
    b.series(source, motor);
    const s = new Simulation(b.p), k = motor.props.torqueConstant as number, R = motor.props.resistance as number, f = motor.props.friction as number, J = motor.props.inertia as number;
    stepFor(s, Math.min(60, Math.max(2, 8 * J * R / (k * k + R * f))));
    rows.push(row(`Motor ${variant}: no-load speed`, "mechanical", v * k / (k * k + R * f), s.multiphysics.motors[motor.id].omega, 0.002, "First-order electromechanical response, 8 time constants"));
  }
  // — Hydraulic scaling: gravity transfer through pipes of different diameter —
  for (const d of [0.01, 0.05, 0.2, 0.5]) {
    const b = new Builder(), up = b.add("tank", { capacity: 20000, volume: 15000, surfaceArea: 10, elevation: 5 }), down = b.add("tank", { capacity: 50000, volume: 0, surfaceArea: 10 }), pipe = b.add("pipe", { diameter: d, length: 30 });
    b.wire(up, "fluid", pipe, "inlet");
    b.wire(pipe, "outlet", down, "fluid");
    const s = new Simulation(b.p);
    stepFor(s, 5);
    rows.push(row(`Pipe Ø${d * 1000} mm: mass conservation`, "hydraulic", 0, s.multiphysics.massResidual, 0, "kg", 1e-6));
    rows.push(row(`Pipe Ø${d * 1000} mm: Darcy pressure consistency`, "hydraulic", 0, s.multiphysics.hydraulic.pressureResidual, 0, "Pa", 1e-3));
  }
  // — Control scaling: thermostat band on fast and slow plants, adaptive vs fixed step —
  for (const [liters, power] of [[1, 1000], [2000, 30000]] as const) {
    const make = () => {
      const r = heatingRig(liters, power), b = new Builder();
      b.p = r.p;
      const relay = b.add("relay", { ratedCurrent: 1000, ratedVoltage: 1000 });
      const thermostat = b.add("thermostat", { target: r.tank.id, setpoint: 50, hysteresis: 2 });
      // Insert the relay contact between source and heater.
      b.p.connections = b.p.connections.filter((w) => !(w.from.component === r.source.id && w.from.port === "a"));
      b.wire(r.source, "a", relay, "a");
      b.wire(relay, "b", r.heater, "a");
      b.wire(thermostat, "out", relay, "in");
      return { ...r, p: b.p, thermostat };
    };
    const horizon = liters * WATER_CP * 40 / power * 1.5;
    const fixed = make(), a = new Simulation(fixed.p);
    if (horizon <= 900) {
      stepFor(a, horizon);
      const adaptive = new Simulation(make().p);
      adaptive.advanceAdaptive(horizon);
      rows.push(row(`Thermostat ${liters} L/${power / 1000} kW: adaptive vs fixed final T`, "control", a.temperatures[fixed.tank.id], adaptive.temperatures[adaptive.project.components.find((c) => c.kind === "tank")!.id], 0, "°C", 0.15));
    } else a.advanceAdaptive(horizon);
    const t = a.temperatures[fixed.tank.id];
    rows.push(check(`Thermostat ${liters} L/${power / 1000} kW: within band + element overshoot`, "control", t > 47.5 && t < 51, t, "°C after 1.5 heat-up times; band 48–50 °C"));
  }
  // — Protection: thermal-magnetic breaker and motor protector —
  for (const [kind, multiple] of [["breaker", 2], ["breaker", 4], ["motorProtector", 7.2]] as const) {
    const b = new Builder(), device = b.add(kind);
    const In = device.props.ratedCurrent as number;
    const src = b.add("source", { mode: "cc", current: In * multiple, voltage: 1e4, ratedVoltage: 1e4, maxCurrent: 1e6, maxPower: 1e12 });
    const load = b.add("resistor", { resistance: 1, ratedPower: 1e9, heatCapacity: 1e12, maxTemperature: 1e4 });
    b.series(src, device, load);
    const s = new Simulation(b.p), k2 = (kind === "motorProtector" ? 1.12 : 1.3) ** 2, x2 = multiple * multiple;
    while (s.time < 600 && !s.breakers[device.id]?.tripped) s.step();
    rows.push(row(`${kind} trip time at ${multiple} × In`, "protection", thermalTau(device) * Math.log(x2 / (x2 - k2)), s.time, 0.002, "Thermal image θ' = ((I/In)² − θ)/τ from cold; detection at the 1/60 s step", DT));
  }
  // — Thermal port: resistor on a heat sink (two-node steady state) —
  {
    const b = new Builder(), src = b.add("source", { voltage: 20, ratedVoltage: 24, maxCurrent: 100 });
    const r = b.add("resistor", { resistance: 10, ratedPower: 100, heatCapacity: 20, loss: 0.2, conductance: 4, maxTemperature: 300 });
    const sink = b.add("thermalMass", {}, "heatSink");
    b.series(src, r);
    b.wire(r, "heat", sink, "heat");
    const s = new Simulation(b.p);
    s.advanceAdaptive(3600);
    const link = 1 / (1 / 4 + 1 / 50), a11 = 0.2 + link, a22 = link + 3.3, det = a11 * a22 - link * link;
    rows.push(row("Thermal port: resistor temperature on heat sink", "thermal", 20 + 40 * a22 / det, s.temperatures[r.id], 1e-4, "40 W; series port conductances 4 and 50 W/K; sink 3.3 W/K to air"));
  }
  // — Heat exchanger: counterflow ε-NTU between two gravity streams —
  {
    const b = new Builder(), hx = b.add("heatExchanger", { ua: 5000, lossCoefficient: 2, diameter: 0.05 });
    for (const [temperature, ports] of [[80, ["hotIn", "hotOut"]], [10, ["coldIn", "coldOut"]]] as const) {
      const source = b.add("tank", { capacity: 2000, volume: 1500, surfaceArea: 1, elevation: 5, initialTemperature: temperature, loss: 0 });
      const sink = b.add("tank", { capacity: 5000, volume: 0, surfaceArea: 1, loss: 0 }), pipe = b.add("pipe", { diameter: 0.05, length: 10, inventory: false });
      b.wire(source, "fluid", pipe, "inlet"); b.wire(pipe, "outlet", hx, ports[0]); b.wire(hx, ports[1], sink, "fluid");
    }
    const s = new Simulation(b.p);
    stepFor(s, 5);
    const hot = s.multiphysics.hydraulic.readings[`${hx.id}#hot`], cold = s.multiphysics.hydraulic.readings[`${hx.id}#cold`];
    const ch = hot.flow * 1000 * WATER_CP, cc = cold.flow * 1000 * WATER_CP, cmin = Math.min(ch, cc);
    // Inlet temperatures include each feed pipe's viscous heating (streams differ through μ(T)).
    const inletOf = (stream: string) => U.kToCelsius(s.multiphysics.hydraulic.readings[s.multiphysics.hydraulic.branches.find((x) => x.to === s.multiphysics.hydraulic.branches.find((y) => y.id === `${hx.id}#${stream}`)!.from)!.id].temperature);
    const q = effectiveness(5000 / cmin, cmin / Math.max(ch, cc), "counterflow") * cmin * (inletOf("hot") - inletOf("cold"));
    rows.push(row("Heat exchanger duty (counterflow ε-NTU)", "hydraulic", q, hot.duty ?? NaN, 1e-6, "Inlets 80 °C / 10 °C plus feed-pipe dissipation; zero-volume pipes"));
    // Viscous dissipation of the hot path (its pipe and exchanger side) warms that stream by ΣΔp·q/C.
    const hotPipe = s.multiphysics.hydraulic.branches.find((x) => x.to === s.multiphysics.hydraulic.branches.find((y) => y.id === `${hx.id}#hot`)!.from)!;
    const heating = (hotPipe.loss + s.multiphysics.hydraulic.branches.find((y) => y.id === `${hx.id}#hot`)!.loss) / ch;
    rows.push(row("Heat exchanger hot outlet", "hydraulic", 80 - q / ch + heating, U.kToCelsius(hot.temperature), 1e-6, "T_out = T_in − Q/C + viscous dissipation heating"));
    const [hotFeed, coldFeed] = b.p.components.filter((c) => c.kind === "pipe").map((c) => s.multiphysics.hydraulic.readings[c.id]);
    rows.push(check("Hot (80 °C) stream flows faster than cold (10 °C) through identical feeds", "hydraulic", hotFeed.flow > coldFeed.flow, hotFeed.flow / coldFeed.flow, "IAPWS 2008 μ(T) in pipe friction; flow ratio"));
    rows.push(row("Heat exchanger energy residual", "hydraulic", 0, s.energyResidual, 0, "J", 0.5));
  }
  // — Three-phase per-phase equivalent —
  {
    const b = new Builder(), src = b.add("source3", { lineVoltage: 400, maxCurrent: 100, maxPower: 1e6 });
    const heater = b.add("heater", { ratedVoltage: 400, ratedPower: 30000, heatCapacity: 4500, conductance: 2700 });
    b.series(src, heater);
    const s = new Simulation(b.p);
    rows.push(row("Three-phase 30 kW bank at 400 V: total power", "electrical", 30000, s.electrical.readings[heater.id].power, 1e-9, "P = 3·(V_LL/√3)²/R = V_LL²/R"));
    rows.push(row("Three-phase line current", "electrical", 30000 / (Math.sqrt(3) * 400), Math.abs(s.electrical.readings[heater.id].current), 1e-9, "I_L = P/(√3·V_LL)"));
  }
  // — Pressure-reducing valve —
  {
    const b = new Builder(), prv = b.add("pressureReducingValve", { pressureSetpoint: 150000, diameter: 0.05 });
    const source = b.add("tank", { capacity: 50000, volume: 40000, surfaceArea: 1000, elevation: 50, loss: 0 }), sink = b.add("tank", { capacity: 50000, volume: 0, surfaceArea: 10, loss: 0 });
    const feed = b.add("pipe", { diameter: 0.05, length: 5, inventory: false }), consumer = b.add("valve", { diameter: 0.02, opening: 40 });
    b.wire(source, "fluid", feed, "inlet"); b.wire(feed, "outlet", prv, "inlet"); b.wire(prv, "outlet", consumer, "inlet"); b.wire(consumer, "outlet", sink, "fluid");
    const s = new Simulation(b.p);
    stepFor(s, 60);
    rows.push(row("PRV outlet pressure at setpoint (≈4.9 bar supply)", "hydraulic", 150000, s.multiphysics.hydraulic.readings[prv.id]?.pressure ?? NaN, 0.01, "Integral pilot action, 20 kPa band, 5 s stroke, after 60 s"));
  }
  // — Adaptive coupled hydraulic/motor stepping vs fixed 1/60 s —
  {
    const fixed = new Simulation(starter("industrial")), adaptive = new Simulation(starter("industrial"));
    stepFor(fixed, 120);
    const run = adaptive.advanceAdaptive(120);
    const v = (s: Simulation) => Object.values(s.multiphysics.tanks)[1].volume * 1000;
    rows.push(row(`Adaptive pumping station (${run.steps} steps vs 7200): delivered volume`, "multiphysics", v(fixed), v(adaptive), 1e-3, "Mid-step tank levels; motor midpoint coupling"));
    rows.push(row("Adaptive pumping station: relative energy residual", "multiphysics", 0, adaptive.energyResidual / adaptive.suppliedEnergy, 0, "1", 1e-5));
  }
  // — Experiment E: parameter extremes for every implemented component —
  let cases = 0, crashes = 0, nonFinite = 0;
  const notes: string[] = [];
  for (const kind of Object.keys(definitions) as Kind[]) {
    if (kind === "rigidBody") continue;
    for (const [key, value] of Object.entries(definitions[kind].defaults)) {
      const spec = paramSpec(kind, key);
      if (typeof value !== "number" || !spec?.domain || spec.policy === "derived" || spec.policy === "fixed") continue;
      for (const extreme of [spec.positive ? Math.max(spec.domain[0], spec.domain[1] * 1e-12, 1e-9) : spec.domain[0], spec.domain[1]]) {
        cases++;
        const c = makeComponent(kind, 0, 0);
        c.props = applyDerived(kind, { ...c.props, [key]: extreme });
        if (componentError(c)) continue;
        try {
          const s = new Simulation({ version: 3, id: "x", name: "extreme", components: [c], connections: [], probes: [], assemblies: [] });
          for (let i = 0; i < 3; i++) s.step();
          const values = [...Object.values(s.temperatures), s.energyResidual, s.electrical.sourcePower];
          if (!s.error && values.some((v) => !Number.isFinite(v))) { nonFinite++; notes.push(`${kind}.${key}=${extreme}`); }
        } catch (e) {
          if (!(e instanceof Error) || !e.message) { crashes++; notes.push(`${kind}.${key}=${extreme}`); }
        }
      }
    }
  }
  rows.push(row("E: parameter extremes without NaN/Infinity propagation", "all", 0, nonFinite + crashes, 0, `${cases} boundary cases across every component; ${notes.join(", ") || "none failed"}`, 0));
  return rows;
}
