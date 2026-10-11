# Complete component inventory — Phase 3A + sandbox freedom

All 55 component kinds are connected to a solver or to the existing automation graph. **E** = MNA electrical; **T** = lumped thermal; **H** = hydraulic/enthalpy; **M** = mechanical midpoint; **C** = simulation-time control; **S** = Planck spatial rigid bodies. Validation references: **legacy** = physics/automation/integrity tests and quantitative report; **hydraulic** = hydraulic tests and coupled reference runs; **browser** = construction, probes, saves, faults and playable challenges. These are coverage categories, not a claim that every combination has been exhaustively tested.

| Component | Status / integration | Physical model / simplification | Validation | Missing functionality / priority |
| --- | --- | --- | --- | --- |
| DC supply | Implemented E; 30 V lab CV/CC to 800 V / 250 A bus | Ideal (protective trip), internal resistance, CV/CC active-set regulation, constant current with compliance; output enable; power rating reported | legacy, sandbox source tests, scaling campaign | Supply thermal model, ripple: low |
| Resistor | Implemented E/T | R₂₀ with linear α at simulated temperature, reproducible tolerance sample, I²R heat | legacy, sandbox | Nonlinear (NTC exponential) model: low |
| Variable resistor | Configurable resistor; resistance is a live parameter | Live R change is conservation-safe | sandbox live-edit tests | Dedicated wiper/three-terminal potentiometer: low |
| Circuit breaker | Implemented E/T/C (new); B10, C16, D63, MCCB 250 A, presets to 630 A | Thermal image θ' = ((I/In)² − θ)/τ, trip at 1.3² In²; magnetic multiple; breaking capacity reported; manual re-close after cooling; welded/open faults; status output | protection.test, scaling campaign | Selectivity studies with time-current plots: medium |
| Motor-protective breaker | Implemented E/T/C (new) | Overload setting, trip class (τ from 7.2 × Ir time), threshold 1.12, magnetic trip, thermal memory | protection.test, scaling campaign | Phase-loss sensitivity (needs unbalanced 3φ): low |
| Thermal mass / heat sink | Implemented T (new) | Lumped C, UA to ambient, port contact conductance; links any thermal masses in series-conductance | features.test, scaling campaign | Distributed conduction (1-D wall): medium |
| Heat exchanger | Implemented H/T (new) | Two branches with two-K (viscosity-dependent) loss; ε-NTU counter/parallel flow inside the linear enthalpy transport | hydraulic-advanced.test, scaling campaign | Wetted inventory, fouling, phase change: medium |
| Pressure-reducing valve | Implemented H (new) | Forward-only valve; integral pilot action on outlet gauge pressure with stroke-rate limit; stuck faults | hydraulic-advanced.test, scaling campaign | Droop/hysteresis characterisation: low |
| Signal blocks (scale, limiter, filter, rate limiter, selector) | Implemented C (new) | Exact first-order filter and rate limit on the simulation clock; invalid-input propagation | features.test | Lead-lag, dead-band, lookup table: low |
| Three-phase supply | Implemented E | Balanced per-phase star equivalent in the complex phasor solver: V_LL/√3 EMF, line currents, P and Q ×3, per-pole thermal ×3; R, L, C and induction-motor loads | features.test, ac.test, scaling campaign | Phase loss, harmonics, transients: low |
| AC source (single-phase) | Implemented E (new) | RMS phasor V∠φ behind R_i + jX_i at one network frequency; three of them form an explicit, possibly unbalanced three-phase system | ac.test (R–L, power-factor correction, unbalanced star) | Switching transients: low |
| Inductor | Implemented E/T (new) | R_w + jωL on AC; winding resistance on DC; I²R heat | ac.test, scaling campaign | Saturation, transient energy storage: medium |
| Capacitor | Implemented E/T (new) | ESR − j/(ωC) on AC; 1 GΩ leakage on DC; AC ESR / DC insulation heat | ac.test | Charging transients, ageing: medium |
| Induction motor | Implemented E/M/T; 7.5 kW and 45 kW, 400 V 4-pole | Dynamic dq model (stator/rotor flux, midpoint integration, exact magnetic energy ledger): inrush with DC offset, transient torque, residual flux and reconnection; steady state = per-phase equivalent circuit; shared shaft/load model, copper and interruption heat | induction.test, ac.test, motor-load.test, scaling campaign | Saturation, core loss, deep-bar effect, VFD, single-phase machines: medium |
| Power cable | Implemented E/T (new) | R = ρL/A (Cu/Al) with α, conductor heat capacity, ampacity-calibrated UA; insulation limit reported | sandbox, scaling campaign | Bundling/derating factors, insulation ageing: low |
| Switch | Implemented E/T | Finite closed R, exact open | legacy, browser | Arcs/bounce: low |
| Filament lamp | Implemented E/T | Constant R, calculated brightness/heat | legacy, browser | Nonlinear filament R: medium |
| Heater | Implemented E/T/H storage; 100 W–100 kW models and presets | Nominal V and P define derived R = V²/P; actual power from the circuit; element mass/UA/burn-out; any number per tank | legacy, hydraulic circulation, sandbox, scaling matrix | Explicit unbalanced heater topology, boiling: medium |
| Water tank | Implemented H/T; 1 L–50,000 L presets | Finite vented water, bottom port, level pressure, mixed enthalpy incl. vessel thermal mass; explicit or insulation-derived UA; thermal expansion (mass inventory, Kell density); weir overflow Q = ⅔C_d√(2g)Lh^1.5 above the rim, routed through the overflow port or exported | boundary/mixing/overflow tests, all hydraulic challenges, scaling matrix | Sealed gas headspace, multiple port elevations, stratification: medium |
| Ground | Implemented E | Shared zero reference | legacy | None for DC model |
| Wire junction | Implemented E | Explicit ideal shared node | legacy, browser | None for DC model |
| Fuse | Implemented E/T; 10 A–250 A models, presets to 630 A | Definite-time trip (configurable trip delay) above rating | legacy, sandbox | I²t/arc model: high |
| Voltmeter | Implemented E | 10 MΩ differential loading | legacy, browser | Instrument noise/ranges: low |
| Temperature sensor | Implemented T/C | Actual target temperature, exact lag, resolution, seeded noise, invalid failure | legacy, browser | Physical sensor thermal mass: low |
| Comparator | Implemented C | Typed numeric comparison, optional reference | legacy, hydraulic | No power model, intentionally ideal |
| Hysteresis | Implemented C | Stateful lower/upper thresholds | legacy, hydraulic supply | No independent control-power model |
| SPDT relay | Implemented E/T/C | Finite contacts, NO/NC, ratings, welded/open faults | legacy, browser | Coil energy/response delay: medium |
| Thermostat | Implemented T/C | Sensor + same hysteresis implementation | legacy | Physical bimetal model: low |
| Timer | Implemented C | Simulation-time TON/TOF/pulse | legacy | Retentive timer variants: low |
| AND | Implemented C | Typed Boolean, invalid propagation | legacy, hydraulic supply | None for ideal control |
| OR | Implemented C | Typed Boolean, invalid propagation | legacy | None for ideal control |
| NOT | Implemented C | Typed Boolean inversion | legacy | None for ideal control |
| Numeric constant | Implemented C | Explicit numeric signal source | legacy | Unit-aware numeric type inference: medium |
| Set/reset latch | Implemented C | Reset-dominant memory | legacy | None for ideal control |
| Reset pulse | Implemented C | One simulation-step pulse | legacy, browser | None for ideal control |
| Independent cutoff | Implemented E/T/C | Own temperature sensor, latched series contact, manual reset | legacy causal isolation, browser challenge 003 | Generic pressure/level certified cutoff: medium |
| Cooling jacket | Implemented T/C | Conductance to ideal reservoir, signed external heat | legacy, browser | Pumped finite coolant/refrigeration power: medium |
| DC motor | Implemented E/M/T/C; 24 V lab, 48 V traction, 180 V industrial variants | Back EMF, current/torque, inertia, friction, copper heat, ideal optional PWM; electrical ratings are protective limits | startup/stall/load/energy/fault/timestep tests, larger-motor analytical equilibrium, browser | Inductance/commutation/drive losses: medium |
| Centrifugal pump | Implemented M/H; 8 m laboratory to 3,000 L/min process curves | Affinity-scaled quadratic or data-point head curve; impeller, net hydraulic, mechanical-loss, shaft power and internal/overall efficiency from one shared model; explicit loss heat; internal reverse check; bearing/seal loss share (ω^1.6, KSB/SKF-based); cavitation head drop anchored at NPSH3 (−3 %) | transfer/valve/curve/energy/fault tests, data-curve, NPSH and pump-losses tests, browser | Measured cavitation breakdown curves, turbine/reverse rotation: medium |
| Pipe | Implemented H | Darcy losses with IAPWS 2008 μ(T) per cell (upstream temperature for zero-volume pipes), explicit L/D/roughness, water inventory in implicit mixing cells (transport delay) or ideal zero volume, explicit UA | law/junction/mixing/thermal/timestep tests, inventory delay test | Derived wall/insulation UA, water hammer: medium |
| Manual valve | Implemented H | Two-K loss / φ²; inherent characteristic linear (default), equal percentage or quick opening; exact isolation, pressure rating, stuck faults | hydraulic, valve-characteristics, browser | Measured manufacturer Kv curve, choked flow: medium |
| Check valve | Implemented H | Forward cracking pressure, zero reverse flow, two-K loss | hydraulic reverse/cracking | Dynamic poppet/water hammer: low |
| Actuated valve | Implemented H/C | Control valve, equal-percentage trim (R = 50) by default; finite stroke, numeric percent, fail position, stuck faults | hydraulic actuation, valve-characteristics | Electrical actuator load/torque: medium |
| Fluid junction | Implemented H | Ideal pressure node, conservative mixed enthalpy | hydraulic parallel/mixing | Finite junction inventory: low |
| Pressure sensor | Implemented H/C | Actual outlet gauge pressure, lag/range/noise/fault handling | pressure challenge, hydraulic integrity | Instrument dynamics/calibration: low |
| Flow sensor / flow probes | Implemented H/C | Signed branch flow; no extra hydraulic meter loss | hydraulic, browser | Real meter pressure loss: low |
| Level sensor | Implemented H/C | Actual inventory percent, lag/range/noise/failure | supply/fault tests, browser | Geometry-specific level response: low |
| PID regulator | Implemented C | Simulation-time integral, bounds, conditional anti-windup, feedforward, derivative on measurement with first-order filter | changing-demand challenge, features.test | Output-unit inference: low |
| Rigid body | Implemented S | Rectangle, circle, convex polygon, beam, wall, floor, platform, wheel; density×area×depth or explicit mass; collision/friction/restitution/CCD | Spatial references, collision/angular momentum/material/long-run tests, browser editing | Deformation/fracture: deferred; compound concave geometry: medium |
| Position sensor | Implemented S/C | Actual body-origin x/y metres, shared lag/range/noise/fault semantics | Lift/control/fault tests, browser | Off-center point/displacement sensor: low |
| Speed sensor | Implemented S/M/C | Actual body or lumped-motor RPM; shaft speed is authoritative | Rotation challenge/load/fault tests, browser | Encoder pulse/quantization dynamics: medium |
| Force actuator / brake | Implemented S/C | Bounded center force or torque, explicit viscous damper; external work or dissipated heat recorded | Force/impulse/braking/energy tests, descent browser | Electrical actuator power model: medium |

Spatial representations are available for motor, pump, tank, heater, cooler, source, resistor, lamp, pipe and valves. These are optional **static housings of the existing component identity**, not extra catalog entries or new thermal masses. Material thermal properties remain metadata. Fixed, revolute, prismatic, distance, spring and gear/rack constraints are world records with tested solver integration; they are not decorative catalog items. Motor rotor inertia joins the spatial rotor exactly once. Mechanical material/contact/constraint limitations are detailed in [Phase 3A](PHASE3A.md).

## Remaining unsupported extensions

| Requested foundation / extension | Actual status | Rationale / recommended priority |
| --- | --- | --- |
| Dedicated current-source component | No separate catalog entry | The DC supply already supports constant-current regulation with voltage compliance. |
| Radiator | Pipe UA supports simple zero-volume heat rejection | No separate spatial radiator/fin/fan model. Medium |
| Hydraulic pressure boundary / infinite reservoir | No catalog entry | Finite tanks provide supported boundaries; infinite supplies are not disguised as tanks. Low |
| In-line flow meter | Branch probe/sensor implemented | Ideal measurement has no resistance; explicit calibrated meter loss deferred. Low |
| Generic safety interlock | Existing Boolean gates, sensors and motor enable; independent thermal contact | Actual source/high-level logic works. Separate hydraulic latched hardware cutoff and common-cause fault studies remain medium priority |
| Turbine, dedicated generator, semiconductors, steam, structural failure | Unsupported | AC phasors and induction machines are implemented above; these extensions require separate models. |
