# Phase 3A — shared spatial engineering

The existing simulation and schematic editor are extended, not replaced. A Physical view renders the same component identities and evolving electrical, thermal, hydraulic and control states. New geometry and constraints are solved by pinned **Planck 1.4.2**, the mature Box2D JavaScript/TypeScript engine. Its synchronous API fits the existing Node 22/browser solver, tests and replay. Current Planck 1.5 requires Node 24. Rapier was considered; its asynchronous WASM initialization would require a larger lifecycle change. Primary engine documentation: [Planck](https://piqnt.com/planck.js/docs/), [World API](https://piqnt.com/planck.js/docs/api/classes/World.html), [Body API](https://piqnt.com/planck.js/docs/api/classes/Body.html); alternative [Rapier initialization](https://rapier.rs/docs/user_guides/javascript/getting_started_js/).

## Architecture and authoritative state

- `model.ts`: existing stable component IDs, engineering configuration and typed electrical/control/thermal/hydraulic/mechanical terminals. Four added catalog entries: rigid body, position sensor, shaft-speed sensor and force/brake actuator. There are 39 catalog kinds and nine challenges.
- `spatial-model.ts`: optional component spatial configuration, project world/joints, SI units, materials, geometry/reference validation and explicit future fluid exchange contract.
- `spatial.ts`: one Planck world per `Simulation`; authoritative dynamic body/joint/contact readings, mass/inertia, snapshot adapters and mechanical energy ledgers. No React state advances physics.
- `multiphysics.ts`: MNA/shaft/pump integration extended to solve spatial shaft loading bidirectionally. `automation.ts` remains the single control graph.
- `PhysicalView.tsx`: tools, SVG camera, body and joint inspectors, construction handles, measurement and diagnostic overlays. UI camera/selection/overlays are rendering state, independent of SI geometry.
- `projects.ts`, `replay.ts`, editor store and assemblies: validated v4 geometry/joint persistence, stable reference remapping, shared undo/redo, recorded operational inputs and accounted impulses.

Schematic x/y remain pixels. Spatial x/y are metres with positive y upward; angles and angular velocity are radians/radians per second. SVG world-to-screen uses `(cameraX + scale*x, cameraY - scale*y)`, with scale in px/m. Pan/zoom never changes mass, pipe length or physics. Grid snap is 0.1 m; origin, scale and two-point distance measurement are visible. Convex polygon vertices are local metres, not normalized dimensions.

Engineering equipment (motor, pump, tank, heater, cooler, source, resistor, lamp, pipes and valves) may have optional **static housing bodies** with the same IDs. Abstract logic remains schematic-only. Moving equipment with changing fluid mass/inertia is rejected. Motion is built with dynamic geometry, including separate driven rotors. A motor housing’s pose is not its shaft angle. Tank shading shows calculated fill percentage, not a simulated free surface; housing dimensions do not silently change hydraulic capacity or effective surface area. Thermal displays use the existing lumped temperature; no extra casing heat capacity is created by spatial mapping.

Opening Physical view in sandbox Build mode automatically places unmounted equipment on a deterministic metre-based grid, preserving existing placements and component identities. Subsequent equipment additions are placed automatically while building a spatial experiment. The initial camera fits the whole assembly, even when a schematic component is selected. Placement is saved with the project; wiring, control logic and hydraulic topology remain shared and are edited in Schematic view. Automatically placed housings start with collisions disabled; users can explicitly enable collisions in Build mode. Static housings alone do not activate mechanical substepping or change the electrical/thermal/hydraulic solver schedule.

For an already-running schematic experiment, unmounted equipment appears as a clearly labelled layout without adding collision bodies or changing live simulation state. Reset in Physical view creates editable placements. Scored challenges likewise show unmounted equipment as a layout, keeping locked challenge geometry untouched. These layout coordinates are presentation only, and are never reported as calculated mechanical measurements.

The shared-view follow-up passed 113 automated tests, 87 quantitative physics checks and six browser workflows covering automatic placement, live state preservation, challenge locks, construction, joints and saved-run restoration. Logs: `validation/shared-views-physics.txt`, `validation/shared-views-browser.txt` and `validation/shared-views-docker.txt`. The production Docker image was rebuilt and the browser checks ran against port 8080.

## Bodies, construction and materials

Static, dynamic and prescribed-velocity kinematic bodies support rectangles, circles, strictly convex 3–8-vertex polygons, beams, platforms, walls, floors and wheels. The latter names are practical geometry presets. Planck provides contacts, sleeping/waking, friction, restitution and continuous collision detection. Collision category/mask filters and rotation locking are editable. Dynamic mass is `rho * area * depth`, unless an explicit mass override is supplied; the fixture inertia is scaled consistently. Disk inertia is `m*r²/2`; a rectangle uses `m*(w²+h²)/12`. Polygon centers of mass and inertia come from the engine’s actual geometry.

Build mode supports placement, movement, rotation, resize handles, convex vertex editing, multi-selection, alignment, snap, lock placement, duplicate/delete and shared undo/redo. Physics remains paused while constructing. Once time advances, geometry, mass, gravity, topology and initial conditions require Reset. Operational controls remain live in sandbox mode. A locked placement prevents transformation; it is not an undeletable challenge policy.

| Preset | Density kg/m³ | Friction | Restitution | Conductivity W/(m K), metadata | Specific heat J/(kg K), metadata |
| --- | ---: | ---: | ---: | ---: | ---: |
| Steel | 7850 | 0.50 | 0.10 | 45 | 470 |
| Aluminum | 2700 | 0.40 | 0.15 | 205 | 900 |
| Copper | 8960 | 0.45 | 0.10 | 390 | 385 |
| Wood | 600 | 0.50 | 0.15 | 0.12 | 1700 |
| Glass | 2500 | 0.30 | 0.20 | 1 | 840 |
| Plastic | 950 | 0.35 | 0.20 | 0.20 | 1900 |
| Rubber | 1100 | 0.90 | 0.70 | 0.16 | 1800 |
| Concrete | 2400 | 0.70 | 0.05 | 1.4 | 880 |

These are representative teaching presets, not certified surface data. Planck combines contact friction using a geometric mean and restitution using the larger coefficient. Custom presets are validated. Thermal properties do not automatically couple visually touching solids; plasticity, fracture, corrosion and temperature-dependent stiffness are unsupported.

## Constraints and forces

Fixed/weld, revolute, prismatic, fixed-distance and spring constraints use explicit local anchors. Picking an anchor in world coordinates converts it with the inverse body transform. Revolute limits use radians; prismatic limits use metres along a unit local axis. Springs apply equal/opposite anchor forces `F = k*(length-restLength) + c*relativeAnchorSpeed`, with potential `k*extension²/2`. Stiffness/damping coefficients trigger smaller bounded substeps where needed. Gear/rack constraints combine two grounded revolute/prismatic joints: `q1 + ratio*q2 = constant`. A ratio of -50 in the lift gives 0.02 m of upward load travel per rotor radian.

Kinematic bodies have prescribed velocity and represent an external actuator; their contact work is recorded. Joints with kinematic bodies are rejected because their joint-drive work is not yet modeled. Gear parents must be grounded. Constraint forces/torques are actual engine reactions from the last accepted substep, not frame-averaged load-cell readings. Spring reaction is the configured force law. Collision/contact measurements are also last-substep measurements.

Constant body forces, impulses, torque and viscous brakes are supported. The force/brake actuator accepts the existing numeric control input or an explicit value, bounds its constant force/torque, and applies damping to its dynamic target. It is an **external energy source** unless acting as a passive brake; no electrical actuator model is implied. Force is applied at the center of mass. Impulse tools record exact changes in kinetic energy, including angular impulses.

## Electrical, mechanical and hydraulic coupling

The existing quasi-steady brushed motor remains:

```
Iarm = (duty * Vbus - ke * omega) / R
Ibus = duty * Iarm
motorTorque = kt * Iarm
Pcopper = Iarm² * R
frictionTorque = b * omega
```

Inductance, switching/commutation loss and drive electronics are omitted. An overspeed shaft can return signed electrical power to the ideal DC source; this represents an absorbing external supply, not a finite battery or modeled generator product. SI-consistent torque and back-EMF constants preserve power conversion. Existing 24 V, 48 V and 180 V catalog models remain available with paid ratings.

A shaft supports one motor, one optional centrifugal pump and one optional spatial rotor; the rotor requires a grounded revolute bearing and free rotation. The Planck body mass matrix includes `Ibody + Jmotor` once. A spatially linked motor is excluded from the lumped rotational-energy sum. Pump torque and spatial constraints both load the same shaft.

At each internal interval, a bounded Newton iteration solves for motor midpoint speed. The electrical solver stamps back EMF at that speed; the hydraulic solver finds the pump/network operating point; a trial Planck step receives net torque `kt*I - pumpTorque - externalLoadTorque - b*omega`. The shaft residual is `2*omegaMid - omegaOld - omegaTrialEnd`. Accepted Planck end speed is authoritative for the motor and pump. The motor’s reported acceleration is the actual shaft speed change over the interval, including spatial loading. Reported motor load is `kt*I - b*omega - Jmotor*alpha`, and shaft output is that load times shaft speed: the motor’s own rotor acceleration is excluded from delivered output. The combined-body work ledger still includes the rotor’s stored kinetic energy once. Finite-difference Jacobians, 16 iterations and a 1e-8 rad/s residual threshold bound convergence. Failure rolls back and reports an error.

For a lumped shaft, the original midpoint equation `J*domega/dt = torque-load-friction` remains unchanged. Pump affinity scaling, efficiency, network resistance, finite tanks and conservative water enthalpy transport remain the Phase 2B models. A tank’s spatial y affects hydraulic elevation only through an explicitly enabled static elevation link plus offset; movement updates configuration in Build mode. Pipe length is never inferred from geometry.

Trial worlds are cloned from a Planck checkpoint. The pinned adapter preserves mass data, unwrapped rotation and gear constraint constants (the latter two require narrow access to Planck internals); regression tests cover multiple revolutions and rack replay. Trial reconstruction does **not** preserve warm contact caches. Motor-driven collision-dense scenes therefore cost more and can have greater constraint error than plain mechanics. The supported starters use grounded shafts and modest constraint chains.

## Schedule, conservation and instruments

The public simulation clock is fixed at 1/60 s, independently of rendering. Legacy non-spatial shafts retain ≤1/240 s substeps; spatial worlds use ≤1/480 s. Spring/damper limits may reduce this further. Steps below 1/30000 s or more than 1024 internal intervals are rejected with guidance. Each accepted interval solves coupled electrical/shaft/hydraulic state, advances mechanics and conservative water transport, then the existing thermal step integrates heat. Sensors/controllers execute on the simulation clock using the prior accepted measurements. Thermal state uses backward Euler. No random render timing enters the equations.

Planck uses 16 velocity/8 position iterations. This is a semi-implicit rigid-body integrator with first-order position error; explicit spring/brake integration also has timestep error. Contacts and joints have finite solver slop. Bitwise cross-platform determinism is not guaranteed. The same pinned runtime’s replay is tested for exact body/controller/motor readings; quantitative references define practical tolerances.

The unified residual is:

```
electrical supply + signed external mechanical work
- thermal storage change - ambient/coolant/drain/shaft export
- lumped rotor kinetic change - hydraulic gravitational storage change
- spatial (kinetic + gravitational + spring) storage change
- contact loss - travel-stop loss - damping loss
```

Motor/pump shaft work is an internal transfer, not an extra external supply. Contact heat uses measured impulse dotted with midpoint relative contact velocity; travel-stop dissipation uses measured limit-reaction impulse work; brakes use force/torque times velocity. These sinks leave the modeled system as heat without heating an arbitrary unrelated component. Ideal joint numerical work remains a reported residual. No fitted correction changes energy or positions to close the ledger. The existing conservation alert uses max(0.5 J, 0.5% of supplied plus initial/external mechanical energy); mass tolerance remains 1 mg.

New probes include position/displacement, linear/angular velocity, acceleration, applied force/torque, kinetic/potential energy, contact impulse, joint reaction and mechanical residual. Actuator readings refer to that actuator, even with several on one body. The component joint-force probe sums attached reaction magnitudes; the joint inspector exposes each individual reaction. CSV and unit-separated multitrace charts reuse existing telemetry. Optional overlays show actual collision geometry/AABBs, center of mass, velocity, net applied force/torque, anchors, limits, contacts and identifiers. The diagnostic panel reports counts, measured trial and whole-step time, residuals and frame-budget warnings.

## Challenges, persistence and practical limits

007 Controlled Descent: a 10 kg guided load falls from 5 m to 1.00±0.08 m, must remain ≤0.05 m/s for 3 s, impact ≤0.6 m/s, dissipate ≤500 J, and finish within 120 s/€250. Learners configure passive braking.

008 Motorized Lift: a motor/real transmission with actual vertical position feedback lifts the locked 10 kg load from 1 m to 3.00±0.08 m and holds 3 s. At least 100 J of actual motor shaft work is required; external free forces are prohibited. Budget €900, time 120 s, electrical limit 2 kW.

009 Rotational Control: regulate the actual rotor to 1200 RPM, with 10 s startup followed by 60 s scoring. External resisting torque alternates 0.4/1.2 N·m every 15 s in the physical equations. Require ≥95% within ±60 RPM, RMS error ≤60 RPM and four load changes. Budget €750, electrical limit 2 kW, deadline 90 s.

All challenge initial loads, gravity, catalog coefficients and safety constraints are validated on import and at engine boundaries. Scored runs prohibit operational edits/impulses after startup. Completion depends on calculated state and sensor/control ancestry, not a single predefined circuit arrangement. Connected starters demonstrate valid designs; assignments intentionally omit wiring or brake configuration.

Version 4 projects persist geometry, materials, initial velocities, world gravity, joints, shaft/control links and probes alongside existing engineering configuration. Older v1–v3 projects remain supported. Assembly duplication remaps all internal component/joint/gear references; external links/targets are omitted, including a copied rotor shaft if its grounded bearing was not selected. Deletion prunes dangling joint/gear references. Reset restores initial configuration. Live-run archives store origin, validated time-stamped inputs/impulses/faults and time; import reconstructs all dynamic states, controllers and constraints with fixed steps rather than trusting arbitrary imported snapshots/scores. Replay is final-state reconstruction, not a timeline scrubber, and is limited to two simulation hours/5,000 inputs.

Scenes are limited to 100 components/100 joints/300 connections. Dimensions 0.05–100 m, world coordinates ±1000 m, dynamic configured mass 0.001–10,000 kg, initial speed ≤100 m/s per axis/350 rad/s are validated. Leaving the runtime ±2000 m/200 m/s/370 rad/s envelope reports an error. Extremely stiff springs are rejected. Long thin bodies, very large mass ratios, overconstrained mechanisms and dense motor/contact coupling remain numerical risks; these bounds do not certify every allowed combination.

Rendering remains on the main thread. Small scenes remain interactive; the measured 100-body browser scene drops well below smooth frame rates. Worker execution is a demonstrated priority for larger scenes, and is deferred in this implementation rather than claimed complete. RAF catch-up has a 12 ms cooperative budget and one-second bounded backlog; an overloaded clock slows while each physics step remains fixed. Advance/replay yield in small batches. An individual expensive step cannot be preempted; the 100-body benchmark has frame-budget overruns. A worker and persistent trial-state optimization are recommended before larger scenes.

## Scope boundaries and Phase 3B

No spatial fluid, automatic spill, flood, deformation, damage, proximity-based heat conduction, turbine/generator or spatially moving finite tank is simulated. Existing finite hydraulic storage still prevents silent overflow/depletion. Spatially represented thermal equipment remains lumped; explicit existing thermal connections continue to account for heat.

`SpatialFluidExchange` defines future boundary transfers of mass, momentum, energy, position, velocity and temperature. Phase 3B should implement a conservative network/world transaction ledger, finite pipe inventory, spatial water/body pressure forces and moving equipment mass matrices before enabling leaks/overflow. Preserve identity and energy ownership; add worker execution and reproducible engine snapshots before larger fluid scenes. An upgrade to Planck/Rapier must retest the pinned snapshot adapter, gear constants, multi-turn angles, contact work and all legacy challenge/import policies.

See [complete component inventory](COMPONENT-MATRIX.md), [preflight evidence](PHASE3A-AUDIT.md) and [executed results](PHASE3A-RESULTS.md).
