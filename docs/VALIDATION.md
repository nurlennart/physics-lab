# Validation record

Current Phase 3A evidence is in [the executed results](PHASE3A-RESULTS.md), [raw quantitative results](../validation/latest.md), and `validation/phase3a-*`. Earlier phase results below are historical evidence.

Validated on 2026-10-09 with Node 22.23.3.

- TypeScript and Vite production build: passed.
- Physical and project tests: **63 passed**.
- Chromium browser integration tests: **12 passed**.
- Dependency audit: zero reported vulnerabilities after upgrading Vitest.
- Docker: multistage image build passed; nginx serves the application on port 8080; health check passed.

## Measured heating challenge reference

Default source 240 V, switch 0.01 Ω, heater 28.8 Ω and 300 J/K, heater/water conductance 180 W/K, heater ambient loss 0.5 W/K, tank ambient loss 2.2 W/K, water 10 kg at 20°C, ambient 20°C. Fixed step 1/60 s.

| Quantity                        | Calculated value |
| ------------------------------- | ---------------: |
| Completion time                 |       1,323.45 s |
| Water temperature at completion |      80.000478°C |
| Electrical energy               |   2,645,981.26 J |
| Stored thermal energy           |   2,529,284.29 J |
| Heat lost to ambient            |     116,696.97 J |
| Energy balance residual         |     0.00000922 J |
| Peak electrical input           |      1,999.306 W |
| Cost                            |             €158 |
| Rating                          |  3 stars, 90/100 |

The result includes element heating, switch dissipation, and ambient losses. It exceeds the 2,508,000 J water-only lower bound without a scripted energy penalty.

## Browser coverage

All three assignments are constructed by clicking actual terminal pairs and completed using solver state. The browser suite exercises Run/Pause/Reset, real heating, energy diagnostics, domain validation, drag placement, duplicate/undo/rotate/delete, zoom, JSON download/import/rejection, CSV export, deterministic replay, and mobile overflow checks.

The browser tool test uses an injected registry shim to verify schema registration, valid advance input and state read-back, and invalid-input rejection. Native WebMCP host validation is unavailable in this environment; WebMCP is optional and feature-detected.

Tests establish correctness for the documented linear DC and lumped thermal models. They do not validate CFD, rigid-body mechanics, phase change, manufacturer-specific failure curves, or scenarios beyond the declared scene limits.

## Phase 2A validation

The 63-test regression/integration suite includes typed controllers, hysteresis, TON/TOF/pulse timing, SPDT contacts and resistance, overload/open/stuck faults, temperature sensor lag/failure, independent safety latching/reset, long regulation and energy accounting, paused/render-rate consistency, challenge anti-exploits, alternative thermostat solutions, replay including timer/pulse/fault/manual-reset state, probe serialization, connected assembly ID/target/wire remapping and orthogonal routes. All baseline tolerances remain intact.

The [executed engine scenarios](../validation/latest.md) contain 32 quantitative/Boolean checks with expected/measured values, tolerances, errors, assumptions and an execution timestamp. These include analytic thermal convergence and the complete fault-and-recovery assignment, in addition to the test suite.

All 12 Chromium workflows passed: the original eight workflows plus real closed-loop faults/probes/replay, connected duplication/undo/reusable assemblies/node probes, draggable wire bends, and a full visible Thermal Runaway construction/operating/fault/manual-reset/recovery run. The recovery scoring requires feedback transitions that alter actual heater power; passive cooling cannot earn automatic regulation credit. Browser tests await responsive fast-forward batches instead of assuming a blocking action.

Production TypeScript/Vite build passed. The rebuilt Docker production image passed all 12 Chromium workflows at http://localhost:8080 and its nginx health check. Native WebMCP host integration remains untested; registration/API contracts are browser-shim tested. No peak-size or long-duration real-device performance benchmark is claimed.

## Phase 2B executed audit

See [PHASE2B-RESULTS.md](PHASE2B-RESULTS.md) for executed regression, whole-system, browser and Docker results; [validation/latest.md](../validation/latest.md) includes the preserved original checks plus quantified motor/pump/fluid convergence and conservation. `npm run validate:coupled` executes all three hydraulic reference designs to scored completion and a heated circulation loop; its raw final states and timings are in [phase2b-coupled.json](../validation/phase2b-coupled.json). Scenarios A–J are covered across motor load/energy, hydraulic operating point, finite elevated transfer/boundaries, valve/current response, thermal advection, simulation-clock hysteresis, pump/sensor failure, 720 s drift, actual timestep refinement, and challenge/import integrity. Scope limits and unsupported physics are stated in the model and component inventory rather than implied by a decorative catalog entry.
