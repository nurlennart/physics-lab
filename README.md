# PHYSICS LAB — Phase 3A

A browser engineering sandbox coupling DC circuits, thermal storage, brushed motors, shaft-driven centrifugal pumps, finite water networks and simulation-clock automation. It now includes a shared spatial construction view with Planck rigid bodies, joints, forces, motor-driven mechanisms and mechanical control. React/TypeScript/Vite; simulation state lives outside rendering.

## Start

```sh
npm ci
npm run dev
```

Open the address printed by Vite. The existing heating experiment remains the default. **File → Starters & examples** opens a shelf of 16 working experiments covering circuits, heat, automation, hydraulics, industrial pumping and physical mechanisms. Each includes an explanation and a suggested experiment. The component library is reserved for building.

Select a DC motor's **Catalog model** in the inspector to choose the original 24 V laboratory motor, a 48 V traction motor, or a 180 V industrial motor. Larger models have their own armature, torque/back-EMF constants, inertia, cooling and paid ratings. The industrial starter includes a matching 80 A supply, 35 m shutoff-head pump, 50 mm piping, 2,000 L source reservoir and 1,000 L destination elevated 12 m. Flow and shaft output depend on the solved load; electrical ratings are limits, not a promise of shaft power. Existing scored assignments retain their 24 V limit.

Blue terminals carry water, gray terminals connect a motor shaft to a pump, amber terminals carry electrical power, orange terminals exchange heat, and purple terminals carry typed control signals. Place pipe components to specify real hydraulic length/diameter; routing a blue connection does not change pipe resistance. Inspect a pump for its calculated operating curve. Use **Energy balance** for external energy, internal work, storage and conservation residuals. Add arbitrary component probes through the inspector or trace manager and export CSV.

Select components to change live valve openings, motor enable/RPM command, switch state or controller references, and to inject physical faults. Enable the motor's local speed command explicitly, or wire a numeric RPM signal to its speed input. Motors consume real circuit power and coast after power loss. Finite tanks cannot silently supply or accept unlimited water.

**Challenges** retains the original six assignments and adds three mechanical assignments. New missions supply only fixed environment fixtures (vessels, loads, supports and consumer demand); players choose and place equipment. A mission guidebook opens at launch with objectives, equipment suggestions and three optional hints, and can be reopened from the challenge strip. Assignment 004 transfers 100 L uphill; 005 regulates actual pressure against alternating consumer restriction; 006 autonomously maintains storage and survives a level-sensor fault. Physical configuration, fluid inventory and initial conditions require **Reset** after time advances. Hydraulic scored runs lock operating edits after startup to enforce autonomy. Catalog ratings, initial environments, budgets and connection types are validated at import and engine boundaries.

## Sandbox freedom

**Free Sandbox mode** exposes every implemented engineering parameter through metadata. Each parameter has a unit, a validity domain with a stated reason, an editing policy, and derived dependencies. Heaters are defined by nominal voltage and power (R = V²/P is derived), and actual power always follows the solved circuit. Supplies can be ideal, internal-resistance, current-limited CV/CC or constant-current. Tanks scale from 1 L to more than 10,000 L with vessel thermal mass and insulation-derived heat loss. A new power-cable component models conductor resistance and heating. Ratings are reported when exceeded instead of blocking the experiment; failures follow modelled temperatures, fuse trips and supply protection.

Engineering presets come in Laboratory, General-purpose, Industrial and High-capacity families. User presets can be saved, renamed, exported and imported. Thermal/electrical/control experiments advance by up to +24 h with an event-aware adaptive integrator that is recorded for exact replay. Scored challenges keep their catalog, environment and budget locks. A second expansion added:
- thermal-magnetic circuit breakers and motor-protective breakers;
- thermal ports with a generic heat sink / thermal mass;
- pipes that hold water, and ε-NTU heat exchangers;
- pressure-reducing valves, data-point pump curves and NPSH warnings;
- signal-conditioning blocks and a PID derivative;
- a balanced three-phase supply;
- adaptive stepping for hydraulic and motor networks.

See [Sandbox freedom & scalability](docs/SANDBOX.md) and the generated [parameter coverage matrix](docs/PARAMETER-MATRIX.md).

## Physical machines

Choose **Physical** beside Schematic. Geometry uses metres, not canvas pixels. Place rectangles, circles, convex polygons, beams, platforms, floors, walls and wheels. Configure depth/material or explicit mass; pan/zoom, snap, measure, Shift-select, align, rotate/resize, duplicate and undo. Select two bodies and a joint tool, then click world anchors. The inspector also exposes gear/rack transmissions and joint limits. **Reset** returns to Build mode before changing geometry or mass.

**File → Starters & examples** includes gravity, rotor, descent, lift and rotational-feedback experiments. Physical tools provide construction and inspection controls. A motor’s shaft selector connects a dynamic rotor with a grounded revolute bearing. The same shaft may also drive an existing pump. Mechanical load changes actual motor current and speed. Equipment housings remain static; temperatures, fluid levels and RPM reference the same engineering identity in both views.

Position/speed sensors and force actuators reuse existing automation. External forces/impulses have signed work accounting. Mechanical probes join the existing unit-labeled charts and CSV export. Optional overlays show actual shapes, bounds, centers, velocities, forces/torques, contacts and constraints. The diagnostic panel reports body/joint counts and measured solver cost.

There are **nine assignments**: 007 Controlled Descent, 008 Motorized Lift, and 009 Rotational Control join the existing six. Mechanical assignments lock their initial load/environment, prohibit free force edits and require autonomous scored runs. Starter examples are complete experiments; assignment scaffolds require construction/configuration.

## Validate

```sh
npm run test:physics
npm run validate:coupled
npm run validate:spatial
npm run validate:scaling   # executed scale campaign → validation/scaling.md
npm run audit:parameters   # regenerates docs/PARAMETER-MATRIX.md
npm run benchmark:spatial
npm run test:e2e
npm run build
```

Physics validation writes [expected/measured results and tolerances](validation/latest.md). The longer coupled command runs complete hydraulic challenge reference designs and a heated circulation experiment, recording [actual results](validation/phase2b-coupled.json). Playwright needs Chromium and system libraries (`npx playwright install --with-deps chromium` on a suitable development machine). See [the executed Phase 2B results](docs/PHASE2B-RESULTS.md) for environment-specific browser setup and actual deployment status.

## Docker

```sh
docker compose up -d --build
docker compose ps
```

Open `http://localhost:8080` or your server's port 8080. The image uses a Node build stage and nginx static hosting; fonts are bundled locally. If the shell predates Docker group membership, a fresh login or `sg docker -c 'docker compose up -d --build'` applies existing membership. No backend or external account is required. `docker compose down` stops it.

## Models and persistence

See [Phase 3A architecture, equations, materials and limitations](docs/PHASE3A.md), [executed Phase 3A results](docs/PHASE3A-RESULTS.md), and [the readiness audit](docs/PHASE3A-AUDIT.md).

See [model equations, coupling, limitations and Phase 3 priorities](docs/PHASE2B.md), [the preflight audit](docs/PHASE2B-AUDIT.md), [the complete component inventory](docs/COMPONENT-MATRIX.md), and the in-app Reference. Existing Phase 2A documentation remains as historical evidence.

Version 4 spatial scenarios add SI geometry, materials, joints and shared identities to version 3 schematic construction. Versions 1–3 remain supported and validated. Saving after running creates a live-run archive that reconstructs fluid, shaft, thermal, controller and fault state by validated fixed-step replay through the current engine on import. **File → Export scenario configuration** saves only the initial model. Replay/restore yields to the browser and supports up to 30 simulated days/5,000 recorded inputs (adaptive advances replay step-for-step; long fixed-step portions are correspondingly slow to restore); arbitrary timeline scrubbing is not implemented. Same-runtime replay is tested exactly; cross-platform bitwise identity is not guaranteed.

Hydraulics uses 1D incompressible water, vented lumped tanks, Darcy friction and conservative pipe enthalpy transport with optional finite inventory. Motors use quasi-steady armature current and midpoint shaft dynamics. Thermal conduction uses backward Euler. Water is limited to 1–95°C. Sealed tanks, plug-flow travel time (inventory pipes use mixed cells), water hammer, cavitation, turbine recovery, variable-frequency drives, switching AC transients, semiconductors, steam and spatial CFD remain unsupported. No energy correction factor conceals numerical residuals.

Challenge economy scores award full credit at or below a catalog reference build cost, then decline linearly to zero at the budget limit. Each mission guidebook shows its economy target. Three stars require 90 points; First Light’s standard €68 source/switch/lamp circuit can earn 100/100 after three seconds of safe operation.

**File → Starters & examples → Heat exchanger lab** recovers heat between separate gravity-fed 80 °C and 10 °C water streams. Temperature, heat-duty and flow probes show the result. Select HX-01 to adjust UA or compare counterflow and parallel flow.

## Functional integration stabilization

**File → Starters & examples → Loaded induction motor** pairs the unmodified standard 7.5 kW motor with the existing 400 V / 250 A supply variant and a 35 N·m load. The equivalent circuit gives about 74 A RMS line current at direct-on-line startup. The standard 63 A supply tolerates this short surge under its thermal-magnetic protection. With the example's 250 A supply it settles near 1,468 RPM, 9.89 A and 5.38 kW shaft output. Starting current has a 10 s reporting allowance; its winding temperature and protection remain active. A 45 kW motor needs a separate supply/start assessment; this example does not promise compatibility for it.

**AC RLC measurements** uses a power-resistor catalog variant with a compatible resistance, reactor and capacitor. Source traces show RMS current/voltage, delivered real/reactive power and circuit power factor. AC ratings compare apparent power in VA; motor nameplates compare shaft output and line voltage. The balanced 3~ solver exposes phase-to-neutral RMS voltage, RMS line current and total three-phase powers.

Sensor menus, import validation, runtime sensing and chart menus share `src/simulation/capabilities.ts`. Temperature selection distinguishes body/winding (tank: mixed water plus vessel) from fluid; pumps/valves have no modeled body temperature. Pipe fluid probes report the mean inventory temperature; exchanger probes and sensors select hot/A or cold/B. Pressure is gauge: outlet/node, inlet, or inlet minus outlet (negative for pump pressure rise). Branch flow is signed inlet→outlet. Controls use Pa and m³/s; charts convert to bar and L/min. Level is percent of capacity; position is metres; speed is RPM. Sensors sample before each physical interval; charts show the resulting state. A nonzero sensor sampling interval holds readings between samples. Faults, removed targets and unavailable fluid invalidate signals immediately.

Existing scenario versions remain supported. Missing sensor quantity/stream properties retain their previous temperature or outlet-pressure meaning, with hot/A as the exchanger default. Old tank/junction branch-flow and motor hydraulic-power traces are retained but explicitly unavailable: those targets do not model those quantities. Remove or retarget those traces. Initial configuration, probes and runtime inputs are still saved through the existing scenario/replay formats. Replaying an older live archive uses the current engine and its corrected sensor/rating semantics; cross-version bitwise replay is not promised.

See [executed stabilization evidence and limits](docs/STABILIZATION.md).

The [2026-10-11 physics audit](docs/PHYSICS-AUDIT-2026-10-11.md) records the latest confirmed fixes, executed checks and remaining limitations.
