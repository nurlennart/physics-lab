# Validation

How the models are checked, and where the results are recorded. Commands and the release gate are described in [WORKFLOW.md](WORKFLOW.md). Validation covers the documented models over the tested scenarios; it is not a certification of every allowed parameter combination.

## Layers

| Layer | Command | What it establishes | Record |
| --- | --- | --- | --- |
| Unit and integration tests | `npx vitest run` | Every model against independent analytic references (Ohm's and Kirchhoff's laws, exponential cooling, pump affinity, fuse gates, breaker trip times, equivalent circuits, …), conservation, event splitting, replay, integrity rules, migration, the wire router | test output |
| Physics validation | `npm run validate:physics` | Engine scenarios with expected and measured values, absolute and relative errors, tolerances and assumptions, including timestep refinement | [validation/latest.md](../validation/latest.md), `latest.json` |
| Scale validation | `npm run validate:scaling` | The sandbox's range: Ohm's law over 1 mΩ–1 MΩ × 1 V–100 kV, all source modes, tank × heater matrices against analytic two-node solutions, motor sizes, pipe diameters, protection curves, AC and three-phase cases, a parameter-extreme sweep over every numeric parameter (no NaN or Infinity) | [validation/scaling.md](../validation/scaling.md), `scaling.json` |
| Challenge score guard | `npm run check:scores` | Each assignment's catalog reference design completes with the recorded time and score | `validation/reference-scores.json` |
| Example campaign | `npm run validate:examples` | Every starter and its checked-in `examples/*.physics.json` file imports and runs 60–1,800 simulated seconds (fixed-step startup, then adaptive advance) without errors, violations, failed components or non-finite probes; `--write` regenerates the example files | `validation/examples.json` |
| Preset operating campaign | `npm run validate:presets` | Every built-in preset runs in a connected operating fixture, including all heater × tank preset pairings; independent electrical, thermal and hydraulic references, conservation, import/export and rating checks. Short fixtures establish coupling, not unrestricted long-term compatibility | `validation/presets.json` |
| Coupled campaign | `npm run validate:coupled` | Hydraulic challenge reference designs run to scored completion, plus heated circulation, with raw final states and residuals | `validation/coupled.json` |
| Spatial campaign | `npm run validate:spatial` | Mechanical starters and the three mechanical assignments run to completion, with body readings, motor states and mechanical energy terms | `validation/spatial.json` |
| Shaft events | `node scripts/check-shaft-events.mjs` | A lift rack falling back after motor power loss; an overspeed rotor regenerating into its supply | `validation/shaft-events.json` |
| Benchmarks | `npm run benchmark:spatial`, `node scripts/benchmark-browser.mjs` | Solver cost for 10/50/100-body scenes and a 600 s mechanism; frame intervals in the production browser | `validation/spatial-benchmark.json`, `validation/browser-benchmark.json` |
| Parameter audit | `npm run audit:parameters` | Every catalog default and preset is covered by parameter metadata | [PARAMETER-MATRIX.md](PARAMETER-MATRIX.md) |
| Browser tests | `npm run test:e2e:prod` | Real UI workflows against the production build: wiring by terminal clicks, every starter (run, reset, save and reload), all nine assignments, faults and recovery, probes and CSV, replay, the Physical view, mobile layout | Playwright output |

The release gate runs the first four layers, the preset operating campaign, the shaft events, the production build and the browser tests. The gate's reports are rewritten only when a result changes, so re-running the gate on an unchanged tree leaves it clean. The other campaigns are run by hand when their area changes; they always rewrite their report with a new timestamp.

## Principles

- **Independent references.** Expected values come from analytic solutions or independent calculations, never from the production code under test.
- **Conservation is checked separately from accuracy.** Every run carries the energy and mass ledger ([PHYSICS.md § Energy and mass accounting](PHYSICS.md#energy-and-mass-accounting)); no correction factor closes it.
- **Convergence is measured.** Timestep refinement checks report raw errors and their ratios (for example first-order backward Euler: error ratio ≈ 2 on halving the step).
- **Deterministic replay.** Save/reload and replay are tested for identical final state in the same runtime.
- **Reference scores move only deliberately.** A physics change that alters a challenge result must re-record it (`node scripts/check-scores.mjs --update`) and explain why in the commit message.

The Bosch TH3000 9 reference boiler has a dedicated [calibration snapshot](../validation/boiler.md), regenerated with `npm run validate:boiler`. Its electrical, thermal, safety, controller, energy-breakdown and rollback regressions run in `boiler.test.ts` as part of the full release gate; the catalog preset and example are covered by the operating and browser campaigns. See [ELECTRIC-BOILER.md](ELECTRIC-BOILER.md) for specification provenance and approximations.

The Bosch Compress 6800i AW 7 OR-S heat pump has a [calibration and validation report](../validation/heat-pump.md) (`npm run validate:heatpump`). It lists:

- the steady cycle at all twelve published Bosch points (nine fitted, three withheld);
- an EN 14511-style frost/defrost bench against Bosch's A2 and +2 °C values;
- three coupled scenarios with energy residuals: defrost at 2 °C, a −15 °C cold snap with backup heater, low-load cycling;
- a timestep comparison;
- a 48 h replay of real weather against a measured Bosch 5800i (heatpumpmonitor.org #920), with every result classed as measured, calibrated, predicted, extrapolated or unvalidated.

`heat-pump.test.ts` runs the same physics and protection checks in the release gate. See [HEAT-PUMP.md](HEAT-PUMP.md).

The Kermi therm-x2 panel radiator likewise has a [calibration snapshot](../validation/panel-radiator.md) (`npm run validate:radiator`). It runs the full engine against Kermi's published outputs at their flows, every catalog size, the EN 442 characteristic from 2 % to 200 % flow, the pressure-drop chart, an analytic zero-flow cool-down and a timestep refinement. `panel-radiator.test.ts` repeats these as regressions in the release gate, together with energy reconstruction, reverse flow and the complete boiler–circulator–radiator example. See [PANEL-RADIATOR.md](PANEL-RADIATOR.md).

Solar generation/storage: `npm run validate:solar` regenerates [validation/solar-energy.md](../validation/solar-energy.md), separating STC fitting constraints, withheld NOCT data, analytical network checks, timestep comparison and a 1200 s sun/night conservation run. See [SOLAR-ENERGY.md](SOLAR-ENERGY.md). `solar.test.ts` and browser regressions run in the complete release gate.

See [grid-connected energy architecture and solar reliability audit](HYBRID-ENERGY.md) for generic grid-following and hybrid inverter models, PCC metering, manufacturer calibration, isolation policies, confirmed solar fixes and validation limitations.
