# Sandbox freedom & engineering scalability

This milestone turns PHYSICS LAB from a set of catalog experiments into a configurable engineering sandbox. It does this without rewriting the solvers and without weakening the scored challenges. This document covers the audit, the design, what changed, the validation evidence and what is still restricted.

Related, generated or executed artifacts:

- [`PARAMETER-MATRIX.md`](PARAMETER-MATRIX.md): generated coverage matrix of all 234 parameters of the 40 component kinds (`node scripts/parameter-audit.mjs`).
- [`../validation/scaling.md`](../validation/scaling.md): executed scale campaign (`node scripts/validate-scaling.mjs`).
- [`../validation/latest.md`](../validation/latest.md): existing executed physics validation (`npm run validate:physics`).

## 1. Three kinds of limit

| Kind | Where it lives | Behaviour when reached |
| --- | --- | --- |
| **Physical / numerical validity** (what the model can represent) | `ParamSpec.domain` in `src/simulation/parameters.ts`, plus `componentError()` in `integrity.ts` for dependencies between parameters | The edit or import is rejected, and the message names the reason (e.g. "Liquid-water model: … 1–95 °C", "must be strictly positive", "ε/D above 0.05 is outside the friction-factor correlation"). |
| **Engineering rating** (what is technically possible but out of specification) | Ordinary parameters (`ratedPower`, `ratedCurrent`, `ratedVoltage`, `maxPressure`, `maxPower`, `maxTemperature`, `maxSpeed`, `ratedTorque`) | Operation continues. The engine reports a rating violation and marks the component `OVERLOADED`. Failures happen only where a failure model exists: element overtemperature, a fuse's definite-time trip, a supply's output-protection trip. |
| **Challenge restriction** (gameplay) | `challengePolicies`, `catalogError()` and the challenge-only live/configurable sets in `integrity.ts` | Applies only when `project.challenge` is set. Ratings, source behaviour, environment and budgets are locked to the purchased catalog models. Sandbox projects never inherit these locks. |

## 2. Audit findings and what was done

### 2.1 Restrictions found in the original code

| Restriction found | Category | Action |
| --- | --- | --- |
| `propertyError` rejected every key outside two hard-coded sets ("defined by the catalog variant"), **including in the sandbox**. Heater power, every rating, thermal mass, motor constants, pump curves, valve K and source current limits were not editable. | Challenge rule leaking into the sandbox | Replaced by metadata-driven policies. The old sets now apply **only** inside challenges. |
| `parseProject` called `catalogError` on every import, so a sandbox file with custom ratings could not be loaded | Challenge rule leaking | Catalog checks run only for challenge projects. Sandbox imports are validated by domain and dependency rules. |
| Global `ranges` table: supply voltage 0–500 V, tank 0–10,000 L, `ratedPower` ≤ 100 kW, thermostat/safety setpoints 1–95 °C, ambient 1–95 °C, conductance ≤ 10 kW/K, pump flow ≤ 1 m³/s, torque constant ≤ 10 | Arbitrary / UI convenience | Replaced by per-kind validity domains with stated reasons (e.g. voltage ≤ 1 MV, tank ≤ 10⁹ L, setpoints above absolute zero, ambient −100…500 °C). |
| Supply overcurrent set `simulation.error` and **paused the experiment** | Arbitrary block | Ideal and internal-resistance supplies now trip their output protection (latched until reset) and the run continues. CV/CC and CC supplies regulate instead (§3.1). |
| Any element above `ratedPower`/`ratedCurrent`/`ratedVoltage` for 0.5 s "failed open" (heaters, lamps, resistors, motors, relay and switch contacts) | Fabricated failure | Now a reported rating violation with `OVERLOADED` status. Failure only follows the modelled element temperature (`maxTemperature`). Fuses keep their trip, with a configurable `tripTime`. |
| Heater: only 2 kW and 3 kW models; resistance and rating locked together by catalog | Scale mismatch | Heaters are defined by nominal voltage and power, with R = V²/P derived (§3.3). New 100 W, 12 kW, 30 kW and 100 kW catalog models, plus 8 presets. |
| Tanks: 20 L standard; capacity ≤ 10,000 L; no vessel mass; UA was a bare number | Scale mismatch | Vessel thermal mass and an optional insulation-derived UA added. 2,000 L and 10,000 L catalog models and presets from 1 L to 50,000 L. |
| Electrical connections were all ideal; no cable model | Missing component | New **Power cable** component (§3.5). Wires are labelled as ideal in the Inspector. |
| Thermal ambient for elements hard-coded to 20 °C (`engine.ts`) | Hard-coded constant | Project-level `environment.ambient` (sandbox only; challenges stay at 20 °C). |
| Fixed 1/60 s step; "Advance 60 s" only; run archives and replay capped at 7,200 s | Performance limit presented as a hard cap | Event-aware adaptive integrator for thermal/electrical/control experiments. Advance horizons run from +1 s to +24 h with progress and cancel. Archives allow up to 30 days. |
| Telemetry history dropped its oldest samples after 14,400 | Silent data loss on long runs | History is decimated instead (the sample interval doubles), so the whole run stays visible from t = 0. |
| Pipe `material`, `conductivity` and `insulation` displayed as if they mattered | Decorative | Material now applies its roughness preset. `conductivity` and `insulation` are labelled **info** ("not used by the solver"). |
| Motor: 24–180 V only, 11 kW maximum | Scale mismatch | Added a 440 V / 75 kW catalog model and a 22 kW preset. All constants are editable in the sandbox; kₑ ≡ kₜ is derived. |
| Pumps: 60 and 360 L/min only | Scale mismatch | Added a 3,000 L/min catalog model and presets from 20 to 6,000 L/min. |
| Fuses ≤ 20 A, relays ≤ 25 A | Scale mismatch | Added 63 A and 250 A fuses, a 690 V / 250 A contactor, and 125 A, 630 A and 80 A presets. |
| Sensors had no sampling model | Missing | `sampleInterval` (zero-order hold) on all sensors. |

### 2.2 Limits deliberately kept (each is a model limit, not a gameplay choice)

| Limit | Reason |
| --- | --- |
| Water 1–95 °C; constant density; vented tanks only | Constant-property liquid model with no boiling, freezing, evaporation or gas headspace. Leaving the range pauses with a diagnostic. |
| 100 components / 300 connections; 250 electrical unknowns; 120 hydraulic branches / 200 nodes | Dense direct solvers running in the browser main thread. |
| Spatial force/torque/damping envelopes (≤ 10⁵ N, ≤ 10⁴ N·m) | Stability envelope of the Planck rigid-body solver (unchanged). |
| Source setpoint ≤ its maximum output voltage | A real dependency rule. The maximum output voltage itself can be set up to 1 MV. |
| Relative pipe roughness ε/D ≤ 0.05 | Validity of the Swamee–Jain/Colebrook correlation. |
| Linear temperature coefficient: R(T) must stay positive | Linearised α model; the solver reports the temperature at which it breaks down. |
| Adaptive stepping only for thermal/electrical/control experiments | Hydraulic boundary events, electromechanical midpoint coupling and rigid-body contact need fixed steps (§5). |

## 3. What changed per domain

### 3.1 Electrical sources (`source`)

`mode` selects explicit mathematical models, solved by the MNA network in `electrical.ts`:

- **ideal**: V_a − V_b = V_set. Above `maxCurrent` the output protection trips (latched).
- **internal**: Thevenin V_a − V_b − R_i·I = V_set. A short circuit is valid. Internal loss is outside the energy boundary (supplied energy = terminal power).
- **cvcc** (current-limited laboratory supply): an active-set iteration switches each source between the CV row and the CC row I = ±I_limit. It returns to CV when the EMF needed in CC would exceed V_set. A dead short regulates at I_limit.
- **cc** (constant current): the same solver with `current` as the regulated value and `voltage` as the compliance limit.

New parameters: `mode`, `internalResistance`, `current`, `maxPower` (reported only, because there is no supply thermal model) and `enabled` (live). The Inspector shows the CV/CC state live, and the schematic symbol shows CV/CC, CC LIMIT, TRIPPED or OUTPUT OFF.

### 3.2 Resistive elements (`resistor`, `lamp`, `switch`, `fuse`, `meter`)

- New `tempCoefficient` α: R(T) = R₂₀(1 + α(T − 20 °C)) at the element's simulated temperature. The electrical solution is recomputed each step when any α ≠ 0 (explicit coupling).
- New `tolerance` (%): the part uses a reproducible deviation inside the band, derived from its identity (FNV hash).
- `resistance` is **live**: changing R creates no energy, so a resistor works as a rheostat.
- The current is a measurement, never an editable property.
- Fuse `tripTime`: definite-time characteristic (default 0.1 s, the previous behaviour).

### 3.3 Heaters

- **Defining parameters:** `ratedVoltage` (nominal voltage) and `ratedPower` (nominal power).
- **Derived:** `resistance` = V²/P, read-only and labelled "calc". Editing it explains which inputs to change instead.
- **Actual operation:** P = V²/R of the solved circuit. The heater is never forced to its nominal power. A 240 V / 2 kW element on 200 V delivers 1.39 kW; a 30 kW bank behind a 10 mΩ bus and a 30 m feeder delivers 29.7 kW. Both are shown in the Inspector ("Power vs nominal").
- **Thermal:** element thermal mass, immersion conductance (UA), loss to ambient and burn-out temperature are all configurable. Scaling presets keep the surface loading constant (UA ≈ 0.09 W/K per W, C ≈ 0.15 J/K per W).
- **Several heaters on one tank** are supported. Each heater has one thermal port; a tank accepts any number of them. Their powers add through the actual circuit (tested: 1 + 2 + 3 kW = 6 kW).
- High-power models are labelled "**DC/1-phase equivalent**". On an AC or three-phase network they are solved as resistive phasor loads.

### 3.4 Thermal tanks and bodies

- **Size and inventory:** capacity (overflow boundary) and initial volume are independent. Free-surface area sets the level and the hydrostatic pressure.
- **Vessel thermal mass** (`vesselHeatCapacity`) is lumped at the water temperature. It is included in the implicit thermal solve **and** in the hydraulic enthalpy mixing, so pumping water in or out conserves energy.
- **Heat-loss model:** `lossModel = manual` uses an explicit UA. `insulation` derives UA = A_wall/(1/h + t/k) for a cylinder with h = 10 W/m²K, footprint A, height = capacity/A and the insulation thickness and conductivity.
- **Ambient** is live (a boundary condition that creates no energy), from −100 to 500 °C. The water itself must stay inside 1–95 °C.
- **Project environment:** `environment.ambient` applies to every element thermal mass and to its initial temperature at reset.

### 3.5 Power cable (new component)

- **Defining parameters:** material (Cu/Al), cross-section and length, all reset-policy because they define conductor thermal mass, plus ampacity and insulation temperature limit.
- **Derived:** R₂₀ = ρL/A; α from the material; heat capacity = ρ_m·A·L·c_p; ambient UA calibrated so that the rated current reaches the insulation limit at 30 °C ambient (ampacity definition). Verified at steady state to ±0.05 K.
- **Rating behaviour:** above ampacity the cable reports the violation and heats physically. Exceeding the insulation temperature is reported. Insulation damage is **not** modelled and is not fabricated.

### 3.6 Motors

All constants are editable in the sandbox. kₑ is derived from kₜ. Inertia and winding thermal mass require a reset; everything else is live. The new 440 V / 75 kW catalog model and the 22 kW preset need either a CV/CC supply or deliberate overload: stall current is shown as a calculated value ("limit with a CV/CC supply"). Rating overloads are reported; heating follows from I²R.

### 3.7 Hydraulics

- **Pipes:** length, diameter, roughness, pressure rating and UA are live. Material applies its roughness. Presets run from DN15 to DN200.
- **Pumps:** rated speed, flow, shutoff head, efficiency, mechanical loss and NPSH3 are live. Pump size families run from 20 to 6,000 L/min. Flow and pressure are never editable.
- **Valves:** opening, K, diameter, cracking pressure, response time and fail position.
- **Tanks:** up to 10⁹ L.

### 3.8 Sensors and automation

Ranges, resolution, lag, noise, the new sampling interval, thresholds, setpoints, timer durations and PI gains are live in the sandbox. A target assignment requires a reset. Setpoints and thresholds cover −273.15…10,000 °C, so a thermostat can control element temperatures as well as water.

## 4. Parameter system, editing policy and Inspector

- `ParamSpec` (`parameters.ts`) holds: key, label, description, SI unit, display conversion (e.g. Pa↔bar, m³/s↔L/min, rad/s↔RPM, m↔mm), group, policy, validity domain with reason, typical range, options, whether it is simulated, and derivation inputs. Per-kind overrides give shared keys their specific meaning; for example, a heater's `ratedVoltage` is its *nominal* voltage, not a limit.
- `applyDerived()` recomputes derived values after every edit, preset, variant change and import. `derivedError()` rejects contradictory raw projects.
- **Editing policy:**
  - **live** = conservation-safe at any time.
  - **reset** = defines stored energy (C·T, ½Jω², mass, potential), geometry or initial state. Rejected after t = 0 with an explanation.
  - **calc**: derived, read-only.
  - **fixed**: constant of the implemented model.
  - The engine's `physicsSignature` excludes exactly the live keys (and derived keys whose inputs are all live). A live edit therefore never injects or removes energy. Tested: changing heater power and tank ambient mid-run keeps |supplied − stored − ambient| < 10⁻⁶ of the supplied energy.
- **Inspector:**
  - Groups: Operating controls, Engineering configuration, Ratings & protection, Thermal properties, Initial state and Advanced model (collapsed).
  - Live "Operation vs ratings" bars show actual vs rated power, current, voltage, temperature rise and pressure, plus the CV/CC state.
  - A "Calculated from configuration" section shows values such as heater R and rated current, cable voltage drop, tank energy per 10 K and cooling time constant, motor no-load speed and stall current, and pump hydraulic power.
  - Inputs accept engineering notation (`30k`, `4.7M`, `100m`, `2,5`, `1e-3`) and show units inline.
  - Locked fields show a lock icon with the reason. Values outside the typical range show a hint but are still allowed.
  - Tooltips give the description, valid domain, typical range, policy and catalog default.

## 5. Time advancement

- `AdaptiveRun` (in `engine.ts`) is available when the experiment has no hydraulics, motors or rigid bodies and is not a challenge.
- The thermal network was already backward-Euler implicit and its energy ledger uses the implicit values. Conservation therefore holds exactly for any step size; the step size affects only accuracy.
- **Step bound** = min(30 s, 2 × previous step, 0.05 K / max|dT/dt|, timer delay/20, sampling interval, 2 × sensor lag, 0.5 s with a PI controller, fuse trip time/10 near rating), with a minimum of 1/60 s.
- **Event handling:** any discrete change (contacts, failures, Boolean signals, CV/CC regulation) restarts the step at 1/60 s. Pending pulses and active overloads force 1/60 s.
- **Replay:** each advance is recorded as `{ at, adaptive: { duration, steps, tolerance, maxStep } }` and replays bit-identically (tested). Fixed-step portions replay as before.
- **UI:** advance horizons of +1 s, +10 s, +1 min, +10 min, +1 h, +6 h and +24 h; progress percentage with Stop (the state reached so far is kept and recorded); speeds up to 60×; an ADAPTIVE/FIXED indicator with the reason as tooltip.

Measured in Node, single thread. The fixed-step figures were measured while the browser suite was running in parallel, so treat them as upper bounds:

| Run | Simulated | Steps | Wall time |
| --- | --- | --- | --- |
| 2,000 L heated by 3 kW (ideal 46.4 h) | 46.4 h | 5,755 | 0.31 s |
| Experiment B, 30 kW bank, thermostat cycling | 6 h | 2,019 | 0.59 s |
| Experiment C, 3-stage heating | 24 h | 3,769 | 0.24 s |
| Experiment B, fixed 1/60 s for comparison | 1 h | 216,000 | 20.4 s |
| Water-transfer starter (hydraulic + motor), fixed step | 10 min | 36,000 | 61.7 s |

Adaptive vs fixed-step accuracy: Experiment B over 20 min differs by < 0.01 K. A 1 L / 1 kW thermostat loop differs by 0.025 K. **Hydraulic and motor experiments remain fixed-step and slow over long horizons**; the advance control shows "FIXED" for them.

## 6. Presets, families and costing

- **Catalog variants** (purchasable, also valid in challenges): 26 non-standard models in total (14 of them new), including the new heater 100 W / 12 kW / 30 kW / 100 kW, supply CV/CC 30 V/5 A and 800 V/250 A, tank 2,000 L and 10,000 L, motor 75 kW, pump 3,000 L/min, fuse 63 A and 250 A, contactor 250 A, and cooling coil 1 kW/K.
- **Built-in presets** (sandbox starting points, grouped Laboratory / General-purpose / Industrial / High-capacity): 46 configurations across heaters, sources (including battery and CC source), resistors (including an NTC), fuses, contactors, cables, tanks, coolers, motors, pumps, pipes and valves.
- **User presets:** "Save as preset" in the Inspector, then apply, rename and delete. They are stored on the device (`localStorage`) and can be exported and imported as `physics-lab-presets` v1 JSON from the File menu. Every preset is validated on load: known keys, types, domains and dependencies. Components remember their preset name for display only.
- **Separation of concerns:**
  - Component definition: kind, ports, catalog.
  - Component instance configuration: props plus derived values.
  - Runtime state: engine temperatures, inventories, controller memory.
- **Cost:**
  - A catalog configuration costs its catalog price.
  - A custom sandbox configuration is estimated by the six-tenths rule on its sizing quantity, relative to the closest-sized catalog model of the same kind (cable: linear in conductor volume), with a floor of 25% of that price. A custom 30 kW heater therefore prices like the 30 kW catalog bank, not like a scaled 2 kW element. It is labelled "Estimated cost (custom sizing)".
  - Challenges reject custom configurations **before** costing, so an estimate can never buy a cheaper rating in a scored assignment.

## 7. Persistence and migration

- Projects stay at schema version 3/4. New keys are additive, and `migrateComponent` fills them from the variant-aware catalog. A legacy heater gets the nominal voltage that reproduces its stored resistance exactly (√(R·P)).
- Derived values are re-derived on import.
- **Unknown properties are rejected with their name** instead of being dropped silently.
- `environment` and the component `preset` label are validated and serialized.
- Undo/redo covers parameter edits, presets and reset-to-default; this is tested at store level. Replay distinguishes configuration edits (project snapshots) from physical events (faults, pulses, impulses, adaptive advances).

## 8. Validation summary (executed)

- `npm test`: unit tests, including `sandbox.test.ts` (32 tests: metadata completeness, derivations, sources, multi-heater, 2,000 L heating at 3/30/100 kW, live-edit conservation, presets, costing, challenge isolation, migration, adaptive replay, 40 random heater/tank/source combinations from 10 W–1 MW and 0.5–50,000 L, and 60 random resistor networks from 1 mΩ to 1 MΩ) and `store-sandbox.test.ts` (undo/redo, presets, challenge locks, recorded adaptive advance).
- After the second expansion (§10): 168/168 unit tests across 13 files, 118/118 scaling-campaign rows, 87/87 physics validation and 31/31 browser tests (production build). The browser count includes a new-component spec; one physical-view test was made robust by re-fitting the view after a free fall.
- `node scripts/validate-scaling.mjs`: originally 106 executed comparisons covering:
  - Ohm's law over 1 mΩ–1 MΩ × 1 V–100 kV.
  - All four source behaviours.
  - Experiments A–E.
  - A 20-cell tank × heater matrix (1–10,000 L × 0.1–100 kW), checked against energy and an exact two-node analytic solution. The 1 L × 100 kW cell correctly ends in the liquid-range diagnostic.
  - Motor no-load speed for all four sizes (≤ 0.04%).
  - Gravity transfer through Ø10–500 mm pipes (mass residual ≤ 2·10⁻¹¹ kg).
  - Thermostat bands on fast and slow plants.
  - A parameter-extreme sweep over every numeric parameter of every component (no NaN/Infinity).
- `npm run validate:physics`: 87/87. Two rows were updated because overloaded relays no longer fail open by fiat (§2.1).

- Browser (Playwright, production build via `vite preview`): 30/30, including the new `e2e/sandbox.spec.ts` (derived heater resistance, 30 kW preset, CV/CC bus, 2,000 L preset, +1 h adaptive advance, preset save/reset/apply, challenge locks, live vs reset editing). Log: [`../validation/sandbox-browser.txt`](../validation/sandbox-browser.txt). On this 2-core host the *dev server* run of the 720 s supply challenge exceeded its 240 s test timeout, while the same test passes in 2.0 min on the production build. Node timing of that challenge improved (74.6 s vs 86.2 s recorded before this milestone).
- `docker build`: succeeds; the nginx image serves HTTP 200.

See the executed reports for the numbers. Test counts and pass/fail state are as of the last run recorded in those files.

## 9. Known remaining restrictions

- AC is steady-state phasor only: no switching transients, harmonics or semiconductor models. A balanced three-phase supply cannot be mixed with single-phase AC sources in one network; unbalanced systems are built from three AC sources. Induction motors need the balanced supply.
- No boiling, steam, freezing or sealed/pressurised vessels; water has variable viscosity and tank density but constant heat capacity.
- No validated wear, ageing or arc models for contacts, cables, supplies or motors. Out-of-rating operation is reported, not destroyed.
- Rigid-body experiments cannot use adaptive stepping. Hydraulic and motor networks can since the second expansion (§10); their fixed-step speed is unchanged.
- Tank heat loss assumes a vertical cylinder; other geometries need an explicit UA.
- The resistor tolerance is a single deterministic sample, not a Monte-Carlo study.
- The cost model is an explainable estimate, not market pricing.
- User presets are per-device until exported.

## 10. Second expansion (implemented)

The six follow-up items from the first version of this list are now implemented and tested (`protection.test.ts`, `features.test.ts`, `hydraulic-advanced.test.ts`, and rows in the scaling campaign):

1. **Circuit breaker and motor-protective breaker.** A thermal image θ' = ((I/In)² − θ)/τ is integrated exactly, with a magnetic trip, a breaking-capacity check, re-closing only after cooling, a status output and welded/open faults. Trip times match the analytic I²t values within one 1/60 s step.
2. **Thermal ports and a generic thermal mass / heat sink.** Resistors, cables and motors gained thermal ports. Links use series port conductances, and the heater–tank coupling is numerically unchanged.
3. **Pipe water inventory and heat exchanger.**
   - Pipes hold ρAL of water in implicit mixing cells, giving transport delay. This is on by default; switch it off for an ideal zero-volume pipe.
   - The heat exchanger is a two-branch ε-NTU element (counter- or parallel-flow) inside the linear enthalpy transport, so energy stays conserved.
4. **Signal conditioning and PID derivative.** Scale/offset, limiter, exact filter, rate limiter and selector blocks; the PID derivative acts on the filtered measurement.
5. **Pressure-reducing valve, data-point pump curves, NPSH.**
   - The valve is an integral pilot regulator on its outlet pressure.
   - Pump curves can be entered as measured flow:head points, scaled by the affinity laws, with a quadratic continuation.
   - A cavitation warning is logged when the available NPSH falls below the required value.
6. **Balanced three-phase supply.** It is solved as a per-phase star equivalent with ×3 powers and per-pole thermal mass. DC motors on three-phase networks are rejected with an explanation.
7. **Adaptive stepping for hydraulic and motor networks.** Steps are bounded by tank level, valve travel and motor acceleration, and the network is solved at mid-step tank levels.
   - The industrial pumping starter runs 120 s in 284 steps instead of 7,200, with a delivered-volume difference of 0.0005 L. Its energy residual of 1.6·10⁻⁸ is better than the fixed-step value.
   - The 75 kW / 10,000 L system runs a full hour in 363 steps.
   - Rigid-body scenes and challenges stay on fixed steps.

**Solver robustness fixes found on the way** (both pre-existing):
- One-way branches (check valve, pump, pressure-reducing valve) at zero flow gave Newton a zero Jacobian. A high-head check-valve line could not converge at all. A generalized-slope fallback now handles it.
- Turbulent √Δp branches made the line search crawl. This caused a failure when a 75 kW pump emptied its tank. A sufficient-decrease (Armijo) condition fixes it.
- Challenge reference scores are unchanged (transfer 89, pressure 89, supply 94).

## 11. Remaining deferred items, by priority

1. *Done in the engineering-depth revision:* AC phasor solver with reactance and power factor, unbalanced three-phase from single-phase sources, induction motor; see [PHYSICS.md](PHYSICS.md).
2. **Medium:** single-phase machines; breaker selectivity plots and time-current curve displays; water hammer (needs compressible pipe dynamics). *Done since:* variable-frequency drive, star-delta and soft starters, cavitation head drop.
3. **Medium:** distributed 1-D wall conduction; fouling and phase change in heat exchangers.
4. **Low:** lead-lag, dead-band and lookup-table blocks; sealed vessels with a gas headspace; evaporation above about 80 °C; Monte-Carlo tolerance studies.
