import { describe, it, expect } from "vitest";
import { starter, parseProject, serializeProject } from "./projects";
import { Simulation, DT, FixedClock } from "./engine";
import { Automation, type ControlWorld } from "./automation";
import {
  makeComponent,
  connect,
  catalog,
  uid,
  type Project,
  type Kind,
} from "./model";
import { evaluateChallenge } from "./challenges";
import { readProbe } from "./measurements";
import { replayExperiment } from "./replay";
import { captureAssembly, insertAssembly } from "../editor/assemblies";
import { routePoints, portPoint } from "../editor/geometry";
function advance(s: Simulation, t: number, dt = DT) {
  for (let i = 0; i < Math.round(t / dt); i++) {
    if (!s.step(dt)) throw Error(s.error ?? "Step failed");
  }
}
function blocks(kinds: Kind[]) {
  const p = starter("blank");
  p.components = kinds.map((k, i) =>
    makeComponent(k, i * 200, 0, p.components),
  );
  let project = p;
  const wire = (a: number, ap: string, b: number, bp: string) => {
    project = connect(
      project,
      { component: p.components[a].id, port: ap },
      { component: p.components[b].id, port: bp },
    );
  };
  const world = (): ControlWorld => ({
    project,
    time: 0,
    temperatures: {},
    faults: {},
    failed: {},
    disconnected: new Set(),
    log: () => {},
  });
  return { p, wire, world };
}
describe("simulation-clock automation", () => {
  it("comparator modes use independently specified numeric references", () => {
    for (const [mode, expected] of [
      ["lt", false],
      ["lte", true],
      ["gt", false],
      ["gte", true],
    ] as const) {
      const b = blocks(["constant", "comparator"]);
      b.p.components[0].props.value = 80;
      b.p.components[1].props.mode = mode;
      b.wire(0, "out", 1, "in");
      const a = new Automation();
      a.evaluate(b.world(), DT);
      expect(a.signals[b.p.components[1].id].value).toBe(expected);
    }
  });
  it("hysteresis retains state strictly between the switching thresholds", () => {
    const b = blocks(["constant", "hysteresis"]);
    b.wire(0, "out", 1, "in");
    const a = new Automation(),
      w = b.world(),
      k = b.p.components[0],
      id = b.p.components[1].id;
    for (const [temperature, on] of [
      [77, true],
      [79, true],
      [80, false],
      [79, false],
      [77.99, true],
    ] as const) {
      k.props.value = temperature;
      a.evaluate(w, DT);
      expect(a.signals[id].value).toBe(on);
    }
  });
  it.each(["onDelay", "offDelay", "pulse"])(
    "%s timer advances only with simulation steps",
    (mode) => {
      const b = blocks(["reset", "timer"]);
      b.p.components[1].props.mode = mode;
      b.p.components[1].props.delay = 1;
      b.wire(0, "out", 1, "in");
      const a = new Automation(),
        w = b.world(),
        input = b.p.components[0].id,
        id = b.p.components[1].id;
      for (let i = 0; i < 60; i++) {
        if (mode === "onDelay" || i === 0) a.pulses.add(input);
        a.evaluate(w, DT);
        w.time += DT;
      }
      expect(a.memory[id].elapsed).toBeCloseTo(
        mode === "offDelay" ? 59 / 60 : 1,
        9,
      );
      expect(a.signals[id].value).toBe(true);
      a.evaluate(w, DT);
      expect(a.signals[id].value).toBe(false);
    },
  );
  it("AND, OR, NOT and reset-dominant latch propagate real Boolean values", () => {
    const b = blocks(["reset", "reset", "and", "or", "not", "latch"]);
    b.wire(0, "out", 2, "in");
    b.wire(1, "out", 2, "in2");
    b.wire(0, "out", 3, "in");
    b.wire(1, "out", 3, "in2");
    b.wire(0, "out", 4, "in");
    b.wire(0, "out", 5, "set");
    b.wire(1, "out", 5, "reset");
    const a = new Automation(),
      w = b.world();
    a.pulses.add(b.p.components[0].id);
    a.evaluate(w, DT);
    expect(
      [2, 3, 4, 5].map((i) => a.signals[b.p.components[i].id].value),
    ).toEqual([false, true, false, true]);
    a.pulses.add(b.p.components[0].id);
    a.pulses.add(b.p.components[1].id);
    a.evaluate(w, DT);
    expect(a.signals[b.p.components[5].id].value).toBe(false);
  });
  it("rejects mismatched types, multiple drivers, and control loops", () => {
    const b = blocks(["constant", "not", "not"]);
    expect(() => b.wire(0, "out", 1, "in")).toThrow(/Boolean/);
    b.wire(1, "out", 2, "in");
    expect(() => b.wire(2, "out", 1, "in")).toThrow(/cycles/);
    const c = makeComponent("not", 0, 0);
    b.p.components.push(c);
    expect(() =>
      connect(
        b.world().project,
        { component: c.id, port: "out" },
        { component: b.p.components[2].id, port: "in" },
      ),
    ).toThrow(/one driver/);
  });
});
describe("closed-loop physical experiments", () => {
  it("sensor reads thermal state, applies exact first-order lag and explicit faults", () => {
    const p = starter("automated"),
      tank = p.components.find((c) => c.kind === "tank")!,
      sensor = p.components.find((c) => c.kind === "sensor")!;
    sensor.props.lag = 2;
    const s = new Simulation(p);
    s.temperatures[tank.id] = 30;
    s.automation.evaluate(s, 1);
    expect(Number(s.automation.signals[sensor.id].value)).toBeCloseTo(
      20 + 10 * (1 - Math.exp(-0.5)),
      2,
    );
    s.injectFault(sensor.id, "sensorFault");
    expect(s.automation.signals[sensor.id].valid).toBe(false);
    expect(s.temperatures[tank.id]).toBe(30);
  });
  it("relay contact resistance changes actual circuit current; lost control opens NO", () => {
    const p = starter("automated"),
      heater = p.components.find((c) => c.kind === "heater")!,
      relay = p.components.find((c) => c.kind === "relay")!,
      sensor = p.components.find((c) => c.kind === "sensor")!,
      s = new Simulation(p);
    expect(s.electrical.readings[heater.id].current).toBeCloseTo(
      240 / (28.8 + 0.02 + 0.01),
      10,
    );
    expect(s.electrical.readings[relay.id].power).toBeCloseTo(
      (240 / 28.83) ** 2 * 0.02,
      9,
    );
    s.injectFault(sensor.id, "sensorFault");
    expect(s.electrical.readings[heater.id].power).toBe(0);
    s.injectFault(relay.id, "stuckClosed");
    expect(s.electrical.readings[heater.id].power).toBeGreaterThan(1900);
  });
  it("SPDT normally-closed branch conducts with an OFF command", () => {
    let p = starter("blank");
    const source = makeComponent("source", 0, 0),
      relay = makeComponent("relay", 200, 0),
      load = makeComponent("resistor", 400, 0);
    source.props.voltage = 12;
    p.components = [source, relay, load];
    for (const [a, ap, b, bp] of [
      [source, "a", relay, "a"],
      [relay, "nc", load, "a"],
      [load, "b", source, "b"],
    ] as const)
      p = connect(
        p,
        { component: a.id, port: ap },
        { component: b.id, port: bp },
      );
    const s = new Simulation(p);
    expect(s.electrical.readings[relay.id].current).toBe(0);
    expect(s.electrical.readings[relay.id].currentNC).toBeCloseTo(
      12 / 6.02,
      10,
    );
  });
  it("an undersized paid relay fails open and immediately updates measurements", () => {
    const p = starter("automated"),
      relay = p.components.find((c) => c.kind === "relay")!;
    relay.variant = "compact";
    relay.props = catalog(relay).props;
    const s = new Simulation(p);
    advance(s, 0.6);
    expect(s.failed[relay.id]).toBe(true);
    expect(s.electrical.dissipatedPower).toBe(0);
    s.reset();
    expect(s.failed).toEqual({});
    expect(s.electrical.dissipatedPower).toBeGreaterThan(1900);
  });
  it("independent cutoff interrupts welded heating, retains heat and requires cool manual reset", () => {
    const p = starter("automated"),
      tank = p.components.find((c) => c.kind === "tank")!,
      heater = p.components.find((c) => c.kind === "heater")!,
      relay = p.components.find((c) => c.kind === "relay")!,
      cutoff = p.components.find((c) => c.kind === "safety")!;
    tank.props.initialTemperature = 89.8;
    const s = new Simulation(p);
    s.injectFault(relay.id, "stuckClosed");
    advance(s, 40);
    expect(s.automation.memory[cutoff.id].tripped).toBe(true);
    expect(s.electrical.readings[heater.id].power).toBe(0);
    expect(s.resetSafety(cutoff.id)).toMatch(/above/);
    expect(Math.abs(s.energy - s.storedEnergy - s.ambientEnergy)).toBeLessThan(
      0.001,
    );
    advance(s, 400);
    expect(s.resetSafety(cutoff.id)).toBeNull();
    expect(s.automation.contacts[cutoff.id]).toBe(true);
  });
  it("safety sensor failure trips; welded safety contact explicitly defeats interruption", () => {
    const p = starter("automated"),
      cutoff = p.components.find((c) => c.kind === "safety")!,
      s = new Simulation(p);
    s.injectFault(cutoff.id, "sensorFault");
    expect(s.automation.memory[cutoff.id].tripped).toBe(true);
    expect(s.electrical.dissipatedPower).toBe(0);
    expect(s.resetSafety(cutoff.id)).toMatch(/invalid/);
    s.injectFault(cutoff.id, "stuckClosed");
    expect(s.electrical.dissipatedPower).toBeGreaterThan(1900);
  });
  it("long regulation remains bounded and conserves energy", () => {
    const p = starter("automated"),
      s = new Simulation(p),
      tank = p.components.find((c) => c.kind === "tank")!,
      heater = p.components.find((c) => c.kind === "heater")!;
    advance(s, 2300);
    expect(s.temperatures[tank.id]).toBeGreaterThan(77.5);
    expect(s.temperatures[tank.id]).toBeLessThan(80.6);
    expect(
      s.automation.memory[p.components.find((c) => c.kind === "hysteresis")!.id]
        .switches,
    ).toBeGreaterThan(3);
    expect(
      Math.abs(s.suppliedEnergy - s.storedEnergy - s.ambientEnergy),
    ).toBeLessThan(0.001);
    expect(s.componentEnergy[heater.id]).toBeGreaterThan(2508000);
  }, 15000);
  it("thermostat convenience component uses the same sensor and hysteresis logic", () => {
    let p = starter("automated");
    const hc = p.components.find((c) => c.kind === "hysteresis")!,
      tank = p.components.find((c) => c.kind === "tank")!;
    const th = makeComponent("thermostat", hc.x, hc.y);
    th.id = hc.id;
    th.props.target = tank.id;
    p = {
      ...p,
      components: p.components.map((c) => (c.id === hc.id ? th : c)),
      connections: p.connections.filter((w) => w.to.component !== hc.id),
    };
    const s = new Simulation(p);
    expect(s.automation.signals[th.id].value).toBe(true);
    s.temperatures[tank.id] = 80;
    s.automation.evaluate(s, DT);
    expect(s.automation.signals[th.id].value).toBe(false);
  });
  it("cooling faults change heat flux and retain energy accounting", () => {
    const p = starter("automated"),
      tank = p.components.find((c) => c.kind === "tank")!,
      cooler = p.components.find((c) => c.kind === "cooler")!;
    tank.props.initialTemperature = 80;
    const normal = new Simulation(p),
      failed = new Simulation(p);
    failed.injectFault(cooler.id, "coolingFailed");
    advance(normal, 10);
    advance(failed, 10);
    expect(failed.temperatures[tank.id]).toBeGreaterThan(
      normal.temperatures[tank.id],
    );
    expect(
      Math.abs(normal.energy - normal.storedEnergy - normal.ambientEnergy),
    ).toBeLessThan(1e-5);
  });
  it("typed probe targets and node references survive save/load; floating comparison invalid", () => {
    const p = starter("automated"),
      heater = p.components.find((c) => c.kind === "heater")!,
      s = new Simulation(p);
    expect(parseProject(JSON.parse(serializeProject(p))).probes).toEqual(
      p.probes,
    );
    const probe = {
      id: uid(),
      name: "Current",
      component: heater.id,
      measurement: "current" as const,
      color: "#ffffff",
      visible: true,
    };
    expect(readProbe(probe, s)).toBeCloseTo(240 / 28.83, 9);
    const p2 = starter("blank"),
      a = makeComponent("source", 0, 0),
      b = makeComponent("source", 200, 0);
    p2.components = [a, b];
    const f = new Simulation(p2);
    expect(
      readProbe(
        {
          ...probe,
          component: a.id,
          measurement: "nodeVoltage",
          terminal: "a",
          reference: { component: b.id, port: "b" },
        },
        f,
      ),
    ).toBeNull();
  });
  it("replay restores controller, relay, safety, temperatures, energy, timer and fault state", () => {
    const p = starter("automated"),
      sensor = p.components.find((c) => c.kind === "sensor")!,
      s = new Simulation(p);
    advance(s, 3);
    s.injectFault(sensor.id, "sensorFault");
    advance(s, 2);
    const r = replayExperiment(
      p,
      [{ at: 3, fault: { id: sensor.id, type: "sensorFault" } }],
      5,
    );
    expect(r.temperatures).toEqual(s.temperatures);
    expect(r.energy).toBe(s.energy);
    expect(r.automation.memory).toEqual(s.automation.memory);
    expect(r.faults).toEqual(s.faults);
    expect(r.automation.contacts).toEqual(s.automation.contacts);
  });
  it("automation is independent of render rate and pause", () => {
    const p = starter("automated");
    const run = (fps: number) => {
      const s = new Simulation(p),
        clock = new FixedClock();
      for (let i = 0; i < fps * 5; i++)
        clock.advance(1 / fps, 1, true, () => s.step());
      clock.advance(0.2, 4, false, () => s.step());
      return s;
    };
    expect(run(30).temperatures).toEqual(run(144).temperatures);
  });
});
describe("connected editor operations", () => {
  it("duplicates internal wiring, sensor targets and routes without external connections", () => {
    const p = starter("automated"),
      a = captureAssembly(
        p,
        p.components.map((c) => c.id),
      ),
      next = insertAssembly(p, a);
    expect(next.components).toHaveLength(p.components.length * 2);
    expect(next.connections).toHaveLength(p.connections.length * 2);
    const ids = new Set(
      next.components.slice(p.components.length).map((c) => c.id),
    );
    for (const w of next.connections.slice(p.connections.length)) {
      expect(ids.has(w.from.component)).toBe(true);
      expect(ids.has(w.to.component)).toBe(true);
    }
    const sensor = next.components
      .slice(p.components.length)
      .find((c) => c.kind === "sensor")!;
    expect(ids.has(String(sensor.props.target))).toBe(true);
    expect(parseProject(next).components).toHaveLength(16);
  });
  it("omits external wires and sensor targets from captured groups", () => {
    const p = starter("automated"),
      sensor = p.components.find((c) => c.kind === "sensor")!,
      a = captureAssembly(p, [sensor.id]);
    expect(a.connections).toHaveLength(0);
    expect(a.components[0].props.target).toBe("");
  });
  it("routes stay orthogonal with explicit bend points and attached endpoints", () => {
    const p = starter("automated"),
      w = p.connections[0];
    w.route = [
      { x: 250, y: 30 },
      { x: 310, y: 70 },
    ];
    for (const c of p.components) c.rotation = 90;
    const points = routePoints(w, p.components);
    expect(points[0]).toEqual(portPoint(p.components[0], w.from.port));
    for (let i = 1; i < points.length; i++)
      expect(
        points[i].x === points[i - 1].x || points[i].y === points[i - 1].y,
      ).toBe(true);
    expect(parseProject(p).connections[0].route).toEqual(w.route);
  });
});
describe("Thermal Runaway assignment", () => {
  it("valid automatic control plus independent protection and manual recovery succeeds", () => {
    const p = starter("automated");
    p.challenge = "runaway";
    const s = new Simulation(p);
    for (let i = 0; i < 3600 * 60; i++) {
      if (
        s.runaway.phase === "recovery" &&
        s.runaway.safetyId &&
        !s.automation.memory[s.runaway.safetyId].manualResets
      ) {
        const cutoff = p.components.find((c) => c.id === s.runaway.safetyId)!;
        if (s.temperatures[String(cutoff.props.target)] <= 85)
          s.resetSafety(cutoff.id);
      }
      if (!s.step()) break;
      if (evaluateChallenge(p, s)?.complete) break;
    }
    expect(s.error).toBeNull();
    expect(s.runaway.phase).toBe("complete");
    expect(evaluateChallenge(p, s)?.complete).toBe(true);
    expect(s.runaway.maxTemperature).toBeLessThan(95);
    expect(s.runaway.normalTime).toBeGreaterThanOrEqual(240);
    expect(s.runaway.switches).toBeGreaterThan(2);
    expect(s.runaway.automaticSwitches).toBeGreaterThanOrEqual(2);
    expect(s.runaway.recoverySwitches).toBeGreaterThanOrEqual(2);
  }, 20000);
  it("environment, budget and rating exploits are rejected, including imported projects", () => {
    for (const field of ["ambient", "initialTemperature", "volume"]) {
      const p = starter("runaway", true);
      p.components.find((c) => c.kind === "tank")!.props[field] = 90;
      expect(() => parseProject(p)).toThrow();
    }
    const p = starter("automated");
    p.challenge = "runaway";
    p.components.find((c) => c.kind === "relay")!.props.ratedCurrent = 100;
    expect(() => new Simulation(p)).toThrow(/catalog/);
  });
  it("a solution without independent interruption cannot pass welded contacts", () => {
    let p = starter("automated");
    const cutoff = p.components.find((c) => c.kind === "safety")!;
    cutoff.props.threshold = 95;
    p.challenge = "runaway";
    const s = new Simulation(p);
    for (let i = 0; i < 3600 * 60; i++) {
      if (!s.step() || s.runaway.phase === "recovery") break;
    }
    expect(evaluateChallenge(p, s)?.complete).toBe(false);
    expect(s.runaway.maxTemperature).toBeGreaterThanOrEqual(94.9);
  }, 20000);
});
describe("challenge fault rejection and alternative controllers", () => {
  it("scored primary sensor loss interrupts actual power and awards no completion", () => {
    const p = starter("automated");
    p.challenge = "runaway";
    const sensor = p.components.find((c) => c.kind === "sensor")!,
      heater = p.components.find((c) => c.kind === "heater")!,
      s = new Simulation(p);
    expect(s.injectFault(sensor.id, "sensorFault")).toMatch(/scored/);
    s.injectFault(sensor.id, "sensorFault", true);
    advance(s, 10);
    expect(s.electrical.readings[heater.id].power).toBe(0);
    expect(evaluateChallenge(p, s)?.complete).toBe(false);
  });
  it("an overloaded catalog relay fails the scored experiment", () => {
    const p = starter("automated");
    p.challenge = "runaway";
    const relay = p.components.find((c) => c.kind === "relay")!;
    relay.variant = "compact";
    relay.props = catalog(relay).props;
    const s = new Simulation(p);
    advance(s, 1);
    expect(evaluateChallenge(p, s)?.failed).toBe(true);
    expect(evaluateChallenge(p, s)?.score).toBe(0);
  });
  it("a genuinely absent safety cutoff cannot pass the physical welded-contact fault", () => {
    let p = starter("automated");
    const cutoff = p.components.find((c) => c.kind === "safety")!,
      relay = p.components.find((c) => c.kind === "relay")!,
      heater = p.components.find((c) => c.kind === "heater")!;
    p = {
      ...p,
      components: p.components.filter((c) => c.id !== cutoff.id),
      connections: p.connections.filter(
        (w) => w.from.component !== cutoff.id && w.to.component !== cutoff.id,
      ),
      challenge: "runaway",
    };
    p = connect(
      p,
      { component: relay.id, port: "b" },
      { component: heater.id, port: "a" },
    );
    const s = new Simulation(p);
    for (let i = 0; i < 3600 * 60; i++) if (!s.step()) break;
    expect(s.error).toMatch(/supported liquid range/);
    expect(evaluateChallenge(p, s)?.failed).toBe(true);
    expect(s.runaway.safetyId).toBe("");
  }, 15000);
  it("a thermostat with its own sensor is an alternative valid challenge solution", () => {
    let p = starter("automated");
    const hc = p.components.find((c) => c.kind === "hysteresis")!,
      sensor = p.components.find((c) => c.kind === "sensor")!,
      tank = p.components.find((c) => c.kind === "tank")!,
      th = makeComponent("thermostat", hc.x, hc.y);
    th.id = hc.id;
    th.props.target = tank.id;
    p = {
      ...p,
      challenge: "runaway",
      components: p.components
        .filter((c) => c.id !== sensor.id)
        .map((c) => (c.id === hc.id ? th : c)),
      connections: p.connections.filter((w) => w.from.component !== sensor.id),
      probes: p.probes,
    };
    const s = new Simulation(p);
    for (let i = 0; i < 3600 * 60; i++) {
      if (
        s.runaway.phase === "recovery" &&
        s.runaway.safetyId &&
        !s.automation.memory[s.runaway.safetyId].manualResets &&
        s.temperatures[tank.id] <= 85
      )
        s.resetSafety(s.runaway.safetyId);
      if (!s.step() || evaluateChallenge(p, s)?.complete) break;
    }
    expect(evaluateChallenge(p, s)?.complete).toBe(true);
  }, 20000);
  it("engine-owned construction is immutable and replacement still enforces locked conditions", () => {
    const p = starter("automated");
    p.challenge = "runaway";
    const s = new Simulation(p),
      tank = s.project.components.find((c) => c.kind === "tank")!;
    expect(() => {
      tank.props.ambient = 90;
    }).toThrow();
    const modified = structuredClone(s.project);
    modified.components.find((c) => c.kind === "tank")!.props.ambient = 90;
    s.project = modified;
    expect(s.step()).toBe(false);
    expect(s.time).toBe(0);
  });
});
it("replays latched safety manual reset and simulation timer pulse memory", () => {
  let p = starter("automated");
  const pulse = makeComponent("reset", 0, 700),
    timer = makeComponent("timer", 200, 700);
  timer.props.mode = "offDelay";
  timer.props.delay = 0.5;
  p.components.push(pulse, timer);
  p = connect(
    p,
    { component: pulse.id, port: "out" },
    { component: timer.id, port: "in" },
  );
  const cutoff = p.components.find((c) => c.kind === "safety")!,
    s = new Simulation(p);
  s.pulse(pulse.id);
  advance(s, 1);
  s.injectFault(cutoff.id, "sensorFault");
  advance(s, 1);
  s.injectFault(cutoff.id, null);
  expect(s.resetSafety(cutoff.id)).toBeNull();
  advance(s, 1);
  const r = replayExperiment(
    p,
    [
      { at: 0, pulse: pulse.id },
      { at: 1, fault: { id: cutoff.id, type: "sensorFault" } },
      { at: 2, fault: { id: cutoff.id, type: null } },
      { at: 2, resetSafety: cutoff.id },
    ],
    3,
  );
  expect(r.automation.memory).toEqual(s.automation.memory);
  expect(r.automation.signals).toEqual(s.automation.signals);
  expect(r.temperatures).toEqual(s.temperatures);
  expect(r.energy).toBe(s.energy);
  expect(r.automation.memory[cutoff.id].manualResets).toBe(1);
});
it("component-state probes reflect comparator output and cooler activation", () => {
  const b = blocks(["constant", "comparator", "cooler"]);
  b.p.components[0].props.value = 79;
  b.wire(0, "out", 1, "in");
  const s = new Simulation(b.world().project),
    c = b.p.components[1],
    probe = {
      id: "state",
      name: "state",
      component: c.id,
      measurement: "state" as const,
      color: "#ffffff",
      visible: true,
    };
  expect(readProbe(probe, s)).toBe(1);
  s.injectFault(c.id, "disabled");
  expect(readProbe(probe, s)).toBeNull();
  const p = structuredClone(s.project);
  p.components[2].props.enabled = false;
  s.refresh(p);
  expect(readProbe({ ...probe, component: p.components[2].id }, s)).toBe(0);
});
it("ground and junction metadata contain only actual electrical terminals", () => {
  const b = blocks(["ground", "junction"]);
  let p = b.p;
  p = connect(
    p,
    { component: p.components[0].id, port: "a" },
    { component: p.components[1].id, port: "a" },
  );
  const s = new Simulation(p);
  expect(Object.keys(s.electrical.nodeIds ?? {})).toHaveLength(2);
  expect(new Set(Object.values(s.electrical.nodeIds ?? {})).size).toBe(1);
});
it("an unwired safety latch cannot claim credit for a separate manual disconnection", () => {
  let p = starter("automated");
  const cutoff = p.components.find((c) => c.kind === "safety")!,
    relay = p.components.find((c) => c.kind === "relay")!,
    heater = p.components.find((c) => c.kind === "heater")!,
    source = p.components.find((c) => c.kind === "source")!,
    sw = makeComponent("switch", 0, 700);
  p.components.push(sw);
  p.connections = p.connections.filter(
    (w) =>
      w.from.component !== cutoff.id &&
      w.to.component !== cutoff.id &&
      !(w.from.component === heater.id && w.from.port === "b"),
  );
  for (const [a, ap, b, bp] of [
    [relay, "b", heater, "a"],
    [heater, "b", sw, "a"],
    [sw, "b", source, "b"],
  ] as const)
    p = connect(
      p,
      { component: a.id, port: ap },
      { component: b.id, port: bp },
    );
  p.challenge = "runaway";
  const s = new Simulation(p);
  for (let i = 0; i < 3000 * 60; i++) {
    if (!s.step()) break;
    if (s.automation.memory[cutoff.id]?.tripped) {
      const off = structuredClone(s.project);
      off.components.find((c) => c.id === sw.id)!.props.closed = false;
      s.refresh(off);
      advance(s, 30);
      break;
    }
  }
  expect(s.automation.memory[cutoff.id]?.tripped).toBe(true);
  expect(s.electrical.readings[heater.id].power).toBe(0);
  expect(s.runaway.safetyId).toBe("");
  expect(s.runaway.phase).toBe("fault");
  expect(evaluateChallenge(s.project, s)?.complete).toBe(false);
}, 15000);
it("redundant independent cutoffs in series remain a valid engineered solution", () => {
  let p = starter("automated");
  const first = p.components.find((c) => c.kind === "safety")!,
    heater = p.components.find((c) => c.kind === "heater")!,
    tank = p.components.find((c) => c.kind === "tank")!,
    second = makeComponent("safety", 600, 700, p.components);
  second.props.target = tank.id;
  p.components.push(second);
  p.connections = p.connections.filter(
    (w) => !(w.from.component === first.id && w.from.port === "b"),
  );
  p = connect(
    p,
    { component: first.id, port: "b" },
    { component: second.id, port: "a" },
  );
  p = connect(
    p,
    { component: second.id, port: "b" },
    { component: heater.id, port: "a" },
  );
  p.challenge = "runaway";
  const s = new Simulation(p);
  for (let i = 0; i < 3600 * 60; i++) {
    if (s.runaway.phase === "recovery" && s.temperatures[tank.id] <= 85)
      for (const cutoff of [first, second])
        if (s.automation.memory[cutoff.id]?.tripped) s.resetSafety(cutoff.id);
    if (!s.step() || evaluateChallenge(p, s)?.complete) break;
  }
  expect(evaluateChallenge(p, s)?.complete).toBe(true);
  expect(s.automation.memory[first.id].manualResets).toBe(1);
  expect(s.automation.memory[second.id].manualResets).toBe(1);
}, 20000);
