# Physical and numerical models

Phase 3A adds validated rigid bodies, joints and motor shafts. See [mechanical equations, conservation and limitations](PHASE3A.md) and [executed results](PHASE3A-RESULTS.md).

All internal values use volts, amperes, ohms, watts, joules, seconds and Celsius temperature differences. Tank volume is configured in liters and converted using 1 kg/L. Temperature differences in °C and K are identical.

## Electrical model

Ideal DC voltage sources and constant resistances satisfy `V = IR` and `P = VI`. Ideal wires merge nodes. Modified nodal analysis solves

```
[G  B] [v] = [0]
[Bᵀ 0] [i]   [Vs]
```

Every resistive branch stamps conductance `1/R` into G. Voltage-source incidence stamps B. Partial-pivot Gaussian elimination solves the matrix. The reported residual is the largest absolute equation residual; its equations have mixed voltage/current units, so it is a diagnostic rather than a dimensionless accuracy bound.

A closed switch is 0.01 Ω; an open switch contributes no conductance. A fuse is 0.02 Ω until it opens. A voltmeter has 10 MΩ input resistance. Lamp brightness derives from measured electrical power. Lamps omit filament temperature dependence. Element resistance is constant. Ground references merge; independent islands get individual reference potentials.

A wire short across an ideal supply produces an explicit solver error. Redundant/conflicting ideal-source configurations can produce singular matrices; the experiment pauses instead of substituting values. Supply current above its configured maximum pauses. Passive power above the rating for 0.5 s fails the branch open; fuses open after 0.1 s above rated current. An element exceeding its thermal rating also fails open. These are idealized protection and failure models, not manufacturer-specific fuse curves.

Electrical energy uses `E += Σ Ppassive Δt`. With ideal sources and passive DC networks, net supplied power equals passive dissipation. Source internal losses are zero. Wires have no thermal mass or loss.

## Thermal model

Each non-source electrical element has a lumped thermal capacity C in J/K. Tanks use `C = m cp` with `cp = 4180 J/(kg K)`. Every node has ambient conductance UA in W/K. A heater connected to water adds symmetric inter-node conductance.

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

Water is well mixed, fixed density, fixed heat capacity, and bounded to 1–95°C. Crossing a bound pauses. Wall mass, evaporation, boiling, latent heat, temperature-dependent properties, radiation, spatial gradients, pressure and fluid flow are omitted. No tank pressure or flow is fabricated.

## References and tolerances

- 12 V across 6 Ω: exactly 2 A and 24 W in the model. Tests use a 1e-9 numerical tolerance.
- Series 6 Ω + 3 Ω at 12 V: 4/3 A, with voltage drops summing to 12 V.
- Parallel 6 Ω and 12 Ω at 12 V: 3 A total, 36 W total.
- 24 W for 5 s: 120 J, within 1e-7 J in the test.
- 10 kg × 4180 J/(kg K) × (80 − 20) K = **2,508,000 J**. The isolated reference test allows less than 40 J overshoot from the final fixed step. Element energy is counted separately.
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
- **Feedback** from temperature to flow uses the node temperatures of the previous transport substep (1/240 s lag; for an adaptive macro step, one macro step). There is no nested temperature–flow iteration. At t = 0 a zero-length transport mixes the inventories and the network is re-solved once, so the first reading already uses the correct viscosities.
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
- **Rejected with explanations:** DC and AC sources in one network; different frequencies in one network; a DC motor on AC; a three-phase induction motor without a `source3` supply.
- **Not modelled:** transients (switching inrush, capacitor charging), harmonics, saturation, core loss, single-phase machines.

**Induction motor** (`inductionMotor`, default 7.5 kW / 400 V / 50 Hz / 4-pole; 45 kW variant):

```
ω_s = 2πf/(p/2)      s = (ω_s − ω)/ω_s
T = 3·I₂²·(R₂′/s)/ω_s          (air-gap torque)
P_in = P_cu1 + P_cu2 + T·ω     (P_cu2 = s·P_airgap)
```

- Reactances are given at `ratedFrequency` and scale with the supply frequency.
- The shaft equation, loads, friction and shaft couplings (pumps, rigid bodies) are shared with the DC motor. Copper losses heat the motor's thermal mass.
- The motor–network coupling uses a chord (frozen-Jacobian) Newton iteration with a midpoint predictor. A 5 s run-up closes energy to ~10⁻¹¹ relative.
- Default calibration: locked rotor 74 A / 54 N·m (≈ 5 × rated current), rated point ≈ 1450 rpm, 14 A, 52 N·m, breakdown torque 131 N·m at ≈ 1200 rpm.

Tests: `src/simulation/ac.test.ts` (R–L power and power factor, capacitor power-factor correction, DC capacitor, unbalanced star with neutral, locked rotor vs equivalent circuit, run-up energy and power balance, motor driving a pump, rejection messages) and rows in the scaling campaign.

### Performance

Measured on the supply challenge reference (720 s simulated): **215 → 59 ms of CPU per simulated second**, with identical results. The speed-up comes from:
- caching the hydraulic and electrical network topology per immutable project object (WeakMap);
- a warm-started Illinois inverse for one-way branches;
- reusing the line-search Jacobian in Newton;
- a chord iteration with midpoint predictor for motor coupling.

At real-time speed the heaviest example now needs about 6 % of the main thread. Moving the solver to a Web Worker would make the UI read results asynchronously (every caption, probe and Inspector field). That refactor was **deferred**, because measured cost no longer justifies it; it remains the next step if large scenes become slow.
