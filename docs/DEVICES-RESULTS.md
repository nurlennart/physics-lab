# Additional component validation — 2026-10-11

Implementation and limitations: [DEVICES.md](DEVICES.md). Work is isolated on `work/battery-contactor-transformer-radiator`, following [WORKFLOW.md](WORKFLOW.md). No challenge reference scores were updated.

## Complete contribution gate

`VITEST_MAX_WORKERS=1 npm run check` completed successfully on 2026-10-11:

- TypeScript typecheck and production build passed.
- **344/344** unit/integration tests passed across 28 files.
- **87/87** quantitative physics checks passed: [expected/measured results](../validation/latest.md).
- **124/124** scale checks passed, including 782 parameter boundary cases: [results](../validation/scaling.md).
- All **nine** challenge reference outcomes matched their recorded scores.
- All **76/76** Chromium production workflows passed in one full run, including the new devices' import/save/replay cases and the existing starter/drive, hydraulic and spatial workflows.
- `git diff --check` passed.

Earlier candidates exposed the pre-existing masked-validator/convergence-report issues and the missing new-example browser expectations described below. The successful full run includes those corrections. The production build retains Vite's non-blocking bundle-size warning; no deployment was performed.

## Focused checks

`VITEST_MAX_WORKERS=1 npx vitest run src/simulation/components-next.test.ts`: **16/16 passed**. Coverage includes an independent analytic battery discharge curve, chemical/thermal conservation, empty/full charge boundaries, paused refresh/reset, contactor coil demand and isolation, pickup/dropout delays, transformer load reflection/reverse transfer/no-load losses/grounding, rectifier harmonic current and heat, radiator outlet temperature against the exponential law, reverse flow, failed-fan demand and deterministic replay. DC-only devices and DC transformer excitation fail explicitly outside their supported supply models.

`scripts/e2e.sh e2e/components-next.spec.ts`: **4/4 production-browser workflows passed**. Every new example runs through the real UI, displays device measurements and resets without page errors.

The four new cases in the shared `stabilization.spec.ts` starter workflow also passed on focused rerun. Each imports its checked-in JSON, advances at least 60 simulated seconds, verifies an independent measurement range, saves a live archive, reloads/replays it and resets. The shared expected-value table now covers the additional examples.

`node scripts/parameter-audit.mjs`: **62 kinds / 456 parameters**, with all catalog defaults covered.

## Example campaigns

`PHYSICS_EXAMPLES=battery,contactor,transformer,radiator node scripts/check-examples.mjs`: all four ran for 60 simulated seconds with no errors, rating violations, failed components or non-finite probes. [Raw results](../validation/examples.json) include the existing examples as well.

| Example | Result | Whole-system energy residual |
| --- | --- | ---: |
| Battery | SOC 80% → 62.79737%; external supplied energy 0 J | 7.02e-10 J |
| Contactor | Coil 23.99833 V; contact closed; load 23.98001 W | 1.44e-10 J |
| Transformer | Secondary 23.97819 V; load 23.95640 W | 4.58e-11 J |
| Radiator | Outlet 58.76917°C; water 45.71340 L/min; rejected heat 3,937.85 W; fan 30 W | 0.01909 J |

Radiator mass residual was 2.27e-13 kg. Residuals are numerical conservation diagnostics, not manufacturer accuracy estimates.

Additional engine checks passed: two cascaded ideal-ratio transformers delivered exactly 24 V from 240 V, both isolated and with explicitly shared grounds, with zero electrical power residual. A small battery discharged completely with directional cutoff and 7.01e-11 J energy residual. Water initially at 10°C gained heat from 30°C radiator ambient: outlet 10.68385°C, signed duty −1,965.85 W and energy residual −3.27e-6 J.

An integrated two-second circuit used all four new devices: a small battery powered a 12 V contactor coil and radiator fan, the contactor switched the AC transformer's primary, and transformer heat entered the water circuit. The contactor picked up, then released after battery depletion; final fan power and transformer load current were zero. With the battery's full OCV configured at the fan's 12 V rating, there were no violations, mass residual was zero and energy residual was −0.000389 J.

## Existing defects and validation corrections

- Interacting CV/CC supplies previously produced the wrong current direction; delivery and absorption complementarity are now checked separately. Repeated active states and exhaustion fail explicitly.
- Dense numerical solves now scale equations/unknowns, check relative pivots and normalized backward errors, and refine poorly scaled real systems. Original component energy/convergence tolerances are retained.
- The release script previously masked physics-validator and build failures through Bash `&&` lists. Stubbed failures now propagate exit codes 17 and 23 respectively; the success case alone prints the success message.
- The existing hydraulic startup report failed on the unchanged baseline because it assumed a particular finite-reference error ratio. Every absolute accuracy bound remains; the revised check requires actual error contraction and reports the raw errors/ratio. See [the model discussion](DEVICES.md).
- The in-app model guide and example notes now describe the implemented starters/drives, supply starting allowance, variable water density/viscosity, vessel storage and approximate cavitation curve. New-device guidance and the energy panel explicitly include battery chemical storage and radiator fan heat.

The regression campaign covers the existing electrical, AC/induction/starter/drive, thermal, hydraulic, mechanical, automation, protection, persistence and scored-assignment models. It does not certify all possible component combinations or omitted chemistry, switching, saturation, airflow or transient phenomena.
