import { describe, it, expect } from "vitest";
import { starter, parseProject } from "./projects";
import { Simulation } from "./engine";
import { catalog, makeComponent, projectCost } from "./model";
import { propertyError, transitionError, challengeError } from "./integrity";
describe("engine-boundary integrity", () => {
  it("rejects a mass or inventory edit after the clock has advanced", () => {
    const p = starter(),
      s = new Simulation(p);
    s.step();
    const edited = structuredClone(p);
    edited.components.find((c) => c.kind === "tank")!.props.volume = 20;
    expect(s.refresh(edited)).toBe(false);
    expect(s.error).toMatch(/Reset/);
    expect(
      s.project.components.find((c) => c.kind === "tank")!.props.volume,
    ).toBe(10);
    const added = {
      ...p,
      components: [...p.components, makeComponent("tank", 0, 0)],
    };
    expect(transitionError(p, added, s.time)).toMatch(/Reset/);
  });
  it("accepts an ideal switch operation and source operating voltage live", () => {
    const p = starter(),
      s = new Simulation(p);
    s.step();
    const edited = structuredClone(p);
    edited.components.find((c) => c.kind === "switch")!.props.closed = false;
    expect(s.refresh(edited)).toBe(true);
    s.step();
    expect(s.electrical.dissipatedPower).toBeCloseTo(0, 8);
  });
  it("rejects ambient and rating exploits even before scored simulation starts", () => {
    for (const field of ["ambient", "initialTemperature", "volume"]) {
      const p = starter("heat", true);
      p.components.find((c) => c.kind === "tank")!.props[field] =
        field === "volume" ? 20 : 80;
      expect(() => parseProject(p)).toThrow(/locked/);
      expect(() => new Simulation(p)).toThrow(/locked/);
    }
    const p = starter("heat", true);
    p.components.find((c) => c.kind === "heater")!.props.ratedPower = 100000;
    expect(() => parseProject(p)).toThrow(/catalog/);
    expect(() => new Simulation(p)).toThrow(/catalog/);
  });
  it("rejects a challenge identity change and budget overspend", () => {
    const p = starter("heat", true),
      s = new Simulation(p);
    s.step();
    const removed = structuredClone(p);
    delete removed.challenge;
    expect(s.refresh(removed)).toBe(false);
    expect(s.error).toMatch(/identity/);
    const overspent = starter("heat", true);
    overspent.components.push(makeComponent("heater", 0, 0));
    expect(challengeError(overspent)).toMatch(/budget/);
  });
  it("uses paid catalog ratings and rejects free rating edits", () => {
    const p = starter(),
      c = p.components.find((c) => c.kind === "heater")!;
    expect(propertyError(p, c, "ratedPower", 3000, 0)).toMatch(/catalog/);
    const upgraded = {
      ...c,
      variant: "industrial",
      props: { ...c.props, ...catalog({ ...c, variant: "industrial" }).props },
    };
    expect(catalog(upgraded).cost).toBe(95);
    expect(upgraded.props.ratedPower).toBe(3000);
    expect(
      projectCost({
        ...p,
        components: p.components.map((x) => (x.id === c.id ? upgraded : x)),
      }),
    ).toBe(projectCost(p) + 30);
  });
  it("migrates original version 1 projects without removing real circuit data", () => {
    const p = starter();
    p.version = 1;
    delete p.probes;
    delete p.assemblies;
    for (const c of p.components) {
      delete c.variant;
      if (c.kind === "source") delete c.props.ratedVoltage;
    }
    const migrated = parseProject(p);
    expect(migrated.version).toBe(2);
    expect(migrated.connections).toEqual(p.connections);
    expect(migrated.components[0].props.ratedVoltage).toBe(240);
  });
  it("rejects a bad timestep without advancing state or energy", () => {
    const s = new Simulation(starter());
    expect(s.step(-1)).toBe(false);
    expect(s.time).toBe(0);
    expect(s.energy).toBe(0);
  });
});
