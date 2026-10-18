# Underfloor heating calibration snapshot

Reference system: FLOORTEC tacker system, N. reg. 7F147 with the FLOORTEC Alu-Verbundrohr 16 × 2 mm, 45 mm screed cover (Vogel & Noot, FLOORTEC Technische Informationen (price list valid from 1 March 2012), pp. 522–525 and 594). System constant B = 6.754 W/(m²·K), fitted to the 20 table points. Rows run the full simulation engine (hydraulic network, enthalpy transport, 16 water cells and 16 screed nodes, Thermal Spaces, energy ledger) against a published number, an EN 1264 relation or a closed-form solution; no row calls the transport to compute its reference. Regenerate with `npm run validate:underfloor`.

## FLOORTEC tacker 16 × 2, 45 mm screed — EN 1264-2 characteristic

| Check | Reference | Model | Error | Tolerance | Result | Basis |
| --- | --- | --- | --- | --- | --- | --- |
| R_λ,B 0, T 100 mm: q at Δθ 20 K (W/m²) | 130 | 129.5835 | 0.4164743 | 0.65 | PASS | FLOORTEC Technische Informationen pp. 522–525 (rounded to 1 W/m²) |
| R_λ,B 0, T 150 mm: q at Δθ 20 K (W/m²) | 112 | 111.6851 | 0.3149388 | 0.65 | PASS | FLOORTEC Technische Informationen pp. 522–525 (rounded to 1 W/m²) |
| R_λ,B 0, T 200 mm: q at Δθ 20 K (W/m²) | 97 | 96.72974 | 0.2702645 | 0.65 | PASS | FLOORTEC Technische Informationen pp. 522–525 (rounded to 1 W/m²) |
| R_λ,B 0, T 250 mm: q at Δθ 20 K (W/m²) | 84 | 83.91272 | 0.08728067 | 0.65 | PASS | FLOORTEC Technische Informationen pp. 522–525 (rounded to 1 W/m²) |
| R_λ,B 0, T 300 mm: q at Δθ 20 K (W/m²) | 73 | 72.91046 | 0.08954111 | 0.65 | PASS | FLOORTEC Technische Informationen pp. 522–525 (rounded to 1 W/m²) |
| R_λ,B 0.05, T 100 mm: q at Δθ 20 K (W/m²) | 95 | 95.06652 | 0.0665157 | 0.65 | PASS | FLOORTEC Technische Informationen pp. 522–525 (rounded to 1 W/m²) |
| R_λ,B 0.05, T 150 mm: q at Δθ 20 K (W/m²) | 84 | 84.01431 | 0.0143122 | 0.65 | PASS | FLOORTEC Technische Informationen pp. 522–525 (rounded to 1 W/m²) |
| R_λ,B 0.05, T 200 mm: q at Δθ 20 K (W/m²) | 75 | 74.46683 | 0.5331731 | 0.65 | PASS | FLOORTEC Technische Informationen pp. 522–525 (rounded to 1 W/m²) |
| R_λ,B 0.05, T 250 mm: q at Δθ 20 K (W/m²) | 66 | 66.06969 | 0.0696902 | 0.65 | PASS | FLOORTEC Technische Informationen pp. 522–525 (rounded to 1 W/m²) |
| R_λ,B 0.05, T 300 mm: q at Δθ 20 K (W/m²) | 59 | 58.67667 | 0.3233318 | 0.65 | PASS | FLOORTEC Technische Informationen pp. 522–525 (rounded to 1 W/m²) |
| R_λ,B 0.1, T 100 mm: q at Δθ 20 K (W/m²) | 75 | 75.30896 | 0.3089561 | 0.65 | PASS | FLOORTEC Technische Informationen pp. 522–525 (rounded to 1 W/m²) |
| R_λ,B 0.1, T 150 mm: q at Δθ 20 K (W/m²) | 68 | 67.90633 | 0.09367003 | 0.65 | PASS | FLOORTEC Technische Informationen pp. 522–525 (rounded to 1 W/m²) |
| R_λ,B 0.1, T 200 mm: q at Δθ 20 K (W/m²) | 61 | 61.29336 | 0.2933552 | 0.65 | PASS | FLOORTEC Technische Informationen pp. 522–525 (rounded to 1 W/m²) |
| R_λ,B 0.1, T 250 mm: q at Δθ 20 K (W/m²) | 55 | 55.37943 | 0.3794344 | 0.65 | PASS | FLOORTEC Technische Informationen pp. 522–525 (rounded to 1 W/m²) |
| R_λ,B 0.1, T 300 mm: q at Δθ 20 K (W/m²) | 50 | 50.08521 | 0.08520635 | 0.65 | PASS | FLOORTEC Technische Informationen pp. 522–525 (rounded to 1 W/m²) |
| R_λ,B 0.15, T 100 mm: q at Δθ 20 K (W/m²) | 62 | 62.50753 | 0.5075321 | 0.65 | PASS | FLOORTEC Technische Informationen pp. 522–525 (rounded to 1 W/m²) |
| R_λ,B 0.15, T 150 mm: q at Δθ 20 K (W/m²) | 57 | 57.14411 | 0.1441097 | 0.65 | PASS | FLOORTEC Technische Informationen pp. 522–525 (rounded to 1 W/m²) |
| R_λ,B 0.15, T 200 mm: q at Δθ 20 K (W/m²) | 52 | 52.24269 | 0.2426863 | 0.65 | PASS | FLOORTEC Technische Informationen pp. 522–525 (rounded to 1 W/m²) |
| R_λ,B 0.15, T 250 mm: q at Δθ 20 K (W/m²) | 48 | 47.80944 | 0.1905583 | 0.65 | PASS | FLOORTEC Technische Informationen pp. 522–525 (rounded to 1 W/m²) |
| R_λ,B 0.15, T 300 mm: q at Δθ 20 K (W/m²) | 44 | 43.79553 | 0.2044715 | 0.65 | PASS | FLOORTEC Technische Informationen pp. 522–525 (rounded to 1 W/m²) |

## Steady loop: heat flux per log-mean excess (45 °C supply, 80 kg/h, 20 °C room)

| Check | Reference | Model | Error | Tolerance | Result | Basis |
| --- | --- | --- | --- | --- | --- | --- |
| R_λ,B 0, T 150 mm: q/Δθ_H (W/(m²·K)) | 5.6 | 5.584211 | 0.01578931 | 0.056 | PASS | FLOORTEC q/Δθ (arithmetic mean in the tables); model: engine duty over its own log-mean excess |
| R_λ,B 0.05, T 150 mm: q/Δθ_H (W/(m²·K)) | 4.2 | 4.200693 | 0.0006931177 | 0.042 | PASS | FLOORTEC q/Δθ (arithmetic mean in the tables); model: engine duty over its own log-mean excess |
| R_λ,B 0.1, T 150 mm: q/Δθ_H (W/(m²·K)) | 3.4 | 3.395302 | 0.00469783 | 0.034 | PASS | FLOORTEC q/Δθ (arithmetic mean in the tables); model: engine duty over its own log-mean excess |
| R_λ,B 0.15, T 150 mm: q/Δθ_H (W/(m²·K)) | 2.85 | 2.857195 | 0.007195419 | 0.0285 | PASS | FLOORTEC q/Δθ (arithmetic mean in the tables); model: engine duty over its own log-mean excess |
| R_λ,B 0.1, T 100 mm: q/Δθ_H (W/(m²·K)) | 3.75 | 3.765419 | 0.01541943 | 0.0375 | PASS | FLOORTEC q/Δθ (arithmetic mean in the tables); model: engine duty over its own log-mean excess |
| R_λ,B 0.1, T 200 mm: q/Δθ_H (W/(m²·K)) | 3.05 | 3.06466 | 0.0146601 | 0.0305 | PASS | FLOORTEC q/Δθ (arithmetic mean in the tables); model: engine duty over its own log-mean excess |
| R_λ,B 0.1, T 250 mm: q/Δθ_H (W/(m²·K)) | 2.75 | 2.768968 | 0.01896782 | 0.0275 | PASS | FLOORTEC q/Δθ (arithmetic mean in the tables); model: engine duty over its own log-mean excess |
| R_λ,B 0.1, T 300 mm: q/Δθ_H (W/(m²·K)) | 2.5 | 2.504259 | 0.004258694 | 0.025 | PASS | FLOORTEC q/Δθ (arithmetic mean in the tables); model: engine duty over its own log-mean excess |

## Downward loss (EN 1264-2/-3), room below at 10 °C

| Check | Reference | Model | Error | Tolerance | Result | Basis |
| --- | --- | --- | --- | --- | --- | --- |
| q_u (W/m²) | 16.76499 | 16.76499 | 0 | 0.01676499 | PASS | EN 1264 q_u = (R_o·q + θ_i − θ_u)/R_u with the engine's own q, θ_i, θ_u |
| heat received by the room below (W) | 251.4748 | 251.4748 | 8.526513e-14 | 0.0002514748 | PASS | Room ledger: the same exchange credited to the lower room |
| energy residual (J) | 0 | -0.01037572 | 0.01037572 | 0.1 | PASS | Global ledger after 96 h |

## Pressure drop per loop (16 × 2, 100 m, 40 °C water)

| Check | Reference | Model | Error | Tolerance | Result | Basis |
| --- | --- | --- | --- | --- | --- | --- |
| 30 kg/h (Pa) | 1068.775 | 1068.775 | 0 | 32.06326 | PASS | Colebrook–White (laminar: Hagen–Poiseuille), k = 0.007 mm (FLOORTEC data sheet p. 594); model uses Swamee–Jain. 30 kg/h is laminar; 60 kg/h (Re ≈ 2700) lies in the blended transition and is not compared |
| 100 kg/h (Pa) | 9835.802 | 9992.399 | 156.5973 | 295.074 | PASS | Colebrook–White (laminar: Hagen–Poiseuille), k = 0.007 mm (FLOORTEC data sheet p. 594); model uses Swamee–Jain. 30 kg/h is laminar; 60 kg/h (Re ≈ 2700) lies in the blended transition and is not compared |
| 150 kg/h (Pa) | 19828.96 | 20033.49 | 204.5265 | 594.8688 | PASS | Colebrook–White (laminar: Hagen–Poiseuille), k = 0.007 mm (FLOORTEC data sheet p. 594); model uses Swamee–Jain. 30 kg/h is laminar; 60 kg/h (Re ≈ 2700) lies in the blended transition and is not compared |
| 200 kg/h (Pa) | 32753.91 | 32997.36 | 243.4499 | 982.6173 | PASS | Colebrook–White (laminar: Hagen–Poiseuille), k = 0.007 mm (FLOORTEC data sheet p. 594); model uses Swamee–Jain. 30 kg/h is laminar; 60 kg/h (Re ≈ 2700) lies in the blended transition and is not compared |
| 250 kg/h (Pa) | 48466.17 | 48744.49 | 278.3199 | 1453.985 | PASS | Colebrook–White (laminar: Hagen–Poiseuille), k = 0.007 mm (FLOORTEC data sheet p. 594); model uses Swamee–Jain. 30 kg/h is laminar; 60 kg/h (Re ≈ 2700) lies in the blended transition and is not compared |

## Zero flow: cool-down from 40 °C into 20 °C air

| Check | Reference | Model | Error | Tolerance | Result | Basis |
| --- | --- | --- | --- | --- | --- | --- |
| screed after 6 h (°C) | 28.22803 | 28.22953 | 0.001501634 | 0.02 | PASS | Closed-form two-node solution (water ↔ screed ↔ room/below); 10 s steps |
| water after 6 h (°C) | 28.28645 | 28.28796 | 0.001512297 | 0.02 | PASS | Same solution |
| floor time constant (h) | 6.756713 | 6.756713 | 0 | 0 | PASS | Slow eigenvalue: screed 1.83 MJ/K over 77.2 W/K (reported, not a check) |
| energy residual (J) | 0 | 0 | 0 | 0.001 | PASS | Ledger: storage + room heat |

## Heat-pump house (120 m², twelve 100 m loops, 2 °C outdoors)

| Check | Reference | Model | Error | Tolerance | Result | Basis |
| --- | --- | --- | --- | --- | --- | --- |
| house air after 6 h (°C), within 19–22 | 20.5 | 20.82098 | 0.3209813 | 1.5 | PASS | Plausibility band around the 20 °C design room temperature |
| energy residual after 6 h (J) | 0 | -0.0004593845 | 0.0004593845 | 0.1 | PASS | Global ledger |

## Timestep convergence (backward Euler)

Outlet temperature 240 s after 45 °C water at 80 kg/h reaches a floor at 20 °C; reference step 0.05 s gives 20.05403 °C.

| Step (s) | Outlet (°C) | Error (K) | Ratio to the next finer step |
| --- | --- | --- | --- |
| 8 | 20.09305 | 0.03901983 | 1.990531 |
| 4 | 20.07363 | 0.01960272 | 2.022599 |
| 2 | 20.06372 | 0.009691844 | 2.053857 |
| 1 | 20.05875 | 0.00471885 | — |

Ratios near 2 confirm first-order convergence. Steady states are exact for any step.

## Heat-pump house, hourly

| Hour | House air (°C) | Floor to house (W) | Floor downwards (W) | Heat-pump output (W) | Energy residual (J) |
| --- | --- | --- | --- | --- | --- |
| 1 | 20.16 | 3192 | 1120 | 5110 | -6.53e-5 |
| 2 | 20.28 | 3324 | 1138 | 6536 | -1.43e-4 |
| 3 | 20.42 | 3279 | 1140 | 5494 | -2.22e-4 |
| 4 | 20.55 | 3391 | 1156 | 6240 | -2.98e-4 |
| 5 | 20.70 | 3327 | 1157 | 4628 | -3.79e-4 |
| 6 | 20.82 | 3365 | 1166 | 5817 | -4.59e-4 |

The floor's downward loss goes to the room's floor boundary, which in this example is the outdoor temperature (Thermal Spaces have no ground model). Hourly values are instantaneous at the end of each hour. Six simulated hours took about 80 s on this host (not a guarantee).
