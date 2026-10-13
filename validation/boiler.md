# Electric boiler calibration snapshot

Reference: [Bosch Tronic Heat 3000 9, manual 6720859226 (2018/09)](https://bosch-de-de.boschhc-documents.com/download/pdf/file/6720859226). This report compares published currents and limiter temperature plus independent analytical/storage calculations. It does not establish accuracy of assumed transient coefficients against manufacturer laboratory traces.

| Check | Reference | Model | Absolute error | Allowed error | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| 230 V phase L1 current (A) | 13.1 | 13.05652174 | 0.04347826087 | 0.0655 | PASS |
| 230 V bridged live current (A) | 39.2 | 39.14347826 | 0.05652173913 | 0.196 | PASS |
| Isolated water temperature at 30 s, 3 kW (°C) | 24.22773605 | 24.22773605 | 9.332978834e-12 | 0.0001 | PASS |
| Water/steel stored energy at 30 s (J) | 80183.24201 | 80183.242 | 1.536245691e-7 | 0.0001 | PASS |
| Element stored energy at 30 s (J) | 9816.757995 | 9816.757995 | 3.637978807e-12 | 0.0001 | PASS |
| Warm-up energy residual (J) | 0 | 4.952624977e-10 | 4.952624977e-10 | 0.0001 | PASS |
| Water temperature at first STB trip (°C) | 95 | 95.0402882 | 0.04028819796 | 0.05 | PASS |
| STB-event energy residual (J) | 0 | 4.809055554e-8 | 4.809055554e-8 | 0.0001 | PASS |

The analytic warm-up uses C_w = 18966 J/K, C_e = 1500 J/K, G = 1200 W/K and τ = 1.158384638 s. With D(t) = (P/G)·C_w/(C_w+C_e)·(1−exp(−t/τ)), T_w(t) = 20+(P·t−C_e·D(t))/(C_w+C_e). The applied power is one actual 3 kW resistive stage for 30 s, shell UA zero, no flow.

At the first trip (173.8 simulated seconds), the protection opens the heating stages; stored element heat remains and can continue to warm the water. Full regression coverage is in boiler.test.ts, the preset campaign and browser tests. Model assumptions and remaining limits: [ELECTRIC-BOILER.md](../docs/ELECTRIC-BOILER.md).
