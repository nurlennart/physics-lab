import { definitions, prop, terminalKey, type Project } from "./model";
export interface ElectricalReading {
  voltage: number;
  current: number;
  power: number;
}
export interface ElectricalResult {
  readings: Record<string, ElectricalReading>;
  nodes: Record<string, number>;
  sourcePower: number;
  dissipatedPower: number;
  residual: number;
  islands: number;
}
class Union {
  p = new Map<string, string>();
  find(x: string): string {
    if (!this.p.has(x)) this.p.set(x, x);
    const p = this.p.get(x)!;
    if (p !== x) this.p.set(x, this.find(p));
    return this.p.get(x)!;
  }
  join(a: string, b: string) {
    this.p.set(this.find(a), this.find(b));
  }
}
export function solveLinear(a: number[][], b: number[]): number[] {
  const n = b.length,
    m = a.map((r, i) => [...r, b[i]]);
  for (let k = 0; k < n; k++) {
    let pivot = k;
    for (let i = k + 1; i < n; i++)
      if (Math.abs(m[i][k]) > Math.abs(m[pivot][k])) pivot = i;
    if (Math.abs(m[pivot][k]) < 1e-12)
      throw Error(
        "Singular circuit: conflicting voltage sources or undefined ideal-source currents.",
      );
    [m[k], m[pivot]] = [m[pivot], m[k]];
    for (let i = k + 1; i < n; i++) {
      const f = m[i][k] / m[k][k];
      for (let j = k; j <= n; j++) m[i][j] -= f * m[k][j];
    }
  }
  const x = Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = m[i][n];
    for (let j = i + 1; j < n; j++) s -= m[i][j] * x[j];
    x[i] = s / m[i][i];
  }
  if (x.some((v) => !Number.isFinite(v)))
    throw Error("Circuit solver produced a non-finite result.");
  return x;
}
export function solveElectrical(
  project: Project,
  failed: Record<string, boolean> = {},
): ElectricalResult {
  const uf = new Union();
  const cs = project.components.filter((c) =>
    definitions[c.kind].ports.some((p) => p.domain === "electrical"),
  );
  for (const c of cs)
    for (const p of definitions[c.kind].ports.filter(
      (p) => p.domain === "electrical",
    ))
      uf.find(`${c.id}:${p.id}`);
  for (const w of project.connections.filter((w) => w.domain === "electrical"))
    uf.join(terminalKey(w.from), terminalKey(w.to));
  const grounds = cs.filter((c) => c.kind === "ground");
  for (const g of grounds.slice(1)) uf.join(`${g.id}:a`, `${grounds[0].id}:a`);
  const node = (id: string, p: string) => uf.find(`${id}:${p}`);
  const active = cs.filter(
    (c) =>
      c.kind !== "ground" &&
      !failed[c.id] &&
      !(c.kind === "switch" && !c.props.closed),
  );
  const islands = new Union();
  for (const c of cs)
    for (const p of definitions[c.kind].ports.filter(
      (p) => p.domain === "electrical",
    ))
      islands.find(node(c.id, p.id));
  for (const c of active) islands.join(node(c.id, "a"), node(c.id, "b"));
  const groups = new Map<string, string[]>();
  for (const n of new Set([...uf.p.keys()].map((k) => uf.find(k)))) {
    const key = islands.find(n);
    groups.set(key, [...(groups.get(key) ?? []), n]);
  }
  const voltages: Record<string, number> = {},
    sourceI: Record<string, number> = {};
  let residual = 0;
  for (const ns of groups.values()) {
    const members = active.filter((c) => ns.includes(node(c.id, "a")));
    const sources = members.filter((c) => c.kind === "source");
    for (const s of sources)
      if (node(s.id, "a") === node(s.id, "b"))
        throw Error(
          `${s.name}: supply terminals are shorted. Remove the short circuit.`,
        );
    const g = grounds.find((c) => ns.includes(node(c.id, "a")));
    const ref = g
      ? node(g.id, "a")
      : sources.length
        ? node(sources[0].id, "b")
        : ns[0];
    const unknown = ns.filter((n) => n !== ref),
      size = unknown.length + sources.length;
    if (size > 250)
      throw Error("Circuit matrix exceeds 250 unknowns. Reduce the scene.");
    const indices = new Map(unknown.map((n, i) => [n, i]));
    const a = Array.from({ length: size }, () => Array(size).fill(0)),
      b = Array(size).fill(0);
    const stamp = (row: string, col: string, v: number) => {
      const i = indices.get(row),
        j = indices.get(col);
      if (i !== undefined && j !== undefined) a[i][j] += v;
    };
    for (const c of members.filter((c) => c.kind !== "source")) {
      const conductance = 1 / Math.max(0.000001, prop(c, "resistance", 1));
      const p = node(c.id, "a"),
        q = node(c.id, "b");
      stamp(p, p, conductance);
      stamp(q, q, conductance);
      stamp(p, q, -conductance);
      stamp(q, p, -conductance);
    }
    sources.forEach((s, i) => {
      const k = unknown.length + i,
        p = indices.get(node(s.id, "a")),
        q = indices.get(node(s.id, "b"));
      if (p !== undefined) {
        a[p][k] += 1;
        a[k][p] += 1;
      }
      if (q !== undefined) {
        a[q][k] -= 1;
        a[k][q] -= 1;
      }
      b[k] = prop(s, "voltage");
    });
    const x = size ? solveLinear(a, b) : [];
    voltages[ref] = 0;
    unknown.forEach((n, i) => (voltages[n] = x[i]));
    sources.forEach((s, i) => (sourceI[s.id] = x[unknown.length + i]));
    for (let i = 0; i < size; i++)
      residual = Math.max(
        residual,
        Math.abs(a[i].reduce((s, v, j) => s + v * x[j], 0) - b[i]),
      );
  }
  const readings: Record<string, ElectricalReading> = {};
  let sourcePower = 0,
    dissipatedPower = 0;
  for (const c of cs) {
    const voltage =
      (voltages[node(c.id, "a")] ?? 0) -
      (c.kind === "ground" ? 0 : (voltages[node(c.id, "b")] ?? 0));
    const current =
      c.kind === "source"
        ? (sourceI[c.id] ?? 0)
        : active.includes(c) && c.kind !== "ground"
          ? voltage / Math.max(0.000001, prop(c, "resistance", 1))
          : 0;
    const power = voltage * current;
    readings[c.id] = { voltage, current, power };
    if (c.kind === "source") sourcePower -= power;
    else dissipatedPower += power;
  }
  const nodes: Record<string, number> = {};
  for (const k of uf.p.keys()) nodes[k] = voltages[uf.find(k)] ?? 0;
  return {
    readings,
    nodes,
    sourcePower,
    dissipatedPower,
    residual,
    islands: groups.size,
  };
}
