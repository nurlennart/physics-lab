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
  if (c.kind === 'electricBoiler' && p?.domain === 'electrical') return { x: 22 + ['L1', 'L2', 'L3', 'N', 'PE'].indexOf(port) * 32, y: -12 };
  if (c.kind === 'electricBoiler' && p?.domain === 'control') return { x: 30 + ['enable', 'setpoint', 'reset'].indexOf(port) * 56, y: h + 12 };
  if (p?.domain === "hydraulic" && c.kind === "heatExchanger")
    return { x: port === "hotIn" || port === "coldOut" ? -12 : w + 12, y: port.startsWith("hot") ? h * 0.3 : h * 0.75 };
  if (p?.domain === "hydraulic" && port === "overflow") return { x: w + 12, y: 28 };
  if (p?.domain === "hydraulic") return { x: port === "inlet" ? -12 : port === "outlet" ? w + 12 : w / 2, y: port === "fluid" ? h + 12 : h / 2 };
  if (p?.domain === "mechanical") return { x: w / 2, y: -12 };
  if (p?.domain === "control") {
    if (["relay", "safety", "cooler", "motor", "circulator", "actuatedValve", "breaker", "motorProtector", "starDeltaStarter", "softStarter", "vfd"].includes(c.kind))
      return { x: ["in", "enable", "position", "run", "start"].includes(port) ? w * 0.3 : w * 0.7, y: h + 12 };
    if (p.direction === "out") return { x: w + 12, y: h / 2 };
    const inputs = definitions[c.kind].ports.filter(
      (p) => p.direction === "in",
    );
    return { x: -12, y: 48 + inputs.findIndex((p) => p.id === port) * 36 };
  }
  if (c.kind === "contactor" && (port === "ca" || port === "cb")) return { x: port === "ca" ? w * 0.3 : w * 0.7, y: h + 12 };
  if (c.kind === "radiator" && p?.domain === "electrical") return { x: port === "a" ? w * 0.3 : w * 0.7, y: h + 12 };
  // Circulator: supply terminals on top (control inputs below, water through the sides).
  if (c.kind === "circulator" && p?.domain === "electrical") return { x: port === "a" ? w * 0.3 : w * 0.7, y: -12 };
  if (['hybridInverter', 'gridInverter'].includes(c.kind) && p?.domain === 'electrical') return { x: port === 'a' || port === 'b' ? -12 : w + 12, y: port === 'a' ? h * .3 : port === 'b' ? h * .7 : port === 'ga' ? h * .2 : port === 'gb' ? h * .4 : port === 'oa' ? h * .65 : h * .85 };
  if (c.kind === 'gridMeter' && port === 'reference') return { x: w / 2, y: -12 };
  if (["mpptController", "inverter"].includes(c.kind) && p?.domain === "electrical") return { x: port === "a" || port === "b" ? -12 : w + 12, y: port === "a" || port === "oa" ? h * 0.3 : h * 0.7 };
  if (c.kind === "batteryProtection" && port === "reference") return { x: w / 2, y: -12 };
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
/** Axis-aligned bounds of a module body, rotation included. */
export function bounds(c: Component) {
  const { w, h } = dimensions(c), r = (c.rotation * Math.PI) / 180;
  const hw = (Math.abs(w * Math.cos(r)) + Math.abs(h * Math.sin(r))) / 2, hh = (Math.abs(w * Math.sin(r)) + Math.abs(h * Math.cos(r))) / 2;
  return { x0: c.x + w / 2 - hw, y0: c.y + h / 2 - hh, x1: c.x + w / 2 + hw, y1: c.y + h / 2 + hh };
}
type Dir = 0 | 1 | 2 | 3; // right, down, left, up (SVG: y grows downwards)
const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
/** Direction in which a terminal faces away from its module body. */
export function portDirection(c: Component, port: string): Dir {
  const { w, h } = dimensions(c), { x, y } = portLocal(c, port);
  const vx = x < 0 ? -1 : x > w ? 1 : 0, vy = vx ? 0 : y < h / 2 ? -1 : 1;
  const r = (c.rotation * Math.PI) / 180, rx = vx * Math.cos(r) - vy * Math.sin(r), ry = vx * Math.sin(r) + vy * Math.cos(r);
  return Math.abs(rx) >= Math.abs(ry) ? (rx > 0 ? 0 : 2) : ry > 0 ? 1 : 3;
}

/**
 * Orthogonal wire router. All automatically routed wires of a project are laid out together on a sparse grid
 * (module clearance lanes, terminal coordinates and the channels between modules):
 *  - every wire leaves and enters its terminals in the direction they face (a STUB-long straight run);
 *  - module bodies (rotation-aware, plus MARGIN) are obstacles: passing one costs far more than any detour;
 *  - the captions under modules and the terminals of other nets (with their stubs) are obstacles as well, so no wire
 *    runs over a label or across a foreign terminal;
 *  - each bend costs BEND; running along a wire of another net costs SHARE plus 4× the length, crossing one CROSS;
 *    wires of the same net may share a trunk.
 * Wires with hand-placed bend points keep them. Results are memoised per (components, connections) pair.
 */
const MARGIN = 10, STUB = 20, LANE = 20, BEND = 60, CROSS = 80, SHARE = 2000, OBSTACLE = 20000, TERMINAL = 5000, SEPARATION = 8, WINDOW = 300, BUDGET = 15000;
const key = (v: number) => Math.round(v * 2) / 2;
/** Captions under a module, drawn unrotated and centred: the label at y = h + 32 and the live readout below it (h + 49, heater h + 64). */
function caption(c: Component) {
  const { w, h } = dimensions(c), half = Math.max(definitions[c.kind].label.length * 3.6 + 6, 90);
  return { x0: c.x + w / 2 - half, y0: c.y + h + 18, x1: c.x + w / 2 + half, y1: c.y + h + (c.kind === "heater" ? 69 : 54) };
}
type Terminal = { p: Point; dir: Dir };
/**
 * Straight run out of a terminal: STUB, or past the caption for a terminal facing down through it; never more than
 * half way to a terminal facing it on the same line.
 */
function stubLength(c: Component, p: Point, dir: Dir, terminals: Terminal[]) {
  const k = caption(c);
  let length = dir === 1 && p.x > k.x0 && p.x < k.x1 && p.y < k.y1 ? Math.max(STUB, k.y1 + MARGIN - p.y) : STUB;
  for (const t of terminals) {
    if (t.dir !== (dir + 2) % 4) continue;
    const gap = (t.p.x - p.x) * DX[dir] + (t.p.y - p.y) * DY[dir], offset = Math.abs((t.p.x - p.x) * DY[dir] - (t.p.y - p.y) * DX[dir]);
    if (gap > 0 && offset < SEPARATION) length = Math.min(length, gap / 2 - 2);
  }
  return length;
}
/** Index range [first, last] of sorted values strictly inside (lo, hi). */
function inside(values: number[], lo: number, hi: number): [number, number] {
  let a = 0, b = values.length;
  while (a < b) { const m = (a + b) >> 1; if (values[m] > lo) b = m; else a = m + 1; }
  let c = a, d = values.length;
  while (c < d) { const m = (c + d) >> 1; if (values[m] >= hi) d = m; else c = m + 1; }
  return [a, c - 1];
}
const routeCache = new WeakMap<Component[], WeakMap<Connection[], Map<string, Point[]>>>();
export function routePoints(w: Connection, cs: Component[], ws: Connection[] = [w]): Point[] {
  return routeAll(cs, ws.includes(w) ? ws : [w]).get(w.id) ?? [];
}
export function routeAll(cs: Component[], ws: Connection[]): Map<string, Point[]> {
  let byWires = routeCache.get(cs);
  if (!byWires) routeCache.set(cs, (byWires = new WeakMap()));
  let routes = byWires.get(ws);
  if (!routes) byWires.set(ws, (routes = computeRoutes(cs, ws)));
  return routes;
}
function orthogonal(anchors: Point[]) {
  const points: Point[] = [anchors[0]];
  for (const p of anchors.slice(1)) {
    const q = points.at(-1)!;
    if (p.x !== q.x && p.y !== q.y) points.push({ x: p.x, y: q.y });
    points.push(p);
  }
  return simplify(points);
}
function simplify(points: Point[]) {
  const out: Point[] = [];
  for (const p of points) {
    if (out.length && out.at(-1)!.x === p.x && out.at(-1)!.y === p.y) continue;
    if (out.length >= 2) {
      const a = out.at(-2)!, b = out.at(-1)!;
      if ((a.x === b.x && b.x === p.x) || (a.y === b.y && b.y === p.y)) out.pop();
    }
    out.push(p);
  }
  return out;
}
function computeRoutes(cs: Component[], ws: Connection[]): Map<string, Point[]> {
  const routes = new Map<string, Point[]>();
  const byId = new Map(cs.map((c) => [c.id, c]));
  // Nets: terminals joined by wires (wires of one net may share a trunk without ambiguity).
  const parent = new Map<string, string>();
  const find = (k: string): string => { const p = parent.get(k) ?? k; if (p === k) return k; const r = find(p); parent.set(k, r); return r; };
  for (const w of ws) parent.set(find(`${w.from.component}:${w.from.port}`), find(`${w.to.component}:${w.to.port}`));
  const terminals = new Map(cs.flatMap((c) => definitions[c.kind].ports.map((port) => [`${c.id}:${port.id}`, { p: portPoint(c, port.id), dir: portDirection(c, port.id) }] as const)));
  const all = [...terminals.values()], stub = (c: Component, port: string) => { const t = terminals.get(`${c.id}:${port}`)!; return stubLength(c, t.p, t.dir, all); };
  const ends: { w: Connection; a: Point; b: Point; sa: Point; sb: Point; da: Dir; db: Dir; net: string }[] = [];
  for (const w of ws) {
    const c = byId.get(w.from.component), d = byId.get(w.to.component);
    if (!c || !d) continue;
    const a = portPoint(c, w.from.port), b = portPoint(d, w.to.port);
    if (w.route?.length) { routes.set(w.id, orthogonal([a, ...w.route, b])); continue; }
    const da = portDirection(c, w.from.port), db = portDirection(d, w.to.port);
    // Terminals facing each other at less than two stub lengths share the gap between them.
    let la = stub(c, w.from.port), lb = stub(d, w.to.port);
    // Terminals facing each other closer than both stubs: the stubs meet instead of overlapping (no jog).
    const gap = (b.x - a.x) * DX[da] + (b.y - a.y) * DY[da];
    if (db === (da + 2) % 4 && gap > 0 && gap < la + lb) { la = Math.max(Math.min(la, gap - 8), gap / 2); lb = gap - la; }
    const at = (p: Point, dir: Dir, l: number) => ({ x: key(p.x + DX[dir] * l), y: key(p.y + DY[dir] * l) });
    ends.push({ w, a: { x: key(a.x), y: key(a.y) }, b: { x: key(b.x), y: key(b.y) }, sa: at(a, da, la), sb: at(b, db, lb), da, db, net: find(`${w.from.component}:${w.from.port}`) });
  }
  if (!ends.length) return routes;
  // Sparse grid: clearance lanes around each module, terminal and stub coordinates, and the middle of each channel.
  const boxes = cs.map(bounds).map((b) => ({ x0: b.x0 - MARGIN, y0: b.y0 - MARGIN, x1: b.x1 + MARGIN, y1: b.y1 + MARGIN }));
  for (const c of cs) boxes.push(caption(c));
  const xs = new Set<number>(), ys = new Set<number>();
  for (const b of boxes) { xs.add(key(b.x0 - LANE + MARGIN)); xs.add(key(b.x1 + LANE - MARGIN)); ys.add(key(b.y0 - LANE + MARGIN)); ys.add(key(b.y1 + LANE - MARGIN)); }
  for (const e of ends) for (const p of [e.a, e.b, e.sa, e.sb]) { xs.add(p.x); ys.add(p.y); }
  const channels = (edges: number[], into: Set<number>) => {
    const sorted = [...new Set(edges)].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      // Wide channels get several lanes, at least 2·LANE apart, at most 4.
      const gap = sorted[i] - sorted[i - 1], lanes = Math.min(4, Math.floor(gap / (2 * LANE)));
      for (let k = 1; k <= lanes; k++) into.add(key(sorted[i - 1] + (gap * k) / (lanes + 1)));
    }
  };
  channels(boxes.flatMap((b) => [b.x0, b.x1]), xs);
  channels(boxes.flatMap((b) => [b.y0, b.y1]), ys);
  const X = [...xs].sort((a, b) => a - b), Y = [...ys].sort((a, b) => a - b), nx = X.length, ny = Y.length;
  const xi = new Map(X.map((v, i) => [v, i])), yi = new Map(Y.map((v, i) => [v, i]));
  // Edge e = node index; horizontal edges go node → node + 1, vertical ones node → node + nx.
  /** Grid edges entering the interior of box b: horizontal (edge index j·nx + i spans X[i]..X[i+1]) and vertical. */
  const cover = (b: { x0: number; y0: number; x1: number; y1: number }, horizontal: (edge: number) => void, vertical: (edge: number) => void) => {
    const [i0, i1] = inside(X, b.x0, b.x1), [j0, j1] = inside(Y, b.y0, b.y1);
    // Edges crossing into the box start one grid line before its first interior line.
    for (let j = j0; j <= j1; j++) for (let i = Math.max(0, i0 - 1); i <= Math.min(nx - 2, i1); i++) horizontal(j * nx + i);
    for (let i = i0; i <= i1; i++) for (let j = Math.max(0, j0 - 1); j <= Math.min(ny - 2, j1); j++) vertical(j * nx + i);
  };
  const blockedH = new Uint8Array(nx * ny), blockedV = new Uint8Array(nx * ny);
  for (const b of boxes) cover(b, (e) => (blockedH[e] = 1), (e) => (blockedV[e] = 1));
  // Occupancy per grid edge or node: −1 free, a net number, or −2 for several nets.
  const nets = new Map<string, number>(), netOf = (k: string) => { const r = find(k); if (!nets.has(r)) nets.set(r, nets.size); return nets.get(r)!; };
  const occupancy = () => new Int32Array(nx * ny).fill(-1);
  const mark = (m: Int32Array, k: number, net: number) => { m[k] = m[k] === -1 || m[k] === net ? net : -2; };
  // Terminals with their stubs, each owned by its net (an unwired terminal is a net of its own).
  const terminalH = occupancy(), terminalV = occupancy();
  for (const c of cs) for (const port of definitions[c.kind].ports) {
    const { p, dir } = terminals.get(`${c.id}:${port.id}`)!, l = stub(c, port.id), q = { x: p.x + DX[dir] * l, y: p.y + DY[dir] * l };
    const net = netOf(`${c.id}:${port.id}`);
    cover({ x0: Math.min(p.x, q.x) - 6, y0: Math.min(p.y, q.y) - 6, x1: Math.max(p.x, q.x) + 6, y1: Math.max(p.y, q.y) + 6 }, (e) => mark(terminalH, e, net), (e) => mark(terminalV, e, net));
  }
  const usedH = occupancy(), usedV = occupancy(), passH = occupancy(), passV = occupancy();
  // Shortest wires first: they have the fewest alternatives.
  ends.sort((p, q) => Math.abs(p.a.x - p.b.x) + Math.abs(p.a.y - p.b.y) - Math.abs(q.a.x - q.b.x) - Math.abs(q.a.y - q.b.y));
  // Search state per (node, heading); `seen` stamps which entries belong to the current search (no clearing per wire).
  const n = nx * ny, cost = new Float64Array(n * 4), from = new Int32Array(n * 4), seen = new Uint32Array(n * 4);
  let stamp = 0;
  for (const e of ends) {
    const net = netOf(e.net);
    const start = yi.get(e.sa.y)! * nx + xi.get(e.sa.x)!, goal = yi.get(e.sb.y)! * nx + xi.get(e.sb.x)!;
    const gx = e.sb.x, gy = e.sb.y, into = ((e.db + 2) % 4) as Dir;
    /**
     * A* over (node, heading). First with module bodies, foreign terminals and lanes of other nets as hard walls
     * (cheap: only lengths, bends and crossings are left to trade off); only if that fails, with them as penalties.
     * The search is confined to a window around both terminals and to BUDGET expanded states, so a congested
     * project degrades to a simple orthogonal route instead of stalling the editor.
     */
    const search = (hard: boolean, window: number) => {
      stamp++;
      let expanded = 0;
      const [i0, i1] = inside(X, Math.min(e.sa.x, gx) - window, Math.max(e.sa.x, gx) + window), [j0, j1] = inside(Y, Math.min(e.sa.y, gy) - window, Math.max(e.sa.y, gy) + window);
      const heap = new Heap();
      seen[start * 4 + e.da] = stamp;
      cost[start * 4 + e.da] = 0;
      from[start * 4 + e.da] = -1;
      heap.push(start * 4 + e.da, Math.abs(X[start % nx] - gx) + Math.abs(Y[(start / nx) | 0] - gy));
      let best = -1, bestCost = Infinity;
      while (heap.size) {
        const f = heap.peek(), s = heap.pop();
        if (f >= bestCost) break;
        const v = s >> 2, d = (s & 3) as Dir, g = cost[s];
        if (++expanded > BUDGET) return -1;
        if (v === goal) {
          const total = g + (d === into ? 0 : d === e.db ? 3 * BEND + 2 * STUB : BEND);
          if (total < bestCost) { bestCost = total; best = s; }
          continue;
        }
        const i = v % nx, j = (v / nx) | 0;
        for (let d2 = 0; d2 < 4; d2++) {
          if (d2 === (d + 2) % 4) continue;
          const i2 = i + DX[d2], j2 = j + DY[d2];
          if (i2 < i0 || j2 < j0 || i2 > i1 || j2 > j1) continue;
          const v2 = j2 * nx + i2, horizontal = d2 % 2 === 0, edge = horizontal ? j * nx + Math.min(i, i2) : Math.min(j, j2) * nx + i;
          const length = horizontal ? Math.abs(X[i2] - X[i]) : Math.abs(Y[j2] - Y[j]);
          const blocked = (horizontal ? blockedH : blockedV)[edge], terminal = (horizontal ? terminalH : terminalV)[edge], used = (horizontal ? usedH : usedV)[edge], pass = (horizontal ? passV : passH)[v2];
          const foreignTerminal = terminal !== -1 && terminal !== net, foreignLane = used !== -1 && used !== net;
          if (hard && (blocked || foreignTerminal || foreignLane)) continue;
          let step = length + (d2 !== d ? BEND : 0);
          if (blocked) step += OBSTACLE + 50 * length;
          if (foreignTerminal) step += TERMINAL;
          if (foreignLane) step += SHARE + 4 * length;
          if (pass !== -1 && pass !== net) step += CROSS;
          const g2 = g + step, s2 = v2 * 4 + d2;
          if (seen[s2] !== stamp || g2 < cost[s2]) {
            seen[s2] = stamp;
            cost[s2] = g2;
            from[s2] = s;
            heap.push(s2, g2 + Math.abs(X[i2] - gx) + Math.abs(Y[j2] - gy));
          }
        }
      }
      return best;
    };
    let best = search(true, WINDOW);
    if (best < 0) best = search(true, 3 * WINDOW);
    if (best < 0) best = search(false, WINDOW);
    const nodes: number[] = [];
    for (let s = best; s >= 0; s = from[s]) nodes.push(s >> 2);
    nodes.reverse();
    const points = best < 0 ? orthogonal([e.a, e.sa, e.sb, e.b]) : simplify([e.a, ...nodes.map((v) => ({ x: X[v % nx], y: Y[(v / nx) | 0] })), e.b]);
    routes.set(e.w.id, points);
    // Occupancy along the whole route, terminal stubs included (they lie on grid lines). Parallel lines closer than
    // SEPARATION read as one line and are occupied too; on the line itself the span is extended by SEPARATION, so a
    // wire of another net cannot continue this one end to end.
    for (let k = 1; k < points.length; k++) {
      const p = points[k - 1], q = points[k], horizontal = p.y === q.y;
      const [along, across, at] = horizontal ? [X, Y, p.y] : [Y, X, p.x], lo = Math.min(horizontal ? p.x : p.y, horizontal ? q.x : q.y), hi = Math.max(horizontal ? p.x : p.y, horizontal ? q.x : q.y);
      const [c0, c1] = inside(across, at - SEPARATION, at + SEPARATION), [n0, n1] = inside(along, lo, hi);
      const line = (horizontal ? yi : xi).get(at)!, count = along.length;
      const index = (alongIndex: number, acrossIndex: number) => (horizontal ? acrossIndex * nx + alongIndex : alongIndex * nx + acrossIndex);
      for (let c = c0; c <= c1; c++) {
        const [a0, a1] = c === line ? inside(along, lo - SEPARATION, hi + SEPARATION) : [n0, n1];
        for (let a = Math.max(0, a0 - 1); a <= Math.min(count - 2, a1); a++) mark(horizontal ? usedH : usedV, index(a, c), net);
      }
      for (let a = n0; a <= n1; a++) mark(horizontal ? passH : passV, index(a, line), net);
    }
  }
  return routes;
}
/** Binary min-heap of (state, priority). */
class Heap {
  private items: number[] = [];
  private priorities: number[] = [];
  get size() { return this.items.length; }
  push(item: number, priority: number) {
    const a = this.items, p = this.priorities;
    let i = a.length;
    a.push(item); p.push(priority);
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (p[up] <= priority) break;
      a[i] = a[up]; p[i] = p[up]; i = up;
    }
    a[i] = item; p[i] = priority;
  }
  peek() { return this.priorities[0]; }
  pop() {
    const a = this.items, p = this.priorities, top = a[0];
    const item = a.pop()!, priority = p.pop()!;
    if (a.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i, mp = priority;
        if (l < a.length && p[l] < mp) { m = l; mp = p[l]; }
        if (r < a.length && p[r] < mp) { m = r; }
        if (m === i) break;
        a[i] = a[m]; p[i] = p[m]; i = m;
      }
      a[i] = item; p[i] = priority;
    }
    return top;
  }
}
export const wirePath = (w: Connection, cs: Component[], ws?: Connection[]) =>
  routePoints(w, cs, ws)
    .map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`)
    .join(" ");
