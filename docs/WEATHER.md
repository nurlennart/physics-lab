# Weather

A project can let the outdoor air follow a **simulated clock** instead of one fixed ambient temperature. This first step (phase 1a) covers outdoor air temperature and humidity over a design day. Sun, panels and recorded weather data come later as further kinds of the same weather model. Code: `src/simulation/weather.ts`; tests: `src/simulation/weather.test.ts`; example: **Heat pump through a January day**.

## What is modelled, and what is not

| Part | Status |
| --- | --- |
| Outdoor air temperature over the day | ASHRAE design-day profile between a daily minimum and maximum. |
| Outdoor humidity | Constant dew point through the day; relative humidity follows from it. |
| What follows the weather | The experiment environment: every boundary that inherits it (components outside rooms, room envelopes facing outdoors, the heat pump's outdoor coil, including its humidity). |
| What does not | Rooms (they have their own temperature), components with a local ambient override, room boundaries with their own outdoor temperature, and the ground (its own model, see [GROUND.md](GROUND.md)). |
| Not modelled yet | Sun position and sunlight, solar gains through windows, panel conditions (phase 1b); clouds, wind, rain and recorded weather data (phase 3). |

Weather is **opt-in**. Without it, the experiment ambient stays fixed exactly as before: every existing example produces byte-identical results.

## Data and provenance

| Quantity | Method | Class |
| --- | --- | --- |
| Air temperature profile | Fraction of the daily range below the maximum at each full hour (ASHRAE Handbook—Fundamentals design day; also EnergyPlus' default temperature range multipliers), linear between full hours. Minimum at 05:00, maximum 14:00–15:00. | Published method |
| Daily minimum and maximum | Chosen values; default −5 / 3 °C, a cold clear January day in central Europe | **Assumption** |
| Humidity | Constant dew point; relative humidity = e_s(T_dew)/e_s(T) with the Magnus formula (WMO 2008), the same form the heat pump uses for frost | Published method |
| Dew point | Chosen; default equal to the daily minimum, so the air saturates at dawn | **Assumption** |
| Clock | Simulated time 0 is the start time, in local standard time; ASHRAE tabulates solar time | **Assumption** |

```
T(h) = T_max − f(h)·(T_max − T_min),   f = 0.88, 0.92, 0.95, 0.98, 1.00, 0.98, 0.91, 0.74, 0.55, 0.38, 0.23, 0.13,
                                             0.05, 0.00, 0.00, 0.06, 0.14, 0.24, 0.39, 0.50, 0.59, 0.68, 0.75, 0.82  (01:00 … 24:00)
RH = 100 · e_s(T_dew) / e_s(T),   e_s(t) = 611.2 · exp(17.62·t / (243.12 + t)) Pa
```

## Engine

- **Runtime value, not a project edit.** The engine binds the weather at each step's midpoint to its own copy of the project. Boundaries read it through `projectAmbient`, the single function every outdoor boundary already uses. The project file holds only the weather settings; undo, saves and replays are unaffected, and replays reproduce the run because the weather is a pure function of simulated time.
- **Step limits.** During adaptive advances, at most the adaptive tolerance (0.05 K) of outdoor temperature change per step, and steps end at every full hour, where the profile's slope changes. With the midpoint value this integrates a body losing heat outdoors to within 0.02 K of the exact solution over a day.
- **Energy.** Outdoors remains an ideal external boundary. A changing boundary does not revalue stored heat; every exchange with it is booked as before.
- **Heat pump humidity.** A heat pump whose air comes from the experiment environment takes the weather's relative humidity for frost and coil drying. Inside a room or under a local ambient override it keeps its own *Outdoor relative humidity*. Its Inspector marks the value "(weather)", and it can be traced as *outdoor air temperature/humidity at the coil*.
- **Settings.** The experiment environment panel switches *Outdoor conditions* between *Fixed* and *Design day* and holds the start time, daily minimum, maximum and dew point; the status bar shows the clock and the outdoor temperature. **Manage traces → Outdoors** charts the experiment environment itself in any project: the outdoor air (the fixed ambient without weather) and, with weather, its relative humidity. Weather settings can change during a run like the fixed ambient. Scored assignments run at a fixed ambient and reject weather.

## Example: Heat pump through a January day

The heat-pump house ([HEAT-PUMP.md](HEAT-PUMP.md)) under the default design day from midnight. Measured over 24 simulated hours with weather on:

- The air reaches −5 °C at 05:00 with 100 % relative humidity, and 3 °C at 56 % in the afternoon.
- Six defrosts, all in the cold, humid hours: at about 01:55, 03:30, 05:00, 06:35, 08:30 and 23:50.
- The COP runs from about 2.5 before dawn to 4.7 at 15:00; the house holds 20–22 °C.
- No errors or warnings; the energy residual stays at 0.001 J.

A simulated day takes about 40 s in Node (17,000 steps): the heat pump bounds steps by its own rates ([HEAT-PUMP.md](HEAT-PUMP.md)); with the earlier fixed 0.5 s bound it took about five minutes.

## Validation

`weather.test.ts`:

- **Profile.** At every quarter hour of a day, against the published hourly table entered in the test; exact minimum at 05:00 and maximum at 14:00 and 15:00.
- **Clock.** A start time offsets the profile; it repeats every 24 h; the clock label rolls into day 2.
- **Humidity.** Saturated at dawn when the dew point equals the minimum; the afternoon value against the Magnus formula (55.72 % at 3 °C with a −5 °C dew point).
- **Engine.** A lumped body losing heat outdoors over a full day matches the exact solution of C·dT/dt = −G·(T − T_air(t)), integrated segment by segment over the published profile, within 0.02 K; steps end on every full hour; the energy residual stays below 1 mJ. A project without weather is unchanged.
- **Heat pump.** Its inputs carry the weather's temperature and humidity outdoors, and its own values under a local override.
- **Files.** Weather round-trips through save and load; invalid days (minimum above maximum, dew point above the minimum, start time outside 0–24 h) are rejected; assignments reject weather.
