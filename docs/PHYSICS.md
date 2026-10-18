# Physical and numerical models

This is the reference for every model the engine solves: the equations, how they are discretized, what they conserve and what they leave out. Component coverage is listed in [COMPONENT-MATRIX.md](COMPONENT-MATRIX.md); parameter domains and editing policies in [SANDBOX.md](SANDBOX.md) and the generated [PARAMETER-MATRIX.md](PARAMETER-MATRIX.md).

Most catalog coefficients are illustrative engineering values. The electric boiler, circulator and panel radiator distinguish manufacturer specifications from fitted and assumed coefficients; see [ELECTRIC-BOILER.md](ELECTRIC-BOILER.md) for the Bosch TH3000 9 reference and [PANEL-RADIATOR.md](PANEL-RADIATOR.md) for the Kermi therm-x2 radiator and their calibration. Passing the test suites does not certify every combination of allowed parameters.

**Contents**

1. [Units and conventions](#units-and-conventions)
2. [Time integration](#time-integration)
3. [Electrical networks](#electrical-networks)
4. [Protection](#protection)
5. [Electrical devices](#electrical-devices)
6. [Thermal network](#thermal-network)
7. [Water and hydraulics](#water-and-hydraulics)
8. [Motors and drives](#motors-and-drives)
9. [Centrifugal pumps](#centrifugal-pumps)
10. [Rigid bodies and mechanisms](#rigid-bodies-and-mechanisms)
11. [Control and measurement](#control-and-measurement)
12. [Energy and mass accounting](#energy-and-mass-accounting)
13. [Limitations](#limitations)
14. [References](#references)

## Units and conventions

- The engine works in SI: V, A, Ω, W, J, s, kg, m, m³, Pa, rad/s. Temperatures are stored in °C; temperature differences in °C and K are identical.
- Some editor fields keep engineering units for compatibility: tank volumes in litres, flows displayed in L/min, pressures in bar, speeds in RPM. `units.ts` holds the conversions, and controls exchange SI values (Pa, m³/s).
- Schematic coordinates are pixels and carry no physics. Spatial coordinates are metres with y upward; angles are radians.
- Sources report delivered power as negative (source convention); passive elements report absorbed power as positive.
  The canvas readout under a module flips this for sources and solar panels so that delivered power reads positive; batteries read positive while charging. Probes and charts keep the solver sign.
- AC quantities are RMS phasors unless stated otherwise.

## Time integration

**Outer clock.** The simulation advances in fixed 1/60 s steps, independent of rendering. Speed multipliers change the number of steps per frame, never the step size. Frame catch-up is budgeted to 12 ms of work per frame with a bounded backlog; an overloaded scene slows the simulation clock instead of changing the physical step.

**Per step, in order:**

1. Read sensors from the prior accepted state.
2. Evaluate the acyclic control graph on simulation time.
3. Apply relay, contactor and safety contacts.
4. Solve the coupled electrical, shaft, hydraulic and rigid-body state over one or more substeps.
5. Integrate the thermal network (backward Euler) and the energy ledger.
6. Check ratings, protection, the liquid-water range and scenario conditions; re-solve immediately after a failure or trip.
7. Update challenge state and record probes.

**Coupled substeps.** A fixed step is split only where a time scale requires it:

| Situation | Substep |
| --- | --- |
| Hydraulics and DC motors | One substep per step. The network is solved at mid-step tank inventories predicted from the previous flows (second order in the head/storage splitting), bounded by ≤ 1 % of a tank's height per substep and by a surcharged weir's level time scale |
| Induction machines | ≤ 1/240 s; ≤ 1/(40·f) while the machine flux changes (switching, run-up, interruption) |
| Moving rigid bodies | ≤ 1/480 s; stiff springs and dampers reduce this further |
| Discrete events | The substep is split exactly at tank empty/full, a rotor stopping, contactor pickup/dropout and starter transitions |

Steps below 1/30,000 s or more than 1,024 internal intervals in one outer step are rejected with guidance.

**Readings are step averages.** Currents, voltages and powers describe the interval just solved. A paused solve (after an edit, before Run) previews the next 1/60 s step, so a capacitor that is about to charge shows its step-average current, not an instantaneous inrush.

The shaft midpoint solve uses a finite-difference chord Newton iteration with a residual tolerance of 10⁻⁸ rad/s. Trial steps backtrack when necessary to reduce the actual coupled residual across current-limiting and check-valve transitions; a chord that cannot reduce it is rebuilt locally. This avoids cycling between CV and CC supply states without changing the physical equations or convergence tolerance.

**Adaptive advance.** Sandbox experiments without moving rigid bodies can advance by up to +24 h with `AdaptiveRun` (`engine.ts`). The thermal network is implicit and its energy ledger uses the implicit values, so conservation holds for any step size; the step size affects only accuracy. The step bound is the minimum of:

- 30 s and twice the previous step;
- 0.05 K divided by the largest |dT/dt|;
- a twentieth of any running timer delay, the sensor sampling interval, twice a sensor lag, 0.5 s with a PI controller;
- τ/200 for a breaker, motor protector or fuse above 0.8 of its trip level, and a tenth of a fuse's remaining melting time;
- tank level, valve travel, motor acceleration and the weir time constant (hydraulic and motor networks);
- 0.2 % change in a battery's state of charge; 1 % of a capacitor's voltage (at least 1 V) or of an inductor's current (at least 1 % of its rating) per step; 1 s while a contactor coil is within 5 % of rated voltage of its pickup or dropout threshold.

Any discrete change (contacts, failures, Boolean signals, CV/CC regulation) restarts at 1/60 s. Each advance is recorded as `{ at, adaptive: { duration, steps, tolerance, maxStep } }` and replays bit-identically. Rigid-body scenes and scored challenges use fixed steps.

## Electrical networks

### DC modified nodal analysis

Ideal wires merge nodes (union-find). Each island is solved by modified nodal analysis:

```
[G  B] [v] = [0 ]
[Bᵀ 0] [i]   [Vs]
```

Resistive branches stamp 1/R into G; voltage sources stamp B. All ground components share one zero reference; every other island gets its own local reference, and cross-island differential probes are invalid. Unchanged solutions are cached by contact and fault state.

Dense real and complex solves (`linear-algebra.ts`) equilibrate equations and unknowns with power-of-two scaling, use machine-precision-relative pivot checks, and apply bounded compensated-residual refinement to poorly scaled real systems. The normalized backward error of the original equations is checked componentwise; auxiliary sensitivity solves (unit storage states, refinement corrections, the matrix exponential and Lyapunov systems of [DC storage](#capacitors-and-inductors-dc-storage)) use the normwise bound instead, because their exact zeros come out as rounding noise. This is not a condition-number certificate. A short across an ideal source, or conflicting ideal sources, gives an explicit solver error and pauses the experiment instead of substituting values.

### Sources

`mode` selects the source model:

- **ideal**: V_a − V_b = V_set; above `maxCurrent` the output protection trips (latched until reset).
- **internal**: Thevenin V_a − V_b − R_i·I = V_set; a short circuit is valid.
- **cvcc** (current-limited laboratory supply): an active-set iteration switches each source between the CV row and I = ±I_limit. A source at the delivery limit returns to CV when its required EMF rises above the setpoint; one at the absorption limit when it falls below. Repeated active sets or iteration exhaustion fail explicitly.
- **cc**: constant current with the voltage as compliance limit.

Supplied energy is net terminal delivery; configured internal losses lie outside that boundary. `maxPower` is reported only (there is no supply thermal model). DC supplies trip instantly above their rating; AC supplies use the thermal-magnetic characteristic under [Protection](#protection).

### Resistive elements

- R(T) = R₂₀·(1 + α(T − 20 °C)) at the element's simulated temperature; the circuit is re-solved each step when any α ≠ 0 (explicit coupling). The solver reports the temperature at which a negative α would make R non-positive.
- `tolerance` applies a reproducible deviation inside the band, derived from the component identity.
- Resistance is a live parameter: changing it creates no energy, so a resistor works as a rheostat.
- Fixed values: closed switch 0.01 Ω (open: no conductance), voltmeter 10 MΩ.
- Passive dissipation I²R heats the element's own thermal mass. Ideal wires have no resistance, mass or loss.

### AC phasor networks

An island whose sources are AC is solved by complex MNA at one frequency:

| Element | Impedance |
| --- | --- |
| Resistor, heater, lamp, cable, … | R (temperature-dependent as in DC) |
| Inductor | R_w + jωL |
| Capacitor | ESR − j/(ωC); ESR with its temperature coefficient and tolerance |
| AC source | V∠φ behind R_i + jX_i |
| Induction motor | dynamic machine (see [Induction motor](#induction-motor)) |

- Readings: RMS voltage and current, active power P, reactive power Q (inductive positive), power factor |P|/S. AC ratings compare apparent power √(P² + Q²).
- **Single-phase sources** each have their own phase angle. Three of them at 0°/−120°/+120° with a common neutral form an explicit, possibly unbalanced, three-phase system; neutral current and line-to-line voltages follow from the solution.
- **Balanced three-phase supply** (`source3`): solved as the per-phase star equivalent (V_LL/√3), powers × 3, per-pole thermal mass × 3.
- **In DC networks** capacitors store charge and inductors current (see [Capacitors and inductors](#capacitors-and-inductors-dc-storage)); their DC state is held while they sit in an AC network.
- **Rejected with explanations:** DC and AC sources in one network; different frequencies in one network; a DC motor on AC or on a three-phase network; a three-phase induction motor without a `source3` supply. AC and DC parts that must coexist (for example a DC contactor coil switching an AC load) are separate islands.
- **Step readings.** When a step has substeps, currents are RMS over the substeps √(Σ I²·h / Δt), powers are averages, and power factor is average real power over average apparent power. In DC networks with capacitors or inductors each substep's mean square includes the current's exact within-step variance.

## Protection

Ratings (`ratedPower`, `ratedCurrent`, `ratedVoltage`, `maxPressure`, `maxTemperature`, `maxSpeed`, …) are specifications, not switches: exceeding one is reported as a rating violation and marks the component `OVERLOADED`. Failures happen only where a failure model exists: element over-temperature, fuse melting, breaker and supply trips. In scored challenges any violation fails the check.

### Thermal-magnetic breakers and supply protection

Circuit breakers, motor-protective breakers and AC supplies share one characteristic with In = the current rating:

- thermal image dθ/dt = ((I/In)² − θ)/τ, integrated exactly over each step using the step's RMS current; trip at θ ≥ 1.3² (supplies, breakers) or the motor protector's threshold 1.12 with τ from its trip class (7.2 × Ir time);
- at 2 × In from cold the supply trips after τ·ln(4/(4 − 1.69)) = 32.9 s with τ = 60 s;
- magnetic (instantaneous) trip at k·In. Curves state k·In as a symmetric RMS current while the release responds to the instantaneous current, so on AC the release trips when |i(t)| ≥ √2·k·In. Each substep reports the largest instantaneous line current over its interval (exact for the phasor held over the substep). An asymmetric motor inrush can therefore trip a release whose setting lies above the symmetric current. DC releases compare the step's largest |i| with k·In (with capacitors or inductors in the network, the exact current at the start or end of the step, e.g. a capacitor's inrush);
- breaking capacity is reported; re-closing is possible only after cooling; welded and open faults are injectable; a status output feeds the control graph.

A stalled 7.5 kW motor (≈ 1.17 × In) does not trip the 63 A supply, as with a real C63 breaker; the motor's winding temperature or a motor-protective breaker must act.

### Fuse (gG melting characteristic)

Normalized temperatures with a steady element rise of x² = (I/In)²:

- element: C₁·dθ_e/dt = x² − (θ_e − θ_b)/0.15, C₁ = 44.16·T;
- body and holder: time constant 400·T to ambient, carrying 85 % of the steady rise;
- melting at θ_e ≥ 1.45²; T = `tripTime` is the melting time at 10 × In (exactly, by calibration);
- exact update over each step (2 × 2 matrix exponential).

With the default T = 0.1 s the fuse meets the IEC 60269 gG gates (16 A link, normalized) except the 9.38 × In gate, which it misses by 15 ms:

| Current | Gate | Model |
| --- | --- | --- |
| 1.25 × In | no melting in 1 h | never |
| 1.6 × In | melts within 1 h | 70 s |
| 2.06 × In | ≥ 10 s | 24 s |
| 4.06 × In | ≤ 5 s | 1.1 s |
| 5.31 × In | ≥ 0.1 s | 0.45 s |
| 9.38 × In | ≤ 0.1 s | 0.115 s (missed by 15 ms: 0.1 s at 10 × In is the slow edge of the band; lower `tripTime` for a faster link) |

The body gives thermal memory: after 30 min at 1.2 × In a 2 × In overload melts the element in less than 60 % of the cold time; 3 h without current restore the cold characteristic. Not modelled: arcing time, current limitation, let-through I²t, aM/aR classes, rating-dependent curve shapes.

## Electrical devices

### Filament lamp

A lumped tungsten filament with u = T/T_op (T_op ≈ 2,700 K at rated power), `filament.ts`:

- R(u) = R_hot·u^n with n = ln 0.1 / ln(293 K / 2,700 K) = 1.04: the cold filament has 10 % of the configured (hot) resistance;
- losses P_r·[0.9·(u⁴ − u_a⁴)/(1 − u_a⁴) + 0.1·(u − u_a)/(1 − u_a)] (radiation plus gas and lead conduction), equal to the rated power at u = 1;
- heat capacity from a 0.08 s time constant linearized at the operating point;
- per step the electrical power (solved with the start-of-step resistance) is held and the losses are implicit. The electrical energy equals the change of filament energy (counted as stored energy) plus the heat passed to the lamp body.

The default 6 Ω / 30 W lamp settles to exactly 6 Ω and 30 W at rated voltage (13.4 V); switch-on draws ≈ 10 × the hot current and decays to within 10 % in ≈ 0.12 s; below rated voltage it is non-ohmic, P ∝ V^1.59. A lamp is over its rating when the filament runs above its rated temperature, not during the surge. A C-curve breaker or gG fuse sized above the hot current carries the surge; a B-curve release sized at the hot current trips on it. Limit: the surge is resolved at the fixed step, so the first step carries the full cold current and the surge's I²t is overestimated (up to ≈ 2×).

### Power cable

R₂₀ = ρL/A (Cu or Al) with the material's α; heat capacity ρ_m·A·L·c_p; ambient UA calibrated so that the rated current (ampacity) reaches the insulation temperature limit at 30 °C ambient. Above ampacity the cable reports the violation and heats physically. Insulation damage is not modelled.

### Capacitors and inductors (DC storage)

On DC both store state in the engine (`devices.ts`): a capacitor's dielectric voltage v (set by `chargeVoltage` at reset) and an inductor's winding current i (zero at reset).

```
capacitor:  C·dv/dt = i_C     U = ½·C·v²     ESR in series, R_leak = 1 GΩ across the terminals
inductor:   L·di/dt = v_L     U = ½·L·i²     R_w in series, R_breakdown = 1 MΩ across the terminals
```

R_leak is insulation self-discharge. R_breakdown stands for the switching arc and winding capacitance: it only matters when the inductor's current has no other path.

**Exact steps.** For the CV/CC state of a step the network is linear in the storage state x (all dielectric voltages and inductor currents of an island): ẋ = A·x + g, with A from one solve per storage element (unit state, sources off). The step uses the start rate ẋ₀ and Φ₁ = ∫₀ʰ e^(As) ds, Φ₂ = ∫₀ʰ∫₀ᵗ e^(As) ds dt, both read from one Van Loan exponential exp([[A, I, 0], [0, 0, I], [0, 0, 0]]·h) (scaling and squaring, Padé 13):

```
x(h) = x₀ + Φ₁·ẋ₀        x̄ = x₀ + Φ₂·ẋ₀/h
```

Each element is stamped at its step average (a dielectric at v̄ behind its ESR, an inductor as the current ī), so every step-average voltage and current of the network is exact for any step:
- an RC or RL transient at 1/60 s or in 30 s adaptive steps;
- a capacitor switched straight onto a supply (τ = 6 µs), which settles within its first step without ringing;
- charge exchanged between capacitors;
- an RLC circuit ringing (the 10 V step response of a ζ = 0.1 series circuit overshoots to 17.3 V, as computed).

The quantities are formed from the start rate, so slow leakage modes and modes heading for a huge voltage (a current source into the leakage) keep their digits. A dielectric's start current is read from the rest of the network at its node rather than as a difference of nearly equal voltages. A and g depend only on the CV/CC state; the step is final once that state repeats (at most four passes). At most 16 storage elements per DC network.

**Within-step currents.** Every branch current is affine in x. With z = x − x₀, Z = ∫z dt and the Lyapunov equation

```
A·W + W·Aᵀ = z(h)·z(h)ᵀ − ẋ₀·Zᵀ − Z·ẋ₀ᵀ,     covariance Σ = W − Z·Zᵀ/h
```

each branch gets its exact mean square ī² + bᵀΣb/h and its currents at the start and end of the step. Consequences:
- **Heat:** every resistance receives its exact ∫R·i². A fast charging loss is split over the loop resistances; a 100 µF capacitor switched through a 0.01 Ω switch with 0.05 Ω ESR heats the switch with 1/6 of ½·C·V².
- **Supplies:** delivered energy accounts for their internal resistance the same way (∫(E − R·i)·i dt).
- **Readings:** the step's RMS current includes the within-step variance, so fuses and thermal images see the true I²t.
- **DC magnetic releases** compare the step's largest |i| (start or end) with k·In. A breaker trips on capacitor inrush but not when a precharge resistor limits it.
- **Lossless pair:** if a nearly lossless mode pair (λᵢ + λⱼ ≈ 0) makes the Lyapunov system singular, the variance is omitted for that step and the averages stay exact.

**Energy.** ΔU follows exactly from the states: ½·C·(v₁² − v₀²) or ½·L·(i₁² − i₀²). The element's heat is its ESR or winding loss plus the leakage or breakdown loss, each as ∫R·i². Charging a capacitor through any resistance loses ½·C·V², as in reality, and the ledger closes to rounding.

**Interrupting an inductor.** If a switch opens an inductor's only path, its current decays through the breakdown path within microseconds (τ = L/1 MΩ). ½·L·I² heats the inductor (standing for the switching arc) and the event log reports the energy. A freewheeling resistor or path across the inductor takes the current over instead, decaying with L/R.

**Electrolytic capacitors** (`polarized`): terminal a is positive. A dielectric voltage below −1 V, or any AC network, breaks the oxide down: the capacitor vents and fails open. Non-polarized (film) capacitors have no such limit.

**On AC networks** capacitors and inductors are the phasor impedances of [AC phasor networks](#ac-phasor-networks), and their DC state is held. Capacitance, inductance and the charge voltage are Reset-only because they define stored energy. Probes: dielectric (charge) voltage and field energy.

Not modelled: peaks inside a step of an oscillating transient (the start and end currents are compared), dielectric absorption, voltage- and frequency-dependent capacitance and ESR, core saturation and core loss of inductors on DC, the energy of an interrupted inductor heating the switch rather than the inductor, a failed inductor's held current.

### Battery

A rechargeable DC Thevenin model with capacity Q = 3600 × capacityAh coulombs, state of charge s ∈ [0, 1] and a one-RC polarization branch R₁ ∥ C₁ in series with the ohmic resistance R₀:

```
E(s) = E_empty + (E_full − E_empty)·f(s)
V_terminal = E(s) + R₀(T)·I + v₁
C₁·dv₁/dt = I − v₁/R₁(T),   C₁ = τ₁/R₁(20 °C)
R(T) = R₂₀·exp(Eₐ/R·(1/T − 1/293.15 K))
U_chemical(s) = Q·∫₀ˢ E ds,   U_pol = ½·C₁·v₁²
Q·ds/dt = η·I (charging) or I (discharging) − I_sd,   I_sd = Q·r_sd/30 d
```

**Open-circuit curve** (`chemistry`): f is linear between tabulated states of charge, so U_chemical is exact (piecewise quadratic). Typical cell shapes, not a specific manufacturer's:

| s | 0 | 0.05 | 0.1 | 0.2 | 0.4 | 0.5 | 0.6 | 0.8 | 0.95 | 1 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Linear (lead-acid-like) | 0 | | | | | 0.5 | | | | 1 |
| Li-ion NMC (3.0–4.2 V per cell) | 0 | 0.375 | 0.458 | 0.517 | 0.6 | | 0.708 | 0.833 | | 1 |

LiFePO₄ uses a rested open-circuit table, 2.5–3.40 V per cell. Below is the 4-cell (12.8 V nominal) form; f = (V − 10)/3.6:

| s | 0 | 0.09 | 0.14 | 0.17 | 0.2 | 0.3 | 0.4 | 0.7 | 0.9 | 0.99 | 1 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Rested OCV, 4 cells (V) | 10.0 | 12.0 | 12.5 | 12.8 | 12.9 | 13.0 | 13.1 | 13.2 | 13.3 | 13.4 | 13.6 |

The table is a published resting-voltage chart ([Footprint Hero](https://footprinthero.com/lifepo4-battery-voltage-charts), labeled open-circuit at rest), not a cell manufacturer's measurement; Victron publishes no OCV curve for its Lithium Battery Smart. Its integral is 12.90 V × capacity (1290 Wh for 100 Ah, against the reference battery's 1280 Wh nominal energy). The 3.65 V per cell (14.6 V) that LFP reaches at the end of a charge is a terminal voltage under charging current, not an open-circuit voltage. Full rest therefore lies between the reference float (13.5 V) and absorption (14.2 V) settings: absorption charges to full, and float holds about 99.5 %.

**Charge acceptance and self-discharge.** On charge only the coulombic efficiency η of the charge is stored (default 97 %; lead-acid 85–95 %, Li-ion above 99 %); the rest drives side reactions. A charged battery loses r_sd per 30 days (default 3 %/month) through an internal current. Both losses heat the pack. At full the battery accepts only the trickle current that offsets its self-discharge (an ideal charge termination); at empty, self-discharge stops.

I is positive into the positive terminal (charging). Over an interval h with the battery current held, both states advance exactly: the midpoint OCV is stamped as E(s_old) behind (dE/ds)·h/(2Q) (exact on a linear segment), and the polarization branch as φ·v₁(0) behind (1 − φ)·R₁ with y = h/(R₁C₁), φ = (1 − e^(−y))/y, the exact step average of v₁. The chemical and polarization energies change exactly as the states do; the rest of the terminal energy V·I·h (with any within-step current variance) is the pack's heat: R₀ and R₁ loss, charge-acceptance and self-discharge loss, and the tiny midpoint error where a step crosses a curve knot. The ledger is therefore exact for any accepted interval. Under a sustained load the terminal voltage sags by R₁·I over τ₁ and recovers after the load ends. R₀ and R₁ follow the Arrhenius factor at the pack's simulated temperature (C₁ is fixed, so τ₁ follows R₁); the default Eₐ/R = 2,000 K gives 1.65 × at 0 °C and 2.9 × at −20 °C, and nothing changes at 20 °C.

Empty and full events split the interval: at empty, discharge is blocked but charging remains possible, and vice versa (an ideal directional protection boundary, not a charger). The current rating trips the output; over-temperature disconnects the pack. Chemical and polarization energy are inside the system boundary: a battery discharging into a resistor shows zero external supply and equal storage loss and thermal gain. Probes: state of charge, chemical energy, polarization overpotential.

Not modelled: hysteresis between charge and discharge curves, temperature-dependent OCV and capacity, rate-dependent capacity (Peukert), a charger's CC–CV profile beyond the ideal termination, ageing, cell balancing.

### Relays and powered contactors

The SPDT relay has finite-resistance NO and NC contacts with their own thermal mass, driven by a control signal; a de-energized relay's heat uses the conducting a–nc voltage. Welded and open faults are injectable; a welded contact ignores OFF and can defeat ordinary control.

The powered contactor has a normally-open power path a–b and a separate DC coil ca–cb:

```
I_coil = V_coil / R_coil
P_package = V_coil²/R_coil + P_contacts
pickup:  |V_coil| ≥ pickupRatio × ratedCoilVoltage for pickupTime
release: |V_coil| ≤ dropoutRatio × ratedCoilVoltage for dropoutTime
```

Between the thresholds the contact keeps its state. Timers advance only on accepted simulation intervals and end substeps exactly at the delay. In a balanced three-phase network the power path represents three poles; the coil counts once. AC coil excitation is rejected. Not modelled: coil inductance, armature motion, flyback, arcs, bounce, auxiliary contacts.

### Transformer

Dotted primary a–b and secondary sa–sb, with n = Np/Ns, primary-referred winding resistance R and leakage inductance L, and a primary-terminal shunt Rc ∥ jωLm:

```
Vp − n·Vs = (R + jωL)·I_transfer
I_secondary,into device = −n·I_transfer
I_primary = I_transfer + (1/Rc + 1/(jωLm))·Vp
P_loss = phases × [R·|I_transfer|² + |Vp|²/Rc]
```

Both windings are in the same MNA solve, so load reflection and reverse power flow are simultaneous; each galvanically separate side gets its own voltage datum. Impedances are evaluated at the fundamental or harmonic frequency. DC excitation is rejected. Not modelled: saturation, switching inrush, hysteresis, frequency-dependent core loss, vector-group phase shifts.

### Fan-cooled radiator

A bidirectional two-K water restriction plus a resistive fan load on a–b:

```
R_fan = V_rated² / P_fan,rated
UA = UA_natural + UA_forced × min(1, |V_fan|/V_rated)^0.8
T_out = T_amb + (T_in − T_amb)·exp(−UA/(ṁ·c_p))
```

Forced UA is zero without fan power; natural UA remains. The 0.8 exponent is an empirical teaching approximation. The zero-inventory radiator exchanges signed heat with an ideal ambient boundary; at zero flow the fluid temperature is unavailable. Not modelled: fin and water storage, fan inertia, airflow networks, humidity.

## Thermal network

Each non-source element has a lumped heat capacity C (J/K) and an ambient conductance UA (W/K). Tanks use C = m·c_p + C_vessel with c_p = 4,180 J/(kg·K); the vessel mass is lumped at the water temperature. Thermal links (heater immersion, thermal ports, contact conductances in series) stamp symmetric conductances, so internal heat flow cancels exactly. The network is integrated by backward Euler:

```
(C/Δt + ΣUA)·T_next − Σ UA·T_neighbour,next = (C/Δt)·T_old + P + UA_ambient·T_ambient
```

This is unconditionally stable with first-order time error. Electrical power is evaluated at the start of the step; heat transfer uses end-of-step temperatures. Storage change is ΣC·(T_next − T_old); ambient exchange ΣUA·(T_next − T_a)·Δt.

- **Heaters** are defined by nominal voltage and power; R = V²/P is derived and the actual power follows the solved circuit. Any number of heaters may share a tank.
- **Thermal mass / heat sink** components and thermal ports on resistors, cables and motors link arbitrary masses.
- **Cooling jacket**: UA·(T − T_coolant) to an ideal reservoir of fixed temperature and unlimited capacity; no pump work or coolant flow is implied.
- **Tank heat loss**: explicit UA, or derived from insulation as UA = A_wall/(1/h + t/k) for a vertical cylinder with h = 10 W/(m²·K).
- **Ambient** is resolved centrally: explicit local override → containing Thermal Space (future) → experiment environment (default 20 °C). New components inherit. The experiment boundary is editable in the sandbox (−100 to 500 °C); challenges lock it to 20 °C. Initial temperatures, operating temperatures and control setpoints are separate. Bodies without an explicit initial-temperature parameter start at their resolved ambient. See [environment resolution and component audit](ENVIRONMENT.md).
- **Water** is well mixed and must stay within 1–95 °C; leaving the range pauses with a diagnostic. Evaporation, boiling, radiation from tanks and spatial gradients are not modelled.

## Water and hydraulics

### Water properties (`water.ts`)

- **Density:** Kell (1975) at 1 atm for tank inventories. Flows, pipe inventories and pump heads use ρ_ref = 1,000 kg/m³.
- **Viscosity:** IAPWS R12-08 (2008) μ(T, ρ) with μ̄₂ = 1, matching the official check values to the printed digits and published 1 atm values at 10–80 °C to ≤ 0.004 %. Outside 0–100 °C the call throws; it never extrapolates.
- **Heat capacity:** c_p = 4,180 J/(kg·K) constant (real variation ≈ 1 % over 1–95 °C).
- Temperature feeds back into flow from the previous transport substep (one substep of lag, no nested iteration). At t = 0 a zero-length transport mixes inventories and the network is re-solved once.

### Network solve (`hydraulic.ts`)

Connections merge ideal nodes; pipe components are resistance branches (drawing a route never sets a pipe length). Node unknowns are piezometric pressures Π = p + ρgz; every internal node satisfies ΣQ = 0. Monotone branch laws are inverted (closed-form quadratics for pumps and valves, a warm-started Illinois inverse for pipes), then a damped nodal Newton iteration solves the network: pressures scaled to kPa, residual flow to L/s, at most 60 iterations and 24 backtracking reductions with an Armijo sufficient-decrease condition. One-way branches at zero flow use a generalized-slope fallback. Continuity is accepted below 10⁻¹² m³/s. A small Jacobian regularization supports isolated closed regions without adding branch leakage. Limits: 120 hydraulic branches and 200 pressure unknowns. Directly merged finite tank boundaries are rejected: insert a real pipe.

### Pipes

v = Q/(πD²/4), Re = ρ|v|D/μ, Δp = f·(L/D)·ρv|v|/2. Laminar f = 64/Re (Hagen–Poiseuille slope retained at zero flow); turbulent Swamee–Jain f = 0.25/[log₁₀(ε/(3.7D) + 5.74/Re^0.9)]²; a continuous linear blend for Re = 2,300–4,000. Relative roughness ε/D ≤ 0.05 (correlation validity). Material sets the roughness preset.

By default a pipe holds ρAL of water in implicit mixing cells, which gives a transport delay; each cell uses its own temperature for viscosity. A zero-volume pipe uses the upstream node temperature. Pipe heat loss: T_out = T_a + (T_in − T_a)·exp(−UA/(ṁ·c_p)), the same signed heat entering the energy ledger. Pipe inventories do not expand thermally.

### Valves

Valves, check valves, actuated valves, pressure-reducing valves and both heat-exchanger streams use the Hooper two-K form with the inherent characteristic φ(x) of travel x:

```
K(Re) = K₁/Re + K∞            Δp = K(Re)·ρv²/2 / φ(x)²

linear            φ = x
equal percentage  φ = R^(x − 1)     R = rangeability (default 50)
quick opening     φ = √x
```

The K₁ term is a pressure drop linear in flow, using the upstream viscosity. Defaults: K₁ 500 for ball/gate valves, 1,500 for globe valves, regulators and swing checks, 1,000 for heat exchangers. Manual and pressure-reducing valves default to linear trim; the actuated valve is a control valve with equal-percentage trim. 0 % travel is the seat and isolates exactly. The installed characteristic is not a parameter: it follows from the network (with low valve authority an equal-percentage valve behaves nearly linearly).

For a purely quadratic restriction (K₁ = 0), the inverse slope is bounded near zero pressure only in the Newton Jacobian. No artificial series resistance is added to the pressure drop or heat ledger.

- **Check valve:** forward cracking pressure, no reverse flow.
- **Actuated valve:** moves at 100/responseTime percentage points per second toward a numeric percent command; an invalid command selects the fail position. Actuator power is not modelled.
- **3-way diverting valve:** two branches from the common port AB with complementary openings, φ_A = 1 − x and φ_B = x (Kvs per path); the plug travels at 100 %/running time toward a Boolean command (B when true) and returns to A on a lost signal. It is the heat pump's hot-water valve VW1 ([HEAT-PUMP.md](HEAT-PUMP.md#hot-water-mode-and-the-3-way-valve-vw1)).
- **Pressure-reducing valve:** forward-only valve with integral pilot action on its outlet gauge pressure and a stroke-rate limit.
- Stuck-open and stuck-closed faults impose the corresponding restriction.

Not modelled: measured manufacturer Kv curves, choked flow and cavitation in valves.

### Tanks

Tanks are open, vented, well-mixed vessels with a bottom port, a constant free-surface area A, a base elevation, a capacity and a pressure rating. They track mass m; the volume follows from density:

```
V = m/ρ(T)       P_bottom = ρ_ref·g·z + g·m/A       Φ = g·(z·m + m²/(2·ρ_ref·A))
```

The bottom pressure is exact for any density profile (the column weight per area); the potential uses ρ_ref (Boussinesq), so the ledger stays exact. Heating 1 m³ from 20 to 80 °C adds 27.2 L, and a tank filled cold to the rim overflows when heated.

- **Empty:** the step is split at the empty instant. An empty tank (≤ 10⁻⁹ kg) cannot supply net outflow; its node obeys a complementarity condition solved by an active set. Without inflow its outflow is blocked (exactly zero). With inflow it is either held at the empty-tank head with net inflow ≥ 0 (the tank fills), or, when its outlets could carry more than arrives, a continuity node at or below that head through which the inflow passes while the tank stays empty (a drained tank, `HydraulicResult.drained`). Mid-step levels keep an empty tank empty. Water leaving a tank that was empty at the start of the interval leaves at the mixed inflow temperature, and water it keeps is booked at that temperature. An empty tank keeps its vessel heat capacity and exchanges heat; its fluid temperature is unavailable.
- **Overflow:** a full tank's surface rises a surcharge h above the rim and discharges over a sharp-crested weir, Q = ⅔·C_d·√(2g)·L·h^1.5 with C_d = 0.62 and L = `weirLength` (default 0.3 m). The surcharge is part of the level, pressure and potential. Rim events (overflow onset, surface returning to the rim) are not located within 1 µL of the rim, so alternating flow around a brim-full tank, e.g. thermal expansion of a vessel filled to capacity, cannot split the step without bound; mass and energy remain exactly booked. The `overflow` port can be piped to another component; if that network reaches a finite tank the flow and its enthalpy are injected there, otherwise they leave the system and are counted as exported mass and energy. A drain whose piezometric pressure exceeds the free surface stops with an explicit unsupported-backpressure error (submerged weirs are not modelled). Direct tank-to-tank wires and overflow-to-overflow connections are rejected.
- **Filling protection** must be explicit (valve, level switch or controller); overflow does not stop a pump. In hydraulic challenges any overflow is a rule violation.

Not modelled for this vented tank: gas headspace, multiple port elevations, stratification. Sealed, stratified buffers and cylinders are the separate `storageTank`; see [Stratified storage and system pressure](#stratified-storage-and-system-pressure).

### Stratified storage and system pressure

- **Storage tank** (`storageTank`): a sealed, rigid vertical cylinder of N layers solved implicitly with its port inflows and outflows, upwind vertical advection from continuity, vertical conduction, wall losses from the ErP standby loss and an optional coil of exponentially fitted cells; density inversions (Kell) are mixed after each step. Its response is affine in the inlet temperatures and enters the global enthalpy solve.
- **Expansion vessel** (`expansionVessel`): an isothermal nitrogen cushion, p_abs = p₀,abs·V_n/(V_n − V_w), is the piezometric boundary of its sealed circuit. The water side takes the circuit's thermal expansion E = Σ V_i·(ρ_i,fill/ρ(T_i) − 1) of every fixed inventory (the transport keeps fixed masses), less discharged water. Circuits without a vessel keep the fixed fill-pressure datum.
- **Safety valve** (`safetyValve`): spring-loaded relief (TRD 721 type H) with pop and blowdown; discharge leaves the system with its mass, enthalpy and potential, supplied from the vessel's water ledger; the cushion's work Π·Q on that water is booked.

Equations, provenance, calibration and limitations: [STORAGE-AND-PRESSURE.md](STORAGE-AND-PRESSURE.md).

### Heat transport and exchangers

Enthalpy m·c_p·T is transported conservatively: tanks mix integrated enthalpy, and junctions are solved by a directed upwind mixing system. Hydraulic dissipation and pump inefficiency heat the outgoing water. The heat exchanger is a two-branch ε-NTU element (counter- or parallel-flow) inside the same linear enthalpy transport; its streams are hot/A and cold/B. Not modelled: wetted inventory, fouling, phase change.

### Underfloor heating

Wet-screed underfloor heating (EN 1264 type A) follows the EN 1264-2 characteristic q = K_H·Δθ_H, K_H = B·a_B·a_T^m_T·a_ü^m_ü·a_D^m_D, with B fitted to the FLOORTEC tacker 16 × 2 tables. Each of 16 water cells exchanges with its own screed node at the pipe plane, which heats the room through R_o = 1/10.8 + s_u/λ_E + R_λ,B and loses heat down through R_u:

```
C_w·dT_k/dt = ṁ·c·(T_{k−1} − T_k) − g_wp·(X_k − S_k) + P_diss/N
C_s·dS_k/dt = g_wp·(X_k − S_k) − (S_k − θ_i)·a/R_o − (S_k − θ_u)·a/R_u,   g_wp = a·K_H·(1 + R_o/R_u)/(1 − R_o·K_H)
```

The implicit screed node is eliminated per cell, leaving the same affine cell form as the radiator chain (effective conductance and per-cell effective temperature), so the enthalpy transport stays one linear solve and the room coupling stays affine. Steady output is exactly K_H·Δθ_H (log-mean) and the downward loss EN 1264's q_u. See [UNDERFLOOR-HEATING.md](UNDERFLOOR-HEATING.md).

### Panel radiator

The hydronic panel radiator (Kermi therm-x2 Profil-K reference) follows the EN 442 characteristic Φ = Φ₅₀·(ΔT_ln/49.83 K)^n with Kermi's registered output and exponent. It holds its published water content and steel mass in 16 cells along the flow path:

```
C_k·dT_k/dt = ṁ·c·(T_{k−1} − T_k) − g·(w·T_{k−1} + (1 − w)·T_k − T_air) + P_diss/N
g = K_m/N·|ΔT_m|^(n−1),   w = 1/x − 1/(eˣ − 1),   x = g/(ṁ·c)
```

The exponentially fitted inlet weight w makes each steady cell attenuate the excess by exactly e^(−x), so the steady chain reproduces the characteristic at any flow. The implicit coefficients stay non-negative, so no cell over- or undershoots the air temperature. Without flow, w = 0 and the cells cool on their own temperatures. g is evaluated from the interval's start state (secant linearisation, first order in time, exact in steady state), and the ledger books the same implicit exchange. The pressure drop is a two-K law fitted to Kermi's chart. Heat goes to an ideal room-air boundary. Equations, provenance, calibration (published outputs within 0.07 %) and limitations: [PANEL-RADIATOR.md](PANEL-RADIATOR.md).

## Motors and drives

All motors share one shaft model: J·dω/dt = τ_e − τ_pump − τ_load − b·ω, integrated by the implicit midpoint rule inside the coupled substep. A bounded Newton iteration (finite-difference Jacobian, 16 iterations, 10⁻⁸ rad/s midpoint residual) couples motor speeds to the electrical solve, pump torque and rigid-body loading; failure rolls the substep back and reports an error. The Jacobian cache is keyed by step length and discrete state (contactors, load direction, hold).

### External shaft load

`externalLoad` is a magnitude T_L ≥ 0 that resists rotation and never supplies energy:

- moving: the torque is T_L·sign(ω); its work T_L·|ω|·Δt is exported;
- at rest it acts as static friction: if the net drive is at most T_L the rotor is held at exactly 0; above T_L it breaks away in the drive direction;
- if the speed would pass through zero, the step is split at the stopping instant.

A coasting 7.5 kW motor stops at t = (J/b)·ln(1 + b·ω₀/T_L) within one step; zero-load coasting follows ω₀·e^(−bt/J). The drawn rotor turns by the integrated angle ∫ω dt.

### Flywheel and dynamometer

Both attach directly to a motor shaft (`drivetrain.ts`), next to an optional pump; a shaft that drives a spatial rotor cannot carry them, since the rigid body supplies its own inertia and loads.

**Flywheel / driven inertia.** Inertia J and viscous bearing drag b at the flywheel's own shaft, coupled directly or through a gear stage of ratio i (motor speed / flywheel speed) and efficiency η:

```
J_m·α = T_e − b_m·ω − T_load − k·T_t,   T_t = (J/i²)·α + (b/i²)·ω
k = 1/η while the motor drives the flywheel (T_t·ω ≥ 0), k = η while the flywheel drives back
mesh loss (k − 1)·T_t·ω ≥ 0 and bearing drag b·(ω/i)² → ambient;  E_kin = ½·J·(ω/i)²
```

The motor therefore sees J/i², needs T/η to accelerate the flywheel and receives only η·T when it coasts back: gear losses occur in both directions, as in a real reducer (about 96–98 % per helical stage). The direction is chosen consistently with the solved acceleration inside the midpoint shaft iteration, so the ledger is exact. A flywheel slows a run-up exactly as the first-order reference J·dω/dt = T(ω) predicts. The DC speed controller's gain uses the whole shaft inertia. Overspeed above the flywheel's safe speed is reported. Not modelled: shaft and coupling compliance (torsional oscillation), backlash, gear-stage inertia.

**Dynamometer.** A test-bench brake with rotor inertia (on the motor shaft) that absorbs and measures torque; absorbed power leaves through its cooling (exported work). The set torque comes from the numeric torque input when wired. Absorbers, with rated torque T_r at rated speed ω_r and power rating P_r:

| Absorber | Torque | Standstill |
| --- | --- | --- |
| Electric (AC dynamometer, braking) | min(T_set, T_r, P_r/ω) | holds a stalled shaft like static friction |
| Eddy-current brake | min(T_set, T_r·2x/(1 + x²), P_r/ω),  x = ω/ω_r | no torque |
| Water brake | min(T_set·x², T_r, P_r/ω) | no torque |

The eddy-current envelope is small at low speed and peaks at the rated speed, then the brake is power-limited, as in published water-cooled eddy-current dynamometer data (e.g. Magtrol WB series: 140 N·m, 35 kW at 2,390 RPM, rotor 0.05 kg·m²). Speed-dependent torques are evaluated at the midpoint speed (implicit, stable for a stiff brake); an electric absorber's constant torque uses the opposing-load logic above. Probes: absorbed torque, speed, absorbed power and energy; motors also report their electromagnetic torque. Absorbed power above the rating and overspeed are reported. Not modelled: speed-controlled and motoring (four-quadrant) operation, excitation dynamics, the cooling water's temperature.

### DC motor

Brushed DC armature, quasi-steady (no inductance), with optional duty d:

```
I_a = (d·V_bus − k_e·ω) / R          I_bus = d·I_a
τ_e = k_t·I_a     (k_t = k_e in SI)  P_copper = I_a²·R,  friction b·ω² → winding heat
```

Back EMF is stamped as a Norton source with conductance d²/R in MNA. Rotor storage Jω²/2 is in the ledger. Ideal sources absorb regenerated power. Catalog models: 24 V laboratory, 48 V traction (R = 1.2 Ω, k = 0.15, J = 0.025 kg·m²), 180 V industrial (R = 3 Ω, k = 0.55, J = 0.12 kg·m²) and 440 V / 75 kW; electrical ratings are protective input limits, not nameplate shaft output.

**Speed-controlled drive.** A wired RPM command or enabled local speed command uses a cascade, as in armature-voltage drives:

- PI speed controller: I* = Kp·(ω* − ω) + I_int, limited to ±1.5·I_rated; Kp = J·ω_c/k_t with ω_c = 20 rad/s on the rotor's own inertia, integral corner ω_c/4;
- ideal current loop: V = R·I* + k_e·ω, d = V/V_supply ∈ [0.001, 1], evaluated at the midpoint speed inside the Newton iteration;
- the integral is held while the converter cannot deliver the reference in the error's direction (current limit, duty limits, supply in current limit);
- duty below k_e·ω/V regenerates; at minimum duty braking current is limited to k_e·ω/R.

The drive never applies free shaft torque. Not modelled: armature inductance, current-loop dynamics, field weakening, drive losses, braking choppers.

### Induction motor

A dq model of the stator and a double (deep-bar) rotor cage plus shaft speed, in RMS complex phasors in the network's synchronous frame, motor convention:

```
v  = Rs·is + dψs/dt + jωs·ψs
0  = Rk·ik + dψk/dt + j(ωs − ωr)·ψk                 cage k = running, starting;  ωr = (p/2)·ω_mech
ψs = Ls·is + Lm·Σi,   ψk = Lm·(is + Σi) + Lσk·ik     L = X/ω_rated
Te = 3·(p/2)·Im(conj(ψs)·is)
W  = (3/2)·Re(Σ ψ·i*)
P_fe = 3·|v|²/Rc,   Rc ∝ √(f/f_rated)
```

The two cages share only the magnetizing flux. The starting cage (high resistance, low leakage) carries the rotor current at standstill; near synchronous speed the running cage (low resistance, high leakage) does. That is the deep-bar effect: about twice rated starting torque with a few percent rated slip, from constant parameters, so the magnetic energy and the ledger stay exact. In steady state the model reduces exactly to the per-phase equivalent circuit Z₁ + jX_m ∥ (R₂′/s + jX₂′) ∥ (R₂s′/s + jX₂s′), with the iron-loss resistance Rc across the winding voltage. Without a starting cage (`rotorResistance2` = 0) it is the classic single-cage machine.

Each substep uses the implicit midpoint rule on all windings at once: (R + (2/h + jΩ)·L)·i = v + (2/h)·ψ₀. The machine enters the network as a midpoint Thevenin source in parallel with its iron-loss conductance, so P_in·h = (P_cu,s + P_cu,r + P_fe + Te·ω)·h + ΔW holds exactly and magnetic energy is in the ledger. Copper, iron and friction losses heat the winding. Paused re-solves hold the present winding current; the resistive iron-loss current flows at once.

**Losses.** Stator and rotor copper (per cage), iron loss and viscous bearing friction are computed separately. Stray load loss is not a separate term: the resistances are fitted to datasheet efficiency, which includes it. Iron loss grows as f^1.5 at constant flux (V/f), between hysteresis (∝ f) and eddy-current loss (∝ f²).

**Calibration.** Both catalog motors are fitted to published IE3 data (400 V, 50 Hz, 4-pole: ABB M3KP, TEC, Universal UM3C and Baldor data sheets). `induction.test.ts` checks them against the data-sheet ranges.

| 7.5 kW (132M) | No load | 25 % | 50 % | 75 % | 100 % | IE3 data |
| --- | --- | --- | --- | --- | --- | --- |
| Speed (RPM) | 1,499.8 | 1,491.8 | 1,483.4 | 1,474.5 | 1,465.0 | 1,455–1,465 |
| Current (A) | 6.67 | 7.38 | 9.16 | 11.58 | 14.41 | 14.3–15.2 |
| Efficiency | 0 | 86.0 % | 90.4 % | 91.0 % | 90.4 % | 90.4 / 90.9–91.4 / 90.0–91.4 % |
| Power factor | 0.061 | 0.44 | 0.66 | 0.78 | 0.83 | 0.80–0.84 |
| Losses: Cu₁ / Cu₂ / Fe / friction (W) | 94 / 0 / 138 / 49 | | | | 432 / 181 / 138 / 47 | |

Locked rotor: 98 A (6.8 × In), 109 N·m (2.2 × Tn); breakdown 153 N·m (3.1 × Tn) at 1,030 RPM. The 45 kW variant (225M): 1,483 RPM, 80.5 A, 94.2 % (94.6 % at 75 %, 94.3 % at 50 %), power factor 0.86, 7.2 × In and 2.3 × Tn locked, breakdown 2.9 × Tn.

- **Inrush:** the first peak includes the decaying DC offset (161 A against a symmetric √2·98 A = 139 A for the 7.5 kW motor); at standstill the switch-on flux makes the torque oscillate up to ≈ 250 N·m.
- **Interruption:** opening the supply forces is = 0; the stator field energy becomes heat (switching loss) and the rotor fluxes decay in two modes (0.276 s and 13 ms for the 7.5 kW motor), so reclosing gives a phase-dependent reconnection transient.
- An unpowered machine (open supply, open starter, unwired) is an open stator: zero current and torque, coasting under its loads.
- **Starting allowance:** current above rating is reported only after it persists for more than 10 s (`MOTOR_START_ALLOWANCE`, a class-10 locked-rotor withstand). Winding temperature still decides failure. Overvoltage is reported above 105 % of rated voltage (IEC 60034-1 zone A).
- **Harmonics** from drives see the locked-rotor circuit at the harmonic frequency (both cages, iron loss).
- Not modelled: saturation (it would raise the magnetizing current above rated voltage), stray load loss as a separate term, rotor iron loss, temperature-dependent winding resistance, single-phase machines, self-excitation with capacitors. The surrounding network is quasi-static.

### Star-delta starter

Star connection is an ideal ratio a = 1/√3 between line and machine: terminals see Z/a² = 3Z, line current and torque are one third of direct-on-line. After the star time both contactors open for the dead time (default 50 ms), the rotor flux decays and the rotor slows, then delta reconnects with residual flux (the transition surge). For the 7.5 kW motor at 10 N·m: 54 A first peak in star (161 A direct-on-line), 129 A at the delta transition. A load above about one third of locked-rotor torque (≈ 36 N·m) does not start in star.

Series elements between starter and motor (cable, overload relay, meter, switch) are motor leads: a cable stands for both lead sets (two conductors per winding), a device in the U1 leads counts once. Star: winding current = line current. Delta: winding current = line current/√3, so an overload relay in the leads is set to In/√3. A cable's thermal mass counts six conductors.

### Soft starter

Antiparallel thyristors are modelled on the fundamental as a controlled lossless series reactance X ≥ 0:

```
|Z| / |Z + jX| = k(t)                    k: target voltage ratio; Z = R + jXm, steady motor impedance at the present speed
|V| / |Z + jX| ≤ I_lim = limit × In
X = max(0, √(|Z|²/k² − R²) − Xm, √((V/I_lim)² − R²) − Xm)
```

k ramps from the initial voltage (default 40 %) to 100 %; then the bypass closes. If that does not happen within the maximum start time, the starter trips. A soft stop ramps k down. Series elements in the line are included in Z. Not modelled: harmonics, thyristor conduction loss, torque pulsations; the controller knows the motor impedance instead of measuring it.

### Variable-frequency drive

- **Output:** a separate AC network at the drive frequency, fed by a stiff source and referred to the output angle θ = ∫2πf dt; the machine's dq frame rotates with it, so energy stays exact while the frequency changes.
- **V/f:** V_LL = V_r·(b + (1 − b)·f/f_base) with boost b (default 3 %), constant above base frequency (field weakening). Acceleration and deceleration ramps, start/stop frequency, ramp or coast stop.
- **Current limit:** when the ramped frequency would exceed the overload current (default 150 % In) the frequency moves toward zero slip until the steady current equals the limit, motoring and braking; measured-current feedback corrects the model.
- **Input:** a constant-power load P = 3·G·|V|² (G iterated) drawing output power plus losses plus harmonic emission, in phase with the supply. A diode rectifier cannot regenerate: surplus goes to the external braking resistor (heat to ambient). A drive needs a balanced three-phase supply.
- **Losses:** P₀ + P_r·(0.5·i + 0.5·i²), i = I_out/In, heating the drive's heat sink, which trips above its temperature limit.
- **Protection:** I²t image with τ = 60 s / ln(x²/(x² − 1)) (overload current trips after 60 s from cold); instantaneous trip above 2.5 × √2·In.
- **Input harmonics:** a six-pulse rectifier injects I_h = s·|I₁|/h at phase h·φ₁ for h = 6k ± 1 (5th–25th), scaled to the input THD parameter (default 40 %). The supply network is solved at each harmonic (supplies as internal impedance, machines as leakage impedance, cables, inductors and capacitors at h·f) by superposition. Every element's RMS current becomes √(I₁² + ΣI_h²) and its harmonic I²R adds heat; power factor readings are the true power factor. A power-factor capacitor forms a parallel resonance with the supply inductance.
- Not modelled: output PWM ripple, DC-link dynamics, undervoltage ride-through, vector control, load-dependent THD, the effect of harmonics on magnetic trip peaks. Capacitors on the output are rejected.

## Centrifugal pumps

A pump has one shaft connection and one hydraulic inlet/outlet branch with a built-in reverse check:

```
H_imp = H₀·[(ω/ω_r)² − 0.5·(Q/Q_r)²]           (or affinity-scaled measured flow:head points)
η_h   = max(0.15, η_peak·[1 − 0.35·(Q/(Q_r·ω/ω_r) − 1)²])
Δp_rise = ρ·g·H_imp − R_int·Q                  (R_int = 10⁵ Pa·s/m³)
P_shaft = ρ·g·H_imp·Q/η_h + P_m(ω)             τ_pump = P_shaft/ω (finite limit at zero speed)
```

One function, `pumpCurve()`, feeds the solver, readings, inspector, probes, CSV and the measurement API:

| Quantity | Definition | API field |
| --- | --- | --- |
| Impeller power | ρ·g·H_imp·Q | `impellerPower` |
| Net hydraulic power | Δp_rise·Q | `hydraulicPower` |
| Mechanical loss | P_m(ω), bearings and seals | `mechanicalLoss` |
| Shaft power | P_imp/η_h + P_m | `shaftPower` |
| Internal efficiency | η_h (null if P_imp = 0) | `hydraulicEfficiency` |
| Overall efficiency | P_net/P_shaft (null when stopped or beyond the curve) | `efficiency` |

- **Mechanical loss:** a share s of shaft input at rating, P_m,r = s/(1 − s)·P_internal,r, scaling as P_m(ω) = P_m,r·(ω/ω_r)^1.6 (SKF rolling-friction law). Disc friction and leakage belong to η_h (DIN EN 12723). Catalog shares interpolate from 2 % at ≤ 1 kW to 0.5 % at 1 MW internal power (KSB gives 0.5–2 %).
- **Cavitation:** NPSH3 at the operating point = NPSH3,rated·(Q/Q_r)²; the positive head is multiplied by f = 1 − 0.03·(NPSH3/NPSHA)⁵, clamped to [0, 1]. f = 0.97 at NPSH3 is the Hydraulic Institute definition; the exponent 5 is a model choice (−9 % at 0.8·NPSH3, head lost at 0.5·NPSH3). NPSHA comes from the previous accepted substep. A warning is logged when NPSHA < NPSH3.
- **Energy:** losses heat the pumped water; at zero flow the shaft power leaves as heat to ambient (`dryLoss`).
- **Stopped pump:** with no Euler momentum term, a stopped pump is a passive restriction; elevation can drive forward flow through it and the energy is dissipated. No hydraulic torque reaches the shaft (windmilling is not modelled): a restrained shaft keeps its speed, a free shaft's speed is unavailable. Beyond positive head the curve continues as a passive resistance (turbine region unsupported).

### Electric circulator

A standalone circulator (`circulator.ts`) is a glandless (wet-rotor) centrifugal pump with an integrated electronically commutated permanent-magnet motor and controller, as used for heating, solar and cooling circulation. It has supply terminals a–b, a hydraulic inlet and outlet, and optional `enable` (Boolean) and `speed` (percent) inputs; there is no external shaft. The hydraulic branch is the shared pump model above (`pumpCurve`, built-in check, NPSH), evaluated at the rotor speed.

**Electronics and energy.** The electronics regulate their input power, so the unit is a constant-power load on the network:

```
P1 = P₀ + max(0, P_mech)/η_m,   P_mech = P_shaft(ω_mid, Q) + (½·J·ω₁² − ½·J·ω₀²)/h
motor and electronics loss  P1 − P_mech ≥ 0  → pumped water (wet rotor); without flow → ambient
```

The loss heats the pump's own water, one fully mixed cell of the wet-rotor volume (assumed 0.1 L), which the flow carries on. Before this cell, the loss went straight into a zero-volume outlet: during the soft start against a high-resistance circuit (a single long underfloor loop) a flow of about 0.02 kg/h heated that outlet by about 90 K in one step.

In the electrical solve the unit is a resistance R = V²/P1 iterated to a fixed point (in phase with the voltage on AC); the iteration contracts with factor 2·R_s/(R + R_s) for a source resistance R_s, i.e. while the terminal voltage stays above half the open-circuit voltage. Within one coupled substep the hydraulic network is solved first (it depends only on speeds), then the electrical network with each circulator's demand for that operating point, so the ledger holds exactly: P1·h = (P_shaft + loss)·h + Δ(½·J·ω²). A supply that cannot hold the demand above the undervoltage lockout (fixed point below it, collapse or no convergence) switches the electronics off within the same substep; they restart 1 s later once the terminal voltage is back above 105 % of the lockout, so a supply that is too weak gives a brownout cycle. Without supply or run command the light rotor (J ≈ 2·10⁻⁵ kg·m², coast-down well below one step) stops within the substep and its kinetic energy heats the water. Outside the nominal voltage +10 % a rating violation is reported.

**Control.** Once per substep, from the last accepted flow Q (sampled control, one substep of delay), the controller sets a speed target:

| Mode | Target |
| --- | --- |
| Proportional pressure | speed at which the head equals H_set·(1 + Q/Q_r)/2 (H_set/2 at zero flow) |
| Constant pressure | speed at which the head equals H_set |
| Constant curve | the set percentage of the maximum speed |
| Wired speed command | the commanded percentage (below 1 %: stop); a lost control signal runs at maximum speed |

The target is limited to [minimum speed, maximum speed] and to the highest speed at which the steady input stays within P1,max (the datasheet maximum curve bends down at high flow); heads are found by bisection on the curve. The rotor follows the target on the soft-start ramp (maximum speed in `rampTime`). For a fixed flow the head–speed map is monotone, so the sampled iteration converges to the setpoint geometrically; the adaptive integrator limits the step to `rampTime`/50 while the speed still moves.

**Data basis.** The Inspector lists the source of each part for the selected pump:

| Part | Basis |
| --- | --- |
| Catalog 230 V model | Fitted to the Grundfos ALPHA2/ALPHA3 data booklet, ALPHAx 25-60 (50 Hz): H_max 6 m, P1 3–34 W, I1 0.04–0.32 A, 1 × 230 V ± 10 %, specific EEI 0.17, canned-rotor 4-pole PM motor |
| Catalog 12 V DC model | Typical retail data for 12 V brushless solar circulators (about 5 m, 800 L/h, 19 W); listings disagree, values are indicative |
| Pump curve | Quadratic approximation through shutoff head and reference flow (not measured), or measured flow:head points interpolated piecewise linearly; affinity-scaled with speed |
| Control logic | Approximated as above; real pumps estimate head from speed and power and use proprietary curve families (PP1–3, CP1–3, AUTOADAPT), which are not reproduced |
| Assumed | Maximum speed (4,500 RPM), hydraulic efficiency 0.55, constant motor-and-drive efficiency 80 %, standby 2.2 W, inertia, ramp, lockout. Efficiencies and P₀ were chosen so that P1 at the best point is the 34 W limit, P1 at the lowest curve about 3 W, and the EEI 0.174 |

**Energy efficiency index.** The Inspector computes the EEI by the method of Commission Regulation (EC) No 641/2009, Annex II (as amended by (EU) No 622/2012) on the model's own steady operating points: Q100 %/H100 % where Q·H is largest on the maximum curve; the reference control curve from (Q100 %, H100 %) to (0, H100 %/2); P_L at 100/75/50/25 % flow, weighted by the time shares 6/15/35/44 % (scaled by H_ref/H where the pump cannot reach the curve); P_ref = 1.7·P_hyd + 17·(1 − e^(−0.3·P_hyd)); EEI = P_L,avg/P_ref · 0.49. The EEI is a profile-weighted index relative to a reference pump of the same hydraulic size, **not an efficiency**: a low EEI does not mean a high efficiency at every operating point (for the catalog model the wire-to-water efficiency is 40 % at the best point and 27 % at 25 % flow on the reference curve). The live efficiency measurement of a circulator is the instantaneous wire-to-water efficiency, net hydraulic power over P1.

Not modelled: the rectifier input current's harmonics (the datasheet's 0.32 A at 34 W is a true power factor of about 0.46; the model reports the in-phase current, 0.15 A), load- and speed-dependent motor efficiency, the motor's thermal state, air in the water, dry running, blocked-rotor restart pulses, night setback and the temperature-dependent density of the curves (published at 60 °C).

## Rigid bodies and mechanisms

The Physical view renders the same component identities as the schematic. Rigid bodies and constraints are solved by pinned **Planck 1.4.2** (Box2D for JavaScript), whose synchronous API fits the engine, tests and replay.

**Bodies.** Static, dynamic and kinematic (prescribed-velocity) rectangles, circles, strictly convex 3–8-vertex polygons, and presets (beam, platform, wall, floor, wheel). Dynamic mass is density × area × depth unless an explicit mass is given; disk inertia m·r²/2, rectangle m·(w² + h²)/12, polygon values from the engine geometry. Contacts, friction (geometric mean), restitution (larger coefficient), sleeping and continuous collision detection come from Planck; collision filters and rotation locks are editable.

| Material | Density kg/m³ | Friction | Restitution |
| --- | ---: | ---: | ---: |
| Steel | 7850 | 0.50 | 0.10 |
| Aluminium | 2700 | 0.40 | 0.15 |
| Copper | 8960 | 0.45 | 0.10 |
| Wood | 600 | 0.50 | 0.15 |
| Glass | 2500 | 0.30 | 0.20 |
| Plastic | 950 | 0.35 | 0.20 |
| Rubber | 1100 | 0.90 | 0.70 |
| Concrete | 2400 | 0.70 | 0.05 |

Material thermal properties are metadata; touching bodies do not exchange heat.

**Engineering housings.** Motors, pumps, tanks, heaters, coolers, sources, resistors, lamps, pipes and valves may have optional static housing bodies with the same identity. Housings never move (no moving fluid inventory), a motor housing's pose is not its shaft angle, and a tank's spatial y affects hydraulic elevation only through an explicitly enabled elevation link. Pipe length is never inferred from geometry.

**Constraints.** Fixed, revolute, prismatic, distance and spring joints use explicit local anchors; revolute limits in radians, prismatic limits in metres along a unit axis. Springs apply F = k·(length − rest) + c·(relative anchor speed) with potential k·x²/2. Gear and rack constraints couple two grounded revolute or prismatic joints, q₁ + ratio·q₂ = constant. Joints with kinematic bodies are rejected.

**Forces.** Constant forces, torques, impulses and viscous brakes. The force/brake actuator accepts a numeric control input, applies bounded force or torque at the centre of mass, and is an external energy source unless acting as a passive brake. Impulses record exact kinetic-energy changes.

**Shaft coupling.** A shaft supports one motor, one optional pump and one optional spatial rotor, which needs a grounded revolute bearing. The rotor's mass matrix includes I_body + J_motor once. Each substep's Newton iteration solves the motor midpoint speed with a trial Planck step receiving k_t·I − τ_pump − τ_load − b·ω; the shaft residual is 2·ω_mid − ω_old − ω_trial,end, and the accepted end speed is authoritative. Trial worlds are cloned from a checkpoint (the adapter preserves mass data, unwrapped rotation and gear constants, but not warm contact caches, so motor-driven contact-dense scenes cost more).

**Numerics.** 16 velocity and 8 position iterations, semi-implicit with first-order position error and finite solver slop. Constraint reactions and contact impulses are last-substep values, not interval averages. Validated envelopes: dimensions 0.05–100 m, coordinates ±1,000 m, dynamic mass 0.001–10,000 kg, initial speed ≤ 100 m/s and 350 rad/s; leaving ±2,000 m, 200 m/s or 370 rad/s at runtime is an error. Forces ≤ 10⁵ N, torques ≤ 10⁴ N·m. Extremely stiff springs are rejected. Long thin bodies, large mass ratios, overconstrained chains and dense motor/contact coupling remain numerical risks. Bitwise cross-platform determinism is not guaranteed.

## Control and measurement

### Automation (`automation.ts`)

Signals are typed (Boolean, numeric with a declared unit) and separate from power. The control graph must be acyclic and is evaluated once per outer step in dependency order, on simulation time, from the prior accepted state; response is therefore quantized to one step. Commands are held during substeps.

- **Sensors:** y += (x − y)·(1 − exp(−Δt/τ)) lag, range, resolution, seeded noise, optional sampling interval (zero-order hold), failure modes. Faults, removed targets and unavailable quantities invalidate the signal immediately; dependent blocks receive an invalid signal, never a fabricated zero.
- **Blocks:** comparator, hysteresis (output held between thresholds), thermostat (sensor plus the same hysteresis), TON/TOF/pulse timers on simulation seconds, AND/OR/NOT with invalid propagation, reset-dominant latch, reset pulse, numeric constant, scale/offset, limiter, exact first-order filter, rate limiter, selector.
- **PID:** bounded output, conditional anti-windup, feed-forward, derivative on the filtered measurement.
- **Independent cutoff:** its own temperature sensor and a latched series contact, independent of the ordinary controller's output; it can latch on invalid sensing and resets manually only with a valid cool measurement. No safety certification is claimed.
- Actuators (valves, force actuators) have ideal external power.

### Measurement contract (`capabilities.ts`)

One table drives sensor menus, chart menus, import validation and runtime sensing. A measurement exists only where the corresponding model state exists.

| Measurement | Supported targets | Signal / chart unit |
| --- | --- | --- |
| Body or winding temperature | Modelled thermal masses; tank water and vessel are one lump | °C / °C |
| Fluid temperature | Tanks with water, pipe inventory (mean), transported branch or node fluid; exchanger hot/A or cold/B | °C / °C |
| Gauge pressure | Tank bottom, hydraulic node, branch outlet | Pa / bar |
| Inlet or differential pressure | Hydraulic branches; inlet minus outlet (negative for pump rise) | Pa / bar |
| Signed branch flow | Pipes, pumps, valves, regulators, either exchanger stream; inlet → outlet | m³/s / L/min |
| Level | Finite tank volume relative to capacity | % / % |
| Position | Spatial body x or y | m / m |
| Shaft speed | Motor shaft, connected pump, physical body rotation | RPM / RPM |
| Electrical | Branch or node RMS voltage and current, P, Q, power factor, energy | V, A, W, var, 1, J |

Pumps and valves have no body temperature; stagnant zero-inventory branches have no fluid temperature; static housings never replace a motor's shaft-speed measurement. Sensors sample at the start of an interval; charts show the resulting state.

**Before the first Run** the engine holds the switch-on solution at t = 0, but the interface shows the experiment as ready: operating quantities (current, power, flow, speed, efficiency) show "—", wire chips and glow appear once time advances, and state quantities (temperature, level, inventory) stay visible.

## Energy and mass accounting

The energy panel and every run check one ledger:

```
external electrical supply + signed external mechanical work
  = Δ(thermal + chemical + electrostatic + magnetic + filament storage)
  + Δ(lumped rotor kinetic) + Δ(hydraulic gravitational storage)
  + Δ(spatial kinetic + gravitational + spring storage)
  + ambient / coolant / pipe heat + external shaft load work
  + drained and overflowed mass export + contact, travel-stop and damping losses
  + residual
```

- Hydraulic gravitational storage is g·(z·m + m²/(2·ρ_ref·A)) per tank. Expansion-vessel cushions supply the work Π·Q on water discharged by safety valves ("cushion work"); the discharged water is exported with its enthalpy and potential. Copper loss, pump shaft work and hydraulic dissipation are internal transfers and are not counted again as sinks.
- Exported mass carries its enthalpy m·c_p·T and potential m·g·z_rim.
- Contact heat uses measured impulse times midpoint relative contact velocity; travel-stop loss uses limit-reaction impulse work; brakes use force times velocity.
- Editing physical properties while running is an external intervention; reset before using the balance as an uninterrupted conservation test. Live parameters (see [SANDBOX.md](SANDBOX.md)) never inject energy.
- No correction factor closes the ledger. Mass drift above 10⁻⁶ kg, or an energy residual above max(0.5 J, 0.5 % of supplied plus initial and external mechanical energy), is reported as a violation.

## Limitations

- **Electrical:** single-frequency steady phasors outside induction machines; DC capacitors and inductors are dynamic, but there are no AC switching transients, no network transients from supply or cable inductance, no semiconductors beyond the starter and drive models above, no arcs, contact wear or ageing.
- **Water:** liquid 1–95 °C only, incompressible flow with ρ_ref, constant c_p. Stratification only in storage tanks; system pressure from thermal expansion only where an expansion vessel is fitted (quasi-static, rigid pipework). No boiling, evaporation, freezing, water hammer, air in the water, spatial fluid, spills or leaks (safety-valve discharge and weir overflow are the only exits).
- **Machines:** no saturation or single-phase machines; induction-motor stray load loss is folded into the fitted resistances; quasi-steady DC armature; no hydraulic turbine torque; pump curves are teaching approximations; circulator electronics draw an in-phase constant power (no rectifier harmonics) with a constant motor efficiency.
- **Mechanics:** static housings only; no deformation, fracture or contact heat conduction; last-substep reaction readings.
- **Control:** ideal actuator power, one-step response quantization, acyclic graphs only.
- **Replay** reconstructs final state through the current engine; old archives that depended on a corrected defect can evolve differently. There is no timeline scrubbing.

## References

- [OpenStax: Kirchhoff's rules](https://openstax.org/books/university-physics-volume-2/pages/10-3-kirchhoffs-rules)
- [EPA EPANET 2.2 manual](https://nepis.epa.gov/Exe/ZyPURL.cgi?Dockey=P10113EM.txt): Darcy–Weisbach network head loss, Swamee–Jain friction
- [IAPWS R12-08 viscosity release](https://iapws.org/technical-guidance/release/viscosity)
- [US DOE: Improving pumping system performance](https://www.energy.gov/sites/prod/files/2014/05/f16/pump.pdf): operating points and affinity laws
- [KSB pump lexicon: mechanical efficiency](https://ksb.com/en-global/centrifugal-pump-lexicon/article/mechanical-efficiency-1117904) and [internal efficiency](https://www.ksb.com/en-global/centrifugal-pump-lexicon/article/internal-efficiency-1117912)
- [SKF: friction model as an engineering tool](https://evolution.skf.com/us/using-a-friction-model-as-an-engineering-tool-2/)
- [Grundfos ALPHA2/ALPHA3 data booklet](https://api.grundfos.com/literature/Grundfosliterature-815904.pdf): ALPHAx 25-60 curves, P1, supply tolerance and EEI
- [Kermi: Technik therm-x2 Flachheizkörper (2018)](https://www.alternative-haustechnik.de/media/8d/23/30/1682398475/db-kermi-x2-fhk.pdf): registered EN 442 outputs and exponents, weights, water contents, pressure-drop chart and conversion method; EN 442-2 (radiators and convectors, test methods and rating)
- [Commission Regulation (EU) No 622/2012](https://www.legislation.gov.uk/eur/2012/622/adopted/data.html) amending (EC) No 641/2009: circulator EEI method, load profile and reference power
- [Hydraulic Institute: the basics of NPSH](https://www.pumps.org/2022/12/07/the-basics-of-npsh-pump-operating-regions/)
- [University of Michigan CTMS: DC motor](https://ctms.engin.umich.edu/CTMS/index.php?aux=Activities_DCmotorA)
- [MathWorks: battery equivalent circuit](https://www.mathworks.com/help/simscape-battery/ref/batteryequivalentcircuit.html), [transformer equivalents](https://www.mathworks.com/help/simscape/ug/comparison-of-mutual-inductor-and-ideal-transformer.html), [radiator modelling](https://www.mathworks.com/help/hydro/ug/modeling-heat-exchangers.html)
- [Schneider Electric: contactor coil operating bands](https://www.se.com/ca/en/faqs/FAQ000223298/)
- [Planck.js documentation](https://piqnt.com/planck.js/docs/)
- Seborg, Edgar, Mellichamp & Doyle, *Process Dynamics and Control*, ch. 9 (valve characteristics); IEC 60534-1; IEC 60269 (gG fuses); IEC 60898 and IEC 60947-2 (breakers); IEC 60034-1 (motor voltage zones); Hooper (1981) two-K method.

### Electric central heating boiler

The Bosch Tronic Heat 3000 9 reference uses the existing MNA solver for three independent resistive stages and the enthalpy solver for coupled element/water storage. See [ELECTRIC-BOILER.md](ELECTRIC-BOILER.md) for source specifications, equations, controller timing, protection, conservation, sealed-loop pressure references and limitations.

### Air-to-water heat pump

The Bosch Compress 6800i AW 7 OR-S reference is a quasi-steady R290 vapour-compression cycle. Its parts:

- Evaporating and condensing temperatures follow from heat-exchanger conductances.
- Compressor capacity follows from speed and suction density.
- Compressor work is a fitted fraction of the reversed-Carnot COP.
- Frost forms by ε-NTU mass transfer.
- Reverse-cycle defrost draws heat from the water.
- The controller is PI-modulated with the published start, envelope and protection limits.
- The outdoor unit is a constant-power MNA load, the backup heater uses resistive stages, and the condenser couples implicitly into the enthalpy solve like the boiler element.

Outdoor-air heat, meltwater and coil storage enter the energy ledger. See [HEAT-PUMP.md](HEAT-PUMP.md) for data provenance, fitting, assumptions, validation and limitations.

## Solar energy extension

See [SOLAR-ENERGY.md](SOLAR-ENERGY.md) for the calibrated single-diode PV, averaged MPPT and inverter, LFP/BMS and independent distribution protection. Incident sunlight is an external input; rejected sunlight leaves to the prescribed cell-temperature reservoir. All converters and loads use the electrical solver.

See [grid-connected energy architecture and solar reliability audit](HYBRID-ENERGY.md) for generic grid-following and hybrid inverter models, PCC metering, manufacturer calibration, isolation policies, confirmed solar fixes and validation limitations.
