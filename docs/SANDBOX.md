# Sandbox: parameters, editing and presets

In sandbox projects (every project that is not a challenge) each implemented engineering parameter is editable through metadata. Scored challenges keep their catalog, environment and budget locks. The generated [PARAMETER-MATRIX.md](PARAMETER-MATRIX.md) lists every parameter with its policy, domain and challenge lock.

## Three kinds of limit

| Kind | Where it lives | When reached |
| --- | --- | --- |
| **Validity** (what the model can represent) | `ParamSpec.domain` in `parameters.ts`; `componentError()` in `integrity.ts` for dependencies between parameters | The edit or import is rejected with the reason, e.g. "Liquid-water model: … 1–95 °C" or "ε/D above 0.05 is outside the friction-factor correlation" |
| **Rating** (possible, but out of specification) | Ordinary parameters: `ratedPower`, `ratedCurrent`, `ratedVoltage`, `maxPressure`, `maxTemperature`, `maxSpeed`, `ratedTorque`, … | Operation continues; the engine reports a rating violation and marks the component `OVERLOADED`. Failures follow only modelled mechanisms (over-temperature, fuse melting, breaker and supply trips) |
| **Challenge restriction** (gameplay) | `challengePolicies`, `catalogError()` and the challenge-only sets in `integrity.ts` | Applies only when `project.challenge` is set: ratings, source behaviour, environment and budget are locked to purchased catalog models |

Limits kept on purpose, each a model limit:

| Limit | Reason |
| --- | --- |
| Water 1–95 °C, vented tanks | Liquid-water model without boiling, freezing or gas headspace |
| 100 components, 300 connections, 250 electrical unknowns, 120 hydraulic branches, 200 hydraulic nodes | Dense direct solvers on the browser main thread |
| Spatial forces ≤ 10⁵ N, torques ≤ 10⁴ N·m | Stability envelope of the rigid-body solver |
| Source setpoint ≤ its maximum output voltage (itself up to 1 MV) | Dependency between parameters |
| Pipe roughness ε/D ≤ 0.05 | Validity of the friction correlation |
| R(T) must stay positive | Linear temperature-coefficient model |

## Parameter system

`ParamSpec` (`parameters.ts`) holds key, label, description, SI unit, display conversion (Pa↔bar, m³/s↔L/min, rad/s↔RPM, m↔mm), group, policy, validity domain with reason, typical range, options, whether the solver uses it, and derivation inputs. Per-kind overrides give shared keys their meaning; for example a heater's `ratedVoltage` is its nominal voltage, not a limit.

`applyDerived()` recomputes derived values after every edit, preset, variant change and import; `derivedError()` rejects contradictory raw projects. Examples of derived values: heater R = V²/P, cable R₂₀ = ρL/A and ampacity-calibrated UA, tank UA from insulation, k_e ≡ k_t for DC motors.

### Editing policy

| Policy | Meaning |
| --- | --- |
| **live** | Conservation-safe at any time, e.g. resistance, source setpoint, valve opening, controller gains, ambient |
| **reset** | Defines stored energy (C·T, ½Jω², ½CV², mass, potential), geometry or initial state, e.g. capacitance, inductance, battery capacity, chemistry and polarization branch; rejected after t = 0 with an explanation |
| **calc** | Derived, read-only |
| **fixed** | Constant of the implemented model |
| *info* | Metadata not used by any equation (e.g. pipe conductivity) |

The engine's `physicsSignature` excludes exactly the live keys (and derived keys whose inputs are all live), so a live edit never injects or removes energy. A target assignment for a sensor requires Reset.

### Inspector

- Groups: Operating controls, Engineering configuration, Ratings & protection, Thermal properties, Initial state, Advanced model (collapsed).
- "Operation vs ratings" bars compare actual and rated power, current, voltage, temperature rise and pressure, plus the CV/CC state.
- "Calculated from configuration" shows values such as heater R and rated current, cable voltage drop, tank energy per 10 K and cooling time constant, motor no-load speed and stall current, pump power figures.
- Inputs accept engineering notation (`30k`, `4.7M`, `100m`, `2,5`, `1e-3`) with units inline. Locked fields show the reason; values outside the typical range show a hint but are allowed. Tooltips give description, domain, typical range, policy and catalog default.

## Time advancement

Sandbox experiments can **Advance** by +1 s, +10 s, +1 min, +10 min, +1 h, +6 h or +24 h. Without moving rigid bodies this uses the event-aware adaptive integrator (see [PHYSICS.md § Time integration](PHYSICS.md#time-integration)); rigid-body scenes advance in fixed steps. Progress is shown with Stop; the state reached so far is kept and recorded. Speeds go up to 60×. An ADAPTIVE/FIXED indicator explains which integrator applies. Adaptive advances are recorded inputs and replay bit-identically.

## Presets, catalog variants and cost

- **Catalog variants** are purchasable models, also valid in challenges: heaters from 100 W to 100 kW, supplies from a 30 V / 5 A CV/CC laboratory unit to 800 V / 250 A, tanks to 10,000 L, motors to 75 kW, pumps to 3,000 L/min, electric circulators (230 V heating, 12 V DC solar), Kermi therm-x2 panel radiators (types 11, 22 and 33; sandbox only), fuses to 250 A, breakers to MCCB 250 A, a 250 A contactor and more.
- **Built-in presets** are sandbox starting points grouped Laboratory, General-purpose, Industrial and High-capacity.
- **User presets:** "Save as preset" in the Inspector, then apply, rename and delete. They are stored on the device and exported or imported as `physics-lab-presets` v1 JSON from the File menu; every preset is validated on load. Components remember their preset name for display only.
- **Cost:** a catalog configuration costs its catalog price. A custom configuration is estimated with the six-tenths rule on its sizing quantity relative to the closest catalog model of the same kind (cables: linear in conductor volume), with a floor of 25 % of that price, and labelled "Estimated cost (custom sizing)". Challenges reject custom configurations before costing. The cost model is an explainable estimate, not market pricing.

Definition, configuration and runtime state stay separate: the catalog defines kinds and ports, a component instance holds its properties plus derived values, and the engine holds temperatures, inventories and controller memory.

## Persistence

New keys are additive: `migrateComponent` fills them from the variant-aware catalog (a legacy heater gets the nominal voltage that reproduces its stored resistance, √(R·P)). Derived values are re-derived on import. Unknown properties are rejected by name. The project `environment` (ambient temperature) and the preset label are validated and saved. Undo and redo cover parameter edits, presets and reset-to-default.


## Experiment environment

The Inspector defaults to **Inherit experiment ambient**. Select **Local ambient override** to expose a local boundary temperature; the effective value and its source are displayed beside thermal properties. Global edits apply to inherited boundaries immediately. A live environment edit changes heat exchange without resetting stored temperatures or energy. Initial water/solid temperatures and controller setpoints remain independent. Coolant presets deliberately select a local override for their ideal coolant reservoir.

Legacy projects with a stored `ambient` and no `ambientMode` retain that value as an explicit override, including 20 °C: the file cannot distinguish a chosen boundary from a catalog default. Components that previously had no local ambient inherit. Project and preset round trips preserve the mode; reset-to-default restores inheritance. See [the environment model and audit](ENVIRONMENT.md).
