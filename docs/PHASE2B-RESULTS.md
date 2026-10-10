# Executed Phase 2B validation and deployment

Preflight: 63 existing tests and 32 quantitative scenarios passed before edits. All results below refer to executed commands, not planned checks. The complete regression run executed 87/87 regression tests and 60/60 quantitative checks. All 17 production Chromium workflows passed, including all six playable challenges. After final readout corrections, the focused hydraulic suite passed 24/24 tests, including zero-input motor efficiency and empty-fluid temperature validity. Two production smoke workflows were rerun after deploying the final assets.

Raw execution logs: [complete physics run](../validation/phase2b-physics.txt), [17 production browser workflows](../validation/phase2b-browser.txt), [final hydraulic checks](../validation/phase2b-focused.txt), [final deployment smoke](../validation/phase2b-smoke.txt).

Machine-readable execution summary: [phase2b-summary.json](../validation/phase2b-summary.json).

## Complete coupled reference experiments

Executed `npm run validate:coupled`; full raw state/metrics: [phase2b-coupled.json](../validation/phase2b-coupled.json).

| Experiment | Simulated duration | Completion | Mass residual | Energy residual | Observations |
| --- | ---: | --- | ---: | ---: | --- |
| 004 Water Transfer | 144.3167 s | 91/100, 3 stars | −1.02e−8 kg | −0.02870 J | At least 100 L transferred from finite lower source to 2 m elevated destination; actual motor/shaft/pump network |
| 005 Pressure Control | 194.9833 s | 91/100, 3 stars | 2.09e−9 kg | −0.19982 J | 180 scored seconds; 96.59% within ±10% of 0.35 bar; RMS ~2.29 kPa; max overshoot ~9.76 kPa; distinct real consumer flows in both demand phases |
| 006 Automated Supply | 720 s | 96/100, 3 stars | −1.11e−8 kg | −0.02908 J | 600 scored seconds; 99.73% in band; two motor transitions; primary level sensor invalid at 300 s; demand continues from finite buffered storage |
| Heated circulation | 60 s | Stable, no violations | −3.13e−9 kg | −0.03100 J | Powered heater/motor/pump, two finite tanks, enthalpy circulation and cooling return line |

Node wall times in the final recorded run were approximately 22.3 s, 22.8 s, 96.0 s and 18.3 s respectively. These are full scenario timings on a shared CPU, including monitoring/scoring, not a browser FPS benchmark. Browser production execution is slower due to rendering/telemetry, and remains responsive through yielded advance chunks. No worker rewrite was justified for these reference scene sizes; larger scene profiling remains pending.

## Executed production browser workflows

The full 17-test Chromium suite passed against the Docker production server in 4.9 minutes: hydraulic starter/valve/faults, live hydraulic archive restore, manual terminal construction of Challenge 004, changing-demand Challenge 005, injected-sensor-fault Challenge 006, heating transport, both original construction challenges, editor/undo/zoom/placement, scenario import/CSV, thermal replay, browser tool interface, mobile layout, independent protection, assemblies/node probes, wire bends, and Thermal Runaway fault/manual recovery. Production Challenge 004, 005 and 006 took approximately 44.2 s, 55.4 s and 2.3 min wall time respectively on the shared test environment. Those figures include full charts and UI updates, not just solver execution.

After this full run, hydraulic overlay labels were corrected to show hydraulic pressure/shaft power rather than generic electrical captions, and unavailable empty/no-flow fluid temperatures now return an unavailable probe value. Motor efficiency now uses calculated shaft/electrical power and reports unavailable when electrical input is zero. Solver dynamics and challenge scoring were unchanged by these final display corrections. The final focused suite covers the temperature and motor-efficiency validity rules, static tank pressure in bar, calculated signed tank inventory flow, isolated-tank pressure-rating alarms, and challenge identity locking when a scored configuration is first adopted.

## Model and integration coverage

The regression suite covers MNA power/current/node references and protection; backward-Euler thermal and independent safety; all existing control primitives; state edit/import integrity; Darcy/laminar/transition/reverse-flow laws; parallel junction continuity; tank empty/full events at dt=0.1,0.05,1/60 s; mass-weighted mixing; motor startup, back EMF, defined load, stall and energy; bidirectional electrical/mechanical/pump loading; valve response and actual current change; power-loss coasting; thermal fluid circulation; failed hydraulic sensors; explicit depletion export; deterministic replay/archive restoration; autonomous challenge locks and rating/demand/budget/domain exploits.

The quantitative report retains all 32 earlier checks and adds raw coupled mass/energy errors and volume/current/speed/temperature comparisons over refined timesteps. The 1/60,1/120,1/240 outer mechanical results share internal 1/240 steps; 1/480 and 1/960 refine actual coupling. The volume-error reduction is tested against the 1/960 reference rather than inferred from a lack of crashes. See [executed numerical values](../validation/latest.md).

## Production and environment

`npm run build` completed successfully: 1,603 transformed modules, approximately 438.58 kB JavaScript (135.86 kB gzip) and 41.46 kB CSS (9.80 kB gzip). The final TypeScript/Vite assets are served by the existing multi-stage Docker/nginx deployment. `docker compose up -d --build` executed successfully using the user's already authorized `docker` group via `sg docker`. Container `physics-lab-physics-lab-1` reported healthy, published port 8080, and returned HTTP 200. No external hosting account was used.

Chromium initially could not launch because shared libraries were absent; after local extraction it needed fontconfig setup too. The successful browser environment uses preexisting Debian packages extracted under `/tmp/physics-browser-runtime`, `LD_LIBRARY_PATH=/tmp/physics-browser-runtime/usr/lib/x86_64-linux-gnu`, and `FONTCONFIG_FILE=/tmp/physics-fontconfig.xml`. This changes no system packages. Production tests use `PHYSICS_LAB_URL=http://localhost:8080`. A preliminary development-server run was interrupted by source hot reload during an experiment; production validation avoids that moving target.

## Larger-motor follow-up validation

Added 48 V traction and 180 V industrial DC catalog variants, a matching 80 A supply, an industrial pump and the wired industrial pumping station starter. `npm run test:physics` was rerun: **91/91 tests and 60/60 quantitative checks passed**. Four added tests cover loaded analytical motor equilibria, back EMF, shaft work and conservation, finite industrial transfer, valve/current feedback, save/load and catalog/challenge integrity. A production Playwright test passed for search, motor selection, industrial startup and calculated flow/shaft power. The production build passed (440.78 kB JavaScript, 136.49 kB gzip); Docker was rebuilt and reported healthy on port 8080.

An executed 15 s reference run through 30 m of 50 mm piping to a destination 12 m higher produced 307.37 L/min, 2,620 RPM, 9.70 A, 1,313 W shaft input and 830 W hydraulic output. At 10% valve opening, the separate run produced 102.84 L/min, 2,719 RPM and 7.80 A, reflecting this particular pump's changed torque demand. Both runs had no violations. Energy residual magnitudes were 0.0213 J and 0.0024 J; mass residuals were below 1e-10 kg. Raw values are in [industrial-motors.json](../validation/industrial-motors.json). These are measured operating points for illustrative model parameters, not equipment nameplate promises. The earlier full browser results above predate this addition; the new industrial workflow was executed separately.

## Limits and remaining work

No known mass/energy violation occurs in the reference experiments. Supported model limitations remain: zero pipe inventory/travel time; constant water properties; vented bottom-port tanks only; port closure at full/empty; quasi-steady armature/ideal PWM; no actuator supply-power model; no cavitation/NPSH/water hammer/turbine behavior; illustrative pump coefficients; external prescribed shaft torque; first-order storage/head splitting; ideal cooling reservoirs; PI output unit inference omitted; archive replay bounded to two hours and browser import bounded to 2 MB. The longest new hydraulic validation is 720 s, not two hours. No maximum-size-network or mobile hydraulic challenge performance claim is made. Full details and Phase 3 priorities are in [PHASE2B.md](PHASE2B.md); component omissions are explicit in [COMPONENT-MATRIX.md](COMPONENT-MATRIX.md).
