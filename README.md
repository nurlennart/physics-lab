# PHYSICS LAB

A working browser engineering sandbox with DC circuits, electrical-to-thermal coupling, instrumentation, and two measured engineering challenges. React + TypeScript + Vite; no simulation service or paid API required.

## Run

Node **22.12+** is recommended.

```bash
npm ci
npm run dev
```

Open `http://localhost:5173`. The initial experiment is a wired 240 V supply, switch, 28.8 Ω immersion heater, and 10 L water tank. Press **Run** or **Advance 60 s** to heat the water. The latter executes 3,600 ordinary fixed steps while paused.

```bash
npm run build
npm run preview
```

## Docker

```bash
docker compose up --build -d
```

Open `http://localhost:8080`. The multistage image builds the app with Node and serves static files with nginx. `docker compose down` stops it. Fonts are bundled; the running app needs no external service.

## Use the laboratory

- Drag a component from the catalog or click to add it. Select it to edit its inspector properties.
- Click two yellow electrical terminals to wire them. Click the orange heater and tank ports to establish an explicit immersion interface. Ports cannot cross physical domains.
- Double-click a switch to open or close it. Select a wire and press Delete to disconnect it.
- Scroll to zoom, hold Space and drag to pan, or use the Hand tool. Drag the background to select a group; Shift-click to extend selection. Selected groups can align horizontally.
- V selects, H pans, W connects, R rotates. Ctrl/Cmd D duplicates; C/V copies/pastes; Z undoes; Shift Z redoes; A selects all; S saves.
- Run, pause, reset, single-step, and choose 0.25×–4× speed. Physical values stay inspectable while paused.
- View calculated telemetry, export CSV, inspect the energy balance, or replay recorded editor interventions from the Event log.
- **Challenges** provides First Light and Heating Challenge. Each starts with unconnected components. Complete a safe circuit or a water-heating system; stars come from actual measured state.
- **Save project** downloads a versioned `.physics.json` file. **Open** imports and validates it. File also contains starter projects, rename, duplicate, and a device-local recovery copy. Files save construction and initial conditions, not a mid-run snapshot. Save files are the portable source of truth.

The mobile toolbar exposes the component library and inspector. A desktop browser offers the most comfortable construction workspace.

## Validation

```bash
npm test
npx playwright install --with-deps chromium
npm run test:e2e
```

The physical tests cover reference DC circuits, Kirchhoff laws, joule integration, coupled thermal conservation, ambient cooling, disconnected interfaces, fuse behavior, deterministic frame-rate independence, reset/pause, both challenge scores, project validation, and replay. Browser tests build and wire both challenges, exercise editing and transport controls, save/import projects, export measurements, and check mobile layout.

Browser WebMCP tools are feature-detected. They share the visible app's read, run/pause, and advance actions. Contract registration and valid/invalid execution are tested with a browser registry shim; native WebMCP availability depends on the host browser.

## Architecture and physics

See [architecture](docs/ARCHITECTURE.md), [physical models and numerical assumptions](docs/PHYSICS.md), and [validation record](docs/VALIDATION.md).

This milestone implements DC electrical and lumped thermal systems. Hydraulic networks, rigid-body mechanics, automation blocks, and challenges 003–005 are future work. The catalog contains functioning components only.
