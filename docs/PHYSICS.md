# Physical and numerical models

Phase 3A adds validated rigid bodies, joints and motor shafts. See [mechanical equations, conservation and limitations](PHASE3A.md) and [executed results](PHASE3A-RESULTS.md).

All internal values use volts, amperes, ohms, watts, joules, seconds and Celsius temperature differences. Tank volume is configured in liters; initial mass uses Kell density at the initial temperature. Hydraulic flow and pipe inventory use a 1,000 kg/m³ reference density. Temperature differences in °C and K are identical.

## Electrical model

Ideal DC voltage sources and constant resistances satisfy `V = IR` and `P = VI`. Ideal wires merge nodes. Modified nodal analysis solves

```
[G  B] [v] = [0]
[Bᵀ 0] [i]   [Vs]
```

Every resistive branch stamps conductance `1/R` into G. Voltage-source incidence stamps B. Partial-pivot Gaussian elimination solves the matrix. The reported residual is the largest absolute equation residual; its equations have mixed voltage/current units, so it is a diagnostic rather than a dimensionless accuracy bound.

A closed switch is 0.01 Ω; an open switch contributes no conductance. A fuse is 0.02 Ω until it opens. A voltmeter has 10 MΩ input resistance. Lamp brightness derives from measured electrical power. Lamps have a thermally inert tungsten filament (see "Filament lamp" below); other element resistances are constant unless a temperature coefficient is set. Ground references merge; independent islands get individual reference potentials.

A wire short across an ideal supply produces an explicit solver error. Redundant/conflicting ideal-source configurations can produce singular matrices; the experiment pauses instead of substituting values. DC ideal/internal supplies trip open above their configured current rating; AC supplies use the thermal-magnetic characteristic described below. Sandbox passive overloads warn; scored assignments fail their checks. Temperature can fail a passive branch open. Fuses open after their configurable delay above rated current. An element exceeding its thermal rating also fails open. These are idealized protection and failure models, not manufacturer-specific fuse curves.

Electrical energy uses `E += Σ Ppassive Δt`. With ideal sources and passive DC networks, net supplied power equals passive dissipation. Source readings and energy represent net terminal delivery; configured internal source losses lie outside that terminal-energy boundary. Wires have no thermal mass or loss.

## Thermal model

Each non-source electrical element has a lumped thermal capacity C in J/K. Tanks use `C = m cp + C_vessel` with `cp = 4180 J/(kg K)`. Empty tanks retain a configured nonzero vessel capacity; fluid-temperature sensing remains unavailable until water is present. Every node has ambient conductance UA in W/K. A heater connected to water adds symmetric inter-node conductance.

```
Ch dTh/dt = P − UAhw(Th − Tw) − UAha(Th − Ta)
Cw dTw/dt = UAhw(Th − Tw) − UAwa(Tw − Ta)
```

The full network uses backward Euler:

```
(C/Δt + ΣUA) Tnext − Σ(UA Tneighbor,next)
  = (C/Δt) Told + P + UAambient Tambient
```

This unconditionally stable linear diffusion discretization has first-order time error. Electrical power is computed at the start of the step; heat transfer and loss use end-of-step temperature. Internal heat flow cancels exactly between nodes up to floating-point roundoff. Storage change is `Σ C(Tnext − Told)` and ambient exchange is `Σ UA(Tnext − Ta) Δt`.

The energy panel checks `Eelectrical − ΔUthermal − Eambient`. Editing physical properties or inserting/removing thermal masses while running constitutes an external intervention. Such construction changes can alter stored energy without an explicit work/enthalpy model; reset the experiment before using its balance as an uninterrupted conservation test.

Water is well mixed, fixed density, fixed heat capacity, and bounded to 1–95°C. Crossing a bound pauses. Vessel mass is lumped at the mixed temperature. Evaporation, boiling, latent heat, radiation and spatial gradients are omitted. Current hydraulic pressure, flow, expansion and viscosity models are described below; heat capacity remains constant.

## References and tolerances

- 12 V across 6 Ω: exactly 2 A and 24 W in the model. Tests use a 1e-9 numerical tolerance.
- Series 6 Ω + 3 Ω at 12 V: 4/3 A, with voltage drops summing to 12 V.
- Parallel 6 Ω and 12 Ω at 12 V: 3 A total, 36 W total.
- 24 W for 5 s: 120 J, within 1e-7 J in the test.
- 10 kg × 4180 J/(kg K) × (80 − 20) K = **2,508,000 J**. That is the analytical 10 kg reference. The supplied 10 L tank starts with 9.982041322 kg at 20°C; its actual-storage test uses that mass and allows less than 40 J final-step overshoot. Element energy is counted separately.
- 20 s coupled heating with losses: energy balance residual less than 1e-5 J. The long isolated heating reference allows less than 0.002 J accumulated roundoff.
- 30, 60 and 144 render frames/s produce identical fixed-step state over five seconds.

Specific heat and density are deliberate constant engineering approximations over the supported liquid range; they are not exact water property tables. The heating experiment naturally consumes more than the water-only sensible heat because the heater and switch store heat and ambient conductance removes energy.

## Phase 2A integration

The electrical and thermal equations above are retained. See [the Phase 2 audit](PHASE2-AUDIT.md) for sensor lag, simulation-clock control scheduling, finite-resistance SPDT contacts, independent latched protection, signed coolant energy, engineering edit rules and declared numerical limits. Temperature differences in degrees Celsius equal kelvin differences; volumes configured in liters convert to water mass using 1 kg/L (1,000 kg/m³). Power, energy, thermal capacity and conductance use W, J, J/K and W/K consistently.

Source and contact ratings are catalog specifications. Normal source voltage and controller setpoints are operating settings. Stored mass/capacity and physical-model changes require Reset after time advances; no hidden refill, heat source or arbitrary mass adjustment occurs. Control output traces carry declared units (°C for temperature sensors, Boolean for logic, dimensionless for numeric constants) and use separate plot groups.

## Phase 2B hydraulic and electromechanical equations

The new hydraulic branch, finite-storage, brushed motor, centrifugal pump, conservative fluid heat transport and unified energy equations are documented in [PHASE2B.md](PHASE2B.md). Existing electrical/thermal-only experiments retain their original integration scheme. New internal mechanical/hydraulic substeps and inventory boundary events are independent of rendering.

## Tank overflow, water viscosity and pump power (realism revision)

### Tank overflow: ideal spill boundary

**Previous behaviour (removed).** When a vented tank reached capacity, the hydraulic solver blocked further inflow. In effect the full tank became an invisible shut-off valve: the delivery flow stopped while the pump kept turning against a dead end.

**Current model.**
- **Spilling.** A full vented tank keeps its free surface at the rim, z_rim = elevation + capacity/A, so its boundary pressure is ρ·g·z_rim. Inflow is never blocked. The enthalpy transport first mixes all inflow into the well-mixed inventory. Any mass above capacity then leaves over the rim at the mixed temperature T, carrying:
  - mass m_spill;
  - enthalpy m_spill·c_p·T, on the same 0 K datum as all transport and the `depleted` drain;
  - potential energy m_spill·g·z_rim, the datum of the tank potential ρg(z·V + V²/2A).
- **Accounting.** All three are added to the exported mass and energy (`removedMass`, `removedEnergy`), so the mass residual and the energy residual close. The spilled enthalpy is subtracted from stored energy.
- **Reporting.** Overflow is shown as a rate (`overflow`, L/min), a cumulative volume (`overflowVolume`, L), start and stop events, the tank caption, the energy panel ("External shaft, drain & overflow export") and the measurement API (`overflow.rateM3s`, `overflow.volumeM3`).
- **Events within a step.** The coupled step still splits exactly at the instant a tank reaches capacity or empties, so onset inside a timestep is resolved. Empty tanks continue to block outflow only.
- **Adaptive steps** do not shrink while a full tank spills at a constant level.

**Approximations.**
- *Superseded by the weir model below:* the spill now needs a surcharge head above the rim and can be routed to another component.
- Inflow and spill mix perfectly.

**Filling protection** must be explicit: a valve, level switch or controller. The automatic-supply starter does this and does not overflow.

**Compatibility.**
- Projects that used to rely on the hidden shut-off now spill. This is physically correct, and every project file still loads; no schema change was needed.
- In hydraulic challenges, any spill is a rule violation ("… overflowed"). This makes the existing "without overflow" objective of challenge 004 enforceable. Before, a full destination silently passed.
- The challenge reference designs do not overflow, and their completion times are unchanged.

### Water properties

`src/simulation/water.ts`:
- **Viscosity:** IAPWS R12-08 (2008) viscosity μ(T, ρ) with μ̄₂ = 1. Density for the evaluation comes from Kell (1975) at 1 atm.
- **Validated** against the official IAPWS check values: 889.735100 and 307.883622 µPa·s, to the printed digits. Against published 1 atm values at 10/20/40/80 °C the error is ≤ 0.004 %.
- **Domain:** the 0–100 °C liquid range at 1 atm. Outside it the property call throws a clear error; it never extrapolates.

Where viscosity is used:
- **Pipes:** the friction loss and Reynolds number use μ at the local water temperature:
  - Inventory pipes: each mixing cell's own temperature, independent of flow direction.
  - Zero-volume pipes: the upstream node temperature, chosen by flow direction.

  Laminar (Hagen–Poiseuille), transitional (linear blend 2300–4000) and turbulent (Swamee–Jain) regimes are evaluated per segment.
- **Feedback** from temperature to flow uses the node temperatures of the previous transport substep (one coupled substep of lag: 1/60 s for hydraulic/DC-motor systems, 1/240 s with induction machines, 1/480 s with moving rigid bodies; for an adaptive macro step, one macro step). There is no nested temperature–flow iteration. At t = 0 a zero-length transport mixes the inventories and the network is re-solved once, so the first reading already uses the correct viscosities.
- **Valves, regulators and heat-exchanger streams** use the two-K loss below, so they are viscosity-dependent too. Pump internals keep a constant internal resistance.

**Density and heat capacity.** c_p = 4180 J/kg·K stays constant (real variation 1 % over 1–95 °C). Density is variable for tank inventories (thermal expansion, below); flow, pipe inventories and pump heads still use ρ_ref = 1000 kg/m³.

### Pump power definitions

The same function, `pumpCurve()`, feeds the solver, live readings, Inspector ratings, probes, the CSV export and the measurement API:

| Quantity | Definition | API field | Probe |
| --- | --- | --- | --- |
| Impeller (gross hydraulic) power | ρ·g·H_imp(Q, ω)·Q, with H_imp ≥ 0 from the affinity-scaled curve | `impellerPower` | `impellerPower` (W) |
| Net delivered hydraulic power | Δp_rise·Q = P_imp − R_int·Q² (R_int = 1e5 Pa·s/m³ internal resistance) | `hydraulicPower` | `hydraulicPower` (W) |
| Mechanical loss | k·ω³ (windage, disc friction, bearings) | `mechanicalLoss` | `mechanicalLoss` (W) |
| Shaft input power | P_imp/η_h + k·ω³ | `shaftPower` | `shaftPower` (W) |
| Internal hydraulic efficiency η_h | P_imp/(P_shaft − P_mech); the curve value, null if P_imp = 0 | `hydraulicEfficiency` (fraction) | `hydraulicEfficiency` (%) |
| Overall efficiency η | P_net/P_shaft; null if P_shaft = 0 (stopped) or P_net < 0 (passive restriction beyond the curve) | `efficiency` (fraction) | `efficiency` (%) |

**Energy accounting.**
- The motor delivers P_shaft through the shared shaft.
- The losses P_shaft − P_net heat the pumped water when it flows. They are counted once: branch dissipation P_imp − P_net plus shaft − impeller.
- At zero flow (deadhead) the shaft power, which is the mechanical loss alone, leaves as heat to ambient (`dryLoss`). The zero-volume pump cannot warm its trapped water.
- Reverse and turbine operation are unsupported; the pump branch is one-way.

**Corrections.**
- Before this revision the UI's "efficiency" was P_imp/P_shaft, while the API's `efficiency` was η_h.
- The Inspector's "Shaft power at rating" omitted k·ω³. For the laboratory pump that is 81 W at 300 rad/s, so the nominal shaft power is 137.0 W, not 56.0 W.

**Catalog drag (revised).** The old laboratory drag coefficient (3·10⁻⁶ N·m·s²) made the mechanical loss larger than the rated hydraulic output (28.6 % overall efficiency). It is now 1·10⁻⁷ (industrial 1.2·10⁻⁵ → 1.5·10⁻⁶), see below.

## Engineering-depth revision (two-K valves, weir overflow, drag, expansion, AC)

### Viscosity-dependent valve losses (two-K)

Valves, check valves, actuated valves, pressure-reducing valves and both heat-exchanger streams use the Hooper (1981) two-K form

```
K(Re) = K₁/Re + K∞        Δp = K(Re)·ρv²/2 / x²        (x = opening fraction)
```

Because Re = ρvd/μ, the K₁ term equals K₁·μ·v/(2d): a pressure drop linear in flow, R_lin = K₁·μ/(2·d·A)/x². The viscosity is that of the upstream water for the current flow direction. K∞ is the former turbulent `lossCoefficient`. New parameter `laminarK` (K₁): ball/gate 500, globe/regulator and swing check 1500, heat exchanger 1000. The closed-form inverse used for one-way branches solves the resulting quadratic exactly.

Effect, for a 25 mm valve with K∞ = 5: at 2 m/s and 20 °C (Re ≈ 50,000) K₁/Re adds 0.2 % (ball, K₁ = 500) to 0.6 % (globe, 1500). At 0.05 m/s and 10 °C (Re ≈ 950) it adds 10 % and 32 %, and the loss is no longer purely quadratic in flow.

*Superseded in part:* the opening fraction x above is now the inherent characteristic φ(x), next section.

### Inherent valve characteristics

The opening of a valve is its relative travel x. What the travel does to the flow capacity is the valve's inherent characteristic φ(x) = Kv(x)/Kvs at constant pressure drop (terms per IEC 60534-1; forms from Seborg, Edgar, Mellichamp & Doyle, *Process Dynamics and Control*, ch. 9):

```
linear            φ = x
equal percentage  φ = R^(x − 1)       R = rangeability, typically 20–50 (default 50)
quick opening     φ = √x
```

Since K ∝ 1/Kv², both two-K terms scale with 1/φ²: Δp = (K₁/Re + K∞)·ρv²/2 / φ².

- **Defaults:** the actuated valve is a control valve with equal-percentage trim, R = 50, the usual choice for process control. Manual valves and pressure-reducing valves default to linear, which is the behaviour all valves had before. Check valves and heat-exchanger streams have no travel.
- **Saved files** written before this revision have no characteristic. They load as linear and behave exactly as saved. The challenges' consumer-demand valves are manual valves, so challenge scores are unchanged.
- **The installed characteristic is not a parameter.** It follows from the network solve: with a long supply pipe (low valve authority) an equal-percentage valve behaves nearly linearly, and a linear valve behaves like quick opening. In the test with 60 m of 25 mm pipe, equal-percentage trim at 50 % travel gives more than twice its inherent flow ratio of 1/√50 = 0.14.
- **Closure:** 0 % travel is the seat and isolates exactly. An equal-percentage trim therefore steps from φ = 1/R to zero at the seat, as real trims do below their rangeability.
- **Not modelled:** measured manufacturer Kv curves, the modified-parabolic and hyperbolic trims, choked flow and cavitation in the valve, valve-type defaults for K∞ and K₁ (they remain explicit parameters).

Tests: `valve-characteristics.test.ts` covers the three forms, exact K/φ² in the solve, flow ratios at constant Δp, the installed characteristic, migration of saved files, and mass and energy closure while an actuated valve strokes.

### Weir overflow and routed spill

A full tank's free surface rises a surcharge h above the rim and discharges over a sharp-crested weir (free overfall):

```
Q = ⅔·C_d·√(2g)·L·h^1.5      C_d = 0.62, L = weirLength (default 0.3 m)
```

- The surcharge is part of the tank's level, hydrostatic pressure and potential energy, so the rim is no longer a hard boundary.
- **Routing:** the tank's `overflow` port can be piped to another component. If that network reaches a finite tank, the weir flow is injected there (with its enthalpy). Otherwise it leaves the system as before and is counted in the exported mass and energy.
- Adaptive steps are bounded by the weir time constant (`0.3·A/(1.5·Q/h)`), so filling at the rim stays stable.
- The weir flow is evaluated from the tank state used for the hydraulic solve (mid-step levels in adaptive steps). Mass closes exactly because the same flow is removed from the tank and injected downstream.

### Pump catalog drag

The catalog drag coefficients are now physical (shaft input at rating ≈ hydraulic power/η + a few % mechanical loss):

| Model | Old k (N·m·s²) | New k | Loss at rated speed |
| --- | --- | --- | --- |
| Laboratory pump | 3·10⁻⁶ | 1·10⁻⁷ | 2.7 W at 300 rad/s (was 81 W) |
| Industrial pump | 1.2·10⁻⁵ | 1.5·10⁻⁶ | 40.5 W at 300 rad/s (was 324 W) |

**Challenges are protected.** A scored challenge file that still contains the old catalog value is migrated on load to the new one (`LEGACY_PUMP_DRAG`). Values a sandbox user typed are left alone. Reference results moved: transfer 144.3 s → 125.7 s (score 96 → 100) and pressure 95 → 98. Repeating the run with the old drag reproduces 144.35 s, so the drag change is the only cause. `validation/reference-scores.json` was re-recorded deliberately.

### Thermal expansion of tank inventories

Tanks track **mass** m. Their volume follows from the Kell density at the inventory temperature:

```
V = m/ρ(T)       P_bottom = ρ_ref·g·z + g·m/A       Φ = g·(z·m + m²/(2·ρ_ref·A))
```

- The bottom pressure is exact for any density profile (it is the weight of the column per area). The potential uses ρ_ref for the centre of mass (Boussinesq), so the energy ledger stays exact.
- A tank initialised with V₀ at T₀ holds m = V₀·ρ(T₀), e.g. 998.21 kg per m³ at 20 °C.
- Heating 1 m³ from 20 °C to 80 °C raises it by 27.2 L. A tank filled to the rim cold will overflow when heated; this is reported like any other overflow.
- Emptiness and rim events are based on mass and on the actual volume rate, so splitting a step at a boundary stays exact.
- Not modelled: expansion of pipe inventories (constant volume, ρ_ref), buoyancy-driven stratification, and the vessel's own expansion.

### AC phasor network and induction machine

**Solver.** An island whose sources are AC is solved by complex modified nodal analysis at one frequency (phasors, RMS magnitudes):

| Element | Impedance |
| --- | --- |
| Resistor, heater, lamp, cable, … | R (temperature-dependent as in DC) |
| Inductor | R_w + jωL |
| Capacitor | ESR − j/(ωC) |
| AC source | V∠φ behind R_i + jX_i |
| Induction motor (per phase) | Z₁ + jX_m ∥ (R₂′/s + jX₂′) |

- Readings carry RMS voltage and current, active power P, reactive power Q (var, inductive positive) and power factor |P|/S. Sources report delivered power as negative, as in DC.
- **Single-phase AC (`sourceAC`):** each source has its own phase angle. Three single-phase sources at 0°/−120°/+120° with a common neutral form an explicit, possibly **unbalanced** three-phase system. Neutral current and line-to-line voltages follow from the solution (tested against hand calculation).
- **Balanced three-phase supply (`source3`):** solved as the per-phase star equivalent (V_LL/√3), powers × 3. It can now also feed inductors, capacitors and induction motors.
- **In DC networks** an inductor is its winding resistance and a capacitor is open (1 GΩ insulation leakage).
- **Supply protection:** AC supplies trip like a C-characteristic breaker with In = their current rating (thermal image τ = 60 s, trip at θ ≥ 1.3²; instantaneous at 10 × In, compared with the instantaneous current, see "Magnetic releases act on the instantaneous current"). Motor starting surges below that are tolerated; DC supplies trip instantly above their rating.
- **Rejected with explanations:** DC and AC sources in one network; different frequencies in one network; a DC motor on AC; a three-phase induction motor without a `source3` supply.
- **Not modelled:** network transients (capacitor charging, inductor energy at switching), harmonics, saturation, core loss, single-phase machines. The induction machine itself is dynamic since the electromagnetic-transient revision below.

**Induction motor** (`inductionMotor`, default 7.5 kW / 400 V / 50 Hz / 4-pole; 45 kW variant):

```
ω_s = 2πf/(p/2)      s = (ω_s − ω)/ω_s
T = 3·I₂²·(R₂′/s)/ω_s          (air-gap torque)
P_in = P_cu1 + P_cu2 + T·ω     (P_cu2 = s·P_airgap)
```

- Reactances are given at `ratedFrequency` and scale with the supply frequency.
- The shaft equation, loads, friction and shaft couplings (pumps, rigid bodies) are shared with the DC motor. Copper losses heat the motor's thermal mass.
- The motor–network coupling uses a chord (frozen-Jacobian) Newton iteration with a midpoint predictor. A 5 s run-up closes energy to ~10⁻¹¹ relative. *Superseded:* the machine now has electromagnetic transients (section below); the circuit above is its steady state.
- Default calibration: locked rotor 74 A / 54 N·m (≈ 5 × rated current), rated point ≈ 1450 rpm, 14 A, 52 N·m, breakdown torque 131 N·m at ≈ 1200 rpm.

Tests: `src/simulation/ac.test.ts` (R–L power and power factor, capacitor power-factor correction, DC capacitor, unbalanced star with neutral, locked rotor vs equivalent circuit, run-up energy and power balance, motor driving a pump, rejection messages) and rows in the scaling campaign.

### Performance

Measured on the supply challenge reference (720 s simulated): **215 → 59 ms of CPU per simulated second**, with identical results. The speed-up comes from:
- caching the hydraulic and electrical network topology per immutable project object (WeakMap);
- a warm-started Illinois inverse for one-way branches;
- reusing the line-search Jacobian in Newton;
- a chord iteration with midpoint predictor for motor coupling.

At real-time speed the heaviest example now needs about 6 % of the main thread. Moving the solver to a Web Worker would make the UI read results asynchronously (every caption, probe and Inspector field). That refactor was **deferred**, because measured cost no longer justifies it; it remains the next step if large scenes become slow.

## Shaft load, coast-down and stopped pumps (motor shutdown revision)

### Opposing external shaft load

"External shaft load" is a magnitude T_L ≥ 0 that **resists** rotation; it never supplies energy.

- **Moving** (|ω| > 10⁻⁹ rad/s): the load torque is T_L·sign(ω). Exported work T_L·|ω|·Δt ≥ 0 is counted in the external shaft work.
- **At rest:** the load acts like static friction. If the net drive (motor torque minus pump torque at ω = 0) is at most T_L, the rotor is held at exactly 0 and no work is done. Above T_L the rotor breaks away in the direction of the drive, and the load resists that direction. A reversed DC motor therefore runs backwards against the load, so legitimate reverse rotation is preserved.
- **Stopping inside a step:** if the integrated speed would pass through zero, the coupled step is split at the stopping instant (linear in ω, refined like the tank boundary events) and the rotor ends exactly at rest.
- **Validation:** the stopping time of a coasting 7.5 kW motor matches t = (J/b)·ln(1 + b·ω₀/T_L) within one 1/60 s step. Zero-load coasting matches ω₀·e^(−bt/J) to 10⁻⁴. The energy residual stays below 10⁻⁶ of the supplied energy through stop and restart (`motor-load.test.ts`).
- **Previous defect:** the load was a constant torque in one direction. After the contactor opened it drove the rotor backwards without bound (−59,000 rpm after 10 s).

### Contactor-opening slowdown (cause)

Profiling the loaded induction motor showed that coupled solves rose from about 1.2 to exactly 8 per step after the contactor opened, making each simulated second 2–3× slower.

- **Cause:** the chord-Newton Jacobian. It was cached by step length only, so the Jacobian of the running machine was reused for the disconnected rotor. It still contracted the residual by about ¼ per iteration, just inside the rebuild threshold, so it was never rebuilt.
- **Fix:** the cache is now also keyed by the discrete state (contactor, load direction, hold). After the fix the coasting and stopped motor needs one coupled solve per step.
- High speed was not the cause; the reverse spin was a separate defect, fixed above.

### Rotor drawing

The drawn rotor turns by the accumulated rotation ∫ω dt (`MotorState.angle`) instead of current speed × elapsed time. It stops when the rotor stops, freezes while paused, starts at zero on reset, and is reproduced by save/load replay.

### Stopped pumps and hydraulic back-driving

- **Passive flow:** the pump head curve H = H₀·(ω/ω₀)² − k·Q² has no impeller (Euler) momentum term. At standstill the pump is therefore a passive restriction: elevation or pressure can drive **forward** flow through it, and that energy is dissipated in the branch, so the energy ledger closes.
- **No turbine torque:** hydraulic back-driving (windmilling) is **not modelled**. The shaft receives no hydraulic torque, because any turbine coefficient would have to be invented.
- **What the interface shows:**
  - A coupled (restrained) shaft keeps the motor's speed, e.g. 0 rpm while held by its load.
  - A free shaft has no modelled speed: the measurement is unavailable and the symbol says "free shaft".
  - The inspector says so whenever flow passes a stopped impeller.
- **Built-in check:** the pump has an explicit internal reverse check. Reverse flow is always blocked, and the inspector reports the pressure difference the closed check is holding.

### Motor starting current

Direct-on-line starting draws several times rated current, about 74 A for 0.2 s for the 7.5 kW motor. Motor current above rating is only reported after it persists for more than 10 s (`MOTOR_START_ALLOWANCE`, a class-10 locked-rotor withstand time). Winding temperature still decides failure, and a stalled motor is still reported.

### Before the first Run

The engine holds the switch-on solution at t = 0 (needed for inspection and tests), but the interface treats the experiment as **ready, not running**:
- operating quantities (current, power, flow, speed, efficiencies) show "—" in the inspector and telemetry;
- wire chips, live captions and lamp/heater glow appear only once time advances;
- state quantities such as temperature, level and stored inventory stay visible;
- the status bar says "Ready to run".

## Audit corrections (2026-10-11)

DC capacitor readings and heat use the same 1 GΩ insulation leakage as the nodal solve; ESR, including its configured temperature coefficient and sample tolerance, applies to AC. AC relay heat uses the conducting contact voltage (a–nc when de-energized); the public voltage probe remains a–b and is unavailable across separate islands.

An induction machine on an unpowered island has zero stator current and torque and coasts under its modeled mechanical loads; its residual rotor flux decays (electromagnetic-transient revision below). Power-loss, machine-failure and control-loss injections use the existing motor fault paths. An energized incompatible DC or single-phase connection still reports an error.

Free-overfall overflow cannot drive water into a drain whose piezometric pressure exceeds the tank free surface. Such routes now stop with an explicit unsupported-backpressure error, rather than moving water uphill and assigning negative dissipation. Submerged weirs and drain backpressure require a different hydraulic boundary model.

Tank inspector mass, sensible heat and cooling time use the same initial temperature-dependent inventory density as the engine. Empty vessels continue to exchange configured heat; this remains a single lumped vessel model, without a distinct wet/dry contact coefficient.

## Pump losses and cavitation (sourced revision)

### Mechanical loss: bearings and shaft seals

- **Parameter:** mechanical loss at rating, a share s of shaft input at rated speed and flow. It replaces the former drag coefficient k·ω³.
- **What the old coefficient got wrong:** it lumped disc friction with bearing friction. Per DIN EN 12723, as summarised by KSB, disc friction and leakage belong to the *internal* efficiency (here the curve efficiency η_h). Only bearing and seal friction is mechanical loss.
- **Model:**
  - P_m,r = s/(1−s)·P_internal,r, where P_internal,r = ρ·g·H(Q_r, ω_r)·Q_r/η_r;
  - P_m(ω) = P_m,r·(ω/ω_r)^1.6.
- **Speed law:** in the SKF rolling-bearing friction model, rolling friction torque scales as (νn)^0.6, so power scales with n^1.6. Seal friction is folded into the same law.
- **Sizes:** KSB gives 0.5–2 % of power input, smaller for more powerful pumps. Catalog defaults interpolate log-linearly from 2 % at ≤ 1 kW to 0.5 % at 1 MW internal power; these endpoints are an assumption within that range.

| Model | Internal power at rating | Mechanical loss |
| --- | --- | --- |
| Laboratory pump | 56 W | 2.0 % (1.14 W) |
| Industrial transfer pump | 1.32 kW | 1.9 % |
| High-capacity process pump | 9.0 kW | 1.5 % |
| Preset: circulator 20 L/min | 15 W | 2.0 % |
| Preset: process pump 6,000 L/min | 26 kW | 1.3 % |

- **Migration:** files carrying `mechanicalDrag` load with the catalog mechanical loss of their pump model. The old coefficient cannot be converted, because it included disc friction.
- **Score change:** challenge transfer 125.533 s → 125.233 s, still 100 points. The laboratory pump's loss at rated speed fell from 2.7 W (the previous revision's estimate) to 1.14 W (2 % of shaft input). The other scores are unchanged.

### Cavitation head drop

- **Anchor:** the Hydraulic Institute defines NPSHR as NPSH3, the NPSH available at which head has dropped by 3 %.
- **Model:** with NPSH3 at the operating point = NPSH3,rated·(Q/Q_r)², the positive pump head is multiplied by f = 1 − 0.03·(NPSH3/NPSHA)⁵, limited to [0, 1].
- **What is sourced and what isn't:**
  - f(NPSH3) = 0.97 is the standard definition.
  - The exponent 5 is a **model choice**, not a measured breakdown curve. It gives a steep collapse: −9 % at 0.8·NPSH3, −39 % at 0.6·NPSH3, head lost at 0.5·NPSH3.
- **Numerics:**
  - NPSH3 is evaluated at the solved flow inside the pump curve, so cavitation acts as a flow limit: head collapses where NPSH3(Q) reaches NPSHA.
  - NPSHA comes from the previous accepted substep (one coupled substep of lag).
  - An earlier variant that also lagged NPSH3 oscillated between full head and none every step in deep cavitation.
  - Only positive head is reduced, so the branch characteristic stays monotone and a stopped pump cannot cavitate.
- **Energy:** shaft power follows the reduced impeller power at the curve efficiency; readings and the energy ledger use the same head.
- **Not modelled:** the extra losses, noise and erosion of cavitation; the rise of NPSH3 at part load due to recirculation.
- **Tests:** `pump-losses.test.ts` checks the exact rated share, the ω^1.6 law, the 3 % point, and a cavitating suction lift that settles without oscillation and conserves energy.

Sources:
- [KSB centrifugal pump lexicon: mechanical efficiency](https://ksb.com/en-global/centrifugal-pump-lexicon/article/mechanical-efficiency-1117904)
- [KSB: internal efficiency (DIN EN 12723)](https://www.ksb.com/en-global/centrifugal-pump-lexicon/article/internal-efficiency-1117912)
- [SKF: using a friction model as an engineering tool](https://evolution.skf.com/us/using-a-friction-model-as-an-engineering-tool-2/)
- [Hydraulic Institute: the basics of NPSH](https://www.pumps.org/2022/12/07/the-basics-of-npsh-pump-operating-regions/)

The earlier sections "Pump catalog drag" and "Catalog drag (revised)" describe the superseded k·ω³ model.

## Induction motor electromagnetic transients (dynamic revision)

### Model

The induction machine is a 5th-order dq model: stator and rotor flux linkages plus the shared shaft speed. Quantities are RMS complex phasors in the synchronous frame of the network, using the motor convention:

```
v  = Rs·is + dψs/dt + jωs·ψs
0  = Rr·ir + dψr/dt + j(ωs − ωr)·ψr          ωr = (p/2)·ω_mech
ψs = Ls·is + Lm·ir,  ψr = Lm·is + Lr·ir       L = X/ω_rated
Te = 3·(p/2)·Im(conj(ψs)·is)
W  = (3/2)·Re(ψs·is* + ψr·ir*)
```

- **Steady state:** the model reduces exactly to the per-phase equivalent circuit, so steady results are unchanged. The tests confirm settled current and torque against the circuit to 10⁻⁹ at 0, 1200 and 1450 rpm.
- **The network** (supply impedance, cables, R/L/C loads) stays quasi-static phasors; only the machine is dynamic.

### Numerics

- **Integration:** each coupled step uses the implicit midpoint rule (the same scheme as the shaft). The machine enters the network as a midpoint Thevenin source: v_mid = Z(h, ω)·is_mid + E(ψ₀). With midpoint currents, P_in·h = (P_cu,s + P_cu,r + Te·ω)·h + ΔW holds exactly, and the stored magnetic energy is part of the energy ledger.
- **Step size:** while the flux changes (switch-on, run-up, interruption, reconnection), coupled steps are limited to 1/40 of a supply period (0.5 ms at 50 Hz), so the stator transient rotating at the supply frequency is resolved. In steady operation the normal steps apply. A start-up costs about 0.1–0.3 s of computation.
- **Paused re-solves** hold the present winding current (inductive continuity). Before the first step the motor draws 0 A.

### What this adds

- **Inrush:** current builds up within the first cycle. The first instantaneous peak includes the decaying DC offset: 130 A for the 7.5 kW motor, against the symmetric √2·74 A = 105 A. The inspector shows the largest instantaneous phase current since switch-on.
- **Transient torque:** at switch-on the torque oscillates at the supply frequency. At standstill the switch-on DC flux decays slowly, because the rotor does not oppose a field that doesn't move relative to it: τ ≈ Ls/Rs + Lr/Rr ≈ 0.5 s. Torque peaks reach about 165 N·m around the 54 N·m steady locked-rotor torque, so a heavily loaded rotor twitches before its load holds it.
- **Run-up timing:** 7.5 kW motor to 1400 rpm with 35 N·m: 0.183 s dynamic against 0.152 s quasi-static (+20 %). With 10× rotor inertia: 1.733 s against 1.686 s (+3 %). Electromagnetic dynamics matter most for low inertia.
- **Interruption:** opening the contactor forces is = 0 immediately. The stator-side field energy is dumped as heat in the motor, standing in for the contact arc (reported as switching loss). The rotor flux then decays with T0' = Lr/Rr (0.287 s), so the machine keeps a residual voltage source.
- **Reconnection:** reclosing with residual flux gives a reconnection transient that depends on the flux phase.

### Limits

- The network is quasi-static: supply and cable inductance do not add their own transients.
- No saturation (inrush and reconnection peaks would be higher with saturation), no core loss, no skin effect in the rotor bars (deep-bar starting torque).
- A machine on an unpowered island is treated as an open stator (no self-excitation with capacitors).
- The instantaneous peak is the exact maximum of the three phase currents over each substep, with the midpoint phasor held over the substep.

Tests: `induction.test.ts` covers the steady state against the circuit, exact discrete energy balance, open-stator decay (second order), inrush asymmetry, run-up against the quasi-static model, residual flux after opening, and energy through reconnection to 10⁻⁹.

### Magnetic releases act on the instantaneous current

Breaker and motor-protector curves (IEC 60898, IEC 60947-2) state the instantaneous setting k·In as the RMS value of a symmetric current, while the release itself responds to the instantaneous current. On AC, breakers, motor protectors and supply protection therefore trip when |i(t)| ≥ √2·k·In. In steady state this is exactly the RMS setting. With an asymmetric switch-on current it is not: the DC offset of a motor inrush can trip a release whose setting lies above the symmetric current, the familiar nuisance trip of a direct-on-line start.

- Each coupled substep reports the largest instantaneous line current over its interval (exact for the phasor held over the substep: max over phases of √2·Re(I·e^{j(ωt − 2πk/3)})). The engine compares the largest value of the step with √2·k·In.
- **Previously** the magnetic check compared the RMS phasor magnitude of the step's first substep. During a motor start that missed the half-cycle maximum: the 7.5 kW start showed 6.1 A in the switch-on step and at most 85 A RMS (equivalent to a 121 A peak), against a true first peak of 130 A.
- **Example** (`protection.test.ts`): a 16 A breaker set to 5.5 × In (88 A RMS, 124.5 A peak) trips magnetically in the first step of the 7.5 kW start; at 6 × In (135.8 A peak) the motor starts.
- DC releases compare |i| with k·In directly. The thermal image still uses the step's first-substep RMS current.

## Motor starters and variable-frequency drive

Three components start and run the induction motor in ways other than direct-on-line. All of them work with the dynamic machine model, so starting currents, transients and run-up times follow from the machine equations, not from fixed factors.

### Star-delta starter

A delta-wound motor (for example 400 V Δ / 690 V Y on a 400 V supply) starts with its windings in star, so each winding sees V/√3. In the per-phase star-equivalent model this is an ideal ratio a = 1/√3 between line and machine: the terminals see Z/a² = 3Z and E/a, the line current is a·i_winding, and the winding voltage is a·v_line.

- **Star:** line current and torque are one third of direct-on-line. The tests confirm the ratio against direct-on-line at locked rotor, to within the supply's internal voltage drop.
- **Open transition:** after the star time both contactors are open for the dead time (default 50 ms, typically 30–80 ms). The motor is an open stator: the rotor flux decays with T0' and the rotor slows under its load.
- **Delta:** reconnecting at full voltage with residual flux gives the well-known transition surge. For the 7.5 kW motor at 10 N·m: first peak 44 A in star (direct-on-line 131 A), 1472 rpm at the end of the star time, 112 A peak at the delta transition.
- **Physical limit, not a model limit:** a load above about one third of the locked-rotor torque does not start in star (20 N·m against 18 N·m star torque).
- The starter feeds exactly one induction motor (directly or through series elements, see below). Its rated current is the AC-3 line current; starting current is tolerated for the motor starting allowance. Rated voltage 690 V (contactor insulation voltage), because an open starter carries line-to-neutral voltage.

### Soft starter

Antiparallel thyristors delay the firing angle and reduce the motor's fundamental voltage. On the fundamental, a phase-controlled AC switch absorbs reactive power but no real power (apart from its conduction loss). It is therefore modelled as a controlled lossless series reactance X ≥ 0 plus the path resistance:

```
|Z| / |Z + jX| = k(t)                  k: target voltage ratio, Z = R + jXm: steady motor impedance at the present speed
|V| / |Z + jX| ≤ I_lim = limit × In    current limit
X = max(0, √(|Z|²/k² − R²) − Xm, √((V/I_lim)² − R²) − Xm)
```

- **Ramp:** k rises from the initial voltage (default 40 %) to 100 % over the ramp time. Starting torque scales with k².
- **Bypass:** once the ramp is at 100 % and no reactance is needed for the current limit, the bypass contactor closes (X = 0). If that does not happen within the maximum start time, the starter trips.
- **Soft stop:** with a stop time > 0, k ramps down to the initial voltage, then the starter opens (pumps: limits pressure surges).
- **What this reproduces:** current held at the limit (40 A ± 3 % in the test), and low line power factor while ramping (below 0.35, because the thyristors draw reactive power).
- **Not modelled:** harmonics (motor heating by harmonic currents, line distortion), thyristor conduction loss (seconds at a few watts per ampere), torque pulsations from asymmetric firing. The reactance is computed from the steady motor impedance at the present speed: a feed-forward controller that knows the motor, where a real starter measures over half cycles.

### Variable-frequency drive

A diode rectifier charges a DC link; a PWM inverter makes a three-phase output at a commanded frequency. The model works at the fundamental frequency:

- **Output network:** a separate AC network whose frequency is the drive's output frequency, fed by a stiff voltage source (the inverter's current-controlled modulation). Its phasors are referred to the drive's output angle θ = ∫2πf dt. The induction machine's dq frame rotates with it; the machine equations hold for a time-varying frame speed, so energy stays exact while the frequency changes.
- **V/f characteristic:** V_LL = V_r·(b + (1 − b)·f/f_base) with boost b (default 3 %), constant V_r above the base frequency (field weakening).
- **Ramps:** acceleration and deceleration times from 0 to the base frequency; start/stop frequency (default 0.5 Hz); stop by ramp or coast.
- **Current limit:** an ideal fast current controller. When the ramped frequency would draw more than the overload current (default 150 % of In) at the motors' present speed, the frequency moves towards zero slip until the steady-state current equals the limit. This applies to motoring (stall prevention, extended acceleration) and to braking (extended deceleration). Measured-current feedback corrects the steady-state model; while the rotor flux builds up at low frequency the dynamic current can exceed the limit by up to about 6 % for a fraction of a second.
- **Input:** the rectifier draws the output power plus losses (plus its harmonic emission, see below), with the fundamental in phase with the supply voltage. It is a constant-power load P = 3·G·|V|², with G iterated until it is consistent with the solved voltage. A drive needs a balanced three-phase supply; without one the DC link is uncharged and the output is off.
- **Regeneration:** a diode rectifier cannot return power. When output power plus losses is negative, the surplus goes to the braking resistor, which is external: its heat goes to ambient, not into the drive's heat sink.
- **Losses:** P = P₀ + P_r·(0.5·i + 0.5·i²), i = I_out/In: standby, switching (∝ I) and conduction (∝ I²). P_r is the datasheet loss at rated current (default 3 % of rated power). Losses heat the drive's heat sink (thermal mass and cooling), which trips the drive above its trip temperature.
- **Protection:** I²t image θ = (I/In)² with τ = 60 s / ln(x²/(x² − 1)), so the overload current trips after 60 s from cold (test: 60.2 s with a stalled 75 N·m load). Instantaneous output overcurrent trips above 2.5 × √2·In.
- **Results for the 7.5 kW motor:**
  - at 25 Hz the output is 206 V;
  - line current drops from 6.8 A (direct-on-line, power factor 0.70) to 4.9 A (drive, power factor ≈ 1) at the same load, because the DC link supplies the motor's reactive power;
  - starting line peak is 7.7 A against 131 A direct-on-line.
- **Not modelled:** harmonics on the output (PWM ripple), DC-link voltage dynamics and undervoltage ride-through, overvoltage trip without a braking resistor, vector control and slip compensation, output voltage limited by a low supply voltage. Capacitors on the output are rejected (they would be overloaded by the PWM voltage).

### Elements between starter and motor

The motor terminal of a starter may lead to the motor through series elements without branches: cable, overload relay or motor-protective breaker, meter, switch.

- **Soft starter:** these elements are in the line and carry line current. Their impedance is added to the motor impedance in the soft starter's voltage-ratio and current-limit control.
- **Star-delta:** they are motor leads in the winding circuit, as in a real six-conductor installation (U1–W1 from the main contactor, U2–W2 to the star/delta contactors). A cable stands for both lead sets, two conductors per winding (n = 2). An overload relay or other device sits in the U1 leads (n = 1).
  - Star: winding current = line current; n·Z per phase.
  - Delta: winding current = line current/√3; n·Z per winding, which is n·Z/3 per phase in the star equivalent.
  - The reading shows one conductor's current and voltage drop; power is the total of all conductors, and a cable's thermal mass and cooling count six conductors. An overload relay in the motor leads therefore sees the winding current and is set to In/√3 ≈ 0.58 × In, as in practice.
- With the starter open, the leads and motor form a cut-off subnetwork; it is pinned to 0 V (no current) instead of leaving the matrix singular.

### Step readings

With substeps (motor transients, 0.5 ms), the readings of a 1/60 s step are:

- **currents:** RMS over the substeps, √(Σ I²·h / Δt);
- **power and reactive power:** averages over the substeps;
- **power factor:** average real power over average apparent power;
- **drive powers:** averages, output current RMS.

Before, currents were the first substep's sample: the switch-on step of a direct start showed 6 A instead of its RMS of several times rated. The protection thermal images (breakers, motor protectors, supplies) now integrate the RMS current of the step, so their I²t is exact over the substeps. The instantaneous peak for magnetic trips is unchanged.

### Drive input harmonics

A six-pulse diode rectifier draws non-sinusoidal current: harmonics h = 6k ± 1. The model solves the supply network at each harmonic frequency (5th to 25th):

- **Spectrum:** I_h = s·|I₁|/h at phase h·φ₁ (the ideal six-pulse shape), scaled so the total harmonic distortion equals the drive's input THD parameter (default 40 %, typical with a DC choke; about 30 % ideal, 80–120 % without choke).
- **Network at h·f:** supplies are their internal impedance (no harmonic EMF); induction machines their leakage impedance Rs + Rr + j·h·(X1 + X2)·f/f_rated (slip ≈ 1); inductors, capacitors, cables and contacts their impedance at h·f; motor-lead factors apply. The network is linear, so it is solved once per order and drive for a unit injection and superposed with the actual injections.
- **Effects:** every element's RMS current is √(I₁² + ΣI_h²), and its harmonic I²R adds to its heat (in motors, to winding heat). Power factor readings are the true power factor P/(3·V·I_RMS); the rectifier's is 1/√(1 + THD²) ≈ 0.93. A power-factor capacitor forms a parallel resonance with the supply inductance at h = √(X_C/X_s) and amplifies the harmonic current (the test shows more than 3× at the 5th).
- **Energy:** the harmonic power dissipated in the network (including the supply's internal resistance) is emitted by the rectifier, which draws it from the fundamental: input = output + losses + emission, iterated with the constant-power input. Energy closes to about 1e-10.
- **Example (7.5 kW drive, 40 N·m, 50 m 2.5 mm² cable):** input 9.92 A fundamental, 10.68 A RMS (3.97 A harmonics), true power factor 0.928; 16.3 W harmonic loss in the cable.
- **Not modelled:** the voltage distortion's effect on other loads beyond their harmonic current, non-characteristic and inter-harmonics, the dependence of THD on load and supply impedance (THD is a fixed parameter), the effect of harmonics on peak current for magnetic trips, harmonics on the drive's output (PWM ripple).

### Supporting changes

- A machine whose terminals are not closed through the rest of the network (open starter, open switch) is an open stator, not a Thevenin element. This avoids a floating node in paused re-solves and midpoint ringing at the current interruption.
- Switching detection for the 0.5 ms substeps compares the discrete electrical configuration (contactors, protection, starter modes, drive run states) with the last accepted substep. Starter timers end substeps exactly on their transition times.
- Motor overvoltage is reported above 105 % of rated voltage (IEC 60034-1 zone A) instead of any excess: a reconnection transient lifted the terminal voltage by 0.007 %.
- Example "Starting a motor three ways" runs all three methods from one supply.

Tests: `motor-starting.test.ts` covers the star current and torque ratio, transition timing and surge, non-starting in star, the soft-starter current limit, reactive power, bypass, soft stop and start-time trip, and for the drive V/f, power balance and unity power factor at the input, starting current, current limit while accelerating and braking, braking energy outside the heat sink, the I²t trip time, output short circuit, missing supply and output capacitor errors, the wired frequency command and field weakening.

## Finite batteries, powered contactors, transformers and radiators

See [DEVICES.md](DEVICES.md) for equations, physical state, terminal conventions, source/chemical energy accounting, solver corrections and explicit limitations. These components are available in Free Sandbox; earlier model-limit paragraphs describe their historical revision, rather than overriding the current component inventory.

## Coupled substeps and the speed-controlled DC drive (audit 2026-10-11)

### Head/storage coupling: second order, no blanket 1/240 s substep

- The hydraulic network is now solved at **mid-step tank inventories** predicted from the previous flows (m + ½·h·Q·ρ), in fixed steps as it already was in adaptive macro steps. Start-of-step levels were first-order in the head/storage splitting, which is why every fixed 1/60 s step was cut into four 1/240 s substeps.
- Without moving rigid bodies or induction machines, a fixed step is now one coupled substep, bounded only by storage time scales (≤ 1 % of a tank's height per substep, and a surcharged weir's explicit level update inside 0.3·A/(dQ/dh)). Static housings no longer force substeps or block adaptive advance.
- A tank that a step would drain by more than half keeps its start-of-step inventory in the solve; the empty instant is resolved by the boundary split as before.
- **Evidence (transfer starter, 120 s against a 1/960 s reference):** start-of-step levels at 1/240 s: tank masses within 0.3 g, energy residual −3.2·10⁻² J; mid-step levels at 1/60 s: masses identical to 0.1 g, energy residual −5.6·10⁻⁶ J, 3× less computation. Every hydraulic challenge reference (completion time, score) is unchanged.
- **Induction machines keep 1/240 s.** In the supply-frame phasors the decaying stator-flux offset rotates at ω_s, and the energy-conserving implicit midpoint rule damps that mode at σ/(1 + (ω_s·h/2)²) of its true rate: σ/1.4 at 1/240 s, σ/7.8 at 1/60 s. While the flux is changing (switching, run-up), substeps are 1/(40·f) as before (σ/1.006).

### Speed-controlled DC drive

The former "ideal PWM drive" used duty = kₑ·ω*/V_rated + 0.02·(ω* − ω): a fixed proportional gain in 1/(rad/s) regardless of motor size, no integral action and no current limit. Under load it settled with a droop of I·R/(kₑ + 0.02·V) (≈ 135 RPM for the 48 V traction motor holding 13 A), and a speed step on the 440 V / 75 kW motor applied full voltage to its 0.1 Ω armature: about 4,400 A, 23 × rated.

Now the drive is a cascade, as in industrial armature-voltage drives:

- **Speed controller (PI):** current reference I* = Kp·(ω* − ω) + I_int, limited to ±1.5·I_rated. Kp = J·ω_c/kₜ with speed-loop bandwidth ω_c = 20 rad/s on the rotor's own inertia; integral corner ω_c/4.
- **Current loop:** ideal (much faster than the mechanics), so the converter applies V = R·I* + kₑ·ω and duty d = V/V_supply ∈ [0.001, 1]. The duty is evaluated at the solved midpoint speed inside the electromechanical Newton iteration, so the proportional path is implicit.
- **Integral:** backward Euler on the integral mode after each accepted substep. It is held while the converter does not deliver the reference in the error's direction: current limit, full or minimum duty, or a supply that cannot source the current (CV/CC supply in current limit). The response after saturation therefore does not depend on how long the drive was saturated.
- **Regeneration:** duty below kₑ·ω/V drives current back into the supply; at minimum duty the braking current is limited to kₑ·ω/R, as for a converter without a braking chopper.
- **Results:** 440 V motor, 1,500 RPM command against 400 N·m: starts at 285 A (150 %), reaches 1,500.00 RPM with I = (T_L + b·ω)/kₜ; a load step is rejected to zero steady-state error. Tests: `dc-drive.test.ts`.
- **Lift reference design.** Its position controller had a 135 RPM feed-forward that only compensated the old drive's load droop: with a stiff speed loop the lift ran into its end stop. The reference design now commands speed = 150 RPM/m × position error (no feed-forward) and completes the assignment in 13.9 s (score 82) instead of 18.1 s (81). Rotation and pressure results are unchanged.
- **Not modelled:** armature inductance and current-loop dynamics, field weakening, the drive's own losses, four-quadrant braking choppers.

## Fuse melting characteristic (audits 2026-10-11)

- **Original:** a fuse opened after `tripTime` (0.1 s) at any current above 1.0 × In.
- **First correction:** one thermal image θ = (I/In)², melting at θ ≥ 1.45² (between the IEC 60269 gG conventional non-fusing current 1.25 × In and fusing current 1.6 × In). One time constant cannot follow a gG curve: fitted to 0.1 s at 10 × In it melted in 3.2 s at 2.06 × In, where the IEC gate requires ≥ 10 s.
- **Now: element and body.** Normalized temperature rises with a steady element rise of (I/In)²:
  - element: C₁·dθ_e/dt = x² − (θ_e − θ_b)/0.15, C₁ = 44.16·T;
  - body/holder: time constant 400·T to ambient, carrying 85 % of the steady rise;
  - melting at θ_e ≥ 1.45²; T = `tripTime` = melting time at 10 × In (exactly, by calibration).
  - Exact update over each step (2 × 2 matrix exponential); adaptive steps are bounded by a tenth of the remaining melting time.
- **IEC 60269 gG gates (16 A link, normalized), default T = 0.1 s:**

| Current | Gate | Single image | Element + body |
| --- | --- | --- | --- |
| 1.25 × In | no melting in 1 h | never | never |
| 1.6 × In | melts within 1 h | 8.1 s | 70 s |
| 2.06 × In | ≥ 10 s | 3.2 s ✗ | 24 s |
| 3 × In | (≈ 5 s typical) | 1.25 s | 5.8 s |
| 4.06 × In | ≤ 5 s | 0.64 s | 1.1 s |
| 5.31 × In | ≥ 0.1 s | 0.36 s | 0.45 s |
| 9.38 × In | ≤ 0.1 s | 0.114 s | 0.115 s |
| 10 × In | — | 0.100 s | 0.100 s |

  The 9.38 × In gate is missed by 15 ms by both, because the default melting time of 0.1 s at 10 × In sits at the slow edge of the band; lower `tripTime` for a faster link.
- **Thermal memory:** after 30 min at 1.2 × In the body is warm and 2 × In melts the element in less than 60 % of the cold time; after 3 h without current the cold characteristic is restored. Repeated 4 s pulses at 3 × In (cold melting time 5.8 s) melt the element on a later pulse.
- **Limits:** no arcing time, current limitation or let-through I²t; one generic gG shape scaled by T (no aM/aR classes, no rating-dependent curve shape).
- Tests: `protection.test.ts` (gates, engine melting times, conventional currents, memory and cooling, repeated pulses).

## Filament lamp (audit 2026-10-11)

- **Before:** constant resistance; switching on drew the hot current at once.
- **Now:** a lumped tungsten filament with u = T/T_op (T_op ≈ 2,700 K at rated power), `filament.ts`:
  - R(u) = R_hot·u^n with n = ln 0.1 / ln(293 K/2,700 K) = 1.04: the cold filament has 10 % of the configured (hot) resistance.
  - Losses P_r·[0.9·(u⁴ − u_a⁴)/(1 − u_a⁴) + 0.1·(u − u_a)/(1 − u_a)]: radiation plus gas/lead conduction, equal to the rated power at u = 1.
  - Heat capacity from a 0.08 s time constant linearized at the operating point.
  - Per step the electrical power (solved with the start-of-step resistance) is held and the losses are implicit. Energy is exact: the electrical energy equals the change of filament energy (counted as stored energy) plus the heat passed to the lamp body. The explicit resistance coupling is stable for any step (perturbation factor → −0.28).
- **Results (default 6 Ω / 30 W lamp):**
  - At rated voltage (13.4 V) it settles to exactly 6 Ω and 30 W: the former model is the operating-temperature limit.
  - Switch-on draws ≈ 10 × the hot current (22 A instead of 2.24 A) and decays to within 10 % in ≈ 0.12 s.
  - Below rated voltage the lamp is non-ohmic, P ∝ V^1.59: 25.1 W at 12 V instead of 24 W.
  - A warm filament re-lights with a smaller surge. The filament cools to below 30 % of T_op within about 1 s.
- **Rating:** a lamp is over its rating when the filament runs above its rated temperature (overvoltage), not during the switch-on surge.
- **Protection:** a gG fuse and a C-curve breaker (10 × In) sized above the hot current carry the surge; a B-type release at 5 × In sized at 3 A trips magnetically on the 22 A surge, as real B-curve breakers do on large lamp loads.
- **Challenge 001:** the 3 s of rated operation start after the surge. The reference completes at 3.117 s instead of 3 s, still 100/100 and three stars; re-recorded.
- **Limits:** the surge is resolved at the fixed step (1/60 s): the first step carries the full cold current, so the surge's I²t is overestimated (up to ≈ 2× for this time constant). No light output spectrum, AC flicker or filament ageing.
- Tests: `lamp-filament.test.ts`.
