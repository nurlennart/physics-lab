# Ground under Thermal Spaces

A floor element can rest on the **ground** instead of facing outdoor air or another room. This page covers that endpoint, the boundary behind it, the EN ISO 13370 slab-on-ground transmittance and how underfloor heating loses heat into the ground. Code: `src/simulation/ground.ts`; tests: `src/simulation/ground.test.ts`.

## What is modelled, and what is not

| Part | Status |
| --- | --- |
| `ground` endpoint for floor elements | Implemented. Walls, ceilings, windows and doors cannot face the ground. |
| Boundary behind it | **Simplified:** one fixed temperature for the whole project. It stands for the annual mean external temperature that EN ISO 13370's steady-state method uses. |
| Slab-on-ground U-value | EN ISO 13370 steady-state formula for a slab on ground (characteristic dimension B′, total equivalent thickness d_t), uniform over the floor. |
| Underfloor heating on the ground | Downward loss crosses the loop's own R_u plus the soil's share of the same ISO 13370 calculation, to the ground temperature. |
| **Not modelled** | Seasonal (periodic) heat flow, soil heat storage and time lag, basements and suspended floors, edge insulation, thermal bridges at the wall/floor junction (ψ), groundwater. |

This is **not a complete EN ISO 13370 calculation**. ISO 13370 adds a periodic part to the steady heat flow: in winter the heat flow into the ground is above the steady value, and in summer below it, lagging the outdoor temperature by one to two months. Here the ground stays at one temperature, so winter ground losses are somewhat understated. For runs lasting hours to days that is a good approximation, because the soil under a slab responds over months. Seasonal studies are outside its scope.

## Ground temperature: an explicit assumption

`project.ground = { kind: 'fixed', temperature }`. When it is absent, the ground is at **10 °C**. That is an assumed annual mean outdoor temperature for central Europe (the German 1991–2020 mean is about 9–10 °C), **not** a site value and not universally right. Set it to your site's annual mean outdoor air temperature. The room inspector shows the value, says when the default is in use, and offers it for editing whenever a floor in that room rests on the ground. The ground temperature is project-wide (one building, one soil), unlike the per-room outdoor override.

## EN ISO 13370 slab on ground

For a floor area A with exposed perimeter P, wall thickness w, floor-layer resistance R_f and soil conductivity λ:

```
B′  = A / (½·P)                                   characteristic dimension
d_t = w + λ·(R_si + R_f + R_se)                   total equivalent thickness, R_si 0.17, R_se 0.04 m²·K/W
U   = 2λ/(π·B′ + d_t) · ln(π·B′/d_t + 1)          d_t < B′  (uninsulated or moderately insulated)
U   = λ/(0.457·B′ + d_t)                          d_t ≥ B′  (well insulated)
```

- **λ = 2.0 W/(m·K)** is the ISO default when the soil is unknown (category 2, sand or gravel). Clay or silt is 1.5 and homogeneous rock 3.5.
- **Wall thickness** defaults to 0.3 m.
- **Perimeter** defaults to the room's whole perimeter, which suits a single-zone building. For a room that is part of a larger slab, enter only its exposed perimeter.
- R_f covers every floor layer, without the surface resistances.

**Two ways to set a floor's U-value.** Both apply to a floor facing the ground.

1. **Entered U-value** (the default when you switch a floor to the ground). The number you type is used as is, and it must already include the soil.
2. **EN ISO 13370 from floor layers.** Give R_f, and U is calculated from the inputs above. The U field then becomes read-only.

The perimeter, wall thickness and soil conductivity are still used in the first case for any underfloor heating on that floor.

The resulting U applies uniformly to the floor's conducting area. ISO 13370 gives an area-averaged value: the edge zone loses more and the centre less, and this model does not resolve that.

## Underfloor heating on the ground (no double counting)

A loop on a floor that faces the ground loses heat downward through:

```
R_down = R_u + R_g
R_g    = 1/U(d_t of the heated floor) − R_si − R_f,heated      soil (and external surface) share
R_f,heated = s_u/λ_E + R_λ,B + R_u                             layers above and below the pipes
```

- **R_u** (`downwardResistance`) is the construction under the pipes only: insulation and slab, with no soil and no surface resistance. Do not put soil into R_u, because R_g is added automatically.
- **R_g** comes from the same ISO 13370 calculation, with B′ from the whole slab (gross floor area and exposed perimeter) and d_t from the heated floor's own layers. Adding it once under those layers reproduces that U exactly. The test suite checks this identity.
- **The element's own U-value** applies only to the unheated part of the floor. The heated area is removed from the element's conducting area, as it is for any [underfloor loop](UNDERFLOOR-HEATING.md). Each square metre of floor is therefore counted once: either through the loop's R_u + R_g, or through the element's U.
- **Surface convention.** Above the pipes EN 1264 uses its own surface coefficient (1/10.8 = 0.093 m²·K/W), where ISO 13370 uses R_si = 0.17 for downward flow. A cold loop's whole floor-to-ground path therefore differs from the ISO U by those 0.077 m²·K/W. This is documented, not hidden.
- **Calibration is unaffected.** The EN 1264 characteristic (upward flux) is unchanged. The water-to-plane conductance is still calibrated so that q = K_H·Δθ_H with the space below at room temperature, now with R_down in place of R_u.

The underfloor inspector states the soil resistance and the ground temperature for a loop on the ground.

## Energy ledger and readings

- Heat a room loses through a ground floor is reported as **ground loss** (`groundLoss`, W), separately from envelope (outdoor-air) loss and ventilation. It is chartable and shown on the canvas overlay.
- A loop's downward loss to the ground stays in its **Loss downwards** reading.
- Both leave the system as ambient energy, like envelope losses. The energy residual closes as before.

## Extending it

The endpoint and the boundary are separate on purpose.

- **Elements** only ever name `ground`.
- **Temperatures** come from `groundTemperature(project)`, and the extra resistance under a loop from `belowBoundary()`.

Adding a richer ground means:

- **Seasonal boundary** (ISO 13370 periodic method or a sine of the annual swing): add a `GroundModel` variant, for example `{ kind: 'seasonal', mean, amplitude, phase, lag }`. Give `groundTemperature` the simulation time, and bind it the way room temperatures are bound (`bindSpaceTemperatures`). Saved files with `kind: 'fixed'` stay valid.
- **Dynamic soil** (one or more soil nodes with capacity under each slab): add a variant whose state rows join the room matrix (`roomMatrix`/`advanceSpaceThermal`) as extra unknowns. Ground-facing elements and loops then exchange with those nodes instead of a fixed value.
- **Basements, suspended floors and edge insulation**: add further ISO 13370 cases next to `slabTransmittance`, selected by a field on `SlabOnGround`.

`groundModelError` rejects unknown kinds today, so an older build refuses a newer file rather than misreading it.

## Validation

`src/simulation/ground.test.ts`:

- **Published reference:** the Physibel knowledge-base case study (12 × 9 m building, λ 2.0, d_t 3.736 m) gives U_g = 0.336 W/(m²·K) by the ISO 13370 simplified method. The model gives 0.3363.
- **Independent calculations:** three further cases cover both branches. The test holds each as a number computed separately from the standard's formulas, to 1e-6. Further checks: monotonic in R_f and perimeter, and the two branches meet within 6 % at d_t = B′ (the ISO expressions are not exactly continuous).
- **Soil split:** for each R_f, R_si + R_f + R_g reproduces 1/U to 1e-12.
- **Room on the ground:** the room reaches the analytic steady state θ = θ_g + Q/(U·A), with the outdoor air at −10 °C making no difference. Ground loss equals the gain, envelope loss is zero and the energy residual stays below 1e-6 J.
- **Underfloor on the ground:**
  - At every step the reported downward loss equals Σ(A/16)·(S_k − θ_g)/(R_u + R_g). Here R_g is entered as an independently calculated number and S_k is each screed node; the match is 1e-12 relative.
  - In the steady state, q_u = (R_o·q + θ_i − θ_g)/(R_u + R_g).
  - Ambient energy rises by exactly the integrated downward loss.
  - With a partly heated slab, the room's ground loss equals U·(unheated area)·(θ − θ_g) at every step.
  - The energy residual stays below 0.05 J.
- **Compatibility:**
  - Existing projects load unchanged: no `ground` field appears, floors stay on outdoor air and every U is the entered one.
  - Validation errors cover ground on walls, slab data off the ground, bad soil, ground temperatures out of range and unknown models.
  - The ground model and slab data round-trip through save and load.

`e2e/thermal-spaces.spec.ts`: switching a floor to the ground, the ISO 13370 U-value in the inspector, editing the ground temperature and the ground-loss reading.

## Effect on the heat-pump house

The heat-pump starters (house, cold snap, buffer) now put the 120 m² slab on the ground. Nothing else in them changed: R_u stays 2.6 m²·K/W.

- **Soil resistance:** B′ = 5.45 m, the heated floor's R_f = 2.74 m²·K/W and d_t = 6.20 m (≥ B′), so R_g = 1.44 m²·K/W. The loop's downward path is 4.04 instead of 2.6 m²·K/W.
- **Boundary:** 10 °C instead of the outdoor air.

`validation/heat-pump.md` (section 3) compares the same scenarios with the floor on outdoor air (the previous model) and on the ground. The figures are in [HEAT-PUMP.md](HEAT-PUMP.md#ground-model-effect).
