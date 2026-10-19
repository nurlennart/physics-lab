# Underfloor heating

The `underfloorHeating` component is wet-screed underfloor heating (EN 1264 type A: pipes embedded in the screed). It is a hydraulic branch (inlet, outlet) that heats its assigned [Thermal Space](THERMAL-SPACES.md) and loses heat down into whatever lies under that room's floor. The default configuration is the **FLOORTEC tacker system** (Vogel & Noot, DIN-registered 7F147) with the FLOORTEC Alu-Verbundrohr 16 × 2 mm under 45 mm of cement screed: 15 m², 150 mm pipe spacing, one 100 m loop, floor covering R_λ,B 0.10 m²K/W. Variants change the spacing (100, 200 mm) or the covering (tiles, R_λ,B 0). It is a sandbox component (not available in scored assignments).

## Sources

| Tag | Document | Used for |
| --- | --- | --- |
| [EN2] | EN 1264-2 (calculation of the thermal output, type A) | Characteristic q = B·a_B·a_T^m_T·a_ü^m_ü·a_D^m_D·Δθ_H; factor tables a_T, a_ü, a_D; α = 10.8 W/(m²·K); base curve q = 8.92·(θ_F,m − θ_i)^1.1 |
| [EN3] | EN 1264-3 (dimensioning) | Downward loss q_u = (R_o·q + θ_i − θ_u)/R_u; design covering R_λ,B 0.10 (living), 0 (bathrooms); 29/33/35 °C surface limits |
| [EN4] | EN 1264-4 (installation) | Minimum insulation R 0.75 / 1.25 / 1.25–2.0 m²K/W; cement and calcium sulphate screed flow-temperature limit 55 °C (with DIN 18560) |
| [FT] | Vogel & Noot, FLOORTEC Technische Informationen (price list valid from 1 March 2012), pp. 522–525 and 594 | Heat flux tables of the tacker system with the 16 × 2 Alu-Verbundrohr (4 coverings × 5 spacings × 5 water temperatures, 45 mm cover); pipe data: 0.113 L/m, 0.104 kg/m, λ 0.43 W/(m·K), roughness 0.007 mm (Prandtl–Colebrook), 95 °C, 10 bar |

**Transcription of EN 1264-2.** The standard is not freely available and was not consulted for this work. The factor tables in `underfloor-heating-data.ts` (a_T at R_λ,B 0/0.05/0.10/0.15; a_ü and a_D at T = 50–375 mm) are the widely reproduced EN 1264-2 values, entered from the author's knowledge. They are checked indirectly: with one fitted constant they reproduce all 20 FLOORTEC table points within the tables' rounding (below). A transcription error in any factor used by those points would show up there. The rows for 50 and 75 mm spacing and 375 mm are not covered by FLOORTEC data.

**The FLOORTEC 14 × 2 tables** (pp. 514–517, same system registration) were not used. They match the EN 1264 characteristic only with a 17 mm pipe diameter (within 0.7 %); with 14 mm they deviate up to 3.7 % with a spacing-dependent trend. They appear to have been computed for a 17 mm pipe. The 16 × 2 tables fit the actual 16 mm diameter.

## Data provenance

The Inspector lists the same four categories for the selected loop.

| Category | Content |
| --- | --- |
| Manufacturer data [FT] | Heat flux tables for the 16 × 2 tacker system; pipe dimensions, water content, roughness, pressure and temperature rating; 45 mm screed cover |
| EN 1264 method [EN2, EN3] | The characteristic and its factor tables (interpolated linearly in T and R_λ,B between tabulated values); α = 10.8 W/(m²·K); R_o; the downward loss formula; the base curve for the surface temperature and the limit flux |
| Fitted | System constant B = 6.754 W/(m²·K) (EN 1264 standard pipe: 6.7), least squares in log q over the 20 FLOORTEC 16 × 2 points |
| Assumed | 16 cells, one screed node per cell at the pipe plane with no conduction between cells; screed 2000 kg/m³ and 1000 J/(kg·K) (EN ISO 10456 cement screed design values) over cover + pipe layer; pipe wall and covering heat capacity neglected; R_u 1.25 m²K/W default; the same characteristic in reverse flow and for water below the room temperature |

FLOORTEC tabulates q against the **arithmetic** mean water temperature (each table block is exactly the 20 K block scaled by Δθ/20 K). EN 1264 defines Δθ_H as the **log-mean**. The model uses the log-mean; at 45/35/20 °C the two differ by 2 %, so a reader comparing a simulated 45/35 °C loop with the table sees about 2 % less output than the table. The calibration compares the coefficient q/Δθ.

## Equations

**Characteristic [EN2].** With pipe spacing T, outer diameter D, screed cover s_u of conductivity λ_E and floor covering R_λ,B:

```
q = K_H·Δθ_H,     Δθ_H = (θ_V − θ_R) / ln((θ_V − θ_i)/(θ_R − θ_i))
K_H = B · a_B · a_T^m_T · a_ü^m_ü · a_D^m_D
a_B = (1/α + s_u,0/λ_u,0) / (1/α + s_u/λ_E + R_λ,B),   α = 10.8 W/(m²·K), s_u,0 = 0.045 m, λ_u,0 = 1 W/(m·K)
m_T = 1 − T/0.075,  m_ü = 100·(0.045 − s_u),  m_D = 250·(D − 0.020)
```

Default: K_H = 3.395 W/(m²·K), i.e. 68 W/m² at Δθ_H = 20 K (FLOORTEC: 68).

**Node model.** EN 1264 already separates the floor at the pipe plane: upward resistance R_o = 1/α + s_u/λ_E + R_λ,B, downward resistance R_u (insulation, slab, ceiling below). The loop is split into N = 16 cells along the flow; each cell covers A/N of the floor and has a water node (the loop's water) and a screed node at the pipe plane (the whole screed of its strip):

```
C_w·dT_k/dt = ṁ·c_w·(T_{k−1} − T_k) − g_wp·(X_k − S_k) + P_diss/N,     X_k = w·T_{k−1} + (1 − w)·T_k
C_s·dS_k/dt = g_wp·(X_k − S_k) − g_up·(S_k − θ_i) − g_dn·(S_k − θ_u)
g_up = a/R_o,  g_dn = a/R_u,  g_wp = a · K_H·(1 + R_o/R_u)/(1 − R_o·K_H),   a = A/N
C_s = a·(s_u + D)·ρ_E·c_E,   C_w = water of the loop(s)/N
```

g_wp is chosen so that, with the space below at room temperature, the steady upward flux is exactly K_H·Δθ_H and the downward flux is EN 1264's q_u = R_o·q/R_u. When the space below is colder, q_u = (R_o·q + θ_i − θ_u)/R_u, as in EN 1264-3, and the upward flux drops slightly because the pipe plane is cooler. This requires R_o·K_H < 1 (the flux cannot exceed what the screed above the pipes conducts with the plane at water temperature); configurations with R_o·K_H ≥ 0.98 are rejected.

**Time integration.** Backward Euler inside the global enthalpy transport. The screed node is eliminated per cell: S' = (C_s/h·S + g_wp·X + g_up·θ_i + g_dn·θ_u)/D with D = C_s/h + g_wp + g_up + g_dn. The water cell then sees an effective conductance g_eff = g_wp·(D − g_wp)/D and an effective temperature T_eff = (C_s/h·S + g_up·θ_i + g_dn·θ_u)/(D − g_wp). That is the same affine cell form as the radiator and pipe chains, so loops, pipes, the heat pump, junctions and reverse flow stay one linear solve, and the response to room temperatures stays affine for the [Thermal Spaces](THERMAL-SPACES.md) Schur coupling. The screed is back-substituted after the solve, and the ledger books exactly g_up·(S' − θ_i)·h to the room and g_dn·(S' − θ_u)·h below.

The inlet weight w = 1/x − 1/(eˣ − 1) uses the steady series conductance x = g_series/(ṁ·c), g_series = g_wp·(g_up + g_dn)/(g_wp + g_up + g_dn). The steady chain is then the exact exponential profile, and steady output is exactly K_H·Δθ_H (log-mean) for any cell count and flow. At very low flow w is capped at ṁ·c/g_eff so the implicit coefficients stay non-negative (no water or screed temperature outside the range of its inlet, room and below temperatures); the cap only changes how closely the steady profile approximates the exponential where the outlet is already at the room temperature. Adaptive advances limit water and screed cells to 0.05 K per step, like radiator cells.

**Hydraulics.** `loops` identical parallel loops share the area and the flow. Each is a Darcy–Weisbach pipe of length A/(loops·T) and inner diameter D − 2s, with the engine's laminar / transition / Swamee–Jain friction at FLOORTEC's 0.007 mm roughness and the viscosity of the local water cells. Hydraulic dissipation heats the water.

**Surface temperature and limit [EN2, EN3].** The mean floor surface temperature is reported from the base curve, θ_F,m = θ_i + (q/8.92)^(1/1.1), with q the upward flux per heated area. The limit flux is q_G = 8.92·(θ_F,max − θ_i)^1.1 (100 W/m² at 29/20 °C). Above the configured maximum (29 °C occupied zone, 33 °C bathrooms, 35 °C perimeter zones) the module reports a warning. This uses the mean surface temperature as a conservative stand-in for EN 1264's maximum surface temperature, which lies above the pipes and is not resolved.

## Room boundary and Thermal Spaces

Room air and the space below come from the same resolution as every component (`resolveAmbient`):

- **Assigned to a Thermal Space (inherit).** Upward heat enters that room. The space below is the far side of the room's floor element: another room (the floor is that room's ceiling element), the [ground](GROUND.md), or outdoors. A room without a floor element uses its outdoor boundary. The heated area is **taken out of the floor element's conducting area**: the floor element now conducts room air to below only through the remaining area, and the loop's own downward path (R_u) crosses the heated part. A heated area larger than the floor element or the room is rejected.
- **Downward heat into a room below** is an internal exchange credited to that room (its readings list the loop as a device). It has its own implicit response in the room coupling.
- **Local override or outside any room.** The prescribed ambient stands for both the room and the space below; all heat goes to the external ambient ledger.

**On the ground.** When the floor element rests on the ground, downward loss crosses R_u plus the soil's EN ISO 13370 share R_g (from the same slab calculation, using the heated floor's own layers) to a fixed ground temperature, 10 °C by default as an assumption. R_u is then the construction only; do not include soil in it. A floor element left on the outdoor endpoint still loses to the outdoor air. Details, no-double-counting argument and scope: [GROUND.md](GROUND.md).

## Energy accounting

Water and screed enthalpy are part of the hydronic storage subtotal (water, steel, screed) of the energy panel. Heat to the room and below is internal when the destination is a room, external otherwise. No correction factor is applied; residuals stay at 10⁻⁴–10⁻² J over multi-day runs.

## Measurements and Inspector

Probes and sensors can read supply, return and mean water temperature, the mean exchange excess Δθ, heat to the room, downward loss, upward heat flux (W/m²), mean screed temperature, mean surface temperature, water heat input ṁ·c·(T_in − T_out), flow, pressures, Δp and loop velocity. The Inspector shows a supply/return/screed/surface/room history, the EN 1264 characteristic with the FLOORTEC points of the configured spacing and covering, the limit flux and the operating point, the readings above, stored heat above room air, and the provenance listing. The schematic face shades the 16 screed strips by their excess over the room air; a selected room's floor element states how much of it the loop covers.

## Behaviour

- **Warm-up.** The screed takes most of the heat at first: from 20 °C with 45 °C water the room receives under a quarter of the water's heat in the first hour, and steady output after 8–24 h. The time constant of the default floor at zero flow is about 6.6 h (screed 1.83 MJ/K over 77 W/K to room and below).
- **Storage.** After the pump stops or the flow temperature drops, the screed keeps heating the room for hours. In the heat-pump house the room holds 20 °C while the heat pump charges the hot-water cylinder, where the former equivalent pipe let it dip by 0.5 K.
- **Self-regulation.** Output is proportional to the water's excess over the room, so a warmer room (sun, gains) takes less heat without any valve action.

## Example

**Heat pump and underfloor heating** (and its cold-snap and buffer variants) heats the 120 m² single-zone house through the FLOORTEC tacker system at 100 mm spacing: twelve 100 m loops under the whole floor (R_λ,B 0.10, R_u 2.6 m²K/W for the insulation and slab), on a slab on the [ground](GROUND.md): the soil adds 1.44 m²K/W below R_u and the ground is at the assumed 10 °C, so about 0.5 kW goes down at 2 °C outdoors (1.15 kW when the floor faced the outdoor air). It replaces the earlier equivalent 60 m pipe with UA 520 W/K, which had no screed storage, no downward loss and no surface temperature. The floor starts near its steady state: 27 °C at 2 °C outdoors, 33 °C in the −15 °C cold snap. A trace follows the floor surface temperature.

## Calibration accuracy

[`validation/underfloor-heating.md`](../validation/underfloor-heating.md) is regenerated by `npm run validate:underfloor` (42 checks):

| Check | Points | Largest deviation |
| --- | --- | --- |
| EN 1264 characteristic (B fitted) against FLOORTEC 16 × 2, R_λ,B 0–0.15, T 100–300 mm | 20 | 0.53 W/m² (tables rounded to 1 W/m²) |
| Steady engine loop: q/Δθ_H against FLOORTEC q/Δθ | 8 | 0.7 % (the table q/20 K is itself rounded) |
| Downward loss against EN 1264's q_u with a 10 °C room below; lower room's credited heat | 2 | round-off |
| Pressure drop per loop against Colebrook–White (laminar and turbulent; not in transition) | 5 | 1.6 % (Swamee–Jain) |
| Zero-flow cool-down against the closed-form two-node solution | 2 | 0.002 K after 6 h |
| Timestep refinement of the warm-up, 8 → 1 s | 4 | first order (ratios 1.99, 2.02, 2.05) |
| Heat-pump house, 6 h: room temperature band and energy residual | 2 | residual 5·10⁻⁴ J |

The FLOORTEC tables are themselves EN 1264 calculations of a registered system, not independent laboratory measurements of each point; agreement verifies the characteristic, its transcription and its reproduction by the dynamic model. No transient (warm-up or cool-down) measurement was available: the dynamics follow from the screed and water capacities and the assumptions above.

`underfloor-heating.test.ts` runs in the release gate. It checks the FLOORTEC points, the catalog variants, the base curve, steady output and downward loss against the exact exponential profile (including hydraulic dissipation), reverse flow, the loop hydraulics, the analytic cool-down, inventories, warm-up conservation and bounds, low-flow bounds, first-order convergence, room and room-below coupling with the floor-element area, validation errors, save/load and the heat-pump house configuration.

## Remaining limitations

- **One node per strip.** Each cell's screed is one temperature at the pipe plane: no temperature wave through the screed thickness, no lateral conduction between strips (a serpentine floor's supply-to-return gradient is kept, a counter-flow spiral's averaging is not), no separate covering capacity.
- **Surface temperature.** Mean surface temperature by the base curve; the maximum above the pipes (EN 1264's θ_F,max) is not resolved, so the limit check is conservative only on average.
- **EN 1264 range.** Spacing 50–375 mm, D 8–30 mm, cover 15–65 mm, R_λ,B 0–0.15 m²K/W. Type A only: no dry systems (type B), no thin-screed systems, no wall or ceiling heating. Only the 16 × 2 FLOORTEC pipe is calibrated; other pipes use the EN 1264 standard B (6.7) or a user value, without the standard's pipe-conductivity correction.
- **Cooling.** Water below the room temperature uses the same characteristic; dew point and the different upward heat transfer coefficient of a cooled floor are not modelled.
- **Manifold.** Loops in one component are identical and share the flow equally. Unequal loops are separate components on a [heating circuit manifold](HEATING-MANIFOLD.md), one loop per circuit, balanced by its regulating inserts. Manifold connection pipes are separate pipe components.
- **Ground.** A fixed ground temperature with the ISO 13370 steady-state soil resistance: no seasonal swing, no soil storage, no basement or edge insulation ([GROUND.md](GROUND.md)).

The model is suitable for heating-system and control experiments (heat pumps, flow temperature, storage, room interaction). It is not a substitute for an EN 1264-3 design of a specific floor.
