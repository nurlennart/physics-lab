# Component completeness — Phase 2A

Validation means exercised by the executed test suite within the declared model, not a claim of real-device fidelity.

| Component                      | Domain                     | Implemented                  | Validated | Missing capability / priority                                  |
| ------------------------------ | -------------------------- | ---------------------------- | --------- | -------------------------------------------------------------- |
| Adjustable DC source           | Electrical                 | Yes                          | Yes       | Current regulation/internal impedance: medium                  |
| Fixed/variable resistor        | Electrical                 | Yes, editable before Reset   | Yes       | Continuous rheostat transition: medium                         |
| Lamp                           | Electrical                 | Yes                          | Yes       | Filament temperature-dependent resistance: medium              |
| Immersion heater               | Electrical/thermal         | Yes, paid variants           | Yes       | Temperature-dependent resistivity: medium                      |
| SPST switch                    | Electrical                 | Yes                          | Yes       | Arcing/bounce: low                                             |
| SPDT relay                     | Electrical/control         | Yes, 5/12/25 A variants      | Yes       | Coil power/arcing/wear: medium                                 |
| Independent safety cutoff      | Electrical/thermal/control | Yes                          | Yes       | One injected failure per device; no certification              |
| Fuse                           | Electrical                 | Yes                          | Yes       | I²t curve: medium                                              |
| Voltmeter                      | Electrical                 | Yes, 10 MΩ branch            | Yes       | Input-range model: low                                         |
| Ammeter / wattmeter            | Measurement                | Targeted branch/power probes | Yes       | Dedicated shunt hardware: low                                  |
| Ground / junction              | Electrical                 | Yes                          | Yes       | Ideal conductors; crossings never connect                      |
| Current source                 | Electrical                 | No                           | No        | Additional MNA stamp: medium                                   |
| Potentiometer                  | Electrical                 | No                           | No        | Three-terminal resistor stamp and wiper transition: medium     |
| Contactor / breaker            | Electrical                 | No                           | No        | Reuse contact architecture, distinct protection curves: medium |
| Capacitor / inductor           | Electrical                 | No                           | No        | Transient MNA integration and initial energy: high before AC   |
| Diode                          | Electrical                 | No                           | No        | Nonlinear iterative solver: medium                             |
| DC motor                       | Electromechanical          | No                           | No        | Shaft inertia, back EMF and mechanical energy: later           |
| Water tank                     | Thermal                    | Yes, standard/insulated      | Yes       | Hydraulic ports, inflow/outflow enthalpy: next phase           |
| Cooling jacket / thermal sink  | Thermal/control            | Yes, 8/16 W/K                | Yes       | Infinite coolant reservoir; hydraulic model later              |
| Thermal mass                   | Thermal                    | Electrical masses + water    | Yes       | Standalone material inventory: medium                          |
| Insulation                     | Thermal                    | Paid insulated tank variant  | Yes       | Attachments/layers: low                                        |
| Radiator / heat exchanger      | Thermal/hydraulic          | No                           | No        | Flow, two-sided energy balances: next phase                    |
| Temperature sensor             | Thermal/control            | Yes                          | Yes       | Optional noise/lag, explicit invalid readings                  |
| Thermostat                     | Control                    | Yes                          | Yes       | Same sensing/hysteresis model, optional external sensor        |
| Comparator / hysteresis        | Control                    | Yes                          | Yes       | Feedforward acyclic signals; memory internal                   |
| Timer                          | Control                    | TON / TOF / pulse            | Yes       | Fixed-step quantization                                        |
| AND / OR / NOT                 | Control                    | Yes                          | Yes       | Strict invalid-signal propagation                              |
| Constant / reset pulse / latch | Control                    | Yes                          | Yes       | Numeric constant; reset-dominant Boolean latch                 |
| Arbitrary probes               | Measurement                | Yes                          | Yes       | Targeted voltage/current/power/temperature/energy/state/signal |
| PID                            | Control                    | No                           | No        | Anti-windup, sample-period and saturation validation: next     |

Next priority: conservative 1D hydraulic networks and advected thermal energy using the existing signal/measurement/solver interfaces; then electrically powered pumps and pressure regulation. Do not add decorative pipes before a mass/enthalpy-conserving solver exists.
