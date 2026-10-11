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
            <span className="eyebrow">Lab reference</span>
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
          <h3>Physical construction and shared machines</h3>
          <p>Switch between Schematic and Physical without resetting. Physical geometry uses metres and radians, with a separate pan/zoom camera. Use the geometry tools, Shift-selection, 0.1 m snap, alignment, rotation/resize handles and undo. Select two bodies, choose a joint, then click world anchors. A gear/rack couples two grounded bearings or slides. Build mode ends when simulation time advances; Reset restores initial poses and unlocks geometry.</p>
          <div className="formula">m = ρ A depth · Idisc = ½mr² · τ = Iα · Espring = ½kΔx²</div>
          <p>Planck 1.4.2 provides Box2D rigid-body collision, friction, restitution, sleeping and continuous collision detection. Static, dynamic and prescribed-velocity kinematic bodies are supported. Joints connect static/dynamic bodies; kinematic joint drive is deferred. Material density/contact coefficients affect mechanics. Material heat capacity and conductivity are metadata; visual contact creates no thermal connection or damage. Engineering equipment uses static housings; attach a separate dynamic wheel through a grounded bearing and the motor shaft selector.</p>
          <p>The motor’s MNA current and torque drive the actual rigid-body shaft. Wheel speed determines back EMF and pump load; motor rotor inertia is included once in the body mass matrix. Mechanical substeps are at most 1/480 s with bounded implicit electrical/shaft iteration; explicit springs/dampers may require smaller steps. Joint constraint drift and the first-order rigid-body integrator remain measured numerical errors. External forces and impulses are recorded energy sources; brake, contact and stop losses leave as heat. They do not automatically warm an unrelated thermal component.</p>
          <p>Open the mechanism, rotor, descent, lift or rotational-control examples under File → Starters & examples. Add position/speed sensors to the existing control graph; external force actuators account for their work. Challenges 007–009 score actual descent, lifting and changing-load regulation. A tank’s hydraulic elevation follows spatial y only when explicitly linked; pipe length remains configured independently. Moving finite equipment, spatial water, fracture and automatic contact conduction are unsupported.</p>
          <h3>Free Sandbox and engineering parameters</h3>
          <p>Every implemented parameter is configurable in the sandbox. The Inspector groups parameters into operating controls, engineering configuration, ratings, thermal, initial state and advanced model. Each field shows its SI unit, valid domain and policy: <strong>live</strong> parameters are conservation-safe at any time; <strong>reset</strong> parameters define stored energy, mass or the initial state; <strong>calc</strong> values are derived (e.g. heater resistance, motor back-EMF constant, cable resistance and cooling). Validity domains come from the implemented physics, for example the 1–95 °C liquid-water model. Ratings are limits, not controls. Inputs accept engineering notation such as 30k, 4.7M or 100m.</p>
          <p>Catalog models and the Laboratory / General-purpose / Industrial / High-capacity presets are starting points. Custom presets are validated, stored on this device and can be exported. Scored challenges accept only purchasable catalog models, the assignment environment and the budget; custom ratings are rejected before costing. Custom sandbox sizes show an estimated cost (six-tenths rule).</p>
          <p>Thermal, electrical and control experiments can advance up to 24 h with event-aware adaptive steps. The thermal network is implicit, so the energy ledger balances for every step size. Steps are limited to 0.05 K per step and by timers, sampling, controllers and protection, and any switching or trip restarts at 1/60 s. Adaptive advances are recorded and replay exactly. Hydraulic and motor experiments also advance adaptively: steps are bounded by 1% of tank height per step, valve and regulator travel, and motor acceleration, and the network is solved at predicted mid-step tank levels. Rigid-body scenes, finite batteries, powered contactors and challenges use fixed 1/60 s steps.</p>
          <h3>Protection, thermal networks and advanced plant</h3>
          <p><strong>Circuit breakers and motor-protective breakers</strong> carry a thermal image θ with dθ/dt = ((I/In)² − θ)/τ, integrated exactly. They trip at θ ≥ 1.3² (breaker) or 1.12² (motor protector, τ from the trip class at 7.2 × setting), and instantly at the magnetic multiple. Re-closing is possible once θ has cooled below 1. Interrupting more than the breaking capacity is reported. Arcs are not modelled.</p>
          <p><strong>Thermal ports</strong> link any thermal masses: tanks, heaters, resistors, cables, motors, batteries, contactors, transformers and the generic heat sink / thermal mass. A link's conductance is the series combination 1/(1/G₁ + 1/G₂) of both ports; a tank's side is ideal.</p>
          <p><strong>Pipes hold water</strong> in N well-mixed cells (ρAL), integrated implicitly, which gives transport delay and stored heat; switch inventory off for an ideal zero-volume pipe. <strong>Heat exchangers</strong> couple two hydraulic streams with ε-NTU (counter- or parallel-flow); each stream has a quadratic loss. <strong>Pressure-reducing valves</strong> integrate the outlet-pressure error with a stroke-rate limit. <strong>Pump curves</strong> may be entered as flow:head points; affinity laws scale them with speed. NPSH available is compared with NPSH3 and logged as a cavitation warning; a configured teaching curve reduces pump head. Bubble dynamics and cavitation damage are omitted.</p>
          <p><strong>Three-phase supplies</strong> make their network a balanced per-phase (star-equivalent) model: phase EMF V_LL/√3, line currents, and powers ×3. Per-pole devices (cables, fuses, breakers, switches, contacts) count three poles thermally. RLC loads use RMS phasors; induction motors include dynamic flux and transient starting current. DC motors are rejected on AC networks. Supply protection tolerates brief starting surges and checks persistent overload. Star-delta starters, fundamental-frequency soft starters and V/f drives are available; drives include approximate rectifier input harmonics. Thyristor waveforms, PWM output switching and DC-link dynamics are omitted.</p>
          <p><strong>Signal conditioning:</strong> scale/offset, limiter, exact first-order filter, rate limiter and min/max/switch selector. The PID's derivative acts on the filtered measurement rate.</p>
          <h3>Battery, powered contactor, transformer and radiator</h3>
          <p><strong>Battery:</strong> finite rechargeable charge with linear open-circuit voltage versus SOC, internal I²R heat and directional full/empty protection. Chemical energy is internal storage; the external-supply counter excludes battery delivery. Reset restores initial SOC. Chemistry-specific dynamics and ageing are omitted.</p>
          <p><strong>Powered contactor:</strong> wire its independent DC coil terminals ca–cb. Coil voltage controls pickup/dropout with hysteresis and delay; coil and main-contact losses heat the package. <strong>Transformer:</strong> isolated AC windings a–b and sa–sb include primary-referred winding/leakage impedance, magnetizing current and core loss. Secondary probes report RMS quantities; generic power reports package losses. AC coil excitation, transformer DC excitation, saturation and switching inrush are unsupported.</p>
          <p><strong>Fan-cooled radiator:</strong> wire the DC fan and the water inlet/outlet. Natural cooling remains with the fan off; actual fan voltage increases cooling conductance. The zero-inventory outlet approaches ambient exponentially with flow, and signed heat exchange can also warm cold water. Fan power goes to ambient once. Fan startup, explicit airflow and fin/body thermal storage are omitted.</p>
          <h3>DC electrical model</h3>
          <div className="formula">
            V = IR &nbsp;&nbsp; P = VI = I²R &nbsp;&nbsp; Σ I<sub>node</sub> = 0
          </div>
          <p>
            Modified nodal analysis solves voltages and source currents using
            scaled partial-pivot Gaussian elimination, with relative pivot and equation-error checks. Wires have zero resistance;
            the Power cable component models R = ρL/A with temperature
            dependence and conductor heating. Switches use 0.01 Ω when closed
            and infinite resistance when open. Resistive elements use
            R(T) = R₂₀(1 + α(T − 20 °C)) at their simulated temperature (α = 0
            by default). Heaters derive R = V²ₙₒₘ/Pₙₒₘ; their actual power is
            V²/R of the solved circuit. A voltmeter loads the circuit with
            10 MΩ.
          </p>
          <p>
            Sources are ideal (output protection trips above the current
            rating), Thevenin (internal resistance), current-limited CV/CC
            (active-set crossover to I = I<sub>limit</sub>) or constant-current
            with voltage compliance. Disconnected islands each have a local
            reference; ground components share one. A short across an ideal
            source without internal resistance pauses the simulation. Exceeding
            power, current or voltage ratings is reported and the component is
            marked overloaded; failure follows from its modelled temperature.
            Fuses open after their configurable trip delay above rated current.
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
            inventory mass uses temperature-dependent Kell density and cₚ = 4,180 J/(kg·K). Electrical power
            is updated before the thermal solve. Electrical thermal masses
            store dissipated heat and exchange heat with their configured ambient.
            Battery internal losses heat the pack; radiator fan power goes to ambient. Ordinary supply internal losses lie outside the terminal-energy boundary.
          </p>
          <p>
            Conduction is energy-conserving between connected nodes; backward
            Euler introduces first-order time discretization error. Ambient loss
            is integrated using end-of-step temperature. Tanks support liquid
            water from 1–95°C; crossing these limits pauses the experiment.
            Boiling and phase change are unsupported; tanks can include configured vessel thermal capacity. Moving water uses the hydraulic and conservative advection models below.
          </p>
          <h3>Hydraulic networks and finite water storage</h3>
          <div className="formula">ΣQ = 0 · Δp = f(L/D)ρv|v|/2 · pbottom = ρgV/A</div>
          <p>Blue terminals connect fluid nodes; insert pipe components to create physical resistance. A pipe’s configured length and diameter determine its losses independently of the canvas route. Hydraulic flow uses reference ρ = 1,000 kg/m³, temperature-dependent IAPWS viscosity μ(T), and cp = 4,180 J/kg·K. Laminar friction uses 64/Re, turbulent friction uses Swamee–Jain, blended across Re 2,300–4,000. A damped nodal Newton solve has bounded iterations and monitored continuity residuals.</p>
          <p>Tanks are finite, vented, well-mixed vessels with bottom connections. Their elevation and water level set pressure potential. The engine splits timesteps at empty/full inventory events, blocks outward flow from empty tanks and resolves the network. Inflow into a full vented tank continues. Its free surface can rise above the rim; a finite weir discharges the surcharge at the mixed tank temperature. Connect the rim outlet through a physical pipe to route overflow into another tank. The spill carries mass, enthalpy c_p·T and potential energy g·z_rim out of the system, and is shown as overflow rate, cumulative volume and start/stop events. A full tank never acts as a hidden shut-off valve; filling protection needs an explicit valve or level control. Sealed tanks are unsupported. Pipe friction uses the IAPWS 2008 viscosity μ(T) of the local water (pipe cells, or the upstream node for zero-volume pipes, lagged by one solver substep); tank mass is conserved while its volume and level use temperature-dependent Kell density. The hydraulic solver uses a reference density of 1000 kg/m³ and c_p stays at 4180 J/kg·K. Water hammer, cavitation bubble dynamics and spatial mixing are not modelled. Pipe heat loss uses explicit thermal UA; material and insulation are descriptive metadata.</p>
          <h3>Motors and centrifugal pumps</h3>
          <div className="formula">I = (dV − keω)/R · τ = ktI · J dω/dt = τ − τload − bω<br/>H = H0[(ω/ωrated)² − ½(Q/Qrated)²] · P_imp = ρgHQ · P_net = Δp·Q = P_imp − R·Q² · P_shaft = P_imp/η_h + kω³ · η = P_net/P_shaft</div>
          <p>Connect a motor’s gray shaft terminal to a pump shaft and wire its electrical terminals to a real circuit. Motor back EMF is stamped into MNA. The ideal optional PWM drive exchanges bus current dI and armature voltage dV, preserving electrical power; speed inputs use RPM. Shaft speed is solved implicitly at the midpoint with pump load feeding back into current. Internal substeps are at most 1/240 s. Armature inductance, commutation and drive losses are omitted. A pump includes a reverse-flow check. Beyond the positive-head curve it acts as a passive restriction; turbine behavior is unsupported and reported.</p>
          <p>Copper and rotational friction heat the motor; pump losses and hydraulic dissipation heat flowing water. At zero flow, pump drag heat goes to the environment. The energy panel separates internal transfers from electrical supply, thermal/chemical/rotor/gravitational storage and external losses. Hydrostatic storage splitting has a measured timestep error; the engine reports a residual beyond 0.5 J or 0.5% supplied energy. This is a teaching model, not equipment certification.</p>
          <h3>Hydraulic automation, saves and challenges</h3>
          <p>Pressure sensors output Pa, flow sensors m³/s, level sensors percent. They read calculated state and share the existing controller graph, fault semantics and simulation clock. A PI regulator has bounded output and anti-windup; motor speed commands use RPM and valve position commands percent. Actuated valves have a finite stroke time and fail position; actuator power is omitted. Independent source and high-level sensors can gate motor enable without relying on the primary level measurement.</p>
          <p>Use the water-transfer, automatic-supply and heated-loop examples under File → Starters & examples. Challenges 004–006 supply only fixed environment fixtures and a mission guidebook; learners add equipment, and scoring uses the calculated performance; hydraulic scored runs lock operating edits after startup to require autonomy. Normal Save includes recorded inputs and elapsed time for a live run; Import recomputes all dynamic state using recorded fixed steps. Export scenario configuration saves only the initial model. Replay and restore yield to the browser, support up to 30 simulated days (fixed-step portions replay step by step), and do not trust imported dynamic scores.</p>
          <h3>Automation and independent protection</h3>
          <p>
            Purple connections carry typed numeric or Boolean signals and no
            electrical power. Each fixed step reads sensors, evaluates the
            acyclic control graph in dependency order, applies relay contacts,
            solves DC power, integrates coupled thermal state, checks ratings,
            and records results. Temperature lag uses an exact first-order
            update; optional noise uses a repeatable seeded generator.
            Hysteresis turns on below its lower threshold and off at the upper
            threshold. Timers use simulation seconds.
          </p>
          <p>
            The thermostat combines the same sensor and hysteresis models. The
            safety cutoff independently measures its assigned thermal mass,
            latches open at its threshold or on invalid sensing when configured,
            and requires a manual reset below its reset margin. Relay and cutoff
            contacts have finite resistance and thermal capacity. Arcing,
            bounce, coil energy, and real safety certification are outside this
            model. A welded contact ignores its command.
          </p>
          <p>
            A cooling jacket adds UA(T − Tcoolant) to the attached mass. Its
            coolant is an ideal infinite reservoir, with signed heat included in
            external energy exchange. There is no circulating fluid, pump,
            refrigeration power, or phase-change model.
          </p>
          <h3>Measurement and construction</h3>
          <p>
            Each trace targets a component or an explicit node/reference pair.
            Floating islands cannot be compared electrically; the result is
            invalid. Mixed units use separate labeled plots. Hover a chart to
            read exact recorded values; time-window and history controls also
            select the energy-balance interval. CSV exports all configured
            probes with blank cells for unavailable measurements. Stored energy
            change is shown separately for water, elements and other internal
            storage, including battery chemical energy; internal immersion heat is not double-counted.
          </p>
          <p>
            Selected wires expose draggable orthogonal bend points. Electrical
            crossings never connect; branching requires shared terminals or
            explicit junctions. Connected duplication and saved assemblies remap
            internal wiring and sensor targets; external connections and targets
            are omitted.
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
            Running simulation advances in fixed 1/60 s steps independently of
            rendering. Speeds range from 0.25× to 60×. While paused, Advance
            (60 s or +1 s … +24 h) uses the adaptive integrator for
            thermal/electrical/control experiments and 1/60 s steps otherwise,
            with progress and Stop. Long background frames are bounded to
            0.25 s of wall time, so the clock slows safely when a tab is
            suspended. Telemetry records at 4 Hz; beyond 14,400 samples the
            whole history is kept at progressively coarser spacing. Events use
            simulation timestamps. The Event log offers deterministic replay
            from the last reset and recorded editor inputs, including adaptive
            advances, up to 30 simulated days. Replay reconstructs the final state on the pinned engine; cross-platform bitwise identity is not guaranteed. It
            does not provide timeline scrubbing.
          </p>
          <p>
            Save downloads a version 4 spatial or version 3 schematic scenario or a live-run archive and stores a recovery copy
            on this device. Import opens a validated project file. Project files
            contain construction and initial conditions; loading starts a
            reproducible fresh experiment. CSV exports measured telemetry. Mass,
            inventory, model variants, and other physical configuration changes
            require Reset once time has advanced. Operating controls remain
            live. Version 1 files migrate through validated defaults.
          </p>
          <h3>Challenge scoring</h3>
          <p>
            Mandatory objectives, safety limits, and budgets must all pass.
            Score = 60 + 20η + 10(1 − cost / budget) + 10τ. For heating, η =
            min(1, 2,508,000 / consumed joules), τ = min(1, 1,254 / elapsed
            seconds). For First Light, η = 1 and τ = min(1, 3 / elapsed
            seconds). Thermal Runaway requires 240 seconds of regulation with at
            least 97% in-band time, 2–80 relay transitions, actual independent
            interruption below 95°C, a manual safety reset, and 120 seconds of
            stable recovery. Its score is 50 + 15 stability × overshoot factor +
            10 energy efficiency + 10 economy + 10 time efficiency + 5 switching
            economy, with the factors clamped to 0–1. Coolant capacity halves
            after 120 regulation seconds; after at least 240 seconds and a full
            automatic switching cycle, control relay contacts weld and cooling
            fails. Following 30 seconds of verified isolation these faults are
            repaired, while the safety latch remains tripped. One star for
            completion, two at 80, three at 90.
          </p>
        </div>
      </section>
    </div>
  );
}
