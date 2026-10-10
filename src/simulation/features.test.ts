import { describe, it, expect } from "vitest";
import { Builder, largePumping } from "./scaling-validation";
import { Simulation, DT } from "./engine";
import { starter } from "./projects";
import { connectionError } from "./model";

const run = (s: Simulation, seconds: number) => { for (let i = 0; i < Math.round(seconds / DT); i++) if (!s.step()) break; return s; };

describe("thermal ports and thermal masses", () => {
  it("a resistor on a heat sink reaches the analytic steady-state temperatures", () => {
    const b = new Builder(), src = b.add("source", { voltage: 20, ratedVoltage: 24, maxCurrent: 100 });
    const r = b.add("resistor", { resistance: 10, ratedPower: 100, heatCapacity: 20, loss: 0.2, conductance: 4, maxTemperature: 300 });
    const sink = b.add("thermalMass", { heatCapacity: 540, loss: 3.3, conductance: 50 }, "heatSink");
    b.series(src, r);
    b.wire(r, "heat", sink, "heat");
    const s = new Simulation(b.p);
    s.advanceAdaptive(3600);
    // P = 40 W. Link UA = 1/(1/4 + 1/50); network: r → ambient 0.2 W/K, r → sink link, sink → ambient 3.3 W/K.
    const link = 1 / (1 / 4 + 1 / 50), P = 40;
    const sinkRise = (P - 0.2 * 0) / 1, a = [[0.2 + link, -link], [-link, link + 3.3]];
    const det = a[0][0] * a[1][1] - a[0][1] * a[1][0], tr = (P * a[1][1]) / det, ts = (-a[1][0] * P) / det;
    void sinkRise;
    expect(s.temperatures[r.id] - 20).toBeCloseTo(tr, 2);
    expect(s.temperatures[sink.id] - 20).toBeCloseTo(ts, 2);
    expect(Math.abs(s.suppliedEnergy - s.storedEnergy - s.ambientEnergy)).toBeLessThan(1e-6 * s.suppliedEnergy);
  });
  it("allows thermal links between any thermal masses but keeps single-surface interfaces", () => {
    const b = new Builder(), tank = b.add("tank"), sink = b.add("thermalMass"), heater = b.add("heater"), other = b.add("tank");
    b.wire(heater, "heat", tank, "heat");
    expect(connectionError(b.p, { component: heater.id, port: "heat" }, { component: sink.id, port: "heat" })).toMatch(/already attached/);
    expect(connectionError(b.p, { component: tank.id, port: "heat" }, { component: other.id, port: "heat" })).toMatch(/thermal mass/);
    expect(connectionError(b.p, { component: sink.id, port: "heat" }, { component: tank.id, port: "heat" })).toBeNull();
  });
});
describe("signal conditioning and PID", () => {
  const chain = (kind: "scale" | "limiter" | "filter" | "rateLimiter", props: Record<string, number>, value = 10) => {
    const b = new Builder(), k = b.add("constant", { value }), block = b.add(kind, props);
    b.wire(k, "out", block, "in");
    return { b, k, block };
  };
  it("scales, limits, filters and rate-limits on the simulation clock", () => {
    const sc = chain("scale", { gain: 2.5, offset: -4 }), s1 = new Simulation(sc.b.p);
    expect(s1.automation.signals[sc.block.id].value).toBe(21);
    const lim = chain("limiter", { minOutput: 0, maxOutput: 5 }), s2 = new Simulation(lim.b.p);
    expect(s2.automation.signals[lim.block.id].value).toBe(5);
    // Step changes are applied after the clock starts (a t = 0 edit defines the initial condition).
    const f = chain("filter", { timeConstant: 2 }, 0), s3 = new Simulation(f.b.p);
    s3.step();
    s3.refresh({ ...f.b.p, components: f.b.p.components.map((c) => (c.id === f.k.id ? { ...c, props: { ...c.props, value: 10 } } : c)) });
    run(s3, 2);
    expect(Number(s3.automation.signals[f.block.id].value)).toBeCloseTo(10 * (1 - Math.exp(-1)), 3);
    const rl = chain("rateLimiter", { rate: 3 }, 0), s4 = new Simulation(rl.b.p);
    s4.step();
    s4.refresh({ ...rl.b.p, components: rl.b.p.components.map((c) => (c.id === rl.k.id ? { ...c, props: { ...c.props, value: 100 } } : c)) });
    run(s4, 2);
    expect(Number(s4.automation.signals[rl.block.id].value)).toBeCloseTo(6, 3);
  });
  it("selects minimum, maximum or the switched input", () => {
    const b = new Builder(), a = b.add("constant", { value: 3 }), c = b.add("constant", { value: 7 }), sel = b.add("selector", { mode: "switch" } as never);
    const flag = b.add("comparator", { reference: 5, mode: "gt" } as never);
    b.wire(a, "out", sel, "in"); b.wire(c, "out", sel, "in2"); b.wire(c, "out", flag, "in"); b.wire(flag, "out", sel, "select");
    expect(new Simulation(b.p).automation.signals[sel.id].value).toBe(7);
    sel.props.mode = "min";
    expect(new Simulation(b.p).automation.signals[sel.id].value).toBe(3);
  });
  it("PID derivative acts on the filtered measurement rate", () => {
    const b = new Builder(), k = b.add("constant", { value: 0 }), pid = b.add("pid", { reference: 0, kp: 0, ki: 0, kd: 2, derivativeFilter: 0.001, minOutput: -1e6, maxOutput: 1e6 });
    b.wire(k, "out", pid, "in");
    const s = new Simulation(b.p);
    let p = b.p;
    for (let i = 1; i <= 60; i++) {
      p = { ...p, components: p.components.map((c) => (c.id === k.id ? { ...c, props: { ...c.props, value: i * DT * 5 } } : c)) };
      s.refresh(p);
      s.step();
    }
    // Measurement ramps at 5 units/s: D = −kd·5 = −10.
    expect(Number(s.automation.signals[pid.id].value)).toBeCloseTo(-10, 3);
  });
});
describe("three-phase per-phase network", () => {
  it("a 400 V 3~ supply delivers V_LL²/R into a star-equivalent heater bank and conserves energy", () => {
    const b = new Builder(), src = b.add("source3", { lineVoltage: 400, maxCurrent: 100, maxPower: 1e6 });
    const heater = b.add("heater", { ratedVoltage: 400, ratedPower: 30000, heatCapacity: 4500, conductance: 2700, loss: 4, maxTemperature: 200 });
    const cable = b.add("cable", { area: 10, length: 20, ratedCurrent: 60 }), tank = b.add("tank", {}, "process2000");
    b.series(src, cable, heater);
    b.wire(heater, "heat", tank, "heat");
    const s = new Simulation(b.p), r = s.electrical.readings[heater.id];
    const rh = 400 ** 2 / 30000, rc = cable.props.resistance as number, iLine = 400 / Math.sqrt(3) / (rh + rc);
    expect(r.phases).toBe(3);
    expect(Math.abs(r.current)).toBeCloseTo(iLine, 6);
    expect(r.power).toBeCloseTo(3 * iLine ** 2 * rh, 3);
    expect(s.electrical.sourcePower).toBeCloseTo(3 * iLine ** 2 * (rh + rc), 3);
    s.advanceAdaptive(600);
    expect(Math.abs(s.suppliedEnergy - s.storedEnergy - s.ambientEnergy)).toBeLessThan(1e-6 * s.suppliedEnergy);
  });
  it("rejects a DC motor on a three-phase network", () => {
    const b = new Builder(), src = b.add("source3"), m = b.add("motor");
    b.series(src, m);
    expect(() => new Simulation(b.p)).not.toThrow();
    expect(new Simulation(b.p).error).toMatch(/three-phase/);
  });
});
describe("adaptive hydraulic and motor stepping", () => {
  it("matches fixed steps on a motor-driven pumping system with far fewer steps", () => {
    const fixed = run(new Simulation(starter("industrial")), 60), adaptive = new Simulation(starter("industrial"));
    const result = adaptive.advanceAdaptive(60);
    const volumes = (s: Simulation) => Object.values(s.multiphysics.tanks).map((t) => t.volume);
    volumes(adaptive).forEach((v, i) => expect(Math.abs(v - volumes(fixed)[i])).toBeLessThan(2e-4));
    expect(result.steps).toBeLessThan(3600 / 5);
    expect(Math.abs(adaptive.energyResidual / adaptive.suppliedEnergy)).toBeLessThan(1e-5);
    expect(Math.abs(adaptive.multiphysics.massResidual)).toBeLessThan(1e-6);
  }, 60000);
  it("large 75 kW pumping advances an hour adaptively within conservation tolerances", () => {
    const s = new Simulation(largePumping().p);
    const run = s.advanceAdaptive(3600);
    expect(s.error).toBeNull();
    expect(run.steps).toBeLessThan(5000);
    expect(Math.abs(s.energyResidual / s.suppliedEnergy)).toBeLessThan(1e-4);
    expect(Math.abs(s.multiphysics.massResidual)).toBeLessThan(1e-6);
  }, 120000);
});
describe("build-time configuration does not leave latched state", () => {
  it("a cutoff placed before its sensor target is assigned does not stay tripped at t = 0", () => {
    const b = new Builder(), tank = b.add("tank"), safety = b.add("safety");
    const s = new Simulation(b.p);
    expect(s.automation.memory[safety.id]?.tripped).toBe(true);
    const configured = { ...b.p, components: b.p.components.map((c) => (c.id === safety.id ? { ...c, props: { ...c.props, target: tank.id } } : c)) };
    expect(s.refresh(configured)).toBe(true);
    expect(s.automation.memory[safety.id]?.tripped).toBe(false);
    s.step();
    expect(s.automation.contacts[safety.id]).toBe(true);
  });
});
