# Weather

A project can let the outdoor air and the sun follow a **simulated clock** instead of one fixed ambient temperature: a design day at a site and date, with outdoor air temperature and humidity (phase 1a) and the sun's position and clear-sky sunlight on solar panels (phase 1b). Clouds and recorded weather data come later as further kinds of the same weather model. Code: `src/simulation/weather.ts`, `src/simulation/sun.ts`; tests: `weather.test.ts`, `sun.test.ts`; examples: **Heat pump through a January day**, **Off-grid solar through a June day**.

## What is modelled, and what is not

| Part | Status |
| --- | --- |
| Outdoor air temperature over the day | ASHRAE design-day profile between a daily minimum and maximum. |
| Outdoor humidity | Constant dew point through the day; relative humidity follows from it. |
| What follows the weather | The experiment environment: every boundary that inherits it (components outside rooms, room envelopes facing outdoors, the heat pump's outdoor coil, including its humidity). |
| What does not | Rooms (they have their own temperature), components with a local ambient override, room boundaries with their own outdoor temperature, and the ground (its own model, see [GROUND.md](GROUND.md)). |
| Sun and sunlight | Sun position for the site, date and clock; clear-sky sunlight (direct and diffuse); sunlight on each solar panel that follows the weather, by its tilt and orientation, and its cell temperature from the outdoor air. |
| Not modelled yet | Solar gains through windows and on walls (rooms do not see the sun yet), shading by buildings or terrain, daylight saving time; clouds, wind, rain and recorded weather data (phase 3). |

Weather is **opt-in**. Without it, the experiment ambient stays fixed exactly as before: every existing example produces byte-identical results.

## Data and provenance

| Quantity | Method | Class |
| --- | --- | --- |
| Air temperature profile | Fraction of the daily range below the maximum at each full hour (ASHRAE Handbook—Fundamentals design day; also EnergyPlus' default temperature range multipliers), linear between full hours. Minimum at 05:00, maximum 14:00–15:00. | Published method |
| Daily minimum and maximum | Chosen values; default −5 / 3 °C, a cold clear January day in central Europe | **Assumption** |
| Humidity | Constant dew point; relative humidity = e_s(T_dew)/e_s(T) with the Magnus formula (WMO 2008), the same form the heat pump uses for frost | Published method |
| Dew point | Chosen; default equal to the daily minimum, so the air saturates at dawn | **Assumption** |
| Clock | Simulated time 0 is the start time on the date, in local standard time (UTC offset, no daylight saving); ASHRAE tabulates solar time | **Assumption** |
| Sun position | NOAA solar calculator after Meeus (*Astronomical Algorithms*), with NOAA's refraction correction | Published method |
| Clear-sky sunlight | Ineichen–Perez (2002) global, direct and diffuse irradiance, implemented as in pvlib-python (no Perez enhancement); Kasten–Young air mass, station pressure from altitude, Spencer extraterrestrial irradiance (1366.1 W/m²) | Published method |
| Linke turbidity | Haze of the clear sky; default 3 (winter), 4 in the June example | **Assumption** |
| Sunlight on a panel | Isotropic sky (Liu–Jordan): beam × cos θ + diffuse × (1 + cos β)/2 + global × albedo × (1 − cos β)/2 | Published method |
| Ground albedo | Default 0.2 (grass) | **Assumption** |
| Cell temperature | NOCT model: T_cell = T_air + (NOCT − 20 °C) · G/800 W/m²; NOCT 43 °C from the Trina datasheet | Published method, **manufacturer** NOCT |
| Default site | Munich: 48.14° N, 11.58° E, 520 m, UTC+1 | Chosen |

```
T(h) = T_max − f(h)·(T_max − T_min),   f = 0.88, 0.92, 0.95, 0.98, 1.00, 0.98, 0.91, 0.74, 0.55, 0.38, 0.23, 0.13,
                                             0.05, 0.00, 0.00, 0.06, 0.14, 0.24, 0.39, 0.50, 0.59, 0.68, 0.75, 0.82  (01:00 … 24:00)
RH = 100 · e_s(T_dew) / e_s(T),   e_s(t) = 611.2 · exp(17.62·t / (243.12 + t)) Pa
GHI = c_g1 · I₀ · cos Z · exp(−c_g2 · AM · (f_h1 + f_h2 · (T_L − 1)))          (Ineichen–Perez)
G_panel = DNI · max(0, cos θ) + DHI · (1 + cos β)/2 + GHI · ρ · (1 − cos β)/2
T_cell = T_air + (NOCT − 20) · G_panel / 800
```

## Engine

- **Runtime value, not a project edit.** The engine binds the weather at each step's midpoint to its own copy of the project. Boundaries read it through `projectAmbient`, the single function every outdoor boundary already uses. The project file holds only the weather settings; undo, saves and replays are unaffected, and replays reproduce the run because the weather is a pure function of simulated time.
- **Step limits.** During adaptive advances, at most the adaptive tolerance (0.05 K) of outdoor temperature change per step, and steps end at every full hour, where the profile's slope changes. With the midpoint value this integrates a body losing heat outdoors to within 0.02 K of the exact solution over a day.
- **Energy.** Outdoors remains an ideal external boundary. A changing boundary does not revalue stored heat; every exchange with it is booked as before.
- **Solar panels.** A panel's *Sunlight and cell temperature* is *Fixed values* (its own irradiance and cell temperature, as before) or *From weather*: with weather in force it takes the sunlight on its plane (tilt, orientation) and the NOCT cell temperature over the outdoor air (or its local ambient override). The weather reaches the PV model through the electrical solve, so it also holds inside the expanded network of hybrid systems. The incident sunlight that the energy ledger books follows the same values. While panels follow the weather, steps change the global irradiance by at most 1 % (at least 5 W/m²). The panel face and Inspector show the live conditions; *sunlight on the module plane* and *cell temperature* can be traced.
- **Heat pump humidity.** A heat pump whose air comes from the experiment environment takes the weather's relative humidity for frost and coil drying. Inside a room or under a local ambient override it keeps its own *Outdoor relative humidity*. Its Inspector marks the value "(weather)", and it can be traced as *outdoor air temperature/humidity at the coil*.
- **Settings.** The experiment environment panel switches *Outdoor conditions* between *Fixed* and *Design day* and holds the start time, daily minimum, maximum, dew point, date, latitude, longitude and UTC offset, with altitude, Linke turbidity and ground albedo under *Sky and site*; the status bar shows the clock, the outdoor temperature and the sun's elevation. **Manage traces → Outdoors** charts the experiment environment itself in any project: the outdoor air (the fixed ambient without weather) and, with weather, its relative humidity, the sun's elevation and the clear-sky global irradiance. Weather files from before the site existed take the defaults (Munich, 15 January). Weather settings can change during a run like the fixed ambient. Scored assignments run at a fixed ambient and reject weather.

## Example: Heat pump through a January day

The heat-pump house ([HEAT-PUMP.md](HEAT-PUMP.md)) under the default design day from midnight. Measured over 24 simulated hours with weather on:

- The air reaches −5 °C at 05:00 with 100 % relative humidity, and 3 °C at 56 % in the afternoon.
- Six defrosts, all in the cold, humid hours: at about 01:55, 03:30, 05:00, 06:35, 08:30 and 23:50.
- The COP runs from about 2.5 before dawn to 4.7 at 15:00; the house holds 20–22 °C.
- No errors or warnings; the energy residual stays at 0.001 J.

A simulated day takes about 40 s in Node (17,000 steps): the heat pump bounds steps by its own rates ([HEAT-PUMP.md](HEAT-PUMP.md)); with the earlier fixed 0.5 s bound it took about five minutes.

## Example: Off-grid solar through a June day

The off-grid system ([SOLAR-ENERGY.md](SOLAR-ENERGY.md)) with its module tilted 30° to the south, under a clear 21 June in Munich (12/25 °C, dew point 10 °C, Linke turbidity 4), from 06:00. Measured over 24 h from midnight:

- The sun rises at about 04:15 standard time (05:15 summer time), stands 65.1° high at 12:00 (90° − 48.14° + 23.44° = 65.3° at solar noon, a few minutes later) and sets at about 20:10; the global irradiance peaks at 897 W/m².
- The module gives up to 402 W at noon, about 11 % below its 450 W rating with the cell near 52 °C; 3.27 kWh over the day.
- The battery falls to 17 % by 07:00, reaches 80 % at 17:00 and ends the day at 49 %.
- No errors or warnings; energy residual 2·10⁻⁷ J. A simulated day takes about 85 s in Node.

## Validation

`sun.test.ts`:

- **Sun position.** The NREL Solar Position Algorithm worked example (Reda & Andreas 2004: zenith 50.11162°, azimuth 194.34024°) within 0.01°; the model gives 50.1086° and 194.3426°. The noon sun over Munich at 90° − φ ± 23.44° at both solstices.
- **Clear sky.** pvlib-python's published Ineichen test values, entered as numbers: the scalar case, the 1370 W/m² and 2000 m cases, and the full 3 × 3 × 3 grid of zenith, air mass and turbidity (27 points, each GHI, DNI and DHI), all to 10⁻⁵ W/m². No sunlight below the horizon.
- **Panel plane.** A flat panel sees exactly the horizontal sunlight; a panel facing the sun the direct beam in full; a vertical north face only sky and ground light.
- **Cell temperature.** The datasheet NOCT point, withheld from the PV fit: 43 °C cell at 800 W/m² and 20 °C air, and 335.3 W (Trina: 344 W, −2.5 %), Voc 49.94 V (50.2 V, −0.5 %), Isc 8.654 A (8.66 A).
- **Engine and files.** The June example gives over 300 W around noon and nothing at night with a closed energy ledger; weather files without a site remain valid and take the defaults; invalid dates, latitudes, offsets, turbidities and albedos are rejected.

`weather.test.ts`:

- **Profile.** At every quarter hour of a day, against the published hourly table entered in the test; exact minimum at 05:00 and maximum at 14:00 and 15:00.
- **Clock.** A start time offsets the profile; it repeats every 24 h; the clock label rolls into day 2.
- **Humidity.** Saturated at dawn when the dew point equals the minimum; the afternoon value against the Magnus formula (55.72 % at 3 °C with a −5 °C dew point).
- **Engine.** A lumped body losing heat outdoors over a full day matches the exact solution of C·dT/dt = −G·(T − T_air(t)), integrated segment by segment over the published profile, within 0.02 K; steps end on every full hour; the energy residual stays below 1 mJ. A project without weather is unchanged.
- **Heat pump.** Its inputs carry the weather's temperature and humidity outdoors, and its own values under a local override.
- **Files.** Weather round-trips through save and load; invalid days (minimum above maximum, dew point above the minimum, start time outside 0–24 h) are rejected; assignments reject weather.
