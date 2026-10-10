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
