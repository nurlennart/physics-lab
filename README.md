# PHYSICS LAB — Phase 2A

A working DC/thermal engineering laboratory with closed-loop automation, independent protection and reproducible physical experiments. React/TypeScript/Vite; simulation lives outside rendering.

## Start

```sh
npm ci
npm run dev
```

Open the address printed by Vite. Use **Open closed-loop starter** in the component library for a fully connected, measurable sensor → hysteresis → relay → heater experiment. Select components to edit operating controls, attach traces, inject actual faults, or manually reset the independent cutoff. Purple terminals carry typed signals; amber terminals carry electrical power; orange terminals transfer heat.

**Challenges → Thermal Runaway** starts the construction assignment. Wire the source → relay → independent cutoff → heater → source; immerse the heater, attach the cooling jacket, and wire sensor → controller → relay. Sensor and independent cutoff targets are already assigned to the process vessel. Heat, regulate, survive welded normal contacts/cooling loss, cool below the reset margin, manually reset ST-01, and demonstrate recovery. Regulation/recovery periods require full automatic switching cycles, so passive cooling through the band cannot count as control. Alternative measured-feedback control arrangements are supported.

Physical configuration, inventory, water mass and initial conditions require **Reset** after time has advanced. Operational controls remain live. Catalog ratings are read-only; paid variants set performance and cost. Challenge environmental and budget rules are validated at load and editor/engine boundaries.

## Validate

```sh
npm run test:physics
npm run test:e2e
npm run build
```

`test:physics` runs the regression/integration suite and generates [the executed physics report](validation/latest.md) plus JSON with expected/measured values, errors, tolerances and assumptions. Playwright needs its Chromium browser and system libraries (`npx playwright install --with-deps chromium` on a suitable development machine).

## Docker

```sh
docker compose up -d --build
docker compose ps
```

Open `http://<server-ip>:8080`. The production image uses a Node build stage and nginx static hosting; fonts are bundled locally. If your shell predates Docker group membership, start a fresh login or use `sg docker -c 'docker compose up -d --build'`. No application backend or external account is required. `docker compose down` stops it.

## Models, persistence and scope

See [the Phase 2 audit](docs/PHASE2-AUDIT.md), [component completeness matrix](docs/COMPONENT-MATRIX.md), [physics equations](docs/PHYSICS.md) and the in-app Reference for assumptions. Version 2 JSON stores construction, catalog variants, routes, probes and reusable assemblies; version 1 projects migrate through validation. Import starts a fresh physical experiment. In-session replay reconstructs physical/controller/fault state from reset and recorded inputs (two-hour bound); no arbitrary timeline scrubbing is claimed.

MNA uses ideal DC sources/wires and finite resistive contacts. Backward Euler integrates coupled thermal masses with explicit signed ambient/coolant energy. Water supports 1–95°C. Cooling is conductance to an ideal reservoir, with no circulating-fluid or refrigeration model. Hydraulics, mechanics, electrical transients and nonlinear semiconductors remain future work.
