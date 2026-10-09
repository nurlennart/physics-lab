import {
  connect,
  definitions,
  makeComponent,
  uid,
  connectionError,
  type Kind,
  type Project,
  type Component,
} from "./model";
export function starter(
  mode: "heat" | "light" | "blank" = "heat",
  challenge = false,
): Project {
  let p: Project = {
    version: 1,
    id: uid(),
    name:
      mode === "heat"
        ? "Water heating experiment"
        : mode === "light"
          ? "First light experiment"
          : "Untitled experiment",
    components: [],
    connections: [],
    ...(challenge && mode !== "blank" ? { challenge: mode } : {}),
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
  return p;
}
export const ranges: Record<string, [number, number]> = {
  voltage: [0, 500],
  maxCurrent: [0.01, 10000],
  resistance: [0.001, 10000000],
  ratedPower: [0.01, 100000],
  heatCapacity: [1, 1000000],
  loss: [0, 10000],
  maxTemperature: [21, 1000],
  conductance: [0.01, 10000],
  volume: [0.1, 10000],
  capacity: [0.1, 10000],
  initialTemperature: [1, 95],
  ambient: [1, 95],
  ratedCurrent: [0.01, 10000],
};
export function parseProject(input: unknown): Project {
  if (!input || typeof input !== "object")
    throw Error("Expected a PHYSICS LAB project object.");
  const p = input as Project;
  if (p.version !== 1)
    throw Error(
      "Unsupported project version. This application reads version 1.",
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
  if (p.challenge !== undefined && !["light", "heat"].includes(p.challenge))
    throw Error("Unknown challenge.");
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
    if (c.kind === "tank" && Number(c.props.volume) > Number(c.props.capacity))
      throw Error("Tank volume exceeds capacity.");
  }
  let validated: Project = { ...p, connections: [] };
  const wireIds = new Set();
  for (const w of p.connections) {
    if (!w || typeof w.id !== "string" || wireIds.has(w.id) || !w.from || !w.to)
      throw Error("Invalid connection.");
    wireIds.add(w.id);
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
