# Phase 2A audit and implementation plan

The pre-change baseline is commit `3122410`. Its architecture is a mutable Simulation outside React, union-find/MNA electrical islands, backward-Euler coupled thermal nodes, a fixed 1/60 s clock, project snapshots for editor history, and timestamped project inputs for replay.

## Findings

| Severity | Finding                                                                                                                       | Required correction                                                                                                                                                    |
| -------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| High     | Sandbox water mass, thermal capacity and inventory edits can change energy after time starts; undo bypasses inspector checks. | Enforce transition rules in the engine, across all editor paths. Require Reset for state-defining changes.                                                             |
| High     | Challenge ambient and ratings are free editable/importable properties.                                                        | Canonical catalog variants, immutable challenge environment, model checks at load, engine/editor transitions, and protected immutable engine ownership; paid upgrades. |
| High     | Challenge metadata can be removed or manipulated after an experiment begins.                                                  | Bind the running experiment to its challenge at reset and reject incompatible project transitions.                                                                     |
| Medium   | Faults change branches only on the next solve; inspector can show pre-failure currents.                                       | Integrate the interval's energy first, then recalculate topology immediately after protection/fault transitions.                                                       |
| Medium   | Voltages across unrelated floating islands have arbitrary references.                                                         | Export node identities/islands/reference metadata and return invalid for ambiguous differential probes.                                                                |
| Medium   | Telemetry follows first matching components; replay excludes future actuator/fault state.                                     | Targeted probes with persisted definitions, timestamped fault/reset inputs and full controller-state reproduction.                                                     |
| Medium   | Synchronous fast-forward blocks the browser.                                                                                  | Time-budgeted asynchronous batches that execute every physics/control step.                                                                                            |
| Medium   | No convergence tests or reusable experiment validation summary.                                                               | Engine scenarios with independent expected values, errors, tolerances and executed reports.                                                                            |
| Low      | Duplicate copies components without their internal wiring.                                                                    | Atomic connected assembly cloning, ID/reference remapping and explicit external-link omission.                                                                         |

## Retained physical models

Electrical: V = IR, P = VI, MNA [G B; Bᵀ 0][v i] = [0 Vs], ideal wires, constant resistances and finite closed-contact resistances. Thermal: C dT/dt = P + ΣUA(Tneighbor − T) − UAambient(T − Tambient), with symmetric backward-Euler heat exchange. Water uses 1 kg/L and 4,180 J/(kg K). Dense solves are retained for modest scenes.

## Runnable milestones

A. Central edit/challenge/catalog integrity and baseline physical regression.
B. Typed acyclic signal network, measured sensors, controllers, timers/logic and actual relay contacts.
C. Independent latched cutoff, physical fault states, injection and replay.
D. Persisted arbitrary probes, multi-unit charts, node inspection and interval energy balance.
E. Orthogonal editable routing, explicit junctions, connected copy and reusable assemblies.
F. Temperature regulation, physical cooling-boundary faults, welded relay protection and manual recovery challenge.
G. Executed plausibility/convergence/integration/browser suites; production and Docker verification.

## Corrections implemented

All high-severity findings above are addressed. Engine construction is deeply frozen and detached from editor objects; replacing its project passes through the same integrity checks. State-defining changes require Reset after time advances, including sandbox inventory and undo/redo. Wiring and operational settings can change live without changing stored mass/capacity. Challenges lock initial mass/temperature, environment, available components, supply limits, budget, and catalog ratings. Purchase variants carry canonical specifications and costs (game-balancing values, not market claims). Imported files are validated and v1 migrates to v2. Loading or duplicating into a new sandbox starts a fresh experiment with no challenge award.

Failures integrate the interval's physical energy before opening branches and re-solving measurements. Signals are typed and separate from power. Disconnected electrical islands have explicit reference metadata; cross-island differential probes return invalid. Telemetry now targets persisted probes; mixed units receive separate plots. Connected copies preserve internal wires and remap internal thermal targets, omitting external links. User faults, manual safety resets, pulse inputs, and project transitions are recorded for deterministic replay.

## Models and schedule

At each 1/60 s step: read prior-boundary physical temperatures; update sensor lag/resolution/seeded optional noise; evaluate the acyclic control graph in dependency order; apply SPDT relay and independent safety contacts; solve MNA when topology/commands change; integrate all passive electrical and water thermal masses together using backward Euler; integrate net ideal-source and dissipated electrical energy; check protection, ratings, liquid-water range, and scenario conditions; re-solve any newly failed contacts; record probes at 4 Hz. Rendering never computes physics. Fast-forward executes every step in yielding batches. Cold-start contact evaluation is not a physics step.

Sensor lag uses y += (T − y)(1 − exp(−dt/τ)); zero lag directly measures T. Hysteresis retains output between lower and upper thresholds. Timers accumulate simulation seconds, quantized to a fixed step. AND/OR/NOT propagate invalid inputs; latches are reset-dominant. A thermostat uses the same sensing/hysteresis equations as separate blocks. An independent cutoff has its own sensor, latches on threshold or invalid sensing when configured, and resets manually only with a valid cool measurement. Welded contacts ignore OFF and may defeat protection. The model makes no safety certification claim.

A cooling jacket contributes UA(T − Tcoolant) to external heat exchange at its attached thermal mass. Its reservoir has fixed temperature and unlimited capacity; no pump, refrigerant work, flow, or mass transport is implied. Internal immersion transfers cancel from the total energy balance. Electrical contact losses heat their own masses. Net source energy = total thermal storage change + signed ambient/coolant heat, within numerical roundoff.

## Executed numerical evidence

The reproducible engine scenario report is [validation/latest.md](../validation/latest.md), with machine-readable [JSON](../validation/latest.json). The baseline regression and new automation/integrity tests run with `npm run test:physics`; this also regenerates the report. The report's timestamp identifies actual execution rather than proposed validation.

A 12 V / 6 Ω reference produces exactly 2 A and 24 W. The isolated 10 kg water experiment crossed 80°C with 2,508,002.595 J of water sensible heat; its 2.595 J crossing excess is below the 33.333 J maximum one-step input. Its whole-system conservation residual was 16.6 µJ. At 2,200 s, the closed-loop experiment's residual was 28.7 µJ. Cooling errors for dt = 0.1, 0.05, 0.025, 1/60 s were 4.831, 2.416, 1.208, 0.805 µK, against an independent exponential reference. Error ratio on halving dt was 1.99995, consistent with first-order backward Euler. Tolerances are documented per scenario.

## Remaining limitations

Dense MNA and thermal solves target modest circuits (100 components, 300 wires, 250 electrical unknowns); unchanged DC solutions are cached. Controls are explicitly coupled to prior-boundary temperature: response is quantized to one fixed step, and no interpolation of threshold crossings is claimed. Backward Euler is stable but first order. Ideal-source conflicts are rejected, not approximated. Timers are quantized, sensor noise is seeded, and control cycles are rejected rather than iterated. Only one injected failure mode per component is supported at a time. Ratings use documented simple duration-to-open protection, not fuse I²t curves or relay wear/arcing models.

Water remains liquid within 1–95°C; leaving that domain pauses without fabricating boiling results. No variable fluid properties, spatial gradients, wall mass, phase change, hydraulic/mechanical solver, nonlinear semiconductors, or electrical transient storage is provided. The cooling reservoir has no energy-capacity limit or power draw. Project files store construction and initial conditions, not an arbitrary running snapshot. In-session deterministic replay reconstructs reset + recorded inputs through two simulation hours; there is no scrubbing, and replay computation remains synchronous. Recorded telemetry retains one hour (14,400 points at 4 Hz), independently of the two-hour replay bound. Wire routing uses obstacle-scored candidate orthogonal paths, with manual bends for difficult scenes; it is not a full CAD autorouter.

## Challenge integrity follow-up

Browser validation exposed a passive-coasting loophole: a vessel could cool through the operating band long enough to satisfy a hold timer. Thermal Runaway now requires at least two measured-feedback relay transitions that actually change heater power before its normal-operation fault and again during recovery. Its minimum periods remain 240 s and 120 s, and may extend until an automatic cycle is demonstrated. A 5,400 s deadline bounds incomplete assignments. The control ancestry accepts either a thermal sensor or a thermostat, preserving alternative solutions. The stability score also applies `max(0, 1 − normal overshoot / 13 K)`; intentional emergency-fault heating is excluded from this overshoot penalty.

## Completed validation inventory

Final regression/integration suite: 63 tests passed. Quantitative engine scenario report: 32/32 passed. Chromium suite: 12 workflows passed, including all three playable assignments. The production TypeScript/Vite build passed and the Docker image was rebuilt for port 8080. Electrical metadata includes only real terminals; state probes resolve actual contact/Boolean output/cooler activation and propagate invalid inputs. Temperature-valued signals, Boolean outputs and dimensionless numeric constants are separated by declared units in charts and CSV.

Scenario parameters and fault/recovery scheduling live in the challenge module through a definition callback; engine solvers remain independent of assignment implementation. Safety scoring uses hypothetical electrical solves to verify that tripped protective contacts actually control heater power, without changing physical state or integrating trial energy. An unrelated unwired trip cannot earn protection credit; redundant independent contacts in series remain valid. These cases are covered by automated experiments.
