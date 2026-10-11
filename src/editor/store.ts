import { challengeProject } from "../simulation/learning";
import { useSyncExternalStore } from "react";
import {
  connect,
  definitions,
  makeComponent,
  uid,
  type Kind,
  type Project,
  type Terminal,
  type Component,
  type Property,
  type Assembly,
  type Probe,
  catalog,
} from "../simulation/model";
import {
  starter,
  parseProject,
  serializeProject,
  download,
} from "../simulation/projects";
import {
  builtinPresets,
  loadUserPresets,
  storeUserPresets,
  presetProps,
  presetComponentProps,
  parsePresetFile,
  serializePresets,
  type ComponentPreset,
} from "../simulation/presets";
import { captureAssembly, insertAssembly } from "./assemblies";
import type { FaultType } from "../simulation/automation";
import { probeColors, probeUnit } from "../simulation/measurements";
import { propertyError, transitionError, withProperty, editPolicy } from "../simulation/integrity";
import { Simulation, FixedClock, DT, AdaptiveRun } from "../simulation/engine";
import { paramSpec } from "../simulation/parameters";
import { evaluateChallenge } from "../simulation/challenges";
import { createRunArchive, restoreRunArchive, type RecordedInput } from "../simulation/replay";
import { makeSpatial, defaultWorld, type ShapeKind, type SpatialBody, type MechanicalJoint } from '../simulation/spatial-model';
import { makeJoint } from '../simulation/spatial-projects';
import { layoutEquipment } from './spatial-layout';
export type Tool = "select" | "pan" | "wire";
interface EditorState {
  workspaceView: 'schematic' | 'physical';
  selectedJoint: string | null;
  project: Project;
  selected: string[];
  selectedWire: string | null;
  running: boolean;
  speed: number;
  tool: Tool;
  grid: boolean;
  overlay: boolean;
  dirty: boolean;
  revision: number;
  toast: string | null;
  fps: number;
  busy: boolean;
  nodeMode: boolean;
  reference: Terminal | null;
  panel: "telemetry" | "events" | "energy";
  view: "workspace" | "challenges" | "models" | "examples" | "guidebook";
  /** Fraction of a running "advance" operation, or null. */
  progress: number | null;
  presets: ComponentPreset[];
}
const initial = starter();
const sim = new Simulation(initial);
const listeners = new Set<() => void>();
const clock = new FixedClock();
let previous = performance.now(),
  lastPaint = 0,
  frames = 0,
  frameStart = previous;
let history: Project[] = [],
  future: Project[] = [],
  clipboard: Assembly | null = null;
let hasWon = false;
let replayOrigin = structuredClone(initial);
let recordedInputs: RecordedInput[] = [];
let state: EditorState = {
  workspaceView: 'schematic', selectedJoint: null,
  project: initial,
  selected: [initial.components.find((c) => c.kind === "tank")!.id],
  selectedWire: null,
  running: false,
  speed: 1,
  tool: "select",
  grid: true,
  overlay: true,
  dirty: false,
  revision: 0,
  toast: null,
  fps: 0,
  busy: false,
  nodeMode: false,
  reference: null,
  panel: "telemetry",
  view: "workspace",
  progress: null,
  presets: loadUserPresets(),
};
export const getState = () => state;
function emit(patch: Partial<EditorState> = {}) {
  state = { ...state, ...patch, revision: state.revision + 1 };
  listeners.forEach((l) => l());
}
export const subscribe = (f: () => void) => {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
};
export const useLab = () => useSyncExternalStore(subscribe, getState);
export const simulation = sim;
function checkpoint() {
  history.push(structuredClone(state.project));
  if (history.length > 60) history.shift();
  future = [];
}
function recordInput(p: Project) {
  const input = { at: sim.time, project: structuredClone(p) };
  if (recordedInputs.at(-1)?.at === sim.time && recordedInputs.at(-1)?.project)
    recordedInputs[recordedInputs.length - 1] = input;
  else recordedInputs.push(input);
}
function edit(p: Project, record = true) {
  if (sim.time === 0 && !p.challenge && (p.world || state.workspaceView === 'physical'))
    p = layoutEquipment(p);
  const invalid = transitionError(
    state.project,
    p,
    sim.time,
    state.project.challenge,
  );
  if (invalid) {
    toast(invalid);
    return false;
  }
  if (record) checkpoint();
  recordInput(p);
  sim.refresh(p);
  emit({ project: p, dirty: true });
  return true;
}
export function toast(message: string) {
  emit({ toast: message });
  setTimeout(() => {
    if (state.toast === message) emit({ toast: null });
  }, 3800);
}
export const actions = {
  set: emit,
  select(ids: string[], wire: string | null = null) {
    emit({ selected: ids, selectedWire: wire, selectedJoint: null });
  },
  workspace(workspaceView: 'schematic' | 'physical') {
    // Initial placement is a normal, persisted Build edit. Never rebuild a live
    // solver or modify a challenge merely because its presentation changed.
    if (workspaceView === 'physical' && sim.time === 0 && !state.busy && !state.project.challenge) {
      const placed = layoutEquipment(state.project);
      if (placed !== state.project) edit(placed);
    }
    emit({ workspaceView, view: 'workspace' });
  },
  addBody(shape: ShapeKind, x = 3 + state.project.components.filter(c => c.spatial).length * 0.3, y = shape === 'floor' ? -0.25 : 4) {
    if (state.project.components.length >= 100) return toast('The scene supports at most 100 components/bodies.');
    const c = makeComponent('rigidBody', 100 + state.project.components.length * 30, 220, state.project.components);
    c.spatial = makeSpatial(shape, x, y);
    if (edit({ ...state.project, version: 4, world: state.project.world ?? defaultWorld(), components: [...state.project.components, c] })) emit({ selected: [c.id], workspaceView: 'physical', selectedJoint: null });
  },
  associate(id: string) {
    const c = state.project.components.find(c => c.id === id); if (!c) return;
    if (edit(layoutEquipment(state.project))) emit({ selected: [id], workspaceView: 'physical', selectedJoint: null });
  },
  spatial(id: string, patch: Partial<SpatialBody>, record = true) {
    const components = state.project.components.map(c => { if (c.id !== id || !c.spatial) return c; const spatial = { ...c.spatial, ...patch }; return { ...c, spatial, props: spatial.elevationLinked ? { ...c.props, elevation: spatial.y + spatial.elevationOffset } : c.props }; });
    return edit({ ...state.project, components }, record);
  },
  moveSpatial(positions: Record<string, { x: number; y: number }>) {
    return edit({ ...state.project, components: state.project.components.map(c => { if (!positions[c.id] || !c.spatial || c.spatial.locked) return c; const spatial = { ...c.spatial, ...positions[c.id] }; return { ...c, spatial, props: spatial.elevationLinked ? { ...c.props, elevation: spatial.y + spatial.elevationOffset } : c.props }; }) }, false);
  },
  gravity(x: number, y: number) { edit({ ...state.project, version: 4, world: { ...(state.project.world ?? defaultWorld()), gravity: { x, y } } }); },
  addJoint(kind: MechanicalJoint['kind'], a: string, b: string, pointA: { x: number; y: number }, pointB = pointA) {
    const ca = state.project.components.find(c => c.id === a), cb = state.project.components.find(c => c.id === b); if (!ca?.spatial || !cb?.spatial) return;
    const j = makeJoint(state.project, kind, ca, cb, pointA, pointB);
    if (edit({ ...state.project, version: 4, world: { ...(state.project.world ?? defaultWorld()), joints: [...(state.project.world?.joints ?? []), j] } })) emit({ selected: [], selectedJoint: j.id });
  },
  gear(joint1: string, joint2: string, ratio: number) {
    const first = state.project.world?.joints.find(j => j.id === joint1), second = state.project.world?.joints.find(j => j.id === joint2); if (!first || !second) return;
    const a = state.project.components.find(c => c.id === first.b)!, b = state.project.components.find(c => c.id === second.b)!;
    const j = makeJoint(state.project, 'gear', a, b, a.spatial!, b.spatial!); j.joint1 = joint1; j.joint2 = joint2; j.ratio = ratio;
    if (edit({ ...state.project, world: { ...state.project.world!, joints: [...state.project.world!.joints, j] } })) emit({ selected: [], selectedJoint: j.id });
  },
  joint(id: string, patch: Partial<MechanicalJoint> | null) {
    let joints = (state.project.world?.joints ?? []).filter(j => patch || j.id !== id).map(j => j.id === id && patch ? { ...j, ...patch } : j);
    joints = joints.filter(j => j.kind !== 'gear' || joints.some(x => x.id === j.joint1) && joints.some(x => x.id === j.joint2));
    if (edit({ ...state.project, world: { ...(state.project.world ?? defaultWorld()), joints } }) && !patch) emit({ selectedJoint: null });
  },
  alignSpatial(axis: 'x' | 'y') {
    const cs = state.project.components.filter(c => state.selected.includes(c.id) && c.spatial && !c.spatial.locked); if (cs.length < 2) return;
    const mean = cs.reduce((sum, c) => sum + c.spatial![axis], 0) / cs.length;
    checkpoint(); actions.moveSpatial(Object.fromEntries(cs.map(c => [c.id, { x: c.spatial!.x, y: c.spatial!.y, [axis]: mean }])));
  },
  shaftRotor(motor: string, rotor: string) {
    let p = { ...state.project, connections: state.project.connections.filter(w => !(w.domain === 'mechanical' && [w.from.component, w.to.component].includes(motor) && state.project.components.some(c => c.kind === 'rigidBody' && [w.from.component, w.to.component].includes(c.id)))) };
    try { if (rotor) p = connect(p, { component: motor, port: 'shaft' }, { component: rotor, port: 'shaft' }); edit(p); } catch (e) { toast((e as Error).message); }
  },
  impulse(id: string, x: number, y: number, angular = 0) {
    const error = sim.applyImpulse(id, { x, y }, angular); if (error) return toast(error);
    recordedInputs.push({ at: sim.time, impulse: { id, x, y, angular } }); emit();
  },
  add(kind: Kind, x?: number, y?: number) {
    if (state.project.components.length >= 100) {
      toast("The scene is limited to 100 components.");
      return;
    }
    const c = makeComponent(
      kind,
      x ?? 280 + Math.random() * 60,
      y ?? 220 + Math.random() * 60,
      state.project.components,
    );
    if (state.project.challenge === 'light' && kind === 'source') c.props.voltage = 12;
    if (state.project.challenge === 'descent' && kind === 'forceActuator') {
      c.props.target = state.project.components.find(c => c.name === 'Suspended load')!.id;
      c.props.axis = 'y';
      c.props.value = 0;
    }
    c.x = Math.round(c.x / 20) * 20;
    c.y = Math.round(c.y / 20) * 20;
    if (
      edit({ ...state.project, components: [...state.project.components, c] })
    )
      emit({ selected: [c.id], view: "workspace" });
  },
  beginMove() {
    checkpoint();
  },
  move(positions: Record<string, { x: number; y: number }>) {
    edit(
      {
        ...state.project,
        components: state.project.components.map((c) =>
          positions[c.id] ? { ...c, ...positions[c.id] } : c,
        ),
      },
      false,
    );
  },
  property(id: string, key: string, value: Property) {
    const c = state.project.components.find((c) => c.id === id);
    if (!c) return;
    const invalid = propertyError(state.project, c, key, value, sim.time);
    if (invalid) {
      toast(invalid);
      return;
    }
    const next = withProperty(state.project, c, key, value);
    if (edit({ ...next, components: next.components.map((x) => (x.id === id && x.preset ? { ...x, preset: undefined } : x)) }))
      sim.log(`${c.name}: ${paramSpec(c.kind, key)?.label ?? key} set to ${value}${paramSpec(c.kind, key)?.unit ? " " + paramSpec(c.kind, key)!.unit : ""}.`);
  },
  /** Restore the catalog values of every configuration parameter (keeps commands, targets, wiring). */
  resetDefaults(id: string) {
    const c = state.project.components.find((c) => c.id === id);
    if (!c) return;
    const model = catalog(c).props;
    const props = Object.fromEntries(Object.entries(model).map(([k, v]) => [k, editPolicy(c, k) === "live" && paramSpec(c.kind, k)?.group === "operating" || k === "target" ? c.props[k] : v]));
    if (edit({ ...state.project, components: state.project.components.map((x) => (x.id === id ? { ...x, preset: undefined, props } : x)) }))
      toast(`${c.name}: configuration restored to the ${catalog(c).label.toLowerCase()} catalog model.`);
  },
  applyPreset(id: string, presetId: string) {
    const c = state.project.components.find((c) => c.id === id),
      preset = [...builtinPresets, ...state.presets].find((p) => p.id === presetId);
    if (!c || !preset || preset.kind !== c.kind) return;
    const { variant, props } = presetComponentProps(preset, c);
    if (edit({ ...state.project, components: state.project.components.map((x) => (x.id === id ? { ...x, variant, props, preset: preset.name } : x)) }))
      sim.log(`${c.name}: preset “${preset.name}” applied.`);
  },
  savePreset(id: string, name: string) {
    const c = state.project.components.find((c) => c.id === id);
    if (!c || !name.trim()) return;
    const preset: ComponentPreset = { id: uid(), name: name.trim().slice(0, 80), kind: c.kind, family: "Custom", base: c.variant ?? "standard", props: presetProps(c) };
    const presets = [...state.presets.filter((p) => !(p.kind === c.kind && p.name === preset.name)), preset];
    storeUserPresets(presets);
    emit({ presets, project: { ...state.project, components: state.project.components.map((x) => (x.id === id ? { ...x, preset: preset.name } : x)) }, dirty: true });
    toast(`Preset “${preset.name}” saved on this device.`);
  },
  renamePreset(presetId: string, name: string) {
    if (!name.trim()) return;
    const presets = state.presets.map((p) => (p.id === presetId ? { ...p, name: name.trim().slice(0, 80) } : p));
    storeUserPresets(presets);
    emit({ presets });
  },
  deletePreset(presetId: string) {
    const presets = state.presets.filter((p) => p.id !== presetId);
    storeUserPresets(presets);
    emit({ presets });
  },
  exportPresets() {
    if (!state.presets.length) return toast("No custom presets to export yet. Use “Save as preset” in the Inspector.");
    download("physics-lab-presets.json", serializePresets(state.presets));
  },
  importPresets(value: unknown) {
    try {
      const imported = parsePresetFile(value).map((p) => ({ ...p, id: uid() }));
      const presets = [...state.presets.filter((p) => !imported.some((x) => x.kind === p.kind && x.name === p.name)), ...imported];
      storeUserPresets(presets);
      emit({ presets });
      toast(`${imported.length} component presets imported.`);
    } catch (e) {
      toast(`Preset import failed: ${(e as Error).message}`);
    }
  },
  /** Sandbox environment (ambient for element thermal masses). */
  environment(ambient: number) {
    if (!Number.isFinite(ambient)) return toast("Ambient temperature must be a finite number.");
    edit({ ...state.project, environment: { ambient } });
  },
  toggle(id: string) {
    const c = state.project.components.find((c) => c.id === id);
    if (c?.kind === "switch") actions.property(id, "closed", !c.props.closed);
  },
  rename(name: string) {
    if (name.trim())
      edit({ ...state.project, name: name.trim().slice(0, 120) });
  },
  wire(from: Terminal, to: Terminal) {
    try {
      if (!edit(connect(state.project, from, to))) return false;
      sim.log("Connection added.");
      return true;
    } catch (e) {
      toast((e as Error).message);
      return false;
    }
  },
  remove() {
    if (state.workspaceView === 'physical' && state.selectedJoint) { actions.joint(state.selectedJoint, null); return; }
    if (!state.selected.length && !state.selectedWire) return;
    const removed = new Set(state.selected);
    edit({
      ...state.project,
      components: state.project.components
        .filter((c) => !state.selected.includes(c.id))
        .map((c) =>
          state.selected.includes(String(c.props.target))
            ? { ...c, props: { ...c.props, target: "" } }
            : c,
        ),
      probes: (state.project.probes ?? []).filter(
        (p) =>
          !state.selected.includes(p.component) &&
          (!p.reference || !state.selected.includes(p.reference.component)),
      ),
      connections: state.project.connections.filter(
        (w) =>
          w.id !== state.selectedWire &&
          !state.selected.includes(w.from.component) &&
          !state.selected.includes(w.to.component),
      ),
      ...(state.project.world ? { world: { ...state.project.world, joints: state.project.world.joints.filter(j => !state.selected.includes(j.a) && !state.selected.includes(j.b)).filter((j, _, all) => j.kind !== 'gear' || all.some(x => x.id === j.joint1) && all.some(x => x.id === j.joint2)) } } : {}),
    });
    // A node-voltage reference on a deleted component would dangle.
    emit({ selected: [], selectedWire: null, ...(state.reference && removed.has(state.reference.component) ? { reference: null } : {}) });
  },
  rotate() {
    if (state.workspaceView === 'physical') { edit({ ...state.project, components: state.project.components.map(c => state.selected.includes(c.id) && c.spatial && !c.spatial.locked ? { ...c, spatial: { ...c.spatial, angle: c.spatial.angle + Math.PI / 12 } } : c) }); return; }
    edit({
      ...state.project,
      components: state.project.components.map((c) =>
        state.selected.includes(c.id)
          ? { ...c, rotation: (c.rotation + 90) % 360 }
          : c,
      ),
    });
  },
  copy() {
    clipboard = captureAssembly(state.project, state.selected);
    toast(
      `${clipboard.components.length} components and ${clipboard.connections.length} internal connections copied. External connections are omitted.`,
    );
  },
  paste() {
    if (!clipboard) return;
    const next = insertAssembly(state.project, clipboard);
    if (next.components.length > 100) return;
    if (edit(next))
      emit({
        selected: next.components
          .slice(state.project.components.length - clipboard.components.length)
          .map((c) => c.id),
      });
  },
  duplicate() {
    actions.copy();
    actions.paste();
  },
  saveAssembly(name: string) {
    if (!name.trim() || !state.selected.length) return;
    const a = captureAssembly(
      state.project,
      state.selected,
      name.trim().slice(0, 80),
    );
    edit({
      ...state.project,
      assemblies: [...(state.project.assemblies ?? []), a],
    });
    toast(
      "Assembly saved in this project. External wires and sensor targets are omitted.",
    );
  },
  insertAssembly(id: string) {
    const a = state.project.assemblies?.find((x) => x.id === id);
    if (a) {
      const next = insertAssembly(state.project, a, 100, 100);
      if (next.components.length <= 100 && edit(next))
        emit({
          selected: next.components
            .slice(-a.components.length)
            .map((c) => c.id),
          selectedWire: null,
        });
    }
  },
  route(id: string, route: { x: number; y: number }[]) {
    edit(
      {
        ...state.project,
        connections: state.project.connections.map((w) =>
          w.id === id ? { ...w, route } : w,
        ),
      },
      false,
    );
  },
  variant(id: string, variant: string) {
    const c = state.project.components.find((c) => c.id === id);
    if (!c) return;
    try {
      const model = catalog({ ...c, variant });
      edit({
        ...state.project,
        components: state.project.components.map((x) =>
          x.id === id
            ? {
                ...x,
                variant,
                preset: undefined,
                props: {
                  ...model.props,
                  ...Object.fromEntries(
                    [
                      "target",
                      "setpoint",
                      "hysteresis",
                      ...(x.kind === "source" && Number(x.props.voltage) > Number(model.props.ratedVoltage) ? [] : ["voltage"]),
                      ...(x.kind === "tank" && !state.project.challenge ? [] : ["volume"]),
                      "ambient",
                      "initialTemperature",
                      "closed",
                    ]
                      .filter((k) => k in x.props)
                      .map((k) => [k, x.props[k]]),
                  ),
                },
              }
            : x,
        ),
      });
    } catch (e) {
      toast((e as Error).message);
    }
  },
  addProbe(
    component: string,
    measurement: Probe["measurement"],
    terminal?: string,
    reference?: Terminal,
  ) {
    if ((state.project.probes?.length ?? 0) >= 24) {
      toast("Maximum 24 traces.");
      return;
    }
    const c = state.project.components.find((c) => c.id === component);
    if (!c) return;
    const probe: Probe = {
      id: uid(),
      name: `${c.name} ${measurement}`,
      component,
      measurement,
      terminal,
      reference,
      color:
        probeColors[(state.project.probes?.length ?? 0) % probeColors.length],
      visible: true,
    };
    edit({
      ...state.project,
      probes: [...(state.project.probes ?? []), probe],
    });
  },
  probe(id: string, patch: Partial<Probe> | null) {
    edit({
      ...state.project,
      probes: patch
        ? (state.project.probes ?? []).map((p) =>
            p.id === id ? { ...p, ...patch } : p,
          )
        : (state.project.probes ?? []).filter((p) => p.id !== id),
    });
  },
  fault(id: string, type: FaultType | null) {
    const error = sim.injectFault(id, type);
    if (error) {
      toast(error);
      return;
    }
    recordedInputs.push({ at: sim.time, fault: { id, type } });
    emit();
  },
  disconnect() {
    if (!state.selectedWire) return;
    const error = sim.disconnect(state.selectedWire);
    if (error) toast(error);
    else {
      recordedInputs.push({ at: sim.time, disconnect: state.selectedWire });
      emit();
    }
  },
  resetSafety(id: string) {
    const error = sim.resetSafety(id);
    if (error) toast(error);
    else {
      recordedInputs.push({ at: sim.time, resetSafety: id });
      emit();
    }
  },
  pulse(id: string) {
    sim.pulse(id);
    recordedInputs.push({ at: sim.time, pulse: id });
    emit();
  },
  undo() {
    const p = history.at(-1);
    if (!p) return;
    const invalid = transitionError(
      state.project,
      p,
      sim.time,
      state.project.challenge,
    );
    if (invalid) {
      toast(invalid);
      return;
    }
    history.pop();
    future.push(structuredClone(state.project));
    recordInput(p);
    sim.refresh(p);
    emit({ project: p, dirty: true, selected: [], selectedWire: null });
  },
  redo() {
    const p = future.at(-1);
    if (!p) return;
    const invalid = transitionError(
      state.project,
      p,
      sim.time,
      state.project.challenge,
    );
    if (invalid) {
      toast(invalid);
      return;
    }
    future.pop();
    history.push(structuredClone(state.project));
    recordInput(p);
    sim.refresh(p);
    emit({ project: p, dirty: true, selected: [], selectedWire: null });
  },
  run() {
    if (state.busy) return;
    if (state.running) {
      sim.log("Simulation paused.");
      emit({ running: false });
      return;
    }
    sim.refresh(state.project);
    if (sim.error) {
      toast(sim.error);
      return;
    }
    sim.log("Simulation started.");
    emit({ running: true });
  },
  reset() {
    if (state.busy) return;
    const project = state.workspaceView === 'physical' && !state.project.challenge ? layoutEquipment(state.project) : state.project;
    replayOrigin = structuredClone(project);
    recordedInputs = [];
    sim.reset(project);
    clock.accumulator = 0;
    hasWon = false;
    emit({ project, running: false, dirty: state.dirty || project !== state.project });
  },
  async replay() {
    if (state.busy) return;
    emit({ running: false, busy: true });
    try {
      const replayed = (await restoreRunArchive(createRunArchive(state.project, replayOrigin, recordedInputs, sim.time))).simulation;
      replayed.log("Deterministic replay completed, including control and fault inputs.");
      Object.assign(sim, replayed);
      clock.accumulator = 0;
      emit({ project: sim.project });
      toast("Experiment reproduced from reset and recorded editor inputs.");
    } catch (e) {
      toast((e as Error).message);
    } finally { emit({ busy: false }); }
  },
  step() {
    if (state.busy) return;
    sim.step(DT);
    checkChallenge();
    emit();
  },
  /**
   * Advance the paused experiment. Thermal/electrical/control experiments use the
   * event-aware adaptive integrator (recorded for replay); hydraulic, motor and
   * rigid-body experiments execute fixed 1/60 s steps in responsive batches.
   */
  async advance(seconds = 60) {
    if (state.running || state.busy) return;
    emit({ busy: true, progress: 0 });
    const unavailable = sim.adaptiveUnavailable();
    try {
      if (!unavailable) {
        const at = sim.time, tolerance = 0.05, maxStep = 30;
        const run = new AdaptiveRun(sim, seconds, { tolerance, maxStep });
        let painted = 0;
        while (!run.done && state.busy) {
          run.run(12);
          if (performance.now() - painted > 100) { painted = performance.now(); emit({ progress: run.progress }); }
          await new Promise((r) => setTimeout(r, 0));
        }
        if (run.steps) {
          recordedInputs.push({ at, adaptive: { duration: seconds, steps: run.steps, tolerance, maxStep } });
          sim.log(`Adaptive advance ${(sim.time - at).toFixed(1)} s in ${run.steps} steps (step ${run.minStep.toPrecision(2)}–${run.maxTaken.toPrecision(3)} s, ${run.events} discrete events resolved at 1/60 s).`);
        }
      } else {
        let count = 0, painted = 0;
        const total = Math.round(Math.min(seconds, 86400) / DT);
        while (count < total && state.busy) {
          const start = performance.now();
          while (count < total && performance.now() - start < 12) {
            count++;
            if (
              !sim.step(DT) ||
              evaluateChallenge(state.project, sim)?.complete
            ) {
              count = total;
              break;
            }
          }
          if (performance.now() - painted > 100) { painted = performance.now(); emit({ progress: count / total }); }
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      checkChallenge();
    } finally {
      emit({ busy: false, progress: null });
    }
  },
  cancelAdvance() {
    if (state.busy && state.progress !== null) emit({ busy: false });
  },
  load(p: Project) {
    if (state.busy) return;
    try {
      const parsed = parseProject(p);
      const valid = parsed.world && !parsed.challenge ? layoutEquipment(parsed) : parsed;
      history = [];
      future = [];
      hasWon = false;
      replayOrigin = structuredClone(valid);
      recordedInputs = [];
      sim.reset(valid);
      clock.accumulator = 0;
      emit({
        project: valid,
        workspaceView: valid.world ? 'physical' : 'schematic', selectedJoint: null,
        selected: [],
        selectedWire: null,
        running: false,
        dirty: false,
        view: "workspace",
      });
    } catch (e) {
      toast((e as Error).message);
    }
  },
  newProject(
    mode: Parameters<typeof starter>[0] = "blank",
    challenge = false,
  ) {
    if (challenge && mode !== "battery" && mode !== "contactor" && mode !== "transformer" && mode !== "radiator" && mode !== "induction" && mode !== "starting" && mode !== "acRlc" && mode !== "blank" && mode !== "automated" && mode !== "industrial" && mode !== "exchanger" && mode !== "circulation" && mode !== "mechanism" && mode !== "rotor") {
      actions.load(challengeProject(mode));
      if (state.project.challenge === mode) emit({ view: "guidebook" });
    } else actions.load(starter(mode));
  },
  async importData(value: unknown) {
    if (state.busy) return;
    if (value && typeof value === "object" && "format" in value && value.format === "physics-lab-run") {
      emit({ running: false, busy: true });
      try {
        const restored = await restoreRunArchive(value);
        history = []; future = []; recordedInputs = restored.archive.inputs; replayOrigin = restored.archive.origin;
        Object.assign(sim, restored.simulation); clock.accumulator = 0; hasWon = false;
        emit({ project: sim.project, selected: [], selectedWire: null, selectedJoint: null, workspaceView: sim.project.world ? 'physical' : 'schematic', dirty: false, view: "workspace" });
        toast("Saved live experiment restored.");
      } catch (e) { toast(`Import failed: ${(e as Error).message}`); }
      finally { emit({ busy: false }); }
    } else actions.load(parseProject(value));
  },
  exportScenario() { download("physics-lab-scenario.physics.json", serializeProject(state.project)); },
  save() {
    try {
      const contents = sim.time > 0 ? JSON.stringify(createRunArchive(state.project, replayOrigin, recordedInputs, sim.time), null, 2) : serializeProject(state.project);
      download(
        `${state.project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.physics.json`,
        contents,
      );
      localStorage.setItem(
        "physics-lab-last-project",
        contents,
      );
      emit({ dirty: false });
      toast("Project file saved. A recovery copy is available on this device.");
    } catch (e) {
      toast(`Could not save: ${(e as Error).message}`);
    }
  },
  async recover() {
    try {
      const raw = localStorage.getItem("physics-lab-last-project");
      if (!raw) {
        toast(
          "No recovery copy on this device. Use Import to open a project file.",
        );
        return;
      }
      await actions.importData(JSON.parse(raw));
      toast("Device recovery copy loaded.");
    } catch (e) {
      toast(`Could not load: ${(e as Error).message}`);
    }
  },
  exportCSV() {
    const probes = state.project.probes ?? [];
    const quote = (v: string) => '"' + v.replaceAll('"', '""') + '"';
    const rows = [
      [
        "time_s",
        ...probes.map((p) => `${p.name} [${probeUnit(p, state.project)}]`),
      ]
        .map(quote)
        .join(","),
      ...sim.samples.map((s) =>
        [s.time, ...probes.map((p) => s.values[p.id] ?? "")].join(","),
      ),
    ];
    download("physics-lab-measurements.csv", rows.join("\n"), "text/csv");
    toast("Measurements exported as CSV.");
  },
  cloneProject() {
    const p = structuredClone(state.project);
    p.id = uid();
    p.name += " (copy)";
    delete p.challenge;
    actions.load(p);
    emit({ dirty: true });
  },
};
function checkChallenge() {
  const r = evaluateChallenge(state.project, sim);
  if (r?.complete && !hasWon) {
    hasWon = true;
    sim.log(`Challenge complete: ${r.stars} stars, ${r.score}/100.`, "success");
    emit({ running: false });
    toast(`Challenge complete · ${r.stars} stars · ${r.score}/100`);
  }
}
function tick(now: number) {
  const elapsed = (now - previous) / 1000;
  previous = now;
  clock.advance(elapsed, state.speed, state.running, () => {
    const ok = sim.step();
    if (!ok) emit({ running: false });
    checkChallenge();
    return ok && state.running;
  }, 12);
  frames++;
  if (now - frameStart >= 1000) {
    const fps = Math.round((frames * 1000) / (now - frameStart));
    frames = 0;
    frameStart = now;
    emit({ fps });
  }
  if (now - lastPaint > 50) {
    lastPaint = now;
    emit();
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
export function availableHistory() {
  return { undo: history.length > 0, redo: future.length > 0 };
}
export function componentSummary(id: string) {
  const c = state.project.components.find((c) => c.id === id);
  return c
    ? {
        ...c,
        definition: definitions[c.kind],
        reading: sim.electrical.readings[id],
        temperature: sim.temperatures[id],
      }
    : null;
}
