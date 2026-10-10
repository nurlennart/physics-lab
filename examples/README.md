# Experiment shelf

Open **File → Starters & examples** in the app for descriptions and suggested experiments. These JSON files are importable copies of the same current starter factories, including catalog properties and live probes. They are editable sandboxes; fresh challenge missions are built separately with only fixed environment fixtures.

- `acRlc`: compatible series RLC circuit with RMS supply measurements and power-factor traces.
- `induction`: standard motor, existing 250 A supply variant, and 35 N·m direct-on-line load; startup current warning is retained.
- `light`, `heat`: electrical basics and electrical-to-thermal energy transfer.
- `automated`: temperature feedback with independent safety isolation.
- `transfer`, `pressure`, `supply`: powered water transfer, pressure feedback, and autonomous level control.
- `exchanger`: separate gravity-fed hot/cold streams with heat recovery, temperature and duty traces.
- `circulation`, `industrial`: transported heat and larger-scale pumping.
- `mechanism`, `rotor`, `descent`, `lift`, `rotation`: real body motion, shaft work, passive braking, position feedback, and speed regulation.

Run `npm run validate:examples` to simulate every example and write measurements to `validation/examples.json`. Run `node scripts/check-examples.mjs --write` to regenerate the importable files with stable identifiers. The audit checks import compatibility, runtime errors, violations, failed components and finite probe readings during fixed-step startup followed by the sandbox’s adaptive advance (mechanisms retain fixed steps), over representative runs (60–1,800 simulated seconds).
