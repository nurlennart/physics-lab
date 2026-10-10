# Executed Phase 3A results

Executed on 2026-10-09 in the actual repository. This report separates tested behavior from unsupported scope. The [readiness audit](PHASE3A-AUDIT.md), [architecture/models/materials](PHASE3A.md), and [complete component inventory](COMPONENT-MATRIX.md) accompany these results.

## Regression and quantitative references

Preflight passed **91/91 tests and 60/60 quantitative checks**, plus four complete Phase 2B hydraulic/thermal scenarios. Final `npm run test:physics` passed **111/111 tests across seven files** and **87/87 quantitative checks**. Twenty added automated tests cover mechanics and shared engineering integration; 27 added quantitative checks report analytical expectations and measured timestep differences. Raw [final test execution](../validation/phase3a-physics.txt) and [all measured quantities/tolerances](../validation/latest.md) are retained.

One earlier regression run under simultaneous scenario/build/benchmark load exceeded the existing 20 s Thermal Runaway test wall-time limit. An uncontended rerun passed; no timeout was increased. The final suite was rerun after extending sensor-range import validation and passed in 70.43 s before the quantitative report.

Coverage includes free fall, fixed-clock 30/144 FPS equivalence, disk/rectangle/polygon mass and inertia, all eight material densities, constant torque, linear and angular momentum, restitution/contact heat, frictional sliding, thin-wall CCD, sleeping/filtering, kinematic contact work, springs/frequency/damping, fixed/revolute/distance/prismatic joints, gear/rack transmission, motor startup/stall/load feedback, shared motor/pump/body speed, electrical/thermal/hydraulic state ownership, sensor/control/actuator behavior, power-loss coasting, thermal equipment readings, live-edit restriction, imported geometry/range/rating/reference exploits, complete/partial assemblies, reset, impulse/fault replay and live archive restoration.

| Quantitative reference | Expected | Measured | Acceptance |
| --- | ---: | ---: | --- |
| 1 s gravity velocity | −9.80665 m/s | −9.80665 m/s | 1e−8 m/s |
| 1 s gravity position, start 10 m | 5.096675 m | 5.086459740 m at h=1/480 s | 0.011 m |
| Same position, h=1/960 s | 5.096675 m | 5.091567370 m | Measured error halves; ratio 2.00000000001 |
| 2 kg, 0.2 m disk inertia | 0.04 kg·m² | 0.04 kg·m² | 1e−10 kg·m² |
| 0.5 N·m applied for 1 s | 12.5 rad/s | 12.5 rad/s | 1e−8 rad/s |
| Constant-torque work residual | 0 J | 3.20e−14 J | 1e−8 J |
| Motor/body speed difference | 0 rad/s | Exactly 0 at all tested steps | One authoritative state |
| Fixed-duty rotor, 2 s, outer dt=1/60 s | Fine reference 64.262983117 rad/s | 64.263872639 rad/s | Difference 0.000889523 rad/s <0.005 |
| Same motor current | Fine reference 31.968913507 A | 31.970589040 A | Difference 0.001675533 A <0.01 |
| Electrical/spatial shaft energy residual | 0 J | Magnitude <2e−10 J across tested dt | 0.001 J |

Outer steps 1/60, 1/240 and 1/480 s share the internal h=1/480 s cap; their equality is not independent evidence of refinement. The h=1/960 s experiment actually refines mechanics. The engine’s semi-implicit position integration and explicit viscous brake are first order. Latest reported motor current is a midpoint sample, so it has a small timestep-dependent reporting offset. Quantitative hydraulic/thermal refinement tests from the previous phase are also rerun.

## Whole-system reference experiments

`npm run validate:spatial` ran five complete scenarios. [Raw body, motor, energy and scoring state](../validation/phase3a-scenarios.json):

| Experiment | Simulation time | Outcome | Unified energy residual |
| --- | ---: | --- | ---: |
| Gravity / hinge / spring construction | 60 s | Stable contact, hinge and damped spring; no errors/violations | 1.00443 J |
| Electrically driven rotor | 10 s | Shared shaft 120.39978 rad/s; real current 4.86981 A; no errors/violations | −1.40e−10 J |
| 007 Controlled Descent | 11.1667 s | 96/100, 3 stars; load y=1.01911 m; impact 0.49033 m/s; brake heat 389.18952 J | 2.87e−11 J |
| 008 Motorized Lift | 18.1000 s | 75/100, 1 star; y=2.99618 m, vy=0.01492 m/s; 195.8574 J shaft work; 4271.8982 J electrical supply | −0.001524 J |
| 009 Rotational Control | 69.9833 s | 82/100, 2 stars; 60 scored seconds, 99.25% in band, RMS 9.954 RPM; four actual torque-load changes | −1.17e−10 J |

These are connected reference designs. Assignment entry opens unwired/configurable scaffolds. Completion uses actual motion, power, safety and sensor/controller ancestry; scoring does not depend on the example’s exact layout. The lift’s low score reflects its inefficient low-speed copper losses rather than invented mechanical efficiency.

`node scripts/check-shaft-events.mjs` additionally executed [two electrical/spatial event cases](../validation/phase3a-shaft-events.json):

- Lift power failure at 3 s: current becomes 0; the load first coasts upward, then gravity reverses the coupled rack/rotor. Rotor speed changes from +9.21723 to −7.12041 rad/s by 6 s. Residual 0.01455 J; no errors or violations.
- An initially overspeed 350 rad/s rotor brakes to 346.73712 rad/s in 0.2 s. Current is −3.34423 A; the ideal external source absorbs 34.03222 J. Thermal/ambient gain is 27.29059 J and brake heat 121.36163 J. Residual 1.52e−11 J. This tests signed regeneration into an ideal absorbing source, not a finite battery or a separate generator model.

`npm run validate:coupled` reran the existing four complete [hydraulic/thermal scenarios](../validation/phase3a-coupled.json). Water Transfer completed in 144.3167 s; Pressure Control in 194.9833 s; Automated Supply in 720 s including the injected primary level-sensor fault; heated circulation ran 60 s. All had no solver errors or violations. Final mass residual magnitudes were below 2e−8 kg and energy residual magnitudes below 0.21 J. The shared pump/rotor shaft integration is also tested in the automated suite; spatial representations read the same heated equipment temperature.

## Long duration and solver benchmarks

`npm run benchmark:spatial` executed 600 fixed outer steps for scenes of 10, 50 and 100 bodies, then a **600 s** hinge/spring/contact scene. [Raw environment, timings, final states and constraints](../validation/phase3a-performance.json) identify Node v22.23.3 on an AMD EPYC-Genoa Linux host. These are solver timings on shared hardware, not promised browser frame rates.

| Bodies, including floor | Mean outer step | p95 outer step | Maximum | Final energy residual | Errors/violations |
| ---: | ---: | ---: | ---: | ---: | --- |
| 10 | 2.523 ms | 13.952 ms | 61.226 ms | −4.41e−13 J | None |
| 50 | 6.446 ms | 21.085 ms | 62.102 ms | 1.36e−12 J | None |
| 100 | 9.835 ms | 26.546 ms | 63.216 ms | −0.11508 J | None |

The 600 s mechanism run ended with **1.00443 J** residual against **1421.34960 J** initial mechanical energy (**0.07067%**), with no solver errors/violations. Its final drift equals the 60 s result: after the transient settles, the measured residual does not keep growing. This is one modest constrained mechanism, not an exhaustive 100-body/100-joint endurance guarantee.

`node scripts/benchmark-browser.mjs` measured three-second live production scenes at 1440×1000 in Chromium. [Raw rendering, loading, saving and interaction measurements](../validation/phase3a-browser-performance.json):

| Bodies | Mean frame interval / approximate FPS | Longest frame | Pause-click latency | Import/render | Save/download |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 10 | 18.716 ms / 53.4 | 50.1 ms | 423.9 ms | 270.7 ms | 374.8 ms |
| 50 | 37.998 ms / 26.3 | 183.3 ms | 351.7 ms | 745.9 ms | 165.5 ms |
| 100 | 78.083 ms / 12.8 | 233.2 ms | 748.7 ms | 626.1 ms | 322.1 ms |

Those figures include SVG/React rendering, physics, Playwright actionability and shared host load; they are not isolated event-handler timings. The 100-body scene advanced only 0.783 simulation seconds during the live wall-time window. Its last solver step took 51.9 ms; no physics errors or conservation warnings occurred. A fixed-step clock that slows under load is preferable to changing physical dt, but this remains a real performance limitation. A 12 ms cooperative RAF budget cannot preempt an individual expensive step. Large scenes need worker execution/persistent trial-state optimization; that work is explicitly deferred. Collision/constraint phases were not independently CPU-profiled, and cross-platform benchmarks are not claimed.

## Production browser workflows and visual review

The first full production Chromium run executed 24 workflows: **23 passed; one new hinge-construction test timed out**. The test clicked the SVG group’s bounding box, whose center lay outside the actual thin floor collider. Selecting its rendered rectangle fixed the test. The final focused production run passed **all six mechanical workflows in 36.5 s**, including actual joint construction and undo, shared shaft/thermal state, impulse/live archive restore and all three mechanical challenges. All 18 existing electrical, thermal and hydraulic production workflows passed in the full run. A subsequent complete production rerun passed **24/24 workflows in 5.2 minutes**, including the corrected hinge test and all nine assignments. The earlier failed run is retained as debugging evidence, not counted as a clean pass.

After the final shaft-load display refinement, the shared-view/live archive production workflow was rerun as a deployment smoke check; see [smoke execution](../validation/phase3a-browser-smoke.txt).

Raw [initial production run](../validation/phase3a-browser-first.txt), [complete successful production rerun](../validation/phase3a-browser.txt) and [focused mechanical workflows](../validation/phase3a-browser-final.txt) retain the actual outcomes. Playwright exercised all nine playable assignments, normal editing/undo, unit probes/CSV, faults, physical and thermal replay, typed terminal rejection, mobile schematic layout, independent thermal protection and reusable assemblies. The [physical screenshot](../validation/phase3a-physical.png) was visually reviewed for the existing graphite/grid/typography identity. A separate physical mobile construction usability audit was not executed.

Chromium required the environment’s available extracted runtime libraries:

```sh
LD_LIBRARY_PATH=/tmp/physics-browser-runtime/usr/lib/x86_64-linux-gnu \
FONTCONFIG_FILE=/tmp/physics-fontconfig.xml \
PHYSICS_LAB_URL=http://localhost:8080 npm run test:e2e
```

On a normal development machine, install Chromium/system dependencies with the usual Playwright installation command. No remote APIs or accounts are required by the app.

## Build and deployment

`npm run build` executed TypeScript and Vite production compilation successfully. The mature engine is in a separate `rigid-body` chunk (~210.21 kB, gzip 46.47 kB); React vendor is ~223.21 kB, gzip 69.23 kB. The main application is ~315 kB, gzip ~96 kB; CSS ~49.5 kB, gzip ~11.5 kB. Exact final sizes are in [the build log](../validation/phase3a-build.txt). No chunk-size warning was emitted.

`sg docker -c 'docker compose up -d --build'` rebuilt and started the Node 22/nginx deployment. The container `physics-lab-physics-lab-1` was verified **healthy**, with **HTTP 200** at `http://localhost:8080`, exposing host port 8080. [Actual Docker build/start output](../validation/phase3a-docker.txt) and [machine-readable summary](../validation/phase3a-summary.json) retain the final image identity/status. Docker health and HTTP checks were executed, not inferred from build success.

## Remaining limitations and Phase 3B priorities

No blocking solver defect remains in the executed reference scenes. This is not a certification or exhaustive search over allowed parameters. Known practical limits: first-order rigid-body/spring/brake error, finite contact/constraint slop, no cross-platform bitwise determinism, cold-cache motor trial cloning and pinned internal snapshot adapters, main-thread slowdown in larger scenes, no timeline scrubbing or direct portable engine snapshot import, and last-substep rather than interval-averaged contact/reaction measurements. Overconstrained chains, extreme mass ratios and dense motor/contact scenes are not comprehensively validated.

Engineering housings are static; moving finite tanks, automatic contact conduction, dynamic hydraulic pipe inventory, spatial fluid spill/leak/body pressure, deformation and damage remain unsupported. Material thermal parameters are metadata. No decorative fluid or collision-damage model was introduced.

Phase 3B priorities: worker-owned unified simulation with explicit command/state exchange; optimized persistent coupling trials; conservative network/spatial mass-momentum-energy transactions; finite pipe inventory and travel time; moving equipment inertia; then genuine spatial fluids and solid-pressure interaction. Upgrade engine/snapshot internals only with full motor/gear/multi-turn/contact/replay regression coverage.
