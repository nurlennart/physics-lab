import { X, BookOpen } from "lucide-react";
import { actions } from "../editor/store";
export default function Models() {
  return (
    <div className="modal-backdrop">
      <section
        className="model-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Physics models and workspace guide"
      >
        <div className="dialog-header">
          <div>
            <span className="eyebrow">LAB REFERENCE</span>
            <h2>Physics you can inspect.</h2>
          </div>
          <button
            aria-label="Close reference"
            onClick={() => actions.set({ view: "workspace" })}
          >
            <X size={20} />
          </button>
        </div>
        <div className="reference-content">
          <h3>Building an experiment</h3>
          <p>
            Drag or click a component in the library. Click an electrical
            terminal, then another electrical terminal to wire them. Click the
            orange heater port and the orange tank port to immerse the element.
            Double-click a switch to operate it. Select a wire and press Delete
            to remove it.
          </p>
          <p>
            Drag the grid to select a group. Hold Space to pan; scroll to zoom.
            Use V for Select, H for Pan, W for Wire, R to rotate, Ctrl/Cmd D to
            duplicate, Ctrl/Cmd C/V to copy and paste, and Ctrl/Cmd Z to undo.
          </p>
          <h3>DC electrical model</h3>
          <div className="formula">
            V = IR &nbsp;&nbsp; P = VI = I²R &nbsp;&nbsp; Σ I<sub>node</sub> = 0
          </div>
          <p>
            Modified nodal analysis solves voltages and ideal source currents
            using partial-pivot Gaussian elimination. Wires have zero
            resistance. Switches use 0.01 Ω when closed and infinite resistance
            when open. Lamps and heaters use constant resistance; filament
            temperature dependence is omitted. A voltmeter loads the circuit
            with 10 MΩ.
          </p>
          <p>
            Disconnected islands each have a local reference. Ground components
            share one reference. Shorts across ideal sources and singular source
            configurations pause the simulation. Ratings exceeded for 0.5 s
            cause passive elements to fail open. Fuses open after 0.1 s over
            rated current. Supply current limits pause the solver; they do not
            implement current regulation.
          </p>
          <h3>Coupled thermal model</h3>
          <div className="formula">
            C<sub>h</sub> dT<sub>h</sub>/dt = P − UA<sub>hw</sub>(T<sub>h</sub>{" "}
            − T<sub>w</sub>) − UA<sub>ha</sub>(T<sub>h</sub> − T<sub>a</sub>)
            <br />
            mc<sub>p</sub> dT<sub>w</sub>/dt = UA<sub>hw</sub>(T<sub>h</sub> − T
            <sub>w</sub>) − UA<sub>wa</sub>(T<sub>w</sub> − T<sub>a</sub>)
          </div>
          <p>
            The heater and well-mixed water tank are separate thermal masses.
            The full coupled thermal matrix uses backward Euler at 1/60 s. Water
            density is fixed at 1 kg/L and cₚ = 4,180 J/(kg·K). Electrical power
            is updated before the thermal solve. Every passive electrical
            component stores dissipated heat and loses heat to a 20°C ambient.
            Source internal losses are omitted.
          </p>
          <p>
            Conduction is energy-conserving between connected nodes; backward
            Euler introduces first-order time discretization error. Ambient loss
            is integrated using end-of-step temperature. Tanks support liquid
            water from 1–95°C; crossing these limits pauses the experiment.
            There is no boiling, fluid flow, pressure solver, or wall thermal
            mass in this milestone.
          </p>
          <h3>Reference calculation</h3>
          <div className="formula">
            12 V / 6 Ω = 2 A &nbsp; · &nbsp; 12 V × 2 A = 24 W<br />
            10 kg × 4,180 J/(kg·K) × 60 K = 2,508,000 J
          </div>
          <p>
            At 2 kW, the theoretical water-only heating time is 1,254 s. The
            experiment also heats the element and loses energy to ambient, so
            completion takes longer.
          </p>
          <h3>Clock, measurements, and project files</h3>
          <p>
            Simulation advances in fixed 1/60 s steps independently of
            rendering. Speeds range from 0.25× to 4×. Advance 60 s executes
            3,600 ordinary steps while paused. Long background frames are
            bounded to 0.25 s of wall time, so the clock slows safely when a tab
            is suspended. Telemetry records at 4 Hz, retaining the latest 2,400
            samples. Events use simulation timestamps. The Event log offers
            deterministic replay from the last reset and recorded editor inputs,
            up to one simulation hour. Replay reconstructs the final state; it
            does not provide timeline scrubbing.
          </p>
          <p>
            Save downloads a version 1 JSON project and stores a recovery copy
            on this device. Import opens a validated project file. Project files
            contain construction and initial conditions; loading starts a
            reproducible fresh experiment. CSV exports measured telemetry.
            Changing physical properties during a run performs an external
            intervention: reset before evaluating conservation of a revised
            experiment.
          </p>
          <h3>Challenge scoring</h3>
          <p>
            Mandatory objectives, safety limits, and budgets must all pass.
            Score = 60 + 20η + 10(1 − cost / budget) + 10τ. For heating, η =
            min(1, 2,508,000 / consumed joules), τ = min(1, 1,254 / elapsed
            seconds). For First Light, η = 1 and τ = min(1, 3 / elapsed
            seconds). One star for completion, two at 80, three at 90.
          </p>
        </div>
      </section>
    </div>
  );
}
