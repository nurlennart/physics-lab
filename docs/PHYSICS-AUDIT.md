# Physics and preset audit — 12 October 2026

The implemented models and their interfaces were reviewed against `docs/` first, then exercised through analytic references, conservation checks, operating fixtures, supplied example files and the production interface. Two substantive defects were found and corrected: electromechanical convergence at current-limit transitions, and artificial hydraulic resistance that distorted large valves. The conclusions apply to the documented models and tested operating conditions; the simulator does not reproduce every physical effect or every possible component combination.

Audited base revision: `6ef3bfd`, with the changes on `work/physics-preset-audit`. Runtime: Node 22.23.3, Planck 1.4.2. No deployment was performed.

**Scope and evidence**

The catalog contains **62 component kinds, 456 parameters and 68 built-in component presets**. Every catalog configuration and preset is checked for parameter validity and derived consistency. The new operating campaign runs **112 scenarios**, covering every built-in preset, all **56 heater × tank preset pairings**, two bench-supply/heater operating points and a complete industrial preset feeder. The example campaign now checks both the 21 generated starters and their 21 supplied JSON files.

| Area | Models and interfaces checked | Assessment |
| --- | --- | --- |
| Electrical networks | DC MNA, AC phasors, balanced and explicit three-phase circuits, source CV/CC/compliance, resistors, cables, switches, junctions, ground, meters, capacitors and inductors | Consistent with the declared steady-state circuit models; switching transients are outside their scope |
| Electrical devices and protection | Finite batteries, isolated transformers, powered contactors, relay NO/NC paths, filament lamps, fuses, breakers and motor protectors | Storage, losses, isolation, timing and protection are exercised; fuse and lamp accuracy exceptions are listed below |
| Thermal | Heaters, vessel/water storage, thermal masses, contact conductance, ambient loss, cooling jackets and radiator heat rejection | Internal transfers cancel in the ledger; two-node and cooling references cover integration accuracy |
| Hydraulic | Finite tanks, pipes and pipe inventory, fluid junctions, manual/check/actuated valves, pressure regulators, pumps, radiators and both exchanger streams | Mass, pressure, transported enthalpy and pump work are checked; artificial valve-type resistance was corrected |
| Machines and converters | DC back EMF/torque, shaft inertia and loads, induction flux and energy, star-delta, soft starters, VFD output/input and harmonics | Coupled operation, interruption, recovery, regeneration and loss accounting are exercised; Newton cycling was corrected |
| Spatial mechanics | Rigid-body materials and mass, gravity, contacts, constraints, springs, gears/racks, shaft inertia, forces, brakes and impulses | Shared shaft state and energy accounting pass reference scenarios; the power-loss rack check now uses the actual stopping time |
| Automation and measurement | Temperature/pressure/flow/level/position/speed sensing, comparator, hysteresis, thermostat, timers, gates, constants, latch/reset, PID, signal blocks and independent cutoff | Simulation-time behavior, typed connections, unit conversions, unavailable measurements and fault propagation are exercised |
| Integration and persistence | Electrical ↔ thermal ↔ shaft ↔ hydraulic ↔ spatial coupling; sensor feedback, challenge faults, import/export and replay | Tested through connected operating systems, challenge reference designs and browser workflows |

The complete component inventory remains in [COMPONENT-MATRIX.md](COMPONENT-MATRIX.md). Coverage of a model does not mean every catalog variant has been tested in every topology.

The preset fixtures last 1–120 simulated seconds, depending on the device. The heater–tank matrix runs for 1 s and compares water-temperature rise with an independent continuous two-node solution, allowing **0.002 K + 3% of the rise** for integration error. Other expected values and tolerances are recorded per check in [presets.json](../validation/presets.json). Longer control, fault and inventory behavior is covered by the example and challenge campaigns.

**Defects corrected**

1. **Current-limited motor/pump systems could stop with a convergence error.** Three connected pump-preset fixtures reproduced `Electromechanical midpoint coupling failed to converge`: the circulator, 6,000 L/min process pump and measured-curve pump. Full Newton steps crossed the supply's CV/CC boundary and cycled. Residual-decreasing backtracking and local Jacobian rebuilding resolve this while retaining the 10⁻⁸ rad/s acceptance tolerance. A stiff DC-shaft regression independently checks final speed, supply regulation and energy conservation.

2. **A numerical valve resistance changed the physical pressure-loss equation.** Valve-type branches added a fixed 100,000 Pa·s/m³ series resistance to the two-K law. At 600 L/min, the DN100 gate-valve preset consequently lost **1,165.302 Pa**, although its configured coefficients give **165.302 Pa**: a factor of **7.05**. The fixed resistance was removed from the flow law and heat accounting. Purely quadratic branches instead bound the Newton Jacobian near zero pressure; their accepted flow still follows the unchanged physical equation. Independent DN100 and three-valve regressions cover both accuracy and numerical robustness.

3. **The shaft-event campaign assumed reversal too early.** The present lift has enough upward momentum to coast for about **3.953 s** after power loss. Its old test required reversal after 3 s. The revised check computes the stopping time from gravity, reflected inertia and friction, then observes reversal and compares speed with the analytic solution. After 5 s unpowered, measured speed is approximately **−5.688124562 rad/s**, with zero motor current and a conservation residual of about **0.0116 J**.

4. **Two browser checks allowed only 5 s for long simulation advances.** Their operation waits now allow 60 s, consistent with the existing long-advance tests. The physical completion and measurement assertions remain in place.

5. **Validation and documentation coverage was incomplete.** Added `npm run validate:presets`; extended example validation to the supplied files; regenerated the parameter matrix; corrected the component matrix's overstatement that the default fuse meets every stated fast gate.

6. **The long overflow test's mass tolerance excluded accumulated network error.** After the valve correction, its 400 s run closes mass to **1.774 × 10⁻¹¹ relative**, about **2.66 µg** in a 150 L system. The test's former 10⁻¹¹ bound was replaced by 10⁻¹⁰ (under 15 µg), allowing accumulated nodal continuity tolerance and floating-point error. Empty-source, spill-volume, energy and overflow-stop assertions remain in place; this is a validation-tolerance adjustment, not a mass-ledger correction.

Removing artificial hydraulic loss intentionally changes some hydraulic trajectories. All nine challenge scores and star ratings remain unchanged. The sole reference change is the transfer challenge's completion time, **125.233 → 125.100 s**. Its baseline was deliberately refreshed because the corrected valve dissipates less energy.

**Final verification**

| Check | Executed result | Evidence / repeat command |
| --- | --- | --- |
| Unit and integration tests | **367/367 passed**, 32 files, including three new regressions | `npm run check:fast` |
| Independent physics references | **87/87 passed** | [latest.md](../validation/latest.md) |
| Scaling and parameter extremes | **124/124 passed** | [scaling.md](../validation/scaling.md) |
| Built-in preset operation | **112/112 passed; 68/68 presets covered**, including 56 heater–tank pairings | [presets.json](../validation/presets.json); `npm run validate:presets` |
| Generated and supplied examples | **42/42 passed** | [examples.json](../validation/examples.json); `npm run validate:examples` |
| Challenge reference designs | All **9 complete**, unchanged scores/stars; transfer time deliberately updated | [reference-scores.json](../validation/reference-scores.json); `npm run check:scores` |
| Coupled hydraulic/thermal systems | **4/4 passed** | [coupled.json](../validation/coupled.json); `npm run validate:coupled` |
| Spatial reference systems | **5/5 passed** | [spatial.json](../validation/spatial.json); `npm run validate:spatial` |
| Shaft power-loss/regeneration events | **2/2 passed** | [shaft-events.json](../validation/shaft-events.json); `node scripts/check-shaft-events.mjs` |
| Production browser workflows | **76/76 passed** against the final production build | `npm run test:e2e:prod` |
| Parameter metadata | **62 kinds / 456 parameters**, matrix regenerated | [PARAMETER-MATRIX.md](PARAMETER-MATRIX.md); `npm run audit:parameters` |
| Typecheck, production build, dependency lock and diff checks | **Passed**; production build has a bundle-size advisory | `npm run check:fast`; `node scripts/installed-matches-lock.mjs`; `git diff --check` |

The final fast gate completed in 280 s and the final browser suite in 5.7 minutes. All results above were executed during this audit. The standard gate preserves a report's older timestamp when its numerical results are unchanged.

The preset campaign's largest absolute energy residual is **0.00140 J**, with mass residual below **1.55 × 10⁻⁹ kg**. Across the longer coupled and example campaigns, the largest absolute mass residual is **3.39 × 10⁻⁸ kg**. The mechanism example reaches **1.005 J** energy residual; rigid-body conservation is subject to the documented solver tolerances and must be judged against its energy scale. No preset or example run reported a simulation error, rating violation or failed component.

**Preset compatibility**

Presets describe individual engineering configurations. They do not make every pair of components compatible.

- The bench CV/CC preset starts at **12 V**, so the 100 W / 24 V heater initially receives **25 W**. With its voltage command raised to 24 V, the bench preset's **3 A** limit holds heater power to **51.84 W**. This is correct current-limited behavior; full heater power needs at least 4.17 A at 24 V.
- The tested industrial assembly combines the **400 V / 100 A supply, 125 A fuse, 80 A relay, 35 mm² copper feeder, 30 kW heater and 2,000 L tank**. It draws **74.568 A** and delivers **29.655 kW** to the heater, including actual source, contact and conductor voltage drops.
- A **100 kW / 690 V** heater needs about **145 A**. The 80 A relay and 125 A fuse presets are unsuitable at that operating point; higher-current catalog equipment is required.
- The heater–tank matrix is a short coupling/accuracy test. A large heater can overheat a small vessel during a long run. Temperature control, an independent cutoff and a suitable vessel remain part of a complete experiment.

**Remaining accuracy limits**

These are material limits on what “physically correct” means here:

- **Fuse:** the documented default normalized gG-type model takes about 0.115 s at 9.38 × rated current, missing the stated 0.1 s fast gate by 15 ms. It is not a full IEC-conformance model; arcing and current limitation are absent. This calibration was not silently changed during the audit.
- **Lamp:** fixed-step cold-filament sampling can overestimate switch-on I²t by roughly a factor of two. Lamp steady-state behavior and energy accounting have stronger accuracy than its short surge waveform.
- **NTC preset:** the 10 kΩ thermistor uses linear α = −0.04/K. It is a local approximation near 20 °C; extrapolation reaches zero resistance at 45 °C. It is unsuitable as a general high-temperature thermistor model.
- **AC/machines:** passive L/C switching transients, transformer saturation/inrush, induction saturation/core loss, DC armature inductance and drive switching losses are omitted or simplified. Passing steady-state or dq references does not validate those absent effects.
- **Fluids:** water is incompressible and well mixed, with constant heat capacity and a reference density in flow/gravitational accounting; the supported liquid range is 1–95 °C. Boiling, stratification, water hammer and turbine/windmilling torque are unsupported. Pump coefficients and cavitation breakdown are teaching approximations.
- **Mechanics/control:** finite rigid-body solver slop and first-order position error remain; equipment housings are static. Several actuators and control blocks have ideal external power. Control samples the prior accepted state once per outer step.

Within these limits, conservation is checked independently of output accuracy. Passing conservation alone cannot establish a correct pressure curve, waveform or control response—the artificial valve resistance demonstrated that distinction.

**Independent references consulted**

Circuit balance follows charge and energy conservation as described by [OpenStax, Kirchhoff's rules](https://openstax.org/books/university-physics-volume-2/pages/10-3-kirchhoffs-rules). The motor references use the torque/back-EMF and inertia/friction equations in [University of Michigan CTMS, DC motor modeling](https://ctms.engin.umich.edu/CTMS/?example=MotorSpeed&section=SystemModeling). Hydraulic loss and gate-valve coefficient checks were cross-checked against the [EPA EPANET 2.2 manual](https://nepis.epa.gov/Exe/ZyPURL.cgi?Dockey=P10113EM.txt); water viscosity uses the [official IAPWS R12-08 release](https://iapws.org/technical-guidance/release/viscosity). These references support the governing laws, not manufacturer calibration of the catalog coefficients.
