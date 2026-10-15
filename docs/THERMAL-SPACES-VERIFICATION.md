# Thermal Spaces verification — 2026-10-15

The first version is implemented and verified through the existing engine, production build and browser UI. This report distinguishes complete coverage across runs from a single uninterrupted gate pass.

| Check | Verified result |
| --- | --- |
| Untouched HEAD baseline | 45 files, 820 tests passed; single fork, 712.63 s |
| TypeScript and production build | Passed, including the final production browser build |
| Complete unit/integration run | 844/847 passed initially; three existing long tests exceeded their timeouts under concurrent workloads |
| Isolated regression rerun | All 108 tests in the three affected suites plus room/editor suites passed, 204.37 s; existing timeouts unchanged |
| Final editor transaction addition | 14/14 passed, including drawing around existing equipment, moving a room, membership reconciliation and undo |
| Final battery/storage audit | 44/44 room and existing device tests passed; storage uses the electrical solve’s start-temperature coefficients |
| Unit/integration coverage across runs | All 849 unique cases passed, including the final editor and temperature-dependent battery cases |
| Complete production-browser run | 109/112 initially passed; two new examples needed entries in the generic test's expected-value table, and zero-export advancement exceeded its existing deadline under load |
| Final production-browser rerun | 6/6 passed, including the corrected examples, zero-export and added zoom test |
| Final interaction refinement | 3/3 passed after room membership and Space-key pan refinements; fresh production build |
| Browser coverage across runs | All 113 unique cases passed; timeouts unchanged |
| Physics campaign | 96/96 passed |
| Scaling campaign | 124/124 passed |
| Preset campaign | 137/137 scenarios across 93 presets passed |
| Solar / hybrid campaigns | 16/16 and 34/34 passed |
| Challenge reference scores | All nine matched recorded values |
| Shaft-event campaign | Both cases passed |
| Kermi independent calibration | 65/65 passed; worst relative output error 0.0006671 (0.06671%) |
| Bosch independent calibration | 8/8 passed; currents, analytical warm-up, storage and safety limiter checks retained |
| Coupled-system campaign | All four transfer/pressure/supply/circulation scenarios passed |
| Example campaign | All 76 generated/file scenarios passed, including both new room examples |
| Thermal hour-scale campaign | Original Kermi hour, living-room hour and three-hour timed shutdown all passed |
| Patch whitespace check | Passed |

The complete coverage above was obtained through the broad runs and focused reruns. A single uninterrupted `npm run check` was not recorded. The check script now includes the thermal hour-scale campaign; its constituent checks were executed during this implementation. No deployment or release verification record was created.

## Test-runner diagnosis

Both fork and thread pools passed a small focused test and the 157-case environment suite. The original banner-only output was not enough evidence of a deadlock. Long simulation files can take minutes before the default reporter prints a file result. Verbose per-test progress and a single fork provide a reproducible verification path on this small host.

Running CPU-heavy unit, browser and benchmark campaigns concurrently caused existing wall-clock limits to expire. The hybrid float test, Kermi system test and stalled-drive overload test all passed unchanged when rerun without those competing workloads. The zero-export browser case also passed unchanged on its final rerun. The two new generic example cases were fixed by adding their actual expected room-temperature ranges to the test table, rather than skipping them or changing the solver.

The sandbox prevented the local browser preview server from binding its port. Production browser tests were run with that restriction lifted. Dependency versions match the lockfile; no package upgrade was needed.

## Physical results and limits

The 5 × 4 × 2.5 m living room has 2 MJ/K additional capacity, constant dry-air properties, an editable insulated envelope, a 2 m² window and 0.5 ACH. It begins at 15 °C with 0 °C outdoors. The existing boiler/circulator/Kermi circuit heats it to **15.843 °C after one hour**. With the boiler disabled by a real timer, it reaches **14.928 °C after two further hours**. Stored water and radiator heat continue exchanging after shutdown.

Across the hour-scale campaign the largest absolute energy residual was **0.000126 J**, with zero mass residual. The established 0.1 s boiler bound and all solver/conservation tolerances were preserved. Actual timing and step counts are in [thermal-spaces.json](../validation/thermal-spaces.json).

Measured under a shared two-core workload, one simulated hour took 76.1 s without a room and 112.5 s with a room. The three-hour timed-shutdown scenario took 344.2 s. Advances yield to the browser, but multi-hour/multi-room experiments remain computationally expensive. Boiler event-aware acceleration needs separate validation and was not introduced here.

This is a single-temperature effective zone model, not detailed wall dynamics, radiation, stratification or CFD. Shared partitions are explicit canonical elements; converting two exterior walls into one partition requires removing the redundant exterior element. Mechanical contact heat and exported shaft work retain their existing external-ledger meanings. See [Thermal Spaces](THERMAL-SPACES.md) for the model, controls and assumptions.
