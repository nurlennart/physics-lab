# Battery, powered contactor, transformer and fan-cooled radiator

These components are available in Free Sandbox and the example shelf. They use the existing SI model, immutable project configuration, simulation clock, probes, faults, imports and deterministic replay. Existing scored missions retain their original equipment restrictions. Configuration and saved-run formats remain compatible.

Executed component checks and conservation measurements are recorded in [DEVICES-RESULTS.md](DEVICES-RESULTS.md).

## Battery

The battery is a rechargeable DC Thevenin model with finite capacity Q = 3600 × capacityAh coulombs and state of charge s in [0, 1]. Its declared open-circuit curve is linear:

```
E(s) = E_empty + (E_full − E_empty) s
V_terminal = E(s_mid) + R_internal I
s_next = s_old + I h / Q
U_chemical(s) = Q [E_empty s + ½ (E_full − E_empty) s²]
```

Current I is positive into the battery's positive terminal: charging is positive, delivery negative. The midpoint voltage is stamped exactly by using E(s_old) and effective series resistance R_internal + (E_full − E_empty) h/(2Q). Only the real R_internal produces heat. This makes V I h = ΔU_chemical + I² R_internal h for an accepted interval.

Empty/full events split the coupled interval before accepting a solution. At empty, discharge is blocked but charge remains possible; at full, charge is blocked but discharge remains possible. This is an ideal directional battery-protection boundary, not a charger. The pack's configured current rating trips its output, and overheating disconnects it. Reset restores initial charge. Capacity, initial charge and OCV endpoints are Reset-only because they define stored energy.

Battery terminal power is reported with the source convention. Battery chemical energy is **inside** the whole-system boundary: the global supplied-energy counter counts external supplies; stored-energy change includes chemical and thermal storage. A battery discharging into an insulated resistor therefore has zero external supply and equal chemical loss/thermal gain. Chemical energy and SOC have dedicated probes.

No chemistry-specific voltage plateau, polarization RC branches, self-discharge, ageing, temperature-dependent OCV, cell balancing or electrochemical safety prediction is claimed. Defaults are illustrative engineering values, not a measured cell model. Equivalent-circuit and coulomb-counting foundations: [MathWorks Battery Equivalent Circuit](https://www.mathworks.com/help/simscape-battery/ref/batteryequivalentcircuit.html).

## Electrically powered contactor

Terminals a–b are one normally-open power path; ca–cb are a separate DC coil. In a balanced three-phase network the power path represents three identical poles; the DC coil is counted once. Coil and load circuits exchange no electrical power through the actuation mechanism.

```
I_coil = V_coil / R_coil
P_package = V_coil²/R_coil + P_contacts
pickup: |V_coil| ≥ pickupRatio × ratedCoilVoltage for pickupTime
release: |V_coil| ≤ dropoutRatio × ratedCoilVoltage for dropoutTime
```

Dropout is below pickup; between thresholds the contact keeps its state. Mechanical timers advance only on accepted simulation intervals and have the existing coupled-substep resolution (normally at most 1/240 s). Paused inspection cannot pick up the coil or advance a timer. Contact and coil losses heat one package. Welded/stuck-open contacts and whole-device open failure are injectable.

This is a DC resistive-coil approximation. Coil inductance, armature motion/force, flyback, arcs, contact bounce, auxiliary contacts and AC shading-ring behavior are omitted. AC excitation of the coil is explicitly rejected. AC power and DC coil supplies must remain separate solving islands: the existing circuit solver does not superpose AC and DC excitation in a shared network. Thresholds and delays are configurable illustrative values; actual coil limits depend on the selected product: [Schneider Electric coil operating bands](https://www.se.com/ca/en/faqs/FAQ000223298/).

## Transformer

Terminals a–b are the dotted primary and return; sa–sb are the dotted secondary and return. The linear AC equivalent uses n = Np/Ns, primary-referred combined winding resistance R and leakage inductance L, and a primary-terminal shunt Rc || jωLm:

```
Vp − n Vs = (R + jωL) I_transfer
I_secondary_into_device = −n I_transfer
I_primary = I_transfer + (1/Rc + 1/(jωLm)) Vp
P_loss = phases × [R |I_transfer|² + |Vp|²/Rc]
```

Both windings are assembled in the same MNA solve, so load reflection and reverse power transfer are simultaneous. Each galvanically separate network gets its own voltage datum without wiring the windings together. Cross-isolation voltage probes are unavailable unless an explicit electrical connection supplies a shared reference. Multiple transformers and grounded secondaries are supported. Balanced three-phase use represents three identical units, without vector-group phase shifts.

The winding impedance and shunt branch are evaluated at the actual fundamental or harmonic frequency. Generic power is package loss; voltage/current are primary input quantities, and secondary RMS quantities have separate probes. Apparent input power and primary current determine overload warnings; package temperature can fail it open.

DC excitation is explicitly rejected. No saturation, switching inrush, hysteresis, frequency-dependent core loss or stray capacitance is claimed. Core resistance is a fixed linear approximation; the magnetizing branch is an approximate primary-terminal shunt. Model foundation: [MathWorks transformer equivalents](https://www.mathworks.com/help/simscape/ug/comparison-of-mutual-inductor-and-ideal-transformer.html).

## Fan-cooled radiator

The inlet/outlet form a bidirectional hydraulic restriction using the existing two-K loss law and upstream water viscosity. Electrical a–b supply an equivalent DC fan load:

```
R_fan = V_rated²/P_fan,rated
P_fan = V_fan²/R_fan
UA = UA_natural + UA_forced × min(1, |V_fan|/V_rated)^0.8
Tout = Tamb + (Tin − Tamb) exp[−UA/(ṁ cp)]
```

Forced UA is zero when the fan has no electrical power; natural UA remains. The 0.8 exponent is an explicit empirical teaching approximation, not a calibrated fan/radiator map. The electrical fan is a resistive equivalent without startup inertia, PWM or airflow-network dynamics. Its electrical power ultimately goes to ambient once. A failed fan opens its electrical branch and retains natural cooling.

The zero-inventory radiator transfers signed heat to an ideal ambient-air boundary. Reversing water flow reverses the transport path, not the heat law. Cold water can gain heat from warmer ambient; the outlet approaches ambient without crossing it from heat exchange alone. Hydraulic dissipation is added to the outlet water, consistent with the existing zero-volume pipe convention. At zero water flow there is no stored water/body to cool and fluid temperature is unavailable. No fin/body storage, finite air inventory, humidity or freezing/boiling is modeled. Heat-exchanger foundations: [MathWorks radiator modeling](https://www.mathworks.com/help/hydro/ug/modeling-heat-exchangers.html).

## Existing-component physics corrections

The DC CV/CC active-set loop now returns only a stable state and throws on repeated states or iteration exhaustion. Its current-direction release condition is corrected: a source at the delivery limit must release when its required EMF rises above its setpoint; one at the absorption limit must release when the required EMF falls below it. Previously, interacting supplies could settle to the wrong current direction, and a supply absorbing power could cycle.

Dense real/complex solves now equilibrate equations and unknowns and use machine-precision-relative pivot checks. Real equation scaling uses powers of two to avoid adding scaling roundoff. Poorly scaled real systems receive bounded compensated-residual refinement. Original-equation normalized backward error is checked separately from the existing absolute diagnostic residual. This is not a condition-number certificate or a guarantee of small forward error for an ill-conditioned circuit.

Generic numerics are in `linear-algebra.ts`; `electrical.ts` retains the public API; `electrical-core.ts` owns MNA; `device-circuits.ts` assembles the additional device branches; `devices.ts` owns their accepted state and constitutive energy functions. Existing component references, conservation, timestep, protection, parameter and scoring suites remain the regression baseline. Passing them does not certify manufacturer behavior or every possible component combination.

The contribution gate now stops if physics validation or the production build fails. Previously those commands were on the left side of `&&`, which bypassed Bash's `set -e` failure handling. Stubbed failing validators/builds verify that their exit codes propagate and no success message appears.

The existing hydraulic startup report also assumed a fixed finite-reference error ratio of 3. Its unchanged baseline actually produced 6.193, with all absolute volume/current/speed/temperature bounds passing. Pump reverse-check opening makes this a nonsmooth coupled startup; one error ratio cannot establish a particular convergence order. The report now retains every absolute bound and requires at least a factor-of-two volume-error reduction on halving the internal step, with a 1e-12 m³ numerical floor. Raw errors and their ratio remain in the report. No hydraulic equation or challenge reference score was changed to make this check pass.
