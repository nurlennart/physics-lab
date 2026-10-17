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

Water outlet held, air at the EN 14511 humidity, fixed compressor speed for 6 h; the model's frost growth, reverse-cycle defrost, drip time and coil recovery are integrated. Maximum points are averaged over complete cycles after the first defrost; slow-frosting part-load points over the whole run. Pass band ±8 %.

| Test | Steady output (W) | Steady COP | Integrated output (W) | Integrated COP | Bosch output (W) | Bosch COP | Output error | COP error | Defrosts | Period (min) | Mean defrost (s) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A2/W35 maximum | 7429 | 2.780 | 6887 | 2.635 | 7090 | 2.83 | -2.9 % | -6.9 % | 7 | 52.8 | 57 |
| A2/W35 nominal | 3021 | 4.345 | 2955 | 4.248 | 2870 | 4.06 | +2.9 % | +4.6 % | 1 | — | 95 |
| ErP Tj +2 °C, W42 | 3684 | 3.714 | 3563 | 3.595 | 3500 | 3.49 | +1.8 % | +3.0 % | 2 | — | 81 |
| A7/W35 maximum (no frost) | 7970 | 3.034 | 7971 | 3.034 | 7970 | 3.07 | +0.0 % | -1.2 % | 0 | — | — |

## 3. Coupled engine scenarios (starters)

120 m² single-zone house, underfloor loop, weather-compensated flow target; fixed 10 s macro steps of the adaptive integrator. The energy residual closes electrical input, outdoor-air heat, meltwater, coil storage, water/room storage and envelope losses.

| Scenario | Outdoor (°C) | Hours | Net heat (kWh) | Outdoor-unit electricity (kWh) | Backup heat (kWh) | SPF | Defrosts | Starts | Max starts / h | Shortest run (s) | House air (°C) | Energy residual (J) | Wall time (s) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| House, 2 °C / 85 % RH (defrost) | 2 | 3 | 13.28 | 3.30 | 0.00 | 4.02 | 2 | 1 | 1 | — | 20.52 | -6.88e-5 | 35.1 |
| Cold snap, −15 °C (backup heater) | -15 | 3 | 14.15 | 6.40 | 2.73 | 2.21 | 1 | 1 | 1 | — | 17.94 | 1.40e-4 | 35.6 |
| Mild day, 12 °C, one underfloor zone open (60 W/K): low-load cycling | 12 | 3 | 1.86 | 0.34 | 0.00 | 5.54 | 0 | 4 | 2 | 740 | 19.12 | -8.85e-5 | 34.1 |

## 4. Timestep

Fixed 0.1 s steps against adaptive 30 s macro steps (0.5 s heat-pump substeps), 10 min warm-up at 7 °C: flow temperature 27.9290 vs 27.9300 °C, compressor heat 2.0144 vs 2.0151 MJ.

Wall times are measured on the machine that ran this report, not a performance guarantee.
