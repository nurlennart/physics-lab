/** Wire router: terminals are left in the direction they face, wires avoid module bodies and do not run along wires of other nets. */
import { describe, it, expect } from "vitest";
import { starter } from "../simulation/projects";
import { makeComponent, connect, type Connection, type Point, type Project } from "../simulation/model";
import { bounds, portDirection, portPoint, routeAll, routePoints } from "./geometry";

const STARTERS = ["induction", "starting", "acRlc", "heat", "light", "runaway", "automated", "industrial", "exchanger", "transfer", "pressure", "supply", "circulation", "mechanism", "rotor", "descent", "lift", "rotation", "battery", "contactor", "transformer", "radiator"] as const;
type Segment = { a: Point; b: Point; net: string };

/** Nets: terminals joined by wires. */
function nets(ws: Connection[]) {
  const parent = new Map<string, string>();
  const find = (k: string): string => { const p = parent.get(k) ?? k; return p === k ? k : find(p); };
  for (const w of ws) parent.set(find(`${w.from.component}:${w.from.port}`), find(`${w.to.component}:${w.to.port}`));
  return (w: Connection) => find(`${w.from.component}:${w.from.port}`);
}
function measure(p: Project) {
  const routes = routeAll(p.components, p.connections), net = nets(p.connections);
  let throughModule = 0, sharedWithOtherNet = 0, crossings = 0;
  const segments: Segment[] = [];
  for (const w of p.connections) {
    const pts = routes.get(w.id)!;
    for (let i = 1; i < pts.length; i++) segments.push({ a: pts[i - 1], b: pts[i], net: net(w) });
    for (const c of p.components) {
      const b = bounds(c);
      if (pts.slice(1).some((q, i) => {
        const a = pts[i];
        return Math.max(a.x, q.x) > b.x0 + 1 && Math.min(a.x, q.x) < b.x1 - 1 && Math.max(a.y, q.y) > b.y0 + 1 && Math.min(a.y, q.y) < b.y1 - 1;
      })) throughModule++;
    }
  }
  const span = (s: Segment, axis: "x" | "y") => [Math.min(s.a[axis], s.b[axis]), Math.max(s.a[axis], s.b[axis])];
  for (let i = 0; i < segments.length; i++) for (let j = i + 1; j < segments.length; j++) {
    const s = segments[i], t = segments[j];
    if (s.net === t.net) continue;
    const sh = s.a.y === s.b.y, th = t.a.y === t.b.y;
    if (sh === th) {
      const along = sh ? "x" : "y", across = sh ? "y" : "x";
      // Parallel closer than 8 px reads as one line; on the same line, touching end to end reads as one wire.
      const offset = Math.abs(s.a[across] - t.a[across]);
      if (offset < 8) {
        const [s0, s1] = span(s, along), [t0, t1] = span(t, along), overlap = Math.min(s1, t1) - Math.max(s0, t0);
        if (offset < 1 ? overlap >= 0 : overlap > 0) sharedWithOtherNet++;
      }
    } else {
      const h = sh ? s : t, v = sh ? t : s, [h0, h1] = span(h, "x"), [v0, v1] = span(v, "y");
      if (v.a.x > h0 && v.a.x < h1 && h.a.y > v0 && h.a.y < v1) crossings++;
    }
  }
  return { throughModule, sharedWithOtherNet, crossings };
}
function expectWellFormed(p: Project) {
  const routes = routeAll(p.components, p.connections);
  for (const w of p.connections) {
    const pts = routes.get(w.id)!, c = p.components.find((c) => c.id === w.from.component)!, d = p.components.find((c) => c.id === w.to.component)!;
    for (let i = 1; i < pts.length; i++) expect(pts[i].x === pts[i - 1].x || pts[i].y === pts[i - 1].y).toBe(true);
    const a = portPoint(c, w.from.port), b = portPoint(d, w.to.port);
    expect(Math.hypot(pts[0].x - a.x, pts[0].y - a.y)).toBeLessThan(0.5);
    expect(Math.hypot(pts.at(-1)!.x - b.x, pts.at(-1)!.y - b.y)).toBeLessThan(0.5);
    if (w.route?.length) continue;
    // Leaves and enters each terminal in the direction it faces.
    const out = (q: Point, r: Point, dir: number) => Math.sign(r.x - q.x) === [1, 0, -1, 0][dir] && Math.sign(r.y - q.y) === [0, 1, 0, -1][dir];
    expect(out(pts[0], pts[1], portDirection(c, w.from.port))).toBe(true);
    expect(out(pts.at(-1)!, pts.at(-2)!, portDirection(d, w.to.port))).toBe(true);
  }
}

describe("wire routing", () => {
  it("routes every starter without passing a module body or running along a wire of another net", () => {
    // Previous fixed-candidate router over the same starters: 39 module passes, 39 runs along other wires (exact
    // collinear overlaps only), 18 crossings (several of them hidden behind modules).
    const total = { throughModule: 0, sharedWithOtherNet: 0, crossings: 0 };
    for (const mode of STARTERS) {
      const p = starter(mode);
      expectWellFormed(p);
      const m = measure(p);
      expect({ mode, ...m, crossings: 0 }).toEqual({ mode, throughModule: 0, sharedWithOtherNet: 0, crossings: 0 });
      total.crossings += m.crossings;
    }
    // Crossings between nets are often unavoidable; the router trades them against detours (23 in total today).
    expect(total.crossings).toBeLessThanOrEqual(23);
  });
  it("faces terminals of rotated modules and avoids the rotated body", () => {
    const p = starter("heat");
    for (const c of p.components) c.rotation = 90;
    expectWellFormed(p);
    expect(measure(p).throughModule).toBe(0);
  });
  it("detours around a module placed between two terminals", () => {
    const a = makeComponent("source", 0, 0, []), b = makeComponent("resistor", 600, 0, [a]), wall = makeComponent("resistor", 300, -20, [a, b]);
    const p: Project = { ...starter("blank"), components: [a, b, wall], connections: [] };
    const routed = connect(p, { component: a.id, port: "b" }, { component: b.id, port: "a" });
    expect(routed.connections).toHaveLength(1);
    expectWellFormed(routed);
    expect(measure(routed).throughModule).toBe(0);
  });
  it("keeps hand-placed bend points", () => {
    const p = starter("light"), w = p.connections[0];
    w.route = [{ x: 400, y: 600 }];
    const pts = routePoints(w, p.components, p.connections);
    expect(pts).toContainEqual({ x: 400, y: 600 });
  });
  it("memoises per project state and routes a large starter quickly", () => {
    const p = starter("supply"), t0 = performance.now();
    const first = routeAll(p.components, p.connections);
    const elapsed = performance.now() - t0;
    expect(routeAll(p.components, p.connections)).toBe(first);
    expect(elapsed).toBeLessThan(250); // budget for re-routing while a module is dragged (typically a few ms)
  });
});
