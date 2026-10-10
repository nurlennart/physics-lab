# Phase 3A preflight audit

Executed on 2026-10-09 against the actual Phase 2B working tree, including the later 48 V / 180 V catalog additions. Existing uncommitted changes belong to the ongoing implementation and are preserved.

- `npm run test:physics`: 91 tests and 60 quantitative checks passed before Phase 3A integration. Raw log: `validation/phase3a-preflight.txt`.
- `npm run validate:coupled`: transfer, pressure control, automated supply (720 s including sensor fault), and heated circulation all completed without error or violations. Raw log: `validation/phase3a-preflight-coupled.txt`.
- Actual implemented features: MNA; backward Euler thermal; finite vented tanks; Darcy hydraulic nonlinear network; implicit-midpoint brushed motors and pumps; conservative enthalpy transport; simulation-clock automation DAG; PI, hysteresis and safety; six challenges; probes/CSV; version 3 projects; validated event-history archives; fixed 1/60 s engine with bounded 1/240 s multiphysics substeps; Docker/nginx.
- State owner: `Simulation`, independent of React. Editor edits are validated against a frozen scenario copy. RAF schedules fixed steps; views consume values rather than own physics.
- Persistence: scenario and live state are separated; live archives replay validated origins and time-stamped inputs. Replay yields to the browser; no trusting imported energy/challenge scores.
- Existing limits are real: zero pipe volume/travel time, static-density water, quasi-steady motor armature, ideal PWM/external valve drive, no AC/inductance, no spatial fluid or deformation. Existing motor/pump shaft topology supported one pair only.

No preflight blocking physics failure was found. Extension risks: shaft inertia double-counting; coordinate/unit confusion; geometry omitted from physics signatures; dangling joints after duplication/deletion; replay missing impulses; old challenge environmental bypasses; constraint impulses and contact heat omitted from energy ledgers; source model limits during larger motor startup.

Chosen engine: pinned Planck 1.4.2, a mature Box2D JavaScript/TypeScript implementation. It supports the existing synchronous Node 22 and browser solver path, convex fixtures, continuous collision handling and articulated joints. Current Planck 1.5 requires Node 24; this project and Docker use Node 22. Rapier is a capable alternative but adds asynchronous WASM initialization to the synchronous current engine. Official references: https://piqnt.com/planck.js/docs/ , https://piqnt.com/planck.js/docs/api/classes/World.html , https://rapier.rs/docs/user_guides/javascript/getting_started_js/ .

Spatial configuration is attached to existing component IDs, with optional project world/joints. Engineering housing bodies are static in 3A, preventing unsupported moving fluid-inventory inertia. Dynamic geometry bodies drive mechanisms. Motor shafts may share a hydraulic pump and one grounded rotor. Pixels remain schematic/rendering coordinates; spatial configuration is metres/radians. Contacts do not imply damage or proximity-based heat transfer.

Post-implementation scheduling decision: spatial worlds now use at most 1/480 s internal steps after a short-drop convergence/energy test exposed transient first-order error at 1/240 s. Non-spatial legacy shafts retain 1/240 s. RAF catch-up is cooperatively budgeted to 12 ms with bounded backlog; overloaded scenes slow the simulation clock without changing physical dt.
