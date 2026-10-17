# Heat pump calibration and validation

Reference: Bosch Compress 6800i AW 7 OR-S (R290). Sources: [Bosch installation manual AW 4|5|7 OR-S, 6721866761 (2023/06)](https://www.worcester-bosch.co.uk/support/literature/download/6721866761), [Bosch energy data sheet CS6800iAW 7 ORE-S, 6721860629 (2026/02)](https://bosch-de-de.boschhc-documents.com/download/pdf/file/6721860629), [Bosch installation manual indoor unit CS6800iAW 12 E, 6721892050 (2025/04)](https://bosch-de-de.boschhc-documents.com/download/pdf/file/6721892050). Model and assumptions: [HEAT-PUMP.md](../docs/HEAT-PUMP.md). Regenerate with `npm run validate:heatpump`.

## 1. Steady cycle at the published points

The published heat output is imposed (compressor speed solved); the model's frost-free COP is compared with Bosch. Six cycle coefficients were fitted to the nine *fitted* points (RMS 2.01 %). The *withheld* A2/+2 °C points include defrost in the Bosch tests, so the steady model is expected above them.

| Point | Source | Use | Output (W) | Bosch COP | Model COP | Error | Speed | T_e (°C) | T_c (°C) |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A7/W35 maximum | IM | fitted | 7970 | 3.07 | 3.034 | -1.2 % | 100.0 % | -0.2 | 39.0 |
| A7/W55 maximum | IM | fitted | 7450 | 2.64 | 2.614 | -1.0 % | 84.0 % | 0.8 | 58.7 |
| A−7/W35 maximum | IM | fitted | 6710 | 2.36 | 2.316 | -1.9 % | 100.3 % | -12.2 | 38.4 |
| A−10/W35 maximum | IM | fitted | 5860 | 2.23 | 2.344 | +5.1 % | 95.1 % | -14.6 | 37.9 |
| A7/W35 nominal | IM | fitted | 2840 | 4.85 | 4.840 | -0.2 % | 39.1 % | 2.8 | 36.4 |
| Tj +12 °C, W30 | ErP | fitted | 1800 | 5.75 | 5.735 | -0.3 % | 22.4 % | 8.3 | 30.9 |
| Tj +7 °C, W36 | ErP | fitted | 2500 | 4.68 | 4.710 | +0.6 % | 34.0 % | 3.0 | 37.3 |
| Tj −7 °C, W52 | ErP | fitted | 5900 | 2.09 | 2.050 | -1.9 % | 77.4 % | -11.1 | 54.9 |
| Tj −10 °C, W55 | ErP | fitted | 5200 | 1.83 | 1.838 | +0.4 % | 65.0 % | -13.2 | 57.6 |
| A2/W35 maximum | IM | withheld | 7090 | 2.83 | 2.910 | +2.8 % | 97.5 % | -4.3 | 38.5 |
| A2/W35 nominal | IM | withheld | 2870 | 4.06 | 4.352 | +7.2 % | 43.5 % | -1.9 | 36.4 |
| Tj +2 °C, W42 | ErP | withheld | 3500 | 3.49 | 3.737 | +7.1 % | 50.8 % | -2.1 | 43.7 |

## 2. EN 14511-style bench with frost and defrost

Production controller, water outlet held, air at the EN 14511 humidity, fixed compressor speed for 72 h. Frost growth, normal and intensive (every 5th) defrosts, drip time and coil recovery are integrated over complete groups of five defrost cycles. Bands: ±8 % (nominal points), ±10 % (A2 maximum, see HEAT-PUMP.md). Holding the water fixed makes defrosts shorter than in a real system; the field comparison (section 5) uses the coupled engine.

| Test | Steady output (W) | Steady COP | Integrated output (W) | Integrated COP | Bosch output (W) | Bosch COP | Output error | COP error | Defrosts (intensive) | Period (min) | Normal: s / kWh | Intensive: s / kWh |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A2/W35 maximum | 7429 | 2.780 | 6754 | 2.598 | 7090 | 2.83 | -4.7 % | -8.2 % | 38 (7) | 110 | 194 / 0.254 | 540 / 1.036 |
| A2/W35 nominal | 3021 | 4.345 | 2918 | 4.177 | 2870 | 4.06 | +1.7 % | +2.9 % | 7 (1) | 543 | 181 / 0.237 | 540 / 1.032 |
| ErP Tj +2 °C, W42 | 3684 | 3.714 | 3534 | 3.546 | 3500 | 3.49 | +1.0 % | +1.6 % | 11 (2) | 382 | 158 / 0.237 | 540 / 1.184 |
| A7/W35 maximum (no frost) | 7970 | 3.034 | 7970 | 3.034 | 7970 | 3.07 | +0.0 % | -1.2 % | 0 (0) | — | — / — | — / — |

## 3. Coupled engine scenarios (starters)

120 m² single-zone house, underfloor loop, weather-compensated flow target; fixed 10 s macro steps of the adaptive integrator. The energy residual closes electrical input, outdoor-air heat, meltwater, coil storage, water/room storage and envelope losses.

| Scenario | Outdoor (°C) | Hours | Net heat (kWh) | Outdoor-unit electricity (kWh) | Backup heat (kWh) | SPF | Defrosts | Starts | Max starts / h | Shortest run (s) | House air (°C) | Energy residual (J) | Wall time (s) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| House, 2 °C / 85 % RH (defrost) | 2 | 6 | 27.97 | 7.54 | 0.04 | 3.71 | 2 | 2 | 2 | 1840 | 20.72 | -1.55e-3 | 239.6 |
| Cold snap, −15 °C (backup heater) | -15 | 3 | 14.94 | 6.59 | 2.62 | 2.27 | 0 | 1 | 1 | — | 18.12 | -5.72e-4 | 130.5 |
| Mild day, 12 °C, one underfloor zone open (60 W/K): low-load cycling | 12 | 3 | 4.83 | 1.34 | 0.00 | 3.60 | 0 | 4 | 2 | 740 | 19.12 | -8.70e-4 | 136.2 |

## 4. Timestep

Fixed 0.1 s steps against adaptive 30 s macro steps (0.5 s heat-pump substeps), 10 min warm-up at 7 °C: flow temperature 43.7690 vs 43.7687 °C, compressor heat 2.6843 vs 2.6846 MJ.


## 5. Field comparison: measured Bosch Compress 5800i (4 kW), Zagreb

Source: heatpumpmonitor.org #920, Bosch Compress 5800i AW 4 kW (R290), Zagreb, radiators; class-1 electricity meter, class-2 ultrasonic heat meter; https://heatpumpmonitor.org/timeseries/data?id=920 (10 s, retrieved 2026-10-17). Weather: Open-Meteo historical archive, 45.815 N 15.982 E, hourly 2 m temperature and relative humidity (CC BY 4.0), retrieved 2026-10-17; site outdoor sensor minus archive: +0.2 K mean, 1.7 K s.d.. Processing: Defrost = >= 60 s of heat < -150 W with the compressor running (electrical > 150 W); fragments within 3 min merged; >= 8 min classed intensive. Heat-meter samples beyond +/-12 kW (76 of 120,961) treated as spikes; event energies given from the meter (spikes dropped) and recomputed from flow rate and flow/return temperature.

48 h (2026-01-09T00:00Z – 2026-01-11T00:00Z, outdoor -10 … 2.1 °C, RH median 95 %) replayed through the coupled engine with the real hourly weather, a radiator load sized to the measured mean heat at the measured flow temperature, a constant ~16 l/min circulator and an assumed 60 L of system water. The field unit is the 4 kW size of the same R290 outdoor-unit family; per-defrost duration and energy (same housing and coil family, same firmware) are compared directly, intervals and dips depend on load, humidity and installation, the COP on unit size, metering (the field meters include the indoor pumps) and installation.

| Quantity | Model (7 kW, engine) | Measured window | Measured 14-day median (IQR) | Class |
| --- | ---: | ---: | ---: | --- |
| Defrosts in 48 h (intensive) | 14 (2) | 14 (2) | — | calibrated (frost trigger) |
| Interval between defrosts (min) | 168 | 207 | 203.5 (148–204–260) | calibrated |
| Normal defrost duration (min) | 3.83 | 4.83 | 4.83 (4.167–4.833–6) | calibrated (end temperature) |
| Normal defrost heat from the water (kWh) | 0.269 | 0.416 | 0.372 (0.232–0.372–0.447) | calibrated (coil capacity) |
| Intensive defrost duration (min) | 9.00 | 10.50 | 10.67 (9–10.667–15) | firmware minimum (documented 9–16 min) |
| Intensive defrost heat from the water (kWh) | 0.829 | 1.031 | 0.839 (0.583–0.839–0.998) | predicted (not fitted) |
| Flow dip, normal / intensive (K) | 7.1 / 14.6 | 12.6 / 13.4 | 12.3 / 20.7 | installation-dependent, unvalidated |
| COP over 48 h incl. defrost | 3.58 | 2.97 | — | extrapolated (lab-calibrated cycle) |
| Mean heat (W) | 2337 | 2313 | — | imposed (load) |

Energy residual of the replay: 1.20e-6 J (wall time 276 s).

Wall times are measured on the machine that ran this report, not a performance guarantee.
