# Architecture

Physics Lab is a static single-page application (React 19, TypeScript, Vite). There is no backend: projects, presets and recovery copies live in the browser or in downloaded files. The simulation runs on the main thread, outside React.

## Principles

- **Simulation state lives outside rendering.** `Simulation` (`engine.ts`) owns all physical state; the editor store owns the simulation and the clock; React components observe through `useSyncExternalStore` and never compute physics.
- **Configuration is immutable.** The engine receives a deeply frozen, validated copy of the project. Every replacement (edit, undo, import) passes the same integrity checks (`integrity.ts`). Runtime state (temperatures, inventories, shaft speeds, controller memory, faults) is kept separately.
- **One clock.** The physics advances in fixed 1/60 s steps (or recorded adaptive steps), independent of the frame rate. Rendering and wall time never enter the equations. See [PHYSICS.md § Time integration](PHYSICS.md#time-integration).
- **SI inside.** Solvers use SI; `units.ts` converts for display.

## Source layout

### `src/simulation/`: models and engine

| Module | Responsibility |
| --- | --- |
| `model.ts` | Component catalog: kinds, typed ports (electrical, thermal, hydraulic, shaft, control), catalog variants, connection validation |
| `parameters.ts` | Parameter metadata: unit, display conversion, group, editing policy, validity domain, derived relationships |
| `presets.ts` | Built-in engineering families and validated user presets |
| `integrity.ts` | Live vs Reset-only edits, challenge locks, catalog rules, cross-parameter checks |
| `engine.ts` | `Simulation`: step scheduling, thermal solve, protection, ratings, energy ledger, telemetry, adaptive advance (`AdaptiveRun`), `FixedClock` |
| `electrical.ts`, `electrical-core.ts` | Public electrical API; union-find islands, real and complex MNA, CV/CC active set, harmonic solves |
| `linear-algebra.ts` | Scaled dense real and complex solves shared by all solvers |
| `device-circuits.ts`, `devices.ts` | Batteries, powered contactors, transformers and radiator fans as MNA branches; their accepted state and energy functions |
| `induction.ts`, `converters.ts` | Dynamic induction machine; star-delta and soft starters, variable-frequency drive |
| `filament.ts` | Tungsten filament lamp |
| `multiphysics.ts` | Coupled substeps: motor shafts, tanks, valves, midpoint Newton coupling of electrical, hydraulic and spatial loads |
| `hydraulic.ts`, `water.ts` | Hydraulic topology and network solve, pump curve, enthalpy transport, tank boundaries; water properties |
| `spatial-model.ts`, `spatial.ts` | Spatial configuration and validation; the Planck world, mechanical readings and energy |
| `automation.ts` | Typed control graph: sensors, logic, timers, PID, signal blocks, independent cutoff |
| `capabilities.ts`, `measurements.ts` | Measurement contract shared by menus, imports and runtime; probe resolution |
| `projects.ts`, `hydraulic-projects.ts`, `spatial-projects.ts`, `device-projects.ts` | Starters and challenge scaffolds; project parsing, migration and file delivery |
| `challenges.ts`, `spatial-challenges.ts`, `scoring.ts`, `learning.ts` | Assignment definitions, evaluation and scoring; mission scaffolds and guidebooks |
| `replay.ts` | Run archives and deterministic replay |
| `validation.ts`, `hydraulic-validation.ts`, `spatial-validation.ts`, `scaling-validation.ts` | Executable validation campaigns shared by tests and `scripts/` |

### `src/editor/`: editing logic without React

| Module | Responsibility |
| --- | --- |
| `store.ts` | External store: project edits, selection, undo history, clock transport, input recording, advance and replay |
| `geometry.ts` | Schematic module dimensions, terminal positions and the wire router |
| `assemblies.ts` | Duplicate, copy/paste and reusable assemblies with ID and reference remapping |
| `spatial-layout.ts` | Automatic placement of equipment housings in the Physical view |
| `engineering.ts` | Engineering-notation number entry and display |
| `webmcp.ts` | Optional browser tool registration (feature-detected WebMCP) for structured access to lab actions |

### `src/components/`: user interface

`Workspace.tsx` (schematic SVG), `PhysicalView.tsx` (spatial view, tools and inspector), `Inspector.tsx` and `ParameterEditor.tsx`, `Library.tsx`, `Telemetry.tsx` (charts, events, energy balance), `Challenges.tsx` and `Learning.tsx` (assignments, example shelf, guidebooks), `Models.tsx` (in-app model reference), `ErrorBoundary.tsx` (per-pane recovery). `src/theme/` holds the design tokens; see [DESIGN.md](DESIGN.md).

## Clock and editor loop

The store runs a fixed-step accumulator on `requestAnimationFrame`. Each frame adds elapsed wall time × speed, capped at 0.25 s, and executes whole 1/60 s steps within a 12 ms work budget; an overloaded scene slows the simulation clock rather than changing the step. Pause clears the accumulator. Instrument updates are throttled to 20 Hz.

Long advances and replays run in yielding batches, so the browser stays responsive and every step is still executed. Reset restores the project's initial conditions, clears faults and measurements, and starts a new replay origin.

## Editing

- **History:** up to 60 immutable project snapshots for undo and redo.
- **Live vs Reset edits:** live parameters may change at any time without injecting energy; parameters that define stored energy, mass, geometry or initial state are rejected after t = 0 until Reset. See [SANDBOX.md](SANDBOX.md).
- **Assemblies:** duplicate, copy/paste and saved assemblies remap component IDs, internal connections, routes, sensor targets and joints; external links are omitted.
- **Limits:** 100 components, 300 connections, 100 joints, 250 electrical unknowns per island, 120 hydraulic branches and 200 hydraulic nodes. Dense direct solves are appropriate at this size.

### Wire routing

`routeAll()` in `geometry.ts` routes all wires of a project on a sparse orthogonal grid built from module bounds, terminal and stub coordinates and lanes in wide channels:

- wires leave each terminal in the direction it faces (a short stub, rotation-aware) and avoid module bodies, captions and foreign terminals;
- A* over (node, heading) penalizes bends, crossings, running along wires of other nets, and passing obstacles; wires of one net (union-find over terminals) may share a lane;
- searches run in a bounded window first, then a wider one, then with soft obstacles; each search is capped;
- wires are routed shortest first, without rip-up;
- results are memoized per (components, connections) pair, so dragging re-routes only when the project changes.

Hand-placed bend points override the router for one wire and stay at absolute positions when modules move. Wires are drawn a second time clipped to module bodies, so a wire that does cross a module stays visible.

## Persistence

- **Projects** are versioned JSON (`version` 3 for schematic projects, 4 with spatial geometry). Versions 1–4 load; older files migrate by filling catalog defaults. Imports validate counts, IDs, ports, property domains, dependencies and challenge integrity, and reject unknown properties by name. Files are limited to 2 MB.
- **Run archives:** Save after running writes the validated origin, timestamped inputs (edits, faults, resets, pulses, impulses, adaptive advances) and duration. Import replays them through the current engine to rebuild every dynamic state; imported scores are never trusted. Archives hold up to 30 simulated days and 5,000 inputs. **File → Export scenario configuration** writes the initial model only.
- Replay is deterministic within the same runtime; cross-platform bitwise identity is not guaranteed. There is no timeline scrubbing.
- A labelled recovery copy and user presets use `localStorage`. Telemetry exports as CSV.
- **Telemetry** keeps the whole run: above 14,400 samples the history is decimated and the sample interval doubles.

## Deployment

`npm run build` produces a static bundle in `dist/`. The Docker image (`Dockerfile`, `compose.yaml`) builds it with Node and serves it with nginx on port 8080. Releases deploy tags through `scripts/deploy.sh`; see [WORKFLOW.md](WORKFLOW.md).

## Extension points

- A Web Worker for the simulation becomes worthwhile only if measured scene cost demands it; every caption, probe and inspector field would then read results asynchronously.
- Spatial fluids, moving equipment with fluid inventory and damage models would need a conservative mass, momentum and energy exchange between the hydraulic network and the rigid-body world.
