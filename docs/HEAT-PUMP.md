# Air-to-water heat pump

The `heatPump` component is calibrated to the **Bosch Compress 6800i AW 7 OR-S**, an R290 monobloc outdoor unit (230 V single phase, inverter compressor). The lab component combines it with the indoor unit's **electric backup heater** (CS6800iAW 12 E). The indoor unit's own circulation pump is not part of the component, so an external circulator is required, as with the Bosch boiler.

All published values come from three Bosch documents:

| Tag | Document | Used for |
| --- | --- | --- |
| [IM] | [Installation manual AW 4\|5\|7 OR-S, 6721866761 (2023/06)](https://www.worcester-bosch.co.uk/support/literature/download/6721866761), §10.1–10.2 | EN 14511 outputs and COPs, modulation range, current, starts per hour, airflow, operating envelope, cut-out temperatures |
| [ErP] | [Energy data sheet CS6800iAW 7 ORE-S, 6721860629 (2026/02)](https://bosch-de-de.boschhc-documents.com/download/pdf/file/6721860629) | EN 14825 part-load outputs and COPd, TOL, WTOL, standby and crankcase-heater power |
| [IDU] | [Installation manual indoor unit CS6800iAW 12 E, 6721892050 (2025/04)](https://bosch-de-de.boschhc-documents.com/download/pdf/file/6721892050), §3.3, §5.2, §7, §10.1 | Nominal and defrost minimum flows, backup heater stages and overheat protection, power-on dry-run check, use of system water for defrost |

## Manufacturer data used

| Quantity | Bosch | Model |
| --- | --- | --- |
| EN 14511 maximum output / COP | A7/W35 7.97 kW / 3.07; A7/W55 7.45 / 2.64; A2/W35 7.09 / 2.83; A−7/W35 6.71 / 2.36; A−10/W35 5.86 / 2.23 [IM] | Fitted (except A2, withheld); see the [calibration report](../validation/heat-pump.md) |
| EN 14511 nominal output / COP | A7/W35 2.84 kW / 4.85; A2/W35 2.87 / 4.06 [IM] | A7 fitted; A2 withheld |
| EN 14825 part load (average climate, 55 °C application) | Tj −10 (W55) 5.2 kW / 1.83; −7 (W52) 5.9 / 2.09; +2 (W42) 3.5 / 3.49; +7 (W36) 2.5 / 4.68; +12 (W30) 1.8 / 5.75 [ErP] | +2 withheld, others fitted |
| Modulation | 1.8–7.1 kW at A2/W35 [IM] | Minimum compressor speed 26.57 % gives 1.80 kW at A2/W35 |
| Electrical | 230 V 1N AC, 16 A fuse, 13.1 A maximum and starting current, cos φ > 0.99 [IM] | Inverter input limited to 13.1 A × V × 0.99 (no inrush); constant-power load on the network |
| Standby / crankcase heater | P_SB = P_OFF = P_TO = 15 W, P_CK = 32 W [ErP] | 15 W controls whenever supplied; 32 W crankcase heater while stopped below an assumed 10 °C |
| Starts | Maximum 6 compressor starts per hour [IM] | Rolling 60-minute start budget |
| Operating envelope (heating, without booster) | Fig. 42 [IM]: flow up to 75 °C between +10 and +25 °C, falling to about 59 °C at −22 °C and 60 °C at +45 °C; lower edge 15 °C | Digitised from the PDF vector paths (corner points −22/59, 10/75, 25/75, 45/60); the compressor target is limited to it |
| Cut-out | Off at about −23 °C and +45 °C; restart above about −17 °C / below +42 °C [IM §10.2] | As published, with the hysteresis |
| Airflow | 1,670 m³/h [IM, ErP] | Coil airflow at full fan, used for frost mass transfer |
| Flows | Nominal 20 l/min (underfloor), 12.5 l/min (radiators); 14 l/min minimum during defrost [IDU] | Defrost needs 14 l/min (postponed, or aborted if the flow falls) |
| Backup heater | 3/6 kW at 230 V (9 kW only at 400 V); overheat protection above 88 °C, manual reset [IDU] | 0–2 stages of 3 kW as real V²/R resistances on BL/BN; 88 °C latched protection |
| Power-on check | Compressor and backup heater blocked for 2 minutes [IDU §7] | Applied at power-on and after every supply loss |
| Maximum temperatures and pressure | Flow 75 °C (heat pump only and with backup), 3 bar [IM, IDU] | Reported when exceeded |

## Model

### Refrigerant cycle (quasi-steady, per coupled substep)

R290 saturation pressure follows a Clausius–Clapeyron fit through 4.74 bar at 0 °C and 21.2 bar at 60 °C (NIST values): ln p = 9.874 − 2272/T. For compressor speed n (fraction of the speed at the A7/W35 maximum), outdoor air T_air and water T_w (the condenser's water cell, i.e. the flow temperature):

```
Q_e = s·K·p_sat(T_e)/T_e,  s = 1.52915·n                 refrigerant mass flow ∝ speed × suction density
UA_e,eff·(T_air − T_e) + R = Q_e                          evaporator; R = heat released by a coil warmer than T_e
UA_e,eff = 750 W/K · f_fan / (1 + m_frost/m_ref),  f_fan = 0.3 + 0.7·min(1, s)
T_c = T_w + Q_c/UA_c,  UA_c = 2000 W/K                     plate condenser
P_comp = Q_e·(T_c − T_e)/(η·T_e)                          fraction η of the reversed-Carnot cooling COP
η = η₀·(1 − k_s(s − s₀)²)·g(ln(Π/Π₀)),  Π = p_sat(T_c)/p_sat(T_e)
Q_c = Q_e + P_comp                                        all compressor and drive input reaches the refrigerant
P_el = P_comp + P_fan + 15 W controls (+ 32 W crankcase while stopped)
```

g(x) = 1 − k_Π·x² inside the fitted pressure-ratio range (|x| ≤ 0.8) and continues tangent-linearly beyond it, so the model degrades gracefully at the edge of the envelope instead of extrapolating a parabola (A−22/W59: 4.2 kW at COP 1.42). Fan power is 40 W·f_fan³. If P_el would exceed the 13.1 A limit, the speed is reduced until it does not.

**Fitting.** The heat-exchanger conductances (UA_c, UA_e) and the 40 W fan were fixed first as assumptions, so the evaporating and condensing temperatures stay physical; they drive frost formation and the pressure switches. Six coefficients (η₀ = 0.509133, k_s = 0.653893, s₀ = 0.740688, k_Π = 0.647567, Π₀ = 2.66027, K = 204,474 W·K/bar) were then fitted by coordinate search, minimising the squared relative COP error at the published outputs of nine points. The fitted points have an RMS error of 2.0 %; the largest is +5.1 % at A−10/W35. The three A2/+2 °C points are withheld: Bosch's tests there integrate defrost cycles, so they check the steady model *and* the frost model together. The maximum speed below −7 °C (95.15 % at −10 °C, held below) is back-calculated from the A−10/W35 maximum output. It represents a firmware speed limit, not physics.

Nothing in the simulation looks up a COP or a capacity. Both follow from speed, air and water temperature, frost and the electrical limit.

### Frost and defrost

The fin surface lies between T_e and the air: T_s = T_e + 0.35·(T_air − T_e) (assumed 35 % of the evaporator resistance on the refrigerant side). Frost deposits only while T_s < 0 °C, by ε-NTU mass transfer at Lewis number 1:

```
ṁ_frost = ṁ_air·ε·max(0, ω_air − ω_sat,ice(T_s)),  ε = 1 − exp(−UA_air/(ṁ_air·c_p)),  UA_air = UA_e,eff/0.65
```

ω_air comes from the component's **Outdoor relative humidity** (Magnus over water; ω_sat over ice). Frost lowers the evaporator conductance (halved at m_ref = 2 kg, assumption). That pulls T_e down, which lowers output and COP physically.

A **reverse-cycle defrost** starts when the frost reaches the trigger (0.8 kg), at least 20 min after the previous one and 2 min after a start, provided the flow is at least 14 l/min (Bosch). It can also start on a rising edge at the DEF input below 15 °C (Bosch: manual defrost below 15 °C). During defrost:

- the fan stops;
- the compressor runs at 40 % with the cycle reversed: refrigerant evaporates against the water (UA_c) and condenses in the coil;
- an expansion-valve minimum pressure ratio of 1.8 keeps a lift even when the water is warmer than the coil (assumption).

The heat delivered to the coil warms it to 0 °C, melts the frost (333.55 kJ/kg; the meltwater leaves to the environment) and then warms the coil to 10 °C. Natural convection loses heat to the air (40 W/K) throughout. The defrost ends there, after 10 minutes at most, or aborts if the water falls below 10 °C or the flow below 14 l/min. A 60 s drip time follows, with compressor and fan off. When heating resumes, the warm coil (20 kJ/K, assumption) gives its heat back to the refrigerant through 0.2·UA_e.

The heat for defrosting comes from the water, so small systems lose flow temperature sharply. The backup heater assists while the water is below 20 °C. Bosch likewise draws defrost energy from the system water and buffer, and requires a minimum system volume.

### Controller (approximation)

Bosch's firmware (degree-minute logic, adaptive defrost, low-noise modes) is not reproduced. The model controller does the following:

- **Flow target:** a fixed setpoint, or a linear heating curve from the foot point at 20 °C outdoor to the design flow at the design outdoor temperature. A wired SET input overrides both. The target is limited to the envelope at the current air temperature, with frost protection holding at least 15 °C while the water is below 5 °C.
- **Start:** when the flow is 2 K below target, after the 2-minute power-on check, a 5-minute minimum off time and within 6 starts per hour. It needs at least the minimum flow (assumed 6 l/min).
- **Modulation:** a PI controller on the flow temperature (0.1/K, Ti 600 s) commands the inverter speed between minimum and maximum, ramped at 100 % per 120 s.
- **Stop:** at minimum speed with the flow 3 K above target, after a 5-minute minimum run. This is the low-load cycling that appears when the heat demand is below the minimum modulation.
- **Protections:**
  - flow below the minimum for 10 s stops the compressor;
  - a condensing pressure above 31 bar (≈ 79.6 °C) or a low evaporating pressure (< 1.2 bar, or air more than 20 K above T_e, as with a failed fan or blocked coil) is a pressure trip that restarts automatically, until the third trip within an hour latches a lockout (manual reset);
  - undervoltage below 195 V switches the inverter and backup heater off and repeats the power-on check.
- **Backup heater:**
  - provides sole heating when the compressor cannot run (cut-out, lockout, envelope) or cannot reach the target;
  - joins bivalently after 30 min at the compressor's limit with the flow still short (stage 2 after twice the delay), staying on until the target is reached;
  - assists defrost below 20 °C water and covers frost protection;
  - never runs without flow or above 74 °C;
  - is latched off by its 88 °C overheat protection, compared with the condenser/heater node.

Faults: `failedOpen` (supply/inverter), `controlLost` and `coolingFailed` (outdoor fan stopped: natural convection only, 8 % of the conductance). The fan failure drives T_e down until the low-pressure protection locks out after three trips.

### Electrical, hydraulic and thermal integration

- **Electrical:**
  - L/N is the outdoor unit: a constant-power load (P_el planned per substep) solved by the existing constant-power iteration with its undervoltage lockout, like the circulators. A collapsed supply drops the unit and its condenser heat in the same substep.
  - BL/BN is the backup heater: real 3 kW resistances at 230 V, so their power follows V².
  - Both appear in one reading: `power` is the total, with `compressorPower` and `backupPower` separately.
- **Hydraulic:** like the boiler, the component is a branch with one fully mixed water cell (3 L, plus 4 kJ/K wetted metal) and an implicit element node (6 kJ/K, 4 kW/K to the water) that receives Q_c plus the backup heater power. Its affine outlet relation enters the global enthalpy solve, so pipes, radiators, Thermal Spaces, reverse flow and mixing are solved together. Its pressure drop uses an assumed K = 65 (about 15 kPa at 20 l/min). As a filled loop's pressure datum it uses the 1.5 bar cold-fill pressure.
- **Air side:** the outdoor air is the component's resolved ambient: experiment environment, local override, or the Thermal Space it is assigned to. A unit assigned to a room draws its evaporator heat from that room's air (an air-source heat pump indoors cools the room).
- **Time step:** the cycle is evaluated at most every 0.5 s and at every controller deadline (power-on check, minimum run/off, start budget, defrost limits, drip, backup delays, flow delay). Larger adaptive macro steps are split accordingly.
- **Rollback:** all states (speed, PI integral, coil, frost, timers, counters, element temperature) are included in the coupled-step checkpoint and rollback, and in deterministic replay.

### Energy conservation

```
electrical input P_el + backup P_b + heat from the outdoor air (Q_e − R)
  = heat into the water node Q_c + P_b
  + heat to the outdoor air (fan, controls, crankcase, meltwater, coil convection during defrost)
  + change of coil storage C_coil·ΔT_coil
```

The terms enter the existing ledger as follows:
- The water node's share enters the transport ledger.
- The outdoor-air terms enter `ambient` (negative: the environment supplies heat), or the assigned Thermal Space.
- The coil storage enters stored energy, under "Other storage Δ".

Frost holds no separate energy. Its latent heat of deposition is part of the evaporator duty, and melting returns L_f·m to the environment with the meltwater. Coupled runs close the global energy residual to about 10⁻⁴ J over hours ([report](../validation/heat-pump.md)).

## Telemetry and Inspector

Measurements (also chartable as probes):
- flow, return and effective target temperature;
- heat output (negative while defrosting);
- outdoor-unit and backup electrical power, and instantaneous COP;
- compressor speed, evaporating and condensing temperature;
- heat from the outdoor air, frost mass, defrost state;
- condenser/heater node temperature;
- heat delivered to the water flow, casing loss;
- seasonal performance factor (net heat over outdoor-unit electricity), cumulative net heat, compressor starts;
- the generic electrical, hydraulic and energy measurements.

The Inspector adds:
- the status line;
- a flow/return/target and power history;
- a characteristic table: minimum to maximum output and COP at −20…+12 °C for the current flow temperature;
- the reset button;
- the model basis, separating manufacturer data, fitted model, assumptions and omissions;
- the Bosch-versus-model table for every rating point.

## Examples

- **Heat pump and underfloor heating** (`heatPumpHouse`): 120 m² single-zone house (envelope ≈ 200 W/K, about 6 kW at −10 °C), underfloor loop as an equivalent 60 m × 32 mm pipe emitting 520 W/K into the room, heating curve 25 → 35 °C, 2 °C outdoors at 85 % RH. The coil frosts and defrosts about every 70 minutes; seasonal performance factor about 4.0. Set the environment to 12 °C and close the zone (lower the underfloor loop's thermal UA) to see low-load cycling; drop to −20 °C to meet the envelope.
- **Heat pump in a cold snap** (`heatPumpCold`): the same house at −15 °C. The compressor runs at its current limit (about 5.2 kW, COP about 2.2) and the 6 kW backup heater joins after its delay. Lower the outdoor temperature below −23 °C for the cut-out, or inject an outdoor fan failure.

## Validation

`heat-pump.test.ts` covers:
- the calibration against all Bosch points, the Carnot bound, the 13.1 A limit and monotonic trends;
- the envelope and the R290 fit;
- frost physics (none above 0 °C surface, rising with humidity, none in dry air) and the reversed cycle's energy balance;
- the EN 14511 A2 bench including defrost (±8 %);
- the power-on check at 47 W;
- energy conservation through defrosts;
- low-load cycling within 6 starts per hour and the minimum run time;
- freezing conditions with backup heater, cut-out and restart hysteresis;
- undervoltage lockout and recovery, no operation without flow, stop on circulator failure;
- fan failure through to lockout and manual reset, backup heater overheat latch;
- Thermal Space coupling, determinism and timestep agreement, both starters.

`npm run validate:heatpump` regenerates [validation/heat-pump.md](../validation/heat-pump.md): the steady model at every rating point, the EN 14511-style frost/defrost bench, three coupled scenarios (defrost, cold snap with backup, low-load cycling) with energy residuals, and a timestep comparison. The preset campaign runs both presets in an operating fixture against the ErP standby and crankcase power and the 13.1 A limit.

At A2/W35 maximum the integrated model is 2.9 % below Bosch's output and 6.9 % below its COP. At A2 nominal and +2 °C/W42 it is 2–5 % above. The steady model's own error at the A2 points is part of these differences. No manufacturer transient trace was available, so the defrost frequency (about 50–70 min at A2) and duration (1–2 min) are model results, not validated against measured defrost cycles.

## Limitations

- Bosch's control firmware, low-noise modes, SG-Ready/EVU inputs, domestic hot water, cooling, and the indoor unit's pump and 3-way valve are not modelled.
- Also absent: the drip-tray heater, refrigerant charge migration and oil return, compressor and fan harmonics, and sound.
- The cycle is quasi-steady per substep. Refrigerant-side dynamics are represented only by the condenser/heater node, the speed ramp and the coil's capacity.
- Latent heat of condensation on a wet coil above 0 °C is not separated from the sensible duty. Frost has a uniform effect on the coil, with no distribution, density change or icing of the drain.
- Above +7 °C outdoor the maximum speed is held at 100 %, so the maximum output extrapolates beyond Bosch data (about 9.6 kW at A20/W35). In practice the unit then runs at part load.
- The heating curve is linear and there is no room-temperature feedback, so a house can overheat slowly on a curve set too high.
- The internal water volume, metal capacities, hydraulic resistance, heat-exchanger conductances, fan power, coil capacity and every defrost parameter are assumptions. They are listed in the Inspector and the parameter descriptions.
