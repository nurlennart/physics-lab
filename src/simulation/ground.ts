/**
 * Ground under Thermal Spaces: the `ground` endpoint of floor elements, the boundary temperature behind it and the
 * EN ISO 13370 slab-on-ground transmittance. Equations, scope and provenance: docs/GROUND.md.
 *
 * The endpoint and the boundary model are separate on purpose. Elements only ever name `ground`; every temperature
 * behind it comes from groundTemperature(). A seasonal or dynamic (soil node) model adds a GroundModel variant and its
 * case there (a dynamic one also its state rows), without touching the elements, the underfloor loop or saved files.
 */
import type { Project } from './model';

/** Receiving endpoint of a floor element that rests on the ground. */
export const GROUND = 'ground';
/** Endpoints outside every Thermal Space: they take all of an element's capacity and leave the ledger as ambient energy. */
export const isExterior = (endpoint: string) => endpoint === 'outdoors' || endpoint === GROUND;

/**
 * Boundary model behind the `ground` endpoint. `fixed`: one constant temperature, the steady-state boundary of
 * EN ISO 13370 (the annual mean external temperature). No seasonal (periodic) part and no soil storage.
 */
export type GroundModel = { kind: 'fixed'; temperature: number };
/** Assumed annual mean external temperature, °C (roughly central Europe). An editable assumption, not a site value. */
export const DEFAULT_GROUND_TEMPERATURE = 10;
export const groundModel = (p: Pick<Project, 'ground'>): GroundModel => p.ground ?? { kind: 'fixed', temperature: DEFAULT_GROUND_TEMPERATURE };
/** Temperature behind the ground endpoint, °C. */
export function groundTemperature(p: Pick<Project, 'ground'>): number {
  const g = groundModel(p);
  switch (g.kind) {
    case 'fixed': return g.temperature;
  }
}
export function groundModelError(g: unknown): string | null {
  if (g === undefined) return null;
  const m = g as GroundModel;
  if (!m || typeof m !== 'object' || m.kind !== 'fixed') return 'Unknown ground model.';
  if (typeof m.temperature !== 'number' || !Number.isFinite(m.temperature) || m.temperature < -50 || m.temperature > 50) return 'Ground temperature must be between −50 and 50 °C.';
  return null;
}

/** EN ISO 13370 / EN ISO 6946 surface resistances (m²·K/W): internal for downward heat flow, external. */
export const ISO13370_RSI = 0.17;
export const ISO13370_RSE = 0.04;
/** EN ISO 13370 soil conductivity, W/(m·K), when the soil is unknown (category 2, sand or gravel; clay or silt 1.5, rock 3.5). */
export const DEFAULT_SOIL_CONDUCTIVITY = 2.0;
/** Assumed full thickness of the external walls, m. */
export const DEFAULT_WALL_THICKNESS = 0.3;

/**
 * Slab-on-ground data of a floor element facing `ground`. With floorResistance set the element's U-value is the
 * EN ISO 13370 transmittance; without it the entered U-value stands. perimeter absent: the room's whole perimeter.
 */
export interface SlabOnGround {
  perimeter?: number; // m, exposed perimeter
  wallThickness: number; // m, w
  soilConductivity: number; // W/(m·K), λ
  floorResistance?: number; // m²·K/W, R_f: all floor layers, no surface resistances
}
export const defaultSlab = (): SlabOnGround => ({ wallThickness: DEFAULT_WALL_THICKNESS, soilConductivity: DEFAULT_SOIL_CONDUCTIVITY });

/** Characteristic dimension B′ = A/(½P), m. */
export const characteristicDimension = (area: number, perimeter: number) => area / (0.5 * perimeter);
/** Total equivalent thickness d_t = w + λ·(R_si + R_f + R_se), m. */
export const equivalentThickness = (wallThickness: number, soil: number, floorResistance: number) =>
  wallThickness + soil * (ISO13370_RSI + floorResistance + ISO13370_RSE);
/**
 * EN ISO 13370 steady-state transmittance of a slab on ground, W/(m²·K):
 * d_t < B′ (uninsulated, moderately insulated): U = 2λ/(πB′ + d_t)·ln(πB′/d_t + 1); otherwise U = λ/(0.457·B′ + d_t).
 */
export function slabTransmittance(area: number, perimeter: number, wallThickness: number, soil: number, floorResistance: number) {
  const b = characteristicDimension(area, perimeter), dt = equivalentThickness(wallThickness, soil, floorResistance);
  return dt < b ? 2 * soil / (Math.PI * b + dt) * Math.log(Math.PI * b / dt + 1) : soil / (0.457 * b + dt);
}
/**
 * Resistance (m²·K/W) between the underside of a floor construction R_f and the ground boundary: 1/U − R_si − R_f, the
 * soil's share of the same ISO 13370 calculation (and the external surface). Adding it below R_f once reproduces U.
 */
export const soilResistance = (area: number, perimeter: number, wallThickness: number, soil: number, floorResistance: number) =>
  1 / slabTransmittance(area, perimeter, wallThickness, soil, floorResistance) - ISO13370_RSI - floorResistance;
export function slabError(s: unknown): string | null {
  const v = s as SlabOnGround, ok = (x: unknown, min: number, max: number) => typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max;
  if (!v || typeof v !== 'object' || !ok(v.wallThickness, 0, 2) || !ok(v.soilConductivity, 0.1, 10)
    || (v.perimeter !== undefined && !ok(v.perimeter, 0.1, 1e5)) || (v.floorResistance !== undefined && !ok(v.floorResistance, 0, 50)))
    return 'Invalid slab-on-ground data (wall 0–2 m, soil 0.1–10 W/(m·K), perimeter > 0, R_f 0–50 m²·K/W).';
  return null;
}
