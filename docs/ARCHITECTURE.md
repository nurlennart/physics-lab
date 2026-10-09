# Architecture

## Modules

| Module                     | Responsibility                                                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `simulation/model.ts`      | Component definitions, SI properties, explicit electrical/thermal ports, connection validation                   |
| `simulation/electrical.ts` | Wire union-find, circuit islands, modified nodal analysis, pivoted matrix solve, calculated readings             |
| `simulation/engine.ts`     | Deterministic simulation state, coupled thermal solve, protection, energy integration, telemetry and diagnostics |
| `simulation/challenges.ts` | Assignment data, declarative metric rules, transparent scoring                                                   |
| `simulation/projects.ts`   | Starters, version 1 schema validation, JSON and CSV file delivery                                                |
| `simulation/replay.ts`     | Reproducible reset and timestamped editor-input playback                                                         |
| `editor/store.ts`          | External React store, project edits, selection, history, clock transport and input recording                     |
| `editor/webmcp.ts`         | Optional browser-native structured access to existing laboratory actions                                         |
| `components/Workspace.tsx` | SVG schematic rendering, pan/zoom, placement, selection, terminal interaction and routing                        |
| `components/Inspector.tsx` | Editable model properties and calculated component instrumentation                                               |
| `components/Telemetry.tsx` | Actual recorded measurements, events, chart channels and energy balance                                          |

## State and clock

Project construction and initial conditions are separate from the mutable `Simulation` class. React never calculates physics. The external editor store owns the simulation and a fixed-step accumulator; React observes its state through `useSyncExternalStore`.

The simulation advances at 1/60 s with an independent render loop. Instrument updates are throttled to 20 Hz; SVG dragging updates on input, and flow indicators use CSS. Slow frames have bounded catch-up: at most 0.25 wall-clock seconds are accumulated per frame. Speed multiplication changes the number of steps, never timestep size. Pause clears the accumulator. Reset restores the current project's initial conditions, clears faults and measurements, and creates a new replay origin.

Per step: solve the electrical network; construct and solve the coupled thermal matrix; integrate energy; evaluate physical limits and failure timers; update challenge metrics; record telemetry. Component failures take effect as open branches on the next electrical solve. The editor runs challenge rules after steps and pauses at completion.

## Ports and coupling

Electrical ports exchange node potentials and branch currents through the circuit equations. Ideal wires union nodes; resistive branches and voltage sources join circuit islands. All ground components share one zero reference; otherwise each independent island uses a local reference.

Thermal connections explicitly link one immersion heater to one water tank. Multiple heaters may share a tank. Passive electrical dissipation enters a thermal mass once. Coupled heat transfer is stamped symmetrically into one thermal matrix, ensuring equal-and-opposite exchange. No visual connection has an unimplemented physical domain.

## Editing and persistence

History stores at most 60 immutable project snapshots. Duplicate/copy/paste creates independent components; wires are deliberately not copied. Routing is orthogonal, selected connections can be deleted, and connections validate both endpoint domains and immersion compatibility.

Version 1 projects include identity, name, components, connections, initial properties, and optional challenge ID. Imports enforce component counts, wire counts, finite bounded properties, unique IDs, valid ports, duplicate-wire rules, tank capacity and immersion compatibility. Future schemas must add explicit migrations before accepting a different version. Projects download as JSON. A labeled device recovery copy uses browser storage; it is not cloud persistence. Telemetry exports as CSV.

Replay stores editor project snapshots with simulation timestamps and reconstructs the final state by resetting the origin and executing identical fixed steps and inputs. Same-timestamp edits coalesce. Replay supports up to one simulation hour. It does not promise arbitrary timeline scrubbing or persistent recorded runs across reloads.

## Limits and tradeoffs

100 components, 300 connections, 250 electrical unknowns per island; newest 2,400 measurements and 300 log events retained. Dense matrix solves are appropriate at this scene size. Typed arrays, sparse solvers, workers, WASM, and GPU rendering should be introduced only after profiling demonstrates a bottleneck.

No Rust, WebGPU, or mechanical engine is introduced for the initial electrical/thermal slice. A future hydraulic solver can introduce pressure/flow ports and conserved fluid volumes; a mechanical solver should use an established rigid-body engine. These are architectural extension points, not claimed capabilities of this build.
