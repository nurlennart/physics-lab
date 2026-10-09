# Physical and numerical models

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
