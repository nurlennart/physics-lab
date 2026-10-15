# Thermal Spaces: architecture review and proposed first version

Status: the first version is implemented; see [user/model documentation](THERMAL-SPACES.md). The sections below retain the approved design and its rationale.

Baseline investigation: an untouched archive of HEAD passed all 45 files / 820 tests with a single fork (712.63 s). Small tests and the 157-test environment suite passed in both fork/thread modes. Full runs could remain at the banner while long files completed; verbose diagnostics reveal per-test progress. No hard module-loading deadlock was established. Concurrent CPU-heavy campaigns caused wall-clock timeouts on this small host; a single fork and serial campaign reruns provide a reproducible verification path. The sandbox additionally prevented the browser preview server from binding its local port; browser tests run with that restriction lifted. Assertions, physics tolerances and existing per-test timeouts were preserved.

Implementation choices: the metre mapping is a fixed schema-level constant (100 schematic coordinates/m), rather than a per-project adjustable scale. Exact frozen-coefficient unit responses eliminate hydraulic variables into the shared room/body system, reusing transport. Shared partition construction is explicit; replacing two exterior surfaces requires removing the redundant exterior element. Mechanical contact losses and shaft exports retain their existing external-ledger semantics. See the verification report and benchmark for tested behaviour and remaining duration costs.

## Existing architecture

| Area | Existing implementation | Reuse and required extension |
| --- | --- | --- |
| Simulation lifecycle | `src/simulation/engine.ts`: `Simulation.reset`, `refresh`, `step`, `AdaptiveRun` | Keep one engine, simulation clock, validation path and accepted-state lifecycle. Add room initialization, checkpointing, measurements and thermal-rate limits. |
| Multiphysics | `src/simulation/multiphysics.ts`: accepted substeps after electromechanical trial solves; checkpoint/rollback; boiler and circulator events | Room exchange must participate in accepted thermal advancement. Trial evaluations must never accumulate room energy. |
| Component thermal network | `engine.ts`: backward-Euler capacity/conductance matrix, component body losses and thermal-port links | Add room nodes and replace inherited fixed-temperature loss boundaries with conservative links to those nodes. |
| Hydraulic thermal network | `src/simulation/hydraulic.ts`: `transport`, inventory cells, affine branch relations, mixing and heat exchangers | Extend affine relations to room-temperature unknowns and expose signed exchange by component. Retain existing water transport and inventory equations. |
| Kermi radiator | `src/simulation/panel-radiator.ts`: EN 442 law, 16 water/steel cells, start-state conductance and exponentially fitted exchange weights | Preserve calibration, capacities, reverse-flow and stagnant cooling. Route the exact exchange already used in cell balances to the room. |
| Ambient environment | `src/simulation/environment.ts`: explicit override, optional space argument, experiment default | The space argument is currently only a placeholder. Introduce explicit membership and live simulation context; update every solver and display consumer. |
| Project model | `src/simulation/model.ts`: components, connections, probes, optional mechanical world and experiment ambient | Add typed space and envelope records, separate from ordinary schematic components and mechanical bodies. |
| Validation/editing | `src/simulation/integrity.ts`, `parameters.ts`, `projects.ts` | Extend both import validation and engine transition validation; include room configuration in reset-sensitive signatures. |
| Canvas | `src/components/Workspace.tsx`, `src/editor/geometry.ts` | Reuse SVG camera, pointer capture, snapping, undo gestures. Add background regions, a draw tool and room-specific move/resize gestures. |
| Inspector/telemetry | `Inspector.tsx`, `ParameterEditor.tsx`, `Telemetry.tsx`, `capabilities.ts`, `measurements.ts` | Reuse charts and sample storage. Extend target resolution beyond components; add room properties, readings and probe controls. |
| Persistence/replay | `projects.ts`, `src/simulation/replay.ts`, `src/editor/store.ts` | Preserve validated configuration and deterministic input replay. Rooms must be included in recorded project edits, not restored from unvalidated runtime snapshots. |

`Simulation.step` currently evaluates controls, advances coupled electrical/mechanical/hydraulic state, then solves component body temperatures once over the outer interval. It books supplied, stored and ambient energy and checks the global residual. `Multiphysics.advance` can subdivide that interval at events and storage limits; hydraulic cells and boiler elements advance there. This split is significant for room integration.

Temperature conventions are mixed but explicit: component body temperatures and configured ambient temperatures are Celsius; transported water, radiator cells and boiler element state are Kelvin. Heat capacities are J/K, conductances W/K, powers W and cumulative exchanges J. New APIs must identify temperature units and convert at existing boundaries.

## Physical data model

Introduce a new project schema version, read versions 1–4 unchanged, and migrate older files to empty thermal-space collections. Do not infer membership on load from coordinates or reinterpret existing mechanical geometry.

Proposed project additions:

- `thermalSpaces`: stable ID, name, plan position, width/length/ceiling height in metres, initial temperature in °C, effective added capacity in J/K, air exchange configuration and optional building/floor identifiers.
- `thermalElements`: stable ID, kind (wall/window/door/floor/ceiling), explicit endpoints (space-to-outdoor or space-to-space), area in m², U-value in W/(m²·K), optional construction preset provenance and effective capacity in J/K.
- `Component.thermalSpaceId`: optional explicit membership; absence means outside. Do not put membership into the numerical `props` bag or derive it during stepping.
- A persisted thermal-plan scale, initially 100 schematic coordinate units per metre. Camera zoom does not change it. Room width/length determine rendered bounds through this mapping; schematic component symbols remain schematic symbols, not scaled equipment footprints.

Configuration and runtime state remain separate. Runtime room state includes current temperature, capacity, cumulative storage change, accepted heat exchanges and step-average measurements. Rendering derives colours/arrows from readings; it never changes physical state.

Validate finite values, positive dimensions/capacity, nonnegative U-values/airflow/areas, bounded collection sizes, unique IDs and valid references. Reject self-adjacency, missing endpoints, duplicate ownership of an interior partition, invalid opening parents and openings larger than their parent surface. Do not silently clamp malformed input.

Use canonical shared elements for partitions: one interior wall record connects two room IDs. Both inspectors show the same record. A wall touching another region on screen does not itself establish thermal adjacency.

An opaque wall stores gross area and its window/door children. Its conductive area is gross area minus all opening areas. Each opening has its own U-value and follows the parent's endpoints. Rectangular perimeter walls derive gross areas from room dimensions; floors and ceilings derive from floor area. Manual area overrides remain explicit and inspectable. Resizing must validate existing openings before committing the gesture.

Optional element capacity is an effective contribution to the room node, not a simulated wall temperature. Exterior elements allocate it to their room; shared elements allocate half to each endpoint. Total added room capacity excludes these separately listed contributions, so no mass is counted twice. Detailed wall storage and delayed conduction are outside v1.

## Room equations and assumptions

For a rectangular room:

```
A_floor = width × length                       [m²]
V = A_floor × ceilingHeight                     [m³]
C_air = rho_air × cp_air × V                    [J/K]
C_eff = C_air + C_added + C_element_allocations  [J/K]
G_surface = U × A_net                           [W/K]
G_vent = rho_air × cp_air × airflow              [W/K]
airflow = ACH × V / 3600                        [m³/s]
```

Use documented constant dry-air assumptions, initially rho = 1.2 kg/m³ and cp = 1005 J/(kg·K). They are model assumptions, not weather-dependent air-property calculations. Support either ACH or explicit m³/s as the configured ventilation mode; do not add both accidentally.

```
C_eff × dT_i/dt = Q_devices + Q_internal
                 + sum(G_ij × (T_j - T_i))
                 - sum(G_out × (T_i - T_out))
                 - G_vent × (T_i - T_out)
```

The room has one well-mixed temperature shared by air and effective contents. The additional mass is a user-specified *effective* capacity coupled instantaneously to this node. Offer editable light/medium/heavy assumptions with their numerical basis; do not claim they predict a specific building's construction.

At constant source power and total exterior conductance G, the analytical reference is:

```
T_eq = T_out + Q/G
T(t) = T_eq + (T_initial - T_eq) × exp(-G × t/C_eff)
```

For G = 0, T(t) = T_initial + Q × t/C_eff. Stored energy must name its datum: show both C_eff × (T - 0 °C) and the storage change C_eff × (T - T_initial) if needed; use the latter in the existing change-based system ledger.

Outdoor temperature defaults to `project.environment.ambient`, preserving the current global field and old projects. A room may explicitly override its outdoor boundary. This boundary is distinct from its initial air temperature and from component ambient overrides. Floors may target another space or the selected outdoor boundary; ground-temperature modelling is deferred.

## Generic exchange contract

Extend the ambient resolver to return a boundary identity as well as temperature and source. Its resolution order is:

1. Explicit component ambient override.
2. Explicitly assigned Thermal Space, using its live state or current implicit unknown.
3. Global experiment environment.

A local ambient override represents a prescribed external reservoir. Its heat stays attributed to that reservoir, even if the component is visually inside a room. The Inspector must make this bypass visible. Charging a room while holding the component against an unrelated fixed temperature would be inconsistent.

Use one generic signed exchange representation: source component/interface, receiving environment, accepted energy in J, and derived average power in W. Positive energy heats the environment; negative energy cools it. The interface also supplies conductance/affine response terms for implicit coupling. It must support multiple interfaces per future device, since a heat pump can exchange with different environments.

Adapters report their actual existing exchange:

- Thermal bodies: `UA × (T_body_accepted - T_environment_accepted) × h`, rather than electrical input power. Retain energy stored in the body and transfer through thermal ports.
- Kermi panels: sum the exact weighted cell exchange already entering the hydraulic balance. Water heat input differs from room heat output during storage transients; `heatInput` must not be used as room output.
- Generic hydraulic radiators, inventory pipes and boiler jacket losses: the existing transport exchange. A pipe needs explicit component membership; wires or hydraulic connections crossing a room have no exchange interface.
- Wet-rotor circulators: existing motor/hydraulic losses enter water and later reach the room through a real exchange path. Do not also book these as room gains. Existing dry/no-flow loss paths need their own destination attribution.
- Boiler auxiliary power, radiator fan heat, external drive braking losses and other direct ambient terms: audited explicit exchanges, preserving their current physical ownership.
- Batteries, motors, converters and supplies with body storage: use body-to-environment exchange, never rated/nameplate power or total useful output.

Provide an explicit internal heat-source model for occupants or equipment without an existing detailed device. Its configured power is declared external input and enters the supply ledger. Do not attach free nominal heating gains to arbitrary components.

The contract allows future underfloor circuits and heat pumps; their absence as existing component models must not be disguised by generating room heat from their names. Existing temperature sensors should target a room through the same target-capability abstraction used by telemetry.

## Numerical integration and conservation

Do not add an independently ticking room calculator. Extend the existing backward-Euler thermal assembly and hydraulic affine elimination, using the current linear solver.

For room i over accepted interval h:

```
(C_i/h + G_out_i + G_vent_i + sum(G_ij)) × T_i_new
  - sum(G_ij × T_j_new)
  = C_i/h × T_i_old + (G_out_i + G_vent_i) × T_out
    + Q_internal + Q_devices(T_new)
```

Body-to-room links contribute equal/opposite rows. Hydraulic branches currently have affine outlet responses to inlet temperature at fixed ambient. Extend those responses to include room unknowns, and eliminate hydraulic mixer/cell variables into the room/body matrix (a Schur complement), then back-substitute. Alternatively retain those variables in the shared assembly; the chosen representation must reproduce the existing transport equations exactly. This reuses transport rather than approximating radiator output in a second solver.

Keep Kermi conductance/weight evaluation at the interval's start state as today. The current interval's exchange temperatures use the solved room temperature. This preserves the established first-order nonlinear linearisation and calibration.

Reconcile the outer body solve with hydraulic substeps: thermal participants coupled through a room must advance over common accepted intervals, with component losses integrated once. Extract the existing body matrix assembly into reusable engine thermal assembly and invoke it at those intervals for space-enabled projects. The no-space path must remain numerically equivalent to existing behaviour. Never advance bodies once in a substep and again in the outer step.

Every trial starts from the same checkpoint. Only a successful coupled result commits room, body, fluid, boiler, devices and ledger state. Extend rollback to include room readings, cumulative exchanges and adaptive-rate state. A failed solve must leave time and all accepted energy/state unchanged. Zero-duration refresh computes readings without integrating.

Room-to-room exchange is computed once as h × G_ij × (T_i_new - T_j_new), debited from i and credited to j. Component-to-room exchange is likewise internal: it leaves component storage and enters room storage. Only envelope/ventilation exchange, overridden reservoirs and genuine exports enter external ambient energy. Do not add room heat output on top of the already booked hydraulic ambient total.

Extend `storedEnergy` with room storage change and provide a room subtotal in the energy panel. Keep supplied-energy and global residual semantics and existing tolerances. Heating disabled or failed stops new input but does not erase stored radiator/water/body heat.

Include room temperature rate in adaptive limits. Large steps remain bounded by existing electrical, mechanical, hydraulic, controller and boiler constraints. Backward Euler is stable for passive networks, but stability does not imply accurate timing: check timestep convergence and event handling separately.

## Canvas and membership

Render room fills first, below wires and modules, inside the existing SVG camera transform. Use theme tokens, thin boundaries, muted temperature tint, room name/temperature and dimensions. Expose move/select on the boundary/header and resize on selected handles; interiors have no pointer interception. Keep ordinary background marquee/pan and terminal wiring interactions.

Add an explicit draw-room tool. Its snapped drag yields metre dimensions via the persisted plan scale. Include room bounds in fit-to-content and support reverse-direction drawing. The region is a thermal plan, separate from the existing vertical mechanical physical view and its gravity coordinates.

In Build mode, dropping an eligible component into exactly one room proposes and commits explicit membership in the same undo transaction; dropping it outside clears membership. Show the assigned room in the component Inspector, with an explicit manual assignment option. Manual assignment can be pinned so later schematic rearrangement preserves it. Overlapping rooms must not choose a thermal destination by render order; keep the previous membership or require explicit selection. Reconcile geometry-based membership only at gesture completion, never during the solver or on every pointer move.

A room move/resize is a region edit; equipment moves only when explicitly selected with it. Reconcile unpinned membership at gesture completion and show resulting assignments. Membership is based on component centre, consistently documented. Connections are not members. Do not auto-assign pipes unless the user explicitly enables their membership; their configured UA remains meaningful outside a room as before.

After time advances, geometry/capacity/initial-temperature edits require Reset to Build. Presentation moves and explicit reassignment can remain live only when they preserve all current temperatures and capacities, record a deterministic boundary-change input and do not auto-reassign silently. Room creation/deletion is reset-sensitive. Deletion in Build clears memberships, related probes/sensor targets and shared-element references in one validated undoable transaction.

## Inspector, telemetry and persistence

Use a room Inspector branch with clearly separated configuration and accepted results. Configuration includes geometry, initial temperature, added capacity, ACH/airflow, outdoor boundary and element records. Results include air/outdoor temperature, floor area/volume, effective capacity, device/internal/adjacent input, envelope/ventilation loss, net flow, accepted rate of temperature change and stored energy.

Optional overlays use the same accepted interface/element readings for device gains, individual surface losses, inter-room exchange, temperature differences and stored energy. They remain display preferences.

Extend probes with a discriminated space target while preserving existing component probe files. Generalize target resolution in capabilities, `readProbe`, unit/label formatting, probe validation and telemetry selectors. Reuse sampled `values`, unit-based plotting and CSV export to compare rooms. Extend sensor target validation/readings so controllers can use actual room temperature. Update Kermi Inspector, module face, parameter hints and sample `panelTemperatures.air` to resolve live room ambient consistently.

Keep ordinary save/load as validated configuration with initial states. Keep saved live runs as origin plus timestamped inputs and deterministic adaptive advances. Replaying reconstructs room state, membership changes and energy; importing a room-temperature snapshot must not bypass replay validation.

## Existing limitations requiring explicit work

1. Ambient resolution accepts a future space temperature but knows neither membership nor runtime state. Updating only this function's default argument would miss solver and display consumers.
2. `transport` returns one aggregate ambient exchange. Per-interface destination attribution and an implicit room response are needed; summing radiator nominal output is insufficient.
3. Body temperatures and water inventories currently advance at different lifecycle levels. A common accepted thermal interval is necessary for robust finite-environment coupling.
4. The global environment is an ideal unlimited reservoir. No room storage, envelope graph, ventilation or geometry-to-metres mapping exists.
5. Component/probe/sensor selection assumes component IDs. Rooms require explicit target support, rather than fake components added only to satisfy selectors.
6. Project versions currently stop at 4. Import validation, transition signatures, challenge restrictions, assembly handling and run-history parsing need coordinated extension. Rooms must not open a way to alter scored challenge environments.
7. Boiler presence caps adaptive steps at 0.1 s and coupled boiler substeps at 0.1 s. Multi-hour examples need performance measurement. Preserve the cap initially; any optimization must retain stage/protection event accuracy and receive separate validation.
8. The mechanical view's wall/floor material metadata explicitly does not create thermal links. Do not repurpose it as a building envelope or interpret mechanical y as a plan-floor coordinate.
9. The Kermi model includes a radiant-share display but no radiative surface network. V1 sends its total output into the effective zone node and states that assumption.
10. Telemetry supports at most 24 probes and progressively decimates long histories after 14,400 samples. Room comparisons use those existing limits; full-resolution multi-day archival is a separate feature.

## Implementation and verification sequence

1. Establish baseline typecheck/tests and record failures before runtime edits.
2. Add typed schema, validation/migration, reset policy and explicit boundary resolution.
3. Extract reusable thermal assembly; add zone capacity, envelope/ventilation and canonical adjacency equations.
4. Add generic exchange attribution and implicit transport coupling; commit/checkpoint all affected state together.
5. Integrate Kermi unchanged, then body and direct-ambient adapters; preserve outside-room behaviour.
6. Add draw/move/resize, explicit membership, Inspector and telemetry/sensor targets through existing editor actions.
7. Add two complete examples from the current Bosch/ALPHA2/Kermi circuit: a 5 × 4 × 2.5 m insulated room at 15 °C with 0 °C outdoors; and a timed shutdown using existing controller/switch inputs followed by cooling. Document effective mass, all areas/U-values and expected time constants. Select gain/loss values that the actual radiator can support; the boiler's 9 kW rating is not room heat input.
8. Run analytical, conservation, regression and browser campaigns, including the complete existing release gate.

Required new tests:

- Independent checks of air capacity, UA, ACH conversion, opening subtraction and capacity allocation.
- Isolated room constant-power heating, no-source exponential cooling and loss-free linear heating; timestep convergence to analytical references.
- Two unequal-capacity rooms: constant total stored energy, equal/opposite exchange, convergence to capacity-weighted equilibrium and no overshoot with large admissible steps.
- Closed hot radiator/room exchange: fluid/steel storage loss equals room storage gain; flowing, stagnant, reversed, cooling and post-shutdown cases.
- Body heat storage versus room output; wet-rotor losses counted only in water; explicit override exchange bypasses the room.
- No-space Kermi, boiler, environment, solar/hybrid, mechanical and electrical regression suites without relaxed tolerances.
- Repeated trial/refresh calls, forced solve failure and rejected edits do not change accepted room energy or component state.
- NaN/Infinity, missing/duplicate references, invalid openings, overlapping-region assignment, disabled/faulted input and reset-sensitive edits.
- Old/new project round trips, undo/redo, deletion, configuration saves, deterministic fixed/adaptive saved-run replay and sensor/probe validation.
- Browser drawing at different zoom/pan, move/resize dimensions, empty canvas selection, wiring over room interiors, terminals near boundaries, assignment/reassignment, Inspector edits, multi-room charts, timed shutdown and save/reload.

The existing release gate is `npm run check`: typecheck, Vitest, physics/scaling/score/preset/shaft/solar/hybrid campaigns, production build and production-browser tests. Add thermal validation and run example/radiator/coupled campaigns explicitly where they are not already included. Do not treat a partial campaign as a complete release pass.
