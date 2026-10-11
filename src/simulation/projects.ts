import { compatibleTarget, legacyUnavailableMeasurement } from "./capabilities";
import { hydraulicStarter, industrialStarter, heatExchangerStarter, type HydraulicMode } from "./hydraulic-projects";
import { mechanicalStarter, type MechanicalMode } from './spatial-projects';
import {
  connect,
  definitions,
  makeComponent,
  uid,
  connectionError,
  catalog,
  type Kind,
  type Project,
  type Component,
} from "./model";
export function starter(
  mode: "induction" | "starting" | "acRlc" | "heat" | "light" | "blank" | "runaway" | "automated" | "industrial" | "exchanger" | HydraulicMode | MechanicalMode = "heat",
  challenge = false,
): Project {
  if (['mechanism', 'rotor', 'descent', 'lift', 'rotation'].includes(mode)) return mechanicalStarter(mode as MechanicalMode, challenge);
  if (mode === "exchanger") return heatExchangerStarter();
  if (mode === "industrial") return industrialStarter();
  if (["transfer", "pressure", "supply", "circulation"].includes(mode)) return hydraulicStarter(mode as HydraulicMode, challenge);
  let p: Project = {
    version: 3,
    probes: [],
    assemblies: [],
    id: uid(),
    name:
      mode === "heat"
        ? "Water heating experiment"
        : mode === "light"
          ? "First light experiment"
          : "Untitled experiment",
    components: [],
    connections: [],
    ...(challenge && ["heat", "light", "runaway"].includes(mode)
      ? { challenge: mode as "heat" | "light" | "runaway" }
      : {}),
  };
  if (mode === "blank") return p;
  const add = (
    kind: Kind,
    x: number,
    y: number,
    props: Component["props"] = {},
  ) => {
    const c = makeComponent(kind, x, y, p.components);
    c.props = { ...c.props, ...props };
    p.components.push(c);
    return c;
  };
  if (mode === "starting") {
    // One 400 V supply, three ways to start the same 7.5 kW motor against 12 N·m.
    p.name = "Starting a motor three ways — star-delta, soft starter, drive";
    const source = add("source3", 40, 360);
    source.variant = "industrial250";
    source.props = { ...catalog(source).props };
    const starDelta = add("starDeltaStarter", 330, 60, { starTime: 4 }), soft = add("softStarter", 330, 360, { rampTime: 6 }), drive = add("vfd", 330, 660, { accelTime: 5 });
    const motors = [add("inductionMotor", 640, 60, { loadTorque: 12 }), add("inductionMotor", 640, 360, { loadTorque: 12 }), add("inductionMotor", 640, 660, { loadTorque: 12 })];
    motors.forEach((m, i) => { m.name = ["Motor (star-delta)", "Motor (soft starter)", "Motor (drive)"][i]; });
    const wire = (a: Component, ap: string, b: Component, bp: string) => { p = connect(p, { component: a.id, port: ap }, { component: b.id, port: bp }); };
    for (const [st, m] of [[starDelta, motors[0]], [soft, motors[1]]] as const) { wire(source, "a", st, "a"); wire(st, "b", m, "a"); wire(m, "b", source, "b"); }
    wire(source, "a", drive, "a"); wire(drive, "b", source, "b"); wire(drive, "oa", motors[2], "a"); wire(motors[2], "b", drive, "ob");
    p.probes = [
      { id: uid(), component: source.id, measurement: "current", name: `${source.name} line current`, color: "#ef9975", visible: true },
      ...motors.map((m, i) => ({ id: uid(), component: m.id, measurement: "rpm" as const, name: `${m.name} rpm`, color: ["#e9bd6a", "#a58ae3", "#59b99b"][i], visible: true })),
    ];
    return p;
  }
  if (mode === "induction" || mode === "acRlc") {
    p.name = mode === "induction" ? "Loaded induction motor — compatible 250 A supply" : "AC RLC measurement laboratory";
    const source = add(mode === "induction" ? "source3" : "sourceAC", 50, 140);
    const loads: Component[] = [];
    if (mode === "induction") {
      source.variant = "industrial250";
      source.props = { ...catalog(source).props };
      loads.push(add("inductionMotor", 400, 140, { loadTorque: 35 }));
    } else {
      const resistor = add("resistor", 300, 140);
      resistor.variant = "power";
      resistor.props = { ...catalog(resistor).props, resistance: 500 };
      loads.push(resistor, add("inductor", 550, 140, { inductance: 0.5 }), add("capacitor", 800, 140));
    }
    const loop = [source, ...loads, source];
    for (let i = 0; i < loop.length - 1; i++) p = connect(p, { component: loop[i].id, port: i === 0 ? "a" : "b" }, { component: loop[i + 1].id, port: i === loop.length - 2 ? "b" : "a" });
    const metrics = mode === "induction" ? ["rpm", "current", "shaftPower", "temperature"] as const : ["current", "voltage", "power", "reactivePower", "powerFactor"] as const;
    p.probes = metrics.map((measurement, i) => ({ id: uid(), component: mode === "acRlc" ? source.id : loads[0].id, measurement, name: `${mode === "acRlc" ? source.name : loads[0].name} ${measurement}`, color: ["#ef9975", "#e9bd6a", "#a58ae3", "#59b99b", "#3ba6d8"][i], visible: true }));
    return p;
  }
  if (mode === "runaway" || mode === "automated") {
    p.name =
      mode === "runaway"
        ? "Thermal Runaway assignment"
        : "Closed-loop heating laboratory";
    const source = add("source", 40, 100, { voltage: 240 }),
      relay = add("relay", 300, 100),
      safety = add("safety", 560, 100),
      heater = add("heater", 820, 100),
      tank = add("tank", 800, 390),
      sensor = add("sensor", 40, 390, { target: tank.id }),
      controller = add("hysteresis", 300, 390),
      cooler = add("cooler", 560, 390);
    safety.props.target = tank.id;
    const wire = (a: Component, ap: string, b: Component, bp: string) => {
      p = connect(
        p,
        { component: a.id, port: ap },
        { component: b.id, port: bp },
      );
    };
    if (!challenge) {
      wire(source, "a", relay, "a");
      wire(relay, "b", safety, "a");
      wire(safety, "b", heater, "a");
      wire(heater, "b", source, "b");
      wire(heater, "heat", tank, "heat");
      wire(sensor, "out", controller, "in");
      wire(controller, "out", relay, "in");
      wire(cooler, "heat", tank, "heat");
    }
    p.probes = [
      {
        id: uid(),
        name: tank.name + " water",
        component: tank.id,
        measurement: "temperature",
        color: "#ef9975",
        visible: true,
      },
      {
        id: uid(),
        name: heater.name + " power",
        component: heater.id,
        measurement: "power",
        color: "#e9bd6a",
        visible: true,
      },
      {
        id: uid(),
        name: controller.name + " demand",
        component: controller.id,
        measurement: "signal",
        color: "#a58ae3",
        visible: true,
      },
    ];
    return p;
  }
  const supply = add("source", 70, 150, {
    voltage: mode === "heat" ? 240 : 12,
    maxCurrent: 20,
  });
  const sw = add("switch", 330, 80, { closed: true });
  const load = add(mode === "heat" ? "heater" : "lamp", 600, 150);
  const tank = mode === "heat" ? add("tank", 355, 355) : undefined;
  if (!challenge) {
    p = connect(
      p,
      { component: supply.id, port: "a" },
      { component: sw.id, port: "a" },
    );
    p = connect(
      p,
      { component: sw.id, port: "b" },
      { component: load.id, port: "a" },
    );
    p = connect(
      p,
      { component: load.id, port: "b" },
      { component: supply.id, port: "b" },
    );
    if (tank)
      p = connect(
        p,
        { component: load.id, port: "heat" },
        { component: tank.id, port: "heat" },
      );
  }
  p.probes = [
    {
      id: uid(),
      name: load.name + " power",
      component: load.id,
      measurement: "power",
      color: "#e9bd6a",
      visible: true,
    },
    ...(tank
      ? [
          {
            id: uid(),
            name: tank.name + " water",
            component: tank.id,
            measurement: "temperature" as const,
            color: "#ef9975",
            visible: true,
          },
        ]
      : []),
  ];
  return p;
}
import { challengeError, transitionError, componentError } from "./integrity";
import { applyDerived } from "./parameters";
/**
 * Schema migration: properties introduced after a file was written take their
 * catalog values (variant-aware). A legacy heater defined only by resistance and
 * rated power gets the nominal voltage that reproduces exactly that resistance.
 */
export function migrateComponent(c: Component): Component {
  const model = catalog(c).props, props = { ...c.props };
  if (c.kind === "heater" && props.ratedVoltage === undefined && typeof props.resistance === "number" && typeof props.ratedPower === "number")
    props.ratedVoltage = Math.sqrt(props.resistance * props.ratedPower);
  for (const [k, v] of Object.entries(model)) if (props[k] === undefined) props[k] = v;
  return { ...c, props: applyDerived(c.kind, props) };
}
import { measurements } from "./measurements";
export function parseProject(input: unknown): Project {
  if (!input || typeof input !== "object")
    throw Error("Expected a PHYSICS LAB project object.");
  const p = structuredClone(input) as Project;
  if (p.version !== 1 && p.version !== 2 && p.version !== 3 && p.version !== 4)
    throw Error(
      "Unsupported project version. This application reads versions 1–4.",
    );
  if (
    typeof p.name !== "string" ||
    !p.name.trim() ||
    p.name.length > 120 ||
    typeof p.id !== "string"
  )
    throw Error("Invalid project name or ID.");
  if (
    !Array.isArray(p.components) ||
    p.components.length > 100 ||
    !Array.isArray(p.connections) ||
    p.connections.length > 300
  )
    throw Error("Project limit: 100 components and 300 connections.");
  if (
    p.challenge !== undefined &&
    !["light", "heat", "runaway", "transfer", "pressure", "supply", 'descent', 'lift', 'rotation'].includes(p.challenge)
  )
    throw Error("Unknown challenge.");
  const migrated = p.version < 3;
  p.version = p.world || p.components.some(c => c.spatial) || p.version === 4 ? 4 : 3;
  p.probes ??= [];
  p.assemblies ??= [];
  const ids = new Set<string>();
  for (const c of p.components) {
    if (
      !c ||
      typeof c.id !== "string" ||
      ids.has(c.id) ||
      !Object.hasOwn(definitions, c.kind) ||
      typeof c.name !== "string" ||
      c.name.length > 80
    )
      throw Error("Invalid or duplicate component.");
    ids.add(c.id);
    c.variant ??= "standard";
    if (!c.props || typeof c.props !== "object")
      throw Error("Missing component properties.");
    if (input && (input as Project).version < 4 && c.kind === 'pid' && !('feedforward' in c.props)) c.props.feedforward = 0;
    // Valve characteristics: files written before them used Kv ∝ opening; they keep that behaviour.
    if (["valve", "actuatedValve", "pressureReducingValve"].includes(c.kind) && c.props.characteristic === undefined) c.props.characteristic = "linear";
    if (migrated) c.props = { ...catalog(c).props, ...c.props };
    if (
      ![c.x, c.y, c.rotation].every(Number.isFinite) ||
      Math.abs(c.x) > 100000 ||
      Math.abs(c.y) > 100000
    )
      throw Error("Invalid component position.");
    if (c.preset !== undefined && (typeof c.preset !== "string" || c.preset.length > 80)) throw Error("Invalid component preset label.");
    // The superseded pump drag coefficient (k·ω³) mixed disc friction, which belongs to the hydraulic
    // efficiency, with bearing and seal friction; it cannot be converted. Files that carry it get the
    // catalog mechanical loss of their pump model (documented in PHYSICS.md, pump-loss revision).
    if (c.kind === "pump" && "mechanicalDrag" in c.props) {
      delete c.props.mechanicalDrag;
      if (c.props.mechanicalLoss === undefined) c.props.mechanicalLoss = catalog(c).props.mechanicalLoss;
    }
    const unknown = Object.keys(c.props).find((k) => !(k in definitions[c.kind].defaults));
    if (unknown) throw Error(`${c.name}: unsupported property "${unknown}" (written by a newer or modified application). Remove it explicitly; it is not discarded silently.`);
    for (const [key, def] of Object.entries(definitions[c.kind].defaults)) {
      const v = c.props[key];
      if (v !== undefined && typeof v !== typeof def) throw Error(`Invalid ${key} on ${c.name}.`);
    }
    Object.assign(c, migrateComponent(c));
    const modelError = componentError(c);
    if (modelError) throw Error(modelError);
    if (c.kind === "hysteresis" && Number(c.props.low) >= Number(c.props.high))
      throw Error("Low threshold must be below high threshold.");
    if (["pressureSensor", "flowSensor", "levelSensor", "positionSensor", "speedSensor"].includes(c.kind) && Number(c.props.minRange) >= Number(c.props.maxRange)) throw Error("Invalid sensor range.");
    if (["sensor", "thermostat", "safety"].includes(c.kind)) {
      if (Number(c.props.minRange) >= Number(c.props.maxRange))
        throw Error("Invalid sensor range.");

    }
    if (
      c.kind === "comparator" &&
      !["lt", "lte", "gt", "gte"].includes(String(c.props.mode))
    )
      throw Error("Unknown comparator mode.");
    if (
      c.kind === "timer" &&
      !["onDelay", "offDelay", "pulse"].includes(String(c.props.mode))
    )
      throw Error("Unknown timer mode.");
    if (c.kind === "tank" && Number(c.props.volume) > Number(c.props.capacity))
      throw Error("Tank volume exceeds capacity.");
  }
  let validated: Project = { ...p, connections: [] };
  const wireIds = new Set();
  for (const c of p.components) {
    if (typeof c.props.target === "string" && c.props.target) {
      const target = p.components.find(x => x.id === c.props.target);
      if (!target || !compatibleTarget(c, target)) throw Error(`${c.name}: target has no compatible modeled quantity. Reassign the sensor target.`);
    }
  }
  for (const w of p.connections) {
    if (!w || typeof w.id !== "string" || wireIds.has(w.id) || !w.from || !w.to)
      throw Error("Invalid connection.");
    wireIds.add(w.id);
    if (
      w.route &&
      (!Array.isArray(w.route) ||
        w.route.length > 20 ||
        w.route.some(
          (pt) =>
            !pt ||
            ![pt.x, pt.y].every(Number.isFinite) ||
            Math.abs(pt.x) > 100000 ||
            Math.abs(pt.y) > 100000,
        ))
    )
      throw Error("Invalid wire route.");
    const error = connectionError(validated, w.from, w.to);
    if (error) throw Error(error);
    const c = p.components.find((c) => c.id === w.from.component)!;
    if (
      definitions[c.kind].ports.find((x) => x.id === w.from.port)?.domain !==
      w.domain
    )
      throw Error("Invalid connection domain.");
    validated.connections.push(w);
  }
  const challengeViolation = challengeError(validated);
  if (challengeViolation) throw Error(challengeViolation);
  const physicsError = transitionError(validated, validated, 0);
  if (physicsError) throw Error(physicsError);
  validateProbes(validated);
  if (!Array.isArray(validated.assemblies) || validated.assemblies.length > 30)
    throw Error("At most 30 saved assemblies.");
  for (const assembly of validated.assemblies) {
    if (
      typeof assembly.id !== "string" ||
      typeof assembly.name !== "string" ||
      assembly.name.length > 80
    )
      throw Error("Invalid assembly.");
    const checked = parseProject({
      version: 2,
      id: assembly.id,
      name: assembly.name,
      components: assembly.components,
      connections: assembly.connections,
      probes: [],
      assemblies: [],
      ...(assembly.components.some(c => c.spatial) || assembly.joints?.length ? { world: { gravity: { x: 0, y: -9.80665 }, joints: assembly.joints ?? [] } } : {}),
    });
    assembly.components = checked.components;
    assembly.connections = checked.connections;
    if (checked.world) assembly.joints = checked.world.joints;
  }
  return JSON.parse(JSON.stringify(validated));
}
export const serializeProject = (p: Project) =>
  JSON.stringify(parseProject(p), null, 2);
export function download(
  filename: string,
  contents: string,
  type = "application/json",
) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function validateProbes(p: Project) {
  if (!Array.isArray(p.probes) || p.probes.length > 24)
    throw Error("At most 24 probes are supported.");
  const ids = new Set<string>();
  for (const probe of p.probes) {
    if (
      !probe ||
      typeof probe.id !== "string" ||
      ids.has(probe.id) ||
      typeof probe.name !== "string" ||
      probe.name.length > 80 ||
      typeof probe.visible !== "boolean" ||
      !/^#[0-9a-fA-F]{6}$/.test(probe.color)
    )
      throw Error("Invalid measurement probe.");
    ids.add(probe.id);
    if (
      ![
        "pressure", "inletPressure", "differentialPressure", "flow", "level", "fluidTemperature", "heatDuty", "npsh", "reactivePower", "powerFactor", "impellerPower", "mechanicalLoss", "hydraulicEfficiency", "overflow", "overflowVolume", "rpm", "shaftPower", "hydraulicPower", "efficiency", "transferredVolume", "massResidual", "energyResidual", "velocity", "reynolds", "frictionFactor", "position",
        'positionX', 'positionY', 'displacement', 'linearSpeed', 'velocityX', 'velocityY', 'angularVelocity', 'acceleration', 'appliedForce', 'appliedTorque', 'kineticEnergy', 'potentialEnergy', 'mechanicalResidual', 'contactImpulse', 'jointForce',
        "voltage",
        "current",
        "currentNC",
        "power",
        "bodyTemperature", "temperature",
        "energy",
        "state",
        "signal",
        "nodeVoltage",
      ].includes(probe.measurement)
    )
      throw Error("Unknown probe measurement.");
    const c = p.components.find((c) => c.id === probe.component);
    if (!c) throw Error("Probe target is missing.");
    if (!measurements(c).includes(probe.measurement) && !legacyUnavailableMeasurement(c, probe.measurement))
      throw Error("Measurement is incompatible with probe target.");
    if (c.kind === "heatExchanger" && probe.port !== undefined && !["hot", "cold"].includes(probe.port)) throw Error("Exchanger probe stream must be hot or cold.");
    if (
      probe.reference &&
      !p.components.some(
        (c) =>
          c.id === probe.reference!.component &&
          definitions[c.kind].ports.some(
            (x) => x.domain === "electrical" && x.id === probe.reference!.port,
          ),
      )
    )
      throw Error("Invalid voltage reference terminal.");
    if (
      probe.measurement === "nodeVoltage" &&
      !definitions[c.kind].ports.some(
        (x) => x.domain === "electrical" && x.id === probe.terminal,
      )
    )
      throw Error("A node probe requires an electrical terminal.");
  }
}
