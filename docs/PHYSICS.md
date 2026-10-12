# Physical and numerical models

This is the reference for every model the engine solves: the equations, how they are discretized, what they conserve and what they leave out. Component coverage is listed in [COMPONENT-MATRIX.md](COMPONENT-MATRIX.md); parameter domains and editing policies in [SANDBOX.md](SANDBOX.md) and the generated [PARAMETER-MATRIX.md](PARAMETER-MATRIX.md).

Catalog coefficients are illustrative engineering values, not manufacturer data. Passing the test suites does not certify every combination of allowed parameters.

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

The shaft midpoint solve uses a finite-difference chord Newton iteration with a residual tolerance of 10⁻⁸ rad/s. Trial steps backtrack when necessary to reduce the actual coupled residual across current-limiting and check-valve transitions; a chord that cannot reduce it is rebuilt locally. This avoids cycling between CV and CC supply states without changing the physical equations or convergence tolerance.

**Adaptive advance.** Sandbox experiments without moving rigid bodies can advance by up to +24 h with `AdaptiveRun` (`engine.ts`). The thermal network is implicit and its energy ledger uses the implicit values, so conservation holds for any step size; the step size affects only accuracy. The step bound is the minimum of:

- 30 s and twice the previous step;
- 0.05 K divided by the largest |dT/dt|;
- a twentieth of any running timer delay, the sensor sampling interval, twice a sensor lag, 0.5 s with a PI controller;
- τ/200 for a breaker, motor protector or fuse above 0.8 of its trip level, and a tenth of a fuse's remaining melting time;
- tank level, valve travel, motor acceleration and the weir time constant (hydraulic and motor networks);
- 0.2 % change in a battery's state of charge; 1 s while a contactor coil is within 5 % of rated voltage of its pickup or dropout threshold.

Any discrete change (contacts, failures, Boolean signals, CV/CC regulation) restarts at 1/60 s. Each advance is recorded as `{ at, adaptive: { duration, steps, tolerance, maxStep } }` and replays bit-identically. Rigid-body scenes and scored challenges use fixed steps.

## Electrical networks

### DC modified nodal analysis

Ideal wires merge nodes (union-find). Each island is solved by modified nodal analysis:

```
[G  B] [v] = [0 ]
[Bᵀ 0] [i]   [Vs]
```

Resistive branches stamp 1/R into G; voltage sources stamp B. All ground components share one zero reference; every other island gets its own local reference, and cross-island differential probes are invalid. Unchanged solutions are cached by contact and fault state.

Dense real and complex solves (`linear-algebra.ts`) equilibrate equations and unknowns with power-of-two scaling, use machine-precision-relative pivot checks, and apply bounded compensated-residual refinement to poorly scaled real systems. The normalized backward error of the original equations is checked; this is not a condition-number certificate. A short across an ideal source, or conflicting ideal sources, gives an explicit solver error and pauses the experiment instead of substituting values.

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
- **In DC networks** an inductor is its winding resistance and a capacitor is open (1 GΩ insulation leakage, used for both readings and heat).
- **Rejected with explanations:** DC and AC sources in one network; different frequencies in one network; a DC motor on AC or on a three-phase network; a three-phase induction motor without a `source3` supply. AC and DC parts that must coexist (for example a DC contactor coil switching an AC load) are separate islands.
- **Step readings.** When a step has substeps, currents are RMS over the substeps √(Σ I²·h / Δt), powers are averages, and power factor is average real power over average apparent power.

## Protection

Ratings (`ratedPower`, `ratedCurrent`, `ratedVoltage`, `maxPressure`, `maxTemperature`, `maxSpeed`, …) are specifications, not switches: exceeding one is reported as a rating violation and marks the component `OVERLOADED`. Failures happen only where a failure model exists: element over-temperature, fuse melting, breaker and supply trips. In scored challenges any violation fails the check.

### Thermal-magnetic breakers and supply protection

Circuit breakers, motor-protective breakers and AC supplies share one characteristic with In = the current rating:

- thermal image dθ/dt = ((I/In)² − θ)/τ, integrated exactly over each step using the step's RMS current; trip at θ ≥ 1.3² (supplies, breakers) or the motor protector's threshold 1.12 with τ from its trip class (7.2 × Ir time);
- at 2 × In from cold the supply trips after τ·ln(4/(4 − 1.69)) = 32.9 s with τ = 60 s;
- magnetic (instantaneous) trip at k·In. Curves state k·In as a symmetric RMS current while the release responds to the instantaneous current, so on AC the release trips when |i(t)| ≥ √2·k·In. Each substep reports the largest instantaneous line current over its interval (exact for the phasor held over the substep). An asymmetric motor inrush can therefore trip a release whose setting lies above the symmetric current. DC releases compare |i| with k·In directly;
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

### Battery

A rechargeable DC Thevenin model with capacity Q = 3600 × capacityAh coulombs and state of charge s ∈ [0, 1]:

```
E(s) = E_empty + (E_full − E_empty)·s
V_terminal = E(s_mid) + R_internal·I
s_next = s_old + I·h/Q
U_chemical(s) = Q·[E_empty·s + ½(E_full − E_empty)·s²]
```

I is positive into the positive terminal (charging). The midpoint voltage is stamped exactly as E(s_old) behind R_internal + (E_full − E_empty)·h/(2Q), so V·I·h = ΔU_chemical + I²·R_internal·h for any accepted interval; only R_internal produces heat. Empty and full events split the interval: at empty, discharge is blocked but charging remains possible, and vice versa (an ideal directional protection boundary, not a charger). The current rating trips the output; over-temperature disconnects the pack. Chemical energy is inside the system boundary: a battery discharging into a resistor shows zero external supply and equal chemical loss and thermal gain.

Not modelled: chemistry-specific plateaus, polarization RC branches, self-discharge, ageing, temperature-dependent OCV, cell balancing.

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
- **Ambient** is a project-level boundary (sandbox: −100 to 500 °C; challenges: 20 °C) and applies to every element and its initial temperature at reset.
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
- **Pressure-reducing valve:** forward-only valve with integral pilot action on its outlet gauge pressure and a stroke-rate limit.
- Stuck-open and stuck-closed faults impose the corresponding restriction.

Not modelled: measured manufacturer Kv curves, choked flow and cavitation in valves.

### Tanks

Tanks are open, vented, well-mixed vessels with a bottom port, a constant free-surface area A, a base elevation, a capacity and a pressure rating. They track mass m; the volume follows from density:

```
V = m/ρ(T)       P_bottom = ρ_ref·g·z + g·m/A       Φ = g·(z·m + m²/(2·ρ_ref·A))
```

The bottom pressure is exact for any density profile (the column weight per area); the potential uses ρ_ref (Boussinesq), so the ledger stays exact. Heating 1 m³ from 20 to 80 °C adds 27.2 L, and a tank filled cold to the rim overflows when heated.

- **Empty:** the step is split at the empty instant and outflow is blocked; inflow remains possible. An empty tank keeps its vessel heat capacity and exchanges heat; its fluid temperature is unavailable.
- **Overflow:** a full tank's surface rises a surcharge h above the rim and discharges over a sharp-crested weir, Q = ⅔·C_d·√(2g)·L·h^1.5 with C_d = 0.62 and L = `weirLength` (default 0.3 m). The surcharge is part of the level, pressure and potential. The `overflow` port can be piped to another component; if that network reaches a finite tank the flow and its enthalpy are injected there, otherwise they leave the system and are counted as exported mass and energy. A drain whose piezometric pressure exceeds the free surface stops with an explicit unsupported-backpressure error (submerged weirs are not modelled). Direct tank-to-tank wires and overflow-to-overflow connections are rejected.
- **Filling protection** must be explicit (valve, level switch or controller); overflow does not stop a pump. In hydraulic challenges any overflow is a rule violation.

Not modelled: sealed vessels and gas headspace, multiple port elevations, stratification.

### Heat transport and exchangers

Enthalpy m·c_p·T is transported conservatively: tanks mix integrated enthalpy, and junctions are solved by a directed upwind mixing system. Hydraulic dissipation and pump inefficiency heat the outgoing water. The heat exchanger is a two-branch ε-NTU element (counter- or parallel-flow) inside the same linear enthalpy transport; its streams are hot/A and cold/B. Not modelled: wetted inventory, fouling, phase change.

## Motors and drives

All motors share one shaft model: J·dω/dt = τ_e − τ_pump − τ_load − b·ω, integrated by the implicit midpoint rule inside the coupled substep. A bounded Newton iteration (finite-difference Jacobian, 16 iterations, 10⁻⁸ rad/s midpoint residual) couples motor speeds to the electrical solve, pump torque and rigid-body loading; failure rolls the substep back and reports an error. The Jacobian cache is keyed by step length and discrete state (contactors, load direction, hold).

### External shaft load

`externalLoad` is a magnitude T_L ≥ 0 that resists rotation and never supplies energy:

- moving: the torque is T_L·sign(ω); its work T_L·|ω|·Δt is exported;
- at rest it acts as static friction: if the net drive is at most T_L the rotor is held at exactly 0; above T_L it breaks away in the drive direction;
- if the speed would pass through zero, the step is split at the stopping instant.

A coasting 7.5 kW motor stops at t = (J/b)·ln(1 + b·ω₀/T_L) within one step; zero-load coasting follows ω₀·e^(−bt/J). The drawn rotor turns by the integrated angle ∫ω dt.

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

A 5th-order dq model (stator and rotor flux linkages plus shaft speed) in RMS complex phasors in the network's synchronous frame, motor convention:

```
v  = Rs·is + dψs/dt + jωs·ψs
0  = Rr·ir + dψr/dt + j(ωs − ωr)·ψr          ωr = (p/2)·ω_mech
ψs = Ls·is + Lm·ir,  ψr = Lm·is + Lr·ir       L = X/ω_rated
Te = 3·(p/2)·Im(conj(ψs)·is)
W  = (3/2)·Re(ψs·is* + ψr·ir*)
```

In steady state it reduces exactly to the per-phase equivalent circuit Z₁ + jX_m ∥ (R₂′/s + jX₂′), T = 3·I₂²·(R₂′/s)/ω_s. Each substep uses the implicit midpoint rule; the machine enters the network as a midpoint Thevenin source, so P_in·h = (P_cu,s + P_cu,r + Te·ω)·h + ΔW holds exactly and magnetic energy is in the ledger. Paused re-solves hold the present winding current.

- **Default 7.5 kW / 400 V / 50 Hz / 4-pole:** locked rotor 74 A / 54 N·m, rated point ≈ 1,450 RPM, 14 A, 52 N·m, breakdown 131 N·m at ≈ 1,200 RPM. A 45 kW variant exists.
- **Inrush:** the first peak includes the decaying DC offset (130 A against a symmetric √2·74 A = 105 A); at standstill the switch-on flux decays with τ ≈ Ls/Rs + Lr/Rr ≈ 0.5 s and torque oscillates up to ≈ 165 N·m.
- **Interruption:** opening the supply forces is = 0; the stator field energy becomes heat (switching loss) and the rotor flux decays with T0′ = Lr/Rr (0.287 s), so reclosing gives a phase-dependent reconnection transient.
- An unpowered machine (open supply, open starter, unwired) is an open stator: zero current and torque, coasting under its loads.
- **Starting allowance:** current above rating is reported only after it persists for more than 10 s (`MOTOR_START_ALLOWANCE`, a class-10 locked-rotor withstand). Winding temperature still decides failure. Overvoltage is reported above 105 % of rated voltage (IEC 60034-1 zone A).
- Not modelled: saturation, core loss, deep-bar effect, single-phase machines, self-excitation with capacitors. The surrounding network is quasi-static.

### Star-delta starter

Star connection is an ideal ratio a = 1/√3 between line and machine: terminals see Z/a² = 3Z, line current and torque are one third of direct-on-line. After the star time both contactors open for the dead time (default 50 ms), the rotor flux decays and the rotor slows, then delta reconnects with residual flux (the transition surge). For the 7.5 kW motor at 10 N·m: 44 A first peak in star (131 A direct-on-line), 112 A at the delta transition. A load above about one third of locked-rotor torque does not start in star.

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
  = Δ(thermal + chemical + magnetic + filament storage)
  + Δ(lumped rotor kinetic) + Δ(hydraulic gravitational storage)
  + Δ(spatial kinetic + gravitational + spring storage)
  + ambient / coolant / pipe heat + external shaft load work
  + drained and overflowed mass export + contact, travel-stop and damping losses
  + residual
```

- Hydraulic gravitational storage is g·(z·m + m²/(2·ρ_ref·A)) per tank. Copper loss, pump shaft work and hydraulic dissipation are internal transfers and are not counted again as sinks.
- Exported mass carries its enthalpy m·c_p·T and potential m·g·z_rim.
- Contact heat uses measured impulse times midpoint relative contact velocity; travel-stop loss uses limit-reaction impulse work; brakes use force times velocity.
- Editing physical properties while running is an external intervention; reset before using the balance as an uninterrupted conservation test. Live parameters (see [SANDBOX.md](SANDBOX.md)) never inject energy.
- No correction factor closes the ledger. Mass drift above 10⁻⁶ kg, or an energy residual above max(0.5 J, 0.5 % of supplied plus initial and external mechanical energy), is reported as a violation.

## Limitations

- **Electrical:** single-frequency steady phasors outside induction machines; no capacitor or inductor switching transients, no network transients from supply or cable inductance, no semiconductors beyond the starter and drive models above, no arcs, contact wear or ageing.
- **Water:** liquid 1–95 °C only, incompressible flow with ρ_ref, constant c_p. No boiling, evaporation, freezing, sealed vessels, stratification, water hammer, spatial fluid, spills or leaks.
- **Machines:** no saturation, core loss or single-phase machines; quasi-steady DC armature; no hydraulic turbine torque; pump curves are teaching approximations.
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
- [Hydraulic Institute: the basics of NPSH](https://www.pumps.org/2022/12/07/the-basics-of-npsh-pump-operating-regions/)
- [University of Michigan CTMS: DC motor](https://ctms.engin.umich.edu/CTMS/index.php?aux=Activities_DCmotorA)
- [MathWorks: battery equivalent circuit](https://www.mathworks.com/help/simscape-battery/ref/batteryequivalentcircuit.html), [transformer equivalents](https://www.mathworks.com/help/simscape/ug/comparison-of-mutual-inductor-and-ideal-transformer.html), [radiator modelling](https://www.mathworks.com/help/hydro/ug/modeling-heat-exchangers.html)
- [Schneider Electric: contactor coil operating bands](https://www.se.com/ca/en/faqs/FAQ000223298/)
- [Planck.js documentation](https://piqnt.com/planck.js/docs/)
- Seborg, Edgar, Mellichamp & Doyle, *Process Dynamics and Control*, ch. 9 (valve characteristics); IEC 60534-1; IEC 60269 (gG fuses); IEC 60898 and IEC 60947-2 (breakers); IEC 60034-1 (motor voltage zones); Hooper (1981) two-K method.
