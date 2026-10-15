import { describe, it, expect } from "vitest";
import { catalog, componentCost, definitions, makeComponent, projectCost, type Kind, type Property } from "./model";
import { applyDerived, paramSpec, domainError, actualResistance, derivedReadouts } from "./parameters";
import { propertyError, transitionError, challengeError, withProperty, componentError, editPolicy } from "./integrity";
import { builtinPresets, presetComponentProps, validatePreset, parsePresetFile, serializePresets, presetProps } from "./presets";
import { parseProject, serializeProject, starter } from "./projects";
import { Simulation, DT } from "./engine";
import { createRunArchive, restoreRunArchive } from "./replay";
import { Builder, heatingRig, industrialHeating, multiStage } from "./scaling-validation";
import { parseEngineering, formatEngineering } from "../editor/engineering";
import { WATER_CP } from "./units";

const kinds = Object.keys(definitions) as Kind[];
/** Deterministic pseudo-random generator for property-based sweeps. */
const rng = (seed: number) => () => ((seed = (Math.imul(1664525, seed) + 1013904223) >>> 0) / 4294967296);
const logUniform = (r: () => number, lo: number, hi: number) => lo * (hi / lo) ** r();

describe("parameter metadata", () => {
  it("describes every component property with a policy, group and valid default", () => {
    for (const kind of kinds)
      for (const [key, value] of Object.entries(definitions[kind].defaults)) {
        const spec = paramSpec(kind, key);
        expect(spec, `${kind}.${key}`).toBeDefined();
        expect(["live", "reset", "derived", "fixed"]).toContain(spec!.policy);
        expect(domainError(kind, key, value), `${kind}.${key}`).toBeNull();
        if (spec!.domain) expect(spec!.domain[0]).toBeLessThanOrEqual(spec!.domain[1]);
      }
  });
  it("every catalog variant and built-in preset is a valid, derived-consistent configuration", () => {
    for (const kind of kinds)
      for (const variant of ["standard", ...(definitions[kind].variants ?? []).map((v) => v.id)]) {
        const c = { ...makeComponent(kind, 0, 0), variant };
        c.props = catalog(c).props;
        expect(componentError(c), `${kind}/${variant}`).toBeNull();
      }
    for (const preset of builtinPresets) {
      const { variant, props } = presetComponentProps(preset);
      expect(componentError({ ...makeComponent(preset.kind, 0, 0), variant, props }), preset.name).toBeNull();
    }
  });
  it("rejects invalid physical domains but not out-of-rating values", () => {
    expect(domainError("tank", "volume", -1)).toMatch(/out of range/);
    expect(domainError("tank", "capacity", 0)).toMatch(/strictly positive|out of range/);
    expect(domainError("resistor", "resistance", NaN)).toMatch(/finite/);
    expect(domainError("heater", "ratedPower", 1e6)).toBeNull();
    expect(domainError("tank", "capacity", 50000)).toBeNull();
    expect(domainError("source", "voltage", 690)).toBeNull();
    expect(domainError("thermostat", "setpoint", 250)).toBeNull();
    expect(domainError("tank", "initialTemperature", 99)).toMatch(/Liquid-water model/);
    expect(domainError("source", "mode", "plasma")).toMatch(/Unknown/);
  });
  it("parses engineering notation with SI prefixes", () => {
    expect(parseEngineering("30k")).toBe(30000);
    expect(parseEngineering("4.7 M")).toBeCloseTo(4.7e6);
    expect(parseEngineering("100m")).toBeCloseTo(0.1);
    expect(parseEngineering("2,5")).toBe(2.5);
    expect(parseEngineering("1e-3")).toBe(0.001);
    expect(parseEngineering("−20")).toBe(-20);
    expect(parseEngineering("abc")).toBeNull();
    expect(formatEngineering(0.000045)).toBe("4.5e-5");
    expect(parseEngineering(formatEngineering(12345.678))).toBeCloseTo(12345.7, 1);
  });
});

describe("derived engineering relationships", () => {
  it("derives heater resistance from nominal voltage and power; resistance is not independently editable", () => {
    const p = starter(), heater = p.components.find((c) => c.kind === "heater")!;
    expect(editPolicy(heater, "resistance")).toBe("derived");
    expect(propertyError(p, heater, "resistance", 10, 0)).toMatch(/calculated from/i);
    const next = withProperty(p, heater, "ratedPower", 30000);
    const edited = next.components.find((c) => c.id === heater.id)!;
    expect(edited.props.resistance).toBeCloseTo(240 ** 2 / 30000, 12);
    const v400 = withProperty(next, edited, "ratedVoltage", 400).components.find((c) => c.id === heater.id)!;
    expect(v400.props.resistance).toBeCloseTo(400 ** 2 / 30000, 12);
    expect(transitionError(p, next, 0)).toBeNull();
  });
  it("distinguishes nominal from actual power: a 240 V / 2 kW element on 200 V delivers V²/R", () => {
    const p = starter(), source = p.components.find((c) => c.kind === "source")!;
    source.props.voltage = 200;
    const s = new Simulation(p), heater = p.components.find((c) => c.kind === "heater")!;
    // 10 mΩ switch contact in series: the element gets V²·R/(R + Rs)².
    expect(s.electrical.readings[heater.id].power).toBeCloseTo(28.8 * (200 / 28.81) ** 2, 9);
  });
  it("keeps motor back-EMF equal to torque constant and derives cable resistance and ampacity cooling", () => {
    const motor = makeComponent("motor", 0, 0);
    expect(applyDerived("motor", { ...motor.props, torqueConstant: 1.7 }).emfConstant).toBe(1.7);
    const cable = applyDerived("cable", { ...definitions.cable.defaults, area: 16, length: 30, ratedCurrent: 76, maxTemperature: 70 });
    expect(cable.resistance).toBeCloseTo(1.724e-8 * 30 / 16e-6, 12);
    const hot = (cable.resistance as number) * (1 + 0.00393 * 50);
    expect(cable.loss).toBeCloseTo(76 ** 2 * hot / 40, 9);
    // Steady state at ampacity in 30 °C ambient reaches exactly the insulation limit.
    const b = new Builder();
    b.p.environment = { ambient: 30 };
    const src = b.add("source", { mode: "cc", current: 76, voltage: 10, ratedVoltage: 10, maxCurrent: 76 }), w = b.add("cable", { area: 16, length: 30, ratedCurrent: 76, maxTemperature: 70 });
    b.series(src, w);
    const s = new Simulation(b.p);
    s.advanceAdaptive(40 * (w.props.heatCapacity as number) / (w.props.loss as number));
    expect(s.temperatures[w.id]).toBeCloseTo(70, 1);
    expect(s.electrical.readings[w.id].resistance).toBeCloseTo(w.props.resistance as number * (1 + 0.00393 * 50), 4);
  });
  it("applies temperature coefficient and reproducible tolerance to actual resistance", () => {
    const r = makeComponent("resistor", 0, 0);
    r.props = { ...r.props, resistance: 100, tempCoefficient: 0.004, tolerance: 5 };
    const at20 = actualResistance(r, 20);
    expect(Math.abs(at20 - 100)).toBeLessThanOrEqual(5);
    expect(actualResistance(r, 20)).toBe(at20);
    expect(actualResistance(r, 120)).toBeCloseTo(at20 * 1.4, 9);
  });
  it("derives tank heat loss from insulation geometry when selected", () => {
    const t = catalog({ ...makeComponent("tank", 0, 0), variant: "process2000" }).props;
    const area = 2 * 1.54 + 2 * Math.PI * Math.sqrt(1.54 / Math.PI) * (2.2 / 1.54);
    expect(t.loss).toBeCloseTo(area / (1 / 10 + 0.1 / 0.04), 9);
    // 2 m³ × the declared Kell density at 20 °C (independent evaluation).
    expect(derivedReadouts({ ...makeComponent("tank", 0, 0), props: t }).find((x) => x.label === "Water mass")!.value).toBe(1996.4082644011673);
  });
});

describe("electrical source behaviours", () => {
  const rig = (props: Record<string, Property>, load: number) => {
    const b = new Builder(), source = b.add("source", props), r = b.add("resistor", { resistance: load, ratedPower: 1e9 });
    b.series(source, r);
    return { s: new Simulation(b.p), source, r };
  };
  it("switches between constant voltage and constant current at the limit", () => {
    const cv = rig({ mode: "cvcc", voltage: 12, ratedVoltage: 30, maxCurrent: 5 }, 10);
    expect(cv.s.electrical.readings[cv.r.id].current).toBeCloseTo(1.2, 12);
    expect(cv.s.electrical.readings[cv.source.id].regulation).toBe("cv");
    const cc = rig({ mode: "cvcc", voltage: 12, ratedVoltage: 30, maxCurrent: 5 }, 1);
    expect(cc.s.electrical.readings[cc.r.id].current).toBeCloseTo(5, 12);
    expect(cc.s.electrical.readings[cc.source.id].regulation).toBe("cc");
    expect(cc.s.electrical.readings[cc.source.id].voltage).toBeCloseTo(5, 12);
  });
  it("limits a dead short on a current-limited supply instead of failing", () => {
    const b = new Builder(), source = b.add("source", { mode: "cvcc", voltage: 30, ratedVoltage: 30, maxCurrent: 3 }), w = b.add("cable", { area: 1.5, length: 0.001 });
    b.series(source, w);
    const s = new Simulation(b.p);
    expect(s.error).toBeNull();
    expect(Math.abs(s.electrical.readings[source.id].current)).toBeCloseTo(3, 9);
  });
  it("trips an ideal supply above its current rating without pausing the experiment", () => {
    const t = rig({ voltage: 24, maxCurrent: 2 }, 1);
    expect(t.s.step()).toBe(true);
    expect(t.s.error).toBeNull();
    expect(t.s.failed[t.source.id]).toBe(true);
    expect(t.s.tripped[t.source.id]).toMatch(/protection tripped/);
    expect(t.s.electrical.sourcePower).toBe(0);
  });
  it("models internal resistance and output enable", () => {
    const t = rig({ mode: "internal", voltage: 12, ratedVoltage: 14, internalResistance: 0.5, maxCurrent: 100 }, 1.5);
    expect(t.s.electrical.readings[t.r.id].current).toBeCloseTo(6, 12);
    const off = rig({ voltage: 12, enabled: false }, 1.5);
    expect(off.s.electrical.sourcePower).toBe(0);
  });
  it("supports high-power sources and protection at industrial scale", () => {
    const e = industrialHeating(), s = new Simulation(e.p);
    expect(s.electrical.readings[e.heater.id].power).toBeGreaterThan(29500);
    expect(Math.abs(s.electrical.readings[e.source.id].current)).toBeGreaterThan(74);
    expect(s.error).toBeNull();
  });
});

describe("thermal scale and multiple heaters", () => {
  it("adds the actual powers of several heaters on one tank and conserves energy", () => {
    const b = new Builder(), source = b.add("source", { voltage: 230, ratedVoltage: 240, maxCurrent: 1e3, maxPower: 1e6 }),
      tank = b.add("tank", { capacity: 110, volume: 100, loss: 1 });
    const heaters = [1000, 2000, 3000].map((power) => b.add("heater", { ratedVoltage: 230, ratedPower: power }));
    for (const h of heaters) { b.wire(source, "a", h, "a"); b.wire(h, "b", source, "b"); b.wire(h, "heat", tank, "heat"); }
    const s = new Simulation(b.p);
    expect(s.electrical.dissipatedPower).toBeCloseTo(6000, 6);
    s.advanceAdaptive(1800);
    expect(s.suppliedEnergy).toBeCloseTo(6000 * s.time, 0);
    expect(Math.abs(s.suppliedEnergy - s.storedEnergy - s.ambientEnergy)).toBeLessThan(1e-6 * s.suppliedEnergy);
  });
  it("heats 2,000 L from 20 to 80 °C in the ideal time at 3, 30 and 100 kW", () => {
    for (const power of [3000, 30000, 100000]) {
      const { p, tank, heater } = heatingRig(2000, power), s = new Simulation(p);
      const ideal = 2000 * WATER_CP * 60 / power;
      s.advanceAdaptive(ideal);
      // The element's own thermal mass Cₑ shares the energy and runs P/UA above the water.
      // 2,000 L at 20 °C holds 2 × 998.207 kg (published density).
      const ce = heater.props.heatCapacity as number, cw = 2 * 998.207 * WATER_CP;
      const expected = 20 + (power * ideal - ce * power / (heater.props.conductance as number)) / (cw + ce);
      expect(s.temperatures[tank.id]).toBeCloseTo(expected, 2);
      expect(80 - s.temperatures[tank.id]).toBeLessThan(0.15);
    }
  });
  it("rejects a 100 kW element in 1 L with an explicit model-range diagnostic", () => {
    const { p } = heatingRig(1, 100000), s = new Simulation(p);
    s.advanceAdaptive(60);
    expect(s.error).toMatch(/supported liquid range/);
  });
  it("includes vessel thermal mass and project ambient", () => {
    const b = new Builder();
    b.p.environment = { ambient: 5 };
    const tank = b.add("tank", { capacity: 12, volume: 10, vesselHeatCapacity: 41800, loss: 0, initialTemperature: 50 }), r = b.add("resistor");
    const cooler = b.add("cooler", { conductance: 10, ambient: 20 });
    b.wire(cooler, "heat", tank, "heat");
    const s = new Simulation(b.p);
    expect(s.temperatures[r.id]).toBe(5);
    s.advanceAdaptive(600);
    const capacity = 10 * WATER_CP + 41800, expected = 20 + 30 * Math.exp(-10 * 600 / capacity);
    expect(s.temperatures[tank.id]).toBeCloseTo(expected, 1);
  });
});

describe("adaptive long-duration integration", () => {
  it("matches fixed-step integration and resolves thermostat switching", () => {
    const make = () => industrialHeating(30000);
    const fixed = new Simulation(make().p);
    for (let i = 0; i < Math.round(1200 / DT); i++) fixed.step();
    const adaptive = new Simulation(make().p), run = adaptive.advanceAdaptive(1200);
    const tankOf = (s: Simulation) => s.temperatures[s.project.components.find((c) => c.kind === "tank")!.id];
    expect(adaptive.time).toBeCloseTo(1200, 9);
    expect(Math.abs(tankOf(adaptive) - tankOf(fixed))).toBeLessThan(0.01);
    expect(run.steps).toBeLessThan(Math.round(1200 / DT) / 10);
  });
  it("runs a 46-hour 3 kW heat-up of 2,000 L in a bounded number of steps", () => {
    const { p, tank } = heatingRig(2000, 3000), s = new Simulation(p);
    const started = performance.now(), run = s.advanceAdaptive(46.4 * 3600);
    expect(run.steps).toBeLessThan(15000);
    expect(performance.now() - started).toBeLessThan(20000);
    expect(s.temperatures[tank.id]).toBeGreaterThan(79.5);
    expect(s.samples[0].time).toBe(0);
    expect(s.samples.length).toBeLessThanOrEqual(14401);
    expect(Math.abs(s.suppliedEnergy - s.storedEnergy - s.ambientEnergy)).toBeLessThan(1e-6 * s.suppliedEnergy);
  });
  it("refuses adaptive steps in challenges and rigid-body scenes, allows hydraulic/motor networks", () => {
    expect(new Simulation(starter("heat", true)).adaptiveUnavailable()).toMatch(/challenge/);
    expect(new Simulation(starter("mechanism")).adaptiveUnavailable()).toMatch(/Rigid-body/);
    expect(new Simulation(starter("transfer")).adaptiveUnavailable()).toBeNull();
    const s = new Simulation(starter("mechanism"));
    expect(s.step(5, true)).toBe(false);
  });
  it("replays an adaptive advance deterministically from a run archive", async () => {
    const e = multiStage(), origin = structuredClone(e.p), s = new Simulation(e.p);
    for (let i = 0; i < 30; i++) s.step();
    const at = s.time, run = s.advanceAdaptive(3600, { tolerance: 0.05, maxStep: 30 });
    const archive = createRunArchive(s.project, origin, [{ at, adaptive: { duration: 3600, steps: run.steps, tolerance: 0.05, maxStep: 30 } }], s.time);
    const restored = (await restoreRunArchive(archive, async () => {})).simulation;
    expect(restored.time).toBe(s.time);
    expect(restored.temperatures).toEqual(s.temperatures);
    expect(restored.suppliedEnergy).toBe(s.suppliedEnergy);
  });
});

describe("live editing and conservation", () => {
  it("accepts conservation-safe live edits and rejects stored-energy edits mid-run", () => {
    const p = starter(), s = new Simulation(p);
    for (let i = 0; i < 60; i++) s.step();
    const heater = p.components.find((c) => c.kind === "heater")!, tank = p.components.find((c) => c.kind === "tank")!;
    expect(propertyError(p, heater, "ratedPower", 1000, s.time)).toBeNull();
    expect(propertyError(p, heater, "heatCapacity", 1000, s.time)).toMatch(/Reset/);
    expect(propertyError(p, tank, "volume", 15, s.time)).toMatch(/Reset/);
    expect(s.refresh(withProperty(p, heater, "ratedPower", 1000))).toBe(true);
    for (let i = 0; i < 60; i++) s.step();
    expect(s.electrical.readings[heater.id].power).toBeCloseTo(57.6 * (240 / 57.61) ** 2, 6);
    const tankNow = s.project.components.find((c) => c.id === tank.id)!;
    expect(s.refresh(withProperty(s.project, tankNow, "ambient", 5))).toBe(true);
    for (let i = 0; i < 600; i++) s.step();
    expect(Math.abs(s.suppliedEnergy - s.storedEnergy - s.ambientEnergy)).toBeLessThan(1e-6 * s.suppliedEnergy);
  });
  it("keeps the original live-edit rules inside scored challenges", () => {
    const p = starter("light", true), s = new Simulation(p);
    const resistor = makeComponent("resistor", 0, 0);
    const withResistor = { ...p, components: [...p.components, resistor] };
    expect(s.refresh(withResistor)).toBe(true);
    s.step();
    expect(propertyError(withResistor, resistor, "resistance", 3, s.time)).toMatch(/Reset/);
    expect(propertyError(withResistor, resistor, "ratedPower", 300, 0)).toMatch(/catalog/);
  });
});

describe("presets, costing and challenge isolation", () => {
  it("round-trips a user preset through validation and its file format", () => {
    const c = makeComponent("heater", 0, 0);
    c.props = applyDerived("heater", { ...c.props, ratedVoltage: 400, ratedPower: 30000, heatCapacity: 4500, conductance: 2700 });
    const preset = { id: "u1", name: "Industrial immersion heater — 30 kW", kind: "heater" as const, family: "Custom" as const, base: "standard", props: presetProps(c) };
    const [parsed] = parsePresetFile(JSON.parse(serializePresets([validatePreset(preset)])));
    expect(presetComponentProps(parsed).props.resistance).toBeCloseTo(400 ** 2 / 30000, 12);
    expect(() => validatePreset({ ...preset, props: { ratedPower: -5 } })).toThrow(/range/);
    expect(() => validatePreset({ ...preset, props: { warpFactor: 9 } })).toThrow(/unsupported/);
  });
  it("prices custom sizing consistently and monotonically; catalog configurations keep catalog prices", () => {
    const heater = makeComponent("heater", 0, 0);
    expect(componentCost(heater)).toEqual({ cost: 65, estimated: false });
    const costs = [500, 2000, 12000, 30000, 100000].map((power) => componentCost({ ...heater, props: applyDerived("heater", { ...heater.props, ratedPower: power }) }).cost);
    for (let i = 1; i < costs.length; i++) expect(costs[i]).toBeGreaterThan(costs[i - 1]);
    // A custom 30 kW configuration prices from the closest catalog model (the €820 30 kW bank).
    const bank = builtinPresets.find((x) => x.name.startsWith("Heating bank 30 kW"))!;
    expect(componentCost({ ...heater, ...presetComponentProps(bank) }).cost).toBeCloseTo(820, 0);
    const resistor = makeComponent("resistor", 0, 0);
    expect(componentCost({ ...resistor, props: { ...resistor.props, ratedPower: 20000 } }).cost).toBeGreaterThan(componentCost(heater).cost);
  });
  it("rejects custom presets, ratings and environments in challenges and enforces budgets", () => {
    const p = starter("heat", true), heater = p.components.find((c) => c.kind === "heater")!;
    const bank = builtinPresets.find((x) => x.name.startsWith("Heating bank 30 kW"))!;
    const custom = { ...p, components: p.components.map((c) => (c.id === heater.id ? { ...c, ...presetComponentProps(bank, c) } : c)) };
    expect(challengeError(custom)).toMatch(/catalog/);
    expect(challengeError({ ...p, environment: { ambient: 5 } })).toMatch(/environment/);
    const paid = { ...p, components: p.components.map((c) => (c.id === heater.id ? { ...c, variant: "bank30k", props: catalog({ ...c, variant: "bank30k" }).props } : c)) };
    expect(challengeError(paid)).toMatch(/budget/);
    expect(projectCost(paid)).toBeGreaterThan(projectCost(p));
  });
});

describe("persistence and migration", () => {
  it("serializes every custom configuration value and restores derived parameters", () => {
    const e = industrialHeating();
    e.p.environment = { ambient: 12 };
    e.p.components.find((c) => c.kind === "heater")!.preset = "Heating bank 30 kW / 400 V";
    const restored = parseProject(JSON.parse(serializeProject(e.p)));
    expect(restored.environment).toEqual({ ambient: 12 });
    for (const c of e.p.components) expect(restored.components.find((x) => x.id === c.id)!.props).toEqual(c.props);
    expect(restored.components.find((c) => c.kind === "heater")!.preset).toMatch(/30 kW/);
  });
  it("migrates legacy files and refuses to discard unknown properties silently", () => {
    const p = starter();
    const heater = p.components.find((c) => c.kind === "heater")!, tank = p.components.find((c) => c.kind === "tank")!;
    delete heater.props.ratedVoltage;
    delete tank.props.vesselHeatCapacity;
    delete tank.props.lossModel;
    const migrated = parseProject(p);
    expect(migrated.components.find((c) => c.kind === "heater")!.props.ratedVoltage).toBeCloseTo(240, 9);
    expect(migrated.components.find((c) => c.kind === "tank")!.props.lossModel).toBe("manual");
    const odd = starter();
    odd.components[0].props.flux = 1;
    expect(() => parseProject(odd)).toThrow(/unsupported property "flux"/);
  });
  it("rejects a tampered derived value on import", () => {
    const p = starter();
    p.components.find((c) => c.kind === "heater")!.props.ratedPower = 9000;
    // parseProject re-derives resistance from the defining parameters; the raw engine rejects contradictions.
    expect(parseProject(structuredClone(p)).components.find((c) => c.kind === "heater")!.props.resistance).toBeCloseTo(6.4, 12);
    expect(() => new Simulation(p)).toThrow(/contradicts/);
  });
});

describe("property-based stability across scales", () => {
  it("random heater/tank/source combinations stay finite and conserve energy", () => {
    const r = rng(42);
    for (let k = 0; k < 40; k++) {
      const power = logUniform(r, 10, 1e6), voltage = logUniform(r, 6, 1000), liters = logUniform(r, 0.5, 50000), supply = voltage * logUniform(r, 0.3, 1.5);
      const b = new Builder();
      const source = b.add("source", { mode: r() < 0.5 ? "cvcc" : "ideal", voltage: supply, ratedVoltage: supply, maxCurrent: 1e7, maxPower: 1e15 });
      const heater = b.add("heater", { ratedVoltage: voltage, ratedPower: power, heatCapacity: Math.max(1, 0.15 * power), conductance: Math.max(1, 0.09 * power) });
      const tank = b.add("tank", { capacity: liters * 1.2, volume: liters, surfaceArea: Math.max(0.001, liters / 1500), initialTemperature: 20, loss: logUniform(r, 0.01, 100) });
      b.series(source, heater);
      b.wire(heater, "heat", tank, "heat");
      const s = new Simulation(b.p);
      s.advanceAdaptive(120);
      const values = [s.temperatures[tank.id], s.temperatures[heater.id], s.suppliedEnergy, s.storedEnergy, s.ambientEnergy];
      expect(values.every(Number.isFinite), `case ${k}`).toBe(true);
      if (!s.error) expect(Math.abs(s.suppliedEnergy - s.storedEnergy - s.ambientEnergy)).toBeLessThan(1e-6 * Math.max(1, s.suppliedEnergy));
      else expect(s.error).toMatch(/supported liquid range|overtemperature/);
    }
  }, 60000);
  it("random resistor networks obey Ohm's law from milliohms to megohms", () => {
    const r = rng(7);
    for (let k = 0; k < 60; k++) {
      const v = logUniform(r, 0.1, 1e5), r1 = logUniform(r, 1e-3, 1e6), r2 = logUniform(r, 1e-3, 1e6);
      const b = new Builder(), src = b.add("source", { voltage: v, ratedVoltage: v, maxCurrent: 1e9, maxPower: 1e15 }), a = b.add("resistor", { resistance: r1 }), c = b.add("resistor", { resistance: r2 });
      b.series(src, a, c);
      const s = new Simulation(b.p);
      const expected = v / (r1 + r2);
      // Up to 1e9 resistance contrast: double-precision elimination keeps ~1e-8 relative accuracy.
      expect(Math.abs(s.electrical.readings[a.id].current - expected) / expected).toBeLessThan(1e-8);
      expect(Math.abs(s.electrical.sourcePower - s.electrical.dissipatedPower)).toBeLessThan(1e-9 * Math.max(1, s.electrical.sourcePower));
    }
  });
});

describe("layout-only edits", () => {
  const moved = (s: Simulation, dx: number) => ({ ...s.project,
    components: s.project.components.map((c, i) => (i === 0 ? { ...c, x: c.x + dx, rotation: (c.rotation + 90) % 360 } : c)),
    connections: s.project.connections.map((w, i) => (i === 0 ? { ...w, route: [{ x: 40, y: 40 }] } : w)) });
  it("keep the solved state instead of re-initializing and re-solving", () => {
    const s = new Simulation(starter("hybridStorage" as never));
    const { multiphysics, devices, electrical } = s;
    expect(s.refresh(moved(s, 20)), s.error ?? "").toBe(true);
    expect(s.multiphysics).toBe(multiphysics); expect(s.devices).toBe(devices); expect(s.electrical).toBe(electrical);
    expect(s.project.components[0].x).toBe(moved(s, 0).components[0].x);
    const panel = s.project.components.find((c) => c.kind === "solarPanel")!;
    expect(s.refresh(withProperty(s.project, panel, "irradiance", 500))).toBe(true);
    expect(s.multiphysics).not.toBe(multiphysics);
  });
  it("re-sample controls on a live layout edit (recorded inputs replay unchanged)", () => {
    const s = new Simulation(starter("hybridStorage" as never));
    for (let i = 0; i < 30; i++) expect(s.step(), s.error ?? "").toBe(true);
    const { electrical, time } = s;
    expect(s.refresh(moved(s, -20))).toBe(true);
    expect(s.time).toBe(time); expect(s.electrical).not.toBe(electrical);
  });
});
