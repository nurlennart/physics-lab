import { definitions, prop, terminalKey, type Component, type Project } from './model';
import { solveLinear } from './electrical';
import { GRAVITY as G, WATER_CP as CP, WATER_RHO as RHO, unitsSI as U } from './units';
import { viscosityK, inventoryVolume } from './water';

/** vessel: wall heat capacity (J/K) lumped at the water temperature; it does not flow. */
export interface TankState { volume: number; mass: number; temperature: number; vessel?: number }
export interface HydraulicReading {
  flow: number; pressure: number; inletPressure: number; differentialPressure: number;
  velocity: number; reynolds: number; frictionFactor: number;
  /** Net delivered hydraulic power Δp·Q across the component (pump: outlet minus inlet pressure rise × flow), W. */
  hydraulicPower: number;
  /** Pump only: gross impeller power ρ·g·H_imp·Q before the pump's internal flow resistance, W. */
  impellerPower: number;
  /** Pump only: shaft input power, W. */
  shaftPower: number;
  /** Pump only: windage/disc/bearing loss k·ω³, W. */
  mechanicalLoss: number;
  /** Pump only: impeller power / (shaft − mechanical loss); null when no impeller power is produced. */
  hydraulicEfficiency: number | null;
  /** Pump only: overall efficiency = net hydraulic power / shaft power; null when undefined (no shaft input, or passive restriction). */
  efficiency: number | null;
  /** Dynamic viscosity used for the friction calculation (pipes), Pa·s. */
  viscosity?: number;
  /** Tanks: water leaving over the rim (m³/s), routed or spilled. */
  overflow?: number;
  /** Tanks: surcharge h of the free surface above the rim (m). */
  surcharge?: number;
  torque: number; temperature: number; temperatureValid?: boolean;
  /** Heat-exchanger duty (W), positive from the hot (A) stream into the cold (B) stream. */
  duty?: number;
  /** Net positive suction head available at a pump inlet (m). */
  npshAvailable?: number;
}
export interface HydraulicResult {
  readings: Record<string, HydraulicReading>; potentials: Record<string, number>;
  residual: number; pressureResidual: number; iterations: number; converged: boolean; diagnostics: string[];
  branches: { id: string; component: string; stream?: "hot" | "cold"; from: string; to: string; flow: number; loss: number; gain: number }[];
  tankNodes: Record<string, string>; terminalNodes: Record<string, string>;
  /** Mixed node temperatures (K) from the last enthalpy transport; viscosity input of the next solve. */
  nodeTemperatures: Record<string, number>;
  /** Weir overflow per tank: flow (m³/s), whether it is routed into the network, and the receiving node. */
  weir: Record<string, { flow: number; routed: boolean; node: string }>;
}
/** Sharp-crested weir discharge coefficient (rectangular crest, free overfall). */
export const WEIR_CD = 0.62;
/** Free-overfall weir discharge Q = ⅔·C_d·√(2g)·L·h^1.5 for surcharge h above the rim (m³/s). */
export const weirFlow = (length: number, surcharge: number) => surcharge > 0 ? (2 / 3) * WEIR_CD * Math.sqrt(2 * G) * length * surcharge ** 1.5 : 0;
/** Surcharge of a tank's free surface above its rim (m). */
export const tankSurcharge = (c: Component, volume: number) => Math.max(0, volume - U.litersToM3(prop(c, 'capacity'))) / prop(c, 'surfaceArea');
export const emptyHydraulics = (): HydraulicResult => ({ readings: {}, potentials: {}, residual: 0, pressureResidual: 0, iterations: 0, converged: true, diagnostics: [], branches: [], tankNodes: {}, terminalNodes: {}, nodeTemperatures: {}, weir: {} });
export const branchKinds = new Set(['pipe', 'valve', 'checkValve', 'actuatedValve', 'pump', 'pressureReducingValve', 'heatExchanger']);
/** Positioned valves: their opening is simulation state (actuator / regulator travel). */
export const positionedValves = new Set(['actuatedValve', 'pressureReducingValve']);
const valveKinds = new Set(['valve', 'actuatedValve', 'checkValve', 'pressureReducingValve']);
/** Parse "q:h; q:h" (L/min : m at rated speed) into SI points, or an error message. */
export function parsePumpPoints(text: string): { q: number; h: number }[] | string {
  const parts = text.split(/[;\n]/).map((x) => x.trim()).filter(Boolean);
  if (parts.length < 2) return "Enter at least two flow:head points, e.g. 0:8; 30:7; 60:4; 75:0.";
  const pts = parts.map((x) => x.split(/[:=]/).map((v) => Number(v.trim())));
  if (pts.some((p) => p.length !== 2 || !p.every(Number.isFinite))) return "Each point must be flow:head (L/min:m).";
  if (pts[0][0] !== 0) return "The first point must be at zero flow (shutoff head).";
  if (pts[0][1] <= 0) return "Shutoff head must be positive.";
  for (let i = 1; i < pts.length; i++) {
    if (pts[i][0] <= pts[i - 1][0]) return "Flows must increase from point to point.";
    if (pts[i][1] > pts[i - 1][1]) return "Head must not rise with flow (stable curve required).";
  }
  if (pts.at(-1)![1] >= pts.at(-2)![1]) return "The last segment must fall so the curve can be continued.";
  return pts.map(([q, h]) => ({ q: q / 60000, h }));
}
const pointCache = new Map<string, { q: number; h: number }[]>();
function pumpPoints(c: Component) {
  const text = typeof c.props.curvePoints === 'string' ? c.props.curvePoints.trim() : '';
  if (!text) return null;
  let pts = pointCache.get(text);
  if (!pts) { const parsed = parsePumpPoints(text); if (typeof parsed === 'string') return null; pts = parsed; pointCache.set(text, pts); }
  return pts;
}
/** Head at rated speed from data points; beyond the last point a falling quadratic continuation (finite resistance at rest). */
function pointHead(pts: { q: number; h: number }[], q: number) {
  if (q <= 0) return pts[0].h;
  for (let i = 1; i < pts.length; i++) if (q <= pts[i].q) return pts[i - 1].h + (pts[i].h - pts[i - 1].h) * (q - pts[i - 1].q) / (pts[i].q - pts[i - 1].q);
  const a = pts.at(-2)!, b = pts.at(-1)!, slope = (a.h - b.h) / (b.q - a.q), dq = q - b.q;
  return b.h - slope * dq - slope / b.q * dq * dq;
}
/** Signed pump head (m) with affinity scaling H(q, ω) = r²·H(q/r); negative = passive restriction. */
export function pumpHead(c: Component, omega: number, q: number) {
  const ratio = Math.max(0, omega) / prop(c, 'ratedSpeed'), pts = pumpPoints(c);
  if (!pts) return prop(c, 'shutoffHead') * (ratio * ratio - 0.5 * (q / prop(c, 'ratedFlow')) ** 2);
  if (ratio < 1e-6) {
    // Stopped impeller: the quadratic continuation r²·k·(q/r)² = k·q² is a finite resistance.
    const a = pts.at(-2)!, b = pts.at(-1)!, k = (a.h - b.h) / (b.q - a.q) / b.q;
    return -k * q * Math.abs(q);
  }
  return ratio * ratio * pointHead(pts, q / ratio);
}
/** Saturated vapour pressure of water (Buck), Pa. */
export const vaporPressure = (celsius: number) => 611.21 * Math.exp((18.678 - celsius / 234.5) * (celsius / (257.14 + celsius)));
export function frictionFactor(re: number, relativeRoughness: number) {
  if (re <= 0) return 0;
  const laminar = 64 / re;
  const turbulent = 0.25 / Math.log10(relativeRoughness / 3.7 + 5.74 / Math.max(re, 2300) ** 0.9) ** 2;
  if (re <= 2300) return laminar;
  if (re >= 4000) return turbulent;
  // Continuous linear blend through the uncertain transitional regime.
  const t = (re - 2300) / 1700;
  return (1 - t) * laminar + t * turbulent;
}
/**
 * Darcy–Weisbach pipe loss with temperature-dependent viscosity. `temperatures` (K)
 * are the local water temperatures of equal-length segments (pipe inventory cells,
 * or the single upstream temperature of a zero-volume pipe). Each segment uses its
 * own Reynolds number: Hagen–Poiseuille below Re 2300, Swamee–Jain above 4000 and
 * a linear friction-factor blend between.
 */
export function pipeLoss(c: Component, q: number, temperatures: readonly number[] = [293.15]) {
  const d = prop(c, 'diameter'), area = Math.PI * d * d / 4, v = q / area, n = temperatures.length, segment = prop(c, 'length') / n;
  const relativeRoughness = prop(c, 'roughness') / d;
  let dp = 0, reynolds = 0, friction = 0, viscosity = 0;
  // Segments at the same temperature (to 0.01 K, the property-memo resolution) share one evaluation.
  const counts = new Map<number, number>();
  for (const kelvin of temperatures) { const key = Math.round(kelvin * 100); counts.set(key, (counts.get(key) ?? 0) + 1); }
  for (const [key, count] of counts) {
    const mu = viscosityK(key / 100), re = RHO * Math.abs(v) * d / mu, f = frictionFactor(re, relativeRoughness), length = segment * count;
    // Evaluate the laminar limit directly, including exactly zero flow.
    dp += re <= 2300 ? 128 * mu * length * q / (Math.PI * d ** 4) : f * length / d * RHO * v * Math.abs(v) / 2;
    reynolds += re * count / n; friction += f * count / n; viscosity += mu * count / n;
  }
  return { dp, velocity: v, reynolds, frictionFactor: friction, viscosity };
}
/** Linear internal flow resistance of the pump (Pa per m³/s); also regularises the Newton solve. */
export const PUMP_INTERNAL_RESISTANCE = 1e5;
/** Small linear resistance of valve-type branches (Pa per m³/s) that keeps their flow inverse smooth at Q = 0. */
export const VALVE_REGULARIZATION = 1e5;
/**
 * Pump operating point. Shared by the solver, live readings, the Inspector rating
 * and every export so all report the same quantities:
 *   impeller power  P_imp = ρ·g·H_imp(Q, ω)·Q          (H_imp ≥ 0, affinity-scaled curve)
 *   net hydraulic   P_net = Δp_rise·Q = P_imp − R_int·Q² (R_int internal resistance)
 *   mechanical loss P_mech = k·ω³                       (windage, disc friction, bearings)
 *   shaft input     P_shaft = P_imp/η_h + P_mech         (η_h internal hydraulic efficiency)
 *   overall η       = P_net / P_shaft
 * Losses P_shaft − P_net heat the pumped water when it flows; at zero flow they leave as heat
 * to ambient (zero-volume pump, no deadhead temperature rise).
 */
export function pumpCurve(c: Component, omega: number, q: number) {
  const ratio = Math.max(0, omega) / prop(c, 'ratedSpeed');
  const signedHead = pumpHead(c, omega, q), head = Math.max(0, signedHead);
  const reducedFlow = ratio > 1e-8 ? q / (prop(c, 'ratedFlow') * ratio) : 0;
  const curveEfficiency = Math.max(0.15, prop(c, 'efficiency') * (1 - 0.35 * (reducedFlow - 1) ** 2));
  const impellerPower = RHO * G * head * Math.max(0, q);
  const mechanicalLoss = prop(c, 'mechanicalDrag') * Math.max(0, omega) ** 3;
  const shaftPower = impellerPower / curveEfficiency + mechanicalLoss;
  const pressureRise = RHO * G * signedHead - PUMP_INTERNAL_RESISTANCE * q;
  const netHydraulicPower = pressureRise * Math.max(0, q);
  return {
    head, pressureRise, reducedFlow, impellerPower, mechanicalLoss, shaftPower, netHydraulicPower,
    hydraulicEfficiency: impellerPower > 0 ? curveEfficiency : null,
    efficiency: shaftPower > 1e-9 && netHydraulicPower >= 0 ? netHydraulicPower / shaftPower : null,
    torque: omega > 1e-8 ? shaftPower / omega : 0,
  };
}
/** Nominal pump figures at rated speed and rated flow, from the same model as live operation. */
export function pumpRatingReadouts(c: Component) {
  const omega = prop(c, 'ratedSpeed'), q = prop(c, 'ratedFlow'), op = pumpCurve(c, omega, q);
  const pct = (v: number | null) => (v === null ? NaN : v * 100);
  return [
    { label: "Rated speed", value: omega * 30 / Math.PI, unit: "RPM" },
    { label: "Impeller head at rated flow", value: op.head, unit: "m" },
    { label: "Impeller power at rating", value: op.impellerPower, unit: "W", note: "ρ·g·H_imp·Q" },
    { label: "Net hydraulic power at rating", value: op.netHydraulicPower, unit: "W", note: "Δp·Q after internal resistance" },
    { label: "Mechanical loss at rated speed", value: op.mechanicalLoss, unit: "W", note: "k·ω³" },
    { label: "Shaft power at rating", value: op.shaftPower, unit: "W", note: "P_imp/η_h + k·ω³" },
    { label: "Internal hydraulic efficiency", value: pct(op.hydraulicEfficiency), unit: "%" },
    { label: "Overall efficiency at rating", value: pct(op.efficiency), unit: "%", note: "P_net / P_shaft" },
  ];
}
class Union {
  p = new Map<string, string>();
  find(x: string): string { if (!this.p.has(x)) this.p.set(x, x); const y = this.p.get(x)!; if (x !== y) this.p.set(x, this.find(y)); return this.p.get(x)!; }
  join(a: string, b: string) { this.p.set(this.find(a), this.find(b)); }
}
type Branch = { id: string; stream?: 'hot' | 'cold'; c: Component; a: string; b: string };
interface HydraulicTopology {
  cs: Component[]; tanks: Component[]; terminalNodes: Record<string, string>;
  nodes: string[]; branches: Branch[]; group: Map<string, string>;
}
/**
 * Network topology depends only on the (immutable) project object and the set of disconnected
 * wires, so it is built once and reused by every solve until the project changes.
 */
const topologyCache = new WeakMap<Project, Map<string, HydraulicTopology>>();
function hydraulicTopology(project: Project, disconnected: Set<string>): HydraulicTopology {
  const key = [...disconnected].sort().join(','), byProject = topologyCache.get(project) ?? new Map<string, HydraulicTopology>();
  topologyCache.set(project, byProject);
  const cached = byProject.get(key);
  if (cached) return cached;
  const uf = new Union();
  const cs = project.components.filter(c => definitions[c.kind].ports.some(p => p.domain === 'hydraulic'));
  for (const c of cs) for (const p of definitions[c.kind].ports.filter(p => p.domain === 'hydraulic')) uf.find(`${c.id}:${p.id}`);
  for (const w of project.connections.filter(w => w.domain === 'hydraulic' && !disconnected.has(w.id))) uf.join(terminalKey(w.from), terminalKey(w.to));
  const terminalNodes: Record<string, string> = {};
  for (const k of uf.p.keys()) terminalNodes[k] = uf.find(k);
  const node = (c: Component, port: string) => terminalNodes[`${c.id}:${port}`];
  const branches = cs.filter(c => branchKinds.has(c.kind)).flatMap((c): Branch[] => c.kind === 'heatExchanger'
    ? [{ id: `${c.id}#hot`, stream: 'hot', c, a: node(c, 'hotIn'), b: node(c, 'hotOut') }, { id: `${c.id}#cold`, stream: 'cold', c, a: node(c, 'coldIn'), b: node(c, 'coldOut') }]
    : [{ id: c.id, c, a: node(c, 'inlet'), b: node(c, 'outlet') }]);
  const nodes = [...new Set(Object.values(terminalNodes))], groups = new Union();
  for (const n of nodes) groups.find(n);
  for (const b of branches) groups.join(b.a, b.b);
  const group = new Map(nodes.map(n => [n, groups.find(n)]));
  const topology = { cs, tanks: cs.filter(c => c.kind === 'tank'), terminalNodes, nodes, branches, group };
  byProject.set(key, topology);
  return topology;
}
export function solveHydraulic(project: Project, tanks: Record<string, TankState>, speeds: Record<string, number> = {}, positions: Record<string, number> = {}, faults: Record<string, string> = {}, disconnected = new Set<string>(), previous?: HydraulicResult, cells: Record<string, number[]> = {}): HydraulicResult {
  const result = emptyHydraulics();
  // Node temperatures persist until the next enthalpy transport replaces them.
  result.nodeTemperatures = { ...previous?.nodeTemperatures };
  const topology = hydraulicTopology(project, disconnected), { cs, nodes, branches } = topology;
  if (!cs.length) return result;
  const node = (c: Component, port: string) => topology.terminalNodes[`${c.id}:${port}`];
  const groups = { find: (n: string) => topology.group.get(n) ?? n };
  result.terminalNodes = topology.terminalNodes;
  const boundaries: Record<string, number> = {}, boundaryTanks: Record<string, Component[]> = {};
  for (const c of topology.tanks) {
    const n = node(c, 'fluid'), t = tanks[c.id];
    if (!t) throw Error(`${c.name}: missing fluid state.`);
    // Bottom pressure g·m/A is exact for any density; the elevation term uses the reference density.
    const pressure = RHO * G * prop(c, 'elevation') + G * t.mass / prop(c, 'surfaceArea');
    if (boundaries[n] !== undefined) throw Error('Two finite tanks cannot share an ideal fluid node. Insert a physical pipe.');
    boundaries[n] = pressure / 1000;
    boundaryTanks[n] = [c]; result.tankNodes[c.id] = n;
  }
  // Weir overflow: the surcharge above the rim drives a free-overfall discharge. It is injected into
  // the overflow port's network when that network reaches a finite tank; otherwise it leaves the
  // system (transport exports its mass, enthalpy and potential energy).
  const weirInjection = new Map<string, number>();
  if (branches.length > 120) throw Error('Hydraulic network exceeds 120 branches.');
  const primed = new Set(Object.keys(boundaries).map(n => groups.find(n)));
  for (const n of nodes) if (!primed.has(groups.find(n))) boundaries[n] = 0;
  for (const c of topology.tanks) {
    const flow = weirFlow(prop(c, 'weirLength'), tankSurcharge(c, tanks[c.id].volume)), port = node(c, 'overflow');
    const routed = flow > 0 && primed.has(groups.find(port)) && Object.keys(boundaryTanks).every(n => n !== port);
    result.weir[c.id] = { flow, routed, node: port };
    if (routed) weirInjection.set(port, (weirInjection.get(port) ?? 0) + flow);
  }
  const unknown = nodes.filter(n => boundaries[n] === undefined), indices = new Map(unknown.map((n, i) => [n, i]));
  if (unknown.length > 200) throw Error('Hydraulic network exceeds 200 pressure nodes.');
  const p: Record<string, number> = { ...boundaries };
  for (const n of unknown) p[n] = (previous?.potentials[n] ?? 0) / 1000;
  // An empty tank cannot supply outflow. A full vented tank does NOT block inflow: it spills over
  // its rim (transport removes the excess), so no implicit shut-off valve exists.
  const blocked = (n: string, out: boolean) => out && (boundaryTanks[n] ?? []).some(c => tanks[c.id].mass <= 1e-9);
  // Local water temperature for viscosity: pipe inventory cells, else the upstream node of the
  // previous transport (one-substep lag; avoids a nested temperature–flow iteration).
  const tankAt = new Map(Object.entries(boundaryTanks).map(([n, [c]]) => [n, tanks[c.id].temperature]));
  const nodeTemperature = (n: string) => tankAt.get(n) ?? previous?.nodeTemperatures?.[n] ?? 293.15;
  const pipeTemperatures = (br: Branch, q: number) => (pipeCells(br.c) && cells[br.c.id]?.length ? cells[br.c.id] : [nodeTemperature(q >= 0 ? br.a : br.b)]);
  /**
   * Valve-type branches (valves, regulators, heat-exchanger streams): two-K loss (Hooper 1981),
   * K(Re) = K₁/Re + K∞ with K∞ the turbulent coefficient. The K₁/Re part equals K₁·μ·v/(2d), i.e. a
   * term linear in flow, evaluated with the viscosity of the upstream water for each direction.
   * Both parts scale with 1/opening². A stuck-open fault means full bore and no cracking pressure.
   */
  const valveTerms = (br: Branch, forward: boolean) => {
    const c = br.c, fault = faults[c.id], stuckOpen = fault === 'stuckOpen';
    const opening = c.kind === 'heatExchanger' || stuckOpen ? 100 : positions[c.id] ?? prop(c, 'opening');
    const fraction = Math.max(0.00001, opening / 100), d = prop(c, 'diameter'), area = Math.PI * d * d / 4;
    const mu = viscosityK(nodeTemperature(forward ? br.a : br.b));
    return {
      linear: VALVE_REGULARIZATION + prop(c, 'laminarK') * mu / (2 * d * area) / fraction ** 2,
      quadratic: prop(c, 'lossCoefficient') / fraction ** 2 * RHO / (2 * area ** 2),
      offset: c.kind === 'checkValve' && !stuckOpen ? prop(c, 'crackingPressure') : 0,
      mu,
    };
  };
  const loss = (br: Branch, q: number) => {
    const c = br.c;
    if (c.kind === 'pipe') return pipeLoss(c, q, pipeTemperatures(br, q)).dp;
    if (c.kind === 'pump') {
      // Descending head curve continued as passive quadratic resistance past zero head.
      return PUMP_INTERNAL_RESISTANCE * q - RHO * G * pumpHead(c, Math.max(0, speeds[c.id] ?? 0), q);
    }
    const t = valveTerms(br, q >= 0);
    return t.linear * q + t.quadratic * q * Math.abs(q) + t.offset;
  };
  let regularize = false;
  const previousFlow = new Map((previous?.branches ?? []).map(b => [b.id, b.flow]));
  const inverse = (b: typeof branches[number], dp: number) => {
    const { c, a, b: to } = b;
    if (!primed.has(groups.find(a))) return { q: 0, derivative: 0 };
    const fault = faults[c.id], opening = c.kind === 'heatExchanger' ? 100 : positions[c.id] ?? prop(c, 'opening');
    if (valveKinds.has(c.kind) && (fault === 'stuckClosed' || (opening === 0 && fault !== 'stuckOpen'))) return { q: 0, derivative: 0 };
    const actualLoss = (q: number) => loss(b, q);
    const oneWay = c.kind === 'checkValve' || c.kind === 'pump' || c.kind === 'pressureReducingValve';
    const allowPositive = !blocked(a, true) && !blocked(to, false), allowNegative = !oneWay && !blocked(to, true) && !blocked(a, false);
    const atZero = actualLoss(0);
    const closedForm = c.kind !== 'pipe' && !(c.kind === 'pump' && pumpPoints(c));
    const difference = dp - atZero, magnitude = Math.abs(difference);
    // Closed form of linear·q + quadratic·q|q| = difference (pump curve or two-K valve).
    const terms = !closedForm ? { linear: 1e5, quadratic: 0 } : c.kind === 'pump'
      ? { linear: PUMP_INTERNAL_RESISTANCE, quadratic: RHO * G * prop(c, 'shutoffHead') * 0.5 / prop(c, 'ratedFlow') ** 2 }
      : valveTerms(b, difference >= 0);
    const linear = terms.linear, quadratic = terms.quadratic;
    const magnitudeFlow = 2 * magnitude / (linear + Math.sqrt(linear * linear + 4 * quadratic * magnitude));
    // Closed direction: zero flow. The Jacobian keeps the branch's own slope at this |Δp|
    // (generalized Jacobian) so Newton can move node pressures back across the threshold.
    if ((dp <= atZero && !allowNegative) || (dp >= atZero && !allowPositive))
      return { q: 0, derivative: !regularize ? 0 : closedForm ? 1 / (linear + 2 * quadratic * magnitudeFlow) : 1e-5 };
    if (closedForm) {
      const q = Math.sign(difference) * magnitudeFlow;
      return { q, derivative: 1 / (linear + 2 * quadratic * Math.abs(q)) };
    }
    // Monotone loss(q) = dp: bracket by doubling, then Illinois (modified regula falsi) — superlinear,
    // always bracketed, ~10 loss evaluations instead of ~90 for bisection at the same tolerance.
    let lo = 0, hi = 0, flo = actualLoss(0) - dp, fhi = flo;
    // Warm start: the previous solution's flow for this branch usually brackets within a few percent.
    const guess = previousFlow.get(b.id) ?? 0;
    if (flo > 0) {
      if (guess < 0) { const f = actualLoss(guess * 0.99) - dp; if (f >= 0) { hi = guess * 0.99; fhi = f; } }
      lo = guess < 0 ? guess * 1.01 : -0.001;
      for (let i = 0; i < 60 && (flo = actualLoss(lo) - dp) > 0; i++) { hi = lo; fhi = flo; lo *= guess < 0 && i < 4 ? 1.5 : 2; }
    } else {
      if (guess > 0) { const f = actualLoss(guess * 0.99) - dp; if (f <= 0) { lo = guess * 0.99; flo = f; } }
      hi = guess > 0 ? guess * 1.01 : 0.001;
      for (let i = 0; i < 60 && (fhi = actualLoss(hi) - dp) < 0; i++) { lo = hi; flo = fhi; hi *= guess > 0 && i < 4 ? 1.5 : 2; }
    }
    let q = flo === 0 ? lo : fhi === 0 ? hi : 0, side = 0;
    for (let i = 0; i < 200 && flo !== 0 && fhi !== 0; i++) {
      q = (lo * fhi - hi * flo) / (fhi - flo);
      if (!(q > lo && q < hi)) q = (lo + hi) / 2;
      const fq = actualLoss(q) - dp;
      if (fq === 0) break;
      if (fq > 0) { hi = q; fhi = fq; if (side === 1) flo /= 2; side = 1; }
      else { lo = q; flo = fq; if (side === -1) fhi /= 2; side = -1; }
      if (hi - lo <= 1e-16 + 1e-13 * Math.max(Math.abs(lo), Math.abs(hi))) break;
    }
    const eps = Math.max(1e-10, Math.abs(q) * 1e-4);
    const derivative = 1 / Math.max(1e-9, (actualLoss(q + eps) - actualLoss(q - eps)) / (2 * eps));
    return { q, derivative };
  };
  const evaluate = (jacobian = false) => {
    const residual = Array(unknown.length).fill(0), matrix = Array.from({ length: unknown.length }, () => Array(unknown.length).fill(0));
    const flows = branches.map(b => {
      const v = inverse(b, (p[b.a] - p[b.b]) * 1000), i = indices.get(b.a), j = indices.get(b.b);
      // residual in L/s and pressures in kPa.
      if (i !== undefined) residual[i] += v.q * 1000;
      if (j !== undefined) residual[j] -= v.q * 1000;
      if (jacobian) {
        const d = v.derivative * 1e6;
        if (i !== undefined) { matrix[i][i] += d; if (j !== undefined) matrix[i][j] -= d; }
        if (j !== undefined) { matrix[j][j] += d; if (i !== undefined) matrix[j][i] -= d; }
      }
      return v.q;
    });
    for (const [n, flow] of weirInjection) { const i = indices.get(n); if (i !== undefined) residual[i] -= flow * 1000; }
    return { residual, matrix, flows, norm: Math.max(0, ...residual.map(Math.abs)) };
  };
  // A weir injection into a node that carried no flow in the previous solution has an arbitrary
  // (unconstrained) pressure. Seed it just above its highest neighbour so the spill can leave
  // downstream; Newton cannot cross the flat zero-flow region of blocked branches by itself.
  for (const [n] of weirInjection) {
    if (!indices.has(n)) continue;
    const stagnant = !previous || previous.branches.every(b => (b.from !== n && b.to !== n) || Math.abs(b.flow) < 1e-12);
    if (!stagnant) continue;
    const neighbours = branches.filter(b => b.a === n || b.b === n).map(b => p[b.a === n ? b.b : b.a]).filter(Number.isFinite);
    if (neighbours.length) p[n] = Math.max(...neighbours) + 1e-3;
  }
  // Damped Newton with the exact Jacobian. When its line search stalls on a closed one-way
  // branch (zero slope), the iteration is retried with that branch's generalized slope.
  // The accepted line-search point is evaluated with its Jacobian and reused as the next iterate.
  regularize = false;
  let current = evaluate(true), currentVariant = false;
  for (let iteration = 0; iteration < 100; iteration++) {
    result.iterations = iteration + 1;
    if (current.norm < 1e-10) break;
    let improved = false;
    for (const variant of [false, true]) {
      regularize = variant;
      const e = variant === currentVariant ? current : evaluate(true);
      for (let i = 0; i < unknown.length; i++) e.matrix[i][i] += 1e-9;
      const delta = solveLinear(e.matrix, e.residual.map(v => -v)), before = unknown.map(n => p[n]);
      for (let k = 0; k < 24 && !improved; k++) {
        const alpha = 2 ** -k;
        unknown.forEach((n, i) => p[n] = before[i] + alpha * delta[i]);
        // Sufficient decrease (Armijo on the max-norm): a full step that merely mirrors a
        // √Δp turbulent branch around its solution is rejected in favour of the half step.
        regularize = false;
        const trial = evaluate(true);
        regularize = variant;
        if (trial.norm < (1 - 0.5 * alpha) * e.norm || (k > 8 && trial.norm < e.norm)) { improved = true; current = trial; currentVariant = false; }
      }
      if (improved) break;
      unknown.forEach((n, i) => p[n] = before[i]);
    }
    if (!improved) break;
  }
  regularize = false;
  const final = evaluate(); result.residual = final.norm / 1000; result.converged = result.residual < 1e-12;
  if (!result.converged) throw Error(`Hydraulic solve failed: continuity residual ${result.residual.toExponential(3)} m³/s after ${result.iterations} iterations.`);
  for (const n of nodes) result.potentials[n] = p[n] * 1000;
  branches.forEach((b, i) => {
    const { c, a, b: to } = b, q = final.flows[i], dp = (p[a] - p[to]) * 1000;
    const opening = c.kind === 'heatExchanger' ? 100 : positions[c.id] ?? prop(c, 'opening');
    const pipe = c.kind === 'pipe' ? pipeLoss(c, q, pipeTemperatures(b, q)) : (() => {
      const velocity = q / (Math.PI * prop(c, 'diameter', 0.025) ** 2 / 4);
      if (c.kind === 'pump') return { velocity, reynolds: 0, frictionFactor: 0 };
      const mu = valveTerms(b, q >= 0).mu;
      return { velocity, reynolds: RHO * Math.abs(velocity) * prop(c, 'diameter') / mu, frictionFactor: 0, viscosity: mu };
    })();
    const curve = c.kind === 'pump' ? pumpCurve(c, speeds[c.id] ?? 0, q) : null;
    const gain = curve ? RHO * G * curve.head : 0;
    if (Math.abs(q) > 1e-14) {
      const modeled = loss(b, q);
      result.pressureResidual = Math.max(result.pressureResidual, Math.abs(dp - modeled));
    }
    // Pump's explicit small internal resistance is hydraulic dissipation too.
    result.branches.push({ id: b.id, component: c.id, stream: b.stream, from: a, to, flow: q, loss: Math.max(0, dp * q + gain * q), gain });
    result.readings[b.id] = {
      flow: q, pressure: p[to] * 1000 - RHO * G * prop(c, 'elevation'), inletPressure: p[a] * 1000 - RHO * G * prop(c, 'elevation'), differentialPressure: dp, ...pipe,
      hydraulicPower: curve ? curve.netHydraulicPower : 0, impellerPower: curve?.impellerPower ?? 0, shaftPower: curve?.shaftPower ?? 0, mechanicalLoss: curve?.mechanicalLoss ?? 0,
      hydraulicEfficiency: curve?.hydraulicEfficiency ?? null, efficiency: curve ? curve.efficiency : null, torque: curve?.torque ?? 0, temperature: 293.15,
    };
    if (curve && curve.reducedFlow > Math.SQRT2 + 1e-6) result.diagnostics.push(`${c.name}: beyond positive-head pump curve; acting as passive restriction. Turbine operation unsupported.`);
    if (c.kind === 'pump' && (!primed.has(groups.find(a)) || blocked(a, true))) result.diagnostics.push(`${c.name}: dry-run / unprimed inlet; no fluid supplied.`);
    if (b.stream === 'hot') result.readings[c.id] = result.readings[b.id];
  });
  // Routed overflow appears as a pseudo-branch from the tank to its overflow node. Its "loss" is the
  // drop of piezometric energy from the free surface to the receiving node (crest head and free fall).
  for (const c of cs.filter(c => c.kind === 'tank')) {
    const w = result.weir[c.id];
    if (!w?.routed) continue;
    const from = result.tankNodes[c.id], drop = (p[from] - p[w.node]) * 1000;
    result.branches.push({ id: `${c.id}#overflow`, component: c.id, from, to: w.node, flow: w.flow, loss: drop * w.flow, gain: 0 });
    result.readings[`${c.id}#overflow`] = { flow: w.flow, pressure: p[w.node] * 1000, inletPressure: p[from] * 1000, differentialPressure: drop, velocity: 0, reynolds: 0, frictionFactor: 0, hydraulicPower: 0, impellerPower: 0, shaftPower: 0, mechanicalLoss: 0, hydraulicEfficiency: null, efficiency: null, torque: 0, temperature: tanks[c.id].temperature };
    if (drop < 0) result.diagnostics.push(`${c.name}: overflow line backs up above the free surface — the overflow route cannot carry the spill.`);
  }
  for (const c of cs.filter(c => !branchKinds.has(c.kind) && definitions[c.kind].ports.some(p => p.id === 'fluid'))) {
    const n = node(c, 'fluid');
    const w = result.weir[c.id];
    const netFlow = result.branches.reduce((q, b) => q + (b.to === n ? b.flow : 0) - (b.from === n ? b.flow : 0), 0) - (w && !w.routed ? w.flow : 0);
    result.readings[c.id] = { flow: netFlow, pressure: p[n] * 1000 - RHO * G * prop(c, 'elevation'), inletPressure: p[n] * 1000 - RHO * G * prop(c, 'elevation'), differentialPressure: 0, velocity: 0, reynolds: 0, frictionFactor: 0, hydraulicPower: 0, impellerPower: 0, shaftPower: 0, mechanicalLoss: 0, hydraulicEfficiency: null, efficiency: null, torque: 0, temperature: tanks[c.id]?.temperature ?? 293.15, ...(c.kind === 'tank' ? { overflow: w?.flow ?? 0, surcharge: tankSurcharge(c, tanks[c.id].volume) } : {}) };
  }
  return result;
}

/** ε of a two-stream exchanger. */
export function effectiveness(ntu: number, cr: number, arrangement: string) {
  if (ntu <= 0) return 0;
  if (arrangement === "parallel") return -Math.expm1(-ntu * (1 + cr)) / (1 + cr);
  if (Math.abs(1 - cr) < 1e-9) return ntu / (1 + ntu);
  const e = Math.exp(-ntu * (1 - cr));
  return (1 - e) / (1 - cr * e);
}
/** Number of water cells in a pipe (0 = zero-volume pipe). */
export const pipeCells = (c: Component) => (c.kind === 'pipe' && c.props.inventory !== false ? Math.max(1, Math.round(prop(c, 'segments', 4))) : 0);
export const pipeWaterMass = (c: Component) => RHO * Math.PI * prop(c, 'diameter') ** 2 / 4 * prop(c, 'length');
/**
 * Conservative upwind enthalpy transport. Junctions are ideal mixers. Zero-volume
 * branches carry their dissipation and exponential UA loss into the outgoing
 * fluid. Pipes with water inventory are chains of well-mixed cells integrated
 * implicitly (transport delay); heat exchangers couple their two streams with
 * ε-NTU. Every outlet temperature is linear in upstream node temperatures, so the
 * whole network is one linear solve and energy is conserved exactly.
 */
export function transport(project: Project, tanks: Record<string, TankState>, result: HydraulicResult, dt: number, cells: Record<string, number[]> = {}) {
  const nodes = Object.keys(result.potentials), index = new Map(nodes.map((n, i) => [n, i]));
  const matrix = nodes.map(() => Array(nodes.length).fill(0)), rhs = nodes.map(() => 0), boundary = new Map<string, string>();
  for (const [id, n] of Object.entries(result.tankNodes)) boundary.set(n, id);
  const byId = new Map(project.components.map((c) => [c.id, c]));
  const directed = result.branches.filter(b => Math.abs(b.flow) > 1e-14).map(b => ({ ...b, from: b.flow > 0 ? b.from : b.to, to: b.flow > 0 ? b.to : b.from, rate: Math.abs(b.flow) * RHO }));
  type Transfer = (typeof directed)[number] & { terms: { node: string; coeff: number }[]; offset: number; heat: number; ua: number; ambientK: number; attenuation: number };
  const transfers: Transfer[] = directed.map(b => {
    const c = byId.get(b.component)!, r = result.readings[b.id];
    // Branch dissipation plus pump shaft losses (shaft − impeller); with b.loss = P_imp − P_net
    // for a pump this totals P_shaft − P_net, each loss counted once.
    const heat = b.loss + Math.max(0, r.shaftPower - r.impellerPower), ambientK = U.celsiusToK(prop(c, 'ambient', 20));
    const ua = c.kind === 'pipe' ? prop(c, 'thermalUA') : 0, n = pipeCells(c);
    if (n) {
      // Implicit cell chain: T_k' = (m c T_k + h ṁ c T_{k−1}' + h UA/N T_amb + h Q/N)/(m c + h ṁ c + h UA/N).
      const mc = pipeWaterMass(c) / n * CP, uaCell = ua / n, flowTerm = dt * b.rate * CP;
      const state = cells[c.id] ?? Array(n).fill(293.15), order = b.flow > 0 ? state : [...state].reverse();
      let alpha = 1, beta = 0;
      for (const old of order) {
        const den = mc + flowTerm + dt * uaCell, a = flowTerm / den;
        beta = a * beta + (mc * old + dt * uaCell * ambientK + dt * heat / n) / den;
        alpha *= a;
      }
      return { ...b, terms: [{ node: b.from, coeff: alpha }], offset: beta, heat, ua, ambientK, attenuation: alpha };
    }
    const attenuation = Math.exp(-ua / (b.rate * CP));
    return { ...b, terms: [{ node: b.from, coeff: attenuation }], offset: ambientK * (1 - attenuation) + heat / (b.rate * CP), heat, ua, ambientK, attenuation };
  });
  // Heat exchangers: outlet_A = T_Ai − ε·Cmin/C_A·(T_Ai − T_Bi), outlet_B = T_Bi + ε·Cmin/C_B·(T_Ai − T_Bi).
  const duty: Record<string, { coefficient: number; hot: string; cold: string }> = {};
  for (const hot of transfers.filter(t => t.stream === 'hot')) {
    const cold = transfers.find(t => t.component === hot.component && t.stream === 'cold');
    if (!cold) continue;
    const c = byId.get(hot.component)!, ch = hot.rate * CP, cc = cold.rate * CP, cmin = Math.min(ch, cc), cmax = Math.max(ch, cc);
    const eps = effectiveness(prop(c, 'ua') / cmin, cmin / cmax, String(c.props.arrangement)), k = eps * cmin;
    hot.terms = [{ node: hot.from, coeff: 1 - k / ch }, { node: cold.from, coeff: k / ch }];
    cold.terms = [{ node: cold.from, coeff: 1 - k / cc }, { node: hot.from, coeff: k / cc }];
    duty[c.id] = { coefficient: k, hot: hot.from, cold: cold.from };
  }
  nodes.forEach((n, i) => {
    const tank = boundary.get(n);
    if (tank) { matrix[i][i] = 1; rhs[i] = tanks[tank].temperature; return; }
    const incoming = transfers.filter(b => b.to === n), total = incoming.reduce((s, b) => s + b.rate, 0);
    if (!total) { matrix[i][i] = 1; rhs[i] = 293.15; return; }
    matrix[i][i] = 1;
    for (const b of incoming) {
      for (const t of b.terms) matrix[i][index.get(t.node)!] -= b.rate / total * t.coeff;
      rhs[i] += b.rate / total * b.offset;
    }
  });
  const temperatures = nodes.length ? solveLinear(matrix, rhs) : [], massRate: Record<string, number> = {}, energyRate: Record<string, number> = {};
  const at = (node: string) => temperatures[index.get(node)!];
  let ambient = 0, heat = 0;
  for (const b of transfers) {
    const inlet = at(b.from), outlet = b.terms.reduce((s, t) => s + t.coeff * at(t.node), b.offset);
    const source = boundary.get(b.from), destination = boundary.get(b.to);
    if (source) { massRate[source] = (massRate[source] ?? 0) - b.rate; energyRate[source] = (energyRate[source] ?? 0) - b.rate * CP * inlet; }
    if (destination) { massRate[destination] = (massRate[destination] ?? 0) + b.rate; energyRate[destination] = (energyRate[destination] ?? 0) + b.rate * CP * outlet; }
    const c = byId.get(b.component)!, n = pipeCells(c);
    if (n) {
      const mc = pipeWaterMass(c) / n * CP, uaCell = b.ua / n, flowTerm = dt * b.rate * CP;
      const state = cells[c.id] ?? Array(n).fill(293.15), order = b.flow > 0 ? [...state] : [...state].reverse();
      let upstream = inlet;
      const updated = order.map(old => {
        upstream = (mc * old + flowTerm * upstream + dt * uaCell * b.ambientK + dt * b.heat / n) / (mc + flowTerm + dt * uaCell);
        ambient += uaCell * (upstream - b.ambientK) * dt;
        return upstream;
      });
      cells[c.id] = b.flow > 0 ? updated : updated.reverse();
    } else ambient += b.rate * CP * (1 - b.attenuation) * (inlet - b.ambientK) * dt;
    heat += b.heat * dt;
    result.readings[b.id].temperature = outlet;
    result.readings[b.id].temperatureValid = true;
  }
  // Stagnant pipes keep their water and exchange heat with ambient only.
  for (const c of project.components.filter(c => pipeCells(c) && !transfers.some(t => t.component === c.id))) {
    const n = pipeCells(c), mc = pipeWaterMass(c) / n * CP, uaCell = prop(c, 'thermalUA') / n, ambientK = U.celsiusToK(prop(c, 'ambient', 20));
    cells[c.id] = (cells[c.id] ?? Array(n).fill(293.15)).map(old => {
      const next = (mc * old + dt * uaCell * ambientK) / (mc + dt * uaCell);
      ambient += uaCell * (next - ambientK) * dt;
      return next;
    });
    if (result.readings[c.id]) { result.readings[c.id].temperature = cells[c.id].reduce((s, t) => s + t, 0) / n; result.readings[c.id].temperatureValid = true; }
  }
  for (const [id, d] of Object.entries(duty)) {
    const q = d.coefficient * (at(d.hot) - at(d.cold));
    for (const key of [id, `${id}#hot`, `${id}#cold`]) if (result.readings[key]) result.readings[key].duty = q;
  }
  for (const c of project.components.filter(c => c.kind === 'fluidJunction')) {
    const n = result.terminalNodes[`${c.id}:fluid`], i = index.get(n);
    if (i !== undefined && transfers.some(b => b.to === n)) {
      result.readings[c.id].temperature = temperatures[i];
      result.readings[c.id].temperatureValid = true;
    }
  }
  // Unrouted weir overflow leaves the system from the free surface at the tank temperature: mass,
  // enthalpy c_p·T (transport datum) and potential energy g·z_surface per kilogram (the derivative of
  // the tank potential ρg(zV + V²/2A)). Routed overflow is an ordinary transfer above.
  const spills: Record<string, { mass: number; enthalpy: number; potential: number }> = {};
  for (const [id, w] of Object.entries(result.weir)) {
    if (w.routed || w.flow <= 0 || !tanks[id]) continue;
    const c = byId.get(id)!, t = tanks[id], mass = w.flow * RHO * dt, surface = prop(c, 'elevation') + t.mass / RHO / prop(c, 'surfaceArea'); // dΦ/dm
    massRate[id] = (massRate[id] ?? 0) - w.flow * RHO;
    energyRate[id] = (energyRate[id] ?? 0) - w.flow * RHO * CP * t.temperature;
    spills[id] = { mass, enthalpy: mass * CP * t.temperature, potential: mass * G * surface };
  }
  for (const [id, t] of Object.entries(tanks)) {
    const mass = t.mass + (massRate[id] ?? 0) * dt;
    if (mass < -1e-7) throw Error('Conservative tank event missed an empty boundary.');
    const vessel = t.vessel ?? 0;
    const enthalpy = (t.mass * CP + vessel) * t.temperature + (energyRate[id] ?? 0) * dt;
    t.mass = Math.abs(mass) < 1e-10 ? 0 : mass;
    if (t.mass > 1e-10) t.temperature = enthalpy / (t.mass * CP + vessel);
    t.volume = inventoryVolume(t.mass, t.temperature);
  }
  nodes.forEach((n, i) => (result.nodeTemperatures[n] = temperatures[i]));
  return { ambient, heat, spills };
}
/** Enthalpy (J, relative to 0 K) of all pipe water cells. */
export const pipeEnthalpy = (project: Project, cells: Record<string, number[]>) =>
  project.components.reduce((sum, c) => sum + (cells[c.id] ? cells[c.id].reduce((s, t) => s + pipeWaterMass(c) / cells[c.id].length * CP * t, 0) : 0), 0);
export function boundaryTime(project: Project, tanks: Record<string, TankState>, result: HydraulicResult, limit: number) {
  let step = limit;
  for (const c of project.components.filter(c => c.kind === 'tank')) {
    const n = result.tankNodes[c.id]; let q = 0;
    for (const b of result.branches) { if (b.to === n) q += b.flow; if (b.from === n) q -= b.flow; }
    const t = tanks[c.id], w = result.weir[c.id], capacity = U.litersToM3(prop(c, 'capacity'));
    if (w && !w.routed) q -= w.flow;
    // Network flows are reference-density volumes (mass/ρ_ref): emptiness is a mass event; rim events
    // use the inventory's actual volume rate q·ρ_ref/ρ(T) (thermal expansion).
    const massRate = q * RHO, volumeRate = t.mass > 1e-12 ? q * RHO * t.volume / t.mass : q;
    if (massRate < -1e-11 && t.mass > 1e-9) step = Math.min(step, t.mass / -massRate);
    // Events at the rim: overflow onset (weir flow starts from zero) and the surface falling back to
    // the rim (weir flow must not drain the tank below its crest within one interval).
    if (volumeRate > 1e-14 && t.volume < capacity - 1e-12) step = Math.min(step, (capacity - t.volume) / volumeRate);
    if (volumeRate < -1e-14 && t.volume > capacity + 1e-12) step = Math.min(step, (t.volume - capacity) / -volumeRate);
  }
  return step;
}
