# Physics audit — 2026-10-11

Scope: existing electrical, thermal, hydraulic, shaft, spatial, sensor and control models, their catalog/measurement contracts, supplied projects and UI lifecycle. No component types, ratings or project schema were added. This is a finite validation campaign, not proof of universal physical correctness.

## Confirmed defects repaired

| Defect | Independent expectation / regression |
| --- | --- |
| DC capacitor nodal solve used 1 GΩ leakage, but readings and heat used 0.05 Ω ESR, reporting ~480 A at 24 V | Series 1 GΩ + 10 Ω: I = 24/(10⁹+10) A; capacitor heat = I²·10⁹ W; KCL and thermal ledger |
| AC capacitor ESR ignored its configured temperature coefficient/tolerance | At 24 V, 50 Hz, C = 1 mF, R20 = 0.5 Ω, α = 0.01/K and 60 °C: ESR = 0.7 Ω; I = 7.3638625 A and heat = I²·0.7 W |
| De-energized AC relay heat used a–b voltage while its NC branch conducted | 24 V, 10 Ω load, 0.1 Ω contact: I = 24/10.1 A; contact heat = 0.5646505 W. Both NO and NC tested; unused a–b probe is invalid |
| Induction motor treated loss of supply / unwired state as incompatible DC, stopping instead of coasting | Unexcited current and torque zero; unloaded speed decay ω = ω₀ exp(−bt/J); recovery tested. Energized DC/single-phase rejection retained |
| Induction machine had no selectable motor faults despite engine support | Existing power-loss, motor-failure and control-loss paths exposed; fault/clear and UI archive replay exercised |
| Empty tanks skipped their configured vessel thermal capacity, freezing temperature | C = 1,000 J/K, UA = 100 W/K, 80→20 °C Newton cooling; dt 0.1/0.05 s refinement toward 20+60 exp(−0.1); fluid sensor remains unavailable |
| Tank inspector assumed 1 kg/L although inventory uses temperature-dependent density | 1,000 L at 80 °C ≈ 971.8 kg; mass and C agree with the inventory; sensible heat and cooling readouts use the corrected mass |
| Routed free overflow could force water uphill and hide required work in negative dissipation | Receiving tank 10 m above a ~0.5 m free surface cannot receive gravity spill. Unsupported submerged/backpressured route now stops explicitly |
| Old 10 L heat test asserted a fabricated 10 kg heat calculation rather than actual storage | Actual water ledger checked against independently evaluated Kell approximation (998.2041322 kg/m³ at 20 °C), same one-step energy bound |

Regression implementation: `src/simulation/audit-regression.test.ts`, `src/simulation/physics.test.ts`, `e2e/physics-audit.spec.ts`. Supplied JSON artifacts are imported in each starter browser workflow, alongside opening the shelf entry. Documentation no longer lists implemented breakers, thermal masses, heat exchangers and AC as absent.

## Equation and coverage review

| Components / coupling | Independent checks and assumptions reviewed |
| --- | --- |
| DC sources, resistor, lamp, heater, cable, switches, ground/junction, meter, relay, fuse | V=IR, KCL/KVL, VI=I²R, finite contact/loading resistance; CV/CC and compliance, temperature coefficient, faults and isolation; source energy is net terminal delivery |
| AC sources, balanced 3~, inductor, capacitor | RMS phasors, R+jωL and ESR−j/(ωC), complex power, phase voltage VLL/√3 and total power ×3; explicit unbalanced star and neutral checks; no switching/charging transients |
| Breaker / motor protector | Exact thermal-image update and analytical trip time τ ln(x²/(x²−θtrip)); magnetic threshold, cooling, welded contact and reset; illustrative characteristics, not certified manufacturer curves |
| Heater/tank, thermal mass, cooler, cable/winding heat | C dT/dt=P−UA(T−Ta), symmetric contact conductance, sensible storage, signed ambient/coolant exchange; backward-Euler convergence; vessel remains lumped with fluid when wet |
| DC / induction motors, pumps and rotors | SI ke=kt, torque/back EMF, copper/friction losses, J dω/dt, equivalent-circuit locked rotor and slip, stall/reversal/coasting; pump affinity and hydraulic ΔpQ versus shaft input; no cavitation performance or turbine recovery |
| Tank, pipe, valve/check/actuated/pressure regulator, exchanger, junction | Hydrostatic weight/head, Hagen–Poiseuille/Darcy–Weisbach, Reynolds/friction regimes, viscosity-dependent two-K losses, signed branch continuity, finite mass, enthalpy mixing/advection, weir discharge, ε-NTU transfer; empty/full/zero-flow events |
| Rigid bodies, contacts and fixed/revolute/prismatic/distance/spring/gear/rack constraints, external actuators | SI mass/inertia, free fall, momentum/restitution, spring frequency/energy, shaft inertia once, forces/impulses/damping work; timestep/substep and contact residual limits |
| Temperature/pressure/flow/level/position/speed sensors; comparator/hysteresis/thermostat, gates, constants, latch/reset, timer, PID, scale/limiter/filter/rate limiter/selector, independent cutoff | Modeled target eligibility, Pa and m³/s control units versus bar/L/min display, invalid signals and fail states, lag/sample hold, simulation-clock transitions, bounded integration and derivative, safety latch/manual reset |
| UI and persistence | Actual terminal wiring, live controls, traces/CSV, faults/recovery, reset, saved archive replay and legacy configuration validation. Fixed-step rendering independence and representative adaptive/fixed-step comparisons |

The component and parameter tests enumerate all catalog variants/default properties; the model review follows the supported combinations in `docs/COMPONENT-MATRIX.md`. Tests for the above groups already existed and were used first; new tests target the confirmed defects.

Primary references checked: [OpenStax Kirchhoff rules](https://openstax.org/books/university-physics-volume-2/pages/10-3-kirchhoffs-rules), [IAPWS 2008 viscosity release](https://iapws.org/technical-guidance/release/viscosity), [US DOE pumping sourcebook](https://www.energy.gov/sites/prod/files/2014/05/f16/pump.pdf). Expectations also use independent elementary calculations given above and in the existing reference tests; conservation and solver convergence are treated separately from model validity.

## Remaining limitations and unverified areas

Water is incompressible with constant cp and reference-density flow, while tank mass/volume uses Kell density. No sealed-vessel gas, boiling/phase change, stratification, water hammer, spatial CFD, pipe expansion or exact plug-flow delay is modeled. Inventory pipes approximate transport with mixed cells. Backpressured overflow is explicitly unsupported. Empty-vessel contact conductance remains the configured lumped value; wet/dry heat-transfer regimes are not distinguished.

AC uses single-frequency steady phasors, with no transient magnetic/electric storage, residual-flux reconnection, saturation, core loss, switching drives or single-phase induction machines. Ideal DC supplies may absorb returned shaft power; finite battery state is absent. Pump curves/efficiency are teaching approximations, not measured manufacturer validation; NPSH warns but does not reduce head.

Controls and valve/force actuators have ideal external power. Spatial contacts/joints retain solver slop and timestep error; extreme mass ratios, dense coupled contacts, maximum-size long-duration scenes and cross-platform bitwise replay are not certified. Native WebMCP host behavior and real-device/mobile performance are outside this physics pass. Arbitrary combinations of allowed parameters remain unexhausted.

Live archives use the corrected current engine, so old histories that depended on a defect may evolve differently; project configuration/schema/identities are preserved. The archived equations and counts in older phase reports are historical evidence.

## Executed results

The final release gate uses `VITEST_MAX_WORKERS=1 npm run check` to run tests sequentially on this host. Physical tolerances, timeout limits, ratings and reference scores were retained. Earlier concurrent baseline runs were interrupted after CPU contention caused wall-time failures; they are not counted as successful validation.

- Typecheck: passed.
- Unit/integration regressions: 279/279 tests, 23 files, before the final ESR correction. The final focused rerun passed all 22 AC/audit tests, including ten audit cases; the clean deployment gate includes 280 unit/integration tests.
- Quantitative physics: 87/87 checks, including timestep refinement; [expected/measured results](../validation/latest.md).
- Scale campaign: 124/124 checks; [results](../validation/scaling.md).
- Challenge score guard: all nine reference outcomes unchanged.
- Additional engine campaigns: all 16 starters ran to their configured durations; hydraulic transfer, pressure, sensor-fault supply and heated circulation passed; spatial mechanism/rotor/descent/lift/rotation passed. [Compact coupled evidence](../validation/physics-audit-coupled.json); the hydraulic/spatial reports include raw residuals, scoring and timings.
- Parameter audit: 55 kinds / 361 parameters; no uncovered catalog default property.

- Production build: passed.
- Production UI: all 65 distinct workflows passed across the campaign and corrected-test rerun. The first complete browser run passed 64/65; the new induction test used a checkbox API on a button. Its interaction was corrected without changing physical assertions, and all three new browser regressions passed on rerun. All 16 supplied experiments plus `blank.physics.json` were imported, advanced, saved/reloaded and reset. Existing workflows exercised live adjustments, fault recovery, charts/CSV and all nine missions.
- `git diff --check`: passed.

Release target: `deploy-2026-10-11.4`. The earlier `.3` candidate was stopped during validation, before changing the live service, to include the confirmed ESR parameter correction. The deployment script reruns the complete release gate from the clean tag before replacing the live service; runtime deployment status is reported separately in the task result.
