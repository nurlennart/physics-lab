# Panel radiator calibration snapshot

Reference: [Kermi GmbH, Technik therm-x2 Flachheizkörper (Stand Februar 2018)](https://www.alternative-haustechnik.de/media/8d/23/30/1682398475/db-kermi-x2-fhk.pdf). Manufacturer document, distributor-hosted copy. The 2015 edition (Stand März 2015) has identical registered output data, exponents, weights, water contents and pressure-drop lines. Every row compares the full simulation engine (hydraulic network, enthalpy transport, 16-cell water and steel inventory, energy ledger) with a number published by Kermi or with an independent analytic solution; no row calls the radiator model to compute its reference. Regenerate with `npm run validate:radiator`.

## Kermi FK0220610 (type 22, 600 × 1000) — published output

| Check | Reference | Model | Error | Tolerance | Result | Basis |
| --- | --- | --- | --- | --- | --- | --- |
| 75/65/20 °C output (W) | 1666 | 1665.99 | 0.009708923 | 3.332 | PASS | Kermi Technik p. 23–24 (rounded to 1 W); flow set to Φ/(c·ΔT) |
| 75/65/20 °C return (°C) | 65 | 64.99959 | 0.0004141965 | 0.03 | PASS | Same point: modeled return at the published flow |
| 70/55/16 °C output (W) | 1506 | 1506.124 | 0.1235766 | 3.012 | PASS | Kermi Technik p. 23–24 (rounded to 1 W); flow set to Φ/(c·ΔT) |
| 70/55/16 °C return (°C) | 55 | 54.99743 | 0.002571003 | 0.03 | PASS | Same point: modeled return at the published flow |
| 55/45/16 °C output (W) | 1007 | 1006.742 | 0.258471 | 2.014 | PASS | Kermi Technik p. 23–24 (rounded to 1 W); flow set to Φ/(c·ΔT) |
| 55/45/16 °C return (°C) | 45 | 45.00169 | 0.001689772 | 0.03 | PASS | Same point: modeled return at the published flow |
| 45/40/16 °C output (W) | 734 | 733.5104 | 0.4896425 | 1.468 | PASS | Kermi Technik p. 23–24 (rounded to 1 W); flow set to Φ/(c·ΔT) |
| 45/40/16 °C return (°C) | 40 | 40.00309 | 0.003088774 | 0.03 | PASS | Same point: modeled return at the published flow |
| 70/55/18 °C output (W) | 1422 | 1421.535 | 0.465115 | 2.844 | PASS | Kermi Technik p. 23–24 (rounded to 1 W); flow set to Φ/(c·ΔT) |
| 70/55/18 °C return (°C) | 55 | 55.00349 | 0.003485883 | 0.03 | PASS | Same point: modeled return at the published flow |
| 55/45/18 °C output (W) | 930 | 929.7108 | 0.2891802 | 1.86 | PASS | Kermi Technik p. 23–24 (rounded to 1 W); flow set to Φ/(c·ΔT) |
| 55/45/18 °C return (°C) | 45 | 45.00216 | 0.002156004 | 0.03 | PASS | Same point: modeled return at the published flow |
| 45/40/18 °C output (W) | 662 | 662.2123 | 0.2122816 | 1.324 | PASS | Kermi Technik p. 23–24 (rounded to 1 W); flow set to Φ/(c·ΔT) |
| 45/40/18 °C return (°C) | 40 | 39.9981 | 0.001896224 | 0.03 | PASS | Same point: modeled return at the published flow |
| 70/55/20 °C output (W) | 1338 | 1337.796 | 0.2037055 | 2.676 | PASS | Kermi Technik p. 23–24 (rounded to 1 W); flow set to Φ/(c·ΔT) |
| 70/55/20 °C return (°C) | 55 | 55.00077 | 0.0007728588 | 0.03 | PASS | Same point: modeled return at the published flow |
| 55/45/20 °C output (W) | 854 | 853.9563 | 0.04370293 | 1.708 | PASS | Kermi Technik p. 23–24 (rounded to 1 W); flow set to Φ/(c·ΔT) |
| 55/45/20 °C return (°C) | 45 | 44.99947 | 0.0005292968 | 0.03 | PASS | Same point: modeled return at the published flow |
| 45/40/20 °C output (W) | 593 | 592.7354 | 0.2645834 | 1.186 | PASS | Kermi Technik p. 23–24 (rounded to 1 W); flow set to Φ/(c·ΔT) |
| 45/40/20 °C return (°C) | 40 | 40.00189 | 0.001888312 | 0.03 | PASS | Same point: modeled return at the published flow |
| 70/55/22 °C output (W) | 1255 | 1255.12 | 0.1196761 | 2.51 | PASS | Kermi Technik p. 23–24 (rounded to 1 W); flow set to Φ/(c·ΔT) |
| 70/55/22 °C return (°C) | 55 | 54.99696 | 0.003041513 | 0.03 | PASS | Same point: modeled return at the published flow |
| 55/45/22 °C output (W) | 780 | 779.7178 | 0.2821988 | 1.56 | PASS | Kermi Technik p. 23–24 (rounded to 1 W); flow set to Φ/(c·ΔT) |
| 55/45/22 °C return (°C) | 45 | 45.00248 | 0.002478079 | 0.03 | PASS | Same point: modeled return at the published flow |
| 45/40/22 °C output (W) | 525 | 524.9147 | 0.08533589 | 1.05 | PASS | Kermi Technik p. 23–24 (rounded to 1 W); flow set to Φ/(c·ΔT) |
| 45/40/22 °C return (°C) | 40 | 40.00041 | 0.0004123225 | 0.03 | PASS | Same point: modeled return at the published flow |
| 70/55/24 °C output (W) | 1174 | 1173.753 | 0.24742 | 2.348 | PASS | Kermi Technik p. 23–24 (rounded to 1 W); flow set to Φ/(c·ΔT) |
| 70/55/24 °C return (°C) | 55 | 55.00144 | 0.001441251 | 0.03 | PASS | Same point: modeled return at the published flow |
| 55/45/24 °C output (W) | 707 | 706.8434 | 0.1566195 | 1.414 | PASS | Kermi Technik p. 23–24 (rounded to 1 W); flow set to Φ/(c·ΔT) |
| 55/45/24 °C return (°C) | 45 | 45.00096 | 0.0009595628 | 0.03 | PASS | Same point: modeled return at the published flow |
| 45/40/24 °C output (W) | 459 | 458.9766 | 0.02338895 | 1 | PASS | Kermi Technik p. 23–24 (rounded to 1 W); flow set to Φ/(c·ΔT) |
| 45/40/24 °C return (°C) | 40 | 39.99979 | 0.0002134408 | 0.03 | PASS | Same point: modeled return at the published flow |

## Catalog sizes

| Check | Reference | Model | Error | Tolerance | Result | Basis |
| --- | --- | --- | --- | --- | --- | --- |
| FK0220610 70/55/20 °C output (W) | 1338 | 1337.796 | 0.2037055 | 2.676 | PASS | Kermi Technik p. 24, W/m × length |
| FK0220610 55/45/20 °C output (W) | 854 | 853.9563 | 0.04370293 | 1.708 | PASS | Kermi Technik p. 24, W/m × length |
| FK0110610 70/55/20 °C output (W) | 789 | 788.8944 | 0.105643 | 1.578 | PASS | Kermi Technik p. 24, W/m × length |
| FK0110610 55/45/20 °C output (W) | 507 | 507.1931 | 0.1930806 | 1.014 | PASS | Kermi Technik p. 24, W/m × length |
| FK0330610 70/55/20 °C output (W) | 1798 | 1797.522 | 0.4775257 | 3.596 | PASS | Kermi Technik p. 24, W/m × length |
| FK0330610 55/45/20 °C output (W) | 1150 | 1149.934 | 0.06618083 | 2.3 | PASS | Kermi Technik p. 24, W/m × length |
| FK0220910 70/55/20 °C output (W) | 1839 | 1838.59 | 0.410267 | 3.678 | PASS | Kermi Technik p. 24, W/m × length |
| FK0220910 55/45/20 °C output (W) | 1168 | 1167.953 | 0.04705291 | 2.336 | PASS | Kermi Technik p. 24, W/m × length |
| FK0220614 70/55/20 °C output (W) | 1873.2 | 1872.672 | 0.5280261 | 3.7464 | PASS | Kermi Technik p. 24, W/m × length |
| FK0220614 55/45/20 °C output (W) | 1195.6 | 1195.382 | 0.2183372 | 2.3912 | PASS | Kermi Technik p. 24, W/m × length |

## EN 442 characteristic at off-design flow (70 °C supply, 20 °C air)

| Check | Reference | Model | Error | Tolerance | Result | Basis |
| --- | --- | --- | --- | --- | --- | --- |
| 2 % of nominal flow: return (°C) | 20.10955 | 20.11055 | 0.0009992827 | 0.02 | PASS | Independent bisection of ṁ·c·(T_s − T_r) = Φ₅₀·(ΔT_ln/ΔT₅₀)^n |
| 2 % of nominal flow: output (W) | 160.2306 | 160.3309 | 0.1002899 | 0.1602306 | PASS | Same reference |
| 10 % of nominal flow: return (°C) | 29.75163 | 29.75305 | 0.001419505 | 0.02 | PASS | Independent bisection of ṁ·c·(T_s − T_r) = Φ₅₀·(ΔT_ln/ΔT₅₀)^n |
| 10 % of nominal flow: output (W) | 669.5596 | 669.5874 | 0.02781001 | 0.6695596 | PASS | Same reference |
| 50 % of nominal flow: return (°C) | 54.16814 | 54.16822 | 0.00007962021 | 0.02 | PASS | Independent bisection of ṁ·c·(T_s − T_r) = Φ₅₀·(ΔT_ln/ΔT₅₀)^n |
| 50 % of nominal flow: output (W) | 1318.392 | 1318.394 | 0.001426162 | 1.318392 | PASS | Same reference |
| 100 % of nominal flow: return (°C) | 61.12848 | 61.12857 | 0.00008850353 | 0.02 | PASS | Independent bisection of ṁ·c·(T_s − T_r) = Φ₅₀·(ΔT_ln/ΔT₅₀)^n |
| 100 % of nominal flow: output (W) | 1477.769 | 1477.771 | 0.001871619 | 1.477769 | PASS | Same reference |
| 200 % of nominal flow: return (°C) | 65.28682 | 65.28715 | 0.0003316078 | 0.02 | PASS | Independent bisection of ṁ·c·(T_s − T_r) = Φ₅₀·(ΔT_ln/ΔT₅₀)^n |
| 200 % of nominal flow: output (W) | 1570.312 | 1570.319 | 0.007180888 | 1.570312 | PASS | Same reference |

## Pressure drop (Profil-K, same-side connection, 70 °C water)

| Check | Reference | Model | Error | Tolerance | Result | Basis |
| --- | --- | --- | --- | --- | --- | --- |
| types 12-33 at 50 kg/h (Pa) | 45.73527 | 45.77259 | 0.03732843 | 0.686029 | PASS | Kermi Technik p. 148, chart line from its vector path |
| types 12-33 at 100 kg/h (Pa) | 181.3 | 180.2993 | 1.000747 | 2.7195 | PASS | Kermi Technik p. 148, chart line from its vector path |
| types 12-33 at 143 kg/h (Pa) | 369.0205 | 366.9777 | 2.042832 | 5.535308 | PASS | Kermi Technik p. 148, chart line from its vector path |
| types 12-33 at 300 kg/h (Pa) | 1608.562 | 1605.947 | 2.615197 | 24.12843 | PASS | Kermi Technik p. 148, chart line from its vector path |
| types 12-33 at 600 kg/h (Pa) | 6376.529 | 6407.039 | 30.51049 | 95.64793 | PASS | Kermi Technik p. 148, chart line from its vector path |
| types 10/11 at 50 kg/h (Pa) | 31.35628 | 31.40098 | 0.04469852 | 0.4703442 | PASS | Kermi Technik p. 148, chart line from its vector path |
| types 10/11 at 100 kg/h (Pa) | 124.3 | 123.6892 | 0.610846 | 1.8645 | PASS | Kermi Technik p. 148, chart line from its vector path |
| types 10/11 at 143 kg/h (Pa) | 253.0019 | 251.7546 | 1.247364 | 3.795029 | PASS | Kermi Technik p. 148, chart line from its vector path |
| types 10/11 at 300 kg/h (Pa) | 1102.836 | 1101.714 | 1.122486 | 16.54254 | PASS | Kermi Technik p. 148, chart line from its vector path |
| types 10/11 at 600 kg/h (Pa) | 4371.774 | 4395.367 | 23.5932 | 65.5766 | PASS | Kermi Technik p. 148, chart line from its vector path |

## Zero flow

| Check | Reference | Model | Error | Tolerance | Result | Basis |
| --- | --- | --- | --- | --- | --- | --- |
| mean water after 30 min from 70 °C (°C) | 33.88758 | 33.88945 | 0.001865753 | 0.02 | PASS | Analytic solution of C·dθ/dt = −K_m·θⁿ; C = 6.08 L water + 29.63 kg × 450 J/(kg·K) |
| heat given to the room in 30 min (kJ) | 1399.28 | 1399.208 | 0.07229402 | 13.9928 | PASS | Stored-energy change of the same solution |
| energy residual (J) | 0 | 0 | 0 | 0.000001 | PASS | Ledger: storage + room heat |

## Timestep convergence (backward Euler)

Outlet temperature 240 s after hot water at nominal flow reaches a radiator at 20 °C; reference step 0.05 s gives 47.37654 °C.

| Step (s) | Outlet (°C) | Error (K) | Ratio to the next finer step |
| --- | --- | --- | --- |
| 8 | 45.94349 | 1.433055 | 1.773518 |
| 4 | 46.56851 | 0.8080294 | 1.883162 |
| 2 | 46.94746 | 0.4290813 | 1.973075 |
| 1 | 47.15908 | 0.2174683 | — |

Ratios near 2 confirm first-order convergence. During normal runs the adaptive integrator limits radiator cells to 0.05 K per step, so warm-up fronts are resolved; steady states are exact for any step.
