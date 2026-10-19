# Physics Lab

A browser engineering sandbox. Build circuits, heating systems, pumped water networks, motor drives and physical mechanisms from about 60 component kinds, wire them by their terminals, and run them on one coupled, energy-conserving simulation.

- **Electrical:** DC and AC (phasor) networks, single- and three-phase supplies, batteries, dynamic capacitors and inductors, transformers, filament lamps, cables, fuses, breakers, relays and contactors.
- **Solar energy:** nonlinear PV panels, independent MPPT charge controllers, LiFePO4 storage with BMS, DC/AC inverters and downstream protection; four connectable examples with energy accounting and linked datasheet provenance ([models and limitations](docs/SOLAR-ENERGY.md)).
- **Thermal:** a Bosch Compress 6800i AW 7 OR-S air-to-water heat pump (R290, inverter compressor, COP from outdoor air, flow temperature and load, frost and reverse-cycle defrost, backup heater); a Bosch Tronic Heat 3000 9 reference electric boiler with staged mains loading, internal water/element inertia and manual-reset protection; Kermi therm-x2 panel radiators with their registered EN 442 output, water and steel inventory and charted pressure drop; wet-screed underfloor heating with the EN 1264 characteristic calibrated to the FLOORTEC tacker system, screed heat storage, downward loss and floor surface temperature; stratified Bosch buffer tanks and hot-water cylinders with coils; membrane expansion vessels and 3 bar safety valves that make sealed circuits' pressure follow their water temperature; heaters, water tanks, heat sinks, cooling jackets, pipe losses and heat exchangers.
- **Hydraulic:** finite vented tanks with weir overflow, pipes with water inventory, valves, regulators, centrifugal pumps with cavitation and standalone electric circulators (proportional or constant pressure, power-limited, on DC or single-phase AC).
- **Machines:** DC motors with a speed-controlled drive, a dynamic double-cage induction motor calibrated to IE3 data, star-delta and soft starters, a variable-frequency drive, flywheels with gear stages and dynamometers.
- **Mechanics:** a Physical view with rigid bodies, joints, gears, springs, forces and brakes (Planck.js), sharing shafts and sensors with the schematic.
- **Thermal Spaces:** draw dimensioned rooms on the schematic, assign equipment, and solve real device heat exchange, effective thermal inertia, construction/ventilation losses and inter-room transfer. Includes heated living-room and timed shutdown examples; [model, usage and benchmark](docs/THERMAL-SPACES.md).
- **Control:** sensors, logic, timers, hysteresis, PID and signal blocks on the simulation clock, plus an independent safety cutoff.

![The schematic workspace after one simulated minute of the heated circulation example: a motor-driven pump moves heated water between two tanks, with live currents, flows and temperatures on the wires, the selected pump's measurements and operating curve in the inspector, and telemetry charts below.](docs/images/workspace.png)

Every run carries a mass and energy ledger without correction factors. Experiments can be probed, charted and exported as CSV, saved as replayable run archives, and advanced by up to 24 h with an adaptive integrator.

![The "Bosch boiler, ALPHA2 and Kermi radiator" example after 20 simulated minutes: three explicit mains phases feed the Bosch boiler, an ALPHA2-style circulator moves 2.46 L/min through a Kermi therm-x2 type 22 radiator whose 16 water and steel cells are shaded by temperature (58.6 → 51.6 °C, 1,000 W to the room); the inspector shows the radiator's supply, return and mean temperature history and its EN 442 characteristic with Kermi's published points and the live operating point.](docs/images/kermi-example.png)

**Bosch boiler, ALPHA2 and Kermi radiator** (File → Starters & examples): a sealed heating circuit built from three manufacturer-calibrated models. The Bosch Tronic Heat 3000 9 is limited to one 3 kW stage. The ALPHA2-style circulator runs in proportional pressure. The Kermi therm-x2 Profil-K 22 radiator follows its registered EN 442 rating with its published water content and steel mass. It warms up front to back, stores and releases heat as the boiler cycles, and matches Kermi's published outputs within 0.07 % ([model and calibration](docs/PANEL-RADIATOR.md)).

## AI disclosure

Most of this project's code, physical models and documentation were written with AI assistance (Anthropic's Claude, through Claude Code), directed and reviewed by the maintainer. The models are checked by the automated tests and validation campaigns described in [docs/VALIDATION.md](docs/VALIDATION.md), but no qualified engineer has independently reviewed them. Physics Lab is a learning and experimentation tool: do not rely on its results for safety-critical design, equipment sizing or compliance decisions.

## Using it

- **File → Starters & examples** opens a shelf of complete experiments, from *First light* to *Starting a motor three ways*, each with an explanation and a suggested experiment. The same experiments are in [`examples/`](examples/) as importable JSON.
- **Sandbox** projects (everything that is not a challenge) expose every model parameter with its unit, validity domain and editing policy. Ratings are reported when exceeded instead of blocking the experiment. See [docs/SANDBOX.md](docs/SANDBOX.md).
- **Challenges** offers nine scored assignments (circuits, heating, thermal runaway, water transfer, pressure and level control, descent, lift, speed control). The player buys and wires the equipment; scores reward efficiency, cost and time. See [docs/CHALLENGES.md](docs/CHALLENGES.md).
- **Physical** (beside Schematic) builds mechanisms in metres; a motor's shaft can drive a rotor and a pump at the same time.
- Terminal colours show the domain: amber electrical, orange heat, blue water, grey shaft, purple control signals.
- **Help** in the top bar summarizes the models; [docs/PHYSICS.md](docs/PHYSICS.md) has the equations and limits.

## Development

Requires Node 22.

```sh
npm ci
npm run dev            # Vite dev server
npm run check:quick    # incremental typecheck + tests affected by your changes
npm run check          # full release gate (typecheck, tests, validation, build, browser tests)
```

Browser tests need Chromium and its system libraries (`npx playwright install --with-deps chromium`, or see [docs/WORKFLOW.md](docs/WORKFLOW.md) for a user-local setup). Branching, test tiers, the release gate and deployment are described in [docs/WORKFLOW.md](docs/WORKFLOW.md).

## Running with Docker

```sh
docker compose up -d --build
```

The image builds the app and serves the static bundle with nginx on port 8080. No backend or account is needed. Production releases go through `scripts/deploy.sh <tag>`.

## Documentation

| Document | Contents |
| --- | --- |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Source layout, state ownership, clock, editing, wire routing, persistence |
| [ELECTRIC-BOILER.md](docs/ELECTRIC-BOILER.md) | Bosch boiler reference data, equations, calibration, example and limitations |
| [HEAT-PUMP.md](docs/HEAT-PUMP.md) | Bosch Compress 6800i AW 7 OR-S heat pump: published data, fitted cycle, frost and defrost, controller, energy accounting, validation and limitations |
| [STORAGE-AND-PRESSURE.md](docs/STORAGE-AND-PRESSURE.md) | Stratified buffer and hot-water cylinder, expansion vessel and safety valve: data, equations, ledger, validation and limitations |
| [HEATING-MANIFOLD.md](docs/HEATING-MANIFOLD.md) | Underfloor heating circuit manifold (Oventrop Multidis SF): data and provenance, circuit hydraulics, thermal actuators, hydraulic balancing, three-room example, validation and limitations |
| [GROUND.md](docs/GROUND.md) | Floors on the ground: fixed ground boundary (an explicit assumption), EN ISO 13370 slab-on-ground U-value, soil resistance under underfloor heating, scope and extension points |
| [UNDERFLOOR-HEATING.md](docs/UNDERFLOOR-HEATING.md) | Wet-screed underfloor heating: EN 1264 characteristic, FLOORTEC calibration, screed storage, room and room-below coupling, validation and limitations |
| [PANEL-RADIATOR.md](docs/PANEL-RADIATOR.md) | Kermi therm-x2 radiator data and provenance, EN 442 equations, calibration accuracy, example and limitations |
| [ENVIRONMENT.md](docs/ENVIRONMENT.md) | Ambient inheritance, local overrides, temperature meanings, migration and component audit |
| [PHYSICS.md](docs/PHYSICS.md) | Every model: equations, numerics, energy accounting, limitations, references |
| [COMPONENT-MATRIX.md](docs/COMPONENT-MATRIX.md) | Every component: solver integration, model, tests, missing functionality |
| [PARAMETER-MATRIX.md](docs/PARAMETER-MATRIX.md) | Generated: every parameter's policy, domain and challenge lock |
| [SANDBOX.md](docs/SANDBOX.md) | Limits, parameter system, editing policy, adaptive advance, presets and cost |
| [CHALLENGES.md](docs/CHALLENGES.md) | Assignments, integrity rules and scoring |
| [VALIDATION.md](docs/VALIDATION.md) | Test layers, validation campaigns and their reports in [`validation/`](validation/) |
| [WORKFLOW.md](docs/WORKFLOW.md) | Branches, test tiers, release gate, deployment |
| [DESIGN.md](docs/DESIGN.md) | Design tokens, colour roles, type, layout |

See [grid-connected energy architecture and solar reliability audit](docs/HYBRID-ENERGY.md) for generic grid-following and hybrid inverter models, PCC metering, manufacturer calibration, isolation policies, confirmed solar fixes and validation limitations.
