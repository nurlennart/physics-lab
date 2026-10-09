import { definitions, prop, terminalKey, type Project } from "./model";
export interface ElectricalReading {
  voltage: number;
  current: number;
  power: number;
  currentNC?: number;
  contactCurrent?: number;
  voltageValid?: boolean;
}
export interface ElectricalResult {
  readings: Record<string, ElectricalReading>;
  nodes: Record<string, number>;
  sourcePower: number;
  dissipatedPower: number;
  residual: number;
  islands: number;
  nodeIds?: Record<string, string>;
  nodeIslands?: Record<string, string>;
  references?: Record<string, string>;
  powerResidual?: number;
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
export interface ElectricalRuntime {
  contacts?: Record<string, boolean>;
  faults?: Record<string, string>;
  disconnected?: Set<string>;
}
export function solveElectrical(
  project: Project,
  failed: Record<string, boolean> = {},
  runtime: ElectricalRuntime = {},
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
  for (const w of project.connections.filter(
    (w) => w.domain === "electrical" && !runtime.disconnected?.has(w.id),
  ))
    uf.join(terminalKey(w.from), terminalKey(w.to));
  const grounds = cs.filter((c) => c.kind === "ground");
  for (const g of grounds.slice(1)) uf.join(`${g.id}:a`, `${grounds[0].id}:a`);
  const node = (id: string, p: string) => uf.find(`${id}:${p}`);
  const end = (c: (typeof cs)[number]) =>
    c.kind === "relay" && !contact(c) ? "nc" : "b";
  const contact = (c: (typeof cs)[number]) =>
    runtime.faults?.[c.id] === "stuckClosed"
      ? true
      : (runtime.contacts?.[c.id] ?? c.kind === "safety");
  const active = cs.filter(
    (c) =>
      !["ground", "junction"].includes(c.kind) &&
      !failed[c.id] &&
      runtime.faults?.[c.id] !== "failedOpen" &&
      !(c.kind === "switch" && !c.props.closed) &&
      !(c.kind === "safety" && !contact(c)),
  );
  const islands = new Union();
  for (const c of cs)
    for (const p of definitions[c.kind].ports.filter(
      (p) => p.domain === "electrical",
    ))
      islands.find(node(c.id, p.id));
  for (const c of active) islands.join(node(c.id, "a"), node(c.id, end(c)));
  const groups = new Map<string, string[]>();
  for (const n of new Set([...uf.p.keys()].map((k) => uf.find(k)))) {
    const key = islands.find(n);
    groups.set(key, [...(groups.get(key) ?? []), n]);
  }
  const voltages: Record<string, number> = {},
    sourceI: Record<string, number> = {},
    references: Record<string, string> = {};
  let residual = 0;
  for (const [island, ns] of groups) {
    const members = active.filter((c) => ns.includes(node(c.id, "a"))),
      sources = members.filter((c) => c.kind === "source");
    for (const s of sources)
      if (node(s.id, "a") === node(s.id, "b"))
        throw Error(
          `${s.name}: supply terminals are shorted. Remove the short circuit.`,
        );
    const g = grounds.find((c) => ns.includes(node(c.id, "a"))),
      ref = g
        ? node(g.id, "a")
        : sources.length
          ? node(sources[0].id, "b")
          : ns[0];
    references[island] = ref;
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
      const resistance = prop(c, "resistance", 1);
      if (!Number.isFinite(resistance) || resistance <= 0)
        throw Error(`${c.name}: resistance must be positive.`);
      const conductance = 1 / resistance,
        p = node(c.id, "a"),
        q = node(c.id, end(c));
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
    sources.forEach((c, i) => (sourceI[c.id] = x[unknown.length + i]));
    for (let i = 0; i < size; i++)
      residual = Math.max(
        residual,
        Math.abs(a[i].reduce((sum, v, j) => sum + v * x[j], 0) - b[i]),
      );
  }
  const readings: Record<string, ElectricalReading> = {};
  let sourcePower = 0,
    dissipatedPower = 0;
  for (const c of cs) {
    if (c.kind === "ground" || c.kind === "junction") {
      readings[c.id] = {
        voltage: voltages[node(c.id, "a")] ?? 0,
        current: 0,
        power: 0,
        voltageValid: true,
      };
      continue;
    }
    const a = node(c.id, "a"),
      b = node(c.id, "b"),
      q = node(c.id, end(c));
    const valid = islands.find(a) === islands.find(b);
    const voltage = (voltages[a] ?? 0) - (voltages[b] ?? 0);
    const activeVoltage = (voltages[a] ?? 0) - (voltages[q] ?? 0);
    const contactCurrent =
      c.kind === "source"
        ? (sourceI[c.id] ?? 0)
        : active.includes(c)
          ? activeVoltage / prop(c, "resistance", 1)
          : 0;
    const current = c.kind === "relay" && end(c) === "nc" ? 0 : contactCurrent;
    const currentNC =
      c.kind === "relay" && end(c) === "nc" ? contactCurrent : 0;
    const power =
      c.kind === "source"
        ? voltage * contactCurrent
        : activeVoltage * contactCurrent;
    readings[c.id] = {
      voltage,
      current,
      currentNC,
      contactCurrent,
      power,
      voltageValid: valid,
    };
    if (c.kind === "source") sourcePower -= power;
    else dissipatedPower += power;
  }
  const nodes: Record<string, number> = {},
    nodeIds: Record<string, string> = {},
    nodeIslands: Record<string, string> = {};
  for (const k of uf.p.keys()) {
    nodes[k] = voltages[uf.find(k)] ?? 0;
    nodeIds[k] = uf.find(k);
    nodeIslands[k] = islands.find(uf.find(k));
  }
  return {
    readings,
    nodes,
    nodeIds,
    nodeIslands,
    references,
    sourcePower,
    dissipatedPower,
    residual,
    powerResidual: sourcePower - dissipatedPower,
    islands: groups.size,
  };
}
export function nodeVoltage(
  result: ElectricalResult,
  terminal: string,
  reference?: string,
): number | null {
  if (!(terminal in result.nodes)) return null;
  if (!reference) {
    return result.nodes[terminal];
  }
  if (
    !(reference in result.nodes) ||
    result.nodeIslands?.[terminal] !== result.nodeIslands?.[reference]
  )
    return null;
  return result.nodes[terminal] - result.nodes[reference];
}
