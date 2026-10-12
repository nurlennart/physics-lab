# Physics Lab

A browser engineering sandbox. Build circuits, heating systems, pumped water networks, motor drives and physical mechanisms from about 60 component kinds, wire them by their terminals, and run them on one coupled, energy-conserving simulation.

- **Electrical:** DC and AC (phasor) networks, single- and three-phase supplies, batteries, transformers, filament lamps, cables, fuses, breakers, relays and contactors.
- **Thermal:** heaters, water tanks, heat sinks, cooling jackets, pipe losses and heat exchangers.
- **Hydraulic:** finite vented tanks with weir overflow, pipes with water inventory, valves, regulators and centrifugal pumps with cavitation.
- **Machines:** DC motors with a speed-controlled drive, a dynamic induction motor, star-delta and soft starters, a variable-frequency drive.
- **Mechanics:** a Physical view with rigid bodies, joints, gears, springs, forces and brakes (Planck.js), sharing shafts and sensors with the schematic.
- **Control:** sensors, logic, timers, hysteresis, PID and signal blocks on the simulation clock, plus an independent safety cutoff.

![The schematic workspace after one simulated minute of the heated circulation example: a motor-driven pump moves heated water between two tanks, with live currents, flows and temperatures on the wires, the selected pump's measurements and operating curve in the inspector, and telemetry charts below.](docs/images/workspace.png)

Every run carries a mass and energy ledger without correction factors. Experiments can be probed, charted and exported as CSV, saved as replayable run archives, and advanced by up to 24 h with an adaptive integrator.

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
| [PHYSICS.md](docs/PHYSICS.md) | Every model: equations, numerics, energy accounting, limitations, references |
| [COMPONENT-MATRIX.md](docs/COMPONENT-MATRIX.md) | Every component: solver integration, model, tests, missing functionality |
| [PARAMETER-MATRIX.md](docs/PARAMETER-MATRIX.md) | Generated: every parameter's policy, domain and challenge lock |
| [SANDBOX.md](docs/SANDBOX.md) | Limits, parameter system, editing policy, adaptive advance, presets and cost |
| [CHALLENGES.md](docs/CHALLENGES.md) | Assignments, integrity rules and scoring |
| [VALIDATION.md](docs/VALIDATION.md) | Test layers, validation campaigns and their reports in [`validation/`](validation/) |
| [WORKFLOW.md](docs/WORKFLOW.md) | Branches, test tiers, release gate, deployment |
| [DESIGN.md](docs/DESIGN.md) | Design tokens, colour roles, type, layout |
