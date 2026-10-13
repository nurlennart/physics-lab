import { describe, it, expect, beforeAll } from "vitest";
import type * as Store from "./store";
import { createRunArchive, restoreRunArchive } from "../simulation/replay";

let store: typeof Store;
const memory = new Map<string, string>();
beforeAll(async () => {
  // The editor store schedules animation frames and uses device storage; provide inert stand-ins.
  Object.assign(globalThis, {
    requestAnimationFrame: () => 0,
    localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) },
  });
  store = await import("./store");
});
const heater = () => store.getState().project.components.find((c) => c.kind === "heater")!;

describe("editor store: sandbox parameter workflow", () => {
  it("starts missions without modules and allows a valid first purchase", () => {
    store.actions.newProject('light', true);
    expect(store.getState().project.components).toHaveLength(0);
    expect(store.getState().view).toBe('guidebook');
    store.actions.add('source');
    expect(store.getState().project.components[0].props.voltage).toBe(12);
    store.actions.newProject('descent', true);
    store.actions.add('forceActuator');
    const brake = store.getState().project.components.find(c => c.kind === 'forceActuator')!;
    expect(brake.props.target).toBe(store.getState().project.components.find(c => c.name === 'Suspended load')!.id);
    store.actions.property(brake.id, 'damping', 200);
    expect(store.getState().project.components.find(c => c.id === brake.id)!.props.damping).toBe(200);
  });
  it("edits a heater rating with derived resistance and supports undo/redo", () => {
    const { actions, getState } = store;
    actions.newProject("heat");
    actions.property(heater().id, "ratedPower", 30000);
    actions.property(heater().id, "ratedVoltage", 400);
    expect(heater().props.resistance).toBeCloseTo(400 ** 2 / 30000, 12);
    actions.undo();
    expect(heater().props.ratedVoltage).toBe(240);
    expect(heater().props.resistance).toBeCloseTo(240 ** 2 / 30000, 12);
    actions.redo();
    expect(heater().props.ratedVoltage).toBe(400);
    actions.property(heater().id, "resistance", 1);
    expect(heater().props.resistance).toBeCloseTo(400 ** 2 / 30000, 12);
    expect(getState().toast).toMatch(/calculated from/i);
  });
  it("saves, applies, renames and deletes presets and restores defaults", () => {
    const { actions, getState } = store;
    actions.newProject("heat");
    actions.property(heater().id, "ratedPower", 6000);
    actions.savePreset(heater().id, "My 6 kW element");
    const preset = getState().presets.find((p) => p.name === "My 6 kW element")!;
    expect(preset.props.ratedPower).toBe(6000);
    expect(JSON.parse(memory.get("physics-lab-presets")!).presets).toHaveLength(1);
    actions.resetDefaults(heater().id);
    expect(heater().props.ratedPower).toBe(2000);
    actions.applyPreset(heater().id, preset.id);
    expect(heater().props.ratedPower).toBe(6000);
    expect(heater().preset).toBe("My 6 kW element");
    actions.renamePreset(preset.id, "Stage element");
    expect(getState().presets[0].name).toBe("Stage element");
    actions.deletePreset(preset.id);
    expect(getState().presets).toHaveLength(0);
  });
  it("blocks catalog-defined ratings and custom presets inside a challenge", () => {
    const { actions, getState } = store;
    actions.newProject("heat", true);
    actions.add("heater");
    const id = heater().id;
    actions.property(id, "ratedPower", 3000);
    expect(heater().props.ratedPower).toBe(2000);
    expect(getState().toast).toMatch(/catalog/);
    actions.applyPreset(id, "builtin:heater:Heating bank 30 kW / 400 V");
    expect(heater().props.ratedPower).toBe(2000);
  });
  it("records an adaptive advance so the run archive replays exactly", async () => {
    const { actions, getState, simulation } = store;
    actions.newProject("heat");
    actions.environment(15);
    await actions.advance(600);
    expect(simulation.time).toBeCloseTo(600, 9);
    expect(getState().progress).toBeNull();
    const archive = JSON.parse(JSON.stringify(createRunArchive(getState().project, getState().project, [{ at: 0, adaptive: { duration: 600, steps: Number(simulation.events.at(-1)!.message.match(/in (\d+) steps/)![1]), tolerance: 0.05, maxStep: 30 } }], simulation.time)));
    const restored = (await restoreRunArchive(archive, async () => {})).simulation;
    expect(restored.temperatures).toEqual(simulation.temperatures);
  });
});

describe("editor store: component names", () => {
  it("renames a placed component, keeps default probe labels in step, and undoes", () => {
    store.actions.newProject("heat");
    const tank = store.getState().project.components.find((c) => c.kind === "tank")!, old = tank.name;
    const probe = store.getState().project.probes!.find((p) => p.component === tank.id)!;
    expect(probe.name.startsWith(`${old} `)).toBe(true);
    expect(store.actions.renameComponent(tank.id, "  Hot-water store  ")).toBe(true);
    const state = store.getState().project;
    expect(state.components.find((c) => c.id === tank.id)!.name).toBe("Hot-water store");
    expect(state.probes!.find((p) => p.id === probe.id)!.name).toBe(`Hot-water store${probe.name.slice(old.length)}`);
    store.actions.undo();
    expect(store.getState().project.components.find((c) => c.id === tank.id)!.name).toBe(old);
  });
  it("rejects empty, over-long and duplicate names and leaves the project unchanged", () => {
    store.actions.newProject("heat");
    const [a, b] = store.getState().project.components, before = store.getState().project;
    expect(store.actions.renameComponent(a.id, "   ")).toBe(false);
    expect(store.actions.renameComponent(a.id, "x".repeat(81))).toBe(false);
    expect(store.actions.renameComponent(a.id, b.name)).toBe(false);
    expect(store.getState().project).toBe(before);
  });
  it("is allowed while running and fixed in challenges", () => {
    store.actions.newProject("boiler");
    store.actions.step();
    expect(store.simulation.time).toBeGreaterThan(0);
    const pump = store.getState().project.components.find((c) => c.kind === "circulator")!;
    expect(store.actions.renameComponent(pump.id, "Loop pump")).toBe(true);
    store.actions.newProject("transfer", true);
    const reservoir = store.getState().project.components.find((c) => c.name === "Source reservoir")!;
    expect(store.actions.renameComponent(reservoir.id, "My reservoir")).toBe(false);
    expect(store.getState().project.components.find((c) => c.id === reservoir.id)!.name).toBe("Source reservoir");
  });
});

describe("editor store: undo steps", () => {
  it("a click that starts no drag adds no undo step; a drag adds exactly one", () => {
    store.actions.newProject("heat");
    const tank = store.getState().project.components.find((c) => c.kind === "tank")!;
    store.actions.renameComponent(tank.id, "Store");
    store.actions.beginMove(); // click without movement
    store.actions.undo();
    expect(store.getState().project.components.find((c) => c.id === tank.id)!.name).not.toBe("Store");
    store.actions.redo();
    store.actions.beginMove();
    store.actions.move({ [tank.id]: { x: tank.x + 40, y: tank.y } });
    store.actions.move({ [tank.id]: { x: tank.x + 80, y: tank.y } });
    store.actions.undo();
    const back = store.getState().project.components.find((c) => c.id === tank.id)!;
    expect([back.x, back.name]).toEqual([tank.x, "Store"]);
  });
});
