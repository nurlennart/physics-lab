# Experiment shelf

`thermostaticRoom.physics.json` demonstrates the self-acting radiator valve: a numbered dial senses room air, while the Bosch regulates its water temperature and a balanced bypass maintains circulation.

Open **File → Starters & examples** in the app for descriptions and suggested experiments. These JSON files are importable copies of the same current starter factories, including catalog properties and live probes. They are editable sandboxes; fresh challenge missions are built separately with only fixed environment fixtures.

- `heatPumpHouse`: Bosch Compress 6800i AW 7 OR-S heating a 120 m² house through an underfloor loop with a weather-compensated flow target at 2 °C / 85 % RH, and a Bosch WH 290 hot-water cylinder through the 3-way valve VW1 with hot-water priority; frost build-up, reverse-cycle defrosts, COP and seasonal performance factor. See [model basis](../docs/HEAT-PUMP.md).
- `heatPumpCold`: the same house at −15 °C: the compressor at its current limit, the 6 kW backup heater joining after its delay, cut-out below −23 °C.
- `heatPumpBuffer`: the heat-pump house with a Bosch BH 120-5 buffer in series in the return; defrost energy from stored water, buffer layers, system pressure from the indoor unit's 17 L vessel. See [model basis](../docs/STORAGE-AND-PRESSURE.md).
- `sealedBoiler`: the Bosch boiler charging a 123 L buffer to 75 °C in a sealed circuit with a Reflex N 25 expansion vessel and a 3 bar safety valve; pressure rising with expansion, undersized or flat vessel, discharge.
- `boiler`: Bosch TH3000 9 (no internal pump), ALPHA2-style external circulator, insulated pipes, balancing valve and panel radiator in a sealed loop; staged phase loading, supply/return and heat-flow measurements, optional flow protection. See [model basis](../docs/ELECTRIC-BOILER.md).
- `kermi`: the Bosch boiler (one 3 kW stage) and ALPHA2-style circulator heating a Kermi therm-x2 Profil-K type 22, 600 × 1000 mm radiator through a preset lockshield valve; radiator supply/return/mean temperatures, output against water heat input, excess temperature and flow. See [model basis](../docs/PANEL-RADIATOR.md).
- `livingRoom`: a 5 × 4 × 2.5 m room at 15 °C, 0 °C outdoors, with the same real hydronic circuit, insulated envelope, window, ventilation and effective thermal contents. See [Thermal Spaces](../docs/THERMAL-SPACES.md).
- `roomCooldown`: the living-room circuit heats for one hour, then a real pulse timer disables the boiler. Advance another two hours to inspect gradual cooling and stored radiator heat release.
- `battery`: finite charge, polarization sag and recovery, internal heating and chemical-energy accounting.
- `capacitor`: RC charging and bleeder discharge, stored field energy and the charging loss.
- `inductor`: RL current rise, freewheeling decay and, without the freewheeling path, an interrupted current's arc.
- `contactor`: an actual DC coil switches a separate AC load.
- `transformer`: isolated AC conversion, winding/core losses and secondary measurements.
- `radiator`: water cooling driven by actual fan electrical supply.
- `circulator`: a standalone 230 V circulator pump in a heated boiler loop (proportional pressure, input power limit, wet-rotor losses into the water).
- `acRlc`: compatible series RLC circuit with RMS supply measurements and power-factor traces.
- `induction`: standard 7.5 kW motor on the 250 A supply variant, 35 N·m direct-on-line load.
- `starting`: the same motor started by star-delta, soft starter and variable-frequency drive from one supply.
- `testbench`: the 7.5 kW motor started against a steel flywheel and loaded by an eddy-current dynamometer: run-up, torque, absorbed power and efficiency.
- `light`, `heat`: electrical basics and electrical-to-thermal energy transfer.
- `automated`: temperature feedback with independent safety isolation.
- `transfer`, `pressure`, `supply`: powered water transfer, pressure feedback, and autonomous level control.
- `exchanger`: separate gravity-fed hot/cold streams with heat recovery, temperature and duty traces.
- `circulation`, `industrial`: transported heat and larger-scale pumping.
- `mechanism`, `rotor`, `descent`, `lift`, `rotation`: real body motion, shaft work, passive braking, position feedback, and speed regulation.

Run `npm run validate:examples` to simulate every example and write measurements to `validation/examples.json`. Run `node scripts/check-examples.mjs --write` to regenerate the importable files with stable identifiers. The audit checks import compatibility, runtime errors, violations, failed components and finite probe readings during fixed-step startup followed by the sandbox’s adaptive advance (mechanisms retain fixed steps), over representative runs (60–1,800 simulated seconds).
