import { starter } from "./projects";
import { makeComponent, connect, catalog } from "./model";
import { evaluateChallenge } from "./challenges";
import { Simulation, DT } from "./engine";
export interface ValidationRow {
  name: string;
  domain: string;
  expected: number;
  measured: number;
  absoluteError: number;
  relativeError: number | null;
  tolerance: number;
  pass: boolean;
  assumptions: string;
}
export function runValidation() {
  const rows: ValidationRow[] = [];
  const add = (
    name: string,
    domain: string,
    expected: number,
    measured: number,
    tolerance: number,
    assumptions: string,
  ) =>
    rows.push({
      name,
      domain,
      expected,
      measured,
      absoluteError: Math.abs(measured - expected),
      relativeError:
        expected !== 0 ? Math.abs((measured - expected) / expected) : null,
      tolerance,
      pass:
        Number.isFinite(measured) && Math.abs(measured - expected) <= tolerance,
      assumptions,
    });
  const advance = (s: Simulation, t: number, dt = DT) => {
    for (let i = 0; i < Math.round(t / dt); i++)
      if (!s.step(dt)) throw Error(`${s.error} at ${s.time}`);
  };
  let p = starter("blank");
  const supply = makeComponent("source", 0, 0),
    resistor = makeComponent("resistor", 200, 0);
  supply.props.voltage = 12;
  p.components = [supply, resistor];
  p = connect(
    p,
    { component: supply.id, port: "a" },
    { component: resistor.id, port: "a" },
  );
  p = connect(
    p,
    { component: resistor.id, port: "b" },
    { component: supply.id, port: "b" },
  );
  const circuit = new Simulation(p);
  add(
    "12 V / 6 Ω branch current",
    "electrical",
    2,
    circuit.electrical.readings[resistor.id].current,
    1e-10,
    "Ideal source, 6 Ω constant resistance, ideal wires",
  );
  add(
    "12 V × 2 A resistive power",
    "electrical",
    24,
    circuit.electrical.readings[resistor.id].power,
    1e-9,
    "Independent Ohm-law reference",
  );
  advance(circuit, 10);
  add(
    "24 W × 10 s energy",
    "electrical",
    240,
    circuit.energy,
    1e-8,
    "Fixed-step rectangular integration; power constant",
  );
  add(
    "Net electrical power residual",
    "electrical",
    0,
    circuit.electrical.sourcePower - circuit.electrical.dissipatedPower,
    1e-9,
    "Independent sum of ideal-source and branch powers",
  );
  circuit.disconnect(p.connections[0].id);
  add(
    "Disconnected load current",
    "electrical",
    0,
    circuit.electrical.readings[resistor.id].current,
    1e-10,
    "Open circuit, no leakage model",
  );
  const heating = starter("heat"),
    tank = heating.components.find((c) => c.kind === "tank")!,
    heater = heating.components.find((c) => c.kind === "heater")!;
  for (const c of heating.components) if ("loss" in c.props) c.props.loss = 0;
  const isolated = new Simulation(heating);
  while (isolated.temperatures[tank.id] < 80) {
    if (!isolated.step()) throw Error(isolated.error ?? "Heating failed");
  }
  // Inventory is specified in litres, not kilograms. Independent Kell density at 20 °C.
  const sensible = 0.01 * 998.2071 * 4180 * 60;
  add(
    "10 L water heated 20→80°C (9.982071 kg)",
    "thermal",
    sensible,
    isolated.waterStored,
    2000 * DT + 0.001,
    "Step crossing bounded by one interval of ≤2 kW input; heater storage accounted separately",
  );
  add(
    "Isolated coupled heating conservation",
    "coupling",
    0,
    isolated.energy - isolated.storedEnergy - isolated.ambientEnergy,
    1e-3,
    "Backward Euler symmetric immersion transfer; tolerance 1 mJ over ~2.5 MJ",
  );
  const energy = isolated.energy,
    water = isolated.temperatures[tank.id];
  isolated.injectFault(heater.id, "failedOpen");
  advance(isolated, 10);
  add(
    "OFF removes new electrical energy",
    "coupling",
    energy,
    isolated.energy,
    1e-8,
    "Stored thermal energy remains, heater electrical branch failed open",
  );
  add(
    "Thermal inertia still warms water",
    "coupling",
    1,
    Number(isolated.temperatures[tank.id] > water),
    0,
    "Hot element retains sensible energy after power removal",
  );
  const cool = starter("blank"),
    vessel = makeComponent("tank", 0, 0);
  vessel.props.initialTemperature = 80;
  cool.components = [vessel];
  // Isolate BE cooling from the density model: capacity uses the initialized conserved mass,
  // whose independent density/inventory checks live in water-pump-overflow.test.ts.
  const initialMass = new Simulation(cool).multiphysics.tanks[vessel.id].mass;
  const capacity = initialMass * 4180 + Number(vessel.props.vesselHeatCapacity);
  const duration = 600,
    exact = 20 + 60 * Math.exp((-2.2 * duration) / capacity),
    errors: number[] = [];
  for (const dt of [0.1, 0.05, 0.025, DT]) {
    const s = new Simulation(cool);
    advance(s, duration, dt);
    const error = Math.abs(s.temperatures[vessel.id] - exact);
    errors.push(error);
    const upperBound = (60 * (2.2 / capacity) ** 2 * duration * dt) / 2;
    add(
      `Ambient cooling convergence dt=${dt.toFixed(6)} s`,
      "thermal",
      exact,
      s.temperatures[vessel.id],
      upperBound * 1.001 + 1e-8,
      "Analytic exponential cooling with conserved initial water mass; first-order BE error bound ΔT λ² t dt / 2",
    );
    add(
      `Cooling conservation dt=${dt.toFixed(6)} s`,
      "thermal",
      0,
      s.energy - s.storedEnergy - s.ambientEnergy,
      1e-3,
      "Signed external heat and stored thermal change; no power source",
    );
  }
  add(
    "Halving timestep approximately halves error",
    "numerical",
    2,
    errors[0] / errors[1],
    0.001,
    "Backward Euler first-order convergence for smooth single-mass cooling",
  );
  const closed = starter("automated"),
    loop = new Simulation(closed),
    load = closed.components.find((c) => c.kind === "heater")!,
    sensor = closed.components.find((c) => c.kind === "sensor")!,
    relay = closed.components.find((c) => c.kind === "relay")!,
    safety = closed.components.find((c) => c.kind === "safety")!;
  add(
    "Closed relay and safety current",
    "electrical",
    240 / (28.8 + 0.02 + 0.01),
    loop.electrical.readings[load.id].current,
    1e-9,
    "Finite series contact resistances 0.02 Ω and 0.01 Ω",
  );
  advance(loop, 2200);
  const temp =
    loop.temperatures[closed.components.find((c) => c.kind === "tank")!.id];
  add(
    "Closed-loop regulation inside plausible bounds",
    "automation",
    1,
    Number(temp >= 77.5 && temp <= 80.6),
    0,
    "78/80°C hysteresis; finite element inertia and 8 W/K cooling",
  );
  add(
    "Long run energy conservation",
    "coupling",
    0,
    loop.suppliedEnergy - loop.storedEnergy - loop.ambientEnergy,
    1e-3,
    "All contact/element heat storage and ambient/coolant exchange included",
  );
  loop.injectFault(sensor.id, "sensorFault");
  add(
    "Failed sensor opens controlled heater",
    "automation",
    0,
    loop.electrical.readings[load.id].power,
    1e-8,
    "Invalid control propagates; NO relay defaults open",
  );
  loop.injectFault(relay.id, "stuckClosed");
  loop.injectFault(safety.id, "sensorFault");
  add(
    "Independent safety interrupts welded normal contact",
    "safety",
    0,
    loop.electrical.readings[load.id].power,
    1e-8,
    "Separate safety sensing path, fail-on-invalid enabled",
  );
  add(
    "Safety remains latched",
    "safety",
    1,
    Number(loop.automation.memory[safety.id].tripped),
    0,
    "Manual reset required; no automatic reset",
  );
  const edit = structuredClone(loop.project);
  edit.components.find((c) => c.kind === "tank")!.props.volume = 20;
  add(
    "Live mass edit rejected by engine",
    "integrity",
    0,
    Number(loop.refresh(edit)),
    0,
    "No implicit mass or energy injection; Reset required",
  );
  const overloadProject = starter("automated"),
    smallRelay = overloadProject.components.find((c) => c.kind === "relay")!;
  smallRelay.variant = "compact";
  smallRelay.props = catalog(smallRelay).props;
  const overloaded = new Simulation(overloadProject);
  advance(overloaded, 0.6);
  add(
    "Undersized relay reported outside its rating",
    "protection",
    1,
    Number(overloaded.automation.status[smallRelay.id] === "overloaded" && overloaded.violations.some((v) => v.includes("current rating"))),
    0,
    "8.32 A through a paid 5 A model: rating violation reported (scored run fails); no contact-wear model, so no fabricated failure",
  );
  add(
    "Overloaded contact keeps conducting actual current",
    "electrical",
    240 / (28.8 + 0.02 + 0.01),
    overloaded.electrical.readings[smallRelay.id].current,
    1e-9,
    "Failure only through the modelled contact temperature",
  );
  overloaded.reset();
  add(
    "Reset restores initial healthy topology",
    "protection",
    1,
    Number(
      !overloaded.failed[smallRelay.id] &&
        overloaded.electrical.readings[smallRelay.id].current > 8,
    ),
    0,
    "Permanent failure replaced only by full experiment Reset",
  );
  const voltageProject = starter("automated"),
    voltageRun = new Simulation(voltageProject),
    source = voltageProject.components.find((c) => c.kind === "source")!,
    element = voltageProject.components.find((c) => c.kind === "heater")!;
  const fullPower = voltageRun.electrical.readings[element.id].power;
  source.props.voltage = 120;
  voltageRun.refresh(voltageProject);
  add(
    "Half voltage gives quarter heater power",
    "coupling",
    0.25,
    voltageRun.electrical.readings[element.id].power / fullPower,
    1e-10,
    "Same fixed resistor and series contact resistances, Ohm law",
  );
  const assignment = starter("automated");
  assignment.challenge = "runaway";
  const challenge = new Simulation(assignment),
    vesselId = assignment.components.find((c) => c.kind === "tank")!.id;
  for (let i = 0; i < 3600 * 60; i++) {
    const r = challenge.runaway;
    if (
      r.phase === "recovery" &&
      r.safetyId &&
      !challenge.automation.memory[r.safetyId].manualResets &&
      challenge.temperatures[vesselId] <= 85
    )
      challenge.resetSafety(r.safetyId);
    if (!challenge.step() || evaluateChallenge(assignment, challenge)?.complete)
      break;
  }
  add(
    "Complete fault-and-recovery challenge",
    "challenge",
    1,
    Number(evaluateChallenge(assignment, challenge)?.complete),
    0,
    "Actual 240 s regulation, coolant reduction/loss, welded relay, independent trip, cool manual reset, 120 s recovery; no temperature script",
  );
  add(
    "Challenge stays below critical water temperature",
    "safety",
    1,
    Number(challenge.runaway.maxTemperature < 95),
    0,
    "Independent cutoff threshold 90°C; thermal inertia retained",
  );
  const exploit = structuredClone(assignment);
  exploit.components.find((c) => c.kind === "tank")!.props.ambient = 90;
  let rejected = false;
  try {
    new Simulation(exploit);
  } catch {
    rejected = true;
  }
  add(
    "Locked environment exploit rejected",
    "integrity",
    1,
    Number(rejected),
    0,
    "Challenge initial/environment conditions validated before solver state initializes",
  );
  return rows;
}
