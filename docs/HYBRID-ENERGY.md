# Grid-connected energy models and solar reliability audit

## Scope and architecture

Three generic, ordinary connectable components extend the existing electrical network: **Grid-Connected Inverter**, **Hybrid Inverter / Charger**, and **Grid Energy Meter**. The standalone DC/AC Inverter remains independent. Five examples are available in the normal project shelf and as importable JSON: Grid-tied solar inverter, Grid-connected hybrid storage, Zero-export household, Grid outage and backup, and Multiple solar controllers.

`hybrid-circuits.ts` expands converters into existing MNA elements. While connected, the converter stamps controlled complex current into an externally referenced RMS AC island; it cannot supply a voltage reference. A separate source supplies the protected island only after both grid transfer poles open. A preflight solve with converter sources and transfer paths open checks for a real external AC reference. Invalid connections between backup and grid are rejected. Parallel ideal source conflicts and undefined current-source islands remain errors.

DC discharge uses a passive, iteratively updated finite conductance; charge uses a voltage-regulated, current-limited branch. Actual solved complex AC power determines DC demand. The shared nonlinear loop couples these branches with PV diode curves, MPPT regulation and battery terminal voltage. Exploratory derivative solves do not advance state. Accepted converter states, counters, phase, protection and timers participate in the existing checkpoint/rollback mechanism. There is no separate home-energy balance simulator.

`ess.ts` is a reusable command layer. It consumes explicit PCC power, battery SOC and electrical bus measurements. Commands affect network branches; it never transfers energy itself. Self-consumption, optional grid charging, export permission, reserve and PowerAssist-like support are distinct policies. The meter must be at the point of common coupling, including household loads upstream of the inverter. Its assumed 1 mΩ series shunt and neutral reference provide actual signed real/reactive power; existing two-terminal probes cannot measure this PCC quantity.

## Exact engineering references

Principal calibration: **Victron MultiPlus-II 48/3000/35-32, 230 V**, original 3 kVA family. Ratings from newer 4k models are not used.

- [Manufacturer product page](https://www.victronenergy.com/inverters-chargers/multiplus-ii).
- [MultiPlus-II datasheet, specification table](https://www.victronenergy.com/upload/documents/Datasheet-MultiPlus-II-inverter-charger-EN-.pdf).
- [230 V manual: operating description, transfer, PowerControl and PowerAssist](https://www.victronenergy.com/media/pg/MultiPlus-II_230V/en/description.html).
- [230 V manual: configuration and acceptance settings](https://www.victronenergy.com/media/pg/MultiPlus-II_230V/en/configuration.html).
- [ESS system design and anti-islanding requirements](https://www.victronenergy.com/media/pg/Energy_Storage_System/en/ess-system-design.html).
- [ESS settings, reserve, meter placement and feed-in](https://www.victronenergy.com/media/pg/Energy_Storage_System/en/configuration.html).
- [Externally controlled ESS modes and power setpoints](https://www.victronenergy.com/live/ess:ess_mode_2_and_3).
- [SmartSolar MPPT 150/35 specifications](https://www.victronenergy.com/media/pg/Manual_SmartSolar_MPPT_150-35__150-45/en/technical-specifications.html).

Manufacturer references appear only here, in validation and Inspector provenance. Component kinds, names, symbols, presets and project serialization are generic.

## Published values versus assumptions

| Quantity | Published reference | Implementation or qualification |
| --- | --- | --- |
| DC operating range | 38–66 V | Configurable thresholds; incompatible low-voltage packs cannot operate the 48 V configuration |
| Continuous output | 3000 VA; 2400 W at 25°C, 2200 W at 40°C, 1700 W at 65°C | Separate real/apparent limits and piecewise thermal derating |
| Peak power | 5500 W | 2 s duration is an educational assumption, not a published rating; DC current and apparent power may reduce attainable peak |
| Maximum efficiency | 95% | Fitting constraint, not an independently validated whole efficiency curve |
| No load | 11 W; AES 7 W; Search 2 W | 11 W active; explicit 2 W standby; no proprietary AES/Search polling emulation |
| Charger | 35 A | Separate charge-direction limit; 94% charge efficiency is assumed |
| Transfer / AC input | 32 A | Explicit transfer overcurrent protection; input limit is a control request, not an ideal clamp |
| AC output | 230 V ±2%; 50 Hz ±0.1% | Ideal regulated RMS fundamental within limits; ripple and harmonics omitted |
| AC input acceptance | 187–265 V, 45–65 Hz | Configurable; do not confuse with regional configured defaults |
| UPS transfer | Less than 20 ms | 16 ms modeled open interval; time represented explicitly |
| Reconnection | Installation/grid-code dependent | 60 s conservative default; examples use 0.1 s for interactive lessons |
| Synchronization | Manufacturer does not publish this simulation law | Phase slew 90°/s, frequency slew 1 Hz/s, closing tolerance 5° |
| DC / surge AC current | Not calibrated from the selected datasheet | Conservative 75 A DC; 24 A AC surge assumption |
| Transfer resistance | Unpublished | 2 mΩ per pole, separately accounted as heat |
| Battery | Two externally modeled 25.6 V /100 Ah packs in series | Derived 51.2 V /100 Ah, 16 cells, 3.2 mΩ; not a claimed separate manufacturer product |
| 48 V solar controller | 150/35: 35 A output, 40 A PV short-circuit, 150 V absolute maximum, 145 V operating/startup, 98% peak | Generic 48 V variant uses 145 V operating ceiling; two series 450 W panels suit the battery bus |
| Lithium charge profile | Series-pack recommendation derived from 28.4/27 V | 56.8 V absorption /54 V float; do not use the inverter's lead-acid defaults as lithium recommendations |

The generic grid-following inverter shares configurable converter physics; it is not claimed to be a separately calibrated commercial PV inverter. Its DC tracking follows the actual PV curve. Fixed reactive power is supported, subject to apparent-current limits; national Q(U), power-factor schedules and grid-code certification are not modeled.

## Equations and energy accounting

Positive converter DC power means battery discharge; positive converted AC power means injection. Positive meter power means grid import. For discharge, `Pdc = Pac + conversion loss`; for charge, `Pac < 0` and `Pdc = Pac + loss`. Reactive power consumes current capacity and conduction loss but contributes no net cycle-averaged work.

Discharge loss is `P0 + a P + k S²`. The coefficients are derived so the configured maximum efficiency occurs at the assumed half-rated real load when feasible; otherwise a nonnegative quadratic curve places its actual maximum at the configured efficiency. Manufacturer maximum efficiency is a fitting point. The half-load location and other curve points are assumptions. Charge loss is `|Pac|(1−ηcharge)` plus idle and reactive conduction terms. Tests independently check passive-network solutions and both conversion identities.

Battery SOC integrates actual accepted current and coulombic efficiency. Chemical energy is the piecewise integral of OCV over SOC. The source uses the exact mean OCV traversed during a step, rather than the starting OCV: this makes electrical work, chemical change and heat consistent even across steep SOC regions. A stable interval integral avoids subtracting large nearly equal stored-energy values. No artificial thermal clamp hides discrepancies.

PV incident irradiation remains external input; extracted PV power is less than or equal to available sunlight, and unconverted radiation remains a loss in the solar model. Converter source bookkeeping is removed from external-source totals, then real converter losses enter existing thermal nodes. Grid source negative absorbed power is imported energy; positive absorbed power is exported energy. Transfer power is not counted again as generation. Reports reconcile chemical change, battery heat, converter heat, transfer/meter heat, actual loads and global storage/ambient losses. Absolute joules and relative residuals are reported.

## Grid loss and operating policies

On missing or unacceptable external voltage/frequency, grid-following injection stops and both transfer poles open. A battery-powered backup reference starts only after the transfer interval and only if DC voltage, protection and converter limits permit it. Utility-side loads remain unpowered. Grid return requires qualification plus phase/frequency alignment before transfer closes. Backup depletion and overload shut down the output; latched overload requires reset. States and transitions are exposed in Inspector and the event log.

Connected reserve prevents commanded battery discharge below the configured SOC, including electronic demand in the budget. Outage backup may use the reserve. If reserve or converter ratings prevent meeting the AC import limit, real import remains measurable and the device reports **grid import limit exceeded**. Existing breakers can disconnect the branch. The model does not erase unmet demand or fabricate capped grid power.

Zero-export feedback uses actual PCC power. At full SOC the solar chargers keep their own absorption/float regulation; because full rest lies below their absorption voltage, PV supports loads without any coordination of charger voltages, both grid-connected and in backup. Export-enabled coordination requests the capability of a curtailed charger, which draws its surplus out. For a charger that is tracking freely it requests only the actual output. A full battery therefore exports solar power only; it never discharges to feed the grid, and discharges only to cover household demand the PV cannot meet. Actual extraction still depends on the solved PV voltage and the accepted network power. This is an educational control policy, not a claim about proprietary ESS firmware.

## Confirmed solar audit defects and regression coverage

1. **Shared-bus MPPT singularity.** Connect two independent MPPTs to one battery, at 50%, 95% or full SOC, with unequal sunlight. Identical initial ideal constant-voltage output branches made the first nonlinear solve singular. Initialize unilateral converter branches at their physical current bound; fixed current constraints cannot be converted into fabricated voltage references. Tests cover unequal controllers, current limiting and full-battery demand changes.
2. **AC winding heat omitted during a mode transition.** Supply an RL protected load while backup changes from the transfer gap's DC preview into RMS AC. The original mixed-step averaging omitted the inductor winding's heat channel, producing about **0.148183 J** residual in the reproducer. Explicit AC winding heat restores device and global balances; the existing 0.001 J tolerance remains.
3. **Tiny-battery SOC breakpoint event trap.** A 0.01 Ah battery supplying roughly 500 W reached SOC 0.2000000000025 at approximately 1.1 s; the remaining breakpoint interval was about 9.2 ps, below the old 100 ps integration floor. Retries ended with a boundary convergence error. Exact mean OCV removes unnecessary piecewise-knee events; true SOC endpoints retain exact event timing. Tests cross knees, limits and protection transitions with small capacities and timestep refinement.
4. **Efficiency curve exceeded configured maximum.** The former idle-plus-quadratic fit matched the chosen half-load point but peaked elsewhere at roughly 90.8% for a 90% setting. Nonnegative idle, linear and quadratic losses now respect the configured maximum without changing the original calibration point. Sweeps cover standalone and hybrid converters.

Regression files: `solar-audit.test.ts`, `hybrid.test.ts`, `hybrid-protection.test.ts`, existing solar/electrical suites and browser interactions. They include real/apparent power, RL and motor loads, low sunlight restoration, overload, BMS collapse/recovery, temperature, reserve, full-battery curtailment, parallel controllers, rejection rollback and serialization.

## Concerns not confirmed and model limitations

No persistent-state mutation from exploratory solves was reproduced; checkpoint and rejected-step checks cover converter and device state. Parallel controller charging and current limits pass after the source-constraint fix. Absorption accumulates eligible regulated charging time, pauses during interruption and resets on rebulk; this is a documented generic controller policy, not proprietary timing behavior.

The LFP open-circuit curve was originally calibrated with 3.65 V per cell (14.6 V per four-cell pack) at 100 % SOC, which is the charge cut-off rather than a resting voltage. Full rest therefore lay above the 14.2 V absorption setting, and the hybrid raised the solar chargers' voltage limit to the full OCV while grid-connected. The curve is now a rested table (see the calibration change below), and that workaround has been removed.

The RMS solver represents the fundamental, real/reactive loading and existing mechanical motor dynamics; it omits semiconductor switching, harmonics, transient waveform peaks and asynchronous closing waveforms. No three-phase hybrid aggregation, parallel hybrid synchronization, AC-coupled PV frequency shifting, external-grid fault impedance dynamics, earth/RCD topology or certified non-detection-zone anti-islanding tests are provided. The open-reference check is an educational isolation model, not grid-code certification. Multiple independent MPPTs are supported; arbitrary incompatible ideal AC sources remain invalid networks.

Example projects start in steady sunlight; edit irradiance, utility Enabled, loads or parameters through the ordinary Inspector to create weather, household-demand and outage experiments. They do not run hidden time-dependent source scripts.

## Validation and delivery

[Hybrid analytical, manufacturer-fitting and long-duration report](../validation/hybrid-energy.md) separates published fitting points from independent circuit/conservation checks, includes one-hour storage operation and changing sunlight/outage scenarios, and reports numerical residuals. [Solar reference report](../validation/solar-energy.md) retains the original panel calibration and independent checks. Example generated/file runs are recorded in `validation/examples.json`; preset results are in `validation/presets.json`.

The release gate now includes both solar and hybrid campaigns alongside all existing physics, scaling, score, preset, shaft, build and browser checks. The exact final tested commit and release-gate result are reported in the delivery message and the Git verification record; neither a passing partial campaign nor dirty-tree execution constitutes the final release claim.

### Final release-gate execution — 2026-10-14

Exact tested implementation commit: `c3b555c095ace8b9a9ab8c24cd62d1e9449f01f2`.

`npm run check` passed in 1338 seconds: TypeScript; **803/803 unit/integration tests across 45 files**; **96/96 physics checks**; **124/124 scaling checks**, including 1332 parameter-boundary cases; unchanged challenge reference scores; **137/137 operating scenarios for all 93 presets**; two shaft-event checks; **16/16 solar checks**; **34/34 hybrid checks**; production build; and **108/108 production-browser tests**. All five new examples passed browser advance/reset/save/reload and generated/file solvability checks. Existing conservation tolerances were retained.

The one-hour run's absolute global residual was **5.50412 µJ** (relative **5.81295×10⁻¹²**); its separately summed device-chain residual was **7.16781 µJ** (relative **7.72392×10⁻¹²**). The weather/outage run's global residual was **0.225453 µJ**, and its device-chain residual **0.308704 µJ**. These values and individual energy channels are retained in `validation/hybrid-energy.json`.

Two integration issues found during development were also corrected: grid-current violation reporting now uses apparent power, including reactive demand; and the explicit AC heat channel includes harmonic ESR/winding losses accumulated after the fundamental solve. The existing resonant-capacitor drive test passes its original `1e-8` conservation bound, with an additional heat-channel assertion.

### Follow-up audit — 2026-10-14

The datasheet values cited above and in [SOLAR-ENERGY.md](SOLAR-ENERGY.md) were re-checked against the linked manufacturer PDFs and manual pages: Trina TSM-450NEG9R.28 (STC and NOCT rows, coefficients, NOCT 43 °C, 1762 × 1134 mm), Phoenix 24/500 (500 VA / 400 W, 350 W at 40 °C, 900 W peak, 90%, 6.5 W, ECO 1.5 W, 18.6 / 21.8 V, 18.4–34.0 V), MultiPlus-II 48/3000/35-32 (38–66 V, 3000 VA, 2400 / 2200 / 1700 W, 5500 W, 95%, 11 / 7 / 2 W, 35 A, 32 A, 187–265 V, 45–65 Hz), SmartSolar MPPT 100/20 and Lithium Battery Smart 12.8/100 and 25.6/100. All match. The Phoenix datasheet also publishes 1.25%/°C derating above 40 °C, and the battery datasheet publishes capacity at 0 and −20 °C. Neither is modeled, as stated above.

Five defects were corrected:

1. **Generic battery as SOC target.** The 48 V compatibility check computed nominal voltage as `cells × 3.2 V`. A generic `battery`, which the Inspector and integrity rules accept as `batteryTarget`, has no cell count, so every such battery was rejected as "0 V nominal". A generic battery now uses its mid-range OCV, (empty + full)/2.
2. **Import limit reported during export.** Since the apparent-power change, the "grid import limit exceeded" mode compared |S| with the input current limit regardless of direction. An export above that current was therefore labeled as an import violation. The check now applies only while the PCC imports real power. Export is bounded by `exportLimit` and the transfer rating.
3. **Grid-inverter tracking bound.** The DC tracking target was capped at 0.85 × the open-circuit voltage. For the reference module, Vmp/Voc is 0.843 at 25 °C and rises to 0.857–0.862 at −10 °C, so in cold sunlight the cap held the operating point below the MPP (about 0.2% power loss at −10 °C, 1000 W/m²). Tracking may now reach 0.98 × Voc, the bound the MPPT controller already uses. A target above that bound cannot be reached, for example after sunlight weakens. It restarts at 0.85 × Voc, a fractional open-circuit estimate that keeps a weak module above the inverter's idle demand.
4. **Absorption timer gated on grid charging.** The hybrid charger counted absorption time only when grid charging or keep-charged mode was selected. A battery charged from AC-coupled PV surplus, or by a negative power setpoint, never reached float. Any regulated AC charging outside standby now counts.

5. **Stored energy exported at full SOC.** With export enabled, the hybrid requested the ideal MPP power of the coordinated chargers. Perturb-and-observe tracking always runs slightly below the MPP, so the battery covered the shortfall: in the zero-export example at 100% SOC, about 1 mA flowed every other 0.2 s tracking interval. SOC crept down, and the battery status alternated between *discharging* and *idle*. The ideal value is now requested only while a charger is curtailed (input current-limited or output voltage-regulated); otherwise the request follows its actual output. The battery status label also has a 1 µA deadband, because the coupled iteration's nanoampere residual is not charge transfer.

Regressions are in `hybrid-protection.test.ts`, and each one fails on the previous code.

### LFP open-circuit calibration change — 2026-10-14

**Finding.** In the zero-export example with the grid disabled and the battery full, the protected load ran from the battery while both PV strings delivered 0 W. The battery drained to 98.1 % SOC (charger in absorption) or 88.5 % (float) before PV took over, and PV never recharged it. The LFP curve put 100 % SOC at 3.65 V per cell (58.4 V for 16 cells), which is LFP's charge cut-off under current, not a resting voltage. Both charger setpoints (56.8 / 54.0 V) lay below it, so no charger could deliver until the battery had sagged. While grid-connected, the hybrid hid this by raising the chargers' ceiling to 58.4 V.

**Change.** The LFP curve is now a rested open-circuit table, 2.5–3.40 V per cell, continuous and strictly increasing (table and source in [PHYSICS.md](PHYSICS.md)). Catalog full voltages become 13.6 / 27.2 / 54.4 V, the cell-count derivation uses 3.40 V per cell, and the 48 V generic battery preset was updated to match. Charger setpoints, BMS limits (2.8 / 3.75 V per cell) and the chemical-energy integral are unchanged in form; the energy integral uses the same curve. Victron publishes no OCV curve for the reference battery. Its published absorption, float, balancing and BMS values are consistent with the new curve, and full rest now lies between float and absorption. Consequences:

- The grid-only voltage coordination is removed. Export at full SOC requests what each charger can deliver at its present tracking voltage (from the charger's curtailment-released solve). This replaces the discontinuous curtailed/ideal-MPP switch from finding 5, which failed to converge at 700 W/m² once the coordination no longer masked it.
- The battery has no top-of-charge polarization knee, so bulk continues to 100 % SOC. A hybrid charger whose battery is full while it is still trying to charge counts absorption time, because it is holding its setpoint.
- Grid charging to a target SOC makes that target a floor for self-consumption discharge. Without the floor, a battery charged to 100 % immediately discharged for self-consumption and recharged, cycling every step. PowerAssist (input current limit) may still draw on the battery down to the reserve.
- Test fixtures that placed charger thresholds just above the old 95 % OCV (13.56 V) or raised the ceiling above full OCV (14.7 V) now use the reference 14.2 / 13.5 V profile with packs starting near full.

New regressions: the curve's table points, continuity, monotonicity and energy integral (`components-next.test.ts`); grid-connected and islanded operation at 100 % SOC in absorption (battery current below 1 µA, SOC 1, PV carries the 200 W backup load); and float, where the battery settles once to 54.0 V (≈99.5 %) and PV then carries the load with no further discharge (`hybrid-protection.test.ts`). Example files, example measurements and the solar, hybrid and preset campaign records were regenerated.

### Reconnect with a full battery — 2026-10-14

A hybrid with a full DC-coupled battery and a small load stopped at grid reconnect with "Solar electrical coupling did not converge (relative residual 1.73e-10)", whether the load was on the grid side or on the backup output. The PCC meter derives its current from the 0.2 mV drop across its 1 mΩ shunt at 230 V, which floating point resolves only to about 2×10⁻¹⁰ of the flow. The ESS command integrates the grid error, so it kept correcting a constant measurement offset that it could never remove. With a full battery, no other free loop absorbed the drift, and the converter's DC balance stayed just above the 10⁻¹⁰ coupling tolerance. Power commands are control setpoints, so corrections below 0.1 µW (about ten times the meter's 10⁻⁸ W resolution) are now ignored. The network is still solved exactly for the command in force, so energy conservation is unaffected. A regression covers both load positions.

The default 50 W grid setpoint (the reference ESS default, which avoids accidental export) means a household load below 50 W is carried by the grid. Set the setpoint to 0 W for the converter to cover small loads from solar.

Thermal derating uses the simulated lumped component temperature as a conservative proxy for the datasheet's ambient-temperature rating points. This mapping and the thermal capacitance/loss parameters are educational assumptions, not a calibrated manufacturer internal-temperature controller.

The subsequent delivery commit updates only this audit document and generated scaling reports; implementation, tests, dependencies and release-gate scripts are identical to the exact tested commit above. The campaign refreshed reports during the gate, so its automatic clean-tree deployment record was not written. A future deployment will run its normal verification gate.
