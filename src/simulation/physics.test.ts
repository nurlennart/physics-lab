import { describe, it, expect } from "vitest";
import { connect, makeComponent, connectionError, type Project } from "./model";
import { solveElectrical } from "./electrical";
import { Simulation, FixedClock, DT } from "./engine";
import { starter, parseProject, serializeProject } from "./projects";
import { evaluateChallenge } from "./challenges";
import { replayExperiment } from "./replay";
function circuit(voltage = 12, resistance = 6): Project {
  const source = makeComponent("source", 0, 0),
    r = makeComponent("resistor", 200, 0);
  source.props.voltage = voltage;
  r.props.resistance = resistance;
  r.props.ratedPower = 1000;
  let p: Project = {
    version: 1,
    id: "reference",
    name: "Reference",
    components: [source, r],
    connections: [],
  };
  p = connect(
    p,
    { component: source.id, port: "a" },
    { component: r.id, port: "a" },
  );
  return connect(
    p,
    { component: source.id, port: "b" },
    { component: r.id, port: "b" },
  );
}
function advance(s: Simulation, seconds: number) {
  for (let i = 0; i < seconds / DT; i++) expect(s.step()).toBe(true);
}
describe("DC modified nodal analysis", () => {
  it("reproduces 12 V / 6 Ω = 2 A and 24 W", () => {
    const p = circuit(),
      r = solveElectrical(p);
    expect(r.readings[p.components[1].id].voltage).toBeCloseTo(12, 9);
    expect(r.readings[p.components[1].id].current).toBeCloseTo(2, 9);
    expect(r.dissipatedPower).toBeCloseTo(24, 9);
    expect(r.sourcePower).toBeCloseTo(24, 9);
    expect(r.residual).toBeLessThan(1e-9);
  });
  it("satisfies Kirchhoff voltage and current laws in a series circuit", () => {
    let p = circuit();
    const r2 = makeComponent("resistor", 400, 0);
    r2.props.resistance = 3;
    p = {
      ...p,
      components: [...p.components, r2],
      connections: [p.connections[0]],
    };
    p = connect(
      p,
      { component: p.components[1].id, port: "b" },
      { component: r2.id, port: "a" },
    );
    p = connect(
      p,
      { component: r2.id, port: "b" },
      { component: p.components[0].id, port: "b" },
    );
    const r = solveElectrical(p),
      a = r.readings[p.components[1].id],
      b = r.readings[r2.id];
    expect(a.current).toBeCloseTo(12 / 9, 9);
    expect(a.current).toBeCloseTo(b.current, 9);
    expect(a.voltage + b.voltage).toBeCloseTo(12, 9);
  });
  it("satisfies KCL for parallel branches", () => {
    let p = circuit();
    const r2 = makeComponent("resistor", 400, 0);
    r2.props.resistance = 12;
    p = { ...p, components: [...p.components, r2] };
    p = connect(
      p,
      { component: p.components[0].id, port: "a" },
      { component: r2.id, port: "a" },
    );
    p = connect(
      p,
      { component: p.components[0].id, port: "b" },
      { component: r2.id, port: "b" },
    );
    const r = solveElectrical(p);
    expect(r.readings[p.components[0].id].current).toBeCloseTo(-3, 9);
    expect(r.dissipatedPower).toBeCloseTo(36, 9);
  });
  it("opens and closes a real switch", () => {
    const p = starter("light"),
      sw = p.components.find((c) => c.kind === "switch")!;
    expect(solveElectrical(p).dissipatedPower).toBeGreaterThan(23);
    sw.props.closed = false;
    expect(solveElectrical(p).dissipatedPower).toBeCloseTo(0, 9);
  });
  it("handles disconnected circuits without inventing current", () => {
    const p = starter("heat", true);
    expect(solveElectrical(p).dissipatedPower).toBe(0);
  });
  it("rejects ideal-source shorts and conflicting voltage sources", () => {
    const p = circuit();
    p.connections.push({
      id: "short",
      domain: "electrical",
      from: { component: p.components[0].id, port: "a" },
      to: { component: p.components[0].id, port: "b" },
    });
    expect(() => solveElectrical(p)).toThrow(/shorted/);
    let q = circuit();
    const source = makeComponent("source", 400, 0);
    source.props.voltage = 20;
    q.components.push(source);
    q = connect(
      q,
      { component: q.components[0].id, port: "a" },
      { component: source.id, port: "a" },
    );
    q = connect(
      q,
      { component: q.components[0].id, port: "b" },
      { component: source.id, port: "b" },
    );
    expect(() => solveElectrical(q)).toThrow(/Singular/);
  });
});
describe("thermal coupling and energy", () => {
  it("integrates electrical energy in joules", () => {
    const s = new Simulation(circuit());
    advance(s, 5);
    expect(s.energy).toBeCloseTo(120, 7);
  });
  it("conserves thermal energy including ambient loss", () => {
    const s = new Simulation(starter("heat"));
    advance(s, 20);
    expect(
      s.temperatures[s.project.components.find((c) => c.kind === "tank")!.id],
    ).toBeGreaterThan(20.7);
    expect(Math.abs(s.energy - s.storedEnergy - s.ambientEnergy)).toBeLessThan(
      1e-5,
    );
    expect(s.ambientEnergy).toBeGreaterThan(0);
  });
  it("reproduces sensible heat for isolated 10 L water using its physical initial mass", () => {
    const p = starter("heat"),
      h = p.components.find((c) => c.kind === "heater")!,
      t = p.components.find((c) => c.kind === "tank")!,
      sw = p.components.find((c) => c.kind === "switch")!;
    h.props.loss = 0;
    t.props.loss = 0;
    sw.props.loss = 0;
    sw.props.heatCapacity = 20;
    const s = new Simulation(p);
    for (let i = 0; i < 80000 && (s.temperatures[t.id] ?? 20) < 80; i++)
      s.step();
    // Independent evaluation of the declared Kell approximation at 20 °C.
    // Assert the actual ledger, rather than assuming that 10 L is exactly 10 kg.
    const expected = 0.01 * 998.2041322 * 4180 * 60;
    expect(s.waterStored).toBeGreaterThanOrEqual(expected - 0.001);
    expect(s.waterStored).toBeLessThan(expected + 40);
    expect(Math.abs(s.energy - s.storedEnergy - s.ambientEnergy)).toBeLessThan(
      0.002,
    );
  });
  it("cools toward ambient through declared heat loss", () => {
    const p = starter("heat");
    p.components.find((c) => c.kind === "switch")!.props.closed = false;
    const t = p.components.find((c) => c.kind === "tank")!;
    t.props.initialTemperature = 80;
    t.props.loss = 100;
    const s = new Simulation(p);
    advance(s, 10);
    expect(s.temperatures[t.id]).toBeLessThan(79);
    expect(s.energy).toBe(0);
    expect(Math.abs(s.storedEnergy + s.ambientEnergy)).toBeLessThan(1e-5);
  });
  it("does not heat a disconnected tank", () => {
    const p = starter("heat");
    p.connections = p.connections.filter((w) => w.domain !== "thermal");
    const s = new Simulation(p);
    advance(s, 1);
    expect(
      s.temperatures[p.components.find((c) => c.kind === "tank")!.id],
    ).toBe(20);
  });
  it("opens an overloaded fuse and records a timestamp", () => {
    const p = circuit(12, 1),
      f = makeComponent("fuse", 100, 0);
    f.props.ratedCurrent = 5;
    p.components.push(f);
    p.connections.pop();
    let q = connect(
      p,
      { component: p.components[0].id, port: "b" },
      { component: f.id, port: "a" },
    );
    q = connect(
      q,
      { component: f.id, port: "b" },
      { component: p.components[1].id, port: "b" },
    );
    const s = new Simulation(q);
    advance(s, 0.2);
    expect(s.failed[f.id]).toBe(true);
    expect(s.electrical.dissipatedPower).toBeCloseTo(0, 6);
    expect(s.events.some((e) => e.level === "error" && e.time > 0)).toBe(true);
  });
});
describe("clock and lifecycle", () => {
  it("pause preserves time and reset restores initial conditions", () => {
    const p = starter("heat"),
      s = new Simulation(p),
      clock = new FixedClock();
    advance(s, 1);
    clock.advance(0.2, 1, false, () => s.step());
    expect(s.time).toBeCloseTo(1, 9);
    s.reset();
    expect(s.time).toBe(0);
    expect(s.energy).toBe(0);
    expect(s.samples.length).toBe(1);
    expect(Object.values(s.temperatures).every((t) => t === 20)).toBe(true);
  });
  it("produces identical physics at 30, 60, and 144 rendering FPS", () => {
    const outcomes = [30, 60, 144].map((fps) => {
      const p = circuit(),
        s = new Simulation(p),
        clock = new FixedClock();
      for (let i = 0; i < fps * 5; i++)
        clock.advance(1 / fps, 1, true, () => s.step());
      return { time: s.time, energy: s.energy };
    });
    expect(outcomes[0]).toEqual(outcomes[1]);
    expect(outcomes[1]).toEqual(outcomes[2]);
    expect(outcomes[0].energy).toBeCloseTo(120, 7);
  });
  it("4x speed advances four times as many fixed steps", () => {
    const s = new Simulation(circuit()),
      clock = new FixedClock();
    for (let i = 0; i < 60; i++) clock.advance(1 / 60, 4, true, () => s.step());
    expect(s.time).toBeCloseTo(4, 9);
  });
});
describe("challenges and project validation", () => {
  it("scores actual safe light operation, and rejects an open circuit", () => {
    const p = starter("light");
    p.challenge = "light";
    const s = new Simulation(p);
    advance(s, 3.1);
    const r = evaluateChallenge(p, s)!;
    expect(r.complete).toBe(true);
    expect(r.stars).toBe(3);
    const open = starter("light", true),
      o = new Simulation(open);
    advance(o, 4);
    expect(evaluateChallenge(open, o)!.complete).toBe(false);
  });
  it("prevents bypassing heating with changed initial conditions", () => {
    const p = starter("heat");
    p.challenge = "heat";
    p.components.find((c) => c.kind === "tank")!.props.initialTemperature = 80;
    expect(() => new Simulation(p)).toThrow(/locked/);
  });
  it("completes the heating challenge from measured temperature", () => {
    const p = starter("heat");
    p.challenge = "heat";
    const s = new Simulation(p);
    for (let i = 0; i < 90000; i++) {
      if (!s.step()) throw Error(s.error!);
      if (evaluateChallenge(p, s)!.complete) break;
    }
    const r = evaluateChallenge(p, s)!;
    expect(r.complete).toBe(true);
    expect(r.stars).toBe(3);
    expect(s.energy).toBeGreaterThan(2508000);
    expect(s.time).toBeGreaterThan(1254);
    expect(s.peakPower).toBeLessThanOrEqual(2000);
  });
  it("round trips versioned projects", () => {
    const p = starter();
    expect(parseProject(JSON.parse(serializeProject(p)))).toEqual(p);
  });
  it("rejects invalid domains, duplicates, unknown versions and NaNs", () => {
    const p = starter(),
      h = p.components.find((c) => c.kind === "heater")!,
      t = p.components.find((c) => c.kind === "tank")!;
    expect(
      connectionError(
        p,
        { component: h.id, port: "a" },
        { component: t.id, port: "heat" },
      ),
    ).toMatch(/Electrical and thermal/);
    expect(
      connectionError(p, p.connections[0].from, p.connections[0].to),
    ).toMatch(/already connected/);
    expect(() => parseProject({ ...p, version: 99 })).toThrow(/version/);
    const bad = structuredClone(p);
    bad.components[0].props.voltage = NaN;
    expect(() => parseProject(bad)).toThrow(/out of range/);
  });
});

describe("deterministic input replay", () => {
  it("reproduces an experiment with a mid-run switch operation", () => {
    const origin = starter("heat"),
      s = new Simulation(origin);
    advance(s, 3);
    const edited = structuredClone(origin);
    edited.components.find((c) => c.kind === "switch")!.props.closed = false;
    s.refresh(edited);
    advance(s, 2);
    const replayed = replayExperiment(origin, [{ at: 3, project: edited }], 5);
    expect(replayed.time).toBe(s.time);
    expect(replayed.energy).toBe(s.energy);
    expect(replayed.temperatures).toEqual(s.temperatures);
  });
});
