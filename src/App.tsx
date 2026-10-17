import { Examples, ChallengeGuidebook } from "./components/Learning";
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
import PhysicalView, { PhysicalTools, PhysicalInspector } from './components/PhysicalView';
import { actions, simulation, useLab, useLabSelect, toast, getState } from "./editor/store";
import { evaluateChallenge } from "./simulation/challenges";
import { projectCost } from "./simulation/model";
import { registerLabTools } from "./editor/webmcp";
import ErrorBoundary from "./components/ErrorBoundary";
/** Preset files use a transient picker so the project import remains the only file input. */
function importPresetFile() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      if (file.size > 2000000) throw Error("Preset files must be smaller than 2 MB.");
      actions.importPresets(JSON.parse(await file.text()));
    } catch (error) {
      toast(`Preset import failed: ${(error as Error).message}`);
    }
  };
  input.click();
}
/** Simulated time, refreshed with the instruments. */
function SimulationClock() {
  useLab();
  return (
    <span className="simulation-clock">
      t <strong>{formatTime(simulation.time)}</strong>
    </span>
  );
}
/** Run state, solver figures and frame rate, refreshed with the instruments. */
function StatusFooter() {
  const s = useLab();
  const result = evaluateChallenge(s.project, simulation);
  const warnings = simulation.error ? 1 : simulation.violations.length;
  return (
      <footer className="status-footer">
        <div>
          <div className="simulation-caption">
            <span className={s.running ? "status-dot running" : "status-dot"} />
            <strong>
              {s.busy
                ? simulation.adaptiveUnavailable() ? "Advancing fixed steps" : "Advancing adaptively"
                : s.running
                  ? "Simulation running"
                  : result?.complete
                    ? "Challenge complete"
                    : simulation.time <= 0 ? "Ready to run" : "Simulation paused"}
            </strong>
          </div>
          <span className="engine-status">
            <i />
            {simulation.error ? "Engine halted" : "Engine ready"}
          </span>
          <span>{s.project.components.length} components</span>
          <span>{s.project.connections.length} connections</span>
          <span>€{projectCost(s.project).toFixed(0)} {s.project.challenge ? "total" : "est. total"}</span>
        </div>
        <div>
          <div className={`solver-status ${simulation.solverMs > 1000 / 60 ? "over-budget" : ""}`} title={simulation.solverMs > 1000 / 60 ? "Physics exceeds the 60 Hz frame budget. The fixed-step clock slows; reduce active bodies or constraints." : "Fixed-step simulation independent of rendering"}>
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
  );
}
export default function App() {
  // The application shell re-renders on editor changes only; the clock and the status footer follow the instruments.
  const s = useLabSelect((s) => ({
      project: s.project, running: s.running, busy: s.busy, dirty: s.dirty, speed: s.speed, progress: s.progress, toast: s.toast,
      view: s.view, workspaceView: s.workspaceView, adaptiveUnavailable: simulation.adaptiveUnavailable(), error: simulation.error,
    })),
    fileInput = useRef<HTMLInputElement>(null),
    [renaming, setRenaming] = useState(false),
    [name, setName] = useState(s.project.name),
    [mobileLibrary, setMobileLibrary] = useState(false),
    [mobileInspector, setMobileInspector] = useState(false);
  useEffect(registerLabTools, []);
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
          actions.select(getState().project.components.filter(c => getState().workspaceView === 'schematic' || c.spatial).map((c) => c.id));
        return;
      }
      if (k === "delete" || k === "backspace") actions.remove();
      if (k === "r") actions.rotate();
      if (k === "f2" && getState().selected.length === 1) actions.requestRename(getState().selected[0]);
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
            Physics Lab
            <small>Engineering sandbox</small>
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
            <button onClick={() => actions.set({ view: "examples" })}>
              <Layers size={15} />
              Starters & examples
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
            <button onClick={actions.exportScenario}><Save size={15} />Export scenario configuration</button>
            <button onClick={actions.exportPresets}><Download size={15} />Export component presets</button>
            <button onClick={importPresetFile}><FileUp size={15} />Import component presets</button>
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
        <div className="header-project">
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
              <span className="project-title">{s.project.name}</span>
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
          <span className={`mode-badge ${s.project.challenge ? "challenge" : ""}`}>{s.project.challenge ? "Challenge" : "Sandbox"}</span>
        </div>
        <div className="header-transport">
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
                {[0.25, 0.5, 1, 2, 4, 10, 30, 60].map((v) => (
                  <option key={v} value={v}>
                    {v}×
                  </option>
                ))}
              </select>
              <ChevronDown size={12} />
            </label>
            {s.progress !== null ? (
              <button className="advance-button advancing" onClick={actions.cancelAdvance} title="Stop advancing; the state reached so far is kept and recorded">
                <X size={14} />
                <span>{Math.round(s.progress * 100)}% · Stop</span>
              </button>
            ) : (
              <>
                <button
                  className="advance-button"
                  aria-label="Advance 60 s"
                  title={s.adaptiveUnavailable ? "Execute 3,600 fixed steps while paused" : "Advance 60 s with event-aware adaptive steps"}
                  disabled={s.running || s.busy}
                  onClick={() => actions.advance(60)}
                >
                  <ChevronsRight size={16} />
                  <span>60 s</span>
                </button>
                <label className="advance-control" title={s.adaptiveUnavailable ?? "Thermal/electrical/control experiment: event-aware adaptive steps (switching and trips resolved at 1/60 s)"}>
                  <select
                    aria-label="Advance by"
                    value=""
                    disabled={s.running || s.busy}
                    onChange={(e) => e.target.value && actions.advance(Number(e.target.value))}
                  >
                    <option value="">More…</option>
                    {[[1, "+1 s"], [10, "+10 s"], [600, "+10 min"], [3600, "+1 h"], [6 * 3600, "+6 h"], [24 * 3600, "+24 h"]].map(([v, label]) => (
                      <option key={v} value={v}>{label}</option>
                    ))}
                  </select>
                  <span className="advance-mode">{s.adaptiveUnavailable ? "FIXED" : "ADAPTIVE"}</span>
                </label>
              </>
            )}
          </div>
          <SimulationClock />
        </div>
        <div className="header-actions">
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
        </div>
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
              await actions.importData(JSON.parse(await file.text()));

            } catch (error) {
              toast(`Import failed: ${(error as Error).message}`);
            }
            e.target.value = "";
          }
        }}
      />
      <div className="app-body">
      <nav className="app-rail" aria-label="Workspace">
        <button className="rail-item mobile-library-button" aria-label="Toggle component library" onClick={() => setMobileLibrary(!mobileLibrary)}>
          <Menu size={19} /><span>Library</span>
        </button>
        <button className={`rail-item ${s.workspaceView === 'schematic' ? 'active' : ''}`} aria-label="Schematic view" title="Schematic view" aria-current={s.workspaceView === 'schematic' ? 'page' : undefined} onClick={() => actions.workspace('schematic')}>
          <FlaskConical size={19} /><span>Schematic</span>
        </button>
        <button className={`rail-item ${s.workspaceView === 'physical' ? 'active' : ''}`} aria-label="Physical view" title="Physical view" aria-current={s.workspaceView === 'physical' ? 'page' : undefined} onClick={() => actions.workspace('physical')}>
          <Layers size={19} /><span>Physical</span>
        </button>
        <button className="rail-item" aria-label="Challenges, 9 missions" title="Challenges, 9 missions" onClick={() => actions.set({ view: "challenges" })}>
          <Trophy size={19} /><span>Challenges</span><i className="rail-count">9</i>
        </button>
        <button className="rail-item" aria-label="Starters and examples" title="Starters and examples" onClick={() => actions.set({ view: "examples" })}>
          <BookOpen size={19} /><span>Examples</span>
        </button>
        <button className="rail-item rail-new" title="New empty experiment" aria-label="New empty experiment" onClick={() => actions.newProject("blank")}>
          <FilePlus2 size={19} /><span>New</span>
        </button>
        <button className="rail-item mobile-inspector-button" aria-label="Toggle inspector" onClick={() => setMobileInspector(!mobileInspector)}>
          <SlidersHorizontal size={19} /><span>Inspector</span>
        </button>
      </nav>
      <div
        className={`lab-grid ${mobileLibrary ? "show-library" : ""} ${mobileInspector ? "show-inspector" : ""}`}
      >
        <ErrorBoundary area="library" label="The component library">{s.workspaceView === 'physical' ? <PhysicalTools /> : <Library />}</ErrorBoundary>
        <main className="engineering-area">
          <ChallengeStrip />
          <ErrorBoundary area="workspace" label="The workspace">{s.workspaceView === 'physical' ? <PhysicalView /> : <Workspace />}</ErrorBoundary>
          {s.error && (
            <div className="solver-error" role="alert">
              <TriangleAlert size={16} />
              <span>{s.error}</span>
              <button
                aria-label="View error log"
                onClick={() => actions.set({ panel: "events" })}
              >
                Diagnostics
              </button>
            </div>
          )}
        </main>
        <ErrorBoundary area="inspector" label="The inspector">{s.workspaceView === 'physical' ? <PhysicalInspector /> : <Inspector />}</ErrorBoundary>
        <ErrorBoundary area="telemetry" label="Telemetry"><Telemetry /></ErrorBoundary>
      </div>
      </div>
      <StatusFooter />
      <ErrorBoundary area="dialog" label="This view">
        {s.view === "challenges" && <Challenges />}
        {s.view === "models" && <Models />}
        {s.view === "examples" && <Examples />}
        {s.view === "guidebook" && <ChallengeGuidebook />}
      </ErrorBoundary>
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
