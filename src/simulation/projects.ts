import {
  connect,
  definitions,
  makeComponent,
  uid,
  connectionError,
  catalog,
  isThermalMass,
  type Kind,
  type Project,
  type Component,
} from "./model";
export function starter(
  mode: "heat" | "light" | "blank" | "runaway" | "automated" = "heat",
  challenge = false,
): Project {
  let p: Project = {
    version: 2,
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
export { ranges } from "./integrity";
import { ranges, catalogError, challengeError } from "./integrity";
import { measurements } from "./measurements";
export function parseProject(input: unknown): Project {
  if (!input || typeof input !== "object")
    throw Error("Expected a PHYSICS LAB project object.");
  const p = structuredClone(input) as Project;
  if (p.version !== 1 && p.version !== 2)
    throw Error(
      "Unsupported project version. This application reads versions 1 and 2.",
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
    !["light", "heat", "runaway"].includes(p.challenge)
  )
    throw Error("Unknown challenge.");
  const migrated = p.version === 1;
  p.version = 2;
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
    if (migrated) c.props = { ...catalog(c).props, ...c.props };
    if (
      ![c.x, c.y, c.rotation].every(Number.isFinite) ||
      Math.abs(c.x) > 100000 ||
      Math.abs(c.y) > 100000
    )
      throw Error("Invalid component position.");
    if (!c.props || typeof c.props !== "object")
      throw Error("Missing component properties.");
    for (const [key, def] of Object.entries(definitions[c.kind].defaults)) {
      const v = c.props[key];
      if (typeof v !== typeof def) throw Error(`Invalid ${key} on ${c.name}.`);
      if (typeof v === "number") {
        const r = ranges[key];
        if (!Number.isFinite(v) || (r && (v < r[0] || v > r[1])))
          throw Error(`${c.name}: ${key} is out of range.`);
      }
    }
    const modelError = catalogError(c);
    if (modelError) throw Error(modelError);
    if (c.kind === "hysteresis" && Number(c.props.low) >= Number(c.props.high))
      throw Error("Low threshold must be below high threshold.");
    if (["sensor", "thermostat", "safety"].includes(c.kind)) {
      if (Number(c.props.minRange) >= Number(c.props.maxRange))
        throw Error("Invalid sensor range.");
      const target = c.props.target;
      if (
        target !== "" &&
        !p.components.some((x) => x.id === target && isThermalMass(x))
      )
        throw Error("Sensor target must be a thermal mass.");
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
    });
    assembly.components = checked.components;
    assembly.connections = checked.connections;
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
        "voltage",
        "current",
        "currentNC",
        "power",
        "temperature",
        "energy",
        "state",
        "signal",
        "nodeVoltage",
      ].includes(probe.measurement)
    )
      throw Error("Unknown probe measurement.");
    const c = p.components.find((c) => c.id === probe.component);
    if (!c) throw Error("Probe target is missing.");
    if (!measurements(c).includes(probe.measurement))
      throw Error("Measurement is incompatible with probe target.");
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
