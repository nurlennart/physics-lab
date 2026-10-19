# Air-to-water heat pump

The `heatPump` component is calibrated to the **Bosch Compress 6800i AW 7 OR-S**, an R290 monobloc outdoor unit (230 V single phase, inverter compressor). The lab component combines it with the indoor unit's **electric backup heater** (CS6800iAW 12 E). The indoor unit's own circulation pump is not part of the component, so an external circulator is required, as with the Bosch boiler.

All published values come from three Bosch documents:

| Tag | Document | Used for |
| --- | --- | --- |
| [IM] | [Installation manual AW 4\|5\|7 OR-S, 6721866761 (2023/06)](https://www.worcester-bosch.co.uk/support/literature/download/6721866761), §10.1–10.2 | EN 14511 outputs and COPs, modulation range, current, starts per hour, airflow, operating envelope, cut-out temperatures |
| [ErP] | [Energy data sheet CS6800iAW 7 ORE-S, 6721860629 (2026/02)](https://bosch-de-de.boschhc-documents.com/download/pdf/file/6721860629) | EN 14825 part-load outputs and COPd, TOL, WTOL, standby and crankcase-heater power |
| [FIELD] | [heatpumpmonitor.org](https://heatpumpmonitor.org/) system #920: Bosch Compress 5800i AW **4 kW** (same R290 outdoor-unit family), Zagreb, radiators; class-1 electricity and class-2 heat meters, 10 s data; weather from the Open-Meteo archive (CC BY 4.0). Extract: [validation/heat-pump-field.json](../validation/heat-pump-field.json) | Measured defrost durations, energies, intervals, flow dips, COP drift and multi-hour COP |
| [OWN] | [Bosch/Buderus heat pump owners' documentation](https://bosch-buderus-wp.github.io/en/docs/technical-design/) (community, not Bosch) | Intensive defrost every 5th cycle from software 9.10.0, 9–16 min; measured standby and crankcase-heater power |
| [IDU] | [Installation manual indoor unit CS6800iAW 12 E, 6721892050 (2025/04)](https://bosch-de-de.boschhc-documents.com/download/pdf/file/6721892050), §3.3, §5.2, §7, §10.1 | Nominal and defrost minimum flows, backup heater stages and overheat protection, power-on dry-run check, use of system water for defrost |

## Manufacturer data used

| Quantity | Bosch | Model |
| --- | --- | --- |
| EN 14511 maximum output / COP | A7/W35 7.97 kW / 3.07; A7/W55 7.45 / 2.64; A2/W35 7.09 / 2.83; A−7/W35 6.71 / 2.36; A−10/W35 5.86 / 2.23 [IM] | Fitted (except A2, withheld); see the [calibration report](../validation/heat-pump.md) |
| EN 14511 nominal output / COP | A7/W35 2.84 kW / 4.85; A2/W35 2.87 / 4.06 [IM] | A7 fitted; A2 withheld |
| EN 14825 part load (average climate, 55 °C application) | Tj −10 (W55) 5.2 kW / 1.83; −7 (W52) 5.9 / 2.09; +2 (W42) 3.5 / 3.49; +7 (W36) 2.5 / 4.68; +12 (W30) 1.8 / 5.75 [ErP] | +2 withheld, others fitted |
| Modulation | 1.8–7.1 kW at A2/W35 [IM] | Minimum compressor speed 26.57 % gives 1.80 kW at A2/W35 |
| Electrical | 230 V 1N AC, 16 A fuse, 13.1 A maximum and starting current, cos φ > 0.99 [IM] | Inverter input limited to 13.1 A × V × 0.99 (no inrush); constant-power load on the network |
| Standby / crankcase heater | P_SB = P_OFF = P_TO = 15 W, P_CK = 32 W [ErP]; 70–85 W heater on-power measured on the 4/5/7 units [OWN] | 15 W controls whenever supplied; a 75 W crankcase heater cycled by a compressor-shell thermostat (shell 10 ± 1 K above the air, 3.2 W/K loss, assumption) while stopped below an assumed 10 °C: its average equals the 32 W ErP value |
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
P_el = P_comp + P_fan + 15 W controls (+ 75 W crankcase heater, thermostat-cycled while stopped)
```

g(x) = 1 − k_Π·x² inside the fitted pressure-ratio range (|x| ≤ 0.8) and continues tangent-linearly beyond it, so the model degrades gracefully at the edge of the envelope instead of extrapolating a parabola (A−22/W59: 4.2 kW at COP 1.42). Fan power is 40 W·f_fan³. If P_el would exceed the 13.1 A limit, the speed is reduced until it does not.

**Fitting.** The heat-exchanger conductances (UA_c, UA_e) and the 40 W fan were fixed first as assumptions, so the evaporating and condensing temperatures stay physical; they drive frost formation and the pressure switches. Six coefficients (η₀ = 0.509133, k_s = 0.653893, s₀ = 0.740688, k_Π = 0.647567, Π₀ = 2.66027, K = 204,474 W·K/bar) were then fitted by coordinate search, minimising the squared relative COP error at the published outputs of nine points. The fitted points have an RMS error of 2.0 %; the largest is +5.1 % at A−10/W35. The three A2/+2 °C points are withheld: Bosch's tests there integrate defrost cycles, so they check the steady model *and* the frost model together. The maximum speed below −7 °C (95.15 % at −10 °C, held below) is back-calculated from the A−10/W35 maximum output. It represents a firmware speed limit, not physics.

Nothing in the simulation looks up a COP or a capacity. Both follow from speed, air and water temperature, frost and the electrical limit.

### Frost and defrost

The fin surface lies between T_e and the air: T_s = T_e + 0.35·(T_air − T_e) (assumed 35 % of the evaporator resistance on the refrigerant side). Frost deposits only while T_s < 0 °C, by ε-NTU mass transfer at Lewis number 1:

```
ṁ_frost = ṁ_air·ε·max(0, ω_air − ω_sat,ice(T_s)),  ε = 1 − exp(−UA_air/(ṁ_air·c_p)),  UA_air = UA_e,eff/0.65
```

ω_air comes from the component's **Outdoor relative humidity** (Magnus over water; ω_sat over ice). Frost lowers the evaporator conductance (halved at m_ref = 5 kg, assumption: −29 % at the defrost trigger). That pulls T_e down, which lowers output and COP physically.

A **reverse-cycle defrost** starts when the frost reaches the trigger (2 kg), at least 20 min after the previous one and 2 min after a start, provided the flow is at least 14 l/min (Bosch). It can also start on a rising edge at the DEF input below 15 °C (Bosch: manual defrost below 15 °C). During defrost:

- the fan stops;
- the compressor runs reversed: refrigerant evaporates against the water (UA_c) and condenses in the coil;
- an expansion-valve minimum pressure ratio of 1.8 keeps a lift even when the water is warmer than the coil (assumption).

The heat delivered to the coil does the following, in order:
1. It warms the **defrost-heated capacity** (25 kJ/K: fins and tubes plus the refrigerant inventory and base pan in contact) to 0 °C.
2. It melts the frost (333.55 kJ/kg).
3. It warms that capacity further.

Meanwhile 100 W/K of natural convection loses heat to the air. **30 % of the meltwater is retained** on the fins and in the base pan. While the coil is above 0 °C, this film evaporates into the air (Lewis analogy with the same conductance: the vapour and its 2.47 MJ/kg leave to the environment), which dries the coil and bounds its temperature while wet. Whatever remains at the end of a defrost **refreezes in the base pan** below the coil. It costs energy later but does not block the airflow.

The two defrost types end as follows:

- **Normal defrost** (40 % speed) ends when the frost is melted and the coil reaches 10 °C. The termination sensor reacts once the ice is gone and does not wait for a dry coil.
- **Intensive (hot-gas) defrost**, every 5th cycle (Bosch firmware from 9.10.0, [OWN]), runs at 60 % speed (from the measured 1.19 kW vs 0.78 kW). It also melts the base-pan ice, and ends once all ice is gone, the coil has reached 20 °C and at least 9 minutes have passed (Bosch: 9–16 min). A hot-gas guard slows the compressor 15 K above that temperature.

Limits common to both:
- They time out after 10 or 20 minutes respectively.
- They abort if the flow falls below 14 l/min.
- Freeze protection of the plate exchanger: they abort if the refrigerant evaporating against the water would fall below +2 °C, or the water below 5 °C. The measured 7–11 °C dips are therefore allowed.

A 60 s drip time follows, with compressor and fan off. When heating resumes, the warm coil gives its heat back to the refrigerant through 0.2·UA_e.

The heat for defrosting comes from the water, so small systems lose flow temperature sharply. The backup heater assists while the water is below 20 °C. Bosch likewise draws defrost energy from the system water and buffer, and requires a minimum system volume. The starter **Heat pump with a buffer tank** adds a 123 l Bosch BH 120-5 in series in the return: the lowest flow temperature during defrost rises by about 2 K (see [STORAGE-AND-PRESSURE.md](STORAGE-AND-PRESSURE.md)).

### Defrost calibration against field data

The defrost was first set from assumptions only (0.8 kg trigger, 20 kJ/K coil, 40 W/K convection, no intensive cycle). A measured Bosch 5800i [FIELD] showed it far too mild per event and too frequent. The recalibration uses physical parameters and termination conditions only; no thermal output is prescribed.

**Size difference.** The field unit is the 4 kW size of the same R290 outdoor-unit family (same housing, coil family and 0.95 kg charge; 1,160 vs 1,670 m³/h airflow). This determines how each result can be compared:
- Per-defrost duration and energy are set by coil, frost load and firmware, so they are compared directly.
- Intervals depend on load and humidity, so they are compared with the real weather: the Open-Meteo archive agrees with the site's sensor to +0.2 K mean, 1.7 K s.d.
- COP depends on size, so it is reported, not fitted. Bosch's own tables differ by only about 3 % between the sizes at equal output (A2/W35 nominal: 3.94 at 2.09 kW vs 4.06 at 2.87 kW).

**Heat-meter spikes.** 76 of 120,961 samples exceed ±12 kW, impossible through a 4 kW unit's plate exchanger. They are dropped, and every event energy is also recomputed independently as ρ·c·q·ΔT from flow rate and temperatures; the two agree within about 10 %.

**Humidity.** The site has no humidity sensor, so the archive's hourly relative humidity (median 87 % over the period, 94 % in the 48 h window) drives the model. The frost-growth model itself remains unvalidated in isolation.

**Not overfitting one installation.** Each parameter is tied to a physical quantity and changed only where the data required it:
- **Frost trigger (0.8 → 2 kg) and defrost-heated capacity (20 → 25 kJ/K)** are the only jointly fitted pair. They are identifiable from two independent measurements: the interval (frost mass at the given humidity) and the heat per defrost (sensible warming from about −12 °C plus melting).
- **The normal end temperature stays 10 °C.** A trial at 15 °C stalled on the evaporating film and was rejected.
- **Convection (100 W/K), the retained-meltwater share and the intensive speed** are set from physical estimates or the measured electrical input.
- **Intensive defrost energy is predicted, not fitted.**

| Result | Model (7 kW) | Measured (4 kW) | Class |
| --- | ---: | ---: | --- |
| Defrosts in a 48 h window, −10…+2 °C, RH median 94 % (intensive) | 14 (2) | 14 (2) | calibrated (trigger) |
| Interval (min) | 168 | 207 (14-day median 204, IQR 148–260) | calibrated |
| Normal defrost duration (min) | 3.8 | 4.8 (IQR 4.2–6.0) | calibrated; about 20 % short |
| Normal defrost heat from the water (kWh) | 0.27 | 0.37 (IQR 0.23–0.45) | calibrated; within IQR |
| Intensive defrost duration (min) / heat (kWh) | 9.0 / 0.83 | 10.7 / 0.84 (IQR 9–15 / 0.58–1.0) | firmware minimum / **predicted** |
| Defrost electrical input (W), normal / intensive | 600–870 / about 1,250 | 784 / 1,190 | consistent (not fitted) |
| Flow dip during defrost (K), normal / intensive | 7 / 15 (60 L assumed) | 12 / 21 | installation-dependent, **unvalidated** |
| COP over 48 h including defrost | 3.58 | 2.97 | **extrapolated**: lab-calibrated cycle; field meters include the indoor pumps (≈5 %); typical lab-to-field gap |
| COP drift over a frost cycle (fixed speed) | about −2 % | −11.5 % median (confounded by control and weather drift) | **unresolved** |
| Crankcase heater: on-power / average | 75 W / 32 W | 70–85 W [OWN] / 32 W [ErP] | measured / manufacturer |

Bosch's EN 14511 A2 ratings were **not** used in this recalibration and serve as an independent check. Integrated over complete five-cycle groups, they are:
- A2 nominal: +1.7 % output, +2.9 % COP;
- +2 °C/W42: +1.0 % / +1.6 %;
- A2 maximum: −4.7 % / −8.2 %.

The previous assumption-only defrost gave −2.9 % / −6.9 % at A2 maximum, but with 35 instead of 14 defrosts in the field window. With the 0.8 kg trigger and the measured energy per defrost, the A2 maximum point fell to −16 %. The remaining −8.2 % may come from Bosch's EN 14511 test window and defrost initiation, which are not published, or from the frost-growth rate at full airflow. It is reported, not tuned away.

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
- **Hydraulic:** like the boiler, the component is a branch with one fully mixed water cell (3 L, plus 4 kJ/K wetted metal) and an implicit element node (6 kJ/K, 4 kW/K to the water) that receives Q_c plus the backup heater power. Its affine outlet relation enters the global enthalpy solve, so pipes, radiators, Thermal Spaces, reverse flow and mixing are solved together. Its pressure drop uses an assumed K = 65 (about 15 kPa at 20 l/min). As a filled loop's pressure datum it uses the 1.5 bar cold-fill pressure, unless an expansion vessel is fitted. The starters include the indoor unit's 17 l vessel (0.75 bar precharge, filled to 1.3 bar) and its 3 bar safety valve, so the circuit pressure follows the water temperature.
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

### Hot-water mode and the 3-way valve VW1

The indoor unit switches between heating and a hot-water cylinder with its motorised 3-way diverting valve VW1 and decides by the cylinder sensor TW1. In the lab, wire a temperature sensor on the cylinder to the heat pump's **TW1** input and its **VW1** output to a `divertingValve` (AB from the heat pump, A to the heating, B to the cylinder coil), and enable *Hot-water mode*.

- **Start and stop:** a charge starts when TW1 falls to the start temperature and ends at the stop temperature. Bosch ranges [OWN]: Comfort start ≥ 40 °C / stop ≤ 65 °C, Eco 35/60 °C, Eco+ 30/55 °C. The defaults (start 40 °C, stop 48 °C) are the owners' documentation's example, not a stated Bosch default.
- **Flow target:** the cylinder temperature plus the charging differential (*Ladedelta*, Bosch range 4–18 K, default 7 K) [OWN], so the flow and condensing temperatures rise with the cylinder, and the COP falls. Envelope and 75 °C limits apply; the backup heater can join as in heating.
- **Priority:** hot water before heating; the heating gets no flow while VW1 is at B. A charge also runs with heating disabled (summer).
- **Time limit (assumption):** a charge still running after the maximum hot-water time (60 min) ends and waits the same time, so the house recovers. Bosch's own limit is not published for the 6800i.
- **Defrost:** a defrost during a charge keeps VW1 at B and draws its heat from the cylinder, as Bosch describes for small systems.
- **Valve:** the plug travels at a fixed running time (assumed 15 s for the full stroke, Kvs 6 per path), springs back to A on a lost signal, and a lost VW1 command (controller fault) returns it to A.

The flow, start and stop logic of the compressor are unchanged; hot water only changes the target and the demand. Measurements: `hotWater` (VW1 at B) and `hotWaterCop` (heat over electricity while charging).

In the house example at 2 °C the cylinder starts at 38 °C: the charge to 48 °C takes about 33 minutes with a performance factor of about 2.6, against a heating COP of about 4.1 falling to 3.3 afterwards as the flow target rises. The underfloor screed keeps heating the house meanwhile, so it does not cool (with the former equivalent pipe it cooled by about 0.6 K).

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

- All heat-pump examples include the 3-way valve VW1, a Bosch WH 290 cylinder with its TW1 sensor, the indoor unit's 17 l expansion vessel and its 3 bar safety valve. The house and buffer examples start with the cylinder at 38 °C (an immediate hot-water charge); the cold snap starts it charged.
- **Heat pump and underfloor heating** (`heatPumpHouse`): 120 m² single-zone house (envelope ≈ 200 W/K, about 6 kW at −10 °C), wet-screed [underfloor heating](UNDERFLOOR-HEATING.md) under the whole floor (FLOORTEC tacker 16 × 2, 100 mm spacing, twelve 100 m loops) on a slab on the [ground](GROUND.md) (fixed 10 °C, an assumption; about 0.5 kW down into the ground at 2 °C), heating curve 25 → 35 °C, 2 °C outdoors at 85 % RH. Indoor pipes, cylinder and floor belong to the house. The coil frosts and defrosts about every 3 hours (every 5th an intensive cycle); performance factor over the first 6 h, hot-water charge included, about 3.5. Set the environment to 12 °C and, after Reset, reduce the floor's heated area (15 m² ≈ 60 W/K) to see low-load cycling; drop to −20 °C to meet the envelope.
- **Heat pump in a cold snap** (`heatPumpCold`): the same house at −15 °C. The compressor runs at its current limit (about 5.4 kW, COP about 2.1). The floor starts at 33 °C; the compressor alone holds 20 °C for about 7 h while the screed covers the shortfall, the house then cools slowly and the backup heater first joins after about 11 h (12 h: 1.5 kWh backup heat, house 19.6 °C). Lower the outdoor temperature below −23 °C for the cut-out, or inject an outdoor fan failure.

## Ground model effect

The starters put the house slab on the [ground](GROUND.md): a fixed 10 °C boundary (an assumed annual mean, not a site value) with the soil's EN ISO 13370 resistance (1.44 m²·K/W) under the loop's R_u of 2.6 m²·K/W, so 4.04 m²·K/W in total. Before, the floor element faced the outdoor air through R_u alone. `npm run validate:heatpump` runs the same scenarios both ways, with no other change (section 3 of [heat-pump.md](../validation/heat-pump.md)). The floor-on-outdoor-air rows reproduce the previous release's figures exactly.

| Scenario | Floor on | Downward floor loss | Net heat | Outdoor-unit electricity | Backup heat | SPF (outdoor unit) | House air at the end |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| House, 2 °C, 6 h | outdoor air (before) | 6.87 kWh (1.15 kW) | 31.87 kWh | 9.50 kWh | 0.03 kWh | 3.36 | 20.86 °C |
| House, 2 °C, 6 h | ground, 10 °C | 3.05 kWh (0.51 kW) | 29.98 kWh | 8.57 kWh | 0.03 kWh | 3.50 | 21.02 °C |
| Cold snap, −15 °C, 12 h | outdoor air (before) | 24.69 kWh (2.06 kW) | 60.98 kWh | 28.98 kWh | 9.72 kWh | 2.10 | 18.91 °C |
| Cold snap, −15 °C, 12 h | ground, 10 °C | 7.32 kWh (0.61 kW) | 60.69 kWh | 28.98 kWh | 1.50 kWh | 2.09 | 19.65 °C |

- **Heat demand.** At 2 °C the floor's downward loss falls by 56 % (1.15 → 0.51 kW). The heat the heat pump has to deliver over 6 h falls by 6 %, and its electricity by 10 %. Envelope and ventilation losses are unchanged, slightly higher only because the house is a little warmer. At −15 °C the downward loss falls from 2.06 to 0.61 kW. That 1.45 kW is about a fifth of the previous whole-house load of 7.5 kW.
- **SPF.** At 2 °C the SPF rises from 3.36 to 3.50, because a lower load runs the compressor at lower speed and flow temperature. In the cold snap the compressor is at its limit in both cases, so its SPF stays at 2.1. What changes is the backup heater: 9.72 → 1.50 kWh in 12 h. The whole-system factor (heat including backup over all electricity) rises from 1.83 to 2.04, and the backup first runs after about 11 h instead of 4.8 h.
- **Mild day** (12 °C, 15 m² heated): the unheated 105 m² of slab now loses to the ground through the ISO 13370 U-value (0.230 W/(m²·K), 0.70 kWh in 3 h), where it used to lose to the outdoor air through 0.35 W/(m²·K). Cycling is unchanged in kind: 3 starts, shortest run 780 s, SPF 3.43.
- **Caveats.** A fixed 10 °C is the annual-mean boundary of ISO 13370's steady method. In winter the real heat flow into the ground is above that steady value (most of all one to two months after the coldest weather, when the soil near the edges has cooled), and in summer it is below it. These winter figures therefore understate the ground loss somewhat and are not a seasonal prediction. A building with a basement, edge insulation or a different soil would differ.

## Validation

`heat-pump.test.ts` covers:
- the calibration against all Bosch points, the Carnot bound, the 13.1 A limit and monotonic trends;
- the envelope and the R290 fit;
- frost physics (none above 0 °C surface, rising with humidity, none in dry air) and the reversed cycle's energy balance;
- the EN 14511 A2 bench with the production controller over complete five-cycle groups (±8 % nominal, ±10 % maximum);
- intensive defrost every 5th cycle, base-pan ice cleared, reverse heat flow and plate-exchanger freeze margin;
- an engine run at the measured field conditions against the measured defrost energy, duration and interval ranges;
- the power-on check at 90 W (75 W crankcase heater on a cold shell) and the 32 W duty-cycled crankcase average;
- energy conservation through defrosts;
- low-load cycling within 6 starts per hour and the minimum run time;
- freezing conditions with backup heater, cut-out and restart hysteresis;
- undervoltage lockout and recovery, no operation without flow, stop on circulator failure;
- fan failure through to lockout and manual reset, backup heater overheat latch;
- Thermal Space coupling, determinism and timestep agreement, both starters.

`npm run validate:heatpump` regenerates [validation/heat-pump.md](../validation/heat-pump.md). It covers:
- the steady model at every rating point;
- the EN 14511-style frost/defrost bench;
- three coupled scenarios (defrost, cold snap with backup, low-load cycling) with energy residuals;
- a timestep comparison;
- the 48 h field replay against the measured 5800i.

The preset campaign runs both presets in an operating fixture against the standby and crankcase power and the 13.1 A limit.

See *Defrost calibration against field data* above for the measured comparison and its classification. No Bosch laboratory transient trace was available; the field data come from one installation of the 4 kW size.

## Limitations

- Bosch's control firmware, low-noise modes, SG-Ready/EVU inputs, hot-water time programmes, extra hot water, thermal disinfection, cooling, and the indoor unit's pump are not modelled. Hot-water mode follows the published start/stop/charging-differential logic; its time limit is an assumption.
- Also absent: the drip-tray heater, refrigerant charge migration and oil return, compressor and fan harmonics, and sound.
- The cycle is quasi-steady per substep. Refrigerant-side dynamics are represented only by the condenser/heater node, the speed ramp and the coil's capacity.
- Latent heat of condensation on a wet coil above 0 °C is not separated from the sensible duty. Frost has a uniform effect on the coil, with no distribution, density change or icing of the drain.
- Above +7 °C outdoor the maximum speed is held at 100 %, so the maximum output extrapolates beyond Bosch data (about 9.6 kW at A20/W35). In practice the unit then runs at part load.
- The heating curve is linear and there is no room-temperature feedback, so a house can overheat slowly on a curve set too high.
- The internal water volume, metal capacities, hydraulic resistance, heat-exchanger conductances and fan power are assumptions. The defrost parameters are physical assumptions, two of them calibrated to one field installation of the 4 kW size. All are listed in the Inspector and the parameter descriptions.
- The Bosch indoor pump's defrost boost (about 8 → 16 l/min in the field data) is not modelled; the external circulator does not respond to the heat pump.
- The compressor shell temperature is a control state of the crankcase thermostat; its sensible heat is not a separate ledger store (the heater's input is booked to the air when drawn).
