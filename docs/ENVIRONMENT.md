# Experiment environment and thermal boundaries

Every component resolves its ambient through `src/simulation/environment.ts`. New standard components inherit the experiment environment (`project.environment.ambient`, default 20 °C). Components with modeled heat exchange expose an optional local override in the Inspector. An override describes a distinct ideal environmental boundary, such as an externally chilled coolant reservoir or a motor operating outside the laboratory.

Resolution order is **explicit override → containing Thermal Space → experiment environment**. The resolver reports both temperature (°C) and source. Explicit component membership resolves to the live finite room state. The engine binds trial/accepted temperatures through runtime context; serialized projects contain configuration only. A component override remains a distinct external reservoir and bypasses room exchange. See [Thermal Spaces](THERMAL-SPACES.md). Hydraulic transport converts the resolved °C boundary to kelvin once at the point of use.

## Temperature meanings

| Parameter/state | Meaning |
| --- | --- |
| Experiment ambient | Default ideal surroundings for heat exchange; with [weather](WEATHER.md), the outdoor air at the current simulated time |
| Local ambient override | Explicit boundary replacing inherited surroundings; used only with `ambientMode: "override"` |
| Initial temperature | Stored water/solid temperature at reset; independent of ambient |
| Operating temperature | Runtime temperature resulting from storage, power and heat transfer |
| Temperature setpoint | Controller target; does not set ambient or directly set stored temperature |
| Reference temperature | Fixed calibration basis, such as cable ampacity at 30 °C, resistance at 20 °C or EN 442 at 75/65/20 °C; remains fixed |

Bodies without an explicit initial-temperature property start at resolved ambient. Tanks, thermal masses, pipe inventories, boiler water/elements and panel radiator water/steel retain their explicit initial-temperature properties. Changing ambient during a run changes boundary heat exchange without resetting those states or revaluing accumulated energy.

## Component and solver audit

| Components | Resolution and accounting |
| --- | --- |
| Tanks | Resolved ambient in thermal-network UA; vessel and water share temperature; insulation-derived UA is unchanged |
| Thermal masses, heat sinks and enclosures | Resolved ambient in thermal-network UA; initial solid temperature stays explicit |
| Resistors, heaters, cables, switches, relays, safety contacts, fuses, breakers, motor breakers, contactors | Resolved ambient for initial body temperature and UA loss; pole/conductor multiplicity stays in the same ledger |
| DC and induction motors | Resolved ambient for initial temperature and body cooling; copper/machine heat and shaft work remain accounted separately |
| Batteries, capacitors, inductors, transformers | Resolved ambient for initial temperature and body cooling; electrical/chemical storage, Arrhenius reference and resistance reference remain physical parameters |
| Soft starters, star-delta starters, variable-frequency drives | Resolved ambient for body initialization and cooling; external braking-resistor heat goes once to the ambient ledger |
| Lamps | Body initialization/loss and filament cold state/loss use resolved ambient; rated filament temperature and fixed 20 °C calibration remain unchanged; filament storage is booked by differences |
| Pipes | Resolved ambient in both flowing inventory transport and stagnant-cell cooling; explicit initial water temperature remains unchanged |
| Electric boilers | Resolved ambient for water/steel shell loss, with and without flow; element-to-water transfer stays internal; auxiliary electronics heat is booked once to ambient |
| Panel radiators | Resolved air temperature for EN 442 heat exchange with and without flow, live Inspector, diagram and history; water/steel storage and signed heat output share the transport ledger |
| Fan-cooled radiators | Resolved ambient in exponential flowing heat exchange; actual fan power is booked once to ambient; no stored body or water temperature is invented |
| Cooling jackets | Inherit by default; local override retains a physically distinct ideal coolant temperature and its wider validity domain; coolant exchange remains signed ambient/coolant energy |
| Pumps, wet-rotor circulators, flywheels, gears, dynamometers, spatial damping | Dissipation has no boundary-temperature law: losses enter water or leave as ambient/shaft-export energy according to the existing physical model. No new cooling temperature property is added |
| Heat exchangers | Exchange heat between their two fluid streams; no environmental boundary is added |
| Sources, sensors and controllers | Resolve the shared environment if requested; no body cooling is invented. Setpoints, trip/reset limits and sensor calibration remain separate |

The engine, hydraulic transport, boiler heat-loss probe, panel radiator Inspector/diagram/history and temperature-rise indicators all consume the shared resolver. Internal conductances still cancel in the energy balance. Signed ambient exchange is positive when the environment receives heat and negative when it supplies heat; changing a boundary does not itself create storage or a ledger correction.

## Files, presets and challenges

The additive component properties are `ambientMode: "inherit" | "override"` and numeric `ambient`. The numeric value is retained while inheriting so toggling modes can recover a previously chosen local boundary. Editing `ambient` explicitly selects override. Catalog variants and engineering presets specifying a coolant temperature select override deliberately. Saving a preset includes its mode and preserves an explicit boundary even when its value equals the catalog default. Reset-to-default restores the catalog environment choice.

**Variant changes** (`variantAmbient`): a component whose mode and, under override, temperature still equal the previous variant's catalog boundary takes the new variant's boundary, so switching a standard cooling jacket to the industrial 15 °C model selects its coolant override and switching back restores inheritance. A boundary that differs from the previous variant's (a different mode, or an override at a different temperature, including one applied by a preset) is the user's choice and is kept.

Only `ambientMode: "override"` selects a local boundary; a component without a mode fills the catalog default and inherits. Files and presets written before the mode existed are not migrated: a stored `ambient` without a mode is ignored, and lamp runs in replays recorded at a non-20 °C environment are not reproduced. The checked-in `examples/*.physics.json` are regenerated from the starters (`node scripts/check-examples.mjs --write`), and `examples.test.ts` requires them to equal and behave like the starters, also at a non-20 °C environment. Scored assignments retain their locked ambient conditions and reject environment exploits.

Regression coverage in `environment.test.ts` exercises catalog inheritance, space precedence, current-format project/preset round trips, variant changes, global propagation to every boundary component, invalid input, component cooling, live ambient changes, override independence, flowing and stagnant hydraulic components, coolant boundaries, filament temperature and signed energy conservation. Browser coverage checks the default inheritance selector, optional override and environment editing.

Thermal Spaces extend destination accounting: actual body, hydraulic, auxiliary, fan, dry-pump and assigned flywheel exchanges enter the assigned room rather than the external ambient ledger. Wet-rotor losses still enter water. Mechanical contact losses and shaft exports keep their existing external meaning. The shared implicit thermal assembly and accepted-state rollback are covered by `thermal-spaces.test.ts`.
