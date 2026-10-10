# Phase 2B — implemented multiphysics models

This phase extends the existing engine, editor, automation graph, telemetry, persistence and challenges. It does not introduce a second application or a spatial fluid simulator. Preflight evidence and Phase 2A limitations are in [PHASE2B-AUDIT.md](PHASE2B-AUDIT.md).

## Architecture and scheduling

- `hydraulic.ts`: terminal topology, Darcy friction, monotone branch laws, nodal nonlinear solve, conservative junction transport and tank boundary-event times.
- `multiphysics.ts`: finite tank state, motor shaft state, valve position, implicit electrical/mechanical/pump coupling, and cumulative internal work.
- `units.ts`: SI/display conversions and water constants. Existing thermal/editor fields retain liters and Celsius for compatibility. Hydraulic inventory/transport use m³, kg, K, Pa, W and rad/s.
- `engine.ts`: owns validated frozen configuration and runtime state. Existing backward-Euler thermal integration remains intact. New copper/friction heat joins the same thermal matrix. Fluid advection changes tank temperature/mass before thermal conduction. Failed nonlinear intervals restore the fluid/shaft checkpoint before returning an error.
- `automation.ts`: the existing simulation-time dependency graph now reads pressure, signed flow and percent level, and includes a bounded PI controller with conditional anti-windup. No rendering clock drives control.
- `measurements.ts`: calculated hydraulic and mechanical probes join existing multitrace charts and CSV; display conversions are explicit. Tank flow means signed net inventory inflow; pipe/pump flow is signed branch flow. Static vented-tank pressure is available even without a pipe network. Empty/no-flow fluid temperature and zero-input motor efficiency are unavailable rather than invented values. The energy panel separates internal work from external energy and storage changes. Pump inspector shows the speed-scaled operating curve and solved point.

Outer timing stays 1/60 s, independent of requestAnimationFrame. Within a coupled interval, mechanical/electrical/hydraulic state is solved at the implicit midpoint with internal steps ≤1/240 s. A numerical Jacobian couples all motor midpoint speeds to MNA back EMF and hydraulic pump torque. Iteration count is bounded at 16, with a 1e-9 rad/s midpoint-equation residual threshold. Controls execute once per outer step, holding commands during internal steps. Tank head is frozen within each internal subinterval; this produces measurable first-order storage/head splitting error, not an energy correction. Thermal conduction is backward Euler at the outer timestep. This combination is tested against smaller actual internal timesteps and independent rendering schedules.

## Hydraulic equations and topology

Connections identify physical terminals and merge ideal nodes. Pipe components are resistance branches; drawing routes never set physical length. Internal node unknowns are pressure potentials Π = p + ρgz. At a vented tank bottom, Π = ρg(zbottom + V/A); free-surface gauge pressure is zero. All water uses ρ=1,000 kg/m³, μ=0.001 Pa·s, cp=4,180 J/(kg·K), g=9.80665 m/s².

Every internal node satisfies ΣQ=0. A pipe uses v=Q/(πD²/4), Re=ρ|v|D/μ, Δp=f(L/D)ρv|v|/2. Laminar f=64/Re is evaluated using the analytic Hagen–Poiseuille loss at zero flow. Turbulence uses Swamee–Jain, f=0.25/[log10(ε/(3.7D)+5.74/Re^0.9)]². Re=2,300…4,000 uses a continuous linear blend; transitional accuracy is inherently approximate. At exact rest friction-factor telemetry uses a finite zero convention; the pressure law retains the nonzero analytic laminar slope.

Valves use Δp = 10⁵Q + KρQ|Q|/[2A²α²], with α=opening/100. The small physical linear restriction regularizes the zero-flow derivative. Zero opening is exact isolation. Check valves add cracking pressure and disallow reverse flow. Actuated valves move at 100/responseTime percentage points per simulation second toward a numeric percent command; invalid wired control selects their declared fail position. Stuck-open/closed faults impose the corresponding physical restriction. Actuator electrical supply and consumption are explicitly omitted.

The pressure solver inverts monotone branch laws (analytic quadratic inverses for pumps/valves; bounded bisection for pipes), then uses damped nodal Newton with a numerical/analytic conductance Jacobian. Pressure unknowns are scaled to kPa and residual flow to L/s. At most 60 iterations and 24 backtracking reductions are permitted. Continuity targets 1e-13 m³/s and accepts <1e-12 m³/s; constitutive pressure residual is reported separately. A small Jacobian regularization supports isolated closed regions; it does not add leakage to physical branch flow. Unreferenced, unprimed networks supply no fluid. Limits are 120 hydraulic branches and 200 unknown pressures, within the editor's 100-component/300-connection limit. Conflicting directly merged finite tank boundaries are rejected: insert a real pipe.

## Finite storage and conservative boundaries

Each tank owns current V, m=ρV, and water temperature, separately from initial editor properties. It supports a constant effective surface area, bottom fluid connection, base elevation, initial inventory, capacity and a pressure rating. Only open vented constant-density water tanks are supported; sealed operation is rejected.

Tank rates are integrated from solved branch flows. Before an interval crosses empty/full, the engine computes the first boundary time, shortens the interval, solves midpoint coupling again and transports exactly that amount of mass. At the boundary, outward flow from an empty vessel or inward flow into a full vessel is blocked and the network is resolved for the remaining time. No excess mass is silently discarded by a volume clamp. This is a conservative port-closure model: a full vessel can temporarily block inlet flow even when a simultaneous outlet exists. It is not a spillway, pressurized accumulator or free-surface overflow model. Empty vessels retain their last temperature as a state placeholder, with zero stored fluid heat capacity.

## Motor and pump model

Brushed DC armature inductance is omitted. For optional ideal PWM duty d:

- Armature current Ia=(dVbus−keω)/Ra, bus current Ibus=dIa.
- Back EMF keω is stamped as a Norton source plus conductance d²/Ra in the existing MNA system.
- Electromagnetic torque τe=ktIa, with kt=ke in SI enforced for energetic consistency.
- J dω/dt=τe−τpump−τexternal−bω.
- Copper power Ia²Ra and rotational friction bω² heat the motor's existing lumped thermal mass.
- Rotor storage is Jω²/2. External defined shaft torque exports τexternalω and is tracked separately.

Direct operation uses d=1. A wired RPM command or enabled local speed command uses bounded proportional speed feedback plus a rated-voltage back-EMF feedforward term. It changes electrical armature voltage through an ideal PWM drive, never applies free shaft torque. Disabled/failed/open-power operation removes electrical torque; the rotor coasts under its load and inertia. Ideal sources may absorb regenerative power. Current limits pause the experiment instead of modeling current regulation. There is no inductance, PWM ripple, drive loss, commutator or electrical arc model.

Motor catalog models include the original 24 V laboratory motor, 48 V traction and 180 V industrial variants. Each purchases actual torque/back-EMF constants, inertia, thermal properties and operating limits; it does not multiply simulated output. The traction model uses R=1.2 Ω, kt=ke=0.15, J=0.025 kg·m² and b=0.001 N·m·s. The industrial model uses R=3 Ω, kt=ke=0.55, J=0.12 kg·m² and b=0.002 N·m·s. Their 2 kW and 11 kW electrical ratings are protective input limits, not guaranteed or nameplate shaft output. Current/torque limits are 40 A/6 N·m and 60 A/33 N·m respectively. These are illustrative model coefficients, not manufacturer equipment specifications.

The industrial pumping station starter uses a 180 V, 80 A-rated supply, industrial motor, 35 m shutoff-head/360 L/min-reference pump with peak efficiency 0.78 and drag coefficient 0.000012, 30 m of 50 mm piping, a 2,000 L source and a 1,000 L destination 12 m higher. Additional traces show RPM, shaft and hydraulic power. Existing 24 V scored assignments and their budgets remain unchanged.

The centrifugal pump has one motor shaft connection and one hydraulic inlet/outlet branch:

- s=max(ω,0)/ωrated; Hcurve=H0[s²−0.5(Q/Qrated)²].
- Positive-head hydraulic power Ph=ρg max(Hcurve,0)Q.
- η=max(0.15, ηpeak[1−0.35(Q/(Qrated s)−1)²]) in the supported positive-speed range.
- Shaft power Ps=Ph/η+cω³; shaft torque τp=Ps/ω, using its finite zero-speed limit.
- The branch contains an additional 10⁵Q Pa internal loss. Its net pressure rise is gross impeller rise minus that loss.

Pump speed changes the head curve, the solved operating flow changes shaft torque, and this load changes motor acceleration, back EMF and current. A reverse-flow check is built into this pump model. Beyond positive head, the descending curve continues as a passive resistance, generates no hydraulic work, and reports the unsupported turbine region. Shutoff drag consumes real shaft work; its heat goes to the environment when there is no advecting fluid. Cavitation, NPSH, reverse rotation, water hammer and turbine recovery are not implemented. Catalog coefficients are illustrative engineering-scale values rather than a manufacturer's certified curve.

## Heat transport and energy accounting

Pipes/junctions have zero fluid inventory and no travel time. A directed upwind mixing system solves junction enthalpy temperatures. Tanks mix using integrated enthalpy m cp T, not average temperatures. Hydraulic branch dissipation and pump inefficiency heat outgoing water. Pipe thermal exchange uses Tout=Ta+(Tin−Ta)exp(−UA/(ṁcp)), followed by explicit loss-heat addition. The same signed ambient heat enters the ledger. Material, conductivity and insulation are descriptive metadata; thermalUA is the supported heat-loss parameter, not an inferred wall/insulation model. Heating elements and cooling jackets use the existing thermal ports on the finite water storage. A heated circulation starter contains a powered pump, heater, two finite tanks and a cooling return line.

The external balance is:

Eelectrical,supplied = ΔEthermal + ΔErotor + ΔEgravity + Eambient + Eexternal-shaft + Edrained + residual.

Gravitational water storage is ρg(zV+V²/(2A)). Electrical resistance/copper loss, pump shaft work, hydraulic work and dissipation are internal transfers and are reported without being counted a second time as external sinks. Eambient includes passive thermal losses, pipe exchange, ideal cooling reservoirs and zero-flow pump drag. A depletion fault is an explicit physical drain: its removed mass, enthalpy and potential energy are exported, preserving the ledger. Fluid enthalpy uses cpT consistently; only changes matter while total mass is constant.

No empirical correction factor forces balance. Mass drift above 1e-6 kg, or energy residual above max(0.5 J,0.5% of supplied energy), is reported as a violation. These are teaching-model numerical tolerances; small hydrostatic head-splitting errors are expected and quantified.

## Editing, persistence, replay and challenges

New physical inventory/geometry/coefficient edits require Reset after time advances. Sandbox operational controls (valve opening, enable, RPM setpoint, supply voltage, controller references) remain live. Domain mismatches, duplicate shafts, unsupported parameters and stale references are rejected. Assemblies and duplication reuse the existing terminal/target ID remapping. The 3-domain predecessor's experiments remain usable.

Version 3 scenarios store the initial model, topology, control graph, probes and assemblies. Versions 1/2 migrate by filling newly defined defaults while retaining their existing data. Normal Save after running emits a versioned live-run archive: validated origin, timestamped inputs, current configuration and duration. Import replays to reconstruct inventory, temperature, shaft, controller, RNG and faults; arbitrary imported dynamic scores are never trusted. Explicit scenario export omits dynamic state. Browser restore/replay yields every ~12 ms, supports at most 7,200 simulation seconds and 5,000 inputs. Replay is event/step deterministic, not arbitrary continuous timeline scrubbing. Large archives are subject to the existing 2 MB browser import limit.

Challenges 004–006 provide an unwired editable scaffold. 004 requires 100 L pumped uphill within 300 s. 005 scores actual pressure over 180 s after startup and alternates a physical consumer restriction every 60 s. 006 scores 600 s after commissioning, limits motor cycling and injects invalid primary level sensing at 300 s. All enforce catalog ratings, finite source/destination inventories, 24 V, 500 W, 2 bar and budgets. Scored hydraulic runs lock physics/control/actuator edits after startup to require autonomy. Completion requires physical transferred water and powered shaft work, not the predefined arrangement. Pressure feedback must measure the actual consumer inlet and both demand phases must create distinct solved flows. Supply requires actual source/destination feedback and two connected destination sensing paths. Its independent guard shares the motor enable actuator; certification/common-cause safety analysis is outside the model.

## Validation and Phase 3

Executed results are in [validation/latest.md](../validation/latest.md), [phase2b-coupled.json](../validation/phase2b-coupled.json) and [PHASE2B-RESULTS.md](PHASE2B-RESULTS.md). Tests cover isolated laws, junction continuity, boundary events at multiple timesteps, motor startup/stall/load, complete pump transfer, nonmonotonic valve/current response, thermal circulation, fault coasting, automation, archives, import/challenge exploits, independent frame scheduling and quantified timestep refinement. Longest new scored run is 720 s; the two-hour replay bound is a limit, not a claim of executed two-hour multiphysics validation.

Next priorities: explicit pipe fluid inventory/travel time; measured manufacturer pump curves and NPSH/cavitation bounds; conservative midpoint storage-head iteration; additional robustness/performance tests on larger networks; richer independent hydraulic protection; worker execution when measured scene size justifies it; finite-volume heat exchangers; inductive motor/drive and transient circuit models. Spatial free surfaces, spills, conductivity, steam/phase change and structural failures remain separate future modules behind the explicit mass/energy/shaft interfaces.

## Primary model references

The [EPA EPANET 2.2 manual](https://nepis.epa.gov/Exe/ZyPURL.cgi?Dockey=P10113EM.txt) documents Darcy–Weisbach network head loss and Swamee–Jain turbulent friction. Our transitional blend and zero-volume thermal transport are declared implementation choices, not EPANET algorithm equivalence. [DOE's Pumping System Performance sourcebook](https://www.energy.gov/sites/prod/files/2014/05/f16/pump.pdf) describes speed-dependent pump/system operating points and affinity relationships. [University of Michigan's DC motor tutorial](https://ctms.engin.umich.edu/CTMS/index.php?aux=Activities_DCmotorA) explains the equal torque/back-EMF constants under consistent units; our armature-inductance omission is an explicit reduction of the transient motor model.
