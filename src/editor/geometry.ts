import {
  definitions,
  type Component,
  type Connection,
  type Point,
} from "../simulation/model";
export function dimensions(c: Component) {
  return {
    w: c.kind === "tank" ? 202 : c.kind === "switch" ? 154 : 174,
    h: c.kind === "tank" ? 170 : c.kind === "switch" ? 100 : 132,
  };
}
export function portLocal(c: Component, port: string): Point {
  const { w, h } = dimensions(c);
  const p = definitions[c.kind].ports.find((p) => p.id === port);
  if (p?.domain === "hydraulic" && c.kind === "heatExchanger")
    return { x: port === "hotIn" || port === "coldOut" ? -12 : w + 12, y: port.startsWith("hot") ? h * 0.3 : h * 0.75 };
  if (p?.domain === "hydraulic" && port === "overflow") return { x: w + 12, y: 28 };
  if (p?.domain === "hydraulic") return { x: port === "inlet" ? -12 : port === "outlet" ? w + 12 : w / 2, y: port === "fluid" ? h + 12 : h / 2 };
  if (p?.domain === "mechanical") return { x: w / 2, y: -12 };
  if (p?.domain === "control") {
    if (["relay", "safety", "cooler", "motor", "actuatedValve", "breaker", "motorProtector", "starDeltaStarter", "softStarter", "vfd"].includes(c.kind))
      return { x: ["in", "enable", "position", "run", "start"].includes(port) ? w * 0.3 : w * 0.7, y: h + 12 };
    if (p.direction === "out") return { x: w + 12, y: h / 2 };
    const inputs = definitions[c.kind].ports.filter(
      (p) => p.direction === "in",
    );
    return { x: -12, y: 48 + inputs.findIndex((p) => p.id === port) * 36 };
  }
  if (c.kind === "contactor" && (port === "ca" || port === "cb")) return { x: port === "ca" ? w * 0.3 : w * 0.7, y: h + 12 };
  if (c.kind === "radiator" && p?.domain === "electrical") return { x: port === "a" ? w * 0.3 : w * 0.7, y: h + 12 };
  if (c.kind === "transformer" && p?.domain === "electrical") return { x: port === "a" || port === "b" ? -12 : w + 12, y: port === "a" || port === "sa" ? h * 0.3 : h * 0.7 };
  // Drive: line input on the left (phase, neutral), motor output on the right.
  if (c.kind === "vfd") return { x: port === "a" || port === "b" ? -12 : w + 12, y: port === "a" || port === "oa" ? h * 0.3 : h * 0.7 };
  return {
    x: port === "a" ? -12 : port === "b" || port === "nc" ? w + 12 : w / 2,
    y:
      port === "heat"
        ? c.kind === "tank"
          ? -12
          : h + 12
        : port === "nc"
          ? h - 25
          : h / 2,
  };
}
export function portPoint(c: Component, port: string) {
  const { w, h } = dimensions(c),
    { x, y } = portLocal(c, port),
    r = (c.rotation * Math.PI) / 180,
    dx = x - w / 2,
    dy = y - h / 2;
  return {
    x: c.x + w / 2 + dx * Math.cos(r) - dy * Math.sin(r),
    y: c.y + h / 2 + dx * Math.sin(r) + dy * Math.cos(r),
  };
}
export function routePoints(w: Connection, cs: Component[]): Point[] {
  const c = cs.find((c) => c.id === w.from.component),
    d = cs.find((c) => c.id === w.to.component);
  if (!c || !d) return [];
  const a = portPoint(c, w.from.port),
    b = portPoint(d, w.to.port);
  let anchors: Point[];
  if (w.route?.length) anchors = [a, ...w.route, b];
  else {
    const laneY = Math.max(c.y + dimensions(c).h, d.y + dimensions(d).h) + 70;
    const laneX = Math.round((a.x + b.x) / 40) * 20;
    const candidates = [
      [a, { x: laneX, y: a.y }, { x: laneX, y: b.y }, b],
      [
        a,
        { x: a.x - 30, y: a.y },
        { x: a.x - 30, y: laneY },
        { x: b.x + 30, y: laneY },
        { x: b.x + 30, y: b.y },
        b,
      ],
      [
        a,
        { x: a.x, y: Math.min(c.y, d.y) - 60 },
        { x: b.x, y: Math.min(c.y, d.y) - 60 },
        b,
      ],
    ];
    const score = (ps: Point[]) =>
      ps.slice(1).reduce((sum, p, i) => {
        const q = ps[i];
        const intersections = cs.filter((x) => {
          const { w, h } = dimensions(x);
          return p.x === q.x
            ? p.x > x.x - 8 &&
                p.x < x.x + w + 8 &&
                Math.max(p.y, q.y) > x.y - 8 &&
                Math.min(p.y, q.y) < x.y + h + 8
            : p.y > x.y - 8 &&
                p.y < x.y + h + 8 &&
                Math.max(p.x, q.x) > x.x - 8 &&
                Math.min(p.x, q.x) < x.x + w + 8;
        }).length;
        return (
          sum +
          intersections * 10000 +
          Math.abs(p.x - q.x) +
          Math.abs(p.y - q.y)
        );
      }, 0);
    anchors = candidates.sort((a, b) => score(a) - score(b))[0];
  }
  const points: Point[] = [anchors[0]];
  for (const p of anchors.slice(1)) {
    const q = points.at(-1)!;
    if (p.x !== q.x && p.y !== q.y) points.push({ x: p.x, y: q.y });
    points.push(p);
  }
  return points.filter(
    (p, i) => i === 0 || p.x !== points[i - 1].x || p.y !== points[i - 1].y,
  );
}
export const wirePath = (w: Connection, cs: Component[]) =>
  routePoints(w, cs)
    .map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`)
    .join(" ");
