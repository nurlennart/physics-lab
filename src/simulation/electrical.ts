import { definitions, isSource, prop, terminalKey, type Component, type Project } from "./model";
import { actualResistance } from "./parameters";
import { machineParams, currents, midpointThevenin, midpointState, airGapTorque, type MachineParams } from "./induction";
type Cx = [number, number];
const cadd = (a: Cx, b: Cx): Cx => [a[0] + b[0], a[1] + b[1]];
const csub = (a: Cx, b: Cx): Cx => [a[0] - b[0], a[1] - b[1]];
const cmul = (a: Cx, b: Cx): Cx => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const cdiv = (a: Cx, b: Cx): Cx => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
const cabs = (a: Cx) => Math.hypot(a[0], a[1]);
const conj = (a: Cx): Cx => [a[0], -a[1]];
/** Complex Gaussian elimination with partial pivoting. */
export function solveComplex(a: Cx[][], b: Cx[]): Cx[] {
  const n = b.length, m = a.map((row, i) => [...row.map((v) => [...v] as Cx), [...b[i]] as Cx]);
  for (let k = 0; k < n; k++) {
    let pivot = k;
    for (let i = k + 1; i < n; i++) if (cabs(m[i][k]) > cabs(m[pivot][k])) pivot = i;
    if (cabs(m[pivot][k]) < 1e-14) throw Error("Singular AC circuit: conflicting sources or a floating node.");
    [m[k], m[pivot]] = [m[pivot], m[k]];
    for (let i = k + 1; i < n; i++) {
      const f = cdiv(m[i][k], m[k][k]);
      for (let j = k; j <= n; j++) m[i][j] = csub(m[i][j], cmul(f, m[k][j]));
    }
  }
  const x: Cx[] = Array.from({ length: n }, () => [0, 0]);
  for (let i = n - 1; i >= 0; i--) {
    let sum = m[i][n];
    for (let j = i + 1; j < n; j++) sum = csub(sum, cmul(m[i][j], x[j]));
    x[i] = cdiv(sum, m[i][i]);
  }
  if (x.some((v) => !v.every(Number.isFinite))) throw Error("AC circuit solver produced a non-finite result.");
  return x;
}
/** Induction machine per-phase equivalent circuit at slip s (rad/s quantities, reactances at supply frequency). */
export function inductionCircuit(c: Component, frequency: number, omega: number) {
  const scale = frequency / prop(c, "ratedFrequency", 50), syncSpeed = 2 * Math.PI * frequency / (prop(c, "poles", 4) / 2);
  const slip = syncSpeed > 0 ? (syncSpeed - omega) / syncSpeed : 1;
  const z1: Cx = [prop(c, "statorResistance"), prop(c, "statorReactance") * scale], xm: Cx = [0, prop(c, "magnetizingReactance") * scale];
  const z2: Cx | null = Math.abs(slip) > 1e-9 ? [prop(c, "rotorResistance") / slip, prop(c, "rotorReactance") * scale] : null;
  const branch = z2 ? cdiv(cmul(xm, z2), cadd(xm, z2)) : xm;
  return { impedance: cadd(z1, branch), z2, xm, slip, syncSpeed };
}
export interface ElectricalReading {
  voltage: number;
  current: number;
  power: number;
  currentNC?: number;
  contactCurrent?: number;
  voltageValid?: boolean;
  /** Source regulation state: constant voltage or constant current. */
  regulation?: "cv" | "cc";
  /** Actual resistance used by the solver (temperature and tolerance applied). */
  resistance?: number;
  /** 3 in a balanced three-phase island: voltage is phase-to-neutral, current is line current, power is the 3-phase total. */
  phases?: 1 | 3;
  /** AC islands: RMS magnitudes; power is active power P, plus reactive power Q (var) and power factor. */
  ac?: boolean;
  reactivePower?: number;
  powerFactor?: number | null;
  frequency?: number;
  /** Induction machines: air-gap torque (N·m), copper losses (W) and slip; dynamic model: midpoint flux linkages. */
  machine?: { torque: number; statorCopper: number; rotorCopper: number; slip: number; psiS?: [number, number]; psiR?: [number, number]; lineRatio?: number };
  /** AC: complex RMS current phasor of the conducting path (A), referred to the supply angle ωt. */
  currentPhasor?: [number, number];
  /** AC, coupled steps: largest instantaneous line current |i(t)| over the step (A), across all substeps. */
  peakCurrent?: number;
  /** AC islands fed by a drive: the drive's id (its output angle is the phasor reference). */
  supply?: string;
  /** Motor starters: contactor state and the soft starter's controlled series reactance (Ω, per phase). */
  starter?: { mode: StarterMode; reactance: number; ratio?: number };
  /** Drives: input/output power (W, three-phase), losses and braking-resistor power, output quantities. */
  drive?: DriveReading;
}
export type StarterMode = "off" | "star" | "open" | "delta" | "ramp" | "bypass";
export interface DriveReading {
  energized: boolean;
  running: boolean;
  inputPower: number;
  outputPower: number;
  losses: number;
  braking: number;
  frequency: number;
  /** Output line-to-line voltage (V RMS). */
  outputVoltage: number;
  /** Output line current (A RMS) and its phasor in the drive's own reference frame. */
  outputCurrent: number;
  outputCurrentPhasor: [number, number];
}
export const isStarter = (c: Component) => c.kind === "starDeltaStarter" || c.kind === "softStarter";
/** Drive losses (W): standby P₀ plus P_r·(0.5·i + 0.5·i²), i = I_out/In (switching ∝ I, conduction ∝ I²). */
export function driveLosses(c: Component, outputCurrent: number) {
  const i = outputCurrent / prop(c, "ratedOutputCurrent"), rated = prop(c, "ratedLoss") / 100 * prop(c, "ratedPower");
  return prop(c, "standbyLoss") + rated * (0.5 * i + 0.5 * i * i);
}
/**
 * Largest instantaneous line current over the supply-angle interval [θ0, θ1] for a phasor I held over
 * the interval: i_k(θ) = √2·Re(I·e^{j(θ − 2πk/3)}), k over the phases. Exact for a constant phasor:
 * max_k |i_k| peaks every π/3 (three-phase) or π (single-phase), otherwise at an interval end.
 */
export function peakOverInterval(I: [number, number], phases: number, theta0: number, theta1: number) {
  const amplitude = Math.SQRT2 * Math.hypot(I[0], I[1]), phi = Math.atan2(I[1], I[0]), spacing = Math.PI / phases;
  if (Math.floor((theta1 + phi) / spacing) > Math.floor((theta0 + phi) / spacing) || theta1 - theta0 >= spacing) return amplitude;
  const at = (x: number) => Math.max(...Array.from({ length: phases }, (_, k) => Math.abs(Math.cos(x - (2 * Math.PI * k) / 3))));
  return amplitude * Math.max(at(theta0 + phi), at(theta1 + phi));
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
  /** AC islands: complex node voltages (RMS phasors) for differential probes. */
  phasors?: Record<string, [number, number]>;
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
  motors?: Record<string, { emf: number; duty: number; enabled: boolean }>;
  /** Induction machines: mechanical speed (rad/s) and contactor state. */
  /**
   * Induction machines. With `psiS`/`psiR` (flux linkages at the start of the step) the dynamic model
   * is used: a midpoint Thevenin equivalent over the step `h`, or for h = 0 (paused re-solve) a current
   * source carrying the present winding current. Without them the steady equivalent circuit is used.
   */
  inductionMotors?: Record<string, { omega: number; enabled: boolean; psiS?: [number, number]; psiR?: [number, number]; h?: number }>;
  /** Protective devices currently tripped open (breakers, motor protectors). */
  open?: Set<string>;
  /** Motor starters: contactor state; soft starter: target fundamental voltage ratio (0–1) while ramping. */
  starters?: Record<string, { mode: StarterMode; ratio?: number }>;
  /** Drives: running output frequency (Hz) and output phase (star-equivalent) voltage (V RMS). */
  drives?: Record<string, { running: boolean; frequency: number; voltage: number }>;
  /** Element temperatures (°C) for temperature-dependent resistance. */
  temperatures?: Record<string, number>;
}
export const sourceMode = (c: Component) => (typeof c.props.mode === "string" ? c.props.mode : "ideal") as "ideal" | "internal" | "cvcc" | "cc";
/** Current limit of a regulating source, or Infinity for ideal / internal-resistance sources. */
export const sourceLimit = (c: Component) => sourceMode(c) === "cc" ? prop(c, "current") : sourceMode(c) === "cvcc" ? prop(c, "maxCurrent") : Infinity;
/** Wire connectivity depends only on the immutable project and disconnected wires; it is cached. */
type ElectricalTopology = { cs: Component[]; grounds: Component[]; root: Map<string, string> };
const electricalCache = new WeakMap<Project, Map<string, ElectricalTopology>>();
function electricalTopology(project: Project, disconnected: Set<string>): ElectricalTopology {
  const key = [...disconnected].sort().join(","), byProject = electricalCache.get(project) ?? new Map<string, ElectricalTopology>();
  electricalCache.set(project, byProject);
  const cached = byProject.get(key);
  if (cached) return cached;
  const uf = new Union();
  const cs = project.components.filter((c) => definitions[c.kind].ports.some((p) => p.domain === "electrical"));
  for (const c of cs) for (const p of definitions[c.kind].ports.filter((p) => p.domain === "electrical")) uf.find(`${c.id}:${p.id}`);
  for (const w of project.connections.filter((w) => w.domain === "electrical" && !disconnected.has(w.id))) uf.join(terminalKey(w.from), terminalKey(w.to));
  const grounds = cs.filter((c) => c.kind === "ground");
  for (const g of grounds.slice(1)) uf.join(`${g.id}:a`, `${grounds[0].id}:a`);
  const root = new Map([...uf.p.keys()].map((k) => [k, uf.find(k)]));
  const topology = { cs, grounds, root };
  byProject.set(key, topology);
  return topology;
}
export function solveElectrical(
  project: Project,
  failed: Record<string, boolean> = {},
  runtime: ElectricalRuntime = {},
): ElectricalResult {
  const topology = electricalTopology(project, runtime.disconnected ?? new Set());
  const { cs, grounds, root } = topology;
  const uf = { p: root, find: (k: string) => root.get(k) ?? k };
  const node = (id: string, p: string) => root.get(`${id}:${p}`)!;
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
      !(isSource(c) && c.props.enabled === false) &&
      !((c.kind === "breaker" || c.kind === "motorProtector") && (c.props.closed === false || runtime.open?.has(c.id))) &&
      !(c.kind === "motor" && runtime.motors?.[c.id]?.enabled === false) &&
      !(c.kind === "inductionMotor" && runtime.inductionMotors?.[c.id]?.enabled === false) &&
      !(isStarter(c) && !["star", "delta", "ramp", "bypass"].includes(runtime.starters?.[c.id]?.mode ?? "off")) &&
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
  // A drive couples its input and output networks only through its DC link (power, not node voltages).
  for (const c of active.filter((c) => c.kind === "vfd")) islands.join(node(c.id, "oa"), node(c.id, "ob"));
  const groups = new Map<string, string[]>();
  for (const n of new Set([...uf.p.keys()].map((k) => uf.find(k)))) {
    const key = islands.find(n);
    groups.set(key, [...(groups.get(key) ?? []), n]);
  }
  const voltages: Record<string, number> = {},
    sourceI: Record<string, number> = {},
    regulation: Record<string, "cv" | "cc"> = {},
    islandPhases = new Map<string, 3>(),
    references: Record<string, string> = {};
  const resistances: Record<string, number> = {};
  const resistanceOf = (c: Component, ac = false) => {
    if (resistances[c.id] !== undefined) return resistances[c.id];
    // DC capacitor insulation leakage is distinct from the AC series ESR. Use the
    // same resistance for stamping, readings and thermal power accounting.
    const r = c.kind === "capacitor" && !ac ? 1e9 : c.kind === "motor" ? prop(c, "resistance", 1) : actualResistance(c, runtime.temperatures?.[c.id] ?? 20);
    if (!Number.isFinite(r) || r <= 0)
      throw Error(`${c.name}: resistance must be positive (temperature-dependent model gives ${r.toPrecision(3)} Ω at ${(runtime.temperatures?.[c.id] ?? 20).toFixed(1)} °C).`);
    return (resistances[c.id] = r);
  };
  let residual = 0;
  const acIslands = new Set<string>(), phasors: Record<string, Cx> = {}, acReadings: Record<string, ElectricalReading> = {};
  const driveOutputs: Record<string, { voltage: Cx; current: Cx; power: number }> = {};
  // Each active starter feeds exactly one induction motor wired directly to its motor terminal.
  const starterOf = new Map<string, Component>(), motorOf = new Map<string, Component>();
  for (const st of active.filter(isStarter)) {
    const fed = active.filter((m) => m.kind === "inductionMotor" && node(m.id, "a") === node(st.id, "b"));
    if (fed.length !== 1) throw Error(`${st.name}: wire its motor terminal directly to terminal a of exactly one induction motor.`);
    if (starterOf.has(fed[0].id)) throw Error(`${fed[0].name}: only one starter can feed a motor.`);
    starterOf.set(fed[0].id, st);
    motorOf.set(st.id, fed[0]);
  }
  /** Star connection of a delta-wound motor: each winding sees V/√3 (per-phase ideal ratio a = 1/√3). */
  const lineRatio = (m: Component) => {
    const st = starterOf.get(m.id);
    return st?.kind === "starDeltaStarter" && runtime.starters?.[st.id]?.mode === "star" ? 1 / Math.sqrt(3) : 1;
  };
  /**
   * Soft starter while ramping: the thyristors' effect on the fundamental is a lossless series reactance
   * X ≥ 0, chosen from the motor's steady impedance Z = R + jXm at its present speed so that the motor
   * voltage is ratio × line voltage (|Z|/|Z + jX| = k), and at least large enough to hold the line current
   * at the current limit (|V|/|Z + jX| ≤ I_lim). Bypassed (X = 0) once full voltage is within the limit.
   */
  const starterReactance = (st: Component, frequency: number, phaseVoltage: number) => {
    const state = runtime.starters?.[st.id];
    if (st.kind !== "softStarter" || state?.mode !== "ramp") return 0;
    const m = motorOf.get(st.id)!, z = inductionCircuit(m, frequency, runtime.inductionMotors?.[m.id]?.omega ?? 0).impedance;
    const k = Math.max(1e-3, Math.min(1, state.ratio ?? 1)), limit = prop(st, "currentLimit") * prop(st, "ratedCurrent");
    const forRatio = Math.sqrt(Math.max(0, (z[0] ** 2 + z[1] ** 2) / (k * k) - z[0] ** 2)) - z[1];
    const forLimit = Math.sqrt(Math.max(0, (phaseVoltage / limit) ** 2 - z[0] ** 2)) - z[1];
    return Math.max(0, forRatio, forLimit);
  };
  /** Complex MNA for an AC island (single-phase phasors, or the balanced per-phase model of a three-phase supply). */
  const solveACIsland = (island: string, ns: string[], members: Component[], sources: Component[], drive?: Component, driveLoads?: Map<string, number>) => {
    if (sources.some((c) => c.kind === "source")) throw Error("A DC supply and an AC supply cannot share one network.");
    const three = !!drive || sources.some((c) => c.kind === "source3");
    if (three && sources.some((c) => c.kind === "sourceAC")) throw Error("A balanced three-phase supply and single-phase AC sources cannot share one network; build an explicit three-phase system from three AC sources instead.");
    const frequency = drive ? runtime.drives![drive.id].frequency : prop(sources[0], "frequency", 50);
    if (drive && members.some((c) => c.kind === "capacitor")) throw Error(`${drive.name}: no capacitors on a drive output (the PWM voltage would overload them); compensate on the supply side.`);
    if (drive && members.some(isStarter)) throw Error(`${drive.name}: a drive output needs no starter; connect the motor directly.`);
    const vfd = members.find((c) => c.kind === "vfd");
    if (vfd && !three) throw Error(`${vfd.name}: a drive needs a balanced three-phase supply.`);
    const nominal = drive ? runtime.drives![drive.id].voltage : sources[0].kind === "source3" ? prop(sources[0], "lineVoltage") / Math.sqrt(3) : prop(sources[0], "voltage");
    if (sources.some((c) => Math.abs(prop(c, "frequency", 50) - frequency) > 1e-9)) throw Error("AC sources with different frequencies cannot share one network.");
    const dcMotor = members.find((c) => c.kind === "motor");
    if (dcMotor) throw Error(`${dcMotor.name}: a DC motor cannot run on an AC network.`);
    const machine = members.find((c) => c.kind === "inductionMotor");
    if (machine && !three) throw Error(`${machine.name}: a three-phase induction motor needs a three-phase supply (single-phase machines are not modelled).`);
    const phases = three ? 3 : 1, w = 2 * Math.PI * frequency;
    acIslands.add(island);
    if (three) islandPhases.set(island, 3);
    const g = grounds.find((c) => ns.includes(node(c.id, "a"))), ref = g ? node(g.id, "a") : drive ? node(drive.id, "ob") : node(sources[0].id, "b");
    references[island] = ref;
    const unknown = ns.filter((n) => n !== ref), size = unknown.length + sources.length + (drive ? 1 : 0);
    if (size > 250) throw Error("Circuit matrix exceeds 250 unknowns. Reduce the scene.");
    const indices = new Map(unknown.map((n, i) => [n, i]));
    const A: Cx[][] = Array.from({ length: size }, () => Array.from({ length: size }, () => [0, 0] as Cx)), B: Cx[] = Array.from({ length: size }, () => [0, 0] as Cx);
    const add = (i: number | undefined, j: number | undefined, v: Cx) => { if (i !== undefined && j !== undefined) A[i][j] = cadd(A[i][j], v); };
    const impedance = new Map<string, Cx>(), circuits = new Map<string, ReturnType<typeof inductionCircuit>>();
    const dynamic = new Map<string, { m: MachineParams; state: NonNullable<ElectricalRuntime["inductionMotors"]>[string]; e?: Cx }>();
    const inject = (p: number | undefined, q: number | undefined, j: Cx) => { if (p !== undefined) B[p] = cadd(B[p], j); if (q !== undefined) B[q] = csub(B[q], j); };
    const reactances = new Map<string, number>();
    /**
     * A machine whose terminals are not closed through the rest of the network (open starter, open switch
     * upstream) carries no stator current: it is an open stator (flux decay in the machine model), not a
     * Thevenin element, which would leave its node floating or ring at the current interruption.
     */
    const closedLoop = (m: Component) => {
      const u = new Union();
      for (const c of members) if (c !== m) u.join(node(c.id, "a"), node(c.id, end(c)));
      if (drive) u.join(node(drive.id, "oa"), node(drive.id, "ob"));
      return u.find(node(m.id, "a")) === u.find(node(m.id, "b"));
    };
    for (const c of members.filter((c) => !isSource(c))) {
      let z: Cx;
      if (c.kind === "inductionMotor") {
        const state = runtime.inductionMotors?.[c.id];
        if (state && !state.enabled) continue;
        if (!closedLoop(c)) continue;
        // Star connection: v_line = v_winding/a, i_line = a·i_winding, so the terminals see Z/a² and E/a.
        const a = lineRatio(c);
        if (state?.psiS && state.psiR) {
          const m = machineParams(c, frequency), p = indices.get(node(c.id, "a")), q = indices.get(node(c.id, "b"));
          if (!state.h) {
            // Paused re-solve: the windings keep their present current (inductive continuity).
            const { is } = currents(m, state.psiS, state.psiR);
            inject(p, q, [-a * is[0], -a * is[1]]);
            dynamic.set(c.id, { m, state });
            continue;
          }
          const th = midpointThevenin(m, state.psiS, state.psiR, state.h, state.omega), zt: Cx = [th.z[0] / (a * a), th.z[1] / (a * a)], et: Cx = [th.e[0] / a, th.e[1] / a];
          impedance.set(c.id, zt);
          dynamic.set(c.id, { m, state, e: et });
          const y = cdiv([1, 0], zt);
          add(p, p, y); add(q, q, y); add(p, q, [-y[0], -y[1]]); add(q, p, [-y[0], -y[1]]);
          inject(p, q, cmul(y, et));
          continue;
        }
        const circuit = inductionCircuit(c, frequency, state?.omega ?? 0);
        circuits.set(c.id, circuit);
        z = [circuit.impedance[0] / (a * a), circuit.impedance[1] / (a * a)];
      } else if (c.kind === "vfd") {
        // Drive input: diode rectifier drawing its converged power demand in phase with the voltage.
        const conductance = driveLoads?.get(c.id) ?? 0;
        if (!(conductance > 0)) continue;
        z = [1 / conductance, 0];
      } else if (isStarter(c)) {
        const x = starterReactance(c, frequency, nominal);
        reactances.set(c.id, x);
        z = [resistanceOf(c), x];
      } else if (c.kind === "inductor") z = [resistanceOf(c), w * prop(c, "inductance")];
      else if (c.kind === "capacitor") z = [resistanceOf(c, true), -1 / (w * prop(c, "capacitance"))];
      else z = [resistanceOf(c), 0];
      impedance.set(c.id, z);
      const y = cdiv([1, 0], z), p = indices.get(node(c.id, "a")), q = indices.get(node(c.id, end(c)));
      add(p, p, y); add(q, q, y); add(p, q, [-y[0], -y[1]]); add(q, p, [-y[0], -y[1]]);
    }
    sources.forEach((src, i) => {
      const k = unknown.length + i, p = indices.get(node(src.id, "a")), q = indices.get(node(src.id, "b"));
      if (p !== undefined) { A[p][k] = cadd(A[p][k], [1, 0]); A[k][p] = cadd(A[k][p], [1, 0]); }
      if (q !== undefined) { A[q][k] = cadd(A[q][k], [-1, 0]); A[k][q] = cadd(A[k][q], [-1, 0]); }
      A[k][k] = cadd(A[k][k], [-prop(src, "internalResistance"), -prop(src, "internalReactance")]);
      const magnitude = src.kind === "source3" ? prop(src, "lineVoltage") / Math.sqrt(3) : prop(src, "voltage"), angle = prop(src, "phase") * Math.PI / 180;
      B[k] = [magnitude * Math.cos(angle), magnitude * Math.sin(angle)];
    });
    if (drive) {
      // Inverter output: stiff voltage source (current-controlled modulation) at the drive's frequency and V/f voltage.
      const k = unknown.length + sources.length, p = indices.get(node(drive.id, "oa")), q = indices.get(node(drive.id, "ob"));
      if (p !== undefined) { A[p][k] = cadd(A[p][k], [1, 0]); A[k][p] = cadd(A[k][p], [1, 0]); }
      if (q !== undefined) { A[q][k] = cadd(A[q][k], [-1, 0]); A[k][q] = cadd(A[k][q], [-1, 0]); }
      B[k] = [nominal, 0];
    }
    // Nodes touched only by open-stator machines carry no current: pin them (open terminal, reads 0 V).
    for (let i = 0; i < unknown.length; i++) if (A[i].every((v) => v[0] === 0 && v[1] === 0) && B[i][0] === 0 && B[i][1] === 0) A[i][i] = [1, 0];
    const x = size ? solveComplex(A, B) : [];
    for (let i = 0; i < size; i++) {
      const lhs = A[i].reduce<Cx>((sum, v, j) => cadd(sum, cmul(v, x[j])), [0, 0]);
      residual = Math.max(residual, cabs(csub(lhs, B[i])));
    }
    const V = (n: string): Cx => (n === ref ? [0, 0] : x[indices.get(n)!] ?? [0, 0]);
    for (const n of ns) phasors[n] = V(n);
    const record = (c: Component, voltage: Cx, current: Cx, extra: Partial<ElectricalReading> = {}) => {
      const S = cmul(voltage, conj(current)), P = phases * S[0], Q = phases * S[1], apparent = Math.hypot(P, Q);
      acReadings[c.id] = {
        voltage: cabs(voltage), current: cabs(current), contactCurrent: cabs(current), currentNC: 0, power: P, voltageValid: true,
        ac: true, currentPhasor: current, reactivePower: Q, powerFactor: apparent > 1e-12 ? Math.abs(P) / apparent : null, frequency, ...(phases === 3 ? { phases: 3 as const } : {}), ...(drive ? { supply: drive.id } : {}), ...extra,
      };
    };
    if (drive) {
      const k = unknown.length + sources.length, voltage = csub(V(node(drive.id, "oa")), V(node(drive.id, "ob")));
      const delivered: Cx = [-x[k][0], -x[k][1]];
      driveOutputs[drive.id] = { voltage, current: delivered, power: phases * cmul(voltage, conj(delivered))[0] };
    }
    sources.forEach((src, i) => {
      const current = x[unknown.length + i], voltage = csub(V(node(src.id, "a")), V(node(src.id, "b")));
      record(src, voltage, current, { regulation: "cv" });
      // Delivered power is negative in the source's own reading (current into terminal a).
      acReadings[src.id].current = acReadings[src.id].power < 0 ? -acReadings[src.id].current : acReadings[src.id].current;
    });
    for (const c of members.filter((c) => !isSource(c))) {
      const z = impedance.get(c.id);
      const across = csub(V(node(c.id, "a")), V(node(c.id, end(c)))), terminal = csub(V(node(c.id, "a")), V(node(c.id, "b")));
      const dyn = dynamic.get(c.id);
      let current = z ? cdiv(dyn?.e ? csub(across, dyn.e) : across, z) : ([0, 0] as Cx);
      const circuit = circuits.get(c.id);
      let machine: ElectricalReading["machine"] | undefined;
      // Star-connected motor: winding quantities are v = a·v_line, i = i_line/a; readings show line current.
      const a = c.kind === "inductionMotor" ? lineRatio(c) : 1;
      if (dyn) {
        const { m, state } = dyn, slip = (m.ws - m.pairs * state.omega) / m.ws;
        const mid = state.h ? midpointState(m, state.psiS!, state.psiR!, state.h, state.omega, [a * terminal[0], a * terminal[1]]) : { ...currents(m, state.psiS!, state.psiR!), psiS: state.psiS!, psiR: state.psiR! };
        current = [a * mid.is[0], a * mid.is[1]];
        machine = { torque: airGapTorque(m, mid.psiS, mid.is), statorCopper: phases * m.Rs * (mid.is[0] ** 2 + mid.is[1] ** 2), rotorCopper: phases * m.Rr * (mid.ir[0] ** 2 + mid.ir[1] ** 2), slip, psiS: mid.psiS, psiR: mid.psiR, ...(a !== 1 ? { lineRatio: a } : {}) };
      } else if (circuit) {
        const winding: Cx = [current[0] / a, current[1] / a];
        const rotor: Cx = circuit.z2 ? cdiv(cmul(winding, circuit.xm), cadd(circuit.xm, circuit.z2)) : [0, 0];
        const r2 = prop(c, "rotorResistance"), rotorSq = rotor[0] ** 2 + rotor[1] ** 2;
        const airGap = circuit.z2 ? phases * rotorSq * r2 / circuit.slip : 0;
        machine = { torque: circuit.syncSpeed > 0 ? airGap / circuit.syncSpeed : 0, statorCopper: phases * cabs(winding) ** 2 * prop(c, "statorResistance"), rotorCopper: phases * rotorSq * r2, slip: circuit.slip, ...(a !== 1 ? { lineRatio: a } : {}) };
      }
      const starter = isStarter(c) ? { starter: { mode: runtime.starters?.[c.id]?.mode ?? "off", reactance: reactances.get(c.id) ?? 0, ratio: runtime.starters?.[c.id]?.ratio } } : {};
      // Power belongs to the conducting contact (a–nc for a de-energized relay).
      // The voltage measurement retains the public a–b terminal convention (a star-connected motor: winding voltage).
      record(c, across, current, { voltage: a * cabs(terminal), voltageValid: islands.find(node(c.id, "a")) === islands.find(node(c.id, "b")), ...(machine ? { machine } : {}), ...starter, ...(resistances[c.id] !== undefined ? { resistance: resistances[c.id] } : {}) });
      if (c.kind === "relay" && end(c) === "nc") { acReadings[c.id].currentNC = acReadings[c.id].current; acReadings[c.id].current = 0; }
    }
  };
  const driveAt = (ns: string[]) => active.filter((c) => c.kind === "vfd" && ns.includes(node(c.id, "oa")));
  const energized = (d: Component) => active.some((c) => c.kind === "source3" && islands.find(node(c.id, "a")) === islands.find(node(d.id, "a")));
  /** Rectifier demand (W, three-phase): output power plus losses; regenerated surplus goes to the braking resistor. */
  const driveDemand = (d: Component) => {
    const out = driveOutputs[d.id], output = out?.power ?? 0, losses = driveLosses(d, out ? cabs(out.current) : 0), net = output + losses;
    return { input: Math.max(0, net), output, losses, braking: Math.max(0, -net) };
  };
  // Drive output networks first: their power is the demand of the drives' supply networks.
  const ordered = [...groups].sort(([, x], [, y]) => driveAt(y).length - driveAt(x).length);
  for (const [island, ns] of ordered) {
    const members = active.filter((c) => ns.includes(node(c.id, "a"))),
      sources = members.filter(isSource);
    const fed = driveAt(ns);
    if (fed.length > 1) throw Error(`${fed[1].name}: two drive outputs cannot share one network.`);
    if (fed.length) {
      const d = fed[0], state = runtime.drives?.[d.id];
      if (sources.length) throw Error(`${d.name}: its output is connected to a supply.`);
      if (state?.running && state.frequency > 0 && energized(d)) {
        solveACIsland(island, ns, members, [], d);
        continue;
      }
    }
    if (sources.some((c) => c.kind === "source3" || c.kind === "sourceAC")) {
      const drives = members.filter((c) => c.kind === "vfd");
      if (!drives.length) {
        solveACIsland(island, ns, members, sources);
        continue;
      }
      // Rectifier inputs are constant-power loads: G = P/(3|V|²), iterated until |V| at each drive is consistent.
      const demand = new Map(drives.map((d) => [d.id, driveDemand(d)])), loads = new Map<string, number>();
      const nominal = sources[0].kind === "source3" ? prop(sources[0], "lineVoltage") / Math.sqrt(3) : prop(sources[0], "voltage");
      const squared = new Map(drives.map((d) => [d.id, nominal ** 2]));
      for (let iteration = 0; ; iteration++) {
        for (const d of drives) loads.set(d.id, demand.get(d.id)!.input / (3 * Math.max(squared.get(d.id)!, 1e-12)));
        solveACIsland(island, ns, members, sources, undefined, loads);
        let change = 0;
        for (const d of drives) {
          const v = csub(phasors[node(d.id, "a")] ?? [0, 0], phasors[node(d.id, "b")] ?? [0, 0]), sq = v[0] ** 2 + v[1] ** 2;
          change = Math.max(change, Math.abs(sq - squared.get(d.id)!) / Math.max(sq, 1e-12));
          squared.set(d.id, sq);
        }
        if (change < 1e-13) break;
        if (iteration > 50) throw Error(`${drives[0].name}: input power did not converge; the supply is too weak for the drive load.`);
      }
      for (const d of drives) {
        const dm = demand.get(d.id)!, out = driveOutputs[d.id];
        acReadings[d.id] = {
          ...acReadings[d.id], power: dm.input - dm.output,
          drive: { energized: true, running: !!out, inputPower: dm.input, outputPower: dm.output, losses: dm.losses, braking: dm.braking, frequency: out ? runtime.drives![d.id].frequency : 0, outputVoltage: out ? cabs(out.voltage) * Math.sqrt(3) : 0, outputCurrent: out ? cabs(out.current) : 0, outputCurrentPhasor: out?.current ?? [0, 0] },
        };
      }
      continue;
    }
    const converter = members.find((c) => c.kind === "vfd" || isStarter(c));
    if (converter && sources.length) throw Error(`${converter.name}: needs a balanced three-phase AC supply, not a DC network.`);
    const machine = members.find((c) => c.kind === "inductionMotor");
    if (machine) {
      if (sources.length || members.some(c => c.kind === "motor")) throw Error(`${machine.name}: an induction motor needs a three-phase AC supply, not a DC network.`);
      // An isolated induction machine has no excitation in this steady phasor
      // model. Power loss is normal shutdown; residual-flux transients are omitted.
      const g = grounds.find(c => ns.includes(node(c.id, "a")));
      references[island] = g ? node(g.id, "a") : ns[0];
      for (const n of ns) voltages[n] = 0;
      continue;
    }
    const shorted = (s: Component) => node(s.id, "a") === node(s.id, "b");
    for (const s of sources)
      if (shorted(s) && sourceLimit(s) === Infinity && prop(s, "internalResistance") <= 0)
        throw Error(
          `${s.name}: supply terminals are shorted. Remove the short circuit, add internal resistance, or use a current-limited supply.`,
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
    for (const c of members.filter((c) => !isSource(c) && c.kind !== "vfd")) {
      // Steady DC: a capacitor is open apart from its insulation leakage (1 GΩ); an inductor is its winding resistance.
      const resistance = resistanceOf(c);
      const motor = c.kind === "motor" ? runtime.motors?.[c.id] : undefined;
      const duty = motor?.duty ?? 1;
      const conductance = (c.kind === "motor" ? duty * duty : 1) / resistance,
        p = node(c.id, "a"),
        q = node(c.id, end(c));
      stamp(p, p, conductance);
      stamp(q, q, conductance);
      stamp(p, q, -conductance);
      stamp(q, p, -conductance);
      if (motor) {
        const norton = duty * motor.emf / resistance;
        const pi = indices.get(p), qi = indices.get(q);
        if (pi !== undefined) b[pi] += norton;
        if (qi !== undefined) b[qi] -= norton;
      }
    }
    // Branch variable k is the current *into* terminal a (negative while delivering).
    // CV row: Va − Vb − Rᵢ·I = Vset. CC row: I = −limit·direction.
    // CV/CC crossover is an active-set iteration, as in a regulated laboratory supply.
    const fixed: (number | null)[] = sources.map((s) => shorted(s) && sourceLimit(s) < Infinity ? -sourceLimit(s) : null);
    let x: number[] = [], am: number[][] = a, bm: number[] = b;
    for (let iteration = 0; ; iteration++) {
      am = a.map((row) => [...row]);
      bm = [...b];
      sources.forEach((s, i) => {
        const k = unknown.length + i,
          p = indices.get(node(s.id, "a")),
          q = indices.get(node(s.id, "b"));
        if (p !== undefined) am[p][k] += 1;
        if (q !== undefined) am[q][k] -= 1;
        if (fixed[i] !== null) {
          am[k][k] = 1;
          bm[k] = fixed[i]!;
          return;
        }
        if (p !== undefined) am[k][p] += 1;
        if (q !== undefined) am[k][q] -= 1;
        am[k][k] -= prop(s, "internalResistance");
        // Three-phase: the per-phase (star-equivalent) EMF is V_LL/√3.
        bm[k] = s.kind === "source3" ? prop(s, "lineVoltage") / Math.sqrt(3) : prop(s, "voltage");
      });
      // Nodes no element stamps (an unpowered drive input, an open machine terminal) are pinned to 0 V.
      for (let i = 0; i < unknown.length; i++) if (am[i].every((v) => v === 0) && bm[i] === 0) am[i][i] = 1;
      x = size ? solveLinear(am, bm) : [];
      if (iteration >= 12) break;
      let changed = false;
      sources.forEach((s, i) => {
        const limit = sourceLimit(s), current = x[unknown.length + i];
        if (limit === Infinity) return;
        if (fixed[i] === null && Math.abs(current) > limit * (1 + 1e-12)) {
          fixed[i] = Math.sign(current || -1) * limit;
          changed = true;
        } else if (fixed[i] !== null) {
          const va = indices.has(node(s.id, "a")) ? x[indices.get(node(s.id, "a"))!] : 0,
            vb = indices.has(node(s.id, "b")) ? x[indices.get(node(s.id, "b"))!] : 0;
          const emf = va - vb - prop(s, "internalResistance") * current;
          if (Math.abs(emf) > prop(s, "voltage") * (1 + 1e-12) + 1e-12) {
            fixed[i] = null;
            changed = true;
          }
        }
      });
      if (!changed) break;
    }
    sources.forEach((s, i) => (regulation[s.id] = fixed[i] === null ? "cv" : "cc"));
    for (let i = 0; i < size; i++)
      residual = Math.max(residual, Math.abs(am[i].reduce((sum, v, j) => sum + v * x[j], 0) - bm[i]));
    voltages[ref] = 0;
    unknown.forEach((n, i) => (voltages[n] = x[i]));
    sources.forEach((c, i) => (sourceI[c.id] = x[unknown.length + i]));
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
    if (acIslands.has(islands.find(a))) {
      const reading = acReadings[c.id] ?? { voltage: cabs(csub(phasors[a] ?? [0, 0], phasors[b] ?? [0, 0])), current: 0, currentNC: 0, contactCurrent: 0, power: 0, voltageValid: islands.find(a) === islands.find(b), ac: true };
      readings[c.id] = reading;
      if (isSource(c)) sourcePower -= reading.power;
      else dissipatedPower += reading.power;
      continue;
    }
    const valid = islands.find(a) === islands.find(b);
    const voltage = (voltages[a] ?? 0) - (voltages[b] ?? 0);
    const activeVoltage = (voltages[a] ?? 0) - (voltages[q] ?? 0);
    const phases = islandPhases.get(islands.find(a)) ?? 1;
    const contactCurrent =
      isSource(c)
        ? (sourceI[c.id] ?? 0)
        : active.includes(c) && c.kind !== "inductionMotor" && c.kind !== "vfd"
          ? c.kind === "motor" && runtime.motors?.[c.id]
            ? runtime.motors[c.id].duty * (runtime.motors[c.id].duty * activeVoltage - runtime.motors[c.id].emf) / prop(c, "resistance", 1)
            : activeVoltage / resistanceOf(c)
          : 0;
    const current = c.kind === "relay" && end(c) === "nc" ? 0 : contactCurrent;
    const currentNC =
      c.kind === "relay" && end(c) === "nc" ? contactCurrent : 0;
    const power =
      phases *
      (isSource(c)
        ? voltage * contactCurrent
        : activeVoltage * contactCurrent);
    readings[c.id] = {
      voltage,
      current,
      currentNC,
      contactCurrent,
      power,
      voltageValid: valid,
      ...(isSource(c) ? { regulation: regulation[c.id] ?? "cv" } : resistances[c.id] !== undefined ? { resistance: resistances[c.id] } : {}),
      ...(phases === 3 ? { phases: 3 as const } : {}),
    };
    if (isSource(c)) sourcePower -= power;
    else dissipatedPower += power;
  }
  const nodes: Record<string, number> = {},
    nodeIds: Record<string, string> = {},
    nodeIslands: Record<string, string> = {};
  for (const k of uf.p.keys()) {
    const phasor = phasors[uf.find(k)];
    nodes[k] = phasor ? cabs(phasor) : voltages[uf.find(k)] ?? 0;
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
    ...(Object.keys(phasors).length ? { phasors: Object.fromEntries([...uf.p.keys()].filter((k) => phasors[uf.find(k)]).map((k) => [k, phasors[uf.find(k)]])) } : {}),
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
  // AC: magnitude of the phasor difference (not the difference of magnitudes).
  const pa = result.phasors?.[terminal], pb = result.phasors?.[reference];
  if (pa && pb && result.nodeIslands?.[terminal] === result.nodeIslands?.[reference]) return cabs(csub(pa, pb));
  if (
    !(reference in result.nodes) ||
    result.nodeIslands?.[terminal] !== result.nodeIslands?.[reference]
  )
    return null;
  return result.nodes[terminal] - result.nodes[reference];
}
