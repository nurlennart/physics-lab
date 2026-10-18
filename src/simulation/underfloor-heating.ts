/**
 * Wet-screed underfloor heating (EN 1264 type A): EN 1264-2 characteristic, water cells along the loop and a screed node
 * per cell at the pipe plane, coupled up to the room and down through the insulation.
 * Data provenance, equations and calibration: docs/UNDERFLOOR-HEATING.md.
 */
import { prop, type Component, type Project } from './model';
import { WATER_CP, WATER_RHO } from './units';
import { exchangeWeight } from './panel-radiator';
import { resolveAmbient, spaceTemperature } from './environment';
import { outdoorTemperature, type ThermalElement } from './thermal-spaces';
import {
  BASE_CURVE_EXPONENT, BASE_CURVE_K, EN1264_ALPHA, EN1264_B, EN1264_COVER_REF, EN1264_LAMBDA_REF, FLOORTEC_B,
  coverFactor, coverings, diameterFactor, floortec, spacingFactor, spacings,
} from './underfloor-heating-data';
export { floortec, FLOORTEC_B, EN1264_B } from './underfloor-heating-data';

/** Water and screed cells along the loop (each over an equal share of the heated area). */
export const FLOOR_CELLS = 16;
export const screedKey = (id: string) => `${id}#screed`;
export const belowKey = (id: string) => `${id}#below`;

const interpolate = (xs: readonly number[], ys: readonly number[], x: number) => {
  const i = Math.max(0, Math.min(xs.length - 2, xs.findIndex((_, k) => x <= xs[k + 1])));
  const f = (x - xs[i]) / (xs[i + 1] - xs[i]);
  return ys[i] * (1 - f) + ys[i + 1] * f;
};
/** Factor of a T × R_λ,B table, linear in spacing and in covering resistance. */
const tableFactor = (table: readonly (readonly number[])[], spacing: number, covering: number) =>
  interpolate(coverings, coverings.map((_, r) => interpolate(spacings, table.map(row => row[r]), spacing)), covering);

export const loopCount = (c: Component) => Math.max(1, Math.round(prop(c, 'loops', 1)));
/** Upward resistance R_o (m²·K/W) from the pipe plane to the room: surface, screed cover above the pipe, covering. */
export const upwardResistance = (c: Component) => 1 / EN1264_ALPHA + prop(c, 'screedCover') / prop(c, 'screedConductivity') + prop(c, 'coveringResistance');
/**
 * EN 1264-2 characteristic coefficient K_H (W/(m²·K)) of q = K_H·Δθ_H for type A (pipes in the screed):
 * K_H = B·a_B·a_T^m_T·a_ü^m_ü·a_D^m_D with m_T = 1 − T/0.075, m_ü = 100·(0.045 − s_u), m_D = 250·(D − 0.020).
 */
export function characteristic(c: Component) {
  const spacing = prop(c, 'pipeSpacing'), covering = prop(c, 'coveringResistance'), cover = prop(c, 'screedCover');
  const aB = (1 / EN1264_ALPHA + EN1264_COVER_REF / EN1264_LAMBDA_REF) / upwardResistance(c);
  const aT = interpolate(coverings, spacingFactor, covering);
  return prop(c, 'systemConstant') * aB * aT ** (1 - spacing / 0.075)
    * tableFactor(coverFactor, spacing, covering) ** (100 * (0.045 - cover))
    * tableFactor(diameterFactor, spacing, covering) ** (250 * (prop(c, 'outerDiameter') - 0.02));
}
/**
 * Per-area conductances (W/(m²·K)) of the node model: water → pipe plane g_wp, plane → room 1/R_o, plane → below 1/R_u.
 * g_wp is chosen so that, with the space below at room temperature, the upward flux is exactly K_H·Δθ_H and the downward
 * flux is EN 1264's q_u = (R_o·q + θ_i − θ_u)/R_u.
 */
export function floorConductances(c: Component) {
  const k = characteristic(c), ro = upwardResistance(c), ru = prop(c, 'downwardResistance');
  return { k, ro, ru, plane: k * (1 + ro / ru) / (1 - ro * k), up: 1 / ro, down: 1 / ru };
}
/** Water per cell capacity (J/K): all loops' water in one cell (fixed mass at the reference density). */
export const floorWaterMass = (c: Component) => WATER_RHO * Math.PI * prop(c, 'diameter') ** 2 / 4 * prop(c, 'length') * loopCount(c);
export const floorCellCapacity = (c: Component) => floorWaterMass(c) / FLOOR_CELLS * WATER_CP;
/** Screed capacity (J/K) of one cell: cover plus the pipe layer, over 1/N of the heated area. */
export const screedCapacity = (c: Component) => prop(c, 'heatedArea') / FLOOR_CELLS * (prop(c, 'screedCover') + prop(c, 'outerDiameter')) * prop(c, 'screedDensity') * prop(c, 'screedSpecificHeat');
/**
 * One interval's cell coupling. Eliminating the implicit screed node S' = (C/h·S + g_wp·X + g_up·T_r + g_dn·T_b)/D,
 * D = C/h + g_wp + g_up + g_dn, leaves the water cell exchanging g_eff·(X − T_eff) with g_eff = g_wp·(D − g_wp)/D and the
 * effective temperature T_eff = (C/h·S + g_up·T_r + g_dn·T_b)/(D − g_wp); X is the cell's exchange temperature. The inlet
 * weight uses the steady series conductance, so the steady chain is the exact exponential (log-mean) profile; it is capped
 * at ṁ·c/g_eff to keep the implicit coefficients non-negative (very low flow).
 */
export function floorExchange(c: Component, dt: number, flowCapacity: number) {
  const g = floorConductances(c), share = prop(c, 'heatedArea') / FLOOR_CELLS;
  const plane = g.plane * share, up = g.up * share, down = g.down * share, storage = dt > 0 ? screedCapacity(c) / dt : 0;
  const d = storage + plane + up + down, rest = d - plane, effective = plane * rest / d, series = plane * (up + down) / (plane + up + down);
  const w = flowCapacity > 0 ? Math.min(exchangeWeight(series / flowCapacity), flowCapacity / effective) : 0;
  return {
    effective, w, up, down,
    ambient: (screed: number, room: number, below: number) => (storage * screed + up * room + down * below) / rest,
    screed: (screed: number, x: number, room: number, below: number) => dt > 0 ? (storage * screed + plane * x + up * room + down * below) / d : screed,
  };
}

/** The floor element under a room (its floor, or the ceiling of the room below), if the room has one. */
export function floorElement(p: Pick<Project, 'thermalElements'>, spaceId: string): ThermalElement | undefined {
  return (p.thermalElements ?? []).find(e => !e.parentId && ((e.kind === 'floor' && e.from === spaceId) || (e.kind === 'ceiling' && e.to === spaceId)));
}
/** True when the loop exchanges with its assigned Thermal Space (no local override). */
export const roomCoupled = (p: Project, c: Component) => !!c.thermalSpaceId && resolveAmbient(p, c).source === 'space';
/**
 * The boundary under the floor (°C): the far side of the room's floor element (outdoors/ground or the room below),
 * the room's outdoor boundary when it has no floor element, or the loop's own ambient outside a room.
 */
export function belowBoundary(p: Project, c: Component): { temperature: number; space?: string } {
  if (!roomCoupled(p, c)) return { temperature: resolveAmbient(p, c).temperature };
  const room = p.thermalSpaces!.find(s => s.id === c.thermalSpaceId)!, e = floorElement(p, room.id);
  const other = e && (e.from === room.id ? e.to : e.from);
  if (!other || other === 'outdoors') return { temperature: outdoorTemperature(p, room) };
  return { temperature: spaceTemperature(p, other), space: other };
}
/** Heated area of room-coupled loops laid on a floor element (it no longer conducts the room air through that area). */
export const heatedFloorArea = (p: Project, e: ThermalElement) => p.components.reduce((sum, c) =>
  sum + (c.kind === 'underfloorHeating' && roomCoupled(p, c) && floorElement(p, c.thermalSpaceId!)?.id === e.id ? prop(c, 'heatedArea') : 0), 0);

/** Mean floor surface temperature (°C) for an upward flux q (W/m²) by the EN 1264 base curve. */
export const surfaceTemperature = (q: number, room: number) => room + Math.sign(q) * (Math.abs(q) / BASE_CURVE_K) ** (1 / BASE_CURVE_EXPONENT);
/** Limit heat flux q_G (W/m²) of the base curve at a maximum surface temperature. */
export const limitFlux = (maxSurface: number, room: number) => BASE_CURVE_K * Math.max(0, maxSurface - room) ** BASE_CURVE_EXPONENT;
/** Steady upward flux (W/m²) at a log-mean excess, the space below at room temperature. */
export const steadyFlux = (c: Component, excess: number) => characteristic(c) * excess;
/** Steady return temperature and upward output (W) for supply, mass flow and room (space below at room temperature). */
export function steadyLoop(c: Component, supply: number, massFlow: number, room: number) {
  const g = floorConductances(c), area = prop(c, 'heatedArea'), series = g.k * (1 + g.ro / g.ru) * area;
  if (massFlow <= 0) return { ret: room, output: 0, downward: 0 };
  const ret = room + (supply - room) * Math.exp(-series / (massFlow * WATER_CP)), total = massFlow * WATER_CP * (supply - ret);
  return { ret, output: total * g.ru / (g.ru + g.ro), downward: total * g.ro / (g.ru + g.ro) };
}

export type FloorBasisKind = 'manufacturer' | 'standard' | 'fitted' | 'assumed';
export const floorBasisLabels: Record<FloorBasisKind, string> = {
  manufacturer: 'Manufacturer data (FLOORTEC)',
  standard: 'EN 1264 calculation method',
  fitted: 'Fitted to manufacturer tables',
  assumed: 'Model assumptions (not from FLOORTEC or EN 1264)',
};
/** Data provenance of the selected configuration (it may since have been edited). */
export function floorModelBasis(c: Component): { kind: FloorBasisKind; text: string }[] {
  const catalog = prop(c, 'systemConstant') === FLOORTEC_B && prop(c, 'outerDiameter') === 0.016 && prop(c, 'wallThickness') === 0.002 && prop(c, 'screedCover') === floortec.cover;
  const g = floorConductances(c);
  return [
    { kind: 'manufacturer', text: catalog
      ? `${floortec.system} with the ${floortec.pipe} (${floortec.water} L/m, ${floortec.mass} kg/m, λ ${floortec.conductivity} W/(m·K), roughness ${floortec.roughness * 1000} mm, ${floortec.maxTemperature} °C / ${floortec.maxPressure / 1e5} bar), 45 mm screed cover; heat flux tables for R_λ,B 0–0.15 m²K/W and spacings 100–300 mm (${floortec.source}).`
      : 'None: a custom configuration (system constant, pipe or screed cover edited away from the FLOORTEC tacker system).' },
    { kind: 'standard', text: `EN 1264-2 type A characteristic q = K_H·Δθ_H with K_H = B·a_B·a_T^m_T·a_ü^m_ü·a_D^m_D = ${g.k.toFixed(3)} W/(m²·K) at T ${(prop(c, 'pipeSpacing') * 1000).toFixed(0)} mm, R_λ,B ${prop(c, 'coveringResistance')} m²K/W (factor tables interpolated linearly in T and R_λ,B); Δθ_H log-mean; surface temperature and limit flux from the base curve q = 8.92·Δθ^1.1; upward resistance R_o = 1/10.8 + s_u/λ_E + R_λ,B = ${g.ro.toFixed(4)} m²K/W and downward loss q_u = (R_o·q + θ_i − θ_u)/R_u (EN 1264-2/-3).` },
    { kind: 'fitted', text: `System constant B = ${FLOORTEC_B} W/(m²·K) (EN 1264 standard pipe: ${EN1264_B}) fitted to the 20 FLOORTEC 16 × 2 table points; largest deviation 0.81 %, within the tables' rounding to whole W/m². FLOORTEC tabulates against the arithmetic mean water temperature; the model uses EN 1264's log-mean.` },
    { kind: 'assumed', text: `${FLOOR_CELLS} cells along the loop, each over 1/${FLOOR_CELLS} of the heated area with no heat conduction between them; one screed node per cell at the pipe plane holding the whole screed (${prop(c, 'screedDensity')} kg/m³, ${prop(c, 'screedSpecificHeat')} J/(kg·K), cover + pipe layer); pipe wall heat capacity neglected; covering capacity neglected; constant α = 10.8 W/(m²·K) up; R_u ${prop(c, 'downwardResistance')} m²K/W to the far side of the room's floor element; the same characteristic for reverse flow and for cooling (no dew-point check); parallel loops identical.` },
  ];
}

/** Engineering readouts of the configuration (calculated, never editable). */
export function floorRatingReadouts(c: Component) {
  const g = floorConductances(c), area = prop(c, 'heatedArea'), excess = 15;
  const design = (supply: number, ret: number) => characteristic(c) * (supply - ret) / Math.log((supply - 20) / (ret - 20));
  const capacity = screedCapacity(c) * FLOOR_CELLS + floorCellCapacity(c) * FLOOR_CELLS;
  return [
    { label: 'Characteristic K_H', value: g.k, unit: 'W/(m²·K)', note: 'EN 1264-2, q = K_H·Δθ_H' },
    { label: 'Heat flux at 35/30/20 °C', value: design(35, 30), unit: 'W/m²', note: 'log-mean excess' },
    { label: 'Output at 35/30/20 °C', value: design(35, 30) * area, unit: 'W', note: 'upward, to the room' },
    { label: `Output at Δθ_H ${excess} K`, value: g.k * excess * area, unit: 'W' },
    { label: 'Limit heat flux q_G', value: limitFlux(prop(c, 'maxSurfaceTemperature'), 20), unit: 'W/m²', note: 'base curve at 20 °C room' },
    { label: 'Upward resistance R_o', value: g.ro, unit: 'm²K/W', note: '1/10.8 + s_u/λ_E + R_λ,B' },
    { label: 'Downward share', value: 100 * g.ro / (g.ro + g.ru), unit: '%', note: 'R_o/(R_o + R_u), space below at room temperature' },
    { label: 'Loop length', value: prop(c, 'length'), unit: 'm', note: `${loopCount(c)} loop(s)` },
    { label: 'Water content', value: floorWaterMass(c) / WATER_RHO * 1000, unit: 'L' },
    { label: 'Heat capacity', value: capacity, unit: 'J/K', note: 'water + screed' },
    { label: 'Floor time constant', value: capacity / (g.k * (1 + g.ro / g.ru) * area) / 3600, unit: 'h', note: 'C/(K_H·(1 + R_o/R_u)·A), no flow from a uniform start' },
  ];
}
