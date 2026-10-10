# PHYSICS LAB — DEVELOPER ACTION PLAN

Prioritized implementation backlog from the independent browser audit of 9 October 2026. No application changes were implemented. The human report is [PHYSICS_LAB_INDEPENDENT_AUDIT.md](PHYSICS_LAB_INDEPENDENT_AUDIT.md). All evidence is in [audit-evidence](audit-evidence/).

Use the actual deployed revision as the reference. Local source/dist differed from the deployed assets; filenames below identify candidate areas, not a guarantee of matching deployed lines. Complexity: S≈1–2 days, M≈3–7 days, L≈2–4 weeks, XL=design/research required. Estimates exclude organizational delays.

## Immediate fixes and stabilization

### PHY-001 — Replacing a project with an unfinished wire blanks the entire application

- **Priority:** P1 — High; **complexity:** S–M.
- **Affected area:** Workspace pending terminal state; project load/new/import transitions.
- **Precise change:** Clear project-bound transient editor state whenever project identity changes; guard lookup before rendering pending previews; add a recoverable application error boundary.
- **Rationale:** A routine construction transition loses the working interface and exposes unsaved work to loss.
- **Reproduction:** 1. Open the heating starter. 2. Click PS-01 positive terminal once, leaving the wire preview active. 3. Click New empty experiment.
- **Observed result:** The root UI disappears. An uncaught exception says “Cannot read properties of undefined (reading 'kind')”. Reloading the page is required.
- **Acceptance criteria:** New, challenge switch and import while a wire is pending never throw; the replacement project renders; no terminal from the previous project remains pending. Recovery UI can preserve/export valid project state after an unexpected render exception.
- **Required automated tests:** Browser tests for pending wire followed by New, valid import, challenge start and device recovery; assert no pageerror, visible canvas and cleared preview.
- **Dependencies:** None.
- **Evidence:** edge-observations.json: pending-wire-crash and pageerror; 21-pending-wire-crash.png. Also encountered independently during the first electrical construction session.
- **Cause hypothesis:** Hypothesis, supported by local source: Workspace holds pending in component state and dereferences a component from the replacement project using a non-null assertion (src/components/Workspace.tsx, pending preview). The local source is not proven identical to the remote build.

### OPS-001 — The supplied HTTPS entry point does not serve TLS

- **Priority:** P1 — High; **complexity:** S–M.
- **Affected area:** Public endpoint and reverse proxy.
- **Precise change:** Provide TLS termination at the intended public entry point and align shared links with the canonical deployment URL. Verify static assets under that origin.
- **Rationale:** The advertised entry point is inaccessible. The HTTP fallback was necessary to conduct this audit.
- **Reproduction:** Navigate to https://fracht.lennartobst.de:8080 in Chromium, or run curl -I against that exact URL.
- **Observed result:** Chromium reports net::ERR_SSL_PROTOCOL_ERROR; curl reports TLS wrong version number. http://fracht.lennartobst.de:8080 returns HTTP 200 and serves the working app.
- **Acceptance criteria:** The exact supplied HTTPS URL loads the application with a browser-trusted certificate and successful JS/CSS requests; any canonical redirect remains HTTPS.
- **Required automated tests:** External deployment smoke test using certificate validation and a real Chromium navigation; verify the application canvas and asset status codes.
- **Dependencies:** Hosting / DNS / TLS configuration access.
- **Evidence:** access-checks.txt; remote-index.html. Browser 156.0.8078.4 reproduced the exact HTTPS error before HTTP testing.
- **Cause hypothesis:** Hypothesis: the listener on port 8080 serves plaintext HTTP rather than TLS.

### PHY-002 — Failed electrical solves retain apparently valid live readings

- **Priority:** P2 — Medium; **complexity:** M.
- **Affected area:** Electrical solve failure, inspector, canvas, probes, measurement tool and CSV.
- **Precise change:** Attach solution status and revision to calculated outputs. Invalidate dependent readings on failure and propagate that validity through every presentation/export route; preserve last-valid data only behind an explicit label.
- **Rationale:** An engineer can mistake an obsolete solution for the result of the displayed topology. Zero residual values also cease to mean a successful current solve.
- **Reproduction:** 1. Import audit-evidence/E01.physics.json (12 V, 6 Ω). 2. Add a wire junction. 3. Wire source positive to the junction and the junction to source negative. 4. Inspect the resistor and source.
- **Observed result:** The correct short-circuit diagnostic appears and running is prevented, but the read API retains 12 V, 2 A and 24 W with voltageValid=true from the old solution. The canvas still shows those values, and the selected junction shows HEALTHY / 12.00 V. Follow-up confirmed that the resistor inspector's detailed electrical rows already show unavailable values; invalidation is inconsistent across surfaces.
- **Acceptance criteria:** For a shorted source no current-solution electrical numeric value is shown as valid. Diagnostic names PS-01 and the remedy. Undo restores the original 2 A / 24 W solution without reload.
- **Required automated tests:** Browser and engine tests: valid circuit → short → failed solve → inspector/probes/tool/CSV validity → undo → valid solve. Also test conflicting ideal sources.
- **Dependencies:** None.
- **Evidence:** extended-observations.json: E05-real-short, E05-real-short-ui, E05-run; 07-real-short.png; E05-short.physics.json. Follow-up evidence: performance-observations.json and 25-stale-short.png; recovery-observations.json confirms Undo recovery after UI settling.
- **Cause hypothesis:** Hypothesis: the failure path stores an error while leaving the previous electrical result and validity flags intact.

### UX-001 — Click-to-add overlaps components and obstructs selection

- **Priority:** P2 — Medium; **complexity:** M.
- **Affected area:** Library click placement and schematic layout.
- **Precise change:** Find an unoccupied snapped component footprint near the visible canvas center, or enter a clear placement mode after a library click.
- **Rationale:** The documented simple click workflow immediately creates cleanup work and obscures terminals and labels.
- **Reproduction:** 1. Create a new empty experiment. 2. Click DC power supply in the library. 3. Click Resistor. 4. Try selecting the source at its center.
- **Observed result:** At 1600×1000, source transform is translate(320,240), resistor translate(280,240); their bodies substantially overlap. In the earlier session the resistor intercepted the attempted source click. Drag placement provided a working workaround.
- **Acceptance criteria:** Click-add ten mixed components into an empty viewport without overlapping selectable bodies; all remain selectable or are included by Fit experiment. Manual drag placement still works.
- **Required automated tests:** Browser layout test comparing component bounding rectangles after repeated click additions, with rotation and non-default zoom.
- **Dependencies:** Geometry / viewport bounds.
- **Evidence:** edge-observations.json: click-placement; 22-click-overlap.png; electrical-blocked.png from the initial exploratory session.
- **Cause hypothesis:** Hypothesis: placement offsets vary with component count without testing existing bounds.

### UX-002 — Mobile telemetry labels and controls overlap

- **Priority:** P2 — Medium; **complexity:** M.
- **Affected area:** Telemetry header and trace readouts.
- **Precise change:** Stack telemetry metadata and controls; wrap trace readouts into distinct rows with stable label/value/unit columns. Offer a taller or collapsible chart panel.
- **Rationale:** Users cannot reliably associate a value with its signal on a small screen.
- **Reproduction:** 1. Open the heating starter. 2. Add a differential node-voltage trace from source negative to heater positive. 3. Run/advance two seconds. 4. Set viewport to 390×844.
- **Observed result:** History timestamp/readouts and trace labels visibly overprint each other near the top of the telemetry panel. Body scrollWidth remains 390 px, so an overflow-only test misses the defect.
- **Acceptance criteria:** At 390×844 and 360×800, three mixed-unit traces have non-overlapping labels, values and controls; keyboard focus remains visible; no horizontal page overflow.
- **Required automated tests:** Responsive browser tests asserting disjoint relevant DOM bounding boxes, plus reviewed screenshots at both sizes. Include longer user trace names.
- **Dependencies:** None.
- **Evidence:** 20-mobile.png; edge-observations.json: UX-node-probe, mobile-dimensions; measurements.csv.
- **Cause hypothesis:** Hypothesis: desktop flex/absolute layout retains incompatible widths at the mobile breakpoint.

### UX-003 — Permanent starter and assembly controls crowd out the component catalog

- **Priority:** P2 — Medium; **complexity:** S–M.
- **Affected area:** Library layout.
- **Precise change:** Move starters into an Experiments menu or collapsible region and collapse assembly authoring until selected. Give the catalog the remaining vertical space.
- **Rationale:** Discovering 39 catalog entries requires disproportionate scrolling. Starter shortcuts dominate the construction tool they are meant to support.
- **Reproduction:** Open the default workspace at 1600×1000 and inspect the library. Browse the Electrical group without search.
- **Observed result:** The library scroll area is about 241.6 px high while the permanent starter/assembly tools consume 318 px. Only roughly three standard catalog rows are initially visible below the category heading.
- **Acceptance criteria:** At 1600×1000 the collapsed default library allocates at least 450 px to the catalog; every starter remains reachable within two clicks and keyboard navigation.
- **Required automated tests:** Browser layout assertions at 1600×1000 and 1280×720; smoke-test starter navigation and saved assembly insertion after rearrangement.
- **Dependencies:** None.
- **Evidence:** 01-initial.png; verification-observations.json: desktop-ui-metrics.
- **Cause hypothesis:** Hypothesis: all starter buttons and assembly tools sit in a fixed non-scrolling footer.

### INS-001 — Voltmeter inspector headlines temperature instead of measured voltage

- **Priority:** P2 — Medium; **complexity:** S.
- **Affected area:** Inspector primary reading selection for meter components.
- **Precise change:** Choose primary measurement by component purpose: meter voltage first, with explicit differential reference semantics; keep temperature in auxiliary telemetry.
- **Rationale:** The instrument's most prominent value communicates the wrong physical quantity even though its underlying electrical calculation is correct.
- **Reproduction:** Import audit-evidence/E02-meter.physics.json and select VM-01. The 10 MΩ meter is wired across one 6 Ω resistor in a 12 V series circuit.
- **Observed result:** The inspector headlines 20.00°C and Thermal state. The actual 6.000 V reading appears only in the smaller measurement list.
- **Acceptance criteria:** Selecting VM-01 in the fixture prominently shows 6.00 V rather than 20.00°C. Open/floating/invalid conditions display unavailable voltage with a clear reason. Meter thermal accounting remains unchanged.
- **Required automated tests:** Browser tests for meter primary value/unit under a known divider, open input and failed circuit; retain engine loading test with 10 MΩ input.
- **Dependencies:** Primary measurement metadata.
- **Evidence:** verification-observations.json: meter; 23-meter.png; E02-meter.physics.json.
- **Cause hypothesis:** Hypothesis supported by local Inspector source: isThermalMass takes precedence in primary-reading selection, and the voltmeter inherits passive thermal mass.

### SCI-001 — Timer event timestamps precede the configured delay by one fixed step

- **Priority:** P3 — Low; **complexity:** S–M.
- **Affected area:** Automation transition logging and time semantics.
- **Precise change:** Define start/end-of-step event semantics and timestamp interval-completion transitions at the effective boundary. Use integer ticks or explicit tolerances for duration thresholds.
- **Rationale:** Users comparing protection timing against specification see an apparent premature transition.
- **Reproduction:** Import timer-1.physics.json: a 20°C tank sensor drives a true <80 comparator and a TON timer with delay=1 s. Run at 0.25×, 1× and 4× and inspect Event log.
- **Observed result:** All three runs log TM-01: ON at 00:00:00.98. This is speed-independent, but about 1/60 s before the nominal threshold. No claim is made here that the physical output itself triggers early: the exposed measurement tool does not return timer memory.
- **Acceptance criteria:** A timer asserted at t=0 with a 1 s delay logs its effective transition at t=1 s within floating-point tolerance, consistently across speeds; no fixed step is counted twice.
- **Required automated tests:** Single-step timer tests checking the output before and after tick 60, exact event time, reset, TOF and pulse behavior; browser speed comparison.
- **Dependencies:** Agree event boundary semantics.
- **Evidence:** edge-observations.json: A05-timer-0.25, A05-timer-1, A05-timer-4; timer-*.physics.json.
- **Cause hypothesis:** Hypothesis supported by local source: automation consumes dt and logs at the step-start time before the engine increments time.

### UX-004 — Technical identifiers and very small canvas text weaken measurement readability

- **Priority:** P3 — Low; **complexity:** S–M.
- **Affected area:** Inspector measurement names, schematic captions and reference consistency.
- **Precise change:** Create contextual display labels and descriptions for every measurement. Keep identifiers in exports only when accompanied by a schema. Prioritize readable values when fit zoom shrinks symbols.
- **Rationale:** Users must translate internal identifiers and infer irrelevant contact terminology while interpreting results.
- **Reproduction:** Inspect a water tank and heater in the default 78% fitted workspace.
- **Observed result:** The inspector exposes identifiers such as fluidTemperature, transferredVolume and massResidual. Ordinary resistor/heater/source currents share the relay-oriented label “NO / branch current”. Small canvas annotations are difficult to read in the default fitted view.
- **Acceptance criteria:** Tank properties read “Fluid temperature”, “Transferred volume” and “Mass balance residual”; current labels distinguish source, passive branch, motor armature/bus and relay NO/NC. Primary values remain readable at default fit.
- **Required automated tests:** Label mapping tests for component families and browser screenshots at desktop default fit and 200% browser zoom. Do not infer full accessibility compliance from those tests.
- **Dependencies:** Measurement metadata.
- **Evidence:** 01-initial.png; observations.json: initial-text and heater-fields; verification-observations.json: desktop-ui-metrics. This is a readability review, not a measured contrast-compliance failure.
- **Cause hypothesis:** Hypothesis: labels fall back to measurement identifiers and a shared relay-current string.

## Further stabilization and scoped feature work

These tasks address coverage or product depth. They are not claims that absent advanced models are broken.

### STAB-001 — Publish deployed build identity and pin replay compatibility

- **Priority:** P2; **complexity:** M.
- **Affected area:** Deployment metadata, reference/version UI, archive headers.
- **Precise change:** Expose application version, source revision, build timestamp and solver-schema version. Include a compatible engine identifier in run archives; explicitly reject or migrate unsupported replay engines.
- **Rationale:** Current UI LAB ENGINE version does not establish which changed local source matches the remote bundle. Reproducible evidence and replay need a pinned numerical engine.
- **Acceptance criteria:** A deployed build can be identified from the UI/export; an archive from an incompatible engine cannot silently earn scores under changed semantics.
- **Required automated tests:** Build metadata smoke test; compatible/incompatible archive loader tests; migration fixture if compatibility is supported.
- **Dependencies:** None.

### STAB-002 — Maintain independent analytical and convergence cases

- **Priority:** P2; **complexity:** L.
- **Affected area:** Physics tests and validation documentation.
- **Precise change:** Add analytical DC, matrix-exponential thermal, Newton-cooling and gravity references independent of production solver code. Add a supported test-only substep refinement sweep for free fall and a dissipative spring. Publish absolute/relative error and residual tolerances per model.
- **Rationale:** Free-fall y error is−0.01021526 m and energy deficit 13.52396 J after 1 s for 135 kg. Correct DC/thermal checks do not certify mechanics.
- **Acceptance criteria:** Baseline fixtures reproduce audit results; halving the first-order free-fall integration step reduces position error by approximately 2×; numerical residual is reported separately from physical heat; failures break CI.
- **Required automated tests:** Parameterized reference comparisons over mass/power/UA scales; dt,dt/2,dt/4 convergence tests; long conservative and dissipative trajectories.
- **Dependencies:** STAB-001; preserve existing residual definitions before numerical edits.

### STAB-003 — Expand cross-domain persistence and transition regression coverage

- **Priority:** P2; **complexity:** M–L.
- **Affected area:** Store, replay, importer and challenge integrity.
- **Precise change:** Add browser round trips for thermal cutoff, mechanical rotor impulse and hydraulic live control; add malformed archive/input/fault histories. Assert time, inventory, thermal state, shaft state and scoring after reconstruction.
- **Rationale:** The hydraulic 40 s round trip passed, but it does not cover every live state or adversarial archive. Project-transition crash reveals a regression gap.
- **Acceptance criteria:** Valid runs reconstruct matching quantities within explicitly documented tolerances; invalid archives preserve current project and expose actionable errors; forged dynamic scores are ignored.
- **Required automated tests:** Browser save/import/replay for each domain; tampered challenge conditions, invalid input timestamps, nonfinite values and unsupported engine IDs.
- **Dependencies:** PHY-001, STAB-001, SCI-001.

### STAB-004 — Clarify measurement definitions and pump efficiency schema

- **Priority:** P3; **complexity:** M.
- **Affected area:** Measurement tool schema, inspector/probe metadata and CSV.
- **Precise change:** Document units, signs, references and validity for every output. Rename raw pump curve efficiency to an explicit internal-efficiency field; expose total hydraulic/shaft efficiency separately. Distinguish Celsius map values from Kelvin tank state in machine-readable results.
- **Rationale:** Baseline tool curve efficiency≈69.93% differs from total 16.504/59.908≈27.55%; UI uses total ratio. Unnamed distinctions invite incorrect downstream calculations.
- **Acceptance criteria:** Schema unambiguously names both efficiencies and temperature units; zero-flow total efficiency is 0 when shaft power is positive; invalid states remain invalid.
- **Required automated tests:** Schema tests and known pump/zero-flow examples; source-delivery sign and Celsius/Kelvin conversion cases; CSV unit/header consistency.
- **Dependencies:** PHY-002; coordinate backward compatibility with STAB-001.

### FEAT-001 — Add live rheostat and three-terminal potentiometer

- **Priority:** P2 feature; **complexity:** M.
- **Affected area:** Catalog, MNA resistor branches, property/replay rules.
- **Precise change:** Add a bounded live variable resistor and a potentiometer composed of two linked resistive branches, with ratings and wiper limits.
- **Rationale:** These are foundational DC experiments that can reuse the resistive solver; current general resistance editing requires Reset after advancement.
- **Acceptance criteria:** A12 V rheostat at 6/12 Ω gives 2/1 A; an unloaded midpoint potentiometer gives 6 V; loading and end stops are finite and documented; replay preserves wiper changes.
- **Required automated tests:** Analytical loading/network tests, endpoint conditioning, overload and live undo/replay tests.
- **Dependencies:** PHY-002, measurement metadata.

### FEAT-002 — Add an independent DC current source

- **Priority:** P2 feature; **complexity:** M.
- **Affected area:** Electrical MNA, catalog and diagnostic UI.
- **Precise change:** Stamp a signed independent DC current source with clearly documented compliance/ideal behavior and singular-topology diagnostics.
- **Rationale:** Adds useful Norton/source/network experiments without requiring transient electronics.
- **Acceptance criteria:** A2 A source through 6 Ω yields 12 V and 24 W; a1 A split into equal 6 Ω branches yields 0.5 A each; unsupported open ideal-source topology produces no invented voltage.
- **Required automated tests:** Analytical current-source networks, polarity, mixed-source consistency and invalid/compliance tests.
- **Dependencies:** PHY-002; conditioning tests in STAB-002.

### FEAT-003 — Add resettable overcurrent protection and motor starter exercises

- **Priority:** P2 feature; **complexity:** M–L.
- **Affected area:** Protection models, automation and catalog.
- **Precise change:** Implement a documented resettable breaker with simulation-time trip/reset semantics. Add a starter exercise using existing relay, interlock and motor before introducing contactor-coil realism.
- **Rationale:** Fuse fail-open is useful but cannot demonstrate reset/selectivity or conventional starter protection workflows.
- **Acceptance criteria:** Breaker interrupts the actual power path; reset under an active unsafe condition immediately retrips or is rejected by documented rules; independent protection survives welded control contact.
- **Required automated tests:** Trip-curve boundary, live reset, fault, timing-speed invariance and replay tests; causal interruption challenge test.
- **Dependencies:** SCI-001, PHY-002, existing independent cutoff contracts.

### FEAT-004 — Add electrical cable resistance and rating models

- **Priority:** P2 feature; **complexity:** M–L.
- **Affected area:** Electrical catalog, branch model and thermal storage.
- **Precise change:** Provide a cable component with length, cross section, material resistivity and thermal/current rating; keep canvas route separate from physical cable length.
- **Rationale:** Ideal wires hide voltage drop and distribution losses; the existing hydraulic pipe configuration establishes a useful UI pattern.
- **Acceptance criteria:** Cable R=ρL/A; I²R heating is counted once; a measured load voltage drop matches an analytical circuit; display metadata never changes physical length implicitly.
- **Required automated tests:** Analytical cable/load networks, heat balance, rating exposure, parameter lock and save/replay tests.
- **Dependencies:** STAB-002 and PHY-002.

### FEAT-005 — Expose score deductions and add intermediate control assignments

- **Priority:** P2 feature; **complexity:** M.
- **Affected area:** Challenge definitions, result UI and learning feedback.
- **Precise change:** Show per-term energy, time, economy, regulation and switching contributions after each win/failure. Add a basic thermostat and sensor-fault exercise between heating and Thermal Runaway, plus optional blank-design variants.
- **Rationale:** The audited lift scored 75 while a prepared light loop scored 93; raw stars alone do not teach which engineering tradeoff caused the deduction.
- **Acceptance criteria:** Displayed rounded score equals the sum of documented terms; each failed mandatory rule names its actual value and bound; new tasks require actual feedback and cannot pass through preheated/reduced-mass imports.
- **Required automated tests:** Score recomputation fixtures; causal feedback/protection tests; locked-condition import tests; deterministic reset/replay scores.
- **Dependencies:** STAB-003, measurement metadata; no new solver required.

### FEAT-006 — Provide an explicit numerical accuracy setting for mechanics

- **Priority:** P2 feature; **complexity:** L.
- **Affected area:** Simulation settings, spatial substeps and validity UI.
- **Precise change:** After the convergence suite is established, expose a bounded mechanical accuracy/substep setting and document accuracy/performance tradeoffs. Preserve fixed simulation-clock semantics and archive the setting.
- **Rationale:** Free-fall results show a visible discretization error even without collisions. Users currently change speed, which does not refine dt.
- **Acceptance criteria:** A refined setting demonstrably reduces independently measured ballistic error; timing/control scenarios remain speed-independent; residual warnings are retained; archives identify the setting.
- **Required automated tests:** Convergence, mixed-domain timing, challenge comparability and save/replay tests at each supported setting; measured performance samples.
- **Dependencies:** STAB-001, STAB-002, SCI-001.

### RESEARCH-001 — Design nonlinear DC semiconductor support

- **Priority:** P3 research; **complexity:** XL.
- **Affected area:** Electrical solver architecture.
- **Precise change:** Specify diode/BJT/MOSFET constitutive models, Newton continuation/damping, validity limits and convergence diagnostics before adding catalog devices.
- **Rationale:** Semiconductor entries without a nonlinear solve would misrepresent engineering behavior.
- **Acceptance criteria:** An agreed design includes independent reference curves, singular/nonconvergent cases, thermal-power accounting and a reproducible implementation experiment; no decorative unsupported device is presented as working.
- **Required automated tests:** Design acceptance requires reference-curve and difficult-topology test plans; implementation must pass them before release.
- **Dependencies:** STAB-002, PHY-002.

### RESEARCH-002 — Design dynamic electrical state and initialization

- **Priority:** P3 research; **complexity:** XL.
- **Affected area:** Transient solver and archive state.
- **Precise change:** Specify capacitor charge and inductor flux/current state, stable implicit integration, initial conditions and source-switch discontinuities.
- **Rationale:** Reactive electrical experiments require a new state model, not just additional symbols.
- **Acceptance criteria:** RC/RL analytic transients and an undriven RLC energy case establish error/conservation envelopes across dt; initialization conflicts produce diagnostics.
- **Required automated tests:** Independent RC/RL/RLC transient and dt convergence tests, switch events, residual and replay tests.
- **Dependencies:** STAB-002; RESEARCH-001 if nonlinear switching devices are included.

### RESEARCH-003 — Design finite pipe inventory and phase-change scope separately

- **Priority:** P3 research; **complexity:** XL.
- **Affected area:** Hydraulic transport and thermal material state.
- **Precise change:** Create separate designs for finite-volume enthalpy transport and liquid/vapor phase change. Define conservation, CFL/implicit constraints, boundaries and unsupported regimes before implementation.
- **Rationale:** Current zero-volume pipes and 1–95°C liquid range are explicit simplifications, not broken features.
- **Acceptance criteria:** Each proposal has independent mass/energy reference cases and an explicit migration/validity policy; current supported liquid cases do not regress.
- **Required automated tests:** Finite-volume advection/mixing convergence and Stefan/latent-heat reference plans as applicable; dry/full boundary and integrated energy tests.
- **Dependencies:** STAB-002, stable transport accounting; independent numerical design reviews.

## Delivery order and verification gates

1. Resolve PHY-001 and OPS-001 independently; preserve current scenario data.
2. Define the solution-validity contract (PHY-002) and correct INS-001. Verify the supplied reproductions across canvas, inspector, tools and exports.
3. Stabilize construction/mobile/catalog and event timestamps. Pin the build and numerical references before changing integration behavior.
4. Broaden existing state/replay/challenge tests and publish bounded scientific accuracy.
5. Add foundational DC components and intermediate engineering exercises.
6. Start nonlinear/transient/transport research only with explicit validation contracts.

Do not repair numerical conservation error by silently adding fictitious heat, alter challenge mass/environment to make tests pass, or treat app-generated telemetry as an independent analytical reference. Existing local tests passed in this audit; add targeted regression cases for the uncovered failures.
