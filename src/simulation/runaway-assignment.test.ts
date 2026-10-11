/** Thermal Runaway assignment: complete scored runs of valid designs, rejected designs and faults (long fixed-step runs). */
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
  }, 60000);
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
  }, 60000);
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
  }, 60000);
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
  }, 60000);
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
}, 60000);
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
}, 60000);
