# Thermal Spaces

For mechanical room-temperature regulation, use the [Thermostatic radiator valve](THERMOSTATIC-RADIATOR-VALVE.md) or open the **Thermostatic radiator room** example.

Thermal Spaces are finite, well-mixed environments coupled to the existing component thermal and hydraulic models. They store energy; their temperature is never set to a heater or radiator temperature.

## Use

Choose **Draw Thermal Space** on the schematic toolbar and drag a rectangle. Select its header or boundary to inspect it. Drag the boundary/header to move it; drag the bottom-right handle to resize in Build mode. Width, length and ceiling height are editable in metres. The plan mapping is explicitly **100 schematic coordinates per metre**, independent of zoom. Component symbols remain schematic symbols, not dimensioned equipment footprints. The mechanical view is a separate vertical SI world.

The Inspector exposes initial air temperature, additional effective capacity, outdoor boundary, ventilation, internal gains, and each construction element. Initial room contents default to **100,000 J/(m²·K)** of the initial floor area, stored as an editable absolute J/K capacity. This illustrative assumption is not a measured property of the user's building. Resizing changes air volume and derived surface areas; it does not secretly rescale the configured additional capacity.

The outdoor boundary inherits the experiment environment, or uses an explicit room override. Outdoor temperature and internal gains are live controls. Dimensions, initial temperature, capacity, ventilation and construction require Reset to Build after time advances, preserving stored-energy accounting.

Drawing a room around existing unpinned equipment, or dropping equipment into exactly one room in Build, assigns its component centre to that room. Moving or resizing a room reconciles unpinned membership at gesture completion; the equipment itself does not move. Dropping it outside clears the assignment. Overlapping regions preserve the previous assignment. Select a component to assign it manually or pin its membership. Pipes always require explicit assignment: a hydraulic connection or wire passing through a room releases no heat. Live schematic moves preserve membership; explicit live reassignment preserves every component and room temperature.

The room fill does not capture pointer events. Components, terminals and wires render above it. Only the header, boundary and selected resize handle interact with room editing. Empty interiors remain available to ordinary selection, pan and wiring gestures.

Select a room to add traces using the plus buttons beside its calculated measurements. Rooms are also targets in the existing telemetry trace selector. Temperature sensors, thermostats and safety controllers can target room air. **Show surface and device heat flows** enables live canvas annotations and the Inspector's detailed surface/device readings. Windows and doors have schematic boundary markers; their physical contribution uses configured area and U-value.

## Envelope and effective capacity

The default rectangular envelope has four walls, floor and ceiling. Gross surface areas follow room geometry until explicitly overridden. Window/door area is subtracted from the parent wall's opaque area, then uses its own U-value. Oversized openings are rejected, including during resize. Default insulation and glazing values are illustrative editable assumptions.

Interior partitions have one canonical element with two room endpoints. Both room inspectors show that same record. A record from A to B must not be duplicated as a second record from B to A. When converting two exterior surfaces into one shared partition, remove the redundant exterior element explicitly; visual adjacency never automatically determines construction.

```
C_air = 1.2 kg/m³ × 1005 J/(kg·K) × volume
C_eff = C_air + additional capacity + allocated element capacity
Q_surface = U × net area × (T_room - T_other)
Q_ventilation = rho × cp × airflow × (T_room - T_outdoor)
airflow = ACH × volume / 3600, or explicitly configured m³/s
```

Air properties are constant dry-air approximations. Additional capacity and optional element capacities participate at the single zone temperature. Exterior element capacity belongs to its room; an interior element allocates half to each room. These are effective storage contributions, not separate simulated wall temperatures. No detailed stratification, wall conduction delay, radiation network, solar-gain model or airflow network is claimed.

A floor element can rest on the **ground**: its heat goes to a fixed, project-wide ground temperature (an assumed 10 °C annual mean unless set), with either an entered U-value or the EN ISO 13370 slab-on-ground transmittance. Ground loss is reported separately from envelope loss and leaves as ambient energy. This is the ISO 13370 steady-state boundary only: no seasonal swing, soil storage, basements or edge insulation. See [GROUND.md](GROUND.md).

## Coupling and energy

The engine combines room and component body equations with its conservative hydraulic transport at accepted multiphysics intervals. Hydraulic mixer/cell responses are eliminated into the same linear thermal assembly using affine unit responses. Kermi conductance and exchange weights remain evaluated from the interval's start state, exactly as in the established radiator model. Trial responses operate on private fluid/boiler copies; only a successful complete solve commits them. Existing electrical, hydraulic, controller and protection timestep bounds remain in force. Temperature-dependent device storage uses the same interval-start coefficients as its electrical stamp, even though room/body temperatures advance within the accepted substep.

Underfloor heating heats its room from its screed nodes and loses heat into the space under the room's floor element (another room, the ground through the soil's ISO 13370 resistance, or outdoors); its heated area is taken out of that floor element's conducting area. See [UNDERFLOOR-HEATING.md](UNDERFLOOR-HEATING.md).

The Kermi radiator delivers its actual integrated cell exchange, including stored water and steel heat after shutdown. Its water input and room output differ while its inventory warms or cools. Generic component body losses enter the assigned room only after leaving the body's heat storage. Wet-rotor circulator losses enter the water; they do not also become immediate room gains. Boiler auxiliary heat, fan heat, dry pump losses, drive braking and assigned flywheel losses retain explicit destinations. Mechanical shaft exports and rigid-body contact losses retain their existing external ledger meaning.

Ambient resolution is explicit component override → assigned room → global environment. A component override is a prescribed reservoir; it bypasses the room's heat exchange even when the symbol is inside a room. The component Inspector states this. Ordinary outside-room projects keep the established solver path.

Every shared-partition transfer is computed once and credited/debited equally. Component-to-room exchange is internal to the global ledger. Only exterior/ventilation/override exchanges leave through ambient energy. Internal heat gains are declared external input and enter supplied energy. Room storage is included in total stored energy and shown as a subtotal; stored thermal energy is reported relative to the room's initial temperature. Heat rates describe the last accepted thermal interval.

## Examples and saves

**Heated living room** starts a 5 × 4 × 2.5 m room at 15 °C, with 0 °C outdoors, a 2 m² window and 2 MJ/K additional effective capacity. Its existing Bosch/ALPHA2/Kermi circuit has one 3 kW boiler stage. The room can initially cool while the water and radiator warm up. Disable the boiler to stop new element heat; stored equipment heat continues to transfer physically.

**Heating switched off** uses the same circuit and a real automation pulse timer to stop heating after one hour. Circulation continues. Advance another two hours to observe cooling; change the outdoor boundary live to explore its effect.

Project schema version 5 stores room configuration, canonical elements, assignments and space-targeted probes. Versions 1–4 remain readable, without creating or inferring rooms. Ordinary scenario exports restore initial state. Saved live runs reconstruct temperatures, storage and controls through the existing deterministic replay of origin and recorded inputs. Assemblies intentionally omit room membership and external room sensor references.

## Verification and duration benchmark

`src/simulation/thermal-spaces.test.ts` covers geometry, capacities, opening subtraction, analytical heating/cooling, timestep convergence, unequal-room conservation, actual radiator/body exchange, overrides, the real heating circuit, rollback, persistence/replay, sensors/probes, reverse flow and reset-sensitive edits. `e2e/thermal-spaces.spec.ts` covers drawing, dimension editing, resize/undo, telemetry, unchanged terminal interaction and save/load membership.

`npm run validate:thermal-spaces` measures a full simulated hour for both the original Kermi circuit and the living-room circuit, then exercises the timed shutdown over three simulated hours. It writes actual timing, step count, temperatures, energy/mass residuals and pass/fail criteria to `validation/thermal-spaces.json`.

The Bosch boiler's 0.1 s protection/control limit is preserved. A simulated hour needs about 36,000 accepted outer steps. Room coupling adds affine transport evaluations. Multi-hour advances yield to the browser and are usable, but are not instant; dense multi-room scenes cost more. Event-aware boiler timestep optimization is deferred until separately validated against stage, thermostat, limiter, undervoltage and flow-interlock behaviour. No timing or conservation tolerance has been weakened to accelerate these experiments.

The initial measured campaign (shared two-core workload) took 76.1 s for an hour of the original Kermi circuit, 112.5 s for an hour with a room, and 344.2 s for the three-hour timed-shutdown scenario. The living room reached 15.843 °C after heating, then 14.928 °C after two more hours with the boiler off. Maximum absolute energy residual across those runs was 0.000126 J and mass residual was zero. These are measured results for this environment, not a browser performance guarantee.
