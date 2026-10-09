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
} from "../simulation/model";
import {
  starter,
  parseProject,
  serializeProject,
  download,
  ranges,
} from "../simulation/projects";
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
  clipboard: Component[] = [];
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
  if (recordedInputs.at(-1)?.at === sim.time)
    recordedInputs[recordedInputs.length - 1] = input;
  else recordedInputs.push(input);
}
function edit(p: Project, record = true) {
  if (record) checkpoint();
  recordInput(p);
  sim.refresh(p);
  emit({ project: p, dirty: true });
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
    edit({ ...state.project, components: [...state.project.components, c] });
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
  property(id: string, key: string, value: number | boolean) {
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
      edit(connect(state.project, from, to));
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
      components: state.project.components.filter(
        (c) => !state.selected.includes(c.id),
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
    clipboard = structuredClone(
      state.project.components.filter((c) => state.selected.includes(c.id)),
    );
    toast(`${clipboard.length} component(s) copied.`);
  },
  paste() {
    const copies: Component[] = [];
    for (const c of clipboard) {
      const n = makeComponent(c.kind, c.x + 40, c.y + 40, [
        ...state.project.components,
        ...copies,
      ]);
      copies.push({ ...n, rotation: c.rotation, props: { ...c.props } });
    }
    if (state.project.components.length + copies.length > 100) return;
    edit({
      ...state.project,
      components: [...state.project.components, ...copies],
    });
    emit({ selected: copies.map((c) => c.id) });
  },
  duplicate() {
    actions.copy();
    actions.paste();
  },
  undo() {
    const p = history.pop();
    if (!p) return;
    future.push(structuredClone(state.project));
    recordInput(p);
    sim.refresh(p);
    emit({ project: p, dirty: true, selected: [], selectedWire: null });
  },
  redo() {
    const p = future.pop();
    if (!p) return;
    history.push(structuredClone(state.project));
    recordInput(p);
    sim.refresh(p);
    emit({ project: p, dirty: true, selected: [], selectedWire: null });
  },
  run() {
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
    sim.step(DT);
    checkChallenge();
    emit();
  },
  advance(seconds = 60) {
    if (state.running) return;
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      if (!sim.step(DT)) break;
      const result = evaluateChallenge(state.project, sim);
      if (result?.complete) {
        checkChallenge();
        break;
      }
    }
    checkChallenge();
    emit();
  },
  load(p: Project) {
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
  newProject(mode: "heat" | "light" | "blank" = "blank", challenge = false) {
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
    const rows = [
      "time_s,water_temperature_C,heater_temperature_C,voltage_V,current_A,power_W,energy_J",
      ...sim.samples.map((s) =>
        [
          s.time,
          s.temperature,
          s.heaterTemperature,
          s.voltage,
          s.current,
          s.power,
          s.energy,
        ]
          .map((v) => v.toFixed(6))
          .join(","),
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
