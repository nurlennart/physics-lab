# Functional integration stabilization

This pass repairs supported workflows. It adds no component kinds and does not change motor parameters, supply ratings or protection thresholds.

## Motor diagnosis

The default standard induction motor uses its existing per-phase equivalent circuit. At 400 V line-to-line RMS and 50 Hz, phase voltage is 400/√3 V; the locked-rotor line current is about 74 A. This exceeds the standard source's 63 A rating. *Superseded (supply overload revision):* AC supplies now have thermal-magnetic output protection, so the standard supply starts and runs this motor; see the section below.

The **Loaded induction motor** example uses the existing 400 V / 250 A supply catalog variant, the unchanged standard motor, and 35 N·m external shaft load. After 60 s it runs at approximately 1,468 RPM, 9.89 A line current and 5.38 kW shaft output. Its brief startup excursion above the motor's continuous 15 A rating remains in the event log; winding heating and failure remain active. The 45 kW variant requires its own startup/load assessment. Reduced-voltage starters, VFDs and switching waveforms remain unsupported.

Confirmed rating defects were separate from the startup incompatibility: AC apparent-power ratings now compare √(P²+Q²), motor shaft-power ratings compare shaft output, and induction-motor voltage ratings compare line voltage. Inspector rating bars use those same quantities. Supply trips report measured current, the exceeded rating, and a remedy. Simultaneous rating violations are reported individually.

## Measurement contract

`src/simulation/capabilities.ts` supplies target eligibility to sensor menus, chart menus, import validation and runtime sensing. Measurements are available only when the corresponding model state exists.

| Measurement | Supported target/state | Sensor output / chart units |
| --- | --- | --- |
| Body/winding temperature | Modeled thermal masses; tank water and vessel are lumped together | °C / °C |
| Fluid temperature | Tanks with liquid, pipe inventory or transported branch/node fluid; exchanger hot/A or cold/B | °C / °C |
| Gauge pressure | Tank bottom, hydraulic node or branch outlet | Pa / bar |
| Inlet / differential pressure | Hydraulic branches; differential is inlet minus outlet, negative for pump rise | Pa / bar |
| Signed branch flow | Pipes, pumps, valves, regulators and either exchanger stream; inlet → outlet | m³/s / L/min |
| Level | Finite tank volume relative to capacity | % / % |
| Position | Spatial body x or y; no synthetic shaft-angle encoder | m / m |
| Shaft speed | Motor shaft, connected pump shaft or physical body's rotation | RPM / RPM |
| Electrical | Circuit branch/node RMS voltage/current, real/reactive power, power factor, accumulated energy | V, A, W, var, 1, J |

Pipe fluid temperature is the mean modeled inventory temperature; zero-volume branches use transported fluid temperature. No independent pump/valve body temperature is invented. Exchanger sensor and chart stream selectors access existing hot/cold readings. Static equipment housings do not replace a motor's actual shaft-speed measurement.

Sensors sample at the start of an integration interval; charts show the resulting state. A nonzero sampling interval now holds measurements between samples. Faults, removed targets and missing fluid invalidate immediately. Paused hydraulic re-solves resolve temperature validity and NPSH without advancing mass or heat. Small nonzero SI readings retain visible precision instead of rounding to zero. Stagnant zero-inventory branches have no fluid temperature; numerical leakage below the solver’s existing stagnant-flow threshold does not establish one. Invalid sensors show an unavailable reading and reason; dependent controls receive an invalid signal, never a fabricated valid zero.

## Configuration and compatibility

Existing project versions and IDs remain supported. Missing quantity/stream properties migrate to catalog defaults: previous body/winding/tank temperature behavior, outlet/node pressure, and hot/A exchanger stream. Old tank/junction branch-flow and motor hydraulic-power traces remain saved but display unavailable. Their targets do not model those quantities; remove or retarget those traces. Unknown new properties and incompatible sensor assignments still produce actionable import errors.

Overflow routing requires a physical pipe from the rim outlet to a receiving tank. Direct tank-to-tank ideal wires, including direct overflow wires, are rejected with that instruction. Overflow outlets cannot connect to each other. Explicit level guards stop filling; overflow itself does not stop a pump.

Live archives replay configuration and recorded inputs through the current engine. The corrected sensing semantics can change a historical run that depended on a defect; cross-version bitwise replay is not promised. Current-engine save/load and reset are verified separately.

## Validation evidence

The regression tests in `src/simulation/integration.test.ts` cover startup/supply incompatibility, loaded operation, AC/line-voltage ratings, sensor capabilities and units, both exchanger streams, sample holds, stale hydraulic validity after fault recovery, legacy invalid traces, static-housing shaft feedback, and routed overflow.

`e2e/stabilization.spec.ts` uses actual component menus, terminal clicks, inspector fields, charts, run/pause/advance/reset and file downloads/imports. Every supplied example is checked against a meaningful result and saved/reloaded. It also exercises sensor faults and target removal, incompatible induction supply recovery, routed overflow with a physical pipe and explicit filling guards, motor speed targets and exchanger stream selection.

Detailed executed engine results are in `validation/examples.json`; analytical physics checks are in `validation/latest.md`.

Final validation on 2026-10-10:

| Command | Executed result |
| --- | --- |
| `npm run check:fast` | Typecheck and production build passed; 254 tests across 19 files, 87 physics checks, 124 scale checks and all nine unchanged challenge reference results passed |
| `npm run validate:examples -- --write` | All 16 examples completed their configured validation duration; the induction motor's expected startup continuous-current warning remains visible |
| `npm run test:e2e:prod` | All 58 browser tests passed, including every example's meaningful result, reset and save/reload, and the targeted integration workflows above |
| `git diff --check` | Passed |

No known critical supported-workflow blocker remains. The unsupported model combinations described above remain explicit limitations, not simulated successes. These checks cover the supplied examples and representative workflows; they do not establish correctness for every arbitrary sandbox configuration.

## Supply overload revision

The previous AC supply protection tripped instantly at any current above its rating, so the default 63 A three-phase supply could not start the default 7.5 kW motor (≈ 74 A, 1.17 × In, for a fraction of a second). Real supplies are protected by fuses or breakers that tolerate such surges. AC supplies (`sourceAC`, `source3`) now use the same thermal-magnetic characteristic as the circuit breaker, with In = the current rating:

- thermal image dθ/dt = ((I/In)² − θ)/τ, τ = `thermalTimeConstant` (default 60 s), trip at θ ≥ 1.3²; at 2 × In from cold that is τ·ln(4/(4 − 1.69)) = 32.9 s;
- instantaneous trip at `magneticTrip` × In (default 10, C characteristic);
- current above the rating that has not tripped is reported as a warning.

Consequence: a stalled 7.5 kW motor (≈ 1.17 × In) does not trip the 63 A supply, as with a real C63 breaker; the motor's winding temperature or a motor-protective breaker must act. DC supplies keep their instantaneous electronic output protection, so no DC challenge or example changes. Tests: `ac.test.ts` (thermal trip time against the analytic value within one step, tolerated 1.2 × In, magnetic trip, default supply with default motor at rated load).
