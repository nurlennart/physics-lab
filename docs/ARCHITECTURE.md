# Architecture

The shared spatial identity, Planck engine, bidirectional shaft solve, scheduling and version 4 persistence are documented in [Phase 3A](PHASE3A.md). The original electrical/thermal/hydraulic architecture below remains in use.

## Modules

| Module                     | Responsibility                                                                                                         |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `simulation/model.ts`      | Component definitions, SI properties, typed electrical/thermal/control ports, connection validation                    |
| `simulation/electrical.ts` | Wire union-find, circuit islands, modified nodal analysis, pivoted matrix solve, calculated readings                   |
| `simulation/engine.ts`     | Deterministic simulation state, coupled thermal solve, protection, energy integration, telemetry and diagnostics       |
| `simulation/challenges.ts` | Assignment data, scenario callbacks/configuration, measured-feedback/causal-protection evaluation, transparent scoring |
| `simulation/projects.ts`   | Starters, v1→v2 migration and validated project schema, JSON and CSV file delivery                                     |
| `simulation/replay.ts`     | Reproducible reset and timestamped editor-input playback                                                               |
| `editor/store.ts`          | External React store, project edits, selection, history, clock transport and input recording                           |
| `simulation/parameters.ts` | Parameter metadata (unit, group, policy, validity domain, display conversion), derived relationships, actual resistance, calculated readouts |
| `simulation/presets.ts`    | Built-in engineering families and validated user presets (definition → instance configuration; runtime state stays in the engine) |
| `simulation/scaling-validation.ts` | Executed scale campaign (Experiments A–E, scaling matrices) shared by tests and `scripts/validate-scaling.mjs` |
| `components/ParameterEditor.tsx` | Grouped engineering Inspector: engineering-notation inputs, lock reasons, ratings bars, calculated values, presets, environment |
| `editor/webmcp.ts`         | Optional browser-native structured access to existing laboratory actions                                               |
| `components/Workspace.tsx` | SVG schematic rendering, pan/zoom, placement, selection, terminal interaction and routing                              |
| `components/Inspector.tsx` | Editable model properties and calculated component instrumentation                                                     |
| `components/Telemetry.tsx` | Actual recorded measurements, events, chart channels and energy balance                                                |

## State and clock

Project construction and initial conditions are separate from the mutable `Simulation` class. React never calculates physics. The external editor store owns the simulation and a fixed-step accumulator; React observes its state through `useSyncExternalStore`.

The simulation advances at 1/60 s with an independent render loop. Instrument updates are throttled to 20 Hz; SVG dragging updates on input, and flow indicators use CSS. Slow frames have bounded catch-up: at most 0.25 wall-clock seconds are accumulated per frame. Speed multiplication changes the number of steps, never timestep size. Pause clears the accumulator. Reset restores the current project's initial conditions, clears faults and measurements, and creates a new replay origin.

Per step: read temperature sensors; evaluate the typed acyclic control graph on simulation time; apply relay and safety contacts; solve/cache DC MNA; solve the coupled thermal matrix; integrate energy; evaluate ratings and limits; immediately re-solve failed branches; update challenge state; record targeted probes. The editor runs challenge rules after steps and pauses at completion.

## Ports and coupling

Electrical ports exchange node potentials and branch currents through the circuit equations. Ideal wires union nodes; resistive branches and voltage sources join circuit islands. All ground components share one zero reference; otherwise each independent island uses a local reference.

Thermal connections explicitly link one immersion heater to one water tank. Multiple heaters may share a tank. Passive electrical dissipation enters a thermal mass once. Coupled heat transfer is stamped symmetrically into one thermal matrix, ensuring equal-and-opposite exchange. No visual connection has an unimplemented physical domain.

## Editing and persistence

History stores at most 60 immutable project snapshots. Duplicate/copy/paste remaps independent component IDs, internal connections, routes and sensor targets. External wires and thermal targets are omitted; saved reusable assemblies follow the same rule. Routing is orthogonal, selected connections can be deleted, and connections validate both endpoint domains and immersion compatibility.

Version 2 projects include routes, probes, reusable assemblies, model variants, identity, name, components, connections, initial properties, and optional challenge ID. Imports enforce component counts, wire counts, finite bounded properties, unique IDs, valid ports, duplicate-wire rules, tank capacity and immersion compatibility. Version 1 files migrate with validated catalog defaults. Projects download as JSON. A labeled device recovery copy uses browser storage; it is not cloud persistence. Telemetry exports as CSV.

Replay stores editor project snapshots with simulation timestamps and reconstructs the final state by resetting the origin and executing identical fixed steps and inputs. Adjacent same-timestamp project edits coalesce without discarding fault/reset inputs. Replay includes fault injections, wire faults, manual latch resets, controller states and pulse commands, and supports up to two simulation hours. It does not promise arbitrary timeline scrubbing or persistent recorded runs across reloads.

## Sandbox editing policy

Free Sandbox edits are validated by parameter metadata (`parameters.ts`). Live parameters are conservation-safe at any time. Reset parameters define stored energy, mass or initial state, and the engine's `physicsSignature` rejects them after t = 0. Calculated parameters are recomputed by `applyDerived` on every edit and import. Challenge projects keep the original catalog-locked sets in `integrity.ts`. Thermal/electrical/control experiments can advance with `AdaptiveRun` (event-aware, recorded for replay). See [SANDBOX.md](SANDBOX.md).

## Limits and tradeoffs

100 components, 300 connections, 250 electrical unknowns per island; newest 14,400 measurements and 500 log events retained. Dense matrix solves are appropriate at this scene size. Typed arrays, sparse solvers, workers, WASM, and GPU rendering should be introduced only after profiling demonstrates a bottleneck.

No Rust, WebGPU, or mechanical engine is introduced for the initial electrical/thermal slice. A future hydraulic solver can introduce pressure/flow ports and conserved fluid volumes; a mechanical solver should use an established rigid-body engine. These are architectural extension points, not claimed capabilities of this build.

## Phase 2 modules and extension interfaces

`automation.ts` owns typed valid/invalid signals, sensor filtering, controller/timer/latch memory, contact commands and fault state. `integrity.ts` centralizes live controls, Reset-only physical configuration, challenge environment and paid model rules. `measurements.ts` resolves explicit branch or node/reference probes into values with invalid-state propagation. `editor/assemblies.ts` and `editor/geometry.ts` implement independently testable construction operations. `validation.ts` runs complete engine experiments and generates quantitative results via `scripts/validate-physics.mjs`.

Engine project state is deeply frozen and detached from editor state. Project replacements and editor/history/import boundaries enforce integrity; physics steps operate on that validated immutable construction. Real time and rendering cannot advance controllers during pause. Fast-forward yields between 12 ms batches without skipping fixed steps. Relay contacts have resistance/thermal mass, independent cutoff sensing never uses the ordinary controller's output, and a cooling jacket couples an ideal reservoir through thermal conductance.

New conserved hydraulic quantities can use the same simulation-clock sensor/control/measurement interfaces. A future hydraulic solver should add mass and advected enthalpy accounting to the scheduler explicitly; current cooling is only a thermal boundary and must not be advertised as fluid dynamics. See PHASE2-AUDIT.md for the full equations, response quantization and limitations.

## Phase 2B extension

The existing engine now owns `Multiphysics` runtime beside temperatures and automation. `hydraulic.ts` separates terminal topology, monotone branch laws, damped pressure solve, inventory events and enthalpy transport from rendering. `multiphysics.ts` solves motor back EMF through existing MNA and pump torque through implicit midpoint shaft equations. `units.ts` centralizes new SI/display conversion. The outer clock, editor, automation DAG and probes are shared across all domains. Version 3 scenarios migrate older configurations; separate run archives restore dynamic state through validated replay. See [Phase 2B model and scheduling documentation](PHASE2B.md).
