# Thermostatic radiator valve

Add **Thermostatic radiator valve** from the Hydraulic library, insert it in series with the radiator and assign it to the radiator's Thermal Space. No electrical supply or automation wires are needed. Its **Thermostat dial** accepts 0 (❄), 1–5 and intermediate settings. The valve senses its assigned room's accepted temperature; a local ambient override takes precedence, and outside-room valves use the experiment environment.

The **Thermostatic radiator room** example includes a Bosch boiler, ALPHA2 circulator, Kermi panel radiator, TRV and a balanced minimum-flow bypass. The Bosch stays enabled and regulates its own 60 °C water target. The TRV regulates the room's radiator flow independently. A closed TRV isolates its radiator branch; it does not automatically stop the pump or disable the boiler. The example bypass is a fixed balancing restriction, not an automatic differential-pressure bypass valve.

## Reference and equations

The reference is a Danfoss **RA 2910 head with RA-FN 15 valve body**, using the manufacturer's [VDSXG202 data sheet](https://assets.danfoss.com/documents/latest/107294/AI006186403833en-010201.pdf), pages 3–7. This is a documented lumped reference model, not a certified digital twin.

| Dial | ❄ (0) | 1 | 2 | 3 | 4 | 5 |
| --- | --- | --- | --- | --- | --- | --- |
| Nominal room reference, °C | 7 | 13 | 17 | 20 | 23 | 26 |

Dial temperatures interpolate linearly between marks. The reference scale is specified at Xp = 2 K: at dial 3 the nominal flow coefficient is reached at 20 °C and closure occurs at 22 °C. A real proportional thermostat's equilibrium depends on heating load, water temperature and valve authority. The dial does not impose the room temperature.

Let `d = dial reference + 2 K − sensed air temperature`. The default RA-FN 15 interpolation is:

| d, K | 0 | 0.5 | 1 | 1.5 | 2 | 3 |
| --- | --- | --- | --- | --- | --- | --- |
| Kv, m³/h | 0 | 0.22 | 0.43 | 0.57 | 0.73 | 0.90 |

The 0.5–2 K points and maximum Kvs = 0.90 m³/h are published values. Interpolation is linear; reaching full lift at 3 K is an explicit extrapolation assumption. Changing Kvs scales this reference curve. Zero opening gives exact isolation; the fully open stuck-valve fault uses Kvs.

The existing hydraulic network solves `Q [m³/h] = Kv × sqrt(|Δp| / 100000 Pa)`, with the sign of the pressure difference. The valve is a passive restriction, so hydraulic dissipation retains its existing destination in the fluid energy ledger. It creates no heat or energy supply. The default extra laminar coefficient is zero to reproduce the published turbulent Kv relationship; an editable nonzero value adds the existing two-K viscous correction. Diameter is an assumed DN15 reference bore for velocity and viscous terms, not a measured internal throat.

Sensed temperature follows `dTs/dt = (Tair − Ts) / τ`, integrated with the exact exponential for each held ambient interval. **τ = 600 s is an editable modeling assumption**, not a manufacturer response-time claim. The state advances only on accepted multiphysics intervals, is checkpointed for rollback, and is reconstructed by deterministic saved-run replay. Adaptive steps are bounded by min(5 s, τ/20); existing Bosch timing and protection limits remain unchanged.

## Readings, ratings and limits

The canvas shows the dial/reference temperature and effective opening. **Position means 100 × Kv/Kvs, not measured stem travel**; this quantity is available in the existing Inspector and telemetry. The head tooltip and Inspector also show sensed temperature and closure temperature.

Published body ratings are 10 bar working pressure, 0.6 bar maximum regulating differential pressure and 120 °C water temperature. The reference data recommends no more than 30–35 kPa for quiet operation. Rating exceedances are reported; valve deformation, noise and pressure-dependent calibration shifts are not simulated. The engine's existing liquid-water limits still apply to other components.

The fixed 2 K reference-band approximation is retained across the dial, including frost; the manufacturer's reduced band at low settings is not resolved. Mechanical friction hysteresis, bellows forces, head heating from nearby pipes, draughts, mounting orientation and sensor thermal energy storage are omitted. The sensor is an ideal measurement lag, not a thermal mass. Frost protection requires an available warm-water supply. No control wire or nominal heater power directly changes room temperature.

## Validation

Focused verification covered the manufacturer dial and Kv points, exact closure, first-order lag, timestep refinement, room/global/override sensing, refresh, accepted-state rollback, stuck faults, pressure ratings, configuration persistence and deterministic replay. The existing hydraulic, valve-characteristic, room coupling, environment, sandbox and learning regression files also passed: 324 unique tests across focused runs. Production build and browser tests cover library creation, dial changes, room assignment, export/import and the prior thermostat label fix. The full release gate was not rerun.

A manual end-to-end run of the unmodified example advanced one hour in 59.0 s on the development host. Room air went from 20.00 to 20.28 °C, with initial cold-circuit cooling, and effective Kv/Kvs fell from 0.811 to 0.740. After selecting frost and advancing another 15 minutes, the radiator branch had zero flow, boiler water was 53.83 °C and bypass/boiler circulation was 4.97 L/min. No protection faults or rating violations occurred. Mass residual was zero; the largest recorded absolute energy residual was 0.000068 J. These observations validate operation over that run, not a guarantee of an exact steady room temperature or performance on other hardware.
