import { definitions, isSource, perPoleKinds, prop, terminalKey, type Component, type Project, componentPorts } from "./model";
import { actualResistance } from "./parameters";
import { machineParams, currents, midpointThevenin, midpointState, airGapTorque, rotorCopper, steadyCircuit, type MachineParams } from "./induction";
import { expm, preciseDot, solveComplex, solveLinear, solveLyapunov } from "./linear-algebra";
export { solveComplex, solveLinear } from "./linear-algebra";
type Cx = [number, number];
type HarmonicBranch = { current: Cx; across: Cx; secondaryCurrent?: Cx; secondaryAcross?: Cx };
const cadd = (a: Cx, b: Cx): Cx => [a[0] + b[0], a[1] + b[1]];
const csub = (a: Cx, b: Cx): Cx => [a[0] - b[0], a[1] - b[1]];
const cmul = (a: Cx, b: Cx): Cx => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const cdiv = (a: Cx, b: Cx): Cx => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
const cabs = (a: Cx) => Math.hypot(a[0], a[1]);
const conj = (a: Cx): Cx => [a[0], -a[1]];
/** Induction machine per-phase steady equivalent circuit (double cage, iron loss) at mechanical speed ω (rad/s). */
export const inductionCircuit = (c: Component, frequency: number, omega: number) => steadyCircuit(machineParams(c, frequency), omega);
export interface ElectricalReading {
  hybrid?: import("./hybrid").HybridReading;
  /** Multi-terminal loads: per-stage RMS readings and summed apparent power, rather than a balanced equivalent. */
  stageVoltages?: number[]; stageCurrents?: number[]; heatingPower?: number; auxiliaryPower?: number; apparentPower?: number;
  /** Heat pump: outdoor-unit input, backup heater input and its supply (W, V, A). `heatingPower` is the heat into its water node. */
  compressorPower?: number; backupPower?: number; backupVoltage?: number; backupCurrent?: number;
  solar?: { warm?: { demand?: number; inputLimit?: number; voltage?: number }; trackingActive?: boolean; achievablePower?: number; targetVoltage?: number; inputPower: number; outputPower: number; efficiency: number; mode: string; running: boolean; irradiation?: number; mppPower?: number; mppVoltage?: number; mppCurrent?: number; trackingEfficiency?: number; apparentPower?: number };
  inputPower?: number;
  /**
   * DC storage: a capacitor's current into its dielectric (excluding leakage), an inductor's voltage across its inductance,
   * the power into their field energy ½·C·v² or ½·L·i², and an inductor current interrupted with no path but its arc.
   */
  chargeCurrent?: number; inductanceVoltage?: number; fieldPower?: number; interrupted?: boolean;
  /** DC steps with storage: variance of the contact current within the step (A²); peakCurrent is then its largest |i|. */
  currentVariance?: number;
  heatPower?: number; chemicalPower?: number; coilVoltage?: number; coilCurrent?: number; coilPower?: number; secondaryVoltage?: number; secondaryCurrent?: number; fanPower?: number;
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
  machine?: { torque: number; statorCopper: number; rotorCopper: number; coreLoss: number; slip: number; psiS?: [number, number]; psiR?: [number, number][]; lineRatio?: number };
  /** AC: complex RMS current phasor of the conducting path (A), referred to the supply angle ωt. */
  currentPhasor?: [number, number];
  /** Largest instantaneous current |i(t)| over the step (A), across all substeps: AC line current, or DC with storage. */
  peakCurrent?: number;
  /** AC islands fed by a drive: the drive's id (its output angle is the phasor reference). */
  supply?: string;
  /** Motor starters: contactor state and the soft starter's controlled series reactance (Ω, per phase). */
  starter?: { mode: StarterMode; reactance: number; ratio?: number; linePowerFactor?: number };
  /** Drives: input/output power (W, three-phase), losses and braking-resistor power, output quantities. */
  drive?: DriveReading;
  /** Motor leads behind a star-delta starter: conductors this element stands for (two per winding for cables). */
  conductors?: number;
  /** Networks with drives: RMS of the rectifier harmonic currents in this element (A) and their I²R (W, in `power`). */
  harmonicCurrent?: number;
  harmonicLoss?: number;
  /** Electric circulators: the electronics could not draw their demand above the undervoltage lockout and switched off. */
  undervoltage?: boolean;
}
/** Characteristic six-pulse rectifier harmonics 6k ± 1 (to the 25th) and the THD of the 1/h spectrum shape. */
export const HARMONIC_ORDERS = [5, 7, 11, 13, 17, 19, 23, 25];
export const HARMONIC_SHAPE = Math.sqrt(HARMONIC_ORDERS.reduce((sum, h) => sum + 1 / (h * h), 0));
export type StarterMode = "off" | "star" | "open" | "delta" | "ramp" | "bypass";
export interface DriveReading {
  energized: boolean;
  running: boolean;
  inputPower: number;
  outputPower: number;
  losses: number;
  braking: number;
  /** Power the rectifier emits at its harmonics (W): dissipated in the supply network, drawn from the fundamental. */
  harmonicEmission?: number;
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
  /** Power into electrostatic (capacitors) and electrochemical (batteries) storage (W). */
  storedPower?: number;
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
export interface ElectricalRuntime {
  /**
   * Stateful devices over the interval h: battery charge and polarization voltage; `capacitors`: dielectric voltage (V)
   * and `inductors`: winding current (A). Without stored state a capacitor is steady DC (open apart from its leakage)
   * and an inductor its winding resistance.
   */
  devices?: { hybrid?: Record<string, import("./hybrid").HybridState>; solar?: Record<string, import("./solar").SolarState>; batteries: Record<string, number>; polarization?: Record<string, number>; contactors: Record<string, { closed: boolean }>; capacitors?: Record<string, number>; inductors?: Record<string, number>; h: number };
  /** Weather at the solve's time (engine-bound): solar panels with conditions from the weather read their sunlight and cell temperature from it. */
  weather?: import("./weather").WeatherState;
  /** Controlled AC branch currents into terminal a. These never establish a voltage reference. */
  acInjections?: Record<string, [number, number]>;
  /** Fallback solve: converter iterations start from their cold initial values instead of the last accepted step. */
  coldStart?: boolean;
  /** Last converged constant-power load resistance per circulator within one top-level electrical solve (Ω, at demand W). */
  constantPowerWarm?: Record<string, { resistance: number; demand: number }>;
  /** Ephemeral converter iteration hook; never retained in Devices or serialized. */
  coupling?: {
    prepare: (last: ElectricalResult | undefined, models: NonNullable<ElectricalRuntime['sourceModels']>, failures: Record<string, boolean>) => void;
    residual: (result: ElectricalResult, tangent: (patch: Partial<ElectricalRuntime>) => ElectricalResult) => number;
  };
  sourceModels?: Record<string, { voltage: number; resistance: number; lower: number; upper: number }>;
  /** Resistance of expanded constant-power loads (electric circulators) for this solve (Ω); overrides the stored value. */
  loadResistances?: Record<string, number>;
  /** Electric circulators: electrical input demand (W) of each powered unit; absent or 0 = electronics off (open). */
  circulators?: Record<string, number>;
  boilers?: Record<string, number>;
  boilerTrips?: Set<string>;
  /** Heat pumps: outdoor-unit electrical demand (W; 0 = electronics off) and active 3 kW backup heater stages. */
  heatPumps?: Record<string, { demand: number; backupStages: number }>;
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
  inductionMotors?: Record<string, { omega: number; enabled: boolean; psiS?: [number, number]; psiR?: [number, number][]; h?: number }>;
  /** Protective devices currently tripped open (breakers, motor protectors). */
  open?: Set<string>;
  /** Motor starters: contactor state; soft starter: target fundamental voltage ratio (0–1) while ramping. */
  starters?: Record<string, { mode: StarterMode; ratio?: number }>;
  /** Drives: running output frequency (Hz) and output phase (star-equivalent) voltage (V RMS). */
  drives?: Record<string, { running: boolean; frequency: number; voltage: number }>;
  /** Element temperatures (°C) for temperature-dependent resistance. */
  temperatures?: Record<string, number>;
  /** Lamp filament resistance relative to the configured hot resistance (filament.ts); missing = hot. */
  filaments?: Record<string, number>;
}
/** A warm-started converter iteration exceeded its budget; solveElectrical repeats the solve from the cold start. */
export class WarmStartUnconverged extends Error {}
/** Iterations a warm-started converter coupling may take before the cold-start fallback. */
export const WARM_START_BUDGET = 100;
/** DC insulation (self-discharge) leakage of a capacitor, across its terminals (Ω). */
export const CAPACITOR_LEAKAGE = 1e9;
/** Path across an energized inductor that carries an interrupted current: the switching arc and winding capacitance (Ω). */
export const INDUCTOR_BREAKDOWN = 1e6;
/** Charged capacitors and energized inductors per DC network (the step solves a dense n(n+1)/2 Lyapunov system). */
export const MAX_STORAGE = 16;
export const sourceMode = (c: Component) => (typeof c.props.mode === "string" ? c.props.mode : "ideal") as "ideal" | "internal" | "cvcc" | "cc";
/** Current limit of a regulating source, or Infinity for ideal / internal-resistance sources. */
export const sourceLimit = (c: Component) => sourceMode(c) === "cc" ? prop(c, "current") : sourceMode(c) === "cvcc" ? prop(c, "maxCurrent") : Infinity;
/** Wire connectivity depends only on the immutable project and disconnected wires; it is cached. */
type ElectricalTopology = { cs: Component[]; grounds: Component[]; root: Map<string, string>; ports: Map<string, Record<string, string>>; terminals: string[]; rootEntries: [string, string][]; islandCache: Map<string, IslandStructure> };
type Finder = { find: (n: string) => string };
/**
 * Islands for one set of conducting elements: the networks joined by conducting elements, transformers and drive DC
 * links; the galvanic groups; the node groups in solve order (drive outputs first) with each island's elements; and
 * each terminal's node and island. They depend only on the topology and the conducting set (relays by their
 * conducting end), so they are cached per topology. The unions are joined in the same order as a fresh build, so
 * every representative is the same.
 */
interface IslandStructure { islands: Finder; galvanic: Finder; groups: Map<string, string[]>; ordered: [string, string[]][]; inIsland: Map<string, Set<string>>; members: Map<string, Component[]>; nodeIds: Record<string, string>; nodeIslands: Record<string, string> }
function islandStructure(topology: ElectricalTopology, active: Component[], node: (id: string, p: string) => string, end: (c: Component) => string): IslandStructure {
  const key = active.map((c) => c.kind === "relay" ? `${c.id}\u0001${end(c)}` : c.id).join("\u0000");
  const cached = topology.islandCache.get(key);
  if (cached) return cached;
  const islands = new Union();
  for (const n of topology.terminals) islands.find(n);
  const galvanic = new Union();
  for (const c of active) {
    islands.join(node(c.id, "a"), node(c.id, end(c)));
    galvanic.join(node(c.id, "a"), node(c.id, end(c)));
    if (c.kind === "transformer") {
      islands.join(node(c.id, "a"), node(c.id, "sa")); islands.join(node(c.id, "a"), node(c.id, "sb"));
      galvanic.join(node(c.id, "sa"), node(c.id, "sb"));
    }
  }
  // A drive couples its input and output networks only through its DC link (power, not node voltages).
  for (const c of active.filter((c) => c.kind === "vfd")) islands.join(node(c.id, "oa"), node(c.id, "ob"));
  const islandOf = new Map<string, string>(), galvanicOf = new Map<string, string>();
  for (const k of islands.p.keys()) islandOf.set(k, islands.find(k));
  for (const k of galvanic.p.keys()) galvanicOf.set(k, galvanic.find(k));
  const islandFinder = { find: (n: string) => islandOf.get(n) ?? n }, galvanicFinder = { find: (n: string) => galvanicOf.get(n) ?? n };
  const groups = new Map<string, string[]>();
  for (const n of new Set(topology.rootEntries.map(([, n]) => n))) {
    const key = islandFinder.find(n);
    const group = groups.get(key);
    if (group) group.push(n); else groups.set(key, [n]);
  }
  const driveAt = (ns: Set<string>) => active.filter((c) => c.kind === "vfd" && ns.has(node(c.id, "oa")));
  const inIsland = new Map([...groups].map(([island, ns]) => [island, new Set(ns)]));
  const drivesFed = new Map([...groups].map(([island]) => [island, driveAt(inIsland.get(island)!).length]));
  const ordered = [...groups].sort(([x], [y]) => drivesFed.get(y)! - drivesFed.get(x)!);
  const members = new Map(ordered.map(([island]) => [island, active.filter((c) => inIsland.get(island)!.has(node(c.id, "a")))]));
  const nodeIds: Record<string, string> = {}, nodeIslands: Record<string, string> = {};
  const transformers = active.some(c => c.kind === "transformer"), islandAt = new Map<string, string>();
  for (const [k, n] of topology.rootEntries) {
    nodeIds[k] = n;
    let island = islandAt.get(n);
    if (island === undefined) islandAt.set(n, island = transformers ? galvanicFinder.find(n) : islandFinder.find(n));
    nodeIslands[k] = island;
  }
  const structure = { islands: islandFinder, galvanic: galvanicFinder, groups, ordered, inIsland, members, nodeIds, nodeIslands };
  if (topology.islandCache.size >= 256) topology.islandCache.clear();
  topology.islandCache.set(key, structure);
  return structure;
}
const electricalCache = new WeakMap<Project, Map<string, ElectricalTopology>>();
function electricalTopology(project: Project, disconnected: Set<string>): ElectricalTopology {
  const key = [...disconnected].sort().join(","), byProject = electricalCache.get(project) ?? new Map<string, ElectricalTopology>();
  electricalCache.set(project, byProject);
  const cached = byProject.get(key);
  if (cached) return cached;
  const uf = new Union();
  const cs = project.components.filter((c) => componentPorts(c).some((p) => p.domain === "electrical"));
  for (const c of cs) for (const p of componentPorts(c).filter((p) => p.domain === "electrical")) uf.find(`${c.id}:${p.id}`);
  for (const w of project.connections.filter((w) => w.domain === "electrical" && !disconnected.has(w.id))) uf.join(terminalKey(w.from), terminalKey(w.to));
  const grounds = cs.filter((c) => c.kind === "ground");
  for (const g of grounds.slice(1)) uf.join(`${g.id}:a`, `${grounds[0].id}:a`);
  const root = new Map([...uf.p.keys()].map((k) => [k, uf.find(k)]));
  // Per-component port roots and every electrical terminal root, in component/port order.
  const ports = new Map<string, Record<string, string>>(), terminals: string[] = [];
  for (const c of cs) {
    const byPort: Record<string, string> = {};
    for (const p of componentPorts(c).filter((p) => p.domain === "electrical")) terminals.push(byPort[p.id] = root.get(`${c.id}:${p.id}`)!);
    ports.set(c.id, byPort);
  }
  const topology = { cs, grounds, root, ports, terminals, rootEntries: [...root], islandCache: new Map<string, IslandStructure>() };
  byProject.set(key, topology);
  return topology;
}
export function solveElectricalCore(
  project: Project,
  failed: Record<string, boolean> = {},
  runtime: ElectricalRuntime = {},
): ElectricalResult {
  const topology = electricalTopology(project, runtime.disconnected ?? new Set());
  const { cs, grounds, root, ports } = topology;
  const uf = { p: root, find: (k: string) => root.get(k) ?? k };
  const node = (id: string, p: string) => ports.get(id)?.[p] ?? root.get(`${id}:${p}`)!;
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
      !(isSource(c) && runtime.sourceModels?.[c.id]?.lower === 0 && runtime.sourceModels[c.id].upper === 0) &&
      !(isSource(c) && c.props.enabled === false) &&
      !((c.kind === "breaker" || c.kind === "motorProtector") && (c.props.closed === false || runtime.open?.has(c.id))) &&
      !(c.kind === "motor" && runtime.motors?.[c.id]?.enabled === false) &&
      !(c.kind === "inductionMotor" && runtime.inductionMotors?.[c.id]?.enabled === false) &&
      !(isStarter(c) && !["star", "delta", "ramp", "bypass"].includes(runtime.starters?.[c.id]?.mode ?? "off")) &&
      runtime.faults?.[c.id] !== "failedOpen" &&
      !(c.kind === "switch" && !c.props.closed) &&
      !(c.kind === "safety" && !contact(c)),
  );
  const structure = islandStructure(topology, active, node, end), { islands, galvanic, groups } = structure;
  const voltages: Record<string, number> = {},
    sourceI: Record<string, number> = {},
    regulation: Record<string, "cv" | "cc"> = {},
    islandPhases = new Map<string, 3>(),
    references: Record<string, string> = {};
  const resistances: Record<string, number> = {};
  /** Storage elements solved in a DC island: dielectric voltage or inductor current at the start, on average and at the end of h. */
  const stored = new Map<string, { initial: number; mean: number; final?: number; h: number; interrupted: boolean }>();
  /** Within-step deviation of branch currents from their averages: variance (A²) and start and end deviations (A). */
  const deviations = new Map<string, { variance: number; start: number; end: number }>();
  /** Engine state: a capacitor's dielectric voltage or an inductor's current; undefined for a steady DC solve. */
  const stateOf = (c: Component) => c.kind === "capacitor" ? runtime.devices?.capacitors?.[c.id] : c.kind === "inductor" ? runtime.devices?.inductors?.[c.id] : undefined;
  // A capacitor's resistance is its ESR; its DC insulation leakage is a separate parallel path.
  const resistanceOf = (c: Component) => {
    if (resistances[c.id] !== undefined) return resistances[c.id];
    const load = runtime.loadResistances?.[c.id];
    if (load !== undefined) return (resistances[c.id] = load);
    const r = c.kind === "motor" ? prop(c, "resistance", 1) : actualResistance(c, runtime.temperatures?.[c.id] ?? 20) * (c.kind === "lamp" ? runtime.filaments?.[c.id] ?? 1 : 1);
    if (!Number.isFinite(r) || r <= 0)
      throw Error(`${c.name}: resistance must be positive (temperature-dependent model gives ${r.toPrecision(3)} Ω at ${(runtime.temperatures?.[c.id] ?? 20).toFixed(1)} °C).`);
    return (resistances[c.id] = r);
  };
  let residual = 0;
  const acIslands = new Set<string>(), phasors: Record<string, Cx> = {}, acReadings: Record<string, ElectricalReading> = {};
  const driveOutputs: Record<string, { voltage: Cx; current: Cx; power: number }> = {};
  /**
   * Each starter feeds exactly one induction motor: from its motor terminal through series two-terminal
   * elements (cable, overload relay, breaker, meter, …) to the motor's terminal a, without branches.
   */
  const terminals = (c: Component) => componentPorts(c).filter((p) => p.domain === "electrical").map((p) => node(c.id, p.id));
  const structural = cs.filter((c) => c.kind !== "ground" && c.kind !== "junction");
  const feeder = (st: Component) => {
    let at = node(st.id, "b"), previous = st;
    const path: Component[] = [];
    for (let k = 0; k < 32; k++) {
      const next = structural.filter((c) => c !== previous && terminals(c).includes(at));
      if (next.length !== 1) return null;
      const e = next[0];
      if (e.kind === "inductionMotor") return node(e.id, "a") === at ? { motor: e, path } : null;
      if (isSource(e) || isStarter(e) || e.kind === "vfd" || e.kind === "motor" || terminals(e).length !== 2) return null;
      path.push(e);
      at = node(e.id, "a") === at ? node(e.id, "b") : node(e.id, "a");
      previous = e;
    }
    return null;
  };
  const starterOf = new Map<string, Component>(), motorOf = new Map<string, Component>(), pathOf = new Map<string, Component[]>();
  /**
   * Motor leads of a star-delta starter carry winding current: six conductors (U1–W1 and U2–W2 sides), so a
   * cable stands for two conductors per winding (n = 2) and a relay or other device in the U1 leads for one
   * (n = 1). Star: winding current = line current, n·Z per phase. Delta: winding current = line/√3 and
   * n·Z per winding, i.e. n·Z/3 in the per-phase star equivalent.
   */
  const leads = new Map<string, { z: number; i: number; conductors: number }>();
  for (const st of structural.filter(isStarter)) {
    const f = feeder(st);
    if (!f) {
      if (active.includes(st)) throw Error(`${st.name}: its motor terminal must lead, through series elements without branches, to terminal a of exactly one induction motor.`);
      continue;
    }
    if (starterOf.has(f.motor.id)) throw Error(`${f.motor.name}: only one starter can feed a motor.`);
    starterOf.set(f.motor.id, st);
    motorOf.set(st.id, f.motor);
    pathOf.set(st.id, f.path);
    if (st.kind === "starDeltaStarter") {
      const star = runtime.starters?.[st.id]?.mode !== "delta";
      for (const e of f.path) {
        const n = e.kind === "cable" ? 2 : 1;
        leads.set(e.id, { z: star ? n : n / 3, i: star ? 1 : 1 / Math.sqrt(3), conductors: 3 * n });
      }
    }
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
    const m = motorOf.get(st.id)!, w = 2 * Math.PI * frequency;
    // Motor impedance plus the series elements between starter and motor (cable, relay): they carry line current.
    const z = (pathOf.get(st.id) ?? []).reduce<Cx>((sum, e) => cadd(sum, e.kind === "inductor" ? [resistanceOf(e), w * prop(e, "inductance")] : e.kind === "capacitor" ? [resistanceOf(e), -1 / (w * prop(e, "capacitance"))] : [resistanceOf(e), 0]), inductionCircuit(m, frequency, runtime.inductionMotors?.[m.id]?.omega ?? 0).impedance);
    const k = Math.max(1e-3, Math.min(1, state.ratio ?? 1)), limit = prop(st, "currentLimit") * prop(st, "ratedCurrent");
    const forRatio = Math.sqrt(Math.max(0, (z[0] ** 2 + z[1] ** 2) / (k * k) - z[0] ** 2)) - z[1];
    const forLimit = Math.sqrt(Math.max(0, (phaseVoltage / limit) ** 2 - z[0] ** 2)) - z[1];
    return Math.max(0, forRatio, forLimit);
  };
  /**
   * A machine whose terminals are not closed through the rest of the network (open starter, open switch
   * upstream) carries no stator current: it is an open stator (flux decay in the machine model), not a
   * Thevenin element, which would leave its node floating or ring at the current interruption.
   */
  const closedLoopIn = (members: Component[], m: Component, drive?: Component) => {
    const u = new Union();
    for (const c of members) if (c !== m) u.join(node(c.id, "a"), node(c.id, end(c)));
    if (drive) u.join(node(drive.id, "oa"), node(drive.id, "ob"));
    return u.find(node(m.id, "a")) === u.find(node(m.id, "b"));
  };
  /** Series impedance of a passive element at angular frequency w (motor leads scaled; starter: its controlled reactance at w). */
  const passiveImpedance = (c: Component, w: number, starterX = 0): Cx => {
    const z: Cx = isStarter(c) ? [resistanceOf(c), starterX] : c.kind === "inductor" ? [resistanceOf(c), w * prop(c, "inductance")] : c.kind === "capacitor" ? [resistanceOf(c), -1 / (w * prop(c, "capacitance"))] : [resistanceOf(c), 0];
    const lead = leads.get(c.id);
    return lead ? [z[0] * lead.z, z[1] * lead.z] : z;
  };
  /**
   * Subnetworks cut off by an open-stator machine (open starter with its motor leads) carry no current and
   * have no path to the reference or a source: pin them to 0 V instead of leaving the matrix singular.
   */
  const pinFloating = (A: Cx[][], B: Cx[], nodesCount: number) => {
    const nonzero = (v: Cx) => v[0] !== 0 || v[1] !== 0, grounded = new Set<number>();
    for (let i = 0; i < nodesCount; i++) {
      const rowSum = A[i].slice(0, nodesCount).reduce<Cx>((sum, v) => cadd(sum, v), [0, 0]);
      if (cabs(rowSum) > 1e-12 * Math.max(cabs(A[i][i]), 1e-300) || A[i].slice(nodesCount).some(nonzero) || nonzero(B[i])) grounded.add(i);
    }
    for (const queue = [...grounded]; queue.length;) {
      const i = queue.pop()!;
      for (let j = 0; j < nodesCount; j++) if (!grounded.has(j) && (nonzero(A[i][j]) || nonzero(A[j][i]))) { grounded.add(j); queue.push(j); }
    }
    for (let i = 0; i < nodesCount; i++) if (!grounded.has(i)) { A[i] = A[i].map((_, j) => (j === i ? [1, 0] : [0, 0]) as Cx); B[i] = [0, 0]; }
  };
  const stampTransformers = (A: Cx[][], B: Cx[], unknown: string[], ref: string, members: Component[], start: number, frequency: number) => {
    const indices = new Map(unknown.map((n, i) => [n, i]));
    const transformers = members.filter(c => c.kind === "transformer");
    transformers.forEach((c, i) => {
      const k = start + i, ratio = prop(c, "turnsRatio"), w = 2 * Math.PI * frequency;
      for (const [port, sign] of [["a", 1], ["b", -1], ["sa", -ratio], ["sb", ratio]] as const) {
        const j = indices.get(node(c.id, port));
        if (j !== undefined) { A[j][k] = cadd(A[j][k], [sign, 0]); A[k][j] = cadd(A[k][j], [sign, 0]); }
      }
      A[k][k] = [-prop(c, "windingResistance"), -w * prop(c, "leakageInductance")];
      const y: Cx = [1 / prop(c, "coreResistance"), -1 / (w * prop(c, "magnetizingInductance"))];
      const p = indices.get(node(c.id, "a")), q = indices.get(node(c.id, "b"));
      for (const [r, s, sign] of [[p, p, 1], [q, q, 1], [p, q, -1], [q, p, -1]] as const) if (r !== undefined && s !== undefined) A[r][s] = cadd(A[r][s], [sign * y[0], sign * y[1]]);
    });
    // One voltage datum per galvanic network; this removes redundant KCL without connecting windings.
    if (transformers.length) {
      const referenced = new Set([galvanic.find(ref)]);
      for (const n of unknown) {
        const group = galvanic.find(n);
        if (referenced.has(group)) continue;
        referenced.add(group);
        const i = indices.get(n)!;
        A[i] = A[i].map((_, j): Cx => [i === j ? 1 : 0, 0]); B[i] = [0, 0];
        references[group] = n;
      }
      references[galvanic.find(ref)] = ref;
    }
    return transformers;
  };
  /**
   * Harmonic network at order h (frequency h·f) for a supply network with drives: each rectifier draws the
   * characteristic six-pulse currents I_h = s·|I₁|/h ∠ h·φ₁ (h = 6k ± 1), s set by the drive's input THD.
   * Supplies are their internal impedance (no harmonic EMF); induction machines their leakage impedance
   * (slip ≈ 1): Rs + Rr + j·h·(X1 + X2)·f/f_rated; other elements their impedance at h·f.
   */
  const solveHarmonic = (ns: string[], ref: string, members: Component[], sources: Component[], frequency: number, order: number, draws: Map<string, Cx>, reactances: Map<string, number>) => {
    const unknown = ns.filter((n) => n !== ref), size = unknown.length + sources.length + members.filter(c => c.kind === "transformer").length, w = 2 * Math.PI * frequency * order;
    const indices = new Map(unknown.map((n, i) => [n, i]));
    const A: Cx[][] = Array.from({ length: size }, () => Array.from({ length: size }, () => [0, 0] as Cx)), B: Cx[] = Array.from({ length: size }, () => [0, 0] as Cx);
    const add = (i: number | undefined, j: number | undefined, v: Cx) => { if (i !== undefined && j !== undefined) A[i][j] = cadd(A[i][j], v); };
    const impedance = new Map<string, Cx>();
    for (const c of members.filter((c) => !isSource(c) && c.kind !== "transformer")) {
      let z: Cx;
      if (c.kind === "vfd") {
        const draw = draws.get(c.id), p = indices.get(node(c.id, "a")), q = indices.get(node(c.id, "b"));
        if (draw) { if (p !== undefined) B[p] = csub(B[p], draw); if (q !== undefined) B[q] = cadd(B[q], draw); }
        continue;
      }
      if (c.kind === "inductionMotor") {
        if (runtime.inductionMotors?.[c.id]?.enabled === false || !closedLoopIn(members, c)) continue;
        // Harmonic fields rotate far faster than the rotor (slip ≈ 1): the locked-rotor circuit at h·f, both cages and iron loss.
        const a = lineRatio(c), locked = inductionCircuit(c, frequency * order, 0).impedance;
        z = [locked[0] / (a * a), locked[1] / (a * a)];
      } else z = passiveImpedance(c, w, (reactances.get(c.id) ?? 0) * order);
      impedance.set(c.id, z);
      const y = cdiv([1, 0], z), p = indices.get(node(c.id, "a")), q = indices.get(node(c.id, end(c)));
      add(p, p, y); add(q, q, y); add(p, q, [-y[0], -y[1]]); add(q, p, [-y[0], -y[1]]);
    }
    sources.forEach((src, i) => {
      const k = unknown.length + i, p = indices.get(node(src.id, "a")), q = indices.get(node(src.id, "b"));
      if (p !== undefined) { A[p][k] = cadd(A[p][k], [1, 0]); A[k][p] = cadd(A[k][p], [1, 0]); }
      if (q !== undefined) { A[q][k] = cadd(A[q][k], [-1, 0]); A[k][q] = cadd(A[k][q], [-1, 0]); }
      A[k][k] = cadd(A[k][k], [-prop(src, "internalResistance"), -order * prop(src, "internalReactance")]);
    });
    const transformers = stampTransformers(A, B, unknown, ref, members, unknown.length + sources.length, frequency * order);
    pinFloating(A, B, unknown.length);
    const x = size ? solveComplex(A, B) : [];
    const V = (n: string): Cx => (n === ref ? [0, 0] : x[indices.get(n)!] ?? [0, 0]);
    const result = new Map<string, HarmonicBranch>();
    for (const c of members) {
      if (isSource(c)) { const i = sources.indexOf(c); result.set(c.id, { current: x[unknown.length + i], across: csub(V(node(c.id, "a")), V(node(c.id, "b"))) }); continue; }
      const across = csub(V(node(c.id, "a")), V(node(c.id, end(c))));
      if (c.kind === "transformer") {
        const transfer = x[unknown.length + sources.length + transformers.indexOf(c)];
        const current = cadd(transfer, cmul(across, [1 / prop(c, "coreResistance"), -1 / (w * prop(c, "magnetizingInductance"))]));
        result.set(c.id, { current, across, secondaryCurrent: cmul(transfer, [-prop(c, "turnsRatio"), 0]), secondaryAcross: csub(V(node(c.id, "sa")), V(node(c.id, "sb"))) }); continue;
      }
      if (c.kind === "vfd") { result.set(c.id, { current: draws.get(c.id) ?? [0, 0], across }); continue; }
      const z = impedance.get(c.id);
      if (z) result.set(c.id, { current: cdiv(across, z), across });
    }
    return result;
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
    const unknown = ns.filter((n) => n !== ref), size = unknown.length + sources.length + (drive ? 1 : 0) + members.filter(c => c.kind === "transformer").length;
    if (size > 250) throw Error("Circuit matrix exceeds 250 unknowns. Reduce the scene.");
    const indices = new Map(unknown.map((n, i) => [n, i]));
    const A: Cx[][] = Array.from({ length: size }, () => Array.from({ length: size }, () => [0, 0] as Cx)), B: Cx[] = Array.from({ length: size }, () => [0, 0] as Cx);
    const add = (i: number | undefined, j: number | undefined, v: Cx) => { if (i !== undefined && j !== undefined) A[i][j] = cadd(A[i][j], v); };
    const impedance = new Map<string, Cx>(), circuits = new Map<string, ReturnType<typeof inductionCircuit>>();
    const dynamic = new Map<string, { m: MachineParams; state: NonNullable<ElectricalRuntime["inductionMotors"]>[string]; e?: Cx }>();
    const inject = (p: number | undefined, q: number | undefined, j: Cx) => { if (p !== undefined) B[p] = cadd(B[p], j); if (q !== undefined) B[q] = csub(B[q], j); };
    const injections = members.filter(c => runtime.acInjections?.[c.id]);
    for (const c of injections) {
      const current = runtime.acInjections![c.id];
      inject(indices.get(node(c.id, "a")), indices.get(node(c.id, "b")), [-current[0], -current[1]]);
    }
    const reactances = new Map<string, number>();
    const closedLoop = (m: Component) => closedLoopIn(members, m, drive);
    for (const c of members.filter((c) => !isSource(c) && c.kind !== "transformer")) {
      let z: Cx;
      if (c.kind === "inductionMotor") {
        const state = runtime.inductionMotors?.[c.id];
        if (state && !state.enabled) continue;
        if (!closedLoop(c)) continue;
        // Star connection: v_line = v_winding/a, i_line = a·i_winding, so the terminals see Z/a² and E/a.
        const a = lineRatio(c);
        if (state?.psiS && state.psiR) {
          const m = machineParams(c, frequency), p = indices.get(node(c.id, "a")), q = indices.get(node(c.id, "b"));
          // Iron loss: the core-loss resistance across the winding voltage, a²/Rc at the line terminals.
          const core = Number.isFinite(m.Rc) ? a * a / m.Rc : 0;
          if (core) { add(p, p, [core, 0]); add(q, q, [core, 0]); add(p, q, [-core, 0]); add(q, p, [-core, 0]); }
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
      } else {
        if (isStarter(c)) reactances.set(c.id, starterReactance(c, frequency, nominal));
        z = passiveImpedance(c, w, reactances.get(c.id) ?? 0);
      }
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
    const transformers = stampTransformers(A, B, unknown, ref, members, unknown.length + sources.length + (drive ? 1 : 0), frequency);
    pinFloating(A, B, unknown.length);
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
        // AC storage readings still dissipate their real winding/ESR power. Keep the
        // heat channel present across DC-to-AC substeps, otherwise averaging a prior
        // DC heat reading would omit this interval's AC heating.
        ...(['inductor', 'capacitor'].includes(c.kind) ? { heatPower: P } : {}),
        ac: true, currentPhasor: current, reactivePower: Q, powerFactor: apparent > 1e-12 ? Math.abs(P) / apparent : null, frequency, ...(phases === 3 ? { phases: 3 as const } : {}), ...(drive ? { supply: drive.id } : {}), ...extra,
      };
    };
    if (drive) {
      const k = unknown.length + sources.length, voltage = csub(V(node(drive.id, "oa")), V(node(drive.id, "ob")));
      const delivered: Cx = [-x[k][0], -x[k][1]];
      driveOutputs[drive.id] = { voltage, current: delivered, power: phases * cmul(voltage, conj(delivered))[0] };
    }
    for (const c of injections) record(c, csub(V(node(c.id, "a")), V(node(c.id, "b"))), runtime.acInjections![c.id], { regulation: "cc" });
    sources.forEach((src, i) => {
      const current = x[unknown.length + i], voltage = csub(V(node(src.id, "a")), V(node(src.id, "b")));
      record(src, voltage, current, { regulation: "cv" });
      // Delivered power is negative in the source's own reading (current into terminal a).
      acReadings[src.id].current = acReadings[src.id].power < 0 ? -acReadings[src.id].current : acReadings[src.id].current;
    });
    for (const c of members.filter((c) => !isSource(c) && c.kind !== "transformer")) {
      const z = impedance.get(c.id);
      const across = csub(V(node(c.id, "a")), V(node(c.id, end(c)))), terminal = csub(V(node(c.id, "a")), V(node(c.id, "b")));
      const dyn = dynamic.get(c.id);
      let current = z ? cdiv(dyn?.e ? csub(across, dyn.e) : across, z) : ([0, 0] as Cx);
      const circuit = circuits.get(c.id);
      let machine: ElectricalReading["machine"] | undefined;
      // Star-connected motor: winding quantities are v = a·v_line, i = i_line/a; readings show line current.
      const a = c.kind === "inductionMotor" ? lineRatio(c) : 1;
      if (dyn) {
        const { m, state } = dyn, slip = (m.ws - m.pairs * state.omega) / m.ws, winding: Cx = [a * terminal[0], a * terminal[1]];
        const mid = state.h ? midpointState(m, state.psiS!, state.psiR!, state.h, state.omega, winding) : { ...currents(m, state.psiS!, state.psiR!), psiS: state.psiS!, psiR: state.psiR! };
        const core: Cx = Number.isFinite(m.Rc) ? [winding[0] / m.Rc, winding[1] / m.Rc] : [0, 0];
        current = [a * (mid.is[0] + core[0]), a * (mid.is[1] + core[1])];
        // Per-phase losses × 3 (the machine is always three-phase; `phases` is 3 in its balanced island).
        machine = { torque: airGapTorque(m, mid.psiS, mid.is), statorCopper: 3 * m.Rs * (mid.is[0] ** 2 + mid.is[1] ** 2), rotorCopper: rotorCopper(m, mid.ir), coreLoss: Number.isFinite(m.Rc) ? 3 * cabs(winding) ** 2 / m.Rc : 0, slip, psiS: mid.psiS, psiR: mid.psiR, ...(a !== 1 ? { lineRatio: a } : {}) };
      } else if (circuit) {
        const split = circuit.split([a * terminal[0], a * terminal[1]]);
        machine = { torque: split.torque, statorCopper: split.statorCopper, rotorCopper: split.rotorCopper, coreLoss: split.coreLoss, slip: circuit.slip, ...(a !== 1 ? { lineRatio: a } : {}) };
      }
      // Line power factor at the starter's supply terminal (motor plus thyristor reactance), not the element's own.
      const lineSide = V(node(c.id, "a")), lineApparent = cabs(lineSide) * cabs(current);
      const starter = isStarter(c) ? { starter: { mode: runtime.starters?.[c.id]?.mode ?? "off", reactance: reactances.get(c.id) ?? 0, ratio: runtime.starters?.[c.id]?.ratio, linePowerFactor: lineApparent > 1e-12 ? Math.abs(cmul(lineSide, conj(current))[0]) / lineApparent : undefined } } : {};
      // Power belongs to the conducting contact (a–nc for a de-energized relay).
      // The voltage measurement retains the public a–b terminal convention (a star-connected motor: winding voltage).
      record(c, across, current, { voltage: a * cabs(terminal), voltageValid: islands.find(node(c.id, "a")) === islands.find(node(c.id, "b")), ...(machine ? { machine } : {}), ...starter, ...(resistances[c.id] !== undefined ? { resistance: resistances[c.id] } : {}) });
      if (c.kind === "relay" && end(c) === "nc") { acReadings[c.id].currentNC = acReadings[c.id].current; acReadings[c.id].current = 0; }
      const lead = leads.get(c.id);
      if (lead) {
        // Report one conductor: lead current and voltage drop; power stays the total of all conductors.
        const r = acReadings[c.id], k = lead.i;
        Object.assign(r, { current: r.current * k, contactCurrent: (r.contactCurrent ?? 0) * k, currentNC: (r.currentNC ?? 0) * k, currentPhasor: r.currentPhasor ? [r.currentPhasor[0] * k, r.currentPhasor[1] * k] : undefined, voltage: r.voltage * k / lead.z, ...(perPoleKinds.has(c.kind) ? { conductors: lead.conductors } : {}) });
      }
    }
    for (const c of transformers) {
      const k = unknown.length + sources.length + (drive ? 1 : 0) + transformers.indexOf(c), loadCurrent = x[k], primary = csub(V(node(c.id, "a")), V(node(c.id, "b"))), secondary = csub(V(node(c.id, "sa")), V(node(c.id, "sb")));
      const magnetizing = cmul(primary, [1 / prop(c, "coreResistance"), -1 / (w * prop(c, "magnetizingInductance"))]), current = cadd(loadCurrent, magnetizing), secondaryI = cmul(loadCurrent, [-prop(c, "turnsRatio"), 0]);
      record(c, primary, current);
      const r = acReadings[c.id];
      r.inputPower = r.power;
      r.power += phases * cmul(secondary, conj(secondaryI))[0];
      r.secondaryVoltage = cabs(secondary); r.secondaryCurrent = cabs(secondaryI);
    }
    return { ref, reactances, frequency, phases };
  };
  const driveAt = (ns: Set<string>) => active.filter((c) => c.kind === "vfd" && ns.has(node(c.id, "oa")));
  const energized = (d: Component) => active.some((c) => c.kind === "source3" && islands.find(node(c.id, "a")) === islands.find(node(d.id, "a")));
  /** Rectifier demand (W, three-phase): output power plus losses; regenerated surplus goes to the braking resistor. */
  const driveDemand = (d: Component) => {
    const out = driveOutputs[d.id], output = out?.power ?? 0, losses = driveLosses(d, out ? cabs(out.current) : 0), net = output + losses;
    return { input: Math.max(0, net), output, losses, braking: Math.max(0, -net) };
  };
  // Drive output networks first: their power is the demand of the drives' supply networks.
  const { inIsland, ordered } = structure;
  for (const [island, ns] of ordered) {
    const members = structure.members.get(island)!,
      sources = members.filter(c => isSource(c) && !runtime.acInjections?.[c.id]);
    const fed = driveAt(inIsland.get(island)!);
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
      // The rectifiers' harmonic currents dissipate I²R in the network; that power is drawn from the fundamental
      // (input = output + losses + harmonic emission), so it is part of the same iteration.
      const demand = new Map(drives.map((d) => [d.id, driveDemand(d)])), loads = new Map<string, number>(), emission = new Map(drives.map((d) => [d.id, 0]));
      const nominal = sources[0].kind === "source3" ? prop(sources[0], "lineVoltage") / Math.sqrt(3) : prop(sources[0], "voltage");
      const squared = new Map(drives.map((d) => [d.id, nominal ** 2]));
      const input = (d: Component) => { const dm = demand.get(d.id)!, base = dm.output + dm.losses; return base > 0 ? base + emission.get(d.id)! : 0; };
      const across = (d: Component) => csub(phasors[node(d.id, "a")] ?? [0, 0], phasors[node(d.id, "b")] ?? [0, 0]);
      // The harmonic network does not depend on the iteration: solve it once per order and drive for a unit
      // injection, then superpose with the actual injections c = s/h·|I₁|∠h·φ₁ (linear network).
      let unit: Map<string, HarmonicBranch>[][] | undefined;
      const injections = () => HARMONIC_ORDERS.map((h) => drives.map((d) => {
        const fundamental = cmul([loads.get(d.id)!, 0], across(d)), magnitude = prop(d, "inputTHD", 40) / 100 / HARMONIC_SHAPE / h * cabs(fundamental), angle = h * Math.atan2(fundamental[1], fundamental[0]);
        return [magnitude * Math.cos(angle), magnitude * Math.sin(angle)] as Cx;
      }));
      const superpose = (k: number, id: string, c: Cx[][]) => drives.reduce((sum, d, j) => {
        const e = unit![k][j].get(id);
        return e ? { current: cadd(sum.current, cmul(e.current, c[k][j])), across: cadd(sum.across, cmul(e.across, c[k][j])), secondaryCurrent: cadd(sum.secondaryCurrent, cmul(e.secondaryCurrent ?? [0, 0], c[k][j])), secondaryAcross: cadd(sum.secondaryAcross, cmul(e.secondaryAcross ?? [0, 0], c[k][j])) } : sum;
      }, { current: [0, 0] as Cx, across: [0, 0] as Cx, secondaryCurrent: [0, 0] as Cx, secondaryAcross: [0, 0] as Cx });
      let c: Cx[][] = [];
      for (let iteration = 0; ; iteration++) {
        for (const d of drives) loads.set(d.id, input(d) / (3 * Math.max(squared.get(d.id)!, 1e-12)));
        const solved = solveACIsland(island, ns, members, sources, undefined, loads);
        unit ??= HARMONIC_ORDERS.map((h) => drives.map((d) => prop(d, "inputTHD", 40) === 0 ? new Map() : solveHarmonic(ns, solved.ref, members, sources, solved.frequency, h, new Map([[d.id, [1, 0] as Cx]]), solved.reactances)));
        c = injections();
        let change = 0;
        for (const d of drives) {
          const v = across(d), sq = v[0] ** 2 + v[1] ** 2;
          // Power the rectifier emits at the harmonics (it draws I_h, so it absorbs −3·Re(V_h·I_h*)).
          const emitted = -HARMONIC_ORDERS.reduce((sum, _, k) => { const e = superpose(k, d.id, c); return sum + 3 * cmul(e.across, conj(e.current))[0]; }, 0);
          change = Math.max(change, Math.abs(sq - squared.get(d.id)!) / Math.max(sq, 1e-12), Math.abs(emitted - emission.get(d.id)!) / Math.max(1, input(d)));
          squared.set(d.id, sq);
          emission.set(d.id, emitted);
        }
        if (change < 1e-13) break;
        if (iteration > 50) throw Error(`${drives[0].name}: input power did not converge; the supply is too weak for the drive load.`);
      }
      const harmonics = HARMONIC_ORDERS.map((_, k) => new Map(members.map((m) => [m.id, superpose(k, m.id, c)])));
      // Harmonic currents add to every element's RMS current and their I²R to its heat.
      const fundamentalPower = new Map(Object.entries(acReadings).map(([id, r]) => [id, r.power]));
      for (const c of members) {
        const r = acReadings[c.id];
        if (!r) continue;
        let sq = 0, loss = 0, primaryPower = 0, secondarySq = 0, secondaryVoltageSq = 0;
        for (const m of harmonics) {
          const e = m.get(c.id);
          if (e) {
            sq += e.current[0] ** 2 + e.current[1] ** 2;
            if (c.kind === "transformer") {
              secondarySq += cabs(e.secondaryCurrent!) ** 2;
              secondaryVoltageSq += cabs(e.secondaryAcross!) ** 2;
            }
            const input = 3 * cmul(e.across, conj(e.current))[0]; primaryPower += input;
            loss += input + (c.kind === "transformer" ? 3 * cmul(e.secondaryAcross, conj(e.secondaryCurrent))[0] : 0);
          }
        }
        if (r.inputPower !== undefined) r.inputPower += primaryPower;
        if (c.kind === "transformer") {
          r.secondaryCurrent = Math.sqrt(r.secondaryCurrent! ** 2 + secondarySq);
          r.secondaryVoltage = Math.sqrt(r.secondaryVoltage! ** 2 + secondaryVoltageSq);
        }
        if (sq === 0) continue;
        const k = leads.get(c.id)?.i ?? 1, rms = Math.sqrt(r.current ** 2 + sq * k * k);
        Object.assign(r, { current: (Math.sign(r.current) || 1) * rms, contactCurrent: rms, harmonicCurrent: Math.sqrt(sq) * k, harmonicLoss: c.kind === "vfd" ? 0 : loss });
        if (c.kind !== "vfd") {
          r.power += loss;
          if (r.heatPower !== undefined) r.heatPower += loss;
        }
        const real = c.kind === "vfd" ? input(c) : r.inputPower ?? fundamentalPower.get(c.id) ?? r.power, apparent = (r.phases ?? 1) * r.voltage * rms;
        r.powerFactor = apparent > 1e-12 ? Math.min(1, Math.abs(real) / apparent) : null;
      }
      for (const d of drives) {
        const dm = demand.get(d.id)!, out = driveOutputs[d.id], drawn = input(d);
        acReadings[d.id] = {
          ...acReadings[d.id], power: drawn - emission.get(d.id)! - dm.output,
          drive: { energized: true, running: !!out, inputPower: drawn, outputPower: dm.output, losses: dm.losses, braking: dm.braking, harmonicEmission: emission.get(d.id)!, frequency: out ? runtime.drives![d.id].frequency : 0, outputVoltage: out ? cabs(out.voltage) * Math.sqrt(3) : 0, outputCurrent: out ? cabs(out.current) : 0, outputCurrentPhasor: out?.current ?? [0, 0] },
        };
      }
      continue;
    }
    const transformer = members.find(c => c.kind === "transformer");
    if (transformer) {
      if (sources.length) throw Error(`${transformer.name}: transformer requires AC; DC excitation and saturation are unsupported.`);
      for (const n of ns) voltages[n] = 0;
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
    for (const c of members.filter((c) => !isSource(c) && c.kind !== "vfd" && c.kind !== "capacitor" && !(c.kind === "inductor" && stateOf(c) !== undefined))) {
      // Steady DC (no engine state): an inductor is its winding resistance.
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
    // Storage elements. Capacitors: insulation leakage across the terminals and, with engine state, a charged
    // dielectric behind its ESR. Inductors with engine state: their winding current, with a breakdown path across
    // the terminals that carries an interrupted current (the switching arc). Both are stamped at their step averages.
    const conduct = (c: Component, g: number) => { const p = node(c.id, "a"), q = node(c.id, end(c)); stamp(p, p, g); stamp(q, q, g); stamp(p, q, -g); stamp(q, p, -g); };
    for (const c of members.filter((c) => c.kind === "capacitor")) conduct(c, 1 / CAPACITOR_LEAKAGE);
    const storage = members.filter((c) => stateOf(c) !== undefined), h = Math.max(0, runtime.devices?.h ?? 0);
    if (storage.length > MAX_STORAGE) throw Error(`More than ${MAX_STORAGE} charged capacitors and inductors in one DC network. Split the circuit.`);
    for (const c of storage) if (c.kind === "inductor") conduct(c, 1 / INDUCTOR_BREAKDOWN);
    const initial = new Map(storage.map((c) => [c.id, stateOf(c)!])), mean = new Map(initial);
    const ports = (c: Component) => [indices.get(node(c.id, "a")), indices.get(node(c.id, "b"))] as const;
    const across = (x: number[], c: Component) => {
      const [pi, qi] = ports(c);
      return (pi !== undefined ? x[pi] : 0) - (qi !== undefined ? x[qi] : 0);
    };
    // Dielectric ESR conductances are state-independent; the storage values enter the right-hand side only.
    const held = a.map((row) => [...row]);
    for (const c of storage) if (c.kind === "capacitor") {
      const g = 1 / resistanceOf(c), [pi, qi] = ports(c);
      if (pi !== undefined) { held[pi][pi] += g; if (qi !== undefined) held[pi][qi] -= g; }
      if (qi !== undefined) { held[qi][qi] += g; if (pi !== undefined) held[qi][pi] -= g; }
    }
    /** Right-hand-side terms of storage elements at the given values (a dielectric's Norton current, an inductor's current). */
    const storageTerms = (rhs: number[], values: Map<string, number>, elements = storage) => {
      for (const c of elements) {
        const [pi, qi] = ports(c), value = values.get(c.id)!, j = c.kind === "capacitor" ? value / resistanceOf(c) : -value;
        if (pi !== undefined) rhs[pi] += j;
        if (qi !== undefined) rhs[qi] -= j;
      }
      return rhs;
    };
    // Branch variable k is the current *into* terminal a (negative while delivering).
    // CV row: Va − Vb − Rᵢ·I = Vset. CC row: I = −limit·direction.
    // CV/CC crossover is an active-set iteration, as in a regulated laboratory supply.
    const fixed: (number | null)[] = sources.map((s) => {
      if (shorted(s) && sourceLimit(s) < Infinity) return -sourceLimit(s);
      const model = runtime.sourceModels?.[s.id];
      // Parallel unidirectional converter outputs may initially request identical ideal CV
      // rows. Start at their physical delivery bounds; the active set restores CV where
      // compliance permits it. Unbounded ideal sources remain errors, not regularized rows.
      if (model && model.lower === model.upper) return model.lower;
      return model?.resistance === 0 && model.upper === 0 && Number.isFinite(model.lower) ? model.lower : null;
    });
    /** Source rows of the matrix for the present CV/CC state; nodes no element stamps are pinned to 0 V. */
    const assembleMatrix = (a: number[][]) => {
      const am = a.map((row) => [...row]);
      sources.forEach((s, i) => {
        const k = unknown.length + i, p = indices.get(node(s.id, "a")), q = indices.get(node(s.id, "b"));
        if (p !== undefined) am[p][k] += 1;
        if (q !== undefined) am[q][k] -= 1;
        if (fixed[i] !== null) { am[k][k] = 1; return; }
        if (p !== undefined) am[k][p] += 1;
        if (q !== undefined) am[k][q] -= 1;
        am[k][k] -= runtime.sourceModels?.[s.id]?.resistance ?? prop(s, "internalResistance");
      });
      for (let i = 0; i < unknown.length; i++) if (am[i].every((v) => v === 0)) am[i][i] = 1;
      return am;
    };
    /** Source rows of the right-hand side: the set current, or the EMF (three-phase: the per-phase V_LL/√3). */
    const assembleRhs = (b: number[]) => {
      const bm = [...b];
      sources.forEach((s, i) => (bm[unknown.length + i] = fixed[i] !== null ? fixed[i]! : runtime.sourceModels?.[s.id]?.voltage ?? (s.kind === "source3" ? prop(s, "lineVoltage") / Math.sqrt(3) : prop(s, "voltage"))));
      return bm;
    };
    const regulate = (a: number[][], b: number[]) => {
      let x: number[] = [], am: number[][] = a, bm: number[] = b;
      const visited = new Set<string>();
      for (let iteration = 0; ; iteration++) {
        const state = JSON.stringify(fixed);
        if (visited.has(state)) throw Error(`DC regulation did not converge: repeated CV/CC state for ${sources.map(s => s.name).join(", ")}.`);
        visited.add(state);
        am = assembleMatrix(a); bm = assembleRhs(b);
        try { x = size ? solveLinear(am, bm) : []; }
        catch (cause) {
          // Parallel current-limited sources can all enter CC during active-set updates, leaving the
          // island voltage undetermined. Restore the compliance row with the least bound violation.
          // This is a pivot of the same physical constraints, never a conductance or energy correction.
          if (!(cause instanceof Error) || !cause.message.startsWith('Singular circuit') || !fixed.some(v => v !== null)) throw cause;
          let best: { index: number; score: number; x: number[]; am: number[][]; bm: number[] } | undefined;
          for (let j = 0; j < sources.length; j++) {
            const model = runtime.sourceModels?.[sources[j].id];
            if (fixed[j] === null || model && model.lower === model.upper) continue;
            const held = fixed[j]; fixed[j] = null;
            try {
              const trialMatrix = assembleMatrix(a), trialRhs = assembleRhs(b), trial = solveLinear(trialMatrix, trialRhs);
              const score = sources.reduce((sum, s, i) => { const m = runtime.sourceModels?.[s.id], limit = sourceLimit(s), current = trial[unknown.length + i]; return sum + Math.max(0, (m?.lower ?? -limit) - current, current - (m?.upper ?? limit)); }, 0);
              if (!best || score < best.score) best = { index: j, score, x: trial, am: trialMatrix, bm: trialRhs };
            } catch { /* This row did not restore rank. */ }
            fixed[j] = held;
          }
          if (!best) throw cause;
          fixed[best.index] = null; x = best.x; am = best.am; bm = best.bm;
        }
        let pivot: { index: number; next: number | null; score: number } | undefined;
        const update = (index: number, next: number | null, score: number) => {
          // Preserve first-pivot ordering for small networks; large parallel banks use the most
          // violated normalized constraint to avoid repeatedly pivoting nearby supplies.
          if (!pivot || (sources.length > 8 && score > pivot.score)) pivot = { index, next, score };
        };
        sources.forEach((s, i) => {
          const limit = sourceLimit(s), current = x[unknown.length + i];
          const model = runtime.sourceModels?.[s.id];
          if (model) {
            if (model.lower === model.upper) return; // A commanded current has no CV compliance row.
            const va = indices.has(node(s.id, "a")) ? x[indices.get(node(s.id, "a"))!] : 0, vb = indices.has(node(s.id, "b")) ? x[indices.get(node(s.id, "b"))!] : 0;
            const emf = va - vb - model.resistance * current, tol = 1e-10 * Math.max(1, model.voltage);
            if (fixed[i] === null && (current < model.lower - 1e-12 || current > model.upper + 1e-12)) { const next = Math.max(model.lower, Math.min(model.upper, current)); update(i, next, Math.abs(current - next) / Math.max(1, Math.abs(next))); }
            else if (fixed[i] !== null && (fixed[i] === model.lower ? emf > model.voltage + tol : emf < model.voltage - tol)) { update(i, null, Math.abs(emf - model.voltage) / Math.max(1, Math.abs(model.voltage))); }
            return;
          }
          if (limit === Infinity) return;
          if (fixed[i] === null && Math.abs(current) > limit * (1 + 1e-12)) {
            const next = Math.sign(current || -1) * limit;
            update(i, next, Math.abs(current - next) / Math.max(1, limit));
          } else if (fixed[i] !== null) {
            const va = indices.has(node(s.id, "a")) ? x[indices.get(node(s.id, "a"))!] : 0,
              vb = indices.has(node(s.id, "b")) ? x[indices.get(node(s.id, "b"))!] : 0;
            const emf = va - vb - prop(s, "internalResistance") * current;
            if (fixed[i]! <= 0 ? emf > prop(s, "voltage") * (1 + 1e-12) + 1e-12 : emf < prop(s, "voltage") * (1 - 1e-12) - 1e-12) {
              update(i, null, Math.abs(emf - prop(s, "voltage")) / Math.max(1, Math.abs(prop(s, "voltage"))));
            }
          }
        });
        if (!pivot) return { x, am, bm };
        fixed[pivot.index] = pivot.next;
        if (iteration >= Math.max(31, 4 * sources.length)) throw Error(`DC regulation did not converge for ${sources.map(s => s.name).join(", ")}; check interacting supplies and current limits.`);
      }
    };
    /**
     * Storage over the interval h. For the present CV/CC state the network is linear in the storage state x
     * (dielectric voltages, inductor currents): C·dv/dt and L·di/dt follow from the network as ẋ = A·x + g. With
     * the start rate ẋ₀ and Φ₁ = ∫₀ʰ e^(As) ds, Φ₂ = ∫₀ʰ∫₀ᵗ e^(As) ds dt (one Van Loan exponential), the step is
     *   x(h) = x₀ + Φ₁·ẋ₀,   x̄ = x₀ + Φ₂·ẋ₀/h,
     * exact for any h: RC and RL transients far shorter than the step, charge exchanged between capacitors and LC
     * ringing included, without numerical ringing. Formed from the start rate, slow leakage modes and modes heading
     * for a huge voltage keep their digits. Each storage element is stamped at its step average, so every
     * step-average voltage and current of the network is exact. Every element current is affine in x, so the
     * state covariance over the step (Lyapunov: A·W + W·Aᵀ = z(h)·z(h)ᵀ − ẋ₀·Zᵀ − Z·ẋ₀ᵀ, z = x − x₀, Z = ∫z) gives
     * each element's exact ∫i² (heat, RMS current for protection) and its start and end currents (peaks). A and g
     * depend only on the CV/CC state, so the result is final once that state repeats.
     */
    /** Branch currents of an element for a solution with the sources off: their linear dependence on the storage state. */
    const linearCurrents = (e: Component, x: number[], values: Map<string, number>): [string, number][] => {
      if (e.kind === "vfd" || e.kind === "inductionMotor" || e.kind === "transformer") return [];
      if (isSource(e)) return [[e.id, x[unknown.length + sources.indexOf(e)]]];
      const p = indices.get(node(e.id, "a")), q = indices.get(node(e.id, end(e))), voltage = (p !== undefined ? x[p] : 0) - (q !== undefined ? x[q] : 0);
      if (e.kind === "motor") return [[e.id, (runtime.motors?.[e.id]?.duty ?? 1) ** 2 * voltage / resistanceOf(e)]];
      if (e.kind === "capacitor") {
        const leak = voltage / CAPACITOR_LEAKAGE, dielectric = values.has(e.id) ? (voltage - values.get(e.id)!) / resistanceOf(e) : 0;
        return [[e.id, leak + dielectric], [`${e.id}#leak`, leak], [`${e.id}#dielectric`, dielectric]];
      }
      if (e.kind === "inductor" && values.has(e.id)) {
        const breakdown = voltage / INDUCTOR_BREAKDOWN, winding = values.get(e.id)!;
        return [[e.id, winding + breakdown], [`${e.id}#winding`, winding], [`${e.id}#breakdown`, breakdown]];
      }
      return [[e.id, voltage / resistanceOf(e)]];
    };
    let step: { final: Map<string, number>; covariance: number[][]; z: number[]; Z: number[]; sensitivity: Map<string, number[]>; interrupted: Set<string> } | undefined;
    const integrate = () => {
      const am = assembleMatrix(held), base = assembleMatrix(a), rhs = assembleRhs(b), n = storage.length;
      // Start rates. A dielectric's current is taken from the rest of the network at its terminal node (no ESR
      // difference of nearly equal voltages), an inductor's from its terminal voltage.
      const x0 = solveLinear(am, storageTerms([...rhs], initial));
      const dielectricCurrent = (c: Component) => {
        const [pi, qi] = ports(c), row = pi ?? qi;
        if (row === undefined) return -initial.get(c.id)! / resistanceOf(c);
        const others = storage.filter((o) => o !== c), coefficients = [...base[row]], injected = storageTerms([...rhs], initial, others)[row];
        for (const o of others) if (o.kind === "capacitor") {
          const [po, qo] = ports(o), g = 1 / resistanceOf(o);
          if (po === row) { coefficients[po] += g; if (qo !== undefined) coefficients[qo] -= g; }
          if (qo === row) { coefficients[qo] += g; if (po !== undefined) coefficients[po] -= g; }
        }
        const net = injected - preciseDot(coefficients, x0);
        return row === pi ? net : -net;
      };
      const rate = storage.map((c) => c.kind === "capacitor" ? dielectricCurrent(c) / prop(c, "capacitance") : (across(x0, c) - resistanceOf(c) * initial.get(c.id)!) / prop(c, "inductance"));
      // Unit responses (sources off): the system matrix A and every element's current per unit of each state.
      const A = storage.map(() => Array(n).fill(0)), sensitivity = new Map<string, number[]>(), interrupted = new Set<string>();
      storage.forEach((c, j) => {
        const unit = new Map(storage.map((o) => [o.id, o === c ? 1 : 0])), x = solveLinear(am, storageTerms(Array(size).fill(0), unit, [c]), true, true);
        storage.forEach((k, i) => (A[i][j] = k.kind === "capacitor"
          ? (across(x, k) - unit.get(k.id)!) / resistanceOf(k) / prop(k, "capacitance")
          : (across(x, k) - resistanceOf(k) * unit.get(k.id)!) / prop(k, "inductance")));
        for (const e of members) for (const [key, current] of linearCurrents(e, x, unit)) (sensitivity.get(key) ?? sensitivity.set(key, Array(n).fill(0)).get(key)!)[j] = current;
        // An inductor whose current finds no path but its own breakdown resistance is being interrupted.
        if (c.kind === "inductor" && -across(x, c) > 0.5 * INDUCTOR_BREAKDOWN) interrupted.add(c.id);
      });
      // Van Loan: exp([[A, I, 0], [0, 0, I], [0, 0, 0]]·h) holds Φ₁ and Φ₂ in its first block row.
      const M = Array.from({ length: 3 * n }, (_, i) => Array.from({ length: 3 * n }, (_, j) =>
        i < n && j < n ? A[i][j] * h : (i < 2 * n && j === i + n) ? h : 0));
      const E = expm(M), apply = (offset: number) => storage.map((_, i) => rate.reduce((sum, r, j) => sum + E[i][offset + j] * r, 0));
      const z = apply(n), Z = apply(2 * n);
      storage.forEach((c, i) => mean.set(c.id, initial.get(c.id)! + Z[i] / h));
      let covariance = storage.map(() => Array(n).fill(0));
      try {
        const W = solveLyapunov(A, storage.map((_, i) => storage.map((_, j) => z[i] * z[j] - rate[i] * Z[j] - Z[i] * rate[j])));
        covariance = W.map((row, i) => row.map((w, j) => w - Z[i] * Z[j] / h));
      } catch {
        // A nearly lossless mode pair (λᵢ + λⱼ ≈ 0) leaves the within-step variance unresolved; averages stay exact.
      }
      step = { final: new Map(storage.map((c, i) => [c.id, initial.get(c.id)! + z[i]])), covariance, z, Z, sensitivity, interrupted };
    };
    let solved: ReturnType<typeof regulate>, integrated: string | undefined;
    for (let pass = 0; ; pass++) {
      solved = regulate(held, storageTerms([...b], mean));
      const state = JSON.stringify(fixed);
      if (!storage.length || h === 0 || state === integrated || pass === 3) break;
      integrate();
      integrated = state;
    }
    const { x, am, bm } = solved;
    // An unsettled CV/CC state after four passes reports what the network carries at the stamped averages.
    const exact = integrated === JSON.stringify(fixed) ? step : undefined;
    for (const c of storage) stored.set(c.id, { initial: initial.get(c.id)!, mean: mean.get(c.id)!, final: exact?.final.get(c.id), h, interrupted: !!exact?.interrupted.has(c.id) && Math.abs(initial.get(c.id)!) > 1e-12 });
    if (exact) for (const [key, b] of exact.sensitivity) {
      const quadratic = b.reduce((sum, bi, i) => sum + bi * b.reduce((inner, bj, j) => inner + exact.covariance[i][j] * bj, 0), 0);
      const dot = (v: number[]) => b.reduce((sum, bi, i) => sum + bi * v[i], 0);
      deviations.set(key, { variance: Math.max(0, quadratic) / h, start: -dot(exact.Z) / h, end: dot(exact.z) - dot(exact.Z) / h });
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
    dissipatedPower = 0,
    storedPower = 0;
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
    const store = stored.get(c.id), deviation = deviations.get(c.id);
    // Storage flow over the step: a dielectric's charge current, or the voltage across an inductance. Exact from the
    // state change; otherwise (paused solve without interval, unsettled regulation) what the network carries.
    const storageRate = !store ? 0 : store.final !== undefined
      ? prop(c, c.kind === "capacitor" ? "capacitance" : "inductance") * (store.final - store.initial) / store.h
      : c.kind === "capacitor" ? (activeVoltage - store.mean) / resistanceOf(c) : activeVoltage - resistanceOf(c) * store.mean;
    const contactCurrent =
      isSource(c)
        ? (sourceI[c.id] ?? 0)
        : active.includes(c) && c.kind !== "inductionMotor" && c.kind !== "vfd" && c.kind !== "transformer"
          ? c.kind === "motor" && runtime.motors?.[c.id]
            ? runtime.motors[c.id].duty * (runtime.motors[c.id].duty * activeVoltage - runtime.motors[c.id].emf) / prop(c, "resistance", 1)
            : c.kind === "capacitor"
              ? activeVoltage / CAPACITOR_LEAKAGE + storageRate
              : c.kind === "inductor" && store
                ? store.mean + activeVoltage / INDUCTOR_BREAKDOWN
                : activeVoltage / resistanceOf(c)
          : 0;
    const current = c.kind === "relay" && end(c) === "nc" ? 0 : contactCurrent;
    const currentNC =
      c.kind === "relay" && end(c) === "nc" ? contactCurrent : 0;
    // Absorbed power over the step. For a branch v = E + R·i the current's within-step variance adds R·var(i) to
    // the product of the averages: the exact ∫v·i dt, so heat is ∫R·i² and protection sees the true RMS.
    const variance = deviation?.variance ?? 0;
    const branchResistance = isSource(c) ? runtime.sourceModels?.[c.id]?.resistance ?? prop(c, "internalResistance")
      : c.kind === "motor" ? prop(c, "resistance", 1) / (runtime.motors?.[c.id]?.duty ?? 1) ** 2 : resistances[c.id] ?? 0;
    const power =
      phases *
      ((isSource(c)
        ? voltage * contactCurrent
        : activeVoltage * contactCurrent) + branchResistance * variance);
    readings[c.id] = {
      voltage,
      current,
      currentNC,
      contactCurrent,
      power,
      voltageValid: valid,
      ...(isSource(c) ? { regulation: regulation[c.id] ?? "cv" } : resistances[c.id] !== undefined ? { resistance: resistances[c.id] } : {}),
      ...(phases === 3 ? { phases: 3 as const } : {}),
      ...(deviation ? { currentVariance: variance, peakCurrent: Math.max(Math.abs(contactCurrent + deviation.start), Math.abs(contactCurrent + deviation.end)) } : {}),
    };
    if (store) {
      // Field energy: ½·C·(v₁² − v₀²) = i·h·(v₀ + i·h/(2C)), or ½·L·(i₁² − i₀²) = v·h·(i₀ + v·h/(2L)). Heat: ESR and
      // leakage (capacitor), winding and breakdown path (inductor), each with its exact ∫R·i².
      const size = prop(c, c.kind === "capacitor" ? "capacitance" : "inductance"), fieldPower = storageRate * (store.initial + storageRate * store.h / (2 * size));
      const part = (key: string, mean: number, resistance: number) => resistance * (mean * mean + (deviations.get(`${c.id}#${key}`)?.variance ?? 0));
      const heatPower = store.final === undefined ? power - fieldPower : c.kind === "capacitor"
        ? part("dielectric", storageRate, resistanceOf(c)) + part("leak", activeVoltage / CAPACITOR_LEAKAGE, CAPACITOR_LEAKAGE)
        : part("winding", store.mean, resistanceOf(c)) + part("breakdown", activeVoltage / INDUCTOR_BREAKDOWN, INDUCTOR_BREAKDOWN);
      Object.assign(readings[c.id], c.kind === "capacitor" ? { chargeCurrent: storageRate } : { inductanceVoltage: storageRate, ...(store.interrupted ? { interrupted: true } : {}) },
        { fieldPower, heatPower, power: fieldPower + heatPower });
      storedPower += fieldPower;
      dissipatedPower += heatPower;
    } else if (c.kind === "capacitor") {
      Object.assign(readings[c.id], { heatPower: power });
      dissipatedPower += power;
    } else if (isSource(c)) sourcePower -= power;
    else dissipatedPower += power;
  }
  // Conductor count is topology (thermal mass of the motor leads), independent of the starter's state.
  for (const [id, lead] of leads) {
    const c = cs.find((x) => x.id === id);
    if (c && perPoleKinds.has(c.kind) && readings[id]) readings[id].conductors = lead.conductors;
  }
  const nodes: Record<string, number> = {},
    nodeIds: Record<string, string> = { ...structure.nodeIds },
    nodeIslands: Record<string, string> = { ...structure.nodeIslands };
  for (const [k, n] of topology.rootEntries) {
    const phasor = phasors[n];
    nodes[k] = phasor ? cabs(phasor) : voltages[n] ?? 0;
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
    storedPower,
    powerResidual: sourcePower - dissipatedPower - storedPower,
    islands: groups.size,
    ...(Object.keys(phasors).length ? { phasors: Object.fromEntries(topology.rootEntries.filter(([, n]) => phasors[n]).map(([k, n]) => [k, phasors[n]])) } : {}),
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
