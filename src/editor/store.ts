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
  ranges,
} from "../simulation/projects";
import { captureAssembly, insertAssembly } from "./assemblies";
import type { FaultType } from "../simulation/automation";
import { probeColors, probeUnit } from "../simulation/measurements";
import { propertyError, transitionError } from "../simulation/integrity";
import { Simulation, FixedClock, DT } from "../simulation/engine";
import { evaluateChallenge } from "../simulation/challenges";
import { replayExperiment, type RecordedInput } from "../simulation/replay";
export type Tool = "select" | "pan" | "wire";
interface EditorState {
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
  view: "workspace" | "challenges" | "models";
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
    emit({ selected: ids, selectedWire: wire });
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
    if (
      state.project.challenge &&
      sim.time > 0 &&
      ["volume", "capacity", "initialTemperature", "heatCapacity"].includes(key)
    ) {
      toast(
        "Reset the challenge before changing thermal mass or initial conditions.",
      );
      return;
    }
    if (
      typeof value === "number" &&
      (!Number.isFinite(value) ||
        (ranges[key] && (value < ranges[key][0] || value > ranges[key][1])))
    ) {
      toast("That value is outside the supported range.");
      return;
    }
    const c = state.project.components.find((c) => c.id === id);
    if (!c) return;
    const invalid = propertyError(state.project, c, key, value, sim.time);
    if (invalid) {
      toast(invalid);
      return;
    }
    if (
      c.kind === "tank" &&
      ((key === "volume" && Number(value) > Number(c.props.capacity)) ||
        (key === "capacity" && Number(value) < Number(c.props.volume)))
    ) {
      toast("Water volume must not exceed tank capacity.");
      return;
    }
    edit({
      ...state.project,
      components: state.project.components.map((c) =>
        c.id === id ? { ...c, props: { ...c.props, [key]: value } } : c,
      ),
    });
    sim.log(`${c.name}: ${key} set to ${value}.`);
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
    if (!state.selected.length && !state.selectedWire) return;
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
    });
    emit({ selected: [], selectedWire: null });
  },
  rotate() {
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
                props: {
                  ...model.props,
                  ...Object.fromEntries(
                    [
                      "target",
                      "setpoint",
                      "hysteresis",
                      "voltage",
                      "volume",
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
    replayOrigin = structuredClone(state.project);
    recordedInputs = [];
    sim.reset(state.project);
    clock.accumulator = 0;
    hasWon = false;
    emit({ running: false });
  },
  replay() {
    emit({ running: false });
    try {
      const replayed = replayExperiment(replayOrigin, recordedInputs, sim.time);
      Object.assign(sim, replayed);
      clock.accumulator = 0;
      emit({ project: sim.project });
      toast("Experiment reproduced from reset and recorded editor inputs.");
    } catch (e) {
      toast((e as Error).message);
    }
  },
  step() {
    if (state.busy) return;
    sim.step(DT);
    checkChallenge();
    emit();
  },
  async advance(seconds = 60) {
    if (state.running || state.busy) return;
    emit({ busy: true });
    let count = 0;
    const total = Math.round(Math.min(seconds, 7200) / DT);
    try {
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
        emit();
        await new Promise((r) => setTimeout(r, 0));
      }
      checkChallenge();
    } finally {
      emit({ busy: false });
    }
  },
  load(p: Project) {
    if (state.busy) return;
    try {
      const valid = parseProject(p);
      history = [];
      future = [];
      hasWon = false;
      replayOrigin = structuredClone(valid);
      recordedInputs = [];
      sim.reset(valid);
      clock.accumulator = 0;
      emit({
        project: valid,
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
    mode: "heat" | "light" | "blank" | "runaway" | "automated" = "blank",
    challenge = false,
  ) {
    actions.load(starter(mode, challenge));
  },
  save() {
    try {
      download(
        `${state.project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.physics.json`,
        serializeProject(state.project),
      );
      localStorage.setItem(
        "physics-lab-last-project",
        serializeProject(state.project),
      );
      emit({ dirty: false });
      toast("Project file saved. A recovery copy is available on this device.");
    } catch (e) {
      toast(`Could not save: ${(e as Error).message}`);
    }
  },
  recover() {
    try {
      const raw = localStorage.getItem("physics-lab-last-project");
      if (!raw) {
        toast(
          "No recovery copy on this device. Use Import to open a project file.",
        );
        return;
      }
      actions.load(parseProject(JSON.parse(raw)));
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
  });
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
