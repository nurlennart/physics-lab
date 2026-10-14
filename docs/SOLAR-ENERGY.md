# Solar generation, storage and distribution

Five independent components extend the ordinary schematic, solver, thermal system, probes and project files: **Solar Panel (PV)** (`solarPanel`), **LiFePO4 Battery** (`lfpBattery`), **MPPT Charge Controller** (`mpptController`), **DC/AC Inverter** (`inverter`) and **Battery Protection Switch** (`batteryProtection`). Names, kind identifiers, prefixes, variants, presets and example files are manufacturer neutral. The Inspector links exact equipment references and distinguishes published values from fitted and assumed parameters.

## Reference selection and compatibility

Research checked 2026-10-13. Sources are official manufacturer publications, not retailer specifications. Numeric values below apply to the stated editions/variants, rather than every product carrying the same family name.

| Generic device | Reference and official source | Published values used |
| --- | --- | --- |
| PV | [Trina Solar Vertex S+ TSM-450NEG9R.28, TSM_EN_2024_A_S1](https://static.trinasolar.com/sites/default/files/Datasheet_Vertex%20S%2B_NEG9R.28_EN_2024_A_S1_web.pdf), p. 2 | STC 450 W; Voc 52.9 V; Isc 10.74 A; Vmpp 44.6 V; Impp 10.09 A; coefficients Voc −0.24%/K, Isc +0.04%/K, Pmax −0.29%/K; 1762 × 1134 mm; NOCT 43°C |
| Charge controller | [Victron SmartSolar MPPT 100/20 manual, §9.1](https://www.victronenergy.com/media/pg/Manual_SmartSolar_MPPT_75-10_up_to_100-20/en/technical-specifications.html) | 100 V PV Voc; 20 A PV short circuit and battery current; nominal PV 290 W at 12 V / 580 W at 24 V; 98% peak efficiency; PV startup +5 V, running +1 V above battery |
| Battery | [Victron Lithium Battery Smart 12.8/100 and 25.6/100](https://www.victronenergy.com/upload/documents/Datasheet-12,8-&-25,6-Volt-lithium-iron-phosphate-batteries-Smart-EN.pdf), p. 2 | 100 Ah; 1280/2560 Wh nominal; 4/8 series cells; 0.8/1.6 mΩ; 200 A maximum charge/discharge; recommended charge ≤50 A, discharge ≤100 A; charge +5…50°C, discharge −20…50°C; recommended absorption 14.2/28.4 V, float 13.5/27 V |
| Inverter | [Victron Phoenix / Inverter VE.Direct 24/500, 230 V](https://www.victronenergy.com/upload/documents/Datasheet-Phoenix-Inverter-VE.Direct-250VA-1200VA-EN.pdf), p. 2 | 400 W / 500 VA at 25°C; 900 W peak; 230 V / 50 Hz; 90% maximum efficiency; 6.5 W idle; 1.5 W ECO; shutdown/restart 18.6/21.8 V; upper DC input 34 V |
| Protection | [Victron Smart BatteryProtect 12/24 V 65 A](https://www.victronenergy.com/upload/documents/Datasheet-Smart-Battery-Protect-65-A--100-A--220-A-EN.pdf) and [manual](https://www.victronenergy.com/media/pg/Smart_BatteryProtect_12V_24V/en/index-en.html) | 65 A continuous; configurable voltage thresholds; remote control; separate downstream load protection |

One panel is compatible with either the 12 V or 24 V charging profile. At 12 V, its available 450 W exceeds controller output capability, so the model curtails the panel to approximately 270 W at mid SOC. A 25.6 V battery is used with the 24/500 inverter. Two of these panels in series exceed the controller's 100 V limit even at STC (105.8 V); cold weather increases Voc further. Two parallel panels exceed the reference controller's published 20 A short-circuit rating (21.48 A). Real panel series/parallel connections nevertheless work with suitable configurable controllers or other loads.

The battery reference has cell monitoring/balancing and **requires an external BMS**. The generic battery deliberately bundles a simplified BMS. It does not claim the manufacturer supplies an internally switched pack. The distribution protection is a separate device. The off-grid example connects the inverter directly to the battery bus, with the protection switch on the DC lighting branch. Reference BatteryProtect hardware is unidirectional and must not directly switch an inverter input; the generic ideal contact permits both directions, explicitly identified as an approximation.

## PV equations and calibration

The single-diode model has infinite shunt resistance and positive series resistance:

```
I = Iph − I0 [exp((V + Rs I)/a) − 1]
V(I) = a ln[1 + (Iph − I)/I0] − Rs I
```

At STC, Iph ≈ Isc and I0 = Isc/expm1(Voc/a). Fit `a` and `Rs` to the published Vmpp/Impp point plus `d(VI)/dV = 0` there. Specifically `Rs = Vmpp/Impp − a/(Isc − Impp + I0)`; a scalar bisection closes the voltage equation. The negligibly small diode current at short circuit explains the approximate Iph = Isc assumption. All four STC points and the stationary MPP are fitting constraints, **not independent validation points**. The product 44.6 × 10.09 is 450.014 W, consistent with a rounded 450 W rating.

For irradiance ratio g and cell-temperature change ΔT:

```
a(T) = aSTC · TK/298.15
Iph = IscSTC · g · (1 + αI ΔT)
Voc,1000(T) = VocSTC · (1 + βV ΔT)
I0(T) = IscSTC(1 + αI ΔT) / expm1(Voc,1000(T)/a(T))
Voc(g,T) = a(T) ln(1 + Iph/I0(T))
```

Current scales approximately with irradiance; voltage changes logarithmically. The power coefficient is a withheld comparison, not a separately imposed power correction. The manufacturer NOCT point (800 W/m², nominal cell temperature 43°C, 344 W, Voc 50.2 V, Isc 8.66 A) is likewise withheld. No proprietary measured trace or digitized irradiance curve is claimed. Controller MPP telemetry sums ideal per-panel MPPs on its input island; for mismatched series panels or multiple controllers on one shared PV bus, that is an available-power upper bound rather than a separately solved array MPP. The published I–V/P–V charts remain available at the source link; the Inspector plots the implemented equations and marks operating point and calculated MPP.

A monotone junction-voltage solve evaluates I(V) and its derivative. The full MNA network iterates the local tangent, with ≤5 V tangent updates and relative current/converter residual below 10⁻¹⁰. It fails explicitly after 500 iterations. It never independently fixes panel voltage and current. Series and parallel wiring therefore follows Kirchhoff's laws. Reverse external voltage follows the diode equation; bypass diodes, cell breakdown, mismatch and multiple partial-shading maxima are absent. The optional shading fraction uniformly reduces photocurrent. Cell temperature is prescribed; no panel thermal inertia is claimed.

## Charging and storage

The MPPT uses measured PV input power. Every 0.2 s it perturbs its input voltage target by 0.25 V; a decrease in sampled power reverses direction (perturb and observe). Tracking holds during current/voltage curtailment, so zero-power full-battery periods cannot drive the target away from the available curve. An open-circuit preflight bounds the target below 98% of currently available Voc; accepted control state records that bound when irradiance changes. The reference firmware is not reproduced. Battery output is a current-limited, voltage-regulated averaged source. Coupled iteration sets output current from **actual solved PV absorption and battery terminal voltage**, and curtails input current to the actual output when voltage/current regulation binds:

```
Pout = η Pin;  η = 0.98;  Ploss = Pin − Pout
Iout ≤ configured output current
Vout ≤ absorption / float target
```

A preflight solve with converter ports open checks available PV voltage, actual battery voltage, startup thresholds and maximum input voltage. Missing batteries and PV, reverse polarity and undervoltage inhibit conversion. Overtemperature disconnects the converter. Bulk uses available power up to output-current and absorption-voltage limits. Time at absorption accumulates; after the configurable 1800 s assumption it switches to float. Voltage below the rebulk threshold resets the timer. No equalization is applied. The input current is limited to 20 A, but available array Isc must also be checked by the user; operating current limiting does not certify an oversized array safe for the reference hardware.

An inhibited preflight preserves the last tracking target through darkness or a disabled panel. On restart, the loaded target also respects startup headroom; checking only open-circuit voltage would allow a persistent startup lockout. During curtailment, output demand is evaluated with input curtailment released in the current MNA tangent network. The released solve also supplies voltage and output-power sensitivities for a bounded Newton correction of the input-current power-balance equation. This avoids the nearly unit fixed-point derivative close to the PV power maximum and prevents temporary input-power undershoots from reducing both output demand and input current together. The nonlinear PV equations, measured converter power residual, 10⁻¹⁰ convergence threshold and 500-iteration limit still apply unchanged.

The battery reuses the existing piecewise-linear LFP OCV plateau, exact OCV integral and accepted-step charge integration:

```
SOCnext = SOC + (ηc max(I,0) + min(I,0)) h / (3600 capacityAh)
Echemical(SOC) = 3600 capacityAh · ∫₀ˢᴼᶜ OCV(s) ds
Vterminal = OCVmean(SOC, SOCnext) + Rinternal I
OCVmean(s₀,s₁) = [∫ₛ₀ˢ¹ OCV(s) ds] / (s₁ − s₀)
Pheat = Vterminal I − ΔEchemical/h
```

Current is positive into the battery. Coulombic efficiency 99.5% is assumed. Stored energy is the OCV integral, rather than nominal voltage × remaining Ah. Internal ohmic and charge-acceptance losses enter the existing thermal mass. SOC boundaries split the accepted interval. A full pack blocks charging; an empty/low-voltage pack blocks discharge but can recover by charging. Temperature restrictions are directional. Excessive configured charge/discharge current or terminal power opens and latches the BMS until Reset. Cell-count edits reset voltage limits and resistance consistently; capacity and initial SOC require Reset.

The OCV curve, lumped heat capacities and ambient UA are engineering assumptions, not manufacturer measurements. The manufacturer's 92% round-trip efficiency is not forced by a correction term: simulated efficiency follows the actual load and losses. Capacity reduction at 0/−20°C, cell imbalance, ageing, voltage hysteresis and detailed BMS electronics are omitted.

## Inverter and distribution

The inverter expands to a DC load and a separate AC source in the existing phasor solver. The AC source drives existing resistors, lamps, reactive loads, transformers and motors through real wiring. DC power iteration draws AC real output plus losses from the solved bus:

```
Ploss = Pidle + a Pac + k Soutput²
Ppeak = Pr/2 (assumed, when feasible)
k = Pidle / Ppeak²
a = 1/ηpeak − 1 − 2 Pidle/Ppeak
Pdc = Pac + Ploss
```

Peak efficiency is placed at half rated load (assumed); the added load-proportional term makes this the actual maximum, rather than only a fitting point. If this would require negative switching loss, use a purely quadratic curve with k = (1/ηpeak − 1)²/(4 Pidle); its peak occurs at 2 Pidle/(1/ηpeak − 1), possibly above the continuous rating. Apparent load controls conduction losses. Zero load consumes 6.5 W. Explicit standby disables AC and draws 1.5 W; automatic ECO polling is not implemented. Active and apparent continuous ratings are enforced, with a 900 W/VA surge envelope for an **assumed two seconds**; the manufacturer publishes peak power but no duration in the selected datasheet. Overload latches until Reset. DC undervoltage shutdown/restart is hysteretic; high DC voltage and temperature disconnect output. The AC waveform is an ideal RMS sinusoid, with no switching ripple, harmonics or inverter startup inrush. Gradual temperature derating is not yet modeled; thermal protection acts at its configured limit.

The protection switch is an ordinary resistive contact between input and output, with a third electrical terminal sensing bus negative and an optional Boolean remote-enable input. Voltage hysteresis uses the prior accepted conducting state. Low voltage, remote off and temperature events isolate the load immediately; overcurrent and engine overtemperature failure latches require Reset. Undervoltage uses automatic hysteretic recovery. 11.8/12.8 V thresholds, 2 mΩ on resistance and 65°C cutoff are assumptions. The reference device's 90 s disconnect / 30 s reconnect delays and quiescent consumption are not implemented. Fuses, cables, breakers and ordinary switches remain independently connectable branches.

## Energy, time integration and rollback

Incident power `irradiance × aperture area` is the external input. PV terminal delivery feeds downstream circuits. The remaining incident power plus any externally absorbed diode power goes to a prescribed cell-temperature/optical reservoir, booked as ambient heat. It includes reflected/transmitted light as rejected energy; it is **not all module heat**. This boundary prevents PV electricity appearing without a global input.

Expanded converter source/load contributions are removed from external supply accounting. Only net conversion loss heats the converter. Battery chemical energy is internal storage. Loads receive their normal terminal powers. Thus:

```
incident sunlight + other external supplies
 = chemical/thermal/mechanical storage change
 + exported/ambient heat + rejected sunlight + other existing boundary terms
```

No residual correction is applied. Probes distinguish incident power, generated electrical power, charger/inverter input/output, conversion loss, chemical storage and cumulative device throughput. Cumulative output on the PV is generated electrical energy; its cumulative input is incident sunlight. The common energy panel explicitly labels sunlight in external supply and explains rejected sunlight in ambient heat.

Tracker sampling and surge deadlines constrain internal substeps. Battery adaptive limits remain 0.2% SOC; LFP fixed substeps also limit SOC change to 0.2%. Exact piecewise OCV integrals and a local MNA tangent solve replace knee-event splitting, avoiding artificial heating/cooling and repeated sub-picosecond knee events. True empty/full boundaries use their computed device interval rather than a fixed 10⁻¹⁰ s floor; the engine's existing charge boundaries, thermal solve and rollback remain authoritative. All tracker memory, overload timers, protection latches and cumulative energy live in `Devices.checkpoint()`, restored on rejected steps. Paused solves do not advance them. PV and converters are quasistatic averaged devices; charged capacitors/inductors use the existing interval-averaged storage solve, so unresolved intra-step PV transients are a local linearization approximation. Semiconductor switching times are not simulated.

## Examples and validation

Open the example shelf or import:

- [Basic solar charging](../examples/solarCharging.physics.json): one panel, 12 V profile and 100 Ah battery; observe output-current curtailment.
- [Off-grid solar system](../examples/solarOffGrid.physics.json): 24 V battery bus with charging, AC conversion and a separately protected DC branch.
- [Solar-powered circulation](../examples/solarCirculation.physics.json): existing 12 V circulator in a filled pipe loop. The battery starts at 20% SOC, keeping the pump inside its existing ±10% supply envelope during the demonstration. A fully charged pack can exceed that pump's supply envelope; a regulated 12 V supply would be needed for operation across the entire battery range.
- [Solar performance experiment](../examples/solarExperiment.physics.json): independent STC and warm/lower-irradiance circuits, operating voltage and tracking probes.

Irradiance and cell temperature are live parameters. Set irradiance to 200 and then 0 W/m² to model clouds and night; restore sunlight to recharge. These are recorded ordinary edits, not a scripted energy source. Initial SOC/capacity changes require Reset. A low-voltage protection switch may need a lower recovery threshold to start a very depleted pack; its policy remains independent of the BMS.

`solar.test.ts` covers STC fitting, withheld NOCT values, actual series/parallel MNA, nonlinear load intersections, P&O convergence and changed weather, full/empty/cold batteries, signed-current SOC integration, current trips, DC/DC balance, AC power, idle and standby, surge/overload, protection hysteresis/remote control, rollback, probes and neutral serialization. New presets have connected operating fixtures; all four examples have checked-in import files. Browser regressions select every new kind, inspect real readings and curves, and reset. The complete existing release gate is required, without relaxed reference tolerances. See `validation/solar-energy.md` for executed calibration and duration checks.

Recovery regressions run the off-grid example from 1% SOC past four simulated minutes, repeat sunlight restoration through both Enabled and irradiance edits, and solve analytically specified current-limited charging power within 0.001 W of the fitted PV maximum. They check the actual I–V intersection, converter balance and global energy ledger. A browser regression restores sunlight through live Inspector edits.

Grid-following conversion, 48 V variants, ESS coordination and the focused reliability audit are documented in [HYBRID-ENERGY.md](HYBRID-ENERGY.md).
