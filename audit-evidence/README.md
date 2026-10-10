# Audit evidence

Collected on 2026-10-09 from the actual deployed application over HTTP after the supplied HTTPS URL failed. Browser: Playwright-driven Chromium 156.0.8078.4, Linux, 1600×1000 desktop and 390×844 mobile. Application code was not edited.

The two root Markdown reports are the authoritative synthesized findings. JSON observations retain full precision and separate timestamps/values from interpretation. Screenshots support specific UI findings. Scenario `.physics.json` files can be opened directly through the application's Open control. Live archives additionally reconstruct elapsed inputs/state and may take longer to import.

## Main evidence sets

- `observations.json`: UI-built resistance networks and initial heating/inertia/energy tests.
- `extended-observations.json`: exact series import, real junction-mediated short, resistor overload, closed-loop faults, hydraulic controls/save/replay, industrial/circulation and challenges 001–002.
- `runaway-observations.json`: corrected full challenge 003 completion, including manual recovery.
- `challenge-observations.json`: UI-wired challenges 004–009 and mechanical experiments.
- `mechanical-observations.json`: an additional independent browser run of 007–009 and mechanical examples; output fixture filenames may be shared by these deterministic reruns.
- `edge-observations.json`: independent hydraulic sweeps, dry source, cooling, water validity limit, mixing, timer speed runs, malformed imports, duplication/assemblies, node probes, mobile and pending-wire crash.
- `verification-observations.json`: fuse, voltmeter, live source editing, pause, keyboard wiring and import constraint attempts.
- `performance-observations.json`: isolated short 4/100-component samples and follow-up short display observation. App-reported FPS/solver readings are samples, not independently measured percentiles.
- `recovery-observations.json`: controlled short→Undo recovery after 100 ms settling. An earlier immediate read in performance observations still saw the old error; the settled rerun establishes recovery.
- `editing-observations.json`: move/rotate/delete/undo/zoom gestures on an actual connected circuit.
- `reference-calculations.py` / `reference-results.json`: independent thermal matrix exponential/cooling reference and extracted observations. The reference computation does not import production simulation code.
- `measurements.csv`: actual browser-exported CSV.
- `access-checks.txt`, `remote-index.html`, `remote-app-bundle.js`, `remote-app-sha256.txt`: deployment provenance and HTTPS failure details.
- `local-unit-tests.log`: newly run local suite; local and deployed builds were not assumed identical.

## Reproduction without the audit harness

For the main crash, load the normal heating starter, click source positive once, then New empty experiment. The blank root is in `21-pending-wire-crash.png`.

For stale electrical results, import `E05-short.physics.json`, or construct a short from `E01.physics.json` through a junction. The source diagnostic is valid; canvas/API readings are obsolete. Detailed inspector electrical rows already show unavailable values. Undo can restore the valid circuit.

For the meter headline, import `E02-meter.physics.json` and select VM-01. The voltage is about 6 V but the inspector headline shows 20°C.

For mobile overlap, import the heating starter, add a differential node-voltage trace, advance 2 s, and inspect at 390×844.

## Harness and limitations

The `.mjs` files are audit scripts, not application changes or newly installed production tests. They use local Playwright. They capture the app's public modelContext registration to read full-precision measurements and advance long paused runs. They use real UI actions for construction, import, faults and other editor interactions.

Some script modules reference temporary schema bundles created during the audit. To recreate them, bundle the existing `src/simulation/projects.ts` with esbuild to `/tmp/physics-audit-projects.mjs`; the schema bundle additionally exports `makeComponent`, `connect` and `definitions` from `src/simulation/model.ts` into `/tmp/physics-audit-schema.mjs`. These are fixture-generation helpers only, not substitute simulation implementations. Saved scenario files are self-contained and do not require those bundles.

This environment needed extracted browser libraries plus a minimal fontconfig file in `/tmp/physics-browser-libs`. That setup issue is not a product defect. The scripts are useful reproducibility records, not a polished portable test suite.

Exploratory script failures are retained in logs: SVG innerText use, an absent status toast locator, and initial pointer obstruction due to overlapping click insertion. Corrected reruns and their interpretation are identified in the report. Do not treat every harness timeout as a product failure.
