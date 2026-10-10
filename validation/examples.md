# Example circuit audit

All 14 current examples import successfully and complete representative runs with no simulation errors, safety violations, failed components or invalid probe readings. Water mass residuals remain below 1e-6 kg. Runs exercise fixed-step startup and the sandbox’s adaptive advance; physical mechanisms use fixed steps throughout.

| Example | Simulated time | Selected final measurement |
| --- | ---: | ---: |
| light | 60 s | L-01 power: 23.920 W |
| heat | 60 s | TK-01 water: 22.757 °C |
| automated | 1800 s | TK-01 water: 79.275 °C |
| transfer | 60 s | Destination level: 37.865 % |
| pressure | 195 s | Delivery pressure: 0.350 bar |
| supply | 720 s | Destination level: 40.962 % |
| circulation | 300 s | Delivery flow: 44.222 L/min |
| industrial | 60 s | Delivery flow: 301.218 L/min |
| exchanger | 60 s | Recovered heat: 305206.862 W |
| mechanism | 60 s | Spring position: 3.108 m |
| rotor | 60 s | Rotor speed: 120.455 rad/s |
| descent | 60 s | Load height: 1.019 m |
| lift | 60 s | Lift height: 3.000 m |
| rotation | 60 s | Rotor speed: 125.664 rad/s |

The heated circulation example previously filled its receiver and stalled. Taller vessels and a larger receiver now sustain about 44 L/min after five minutes; the shelf includes source and destination temperature traces. The supply mission’s sensor fault now follows the sensor’s circuit role rather than a preassigned component name.

Examples are generated from the current starter factories, including catalog properties and probes. Each shelf entry explains what it demonstrates and suggests a concrete experiment. Run `npm run validate:examples` to reproduce the audit, or add `-- --write` to regenerate the importable JSON files. Raw results are in `validation/examples.json`.

The heat exchanger lab recovers about 305 kW after 60 simulated seconds. Its separate hot/cold receivers reach about 71.4 °C and 18.6 °C, from 80 °C and 10 °C feeds. The elevated finite reservoirs supply both gravity streams, and each stream conserves its own water inventory.
