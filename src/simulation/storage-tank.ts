/**
 * Sealed, stratified storage tank: heating buffer or hot-water cylinder with an optional internal coil.
 * Data provenance, equations and calibration: docs/STORAGE-AND-PRESSURE.md.
 *
 * The water column is a stack of N equal layers (bottom k = 0 … top k = N − 1). Each step solves, implicitly
 * and together with the coil cells,
 *
 *   C_k·dT_k/dt = Σ_ports ṁ_in·c·T_in − ṁ_out,k·c·T_k + (vertical upwind advection between layers)
 *                 + G·(T_{k+1} − 2T_k + T_{k−1}) − UA_k·(T_k − T_amb) + Σ_coil g·(T_ex,j − T_k)
 *   C_c·dT_j/dt = ṁ_c·c·(T_{j−1} − T_j) − g·(T_ex,j − T_k(j)),   T_ex,j = w·T_{j−1} + (1 − w)·T_j
 *
 * then removes density inversions by mixing adjacent unstable layers (capacity-weighted, energy exact). Every
 * outlet temperature is affine in the inlet node temperatures, so the tank enters the global enthalpy solve.
 */
import { prop, type Component } from './model';
import { exchangeWeight } from './panel-radiator';
import { WATER_CP as CP, WATER_RHO as RHO } from './units';
import { kellDensity } from './water';

/** Water ports of the tank, each at its own height. */
export const STORAGE_PORTS = ['p1', 'p2', 'p3', 'p4'] as const;
/** EN 12897 / EN 15332 standby loss test: 65 °C store in 20 °C air. */
export const STANDBY_DIFFERENCE = 45;

export const storageLayers = (c: Component) => Math.max(4, Math.min(60, Math.round(prop(c, 'layers', 20))));
export const hasCoil = (c: Component) => c.props.coil === true && prop(c, 'coilVolume') > 0;
export const storageWaterMass = (c: Component) => prop(c, 'storageVolume') / 1000 * RHO;
/** Heat capacity of one layer: water at the reference density plus its share of the vessel steel (J/K). */
export const layerCapacity = (c: Component) => (storageWaterMass(c) * CP + prop(c, 'vesselHeatCapacity')) / storageLayers(c);
/** Layer index of a relative height (0–100 % of the water column). */
export const layerAt = (c: Component, percent: number) => Math.max(0, Math.min(storageLayers(c) - 1, Math.floor(percent / 100 * storageLayers(c))));
export const portLayer = (c: Component, port: string) => layerAt(c, prop(c, `${port}Height`, 50));
/** Coil cells: one per layer covered, in forward flow order from the top (coil inlet) to the bottom (coil outlet). */
export function coilLayers(c: Component) {
  if (!hasCoil(c)) return [];
  const top = layerAt(c, Math.max(prop(c, 'coilTop'), prop(c, 'coilBottom'))), bottom = layerAt(c, Math.min(prop(c, 'coilTop'), prop(c, 'coilBottom')));
  return Array.from({ length: top - bottom + 1 }, (_, i) => top - i);
}
export const coilCellCapacity = (c: Component) => prop(c, 'coilVolume') / 1000 * RHO * CP / Math.max(1, coilLayers(c).length);
/** Cylinder geometry of the water column. */
export function storageGeometry(c: Component) {
  const height = prop(c, 'tankHeight', 1), volume = prop(c, 'storageVolume') / 1000, area = volume / height, radius = Math.sqrt(area / Math.PI);
  return { height, area, radius, layerHeight: height / storageLayers(c), side: 2 * Math.PI * radius * height };
}
/** Loss conductance of each layer: the total UA split by surface (side wall per layer, lid on the top, base on the bottom). */
export function layerLoss(c: Component) {
  const n = storageLayers(c), g = storageGeometry(c), total = g.side + 2 * g.area, ua = prop(c, 'loss');
  return Array.from({ length: n }, (_, k) => ua * (g.side / n + (k === 0 ? g.area : 0) + (k === n - 1 ? g.area : 0)) / total);
}
/** Conductance between adjacent layers from the effective vertical conductivity (water, wall and internal mixing). */
export const layerConductance = (c: Component) => { const g = storageGeometry(c); return prop(c, 'effectiveConductivity', 1) * g.area / g.layerHeight; };
/** Elevation (m) of a relative height in the column above the base. */
export const storageHeight = (c: Component, percent: number) => prop(c, 'elevation') + storageGeometry(c).height * percent / 100;
/** Temperature (K) at a relative sensor height. */
export const sensorTemperature = (c: Component, layers: readonly number[], percent: number) => layers[layerAt(c, percent)];

export interface StorageStream { node: string; layer: number; rate: number; heat: number }
export interface StorageCoilFlow { node: string; rate: number; heat: number; forward: boolean }
/**
 * Linear response of one implicit step: unknown y = [layers…, coil cells in their stored order],
 * y = base + Σ_node response[node]·T_node. `inputs` are the inflow streams (rate kg/s at its port layer; `heat`
 * W is branch dissipation carried by the stream), `outputs` the outflow rates per layer.
 */
export interface StorageResponse { base: number[]; response: Map<string, number[]>; n: number; m: number; losses: number[]; coilG: number; weight: number; coilCells: number[] }
export function storageResponse(c: Component, layers: readonly number[], coil: readonly number[], inputs: StorageStream[], outputs: { layer: number; rate: number }[], coilFlow: StorageCoilFlow | undefined, ambientK: number, dt: number): StorageResponse {
  const n = layers.length, cells = coilLayers(c), m = cells.length, size = n + m;
  const a = Array.from({ length: size }, () => new Float64Array(size)), b0 = new Float64Array(size);
  const columns = new Map<string, Float64Array>();
  const column = (node: string) => { let v = columns.get(node); if (!v) { v = new Float64Array(size); columns.set(node, v); } return v; };
  const cap = layerCapacity(c), losses = layerLoss(c), gv = layerConductance(c);
  if (dt === 0) {
    // A zero-length step only resolves outlet temperatures: every unknown keeps its stored value.
    for (let i = 0; i < size; i++) { a[i][i] = 1; b0[i] = i < n ? layers[i] : coil[i - n]; }
  } else {
    const net = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      a[k][k] += cap / dt + losses[k];
      b0[k] += cap / dt * layers[k] + losses[k] * ambientK;
    }
    for (const s of inputs) { net[s.layer] += s.rate; column(s.node)[s.layer] += s.rate * CP; b0[s.layer] += s.heat; }
    for (const o of outputs) { net[o.layer] -= o.rate; a[o.layer][o.layer] += o.rate * CP; }
    // Vertical flow through interface k|k+1 from continuity of the layers below (positive upward), upwind.
    let lift = 0;
    for (let k = 0; k < n - 1; k++) {
      lift += net[k];
      const f = Math.abs(lift) * CP, from = lift > 0 ? k : k + 1, to = lift > 0 ? k + 1 : k;
      a[from][from] += f; a[to][from] -= f;
      a[k][k] += gv; a[k + 1][k + 1] += gv; a[k][k + 1] -= gv; a[k + 1][k] -= gv;
    }
  }
  let coilG = 0, weight = 0;
  if (m && dt > 0) {
    const cc = coilCellCapacity(c), rate = coilFlow?.rate ?? 0;
    coilG = prop(c, 'coilUA') / m;
    // Exponentially fitted inlet weight: each steady cell attenuates its excess over the layer by exactly e^(−g/ṁc).
    weight = rate > 0 ? exchangeWeight(coilG / (rate * CP)) : 0;
    const order = coilFlow && !coilFlow.forward ? [...cells.keys()].reverse() : [...cells.keys()];
    order.forEach((j, position) => {
      const i = n + j, k = cells[j], upstream = position ? n + order[position - 1] : -1;
      a[i][i] += cc / dt + rate * CP + coilG * (1 - weight);
      b0[i] += cc / dt * coil[j] + (coilFlow?.heat ?? 0) / m;
      a[i][k] -= coilG;
      a[k][k] += coilG; a[k][i] -= coilG * (1 - weight);
      if (rate > 0) {
        const inflow = rate * CP - coilG * weight;
        if (upstream >= 0) { a[i][upstream] -= inflow; a[k][upstream] -= coilG * weight; }
        else { column(coilFlow!.node)[i] += inflow; column(coilFlow!.node)[k] += coilG * weight; }
      }
    });
  }
  const keys = [...columns.keys()];
  const solved = solveMany(a, [b0, ...keys.map(k => columns.get(k)!)]);
  return { base: solved[0], response: new Map(keys.map((k, i) => [k, solved[i + 1]])), n, m, losses, coilG, weight, coilCells: cells };
}
/** Evaluate a response at solved node temperatures. */
export const storageEvaluate = (r: StorageResponse, at: (node: string) => number) => {
  const y = [...r.base];
  for (const [node, v] of r.response) { const t = at(node); for (let i = 0; i < y.length; i++) y[i] += v[i] * t; }
  return y;
};
/**
 * Buoyancy: adjacent layers whose density increases upward are mixed to their capacity-weighted mean
 * (pool-adjacent-violators, so the result is stably stratified). Density from Kell (1975), which also
 * captures the inversion below 4 °C. Energy Σ C·T is conserved exactly.
 */
export function mixInversions(layers: number[]) {
  const groups: { t: number; w: number; count: number }[] = [];
  const density = (k: number) => kellDensity(Math.max(0, Math.min(100, k - 273.15)));
  for (const t of layers) {
    groups.push({ t, w: 1, count: 1 });
    while (groups.length > 1) {
      const top = groups[groups.length - 1], below = groups[groups.length - 2];
      if (density(below.t) >= density(top.t) - 1e-9) break;
      groups.pop();
      below.t = (below.t * below.w + top.t * top.w) / (below.w + top.w); below.w += top.w; below.count += top.count;
    }
  }
  let k = 0, mixed = false;
  for (const g of groups) { if (g.count > 1) mixed = true; for (let i = 0; i < g.count; i++) layers[k++] = g.t; }
  return mixed;
}
/** Dense Gaussian elimination with partial pivoting for several right-hand sides. */
function solveMany(a: Float64Array[], rhs: Float64Array[]): number[][] {
  const n = a.length, b = rhs.map(r => Float64Array.from(r)), m = a.map(r => Float64Array.from(r));
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    if (!(Math.abs(m[pivot][col]) > 0)) throw Error('Storage tank: singular layer system.');
    if (pivot !== col) { [m[pivot], m[col]] = [m[col], m[pivot]]; for (const v of b) [v[pivot], v[col]] = [v[col], v[pivot]]; }
    const p = m[col][col];
    for (let r = col + 1; r < n; r++) {
      const f = m[r][col] / p;
      if (f === 0) continue;
      for (let j = col; j < n; j++) m[r][j] -= f * m[col][j];
      for (const v of b) v[r] -= f * v[col];
    }
  }
  return b.map(v => {
    const x = new Array<number>(n).fill(0);
    for (let r = n - 1; r >= 0; r--) { let s = v[r]; for (let j = r + 1; j < n; j++) s -= m[r][j] * x[j]; x[r] = s / m[r][r]; }
    return x;
  });
}
/** Stored enthalpy (J, relative to 0 K) of layers and coil. */
export const storageEnthalpy = (c: Component, layers: readonly number[], coil: readonly number[] = []) =>
  layers.reduce((s, t) => s + layerCapacity(c) * t, 0) + coil.reduce((s, t) => s + coilCellCapacity(c) * t, 0);
/** Coil UA (W/K) that reproduces a rated output Q at supply T_s, store T_store and flow V̇ (l/h): exact for the fitted cells. */
export const coilUAFromRating = (output: number, supply: number, store: number, litresPerHour: number) => {
  const flow = litresPerHour / 3600 * CP; // ṁ·c at the reference density (W/K)
  return -flow * Math.log(1 - output / (flow * (supply - store)));
};

export type StorageBasisKind = 'manufacturer' | 'derived' | 'fitted' | 'assumed';
export const storageBasisLabels: Record<StorageBasisKind, string> = {
  manufacturer: 'Manufacturer data (Bosch)',
  derived: 'Calculated from manufacturer data',
  fitted: 'Fitted to a manufacturer rating',
  assumed: 'Model assumptions (not from Bosch data)',
};
/** Data provenance of the selected configuration (it may since have been edited). */
export function storageModelBasis(c: Component): { kind: StorageBasisKind; text: string }[] {
  const cylinder = c.variant === 'wh290';
  const catalog = cylinder ? prop(c, 'storageVolume') === 277 && prop(c, 'standbyHeatLoss') === 67 && prop(c, 'coilVolume') === 22 : prop(c, 'storageVolume') === 122.9 && prop(c, 'standbyHeatLoss') === 52;
  const ua = prop(c, 'loss');
  return [
    { kind: 'manufacturer', text: !catalog ? 'None: a custom configuration (volume, standby loss or coil edited away from a Bosch catalog size).' : cylinder
      ? 'Bosch Stora WH 290 LP1 B heat-pump cylinder (installation manual 6720872573): 277 l useful volume, standby loss 67 W (ErP), coil 2 × 12 turns, 3.2 m², 22.0 l, maximum coil output 11.0 kW at 55 °C flow / 45 °C store with 1,000 l/h, 10 bar drinking-water and coil side, height 1,294 mm, Ø 600 mm (700 mm insulated).'
      : 'Bosch BH 120-5 1 B heat-pump buffer: 122.9 l storage volume, standby loss 52 W (1.2 kWh/d), height 980 mm, Ø 510 mm, 41.2 kg.' },
    { kind: 'derived', text: `Loss conductance UA = standby loss / ${STANDBY_DIFFERENCE} K (EN 12897 test at 65 °C in 20 °C air) = ${ua.toFixed(3)} W/K, split over the layers by wall area.` },
    ...(hasCoil(c) ? [{ kind: 'fitted' as const, text: `Coil conductance ${prop(c, 'coilUA').toFixed(0)} W/K: the value for which the coil cells reproduce ${cylinder && catalog ? "Bosch's 11.0 kW at 55/45 °C and 1,000 l/h exactly" : 'the configured rating'} (exponentially fitted cells, uniform store). Held constant: the real coefficient rises with the temperature difference (natural convection outside the tube), so small differences are over- and large ones underestimated.` }] : []),
    { kind: 'assumed', text: `${storageLayers(c)} equal layers in a ${storageGeometry(c).height.toFixed(2)} m water column (inner height not published); effective vertical conductivity ${prop(c, 'effectiveConductivity')} W/(m·K) (water 0.64 plus wall conduction and inlet mixing); steel ${(prop(c, 'vesselHeatCapacity') / 1000).toFixed(1)} kJ/K lumped with the water; port and coil heights${cylinder && catalog ? ' interpreted from the dimension table' : ''} are assumptions; inflow enters the layer of its port and rises or sinks only by inversion mixing (no plume entrainment, no inlet jet mixing); coil and port pressure drops are estimates (no Bosch chart used); rigid vessel.` },
  ];
}
