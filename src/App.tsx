import { useEffect, useRef, useState } from "react";
import {
  FlaskConical,
  ChevronDown,
  Save,
  FolderOpen,
  FilePlus2,
  FileUp,
  Copy,
  PanelLeftClose,
  Settings2,
  BookOpen,
  Trophy,
  Play,
  Pause,
  RotateCcw,
  StepForward,
  ChevronsRight,
  Check,
  TriangleAlert,
  X,
  Command,
  Keyboard,
  Menu,
  Layers,
  HelpCircle,
  Download,
  SlidersHorizontal,
  Clock3,
  Radio,
  ChevronRight,
  ExternalLink,
} from "lucide-react";
import Library from "./components/Library";
import Inspector from "./components/Inspector";
import Workspace from "./components/Workspace";
import Telemetry, { formatTime } from "./components/Telemetry";
import Challenges, { ChallengeStrip } from "./components/Challenges";
import Models from "./components/Models";
import { actions, simulation, useLab, toast, getState } from "./editor/store";
import { parseProject } from "./simulation/projects";
import { evaluateChallenge } from "./simulation/challenges";
import { projectCost } from "./simulation/model";
import { registerLabTools } from "./editor/webmcp";
export default function App() {
  const s = useLab(),
    fileInput = useRef<HTMLInputElement>(null),
    [renaming, setRenaming] = useState(false),
    [name, setName] = useState(s.project.name),
    [mobileLibrary, setMobileLibrary] = useState(false),
    [mobileInspector, setMobileInspector] = useState(false);
  useEffect(registerLabTools, []);
  const result = evaluateChallenge(s.project, simulation);
  const warnings = simulation.error ? 1 : simulation.violations.length;
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        ["INPUT", "TEXTAREA", "SELECT"].includes(
          (e.target as HTMLElement).tagName,
        )
      )
        return;
      const cmd = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (cmd && ["s", "z", "d", "c", "v", "o", "a"].includes(k))
        e.preventDefault();
      if (cmd) {
        if (k === "s") actions.save();
        if (k === "z") e.shiftKey ? actions.redo() : actions.undo();
        if (k === "d") actions.duplicate();
        if (k === "c") actions.copy();
        if (k === "v") actions.paste();
        if (k === "o") fileInput.current?.click();
        if (k === "a")
          actions.select(getState().project.components.map((c) => c.id));
        return;
      }
      if (k === "delete" || k === "backspace") actions.remove();
      if (k === "r") actions.rotate();
      if (k === "v") actions.set({ tool: "select" });
      if (k === "h") actions.set({ tool: "pan" });
      if (k === "w") actions.set({ tool: "wire" });
      if (k === "escape") actions.set({ view: "workspace" });
      if (k === "/") {
        e.preventDefault();
        document
          .querySelector<HTMLInputElement>(".search-field input")
          ?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (getState().dirty) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);
  return (
    <div className="lab-app">
      <header className="app-header">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            actions.set({ view: "workspace" });
          }}
        >
          <span className="brand-mark">
            <FlaskConical size={22} strokeWidth={1.6} />
          </span>
          <span>
            PHYSICS<span className="brand-light">LAB</span>
            <small>ENGINEERING SANDBOX</small>
          </span>
        </a>
        <div className="header-divider" />
        <details className="file-menu">
          <summary>
            File
            <ChevronDown size={12} />
          </summary>
          <div
            className="dropdown"
            onClick={(e) =>
              e.currentTarget.closest("details")?.removeAttribute("open")
            }
          >
            <button onClick={() => actions.newProject("blank")}>
              <FilePlus2 size={15} />
              New experiment
            </button>
            <button onClick={() => actions.newProject("heat")}>
              <FlaskConical size={15} />
              Heating starter
            </button>
            <button onClick={() => actions.newProject("light")}>
              <Layers size={15} />
              Circuit starter
            </button>
            <hr />
            <button onClick={() => fileInput.current?.click()}>
              <FolderOpen size={15} />
              Import project <kbd>Ctrl O</kbd>
            </button>
            <button onClick={actions.save}>
              <Save size={15} />
              Save project file <kbd>Ctrl S</kbd>
            </button>
            <button onClick={actions.recover}>
              <Clock3 size={15} />
              Load device recovery
            </button>
            <button onClick={actions.cloneProject}>
              <Copy size={15} />
              Duplicate experiment
            </button>
            <button
              onClick={() => {
                setName(s.project.name);
                setRenaming(true);
              }}
            >
              <Settings2 size={15} />
              Rename experiment
            </button>
          </div>
        </details>
        <button
          className="header-menu"
          onClick={() => actions.set({ view: "models" })}
        >
          Reference
        </button>
        <div className="header-center">
          <span className="workspace-breadcrumb">Workspace</span>
          <ChevronRight size={13} />
          {renaming ? (
            <input
              aria-label="Experiment name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                actions.rename(name);
                setRenaming(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setRenaming(false);
              }}
            />
          ) : (
            <button
              className="project-name"
              title="Rename experiment"
              onClick={() => {
                setName(s.project.name);
                setRenaming(true);
              }}
            >
              {s.project.name}
              <ChevronDown size={12} />
            </button>
          )}
          <span className="save-state">
            {s.dirty ? (
              "Unsaved changes"
            ) : (
              <>
                <Check size={12} />
                Ready
              </>
            )}
          </span>
        </div>
        <button
          className="import-button"
          onClick={() => fileInput.current?.click()}
        >
          <FolderOpen size={15} />
          <span>Open</span>
        </button>
        <button className="save-button" onClick={actions.save}>
          <Save size={15} />
          <span>Save project</span>
        </button>
        <button
          className="help-button"
          aria-label="Help and physical models"
          onClick={() => actions.set({ view: "models" })}
        >
          <HelpCircle size={18} />
        </button>
      </header>
      <input
        type="file"
        hidden
        accept=".json,.physics.json,application/json"
        ref={fileInput}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (file) {
            try {
              if (file.size > 2000000)
                throw Error("Project files must be smaller than 2 MB.");
              actions.load(parseProject(JSON.parse(await file.text())));
              toast("Project imported.");
            } catch (error) {
              toast(`Import failed: ${(error as Error).message}`);
            }
            e.target.value = "";
          }
        }}
      />
      <div className="workspace-bar">
        <div className="workspace-tabs">
          <button
            className="mobile-library-button"
            aria-label="Toggle component library"
            onClick={() => setMobileLibrary(!mobileLibrary)}
          >
            <Menu size={17} />
          </button>
          <button
            className="workspace-tab active"
            onClick={() => actions.set({ view: "workspace" })}
          >
            <FlaskConical size={15} />
            Experiment 01 <span className="tab-indicator" />
          </button>
          <button
            className="workspace-tab"
            onClick={() => actions.set({ view: "challenges" })}
          >
            <Trophy size={15} />
            Challenges<span className="tab-count">3</span>
          </button>
          <button
            className="add-experiment"
            title="New empty experiment"
            aria-label="New empty experiment"
            onClick={() => actions.newProject("blank")}
          >
            +
          </button>
        </div>
        <div className="workspace-info">
          <button
            className="mobile-inspector-button"
            aria-label="Toggle inspector"
            onClick={() => setMobileInspector(!mobileInspector)}
          >
            <SlidersHorizontal size={17} />
          </button>
          <span>DC ELECTRICAL</span>
          <i />
          <span>THERMAL</span>
          <div className="mode-badge">
            {s.project.challenge ? "CHALLENGE" : "SANDBOX MODE"}
          </div>
        </div>
      </div>
      <div
        className={`lab-grid ${mobileLibrary ? "show-library" : ""} ${mobileInspector ? "show-inspector" : ""}`}
      >
        <Library />
        <main className="engineering-area">
          <ChallengeStrip />
          <Workspace />
          {simulation.error && (
            <div className="solver-error" role="alert">
              <TriangleAlert size={16} />
              <span>{simulation.error}</span>
              <button
                aria-label="View error log"
                onClick={() => actions.set({ panel: "events" })}
              >
                Diagnostics
              </button>
            </div>
          )}
        </main>
        <Inspector />
        <Telemetry />
      </div>
      <div className="simulation-bar">
        <div className="simulation-caption">
          <span className={s.running ? "status-dot running" : "status-dot"} />
          <strong>
            {s.busy
              ? "Advancing fixed steps"
              : s.running
                ? "Simulation running"
                : result?.complete
                  ? "Challenge complete"
                  : "Simulation paused"}
          </strong>
        </div>
        <div className="transport">
          <button
            className={`run-button ${s.running ? "is-running" : ""}`}
            disabled={s.busy}
            onClick={actions.run}
          >
            {s.running ? (
              <Pause size={14} fill="currentColor" />
            ) : (
              <Play size={14} fill="currentColor" />
            )}
            {s.running ? "Pause" : "Run"}
          </button>
          <button
            title="Reset simulation"
            aria-label="Reset simulation"
            disabled={s.busy}
            onClick={actions.reset}
          >
            <RotateCcw size={16} />
          </button>
          <button
            title="Single step (1/60 s)"
            aria-label="Single simulation step"
            disabled={s.running || s.busy}
            onClick={actions.step}
          >
            <StepForward size={16} />
          </button>
          <span className="control-divider" />
          <label className="speed-control">
            <span>Speed</span>
            <select
              aria-label="Simulation speed"
              value={s.speed}
              onChange={(e) => actions.set({ speed: Number(e.target.value) })}
            >
              {[0.25, 0.5, 1, 2, 4].map((v) => (
                <option key={v} value={v}>
                  {v}×
                </option>
              ))}
            </select>
            <ChevronDown size={12} />
          </label>
          <button
            className="advance-button"
            title="Execute 3,600 fixed steps while paused"
            disabled={s.running || s.busy}
            onClick={() => actions.advance(60)}
          >
            <ChevronsRight size={16} />
            <span>Advance 60 s</span>
          </button>
        </div>
        <span className="simulation-clock">
          t <strong>{formatTime(simulation.time)}</strong>
        </span>
        <div className="solver-status">
          <span>FIXED STEP</span>
          <strong>1 / 60 s</strong>
          <i />
          <span>SOLVER</span>
          <strong>{simulation.solverMs.toFixed(2)} ms</strong>
        </div>
        <button
          className={`warning-count ${warnings ? "has-warning" : ""}`}
          onClick={() => actions.set({ panel: "events" })}
        >
          <TriangleAlert size={14} />
          {warnings} <span>warnings</span>
        </button>
      </div>
      <footer className="status-footer">
        <div>
          <span className="engine-status">
            <i />
            {simulation.error ? "Engine halted" : "Engine ready"}
          </span>
          <span>{s.project.components.length} components</span>
          <span>{s.project.connections.length} connections</span>
          <span>€{projectCost(s.project)} total</span>
        </div>
        <div>
          <span>
            KCL residual {simulation.electrical.residual.toExponential(1)}
          </span>
          <span>{s.fps} FPS</span>
          <button onClick={() => actions.set({ view: "models" })}>
            <Keyboard size={12} />
            Keyboard shortcuts
          </button>
        </div>
      </footer>
      {s.view === "challenges" && <Challenges />}
      {s.view === "models" && <Models />}
      {s.toast && (
        <div className="toast" role="status">
          <span>{s.toast}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => actions.set({ toast: null })}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
