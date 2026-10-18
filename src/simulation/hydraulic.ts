import { effectiveAmbient } from "./environment";
import { boilerExchange, boilerWaterCapacity } from './boiler';
import { PANEL_CELLS, panelCellCapacity, panelExchange } from './panel-radiator';
import { FLOOR_CELLS, belowBoundary, belowKey, floorCellCapacity, floorExchange, floorWaterMass, loopCount, screedCapacity, screedKey } from './underfloor-heating';
import { definitions, derived, prop, textProp, terminalKey, type Component, type Project } from './model';
import { solveLinear } from './electrical';
import { GRAVITY as G, WATER_CP as CP, WATER_RHO as RHO, unitsSI as U } from './units';
import { viscosityK, inventoryVolume } from './water';
import { STORAGE_PORTS, coilCellCapacity, coilLayers, hasCoil, layerCapacity, mixInversions, portLayer, storageEvaluate, storageHeight, storageLayers, storageResponse, storageWaterMass, type StorageResponse } from './storage-tank';

/** vessel: wall heat capacity (J/K) lumped at the water temperature; it does not flow. */
export interface TankState { volume: number; mass: number; temperature: number; vessel?: number }
/**
 * Water held in an expansion vessel's ledger: mass (kg, reference density) and enthalpy (J, c_p·T datum). It changes
 * only when the circuit loses water (safety-valve discharge); thermal expansion of the circuit's inventories is a volume
 * displaced into the vessel (see expansion.ts). Supplied water leaves at `temperature` (K).
 */
export interface VesselWater { mass: number; enthalpy: number; temperature: number }
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
  returnTemperature?: number;
  /** Panel radiator: inlet water temperature, mean exchange excess over the air and ṁ·c_p·(T_in − T_out). */
  supplyTemperature?: number; excessTemperature?: number; heatInput?: number;
  /** Underfloor heating: heat lost down through the insulation (W) and the mean screed (pipe-plane) temperature (K). */
  downwardLoss?: number; screedTemperature?: number;
  torque: number; temperature: number; temperatureValid?: boolean;
  /** Heat-exchanger duty (W), positive from the hot (A) stream into the cold (B) stream. */
  duty?: number;
  /** Net positive suction head available at a pump inlet (m). */
  npshAvailable?: number;
  /** Pump head factor from cavitation (1 = none), used for this solution's head and power. */
  cavitation?: number;
  /** Electric circulator: motor and electronics loss (W), heating the pumped water while it flows. */
  motorLoss?: number;
}
export interface HydraulicResult {
  readings: Record<string, HydraulicReading>; potentials: Record<string, number>;
  residual: number; pressureResidual: number; iterations: number; converged: boolean; diagnostics: string[];
  branches: { id: string; component: string; stream?: "hot" | "cold"; part?: string; from: string; to: string; flow: number; loss: number; gain: number }[];
  tankNodes: Record<string, string>; terminalNodes: Record<string, string>;
  /** Empty tanks whose node carries flow-through at or below the empty-tank head (continuity, no storage). */
  drained?: string[];
  /** Mixed node temperatures (K) from the last enthalpy transport; viscosity input of the next solve. */
  nodeTemperatures: Record<string, number>;
  /** Weir overflow per tank: flow (m³/s), whether it is routed into the network, and the receiving node. */
  weir: Record<string, { flow: number; routed: boolean; node: string }>;
  /** Expansion vessels: boundary node, and the water they supply to their circuit (m³/s, the safety-valve discharge). */
  vessels?: Record<string, { node: string; supply: number }>;
  /** Safety valves discharging to an open drain: their atmospheric outlet node. */
  discharge?: Record<string, string>;
}
/**
 * Below the network's continuity tolerance a branch flow is numerical residue, not transport: it moves no enthalpy, and
 * its losses go to ambient as at zero flow. (A pressure boundary inside a closed loop, e.g. an expansion vessel, leaves
 * residue of order 10⁻¹⁴ m³/s; attributing a standing pump's loss to it would heat that "flow" without bound.)
 */
export const STAGNANT_FLOW = 1e-12;
/** Sharp-crested weir discharge coefficient (rectangular crest, free overfall). */
export const WEIR_CD = 0.62;
/** Free-overfall weir discharge Q = ⅔·C_d·√(2g)·L·h^1.5 for surcharge h above the rim (m³/s). */
export const weirFlow = (length: number, surcharge: number) => surcharge > 0 ? (2 / 3) * WEIR_CD * Math.sqrt(2 * G) * length * surcharge ** 1.5 : 0;
/** Surcharge of a tank's free surface above its rim (m). */
export const tankSurcharge = (c: Component, volume: number) => Math.max(0, volume - U.litersToM3(prop(c, 'capacity'))) / prop(c, 'surfaceArea');
export const emptyHydraulics = (): HydraulicResult => ({ readings: {}, potentials: {}, residual: 0, pressureResidual: 0, iterations: 0, converged: true, diagnostics: [], branches: [], tankNodes: {}, terminalNodes: {}, nodeTemperatures: {}, weir: {} });
export const branchKinds = new Set(['pipe', 'valve', 'checkValve', 'actuatedValve', 'thermostaticValve', 'pump', 'circulator', 'pressureReducingValve', 'heatExchanger', 'radiator', 'electricBoiler', 'panelRadiator', 'heatPump', 'storageTank', 'safetyValve', 'divertingValve', 'underfloorHeating']);
/** Internal node of a sealed storage tank: all its ports connect to it through short nozzle branches. */
export const interiorNode = (c: Component) => `${c.id}:interior`;
/** Key of a storage tank's coil cells in the cell store. */
export const coilKey = (id: string) => `${id}#coil`;
/** Branches with one fully mixed water cell and an implicit heated element node (boiler elements, heat-pump condenser). */
export const elementKinds = new Set(['electricBoiler', 'heatPump']);
/** State of an element node: temperature (K). */
export type ElementState = { elementTemperature: number };
/** Centrifugal pump branches: shaft-driven pumps and electric circulators share the curve model. */
export const isPump = (c: Component) => c.kind === 'pump' || c.kind === 'circulator';
/** Positioned valves: their opening is simulation state (actuator / regulator travel). */
export const positionedValves = new Set(['actuatedValve', 'thermostaticValve', 'pressureReducingValve']);
const valveKinds = new Set(['valve', 'actuatedValve', 'thermostaticValve', 'checkValve', 'pressureReducingValve', 'safetyValve', 'divertingValve']);
/** Opening (%) of one branch: a diverting valve's position is the share of path B; path A has the complement. */
const branchOpening = (c: Component, part: string | undefined, positions: Record<string, number>) => {
  const position = positions[c.id] ?? prop(c, c.kind === 'divertingValve' ? 'position' : 'opening');
  return c.kind === 'divertingValve' ? (part === 'a' ? 100 - position : position) : position;
};
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
  return derived(c, 'pumpPoints', () => {
    const text = typeof c.props.curvePoints === 'string' ? c.props.curvePoints.trim() : '';
    if (!text) return null;
    let pts = pointCache.get(text);
    if (!pts) { const parsed = parsePumpPoints(text); if (typeof parsed === 'string') return null; pts = parsed; pointCache.set(text, pts); }
    return pts;
  });
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
  if (re <= 2300) return laminar;
  const turbulent = 0.25 / Math.log10(relativeRoughness / 3.7 + 5.74 / Math.max(re, 2300) ** 0.9) ** 2;
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
/**
 * The pressure drop of `pipeLoss` as a function of flow for fixed segment temperatures, with the per-temperature
 * viscosities resolved once. The network solve evaluates a branch many times at the same temperatures; the
 * arithmetic is that of `pipeLoss`, so the results are identical.
 */
export function pipeLossModel(c: Component, temperatures: readonly number[]) {
  const d = prop(c, 'diameter'), area = Math.PI * d * d / 4, n = temperatures.length, segment = prop(c, 'length') / n;
  const relativeRoughness = prop(c, 'roughness') / d, laminar = Math.PI * d ** 4;
  const counts = new Map<number, number>();
  for (const kelvin of temperatures) { const key = Math.round(kelvin * 100); counts.set(key, (counts.get(key) ?? 0) + 1); }
  const groups = [...counts].map(([key, count]) => ({ mu: viscosityK(key / 100), length: segment * count }));
  return (q: number) => {
    const v = q / area;
    let dp = 0;
    for (const { mu, length } of groups) {
      const re = RHO * Math.abs(v) * d / mu;
      dp += re <= 2300 ? 128 * mu * length * q / laminar : frictionFactor(re, relativeRoughness) * length / d * RHO * v * Math.abs(v) / 2;
    }
    return dp;
  };
}
/** Linear internal flow resistance of the pump (Pa per m³/s); also regularises the Newton solve. */
export const PUMP_INTERNAL_RESISTANCE = 1e5;
/**
 * Inherent flow characteristic φ = Kv(x)/Kvs at relative travel x = opening/100 and constant Δp
 * (Seborg, Edgar, Mellichamp & Doyle, Process Dynamics and Control, ch. 9; terms per IEC 60534-1):
 *   linear φ = x,  quick opening φ = √x,  equal percentage φ = R^(x−1), R = rangeability (typically 20–50).
 * The installed characteristic follows from the network solve. Zero travel is the seat (exact isolation),
 * so an equal-percentage valve steps from φ = 1/R to shut, as real trims do below their rangeability.
 */
export function relativeFlowCoefficient(c: Component, opening: number) {
  const x = Math.max(0, Math.min(1, opening / 100));
  if (!valveCharacteristicKinds.has(c.kind)) return x;
  const characteristic = textProp(c, 'characteristic', 'linear');
  if (characteristic === 'equalPercentage') return x > 0 ? prop(c, 'rangeability', 50) ** (x - 1) : 0;
  if (characteristic === 'quickOpening') return Math.sqrt(x);
  return x;
}
/** Valves with a selectable inherent characteristic. */
export const valveCharacteristicKinds = new Set(['valve', 'actuatedValve', 'pressureReducingValve']);
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
/**
 * Cavitation head factor H_cav/H from the available NPSH and NPSH3 (the NPSH at which head has dropped
 * 3 %, the Hydraulic Institute definition of NPSHR): f = 1 − 0.03·(NPSH3/NPSHA)^5, limited to [0, 1].
 * It passes exactly through the standard 3 % point; the exponent (steep breakdown, head lost near
 * NPSHA ≈ 0.5·NPSH3) is a model choice, not a measured breakdown curve.
 */
export function cavitationFactor(npshAvailable: number, npsh3: number) {
  if (!(npsh3 > 0) || !Number.isFinite(npshAvailable)) return 1;
  if (npshAvailable <= 0) return 0;
  return Math.max(0, Math.min(1, 1 - 0.03 * (npsh3 / npshAvailable) ** 5));
}
const topologyPumps = (cs: Component[]) => cs.filter(isPump);
/** NPSH3 at the operating point: the rated value scaled with (Q/Q_rated)² (affinity-similar points scale with ω²). */
export const npsh3At = (c: Component, q: number) => prop(c, 'npshRequired') * (Math.max(0, q) / prop(c, 'ratedFlow')) ** 2;
/** Internal (hydraulic) shaft power at the rated point, without mechanical loss. */
function ratedInternalPower(c: Component) {
  return derived(c, 'ratedInternalPower', () => {
    const omega = prop(c, 'ratedSpeed'), q = prop(c, 'ratedFlow'), head = Math.max(0, pumpHead(c, omega, q));
    const efficiency = Math.max(0.15, prop(c, 'efficiency'));
    return RHO * G * head * q / efficiency;
  });
}
/**
 * Bearing and seal friction: share s of shaft input at the rated point, P_m,r = s/(1−s)·P_internal,r,
 * scaled with speed as (ω/ω_r)^1.6 (rolling-bearing friction torque ∝ (νn)^0.6).
 */
export function mechanicalLossPower(c: Component, omega: number) {
  const share = Math.min(0.2, Math.max(0, prop(c, 'mechanicalLoss') / 100));
  return share / (1 - share) * ratedInternalPower(c) * (Math.max(0, omega) / prop(c, 'ratedSpeed')) ** 1.6;
}
/**
 * Head with cavitation: the positive (pumping) part of the curve is multiplied by the cavitation factor
 * at this flow, with NPSH3 evaluated at q. Applying it only to positive head keeps the branch
 * characteristic monotone; a stopped or beyond-curve pump is a passive restriction and cannot cavitate.
 */
export function cavitatingHead(c: Component, omega: number, q: number, npshAvailable?: number) {
  const head = pumpHead(c, omega, q), running = Math.max(0, omega) / prop(c, 'ratedSpeed') > 1e-6;
  const factor = running && head > 0 && npshAvailable !== undefined ? cavitationFactor(npshAvailable, npsh3At(c, q)) : 1;
  return { head: head > 0 ? head * factor : head, factor };
}
export function pumpCurve(c: Component, omega: number, q: number, npshAvailable?: number) {
  const ratio = Math.max(0, omega) / prop(c, 'ratedSpeed');
  const cavitated = cavitatingHead(c, omega, q, npshAvailable);
  const signedHead = cavitated.head, head = Math.max(0, signedHead);
  const reducedFlow = ratio > 1e-8 ? q / (prop(c, 'ratedFlow') * ratio) : 0;
  const curveEfficiency = Math.max(0.15, prop(c, 'efficiency') * (1 - 0.35 * (reducedFlow - 1) ** 2));
  const impellerPower = RHO * G * head * Math.max(0, q);
  const mechanicalLoss = mechanicalLossPower(c, omega);
  const shaftPower = impellerPower / curveEfficiency + mechanicalLoss;
  const pressureRise = RHO * G * signedHead - PUMP_INTERNAL_RESISTANCE * q;
  const netHydraulicPower = pressureRise * Math.max(0, q);
  return {
    head, pressureRise, reducedFlow, impellerPower, mechanicalLoss, shaftPower, netHydraulicPower, cavitation: cavitated.factor,
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
    { label: "Mechanical loss at rated speed", value: op.mechanicalLoss, unit: "W", note: "bearings + seals, ∝ ω^1.6" },
    { label: "Shaft power at rating", value: op.shaftPower, unit: "W", note: "P_imp/η_h + P_mech" },
    { label: "Internal hydraulic efficiency", value: pct(op.hydraulicEfficiency), unit: "%" },
    { label: "Overall efficiency at rating", value: pct(op.efficiency), unit: "%", note: "P_net / P_shaft" },
  ];
}
class Union {
  p = new Map<string, string>();
  find(x: string): string { if (!this.p.has(x)) this.p.set(x, x); const y = this.p.get(x)!; if (x !== y) this.p.set(x, this.find(y)); return this.p.get(x)!; }
  join(a: string, b: string) { this.p.set(this.find(a), this.find(b)); }
}
type Branch = { id: string; stream?: 'hot' | 'cold'; part?: string; c: Component; a: string; b: string };
interface HydraulicTopology {
  cs: Component[]; tanks: Component[]; terminalNodes: Record<string, string>;
  /** Groups of nodes joined by branches. Safety valves do not join their discharge side: a sealed circuit keeps its own pressure reference. */
  nodes: string[]; branches: Branch[]; group: Map<string, string>;
  /** Components by kind (catalog order), terminals per node, and the per-solve lists derived from the components alone. */
  ofKind: (kind: string) => Component[]; kinds: Map<string, string>; terminalCount: Map<string, number>; primers: Component[]; fluidPorts: Component[];
  inventories?: readonly { key: string; mass: number; group: string }[];
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
  for (const c of cs.filter(c => c.kind === 'storageTank')) uf.find(interiorNode(c));
  for (const w of project.connections.filter(w => w.domain === 'hydraulic' && !disconnected.has(w.id))) uf.join(terminalKey(w.from), terminalKey(w.to));
  const terminalNodes: Record<string, string> = {};
  for (const k of uf.p.keys()) terminalNodes[k] = uf.find(k);
  const node = (c: Component, port: string) => terminalNodes[`${c.id}:${port}`];
  const terminals = new Map<string, number>();
  for (const n of Object.values(terminalNodes)) terminals.set(n, (terminals.get(n) ?? 0) + 1);
  // An unconnected storage port is a blank plug: no nozzle branch (a dead-end node adds nothing but conditioning).
  const connected = (c: Component, port: string) => (terminals.get(node(c, port)) ?? 0) > 1;
  const branches = cs.filter(c => branchKinds.has(c.kind)).flatMap((c): Branch[] => c.kind === 'heatExchanger'
    ? [{ id: `${c.id}#hot`, stream: 'hot', c, a: node(c, 'hotIn'), b: node(c, 'hotOut') }, { id: `${c.id}#cold`, stream: 'cold', c, a: node(c, 'coldIn'), b: node(c, 'coldOut') }]
    : c.kind === 'divertingValve'
      ? [{ id: `${c.id}#a`, part: 'a', c, a: node(c, 'inlet'), b: node(c, 'outletA') }, { id: `${c.id}#b`, part: 'b', c, a: node(c, 'inlet'), b: node(c, 'outletB') }]
    : c.kind === 'storageTank'
      // Port nozzles point into the tank; the coil is a separate branch through it.
      ? [...STORAGE_PORTS.filter(port => connected(c, port)).map((port): Branch => ({ id: `${c.id}#${port}`, part: port, c, a: node(c, port), b: terminalNodes[interiorNode(c)] })),
        ...(hasCoil(c) ? [{ id: coilKey(c.id), part: 'coil', c, a: node(c, 'coilIn'), b: node(c, 'coilOut') }] : [])]
      : [{ id: c.id, c, a: node(c, 'inlet'), b: node(c, 'outlet') }]);
  const nodes = [...new Set(Object.values(terminalNodes))], groups = new Union();
  for (const n of nodes) groups.find(n);
  for (const b of branches) if (b.c.kind !== 'safetyValve') groups.join(b.a, b.b);
  const group = new Map(nodes.map(n => [n, groups.find(n)]));
  const byKind = new Map<string, Component[]>();
  for (const c of cs) { const list = byKind.get(c.kind); if (list) list.push(c); else byKind.set(c.kind, [c]); }
  const terminalCount = new Map<string, number>();
  for (const n of Object.values(terminalNodes)) terminalCount.set(n, (terminalCount.get(n) ?? 0) + 1);
  const topology = { cs, tanks: cs.filter(c => c.kind === 'tank'), terminalNodes, nodes, branches, group,
    ofKind: (kind: string) => byKind.get(kind) ?? [], kinds: new Map(cs.map(c => [c.id, c.kind])), terminalCount,
    // A circulator's own water does not prime its circuit (an unprimed pump still runs dry).
    primers: cs.filter(c => (pipeCells(c) && c.kind !== 'circulator') || c.kind === 'storageTank').sort((a, b) => Number(elementKinds.has(b.kind)) - Number(elementKinds.has(a.kind))),
    fluidPorts: cs.filter(c => !branchKinds.has(c.kind) && definitions[c.kind].ports.some(p => p.id === 'fluid')) };
  byProject.set(key, topology);
  return topology;
}
export function solveHydraulic(project: Project, tanks: Record<string, TankState>, speeds: Record<string, number> = {}, positions: Record<string, number> = {}, faults: Record<string, string> = {}, disconnected = new Set<string>(), previous?: HydraulicResult, cells: Record<string, number[]> = {}, vesselPressures: Record<string, number> = {}): HydraulicResult {
  const result = emptyHydraulics();
  // Node temperatures persist until the next enthalpy transport replaces them.
  result.nodeTemperatures = { ...previous?.nodeTemperatures };
  const topology = hydraulicTopology(project, disconnected), { cs, nodes, branches } = topology;
  if (!cs.length) return result;
  const node = (c: Component, port: string) => topology.terminalNodes[`${c.id}:${port}`];
  const groups = { find: (n: string) => topology.group.get(n) ?? n };
  const kinds = topology.kinds, byKind = (id: string) => kinds.get(id);
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
  const tankGroups = new Set(Object.keys(boundaries).map(n => groups.find(n)));
  // Expansion vessels: the gas cushion sets the piezometric pressure of the vessel's connection. One vessel per sealed
  // circuit; a circuit open to a vented tank already has its pressure reference (an open system has no membrane vessel).
  const vesselGroups = new Map<string, Component>();
  result.vessels = {};
  for (const c of topology.ofKind('expansionVessel')) {
    const n = node(c, 'fluid'), group = groups.find(n);
    if (boundaries[n] !== undefined) throw Error(`${c.name}: an expansion vessel cannot share an ideal node with a tank. Insert a pipe, or remove the vessel from the vented circuit.`);
    if (tankGroups.has(group)) throw Error(`${c.name}: this circuit is open to a vented tank, which already sets its pressure. A membrane expansion vessel belongs to a sealed circuit.`);
    const other = vesselGroups.get(group);
    if (other) throw Error(`${c.name} and ${other.name}: one expansion vessel per sealed circuit is supported. Combine them into one vessel of the summed volume.`);
    vesselGroups.set(group, c);
    boundaries[n] = ((vesselPressures[c.id] ?? prop(c, 'fillPressure')) + RHO * G * prop(c, 'elevation')) / 1000;
    result.vessels[c.id] = { node: n, supply: 0 };
  }
  // Safety valves: an unconnected outlet discharges to an open drain at atmospheric pressure (the water leaves the
  // system). A piped outlet must lead to a vented tank (tundish or collecting vessel).
  result.discharge = {};
  const terminalCount = topology.terminalCount;
  for (const c of topology.ofKind('safetyValve')) {
    const inlet = groups.find(node(c, 'inlet')), outlet = node(c, 'outlet');
    if (!tankGroups.has(inlet) && !vesselGroups.has(inlet)) throw Error(`${c.name}: a safety valve needs the circuit's water reserve. Add an expansion vessel to this sealed circuit (the fixed fill-pressure stand-in cannot supply discharged water).`);
    if (terminalCount.get(outlet) === 1) { boundaries[outlet] = RHO * G * prop(c, 'elevation') / 1000; result.discharge[c.id] = outlet; }
    else if (!tankGroups.has(groups.find(outlet))) throw Error(`${c.name}: route the discharge line to a vented tank, or leave the outlet unconnected (open drain).`);
  }
  const primed = new Set([...tankGroups, ...vesselGroups.keys(), ...Object.values(result.discharge).map(n => groups.find(n))]);
  // A filled sealed loop needs one pressure datum, not a pressure boundary at every node.
  // Fixing all its nodes to zero violates continuity (a pump discharges into nothing).
  // Finite branch inventory establishes a filled loop; its pressure datum represents an
  // externally maintained fill pressure with compliant expansion, not a mass source.
  for (const c of topology.primers) {
    const n = c.kind === 'storageTank' ? topology.terminalNodes[interiorNode(c)] : node(c, 'inlet'), group = groups.find(n);
    if (!primed.has(group)) { boundaries[n] = prop(c, 'fillPressure') / 1000; primed.add(group); }
  }
  for (const n of nodes) if (!primed.has(groups.find(n))) boundaries[n] = 0;
  for (const c of topology.tanks) {
    const flow = weirFlow(prop(c, 'weirLength'), tankSurcharge(c, tanks[c.id].volume)), port = node(c, 'overflow');
    const routed = flow > 0 && tankGroups.has(groups.find(port)) && Object.keys(boundaryTanks).every(n => n !== port);
    result.weir[c.id] = { flow, routed, node: port };
    if (routed) weirInjection.set(port, (weirInjection.get(port) ?? 0) + flow);
  }
  if (nodes.filter(n => boundaries[n] === undefined).length > 200) throw Error('Hydraulic network exceeds 200 pressure nodes.');
  // An empty tank (≤ 10⁻⁹ kg) cannot supply net outflow. Its node is blocked (no inflow: outflow is
  // exactly zero), held at the empty-tank head with net inflow ≥ 0 (the tank fills), or drained: a
  // continuity node at or below that head through which inflow passes on while the tank stays empty.
  // A full vented tank does NOT block inflow: it spills over its rim (transport removes the excess),
  // so no implicit shut-off valve exists.
  const emptyNodes = Object.keys(boundaryTanks).filter(n => boundaryTanks[n].some(c => tanks[c.id].mass <= 1e-9));
  let blocked = new Set(emptyNodes), drained = new Set<string>(), unknown: string[] = [], indices = new Map<string, number>();
  const p: Record<string, number> = {};
  // Local water temperature for viscosity: pipe inventory cells, else the upstream node of the
  // previous transport (one-substep lag; avoids a nested temperature–flow iteration).
  const tankAt = new Map(Object.entries(boundaryTanks).map(([n, [c]]) => [n, tanks[c.id].temperature]));
  const nodeTemperature = (n: string) => tankAt.get(n) ?? previous?.nodeTemperatures?.[n] ?? 293.15;
  const pipeTemperatures = (br: Branch, q: number) => (pipeCells(br.c) && cells[br.c.id]?.length ? cells[br.c.id] : [nodeTemperature(q >= 0 ? br.a : br.b)]);
  /**
   * Valve-type branches (valves, regulators, heat-exchanger streams): two-K loss (Hooper 1981),
   * K(Re) = K₁/Re + K∞ with K∞ the turbulent coefficient. The K₁/Re part equals K₁·μ·v/(2d), i.e. a
   * term linear in flow, evaluated with the viscosity of the upstream water for each direction.
   * Both parts scale with 1/φ², φ = Kv/Kvs the valve's inherent characteristic at its opening
   * (K ∝ 1/Kv²). A stuck-open fault means full bore and no cracking pressure.
   */
  // Within one solve the temperatures, positions, speeds and faults are fixed: each branch's loss law is prepared once
  // per flow direction and reused by every Newton and root-finding evaluation.
  type BranchLaw = { pipe: (((q: number) => number) | undefined)[]; terms: (ReturnType<typeof branchTerms> | undefined)[]; atZero?: number; closedForm?: boolean };
  const laws = new Map<Branch, BranchLaw>();
  const lawOf = (br: Branch) => { let law = laws.get(br); if (!law) { law = { pipe: [], terms: [] }; laws.set(br, law); } return law; };
  const valveTerms = (br: Branch, forward: boolean) => { const law = lawOf(br), k = forward ? 0 : 1; return law.terms[k] ??= branchTerms(br, forward); };
  const branchTerms = (br: Branch, forward: boolean) => {
    const c = br.c, fault = faults[c.id], stuckOpen = fault === 'stuckOpen';
    const opening = c.kind === 'heatExchanger' || c.kind === 'radiator' || elementKinds.has(c.kind) || c.kind === 'panelRadiator' || c.kind === 'storageTank' || stuckOpen ? 100 : branchOpening(c, br.part, positions);
    // Storage tank: port nozzles (entry + exit loss) or the internal coil, each with its own bore and coefficients.
    const coil = br.part === 'coil', key = (k: string) => coil ? `coil${k[0].toUpperCase()}${k.slice(1)}` : k;
    const fraction = Math.max(0.00001, relativeFlowCoefficient(c, opening)), d = prop(c, key('diameter')), area = Math.PI * d * d / 4;
    const mu = viscosityK(nodeTemperature(forward ? br.a : br.b));
    return {
      linear: prop(c, key('laminarK')) * mu / (2 * d * area) / fraction ** 2,
      quadratic: c.kind === 'thermostaticValve' || c.kind === 'safetyValve' || c.kind === 'divertingValve' ? 1e5 * (3600 / prop(c, 'kvs') / fraction) ** 2 : prop(c, key('lossCoefficient')) / fraction ** 2 * RHO / (2 * area ** 2),
      offset: c.kind === 'checkValve' && !stuckOpen ? prop(c, 'crackingPressure') : 0,
      mu,
    };
  };
  // Cavitation: NPSH available from the last accepted solution (one coupled step of lag, ≤ 1/240 s;
  // fixed within a step so readings and energy use the same curve). NPSH3 is evaluated at the solved
  // flow inside the curve, so cavitation acts as the flow limit where NPSH3(Q) reaches NPSHA.
  const npshAvailable = new Map(topologyPumps(cs).flatMap(c => {
    const prev = previous?.readings[c.id]?.npshAvailable;
    return prop(c, 'npshRequired') > 0 && prev !== undefined ? [[c.id, prev] as const] : [];
  }));
  const loss = (br: Branch, q: number) => {
    const c = br.c;
    if (c.kind === 'pipe') { const law = lawOf(br), k = q >= 0 ? 0 : 1; return (law.pipe[k] ??= pipeLossModel(c, pipeTemperatures(br, q)))(q); }
    // Underfloor heating: identical parallel loops, each a Darcy–Colebrook pipe carrying its share of the flow.
    if (c.kind === 'underfloorHeating') { const law = lawOf(br), k = q >= 0 ? 0 : 1, loops = loopCount(c); return (law.pipe[k] ??= pipeLossModel(c, pipeTemperatures(br, q)))(q / loops); }
    if (isPump(c)) {
      // Descending head curve continued as passive quadratic resistance past zero head.
      return PUMP_INTERNAL_RESISTANCE * q - RHO * G * cavitatingHead(c, Math.max(0, speeds[c.id] ?? 0), q, npshAvailable.get(c.id)).head;
    }
    const t = valveTerms(br, q >= 0);
    return t.linear * q + t.quadratic * q * Math.abs(q) + t.offset;
  };
  let regularize = false;
  const previousFlow = new Map((previous?.branches ?? []).map(b => [b.id, b.flow]));
  const inverse = (b: typeof branches[number], dp: number) => {
    const { c, a, b: to } = b;
    if (!primed.has(groups.find(a))) return { q: 0, derivative: 0 };
    const fault = faults[c.id], opening = c.kind === 'heatExchanger' ? 100 : branchOpening(c, b.part, positions);
    if (valveKinds.has(c.kind) && (fault === 'stuckClosed' || (opening === 0 && fault !== 'stuckOpen'))) return { q: 0, derivative: 0 };
    const actualLoss = (q: number) => loss(b, q);
    const oneWay = c.kind === 'checkValve' || isPump(c) || c.kind === 'pressureReducingValve' || c.kind === 'safetyValve';
    const allowPositive = !blocked.has(a), allowNegative = !oneWay && !blocked.has(to);
    const law = lawOf(b), atZero = law.atZero ??= actualLoss(0);
    // Cavitating pumps (head depends on Q through NPSH3) use the bracketed numeric inverse.
    const closedForm = law.closedForm ??= c.kind !== 'pipe' && c.kind !== 'underfloorHeating' && !(isPump(c) && (pumpPoints(c) || npshAvailable.has(c.id)));
    const difference = dp - atZero, magnitude = Math.abs(difference);
    // Closed form of linear·q + quadratic·q|q| = difference (pump curve or two-K valve).
    const terms = !closedForm ? { linear: 1e5, quadratic: 0 } : isPump(c)
      ? { linear: PUMP_INTERNAL_RESISTANCE, quadratic: RHO * G * prop(c, 'shutoffHead') * 0.5 / prop(c, 'ratedFlow') ** 2 }
      : valveTerms(b, difference >= 0);
    const linear = terms.linear, quadratic = terms.quadratic;
    const magnitudeFlow = magnitude === 0 ? 0 : 2 * magnitude / (linear + Math.sqrt(linear * linear + 4 * quadratic * magnitude));
    // A purely quadratic branch has an infinite inverse slope at zero pressure.
    // Bound only the Newton Jacobian near zero (a 1 µPa pressure scale), leaving
    // the actual two-K flow law and its dissipated energy unchanged. A fixed
    // series resistance would dominate the physical loss of large-bore valves.
    const inverseSlope = () => 1 / Math.max(1e-9, linear + 2 * quadratic * Math.max(magnitudeFlow, quadratic > 0 ? Math.sqrt(1e-6 / quadratic) : 0));
    // Closed direction: zero flow. The Jacobian keeps the branch's own slope at this |Δp|
    // (generalized Jacobian) so Newton can move node pressures back across the threshold.
    if ((dp <= atZero && !allowNegative) || (dp >= atZero && !allowPositive))
      return { q: 0, derivative: !regularize ? 0 : closedForm ? inverseSlope() : 1e-5 };
    if (closedForm) {
      const q = Math.sign(difference) * magnitudeFlow;
      return { q, derivative: inverseSlope() };
    }
    // Monotone loss(q) = dp: bracket by doubling, then Illinois (modified regula falsi) — superlinear,
    // always bracketed, ~10 loss evaluations instead of ~90 for bisection at the same tolerance.
    let lo = 0, hi = 0, flo = atZero - dp, fhi = flo;
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
  const network = () => {
    unknown = nodes.filter(n => boundaries[n] === undefined || drained.has(n)); indices = new Map(unknown.map((n, i) => [n, i]));
    for (const n of nodes) p[n] = boundaries[n] !== undefined && !drained.has(n) ? boundaries[n] : (previous?.potentials[n] ?? (boundaries[n] ?? 0) * 1000) / 1000;
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
    // Every exit leaves the pressures at the iterate `current` was evaluated at (unregularized): it is the final state.
    const final = current; result.residual = final.norm / 1000; result.converged = result.residual < 1e-12;
    if (!result.converged) throw Error(`Hydraulic solve failed: continuity residual ${result.residual.toExponential(3)} m³/s after ${result.iterations} iterations.`);
    return final;
  };
  // Active set over the empty tanks, starting blocked: a blocked tank receiving inflow is held; a held
  // tank with net outflow drains, or blocks again without inflow; a drained tank whose node rises above
  // the empty-tank head is held, and blocks without inflow. Each switch needs one further solve; a
  // cycle keeps the last set.
  let final = network();
  for (let round = 0; emptyNodes.length && round < 3 * emptyNodes.length + 2; round++) {
    const nextBlocked = new Set(blocked), nextDrained = new Set(drained);
    for (const n of emptyNodes) {
      const net = branches.reduce((q, b, i) => q + (b.b === n ? final.flows[i] : 0) - (b.a === n ? final.flows[i] : 0), 0);
      const inflow = branches.reduce((q, b, i) => q + Math.max(0, b.b === n ? final.flows[i] : b.a === n ? -final.flows[i] : 0), 0);
      if (blocked.has(n)) { if (inflow > 1e-12) nextBlocked.delete(n); }
      else if (inflow <= 1e-12) { nextBlocked.add(n); nextDrained.delete(n); }
      else if (!drained.has(n) && net < -1e-12) nextDrained.add(n);
      else if (drained.has(n) && p[n] > boundaries[n] + 1e-9) nextDrained.delete(n);
    }
    const same = (x: Set<string>, y: Set<string>) => x.size === y.size && [...x].every(n => y.has(n));
    if (same(nextBlocked, blocked) && same(nextDrained, drained)) break;
    blocked = nextBlocked; drained = nextDrained; final = network();
  }
  result.drained = Object.entries(result.tankNodes).filter(([, n]) => drained.has(n)).map(([id]) => id);
  for (const n of nodes) result.potentials[n] = p[n] * 1000;
  branches.forEach((b, i) => {
    const { c, a, b: to } = b, q = final.flows[i], dp = (p[a] - p[to]) * 1000;
    const opening = c.kind === 'heatExchanger' ? 100 : positions[c.id] ?? prop(c, 'opening');
    const pipe = c.kind === 'pipe' ? pipeLoss(c, q, pipeTemperatures(b, q)) : c.kind === 'underfloorHeating' ? pipeLoss(c, q / loopCount(c), pipeTemperatures(b, q)) : (() => {
      const velocity = q / (Math.PI * prop(c, 'diameter', 0.025) ** 2 / 4);
      if (isPump(c)) return { velocity, reynolds: 0, frictionFactor: 0 };
      const mu = valveTerms(b, q >= 0).mu;
      return { velocity, reynolds: RHO * Math.abs(velocity) * prop(c, 'diameter') / mu, frictionFactor: 0, viscosity: mu };
    })();
    const curve = isPump(c) ? pumpCurve(c, speeds[c.id] ?? 0, q, npshAvailable.get(c.id)) : null;
    const gain = curve ? RHO * G * curve.head : 0;
    if (Math.abs(q) > 1e-14) {
      const modeled = loss(b, q);
      result.pressureResidual = Math.max(result.pressureResidual, Math.abs(dp - modeled));
    }
    // Pump's explicit small internal resistance is hydraulic dissipation too.
    result.branches.push({ id: b.id, component: c.id, stream: b.stream, part: b.part, from: a, to, flow: q, loss: Math.max(0, dp * q + gain * q), gain });
    // Storage-tank nozzles sit at their port height; the coil is referenced to the tank base.
    const elevation = c.kind === 'storageTank' && b.part && b.part !== 'coil' ? storageHeight(c, prop(c, `${b.part}Height`)) : prop(c, 'elevation');
    result.readings[b.id] = {
      flow: q, pressure: p[to] * 1000 - RHO * G * elevation, inletPressure: p[a] * 1000 - RHO * G * elevation, differentialPressure: dp, ...pipe,
      hydraulicPower: curve ? curve.netHydraulicPower : 0, impellerPower: curve?.impellerPower ?? 0, shaftPower: curve?.shaftPower ?? 0, mechanicalLoss: curve?.mechanicalLoss ?? 0,
      hydraulicEfficiency: curve?.hydraulicEfficiency ?? null, efficiency: curve ? curve.efficiency : null, torque: curve?.torque ?? 0, temperature: 293.15,
      ...(curve ? { cavitation: curve.cavitation } : {}),
    };
    if (curve && curve.reducedFlow > Math.SQRT2 + 1e-6) result.diagnostics.push(`${c.name}: beyond positive-head pump curve; acting as passive restriction. Turbine operation unsupported.`);
    if (isPump(c) && (!primed.has(groups.find(a)) || blocked.has(a))) result.diagnostics.push(`${c.name}: dry-run / unprimed inlet; no fluid supplied.`);
    if (b.stream === 'hot') result.readings[c.id] = result.readings[b.id];
  });
  // Diverting valve: total flow through the common port AB, its pressure, and the drop to the open path.
  for (const c of topology.ofKind('divertingValve')) {
    const [a, b] = ['a', 'b'].map(part => result.readings[`${c.id}#${part}`]);
    if (a && b) result.readings[c.id] = { ...(Math.abs(b.flow) > Math.abs(a.flow) ? b : a), flow: a.flow + b.flow, hydraulicPower: 0 };
  }
  // Storage tank: throughput (sum of the inflows) and the gauge pressure at the tank base.
  for (const c of topology.ofKind('storageTank')) {
    const n = topology.terminalNodes[interiorNode(c)], ports = result.branches.filter(b => b.component === c.id && b.part !== 'coil');
    const base = p[n] * 1000 - RHO * G * prop(c, 'elevation');
    result.readings[c.id] = { flow: ports.reduce((sum, b) => sum + Math.max(0, b.flow), 0), pressure: base, inletPressure: base, differentialPressure: 0, velocity: 0, reynolds: 0, frictionFactor: 0, hydraulicPower: 0, impellerPower: 0, shaftPower: 0, mechanicalLoss: 0, hydraulicEfficiency: null, efficiency: null, torque: 0, temperature: 293.15 };
  }
  // Each vessel supplies exactly what its circuit's safety valves discharge: the only sink of a sealed circuit.
  // (Continuity residue of the network solve at the vessel boundary is not booked as mass.)
  for (const [id, v] of Object.entries(result.vessels ?? {})) {
    const group = groups.find(v.node);
    v.supply = result.branches.reduce((sum, b) => sum + (b.component !== id && byKind(b.component) === 'safetyValve' && groups.find(b.from) === group ? Math.max(0, b.flow) : 0), 0);
  }
  // Routed overflow appears as a pseudo-branch from the tank to its overflow node. Its "loss" is the
  // drop of piezometric energy from the free surface to the receiving node (crest head and free fall).
  for (const c of topology.tanks) {
    const w = result.weir[c.id];
    if (!w?.routed) continue;
    const from = result.tankNodes[c.id], drop = (p[from] - p[w.node]) * 1000;
    // The free-overfall law cannot force water into a pressurized/submerged
    // drain. Continuing would pump uphill and disguise the work as negative heat.
    if (drop < -1e-6) throw Error(`${c.name}: overflow line backs up above the free surface. Submerged/backpressured overflow is unsupported; lower or widen the drain, or disconnect the overflow route.`);
    result.branches.push({ id: `${c.id}#overflow`, component: c.id, from, to: w.node, flow: w.flow, loss: drop * w.flow, gain: 0 });
    result.readings[`${c.id}#overflow`] = { flow: w.flow, pressure: p[w.node] * 1000, inletPressure: p[from] * 1000, differentialPressure: drop, velocity: 0, reynolds: 0, frictionFactor: 0, hydraulicPower: 0, impellerPower: 0, shaftPower: 0, mechanicalLoss: 0, hydraulicEfficiency: null, efficiency: null, torque: 0, temperature: tanks[c.id].temperature };
  }
  for (const c of topology.fluidPorts) {
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
/**
 * Finite branch inventory cells: pipe chain, one boiler mixing cell, a panel radiator or underfloor chain, one wet-rotor
 * circulator cell (its motor loss heats that water, so a nearly stalled flow cannot heat it without bound), or zero-volume branch.
 */
export const pipeCells = (c: Component) => elementKinds.has(c.kind) || c.kind === 'circulator' ? 1 : c.kind === 'panelRadiator' ? PANEL_CELLS : c.kind === 'underfloorHeating' ? FLOOR_CELLS : (c.kind === 'pipe' && c.props.inventory !== false ? Math.max(1, Math.round(prop(c, 'segments', 4))) : 0);
export const pipeWaterMass = (c: Component) => elementKinds.has(c.kind) || c.kind === 'panelRadiator' || c.kind === 'circulator' ? prop(c, 'waterVolume') : c.kind === 'underfloorHeating' ? floorWaterMass(c) : RHO * Math.PI * prop(c, 'diameter') ** 2 / 4 * prop(c, 'length');
/** Heat capacity (J/K) of one inventory cell; boiler and radiator metal is lumped with the water (underfloor screed is its own node). */
export const cellCapacity = (c: Component, n: number) => elementKinds.has(c.kind) ? boilerWaterCapacity(c) : c.kind === 'panelRadiator' ? panelCellCapacity(c) : c.kind === 'underfloorHeating' ? floorCellCapacity(c) : pipeWaterMass(c) / n * CP;
/**
 * Conservative upwind enthalpy transport. Junctions are ideal mixers. Zero-volume
 * branches carry their dissipation and exponential UA loss into the outgoing
 * fluid. Pipes with water inventory are chains of well-mixed cells integrated
 * implicitly (transport delay); heat exchangers couple their two streams with
 * ε-NTU. Every outlet temperature is linear in upstream node temperatures, so the
 * whole network is one linear solve and energy is conserved exactly.
 */
export function transport(project: Project, tanks: Record<string, TankState>, result: HydraulicResult, dt: number, cells: Record<string, number[]> = {}, radiatorConductance: Record<string, number> = {}, boilers: Record<string, ElementState> = {}, boilerPower: Record<string, number> = {}, fixedPanel?: Record<string, ReturnType<typeof panelExchange>>, vessels: Record<string, VesselWater> = {}) {
  const nodes = Object.keys(result.potentials), index = new Map(nodes.map((n, i) => [n, i]));
  const matrix = nodes.map(() => Array(nodes.length).fill(0)), rhs = nodes.map(() => 0), boundary = new Map<string, string>();
  // A drained (empty, flow-through) tank's node is an ordinary mixer: no storage, no enthalpy exchange.
  for (const [id, n] of Object.entries(result.tankNodes)) if (!result.drained?.includes(id)) boundary.set(n, id);
  const byId = new Map(project.components.map((c) => [c.id, c]));
  const directed = result.branches.filter(b => Math.abs(b.flow) > STAGNANT_FLOW).map(b => ({ ...b, from: b.flow > 0 ? b.from : b.to, to: b.flow > 0 ? b.to : b.from, rate: Math.abs(b.flow) * RHO }));
  type Transfer = (typeof directed)[number] & { terms: { node: string; coeff: number }[]; offset: number; heat: number; ua: number; ambientK: number; attenuation: number; uaCell?: number; weight?: number;
    /** Underfloor heating: per-cell effective exchange temperature (flow order), the eliminated screed coupling and the boundary below. */
    cellAmbient?: number[]; floor?: ReturnType<typeof floorExchange>; belowK?: number };
  const transfers: Transfer[] = directed.map(b => {
    const c = byId.get(b.component)!, r = result.readings[b.id];
    // Branch dissipation plus pump shaft losses (shaft − impeller); with b.loss = P_imp − P_net
    // for a pump this totals P_shaft − P_net, each loss counted once.
    // An electric circulator's motor and electronics losses are cooled by the pumped water (wet rotor).
    const heat = b.loss + Math.max(0, r.shaftPower - r.impellerPower) + (r.motorLoss ?? 0), ambientK = U.celsiusToK(effectiveAmbient(project, c));
    const exchange = elementKinds.has(c.kind) ? boilerExchange(c, boilers[c.id], boilerPower[c.id] ?? 0, dt) : undefined;
    const n = pipeCells(c), state = cells[c.id] ?? Array(n).fill(293.15), order = b.flow > 0 ? state : [...state].reverse();
    // Panel radiator: EN 442 conductance per cell from the interval's start state (inlet: last transported node temperature).
    const panel = c.kind === 'panelRadiator' ? fixedPanel?.[c.id] ?? panelExchange(c, order, result.nodeTemperatures[b.from], ambientK, b.rate * CP) : undefined;
    // Underfloor heating: each water cell exchanges with its implicit screed node, eliminated into an effective conductance
    // and per-cell effective temperature (affine in the room and below-floor temperatures).
    const floor = c.kind === 'underfloorHeating' ? floorExchange(c, dt, b.rate * CP) : undefined;
    const belowK = floor ? U.celsiusToK(belowBoundary(project, c).temperature) : undefined;
    const screed = floor && (cells[screedKey(c.id)] ?? Array(n).fill(293.15)), screedOrder = screed && (b.flow > 0 ? screed : [...screed].reverse());
    const cellAmbient = floor && screedOrder!.map(t => floor.ambient(t, ambientK, belowK!));
    const ua = panel ? panel.g * n : floor ? floor.effective * n : elementKinds.has(c.kind) ? prop(c, 'loss') : c.kind === 'pipe' ? prop(c, 'thermalUA') : c.kind === 'radiator' ? radiatorConductance[c.id] ?? prop(c, 'naturalUA') : 0;
    if (n) {
      // Implicit cell chain with exchange temperature w·T_{k−1}' + (1 − w)·T_k' (w = 0 except in panel radiators and floors):
      // T_k' = (m c T_k + h (ṁ c − g w) T_{k−1}' + h g T_amb + h Q/N)/(m c + h ṁ c + h g (1 − w)), g = UA/N.
      const mc = cellCapacity(c, n), uaCell = ua / n, w = panel?.w ?? floor?.w ?? 0, flowTerm = dt * b.rate * CP;
      let alpha = 1, beta = 0;
      order.forEach((old, k) => {
        const den = mc + flowTerm + dt * (uaCell * (1 - w) + (exchange?.sink ?? 0)), a = (flowTerm - dt * uaCell * w) / den;
        beta = dt === 0 ? old : a * beta + (mc * old + dt * uaCell * (cellAmbient?.[k] ?? ambientK) + dt * (heat / n + (exchange?.source ?? 0))) / den;
        alpha *= a;
      });
      return { ...b, terms: [{ node: b.from, coeff: alpha }], offset: beta, heat, ua, ambientK, attenuation: alpha, uaCell, weight: w, cellAmbient, floor, belowK };
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
  // Storage tanks: one implicit layer/coil solve per tank, as an affine response to its inlet node temperatures.
  // Outflowing nozzles and the coil outlet carry that response, so the tank is part of the single linear solve.
  const storage = new Map<string, { c: Component; r: StorageResponse; ambientK: number }>(), interiors = new Set<string>(), interiorMean = new Map<string, number>();
  for (const c of project.components.filter(c => c.kind === 'storageTank')) {
    const inside = result.terminalNodes[interiorNode(c)];
    if (inside === undefined) continue;
    interiors.add(inside);
    const own = transfers.filter(t => t.component === c.id), ambientK = U.celsiusToK(effectiveAmbient(project, c));
    const ports = own.filter(t => t.part !== 'coil'), coil = own.find(t => t.part === 'coil');
    const layers = cells[c.id] ?? Array(storageLayers(c)).fill(293.15), coilCells = cells[coilKey(c.id)] ?? Array(coilLayers(c).length).fill(293.15);
    const r = storageResponse(c, layers, coilCells,
      ports.filter(t => t.to === inside).map(t => ({ node: t.from, layer: portLayer(c, t.part!), rate: t.rate, heat: t.heat })),
      ports.filter(t => t.from === inside).map(t => ({ layer: portLayer(c, t.part!), rate: t.rate })),
      coil && { node: coil.from, rate: coil.rate, heat: coil.heat, forward: coil.flow > 0 }, ambientK, dt);
    const affine = (index: number, extra = 0) => ({ terms: [...r.response].map(([node, v]) => ({ node, coeff: v[index] })), offset: r.base[index] + extra });
    for (const t of ports.filter(t => t.from === inside)) Object.assign(t, affine(portLayer(c, t.part!), t.heat / (t.rate * CP)));
    if (coil) {
      const order = coil.flow > 0 ? [...r.coilCells.keys()] : [...r.coilCells.keys()].reverse();
      Object.assign(coil, affine(r.n + order[order.length - 1]));
    }
    storage.set(c.id, { c, r, ambientK });
    interiorMean.set(inside, layers.reduce((a, t) => a + t, 0) / layers.length);
  }
  // Transfers by receiving node (in transfer order, which fixes the mixing sums) and the components that carry flow.
  const incomingAt = new Map<string, Transfer[]>(), flowing = new Set<string>();
  for (const t of transfers) {
    const list = incomingAt.get(t.to);
    if (list) list.push(t); else incomingAt.set(t.to, [t]);
    flowing.add(t.component);
  }
  // Water an expansion vessel supplies to its circuit (safety-valve discharge) enters at the vessel's water temperature.
  const supply = new Map<string, { id: string; rate: number }>();
  for (const [id, v] of Object.entries(result.vessels ?? {})) if (v.supply > 0 && vessels[id]) supply.set(v.node, { id, rate: v.supply * RHO });
  nodes.forEach((n, i) => {
    if (interiors.has(n)) { matrix[i][i] = 1; rhs[i] = interiorMean.get(n) ?? 293.15; return; }
    const tank = boundary.get(n), incoming = incomingAt.get(n) ?? [], source = supply.get(n), total = incoming.reduce((s, b) => s + b.rate, 0) + (source?.rate ?? 0);
    if (source) rhs[i] += source.rate / total * vessels[source.id].temperature;
    // A tank empty at the start of the interval has no stored water to supply: its outflow leaves at the
    // mixed inflow temperature, and the water it keeps is booked at that temperature.
    if (tank && (tanks[tank].mass > 1e-9 || !total)) { matrix[i][i] = 1; rhs[i] = tanks[tank].temperature; return; }
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
  const environmentExchange: Record<string, number> = {};
  const release = (id: string, energy: number) => { ambient += energy; environmentExchange[id] = (environmentExchange[id] ?? 0) + energy; };
  for (const b of transfers) {
    const inlet = at(b.from), outlet = b.terms.reduce((s, t) => s + t.coeff * at(t.node), b.offset);
    const source = boundary.get(b.from), destination = boundary.get(b.to);
    if (source) { massRate[source] = (massRate[source] ?? 0) - b.rate; energyRate[source] = (energyRate[source] ?? 0) - b.rate * CP * inlet; }
    if (destination) { massRate[destination] = (massRate[destination] ?? 0) + b.rate; energyRate[destination] = (energyRate[destination] ?? 0) + b.rate * CP * outlet; }
    const c = byId.get(b.component)!, n = pipeCells(c);
    if (n) {
      const exchange = elementKinds.has(c.kind) ? boilerExchange(c, boilers[c.id], boilerPower[c.id] ?? 0, dt) : undefined;
      const mc = cellCapacity(c, n), uaCell = b.uaCell ?? b.ua / n, w = b.weight ?? 0, flowTerm = dt * b.rate * CP;
      const state = cells[c.id] ?? Array(n).fill(293.15), order = b.flow > 0 ? [...state] : [...state].reverse();
      let upstream = inlet, output = 0, excess = 0, downward = 0;
      const screed = b.floor && (cells[screedKey(c.id)] ?? Array(n).fill(293.15)), screedOrder = screed && (b.flow > 0 ? screed : [...screed].reverse()), screedNext: number[] = [];
      const updated = order.map((old, k) => {
        const into = upstream;
        upstream = dt === 0 ? old : (mc * old + (flowTerm - dt * uaCell * w) * into + dt * uaCell * (b.cellAmbient?.[k] ?? b.ambientK) + dt * (b.heat / n + (exchange?.source ?? 0))) / (mc + flowTerm + dt * (uaCell * (1 - w) + (exchange?.sink ?? 0)));
        if (b.floor) {
          // Back-substituted screed node: water → screed g_wp·(X − S') splits into the room, the space below and storage.
          const x = w * into + (1 - w) * upstream, next = b.floor.screed(screedOrder![k], x, b.ambientK, b.belowK!);
          const up = b.floor.up * (next - b.ambientK), down = b.floor.down * (next - b.belowK!);
          release(c.id, up * dt); release(belowKey(c.id), down * dt); output += up; downward += down; excess += (x - b.ambientK) / n;
          screedNext.push(next);
          return upstream;
        }
        // The same implicit exchange that entered the cell balance is booked (exact ledger).
        const local = w * (into - b.ambientK) + (1 - w) * (upstream - b.ambientK);
        release(c.id, uaCell * local * dt); output += uaCell * local; excess += local / n;
        return upstream;
      });
      cells[c.id] = b.flow > 0 ? updated : updated.reverse();
      if (b.floor) cells[screedKey(c.id)] = b.flow > 0 ? screedNext : screedNext.reverse();
      if (c.kind === 'panelRadiator') Object.assign(result.readings[b.id], { duty: output, supplyTemperature: inlet, returnTemperature: outlet, heatInput: b.rate * CP * (inlet - outlet), excessTemperature: excess });
      if (b.floor) Object.assign(result.readings[b.id], { duty: output, downwardLoss: downward, supplyTemperature: inlet, returnTemperature: outlet, heatInput: b.rate * CP * (inlet - outlet), excessTemperature: excess, screedTemperature: screedNext.reduce((a, t) => a + t, 0) / n });
    } else release(c.id, b.rate * CP * (1 - b.attenuation) * (inlet - b.ambientK) * dt);
    heat += b.heat * dt;
    if (elementKinds.has(c.kind)) {
      result.readings[b.id].duty = b.rate * CP * (outlet - inlet);
      result.readings[b.id].returnTemperature = inlet;
    }
    if (c.kind === "radiator") result.readings[b.id].duty = b.rate * CP * (1 - b.attenuation) * (inlet - b.ambientK);
    result.readings[b.id].temperature = outlet;
    result.readings[b.id].temperatureValid = true;
  }
  // Stagnant pipes keep their water and exchange heat with ambient only.
  for (const c of project.components.filter(c => pipeCells(c) && !flowing.has(c.id))) {
    const n = pipeCells(c), mc = cellCapacity(c, n), ambientK = U.celsiusToK(effectiveAmbient(project, c));
    const floor = c.kind === 'underfloorHeating' ? floorExchange(c, dt, 0) : undefined, belowK = floor && U.celsiusToK(belowBoundary(project, c).temperature);
    const screed = floor && (cells[screedKey(c.id)] ?? Array(n).fill(293.15)), screedNext: number[] = [];
    const before = cells[c.id] ?? Array(n).fill(293.15), uaCell = c.kind === 'panelRadiator' ? (fixedPanel?.[c.id] ?? panelExchange(c, before, undefined, ambientK, 0)).g : floor ? floor.effective : c.kind === 'circulator' ? 0 : prop(c, elementKinds.has(c.kind) ? 'loss' : 'thermalUA') / n;
    const exchange = elementKinds.has(c.kind) ? boilerExchange(c, boilers[c.id], boilerPower[c.id] ?? 0, dt) : undefined;
    let output = 0, downward = 0;
    cells[c.id] = before.map((old, k) => {
      const local = floor ? floor.ambient(screed![k], ambientK, belowK!) : ambientK;
      const next = dt === 0 ? old : (mc * old + dt * uaCell * local + dt * (exchange?.source ?? 0)) / (mc + dt * (uaCell + (exchange?.sink ?? 0)));
      if (floor) {
        const s = floor.screed(screed![k], next, ambientK, belowK!), up = floor.up * (s - ambientK), down = floor.down * (s - belowK!);
        release(c.id, up * dt); release(belowKey(c.id), down * dt); output += up; downward += down; screedNext.push(s);
        return next;
      }
      release(c.id, uaCell * (next - ambientK) * dt); output += uaCell * (next - ambientK);
      return next;
    });
    if (floor) cells[screedKey(c.id)] = screedNext;
    const mean = cells[c.id].reduce((s, t) => s + t, 0) / n;
    if (result.readings[c.id]) { result.readings[c.id].temperature = mean; result.readings[c.id].temperatureValid = true; }
    if (c.kind === 'panelRadiator' && result.readings[c.id]) Object.assign(result.readings[c.id], { duty: output, heatInput: 0, excessTemperature: mean - ambientK });
    if (floor && result.readings[c.id]) Object.assign(result.readings[c.id], { duty: output, downwardLoss: downward, heatInput: 0, excessTemperature: mean - ambientK, screedTemperature: screedNext.reduce((a, t) => a + t, 0) / n });
  }
  // Storage tanks: layers and coil from the same implicit response at the solved inlet temperatures; the same
  // implicit wall loss is booked; then density inversions are mixed (conservative redistribution).
  for (const { c, r, ambientK } of storage.values()) {
    const y = storageEvaluate(r, at), layers = y.slice(0, r.n), coil = y.slice(r.n);
    release(c.id, r.losses.reduce((sum, ua, k) => sum + ua * (layers[k] - ambientK), 0) * dt);
    let coilDuty = 0;
    if (r.m && dt > 0) {
      const coilFlow = transfers.find(t => t.component === c.id && t.part === 'coil'), inlet = coilFlow ? at(coilFlow.from) : 0;
      const order = coilFlow && coilFlow.flow < 0 ? [...r.coilCells.keys()].reverse() : [...r.coilCells.keys()];
      order.forEach((j, position) => {
        const upstream = position ? coil[order[position - 1]] : coilFlow ? inlet : coil[j];
        coilDuty += r.coilG * (r.weight * upstream + (1 - r.weight) * coil[j] - layers[r.coilCells[j]]);
      });
    }
    if (dt > 0) mixInversions(layers);
    cells[c.id] = layers;
    if (r.m) cells[coilKey(c.id)] = coil;
    const reading = result.readings[c.id];
    if (reading) Object.assign(reading, { temperature: layers.reduce((a, t) => a + t, 0) / layers.length, temperatureValid: true, duty: coilDuty });
  }
  // Vessel water supplied to the circuit leaves the vessel's ledger at its temperature.
  for (const { id, rate } of supply.values()) {
    const v = vessels[id];
    v.mass -= rate * dt; v.enthalpy -= rate * CP * v.temperature * dt;
  }
  for (const c of project.components.filter(c => elementKinds.has(c.kind))) {
    const state = boilers[c.id], power = boilerPower[c.id] ?? 0;
    state.elementTemperature = boilerExchange(c, state, power, dt).element(cells[c.id][0]);
    heat += power * dt;
  }
  for (const [id, d] of Object.entries(duty)) {
    const q = d.coefficient * (at(d.hot) - at(d.cold));
    for (const key of [id, `${id}#hot`, `${id}#cold`]) if (result.readings[key]) result.readings[key].duty = q;
  }
  // Diverting valve: water temperature at its common port.
  for (const c of project.components.filter(c => c.kind === 'divertingValve')) {
    const i = index.get(result.terminalNodes[`${c.id}:inlet`]);
    if (i !== undefined && result.readings[c.id] && flowing.has(c.id)) Object.assign(result.readings[c.id], { temperature: temperatures[i], temperatureValid: true });
  }
  for (const c of project.components.filter(c => c.kind === 'fluidJunction')) {
    const n = result.terminalNodes[`${c.id}:fluid`], i = index.get(n);
    if (i !== undefined && incomingAt.has(n)) {
      result.readings[c.id].temperature = temperatures[i];
      result.readings[c.id].temperatureValid = true;
    }
  }
  // Unrouted weir overflow leaves the system from the free surface at the tank temperature: mass,
  // enthalpy c_p·T (transport datum) and potential energy g·z_surface per kilogram (the derivative of
  // the tank potential ρg(zV + V²/2A)). Routed overflow is an ordinary transfer above.
  const spills: Record<string, { mass: number; enthalpy: number; potential: number }> = {};
  // Safety-valve discharge to an open drain leaves the system: mass, enthalpy at the valve outlet temperature and the
  // potential g·z of the outlet (its atmospheric boundary is at Π = ρ·g·z).
  for (const [id, n] of Object.entries(result.discharge ?? {})) {
    const t = transfers.find(b => b.component === id && b.to === n);
    if (!t || dt === 0) continue;
    const mass = t.rate * dt, outlet = t.terms.reduce((sum, term) => sum + term.coeff * at(term.node), t.offset);
    spills[id] = { mass, enthalpy: mass * CP * outlet, potential: mass * G * prop(byId.get(id)!, 'elevation') };
  }
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
    if (t.mass > 1e-10 || vessel > 0) t.temperature = enthalpy / (t.mass * CP + vessel);
    // Round-off at an emptiness event can leave a few 10⁻¹⁰ kg negative. The mass ledger keeps it (exact
    // closure); the reported volume does not go below zero, and outflow is blocked below 10⁻⁹ kg.
    t.volume = inventoryVolume(Math.max(0, t.mass), t.temperature);
  }
  nodes.forEach((n, i) => (result.nodeTemperatures[n] = temperatures[i]));
  return { ambient, heat, spills, environmentExchange };
}
/**
 * Copy of a solve result that a trial transport may mutate: it writes readings (temperatures, duties) and node
 * temperatures only; topology, branches and pressures are read. Cheaper than a deep clone on every trial.
 */
export const transportCopy = (r: HydraulicResult): HydraulicResult => ({
  ...r, readings: Object.fromEntries(Object.entries(r.readings).map(([id, v]) => [id, { ...v }])), nodeTemperatures: { ...r.nodeTemperatures },
});
/** Enthalpy (J, relative to 0 K) of all water cells: pipes, boilers, heat pumps, panel radiators, storage layers and coils; and underfloor screed. */
export const pipeEnthalpy = (project: Project, cells: Record<string, number[]>) =>
  project.components.reduce((sum, c) => sum + (cells[screedKey(c.id)] ?? []).reduce((s, t) => s + screedCapacity(c) * t, 0) + (c.kind === 'storageTank'
    ? (cells[c.id] ?? []).reduce((s, t) => s + layerCapacity(c) * t, 0) + (cells[coilKey(c.id)] ?? []).reduce((s, t) => s + coilCellCapacity(c) * t, 0)
    : cells[c.id] ? cells[c.id].reduce((s, t) => s + cellCapacity(c, cells[c.id].length) * t, 0) : 0), 0);
/**
 * Fixed-mass water inventories (kg per cell, at the reference density) with the hydraulic node that places them in a
 * circuit: pipe, boiler, heat-pump and radiator cells, storage-tank layers and coil cells. Used for thermal expansion.
 */
export function waterInventories(project: Project, disconnected = new Set<string>()): readonly { key: string; mass: number; group: string }[] {
  const topology = hydraulicTopology(project, disconnected), node = (c: Component, port: string) => topology.terminalNodes[`${c.id}:${port}`];
  const group = (n: string) => topology.group.get(n) ?? n;
  // Configuration only: built once per topology of a frozen (engine-owned) project.
  if (topology.inventories && Object.isFrozen(project.components)) return topology.inventories;
  return topology.inventories = project.components.flatMap(c => {
    if (c.kind === 'storageTank') {
      const layers = storageLayers(c), coil = coilLayers(c).length;
      return [{ key: c.id, mass: storageWaterMass(c) / layers, group: group(topology.terminalNodes[interiorNode(c)]) },
        ...(coil ? [{ key: coilKey(c.id), mass: prop(c, 'coilVolume') / 1000 * RHO / coil, group: group(node(c, 'coilIn')) }] : [])];
    }
    const n = pipeCells(c);
    return n ? [{ key: c.id, mass: pipeWaterMass(c) / (elementKinds.has(c.kind) ? 1 : n), group: group(node(c, 'inlet')) }] : [];
  });
}
/** Hydraulic circuit (sealed group) of a component port. */
export const circuitOf = (project: Project, c: Component, port: string, disconnected = new Set<string>()) => {
  const topology = hydraulicTopology(project, disconnected), n = topology.terminalNodes[`${c.id}:${port}`];
  return topology.group.get(n) ?? n;
};
/** Volume band (m³) around a tank rim within which rim events are not located. */
const RIM_TOLERANCE = 1e-9;
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
    // the rim (weir flow must not drain the tank below its crest within one interval). Within 1 µL of
    // the rim no event is located: alternating flow around a brim-full tank (e.g. thermal expansion of
    // a vessel filled to capacity) would otherwise split the step without bound. Mass stays exact.
    if (volumeRate > 1e-14 && t.volume < capacity - RIM_TOLERANCE) step = Math.min(step, (capacity - t.volume) / volumeRate);
    if (volumeRate < -1e-14 && t.volume > capacity + RIM_TOLERANCE) step = Math.min(step, (t.volume - capacity) / -volumeRate);
  }
  return step;
}
