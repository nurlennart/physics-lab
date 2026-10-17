# Electric central heating boiler

The `electricBoiler` component is calibrated to **Bosch Tronic Heat 3000 9**, a central heating boiler sold **without an internal pump or expansion vessel**. It is not the domestic-hot-water Tronic 3000, nor the pump-equipped Heat 3500. The reference is Bosch's [German installation/service manual 6720859226, September 2018](https://bosch-de-de.boschhc-documents.com/download/pdf/file/6720859226), especially §§2.13, 2.18–2.19, 5.1, 6.2.1 and 7. This reference replaces the initially investigated Vaillant eloBLOCK, which includes a pump.

## Published specifications and calibration

| Quantity | Bosch TH3000 9 | Model |
| --- | --- | --- |
| Electrical elements / stages | Three 3 kW rods, three stages | Three independent phase-to-neutral resistors, 17.6333 Ω each |
| Supply | 400/230 V three-phase or bridged 230 V single-phase, −10/+6%, 50 Hz | Explicit AC circuits; real solved terminal voltages and feeder losses |
| Current | 13.1 A per phase; 39.2 A single-phase | At 230 V: 13.0435 A per element, plus assumed 0.0130 A electronics on L1; bridged total 39.1435 A. Within 0.5% of published ratings |
| Internal water | 3.7 L | 3.7 kg at the hydraulic solver's 1,000 kg/m³ reference density; exact configured volume |
| Heat output | 8.91 kW | Nominal electrical input 9 kW minus shell loss. At the illustrative 70/20 °C water/ambient point, 90 W loss gives 8.91 kW steady useful output |
| Maximum total electrical consumption | 9.1 kW | 9.003 kW nominal including assumed 3 W electronics; the separately selected pump draws its own network power |
| Maximum operating water temperature | 85 °C | Target limited to 85 °C; exceeding the operating rating is reported, never temperature-clipped |
| STB / reset | Trips above 95 °C; cool to approximately 70 °C before manual release | Separate 95 °C water limiter; latched and manually reset at ≤70 °C |
| Hysteresis | SE04 range 3–15 K; default 7 K | Default 7 K; restart at target minus hysteresis |
| Minimum flow | 130 L/h | Threshold for an optional modeled flow interlock |
| Pressure / connections | 0.6 bar minimum, 3 bar maximum; G¾ flow/return | 3 bar rating; 20 mm modeled bore and assumed loss coefficient. Pressure-switch, relief discharge and fittings are not reproduced |

The manual also gives 99.7% efficiency. The model does **not** multiply terminal watts by a claimed fixed efficiency: Joule heat becomes stored heat, useful water enthalpy, or shell/auxiliary heat to ambient. The illustrative useful-output agreement at 70/20 °C is not a manufacturer test-condition claim or an independent validation of the assumed shell UA. At another temperature, losses and useful output change. Likewise the 9.1 kW maximum is a supply-sizing boundary, not a forced operating consumption. At exactly 400 V line-to-line (230.94 V per phase), the resistors draw 9.074 kW; 400/230 V are rounded nominal mains ratings. Power is allowed to follow voltage squared.

## Circuit and controls

Wire L1, L2 and L3 to three `sourceAC` components at 0°, −120° and +120°, with their neutrals joined to N. Alternatively bridge all three live terminals to one 230 V AC source and use a supply rated for the combined current. The existing balanced `source3` equivalent cannot express individual, unbalanced rod switching; the component rejects that connection with wiring guidance. This uses the existing complex MNA solver without a second electrical solver. Per-phase feeder resistors, cables, fuses, breakers, meters, contactors and terminal voltage probes remain usable. PE is an isolated chassis terminal carrying no normal current; earth leakage, touch voltage and RCD trips are not modeled.

Heating stages are real resistances expanded using the same multi-circuit architecture as contactors and transformers. All terminal electrical power is booked once. Electronics use a nominal 3 W resistor on L1–N, dissipating to ambient (an assumption, not Bosch data). Their consumption also varies with voltage. A limiter trip isolates the elements and electronics internally while terminal voltages can still be measured.

`enable` accepts a Boolean demand, otherwise the Enabled property applies. `setpoint` accepts a temperature in °C, otherwise the supply target property applies. Invalid wired controls fail off. A rising edge on `reset`, or the Inspector's manual-reset button, releases a latch only when its reset conditions hold; a permanently high input cannot automatically reset successive trips. Reset actions use the existing replay input format.

The controller implements the documented sequential on/off operating mode, rather than claiming to reproduce Bosch firmware. Below target minus hysteresis it requests the selected maximum stages (0–3); at target it requests zero. Stage changes are separated by an assumed 2 s, and a new heating cycle waits an assumed 10 s after the last stage opens. User disable, lost controls and protection remove heating immediately. Stage transitions split integration intervals on simulation time; no wall-clock timers are used. The optional flow switch has a 5 s proving delay. Every phase must exceed the assumed 180 V lockout before operation; recovery requires 2 s of healthy supply plus the ordinary restart inhibit. Loaded voltage collapse removes the load and locks it out, preventing off/on oscillation in one circuit solve.

The `stuckClosed` fault welds ordinary heating regulation, leaving the independent water limiter operational. `failedOpen` removes electrical power; `controlLost` disables demand. Pump faults use the existing circulator fault model. Clearing a fault never releases an existing boiler protection latch. The optional flow switch is **not** Bosch's pressure switch or its temperature-rate retry protection.

## Thermal model and numerical method

Water is one fully mixed inventory at temperature T_w; wetted steel is lumped at T_w. The immersed elements have a separate temperature T_e. Default assumptions:

- Water heat capacity: 3.7 × 4,180 = 15,466 J/K, using the shared constant-cp water model.
- Wetted steel heat capacity: 3,500 J/K; elements: 1,500 J/K. These describe only thermally active material, not the whole 17.8 kg appliance casing.
- Element-to-water conductance G = 1,200 W/K; shell-to-ambient UA = 1.8 W/K.
- Bore 20 mm, turbulent minor-loss coefficient K = 8 and low-Re coefficient K₁ = 1,500. No manufacturer hydraulic-curve fit is claimed.

The equations are

```
C_e dT_e/dt = P_elements − G(T_e − T_w)
C_w dT_w/dt = G(T_e − T_w) + ṁ cp(T_in − T_w)
              − UA(T_w − T_ambient) + hydraulic_dissipation
C_w = m_water cp + C_steel
```

The element equation is eliminated algebraically from the **backward-Euler** water equation. The resulting affine outlet relation is stamped into the existing global enthalpy/mixing solve. Consequently water transport, pipe inventories, radiators, reverse flow and parallel mixing are solved together. The same implicit temperatures book losses and storage. No outlet temperature is prescribed, no power is capped to create a target temperature, and no temperature-dependent energy correction is applied.

At zero flow the same two thermal states continue to integrate. Electrical input heats the inventory and steel; shell losses continue; useful exported heat is zero. Ordinary regulation normally cycles safely at zero flow. A welded regulator overheats the water and trips the STB. After a trip or shutdown, stored element heat continues flowing into water: the temperature can keep rising briefly. An optional interlock can instead latch on insufficient circulation. The shared transport ledger includes the elements' stored energy as well as water/steel; auxiliary consumption goes to ambient. Fixed branch mass is constant, so it cancels from the mass-residual change, while all transported mass still satisfies node continuity.

Filled hydraulic loops previously fixed every node to zero pressure when there was no tank. This was incompatible with closed-loop continuity. They now use one pressure datum per filled island; the other node pressures follow the shared hydraulic solve. Boiler loops prefer the boiler inlet and use the configurable 1.5 bar cold-fill datum. It represents an **external, precharged, compliant expansion connection**, with no mass source or drain. Other filled pipe loops use a zero gauge reference. This is an incompressible approximation; an expansion vessel is not silently included inside the boiler. Fitting an `expansionVessel` in the circuit replaces this datum: the vessel's gas cushion then sets the pressure, which rises with the circuit's thermal expansion, and a `safetyValve` can discharge (see [STORAGE-AND-PRESSURE.md](STORAGE-AND-PRESSURE.md)). The boiler starters include a 12 l vessel and a 3 bar safety valve. Loops containing finite vented tanks retain those physical boundaries. Weir overflow routing still requires a receiving finite-tank group.

Both boiler states and controller memory are included in rejected coupled-step rollback. Boiler integration intervals are at most 0.1 s, including adaptive advances, and split at switching/restart deadlines. This bounds threshold-crossing error and ordinary thermostat lag without clamping results. The model uses the liquid-water range 0–100 °C; leaving it pauses with a diagnostic instead of hiding boiling through a temperature cap.

## Operating the example

Open **File → Starters & examples → Bosch boiler and ALPHA2 heating loop**, or import [`examples/boiler.physics.json`](../examples/boiler.physics.json). The sealed water circuit is boiler → insulated supply → panel radiator → balancing valve → insulated return → external ALPHA2-style circulator → boiler. The radiator uses natural convection with a chosen 100 W/K conductance; its optional DC fan is unpowered. The pump is the existing 230 V, 6 m circulator with proportional-pressure control.

A numeric **Supply target** block sets 60 °C. Probe traces show supply, return, element temperature, element input, active stages, flow, pump input, radiator output and total energy residual. The boiler Inspector includes phase voltages/currents, operating/fault state, automatic temperature history, reset control and source/assumption notes. Advance 10 min to observe cycles, lower the target or stage limit, and throttle the valve. Inject a circulator motor failure to test the optional flow latch. Restore circulation before manually resetting. Disable the flow interlock and weld boiler regulation to investigate the independent STB.

The starter **Bosch boiler, ALPHA2 and Kermi radiator** uses the same boiler, limited to one stage, with the datasheet-calibrated Kermi therm-x2 panel radiator instead of the generic radiator; see [PANEL-RADIATOR.md](PANEL-RADIATOR.md).

## Validation and remaining limits

`boiler.test.ts` independently checks published line currents, 3 × 3 kW loading, V²/R and feeder drop; analytical two-body warm-up; hysteresis and stage timing across timesteps; zero-flow STB and hot-reset refusal; optional flow protection and pump failure; normal closed-loop heat delivery; undervoltage recovery; and conservation through startup and shutdown. The component-preset campaign exercises its catalog preset and checks the energy and mass ledgers. Browser coverage checks selection, measurements, temperature history, reset and example import/reload. The full repository release gate remains required. Run `npm run validate:boiler` to regenerate the [calibration snapshot](../validation/boiler.md), including the analytical formula and measured current, temperature and energy errors. The energy panel separates water/steel storage from immersed-element storage. Paused transport previews preserve both temperatures exactly.

No manufacturer transient laboratory trace was available. Water volume, stage powers, ratings and safety temperatures match the published data; steel/element heat capacities, UA, bore resistance, electronics consumption and controller delays remain engineering approximations. The model omits stratification inside the boiler, local sheath hot spots, boiling/steam, scale buildup, variable-cp enthalpy, compressibility, the low-pressure switch (expansion vessel and safety valve are separate components), proprietary adaptive/PID regulation, frost protection, anti-seize cycles, pump relay/run-on and DHW priority. It is suitable for system operation, measurements and fault investigation within these stated boundaries, not installation design or product certification.
