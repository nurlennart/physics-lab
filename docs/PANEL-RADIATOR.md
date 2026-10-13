# Hydronic panel radiator

The `panelRadiator` component is calibrated to the **Kermi therm-x2 Profil-K** compact panel radiator (article family FK0, side connections, same-side flow and return). The default size is **type 22, 600 × 1000 mm (FK0220610)**. Four further catalog sizes are variants. All manufacturer values come from Kermi's technical catalogue *Technik therm-x2 Flachheizkörper* (Kermi GmbH, Stand Februar 2018), [distributor-hosted copy](https://www.alternative-haustechnik.de/media/8d/23/30/1682398475/db-kermi-x2-fhk.pdf). No Kermi-hosted copy was found. The 2015 edition (Stand März 2015) was compared and has identical registered outputs, exponents, weights, water contents and pressure-drop lines.

## Manufacturer data

Registered EN 442 data, "Registrierte Leistungsdaten therm-x2 Profil-K / Profil-V / Profil-Vplus" (p. 22). φ_SL is the standard output per metre of length at 75/65 °C water and 20 °C air; Kermi gives Φ = φ_SL × length. Weight and water: pp. 20–21. Outputs at other conditions: "Wärmeleistung je Heizkörpermeter" (p. 24).

| Variant | Article | Type | H × L (mm) | Φ₅₀ (W) | n | Water (L) | Mass (kg) | Radiant share | 70/55/20 | 55/45/20 | 45/40/20 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| standard | FK0220610 | 22 | 600 × 1000 | 1666 | 1.2930 | 6.08 | 29.63 | 30 % | 1338 | 854 | 593 |
| type11 | FK0110610 | 11 | 600 × 1000 | 979 | 1.2721 | 3.04 | 18.06 | 35 % | 789 | 507 | 354 |
| type33 | FK0330610 | 33 | 600 × 1000 | 2236 | 1.2866 | 9.12 | 44.32 | 20 % | 1798 | 1150 | 800 |
| type22tall | FK0220910 | 22 | 900 × 1000 | 2295 | 1.3069 | 8.70 | 44.45 | 30 % | 1839 | 1168 | 808 |
| type22long | FK0220614 | 22 | 600 × 1400 | 2332 | 1.2930 | 8.52 | 40.96 | 30 % | 1873 | 1196 | 830 |

The last three columns are W at the stated flow/return/air temperatures; the 1400 mm row is the published W/m × 1.4. Article numbers follow Kermi's FK0 + type + height + length scheme and match retail listings. Types 12–33 have serial ("x2") flow: the water passes the room-side panel first, then the rear panel(s). Operating limits: 10 bar maximum operating pressure (13 bar test), 110 °C maximum operating temperature. Connections 4 × G½ internal thread.

**Pressure drop.** Kermi publishes a log–log chart, "Durchflussdiagramm" (p. 148), valid for the same-side connection of the compact radiators. It has one line for FK0 types 10/11 and one for types 12–33. The lines were read from the PDF's vector paths, not from a raster image. The chart grid was used as the coordinate system and the label leader lines as the line assignment. Results: 1.813 mbar (types 12–33) and 1.243 mbar (types 10/11) at 100 kg/h, slope 1.987 in log–log, over 35–1000 kg/h. The chart does not state a water temperature.

## Data provenance

The Inspector lists the same four categories for the selected radiator.

| Category | Content |
| --- | --- |
| Manufacturer data | Φ₅₀, n, water content, mass, radiant share, pressure and temperature limits, serial flow arrangement, pressure-drop chart lines, published outputs at other temperatures |
| Calculated from manufacturer data | K_m = Φ₅₀/ΔT₅₀ⁿ; output at any condition by Kermi's conversion formula (p. 162); nominal flow Φ₅₀/(c_p·10 K) = 143.5 kg/h for the default size |
| Fitted | Two-K pressure-drop law (K∞ = 18.6, K₁ = 1602 for types 12–33; K∞ = 12.76, K₁ = 1099 for 10/11), least squares in relative error to the chart lines over 35–1000 kg/h at 70 °C viscosity, referred to a 16 mm bore; within 1.1 % of the lines |
| Assumed | 16 cells in series; steel specific heat 450 J/(kg·K) (plain carbon steel near 50 °C, Incropera Table A.1: 434 J/(kg·K) at 300 K, 487 at 400 K); the whole listed mass, covers included, at the local water temperature; uniform local heat transfer along the flow path; the same law for water below the air temperature; reverse flow with the same characteristic; 16 mm reference bore; chart temperature 70 °C |

No value was invented where Kermi gives one. Where Kermi gives none (the steel's specific heat, the internal flow distribution, behaviour outside EN 442 conditions), the value is listed as an assumption.

## Equations

**EN 442 characteristic.** With the log-mean excess temperature

```
ΔT_ln = (T_s − T_r) / ln((T_s − T_a)/(T_r − T_a)),     ΔT₅₀ = 10 K / ln(55/45) = 49.833 K
Φ = Φ₅₀ · (ΔT_ln/ΔT₅₀)^n = K_m · ΔT_ln^n,              K_m = Φ₅₀/ΔT₅₀ⁿ
```

This is exactly Kermi's conversion method (p. 162, "logarithmisch gerechnet"; Kermi prints ΔT₅₀ as 49.83 K). In steady state the water balance closes it: ṁ·c_p·(T_s − T_r) = Φ.

**Finite inventory.** The water content and the steel are divided into N = 16 cells along the flow path. Each cell has the capacity

```
C_k = (V·ρ_ref·c_w + m_steel·c_steel) / N        (default: (6.08·4180 + 29.63·450)/16 = 2,422 J/K)
```

and the energy balance

```
C_k·dT_k/dt = ṁ·c_w·(T_{k−1} − T_k) − g·(w·T_{k−1} + (1 − w)·T_k − T_a) + P_diss/N
```

T_{k−1} is the upstream cell, or the inlet water for the first cell. P_diss = Δp·Q is the hydraulic dissipation, which heats the water.

- **Conductance.** g = K_m/N·|ΔT_m|^(n−1), uniform along the radiator. ΔT_m is the mean excess of the cells' exchange temperatures at the start of the interval.
- **Exchange temperature.** w·T_{k−1} + (1 − w)·T_k, with inlet weight w(x) = 1/x − 1/(eˣ − 1) and x = g/(ṁ·c_w). It is an exponentially fitted scheme. In steady state each cell then attenuates the excess over the air by exactly e^(−x). The chain therefore reproduces the exponential profile of a uniform heat-transfer coefficient, for which Φ = UA·ΔT_ln holds exactly. With UA = K_m·ΔT_ln^(n−1), the steady output is the EN 442 characteristic for any cell count and flow.
- **Limits of w.** w → ½ at high flow. Without flow w = 0, and every cell cools on its own temperature: C·dθ/dt = −K_m·θⁿ/N per cell.
- **No over- or undershoot.** The implicit coefficients stay non-negative because ṁ·c_w − g·w = g/(eˣ − 1) ≥ 0. Water fed above the air temperature can therefore never cool any cell below the air (discrete maximum principle).

**Time integration.** Backward Euler inside the global enthalpy-transport solve. The cell chain is affine in its inlet temperature, so radiators, pipes, the boiler, junctions and reverse flow are solved together in one linear system. The conductance and weight are evaluated once per interval from the start state (secant linearisation of the power law). This makes the method first order in time; it is exact in steady state. The energy ledger books exactly the implicit exchange that entered the cell balances. In adaptive advances, radiator cells may change by at most 0.05 K per step (the thermal network's tolerance), so warm-up fronts are resolved.

**Hydraulics.** A bidirectional two-K branch, Δp = (K₁/Re + K∞)·ρ_ref·v²/2, using the viscosity of the upstream water and a 16 mm reference bore. The radiator stores water, so it can supply a sealed loop's pressure datum (as pipes do). The boiler inlet keeps priority.

**Energy accounting.** Water and steel enthalpy are part of the water/steel storage in the energy panel. The heat output goes to the ambient ledger. Hydraulic dissipation heats the water. No correction factor is applied; the ledger residual stays at round-off level (about 10⁻⁸ J over a 30 min boiler run).

## Room boundary and future thermal spaces

The radiator exchanges heat with one air temperature, its *room air temperature* property (default 20 °C, the EN 442 reference). It is an ideal boundary of unlimited capacity. All exchange goes through `panelAirTemperature(c)` and the reported output (`duty`, W), split into radiant and convective parts by Kermi's radiant share. A future thermal space can replace that boundary with its air node and receive both parts; nothing else in the model depends on the boundary. Rooms are not simulated yet.

## Behaviour

- **Startup.** Hot water displaces cold water cell by cell. The front panel warms first, and the return stays cold until the thermal front (water plus steel, about C/(ṁ·c) ≈ 4 min at nominal flow) has passed. Output lags the water heat input, and the difference is stored.
- **Shutdown and zero flow.** The stored heat keeps flowing to the room along the same characteristic. From 70 °C the default radiator is at 33.9 °C after 30 min (1.40 MJ released). The cooling time constant at ΔT₅₀ is C/(n·Φ₅₀/ΔT₅₀) ≈ 15 min, and it lengthens as the radiator approaches the air temperature (θ^(1−n) law).
- **Low flow.** The return approaches the air temperature, and the output approaches ṁ·c·(T_s − T_a), with EN 442 heat transfer extrapolated. At 2 % of nominal flow the return is 0.1 K above the air.
- **Reverse flow.** The cells are traversed in the other direction, and the reported supply and return temperatures follow the flow. Steady output equals forward flow. Kermi rates top-in, bottom-out on one side; no derating for reversed or bottom-to-top connection is applied, because Kermi publishes none for Profil-K.
- **Changing supply temperature.** The output follows with the inventory's time constant. When the supply drops below the radiator's temperature, the stored heat flows back into the circulating water: the reported water heat input is then negative.

## Measurements and Inspector

Probes and sensors can read the supply (inlet), return (outlet) and mean water temperature, the excess temperature (mean exchange excess; ΔT_ln in steady state), the heat output to the room, the water heat input ṁ·c·(T_in − T_out), flow, inlet and outlet pressure, Δp and velocity. The Inspector shows:

- a supply/return/mean/air temperature history;
- the EN 442 curve with Kermi's published points and the live operating point, which leaves the curve only while heat is stored or released;
- the radiant and convective split, the stored heat above room air, mass flow against nominal, and Δp against the Kermi chart;
- the provenance listing.

The schematic symbol shades the 16 cells by their excess temperature.

## Example

**File → Starters & examples → Bosch boiler, ALPHA2 and Kermi radiator** ([`examples/kermi.physics.json`](../examples/kermi.physics.json)). The circuit is the Bosch Tronic Heat 3000 9 limited to one 3 kW stage, an ALPHA2-style circulator in proportional pressure (2 m), insulated 6 m supply and return pipes, the Kermi type 22 radiator, and a lockshield valve preset to 12 %, which gives about 146 kg/h (nominal 143.5 kg/h). Probes trace radiator supply, return and mean water temperature, heat output, water heat input, excess temperature, flow, boiler element input, circulator input and the energy residual. Suggested experiments:

- Advance 30 min to watch warm-up and boiler cycling.
- Lower the supply target to 45 °C.
- Open or close the lockshield valve.
- Disable the boiler and follow the cool-down.

## Calibration accuracy

[`validation/panel-radiator.md`](../validation/panel-radiator.md) is regenerated by `npm run validate:radiator`. Every row runs the complete engine against a published Kermi number or an analytic solution:

| Check | Points | Largest deviation |
| --- | --- | --- |
| Published outputs of FK0220610 at their flows (75/65/20 and 70/55, 55/45, 45/40 at 16–24 °C air) | 16 | 0.49 W (0.067 %); returns within 0.004 K |
| Every catalog size at 70/55/20 and 55/45/20 °C | 10 | 0.04 % |
| EN 442 characteristic at 2–200 % of nominal flow | 5 | 0.06 % (2 % flow, still releasing heat after 24 h) |
| Pressure drop against the chart lines, 50–600 kg/h, both groups | 10 | 0.55 % |
| Zero-flow cool-down from 70 °C against the analytic solution | 1 | 0.002 K after 30 min |
| Timestep refinement of the warm-up front, 8 → 1 s | 4 | first order (error ratios 1.77, 1.88, 1.97) |

Kermi's tables are themselves computed from the registered output and exponent (they agree with the conversion formula to rounding). Agreement with them therefore verifies the transcription, the characteristic and its reproduction by the dynamic cell model at the published flows. It is not an independent laboratory measurement. The only measured EN 442 quantities are Φ₅₀ and n themselves. No transient (warm-up or cool-down) measurement from Kermi was available. Startup and cool-down dynamics follow from the published water content and mass plus the assumptions above.

`panel-radiator.test.ts` runs in the release gate. It checks:

- the catalog data against the tables;
- published outputs and returns at their flows, and every size at 55/45/20 °C;
- the characteristic from 2 % to 200 % flow, including the exact identity: water input + dissipation = output + storage rate;
- the pressure-drop chart and the two-K law with inlet viscosity, symmetric in reverse;
- the zero-flow analytic cool-down;
- independent enthalpy reconstruction during warm-up (cells stay between air and supply temperature);
- first-order convergence and bounded 30 s steps;
- reverse flow;
- the complete example: warm-up, lower target, shutdown cool-down without undershoot, energy and mass ledgers.

The preset campaign checks each radiator preset against the characteristic and the chart at its measured operating point.

## Remaining limitations

- **No room.** The air is an ideal boundary at a fixed temperature: no air heating, no radiant exchange with surfaces, no stratification. The radiant share only splits the reported output.
- **EN 442 test conditions.** The characteristic holds for free wall mounting and same-side top-in, bottom-out connection. Niches, covers, shelves, bottom connections and reversed connections reduce the output in practice; this is not modelled.
- **Outside EN 442.** Water below the air temperature (cooling) uses the same power law. Condensation, and the different convection pattern of a cold panel, are not modelled.
- **Internal flow distribution.** It is represented by 16 mixed cells, so the shape of the warm-up front (its dispersion) is approximate. Front and rear panels are not resolved separately, beyond the cell order of the serial flow. Very low flows extrapolate the characteristic, while real radiators stratify.
- **Steel.** The steel is at the local water temperature, including covers and side panels, which in reality lag. The steel specific heat is a textbook value.
- **Pressure drop.** The chart temperature is not stated. The K₁ viscosity dependence is a model consequence, not Kermi data. Air pockets, venting and fouling are not modelled.
- **Water properties.** Constant c_p, reference density, no thermal expansion. Leaving 0–100 °C pauses the simulation.
- **Valves.** No thermostatic valve: the Profil-V/Vplus factory-preset valve inserts (kv 0.10–0.84) and TRV proportional control are not modelled. Use a manual or actuated valve in series.

The model is suitable for operating studies, heating-system experiments and measurements within these boundaries. It is not for radiator sizing beyond Kermi's own method, product certification or comfort assessment.
