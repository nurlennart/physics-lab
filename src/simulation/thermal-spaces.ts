import { projectAmbient, uid, type Project } from './model';
import { solveLinear } from './linear-algebra';
import { heatedFloorArea, roomCoupled } from './underfloor-heating';
import { GROUND, groundModelError, groundTemperature, isExterior, slabError, slabTransmittance, type SlabOnGround } from './ground';

/** Thermal plans use schematic coordinates, independently of camera zoom and mechanical world geometry. */
export const THERMAL_PLAN_SCALE = 100;
export const AIR_DENSITY = 1.2; // kg/m³, constant dry-air approximation
export const AIR_CP = 1005; // J/(kg K)
export interface ThermalSpace {
  id: string; name: string; x: number; y: number;
  width: number; length: number; height: number; // metres
  initialTemperature: number; // °C
  addedHeatCapacity: number; // J/K, effective contents coupled to the single zone node
  airChangesPerHour: number;
  ventilationMode?: 'ach' | 'flow'; ventilationFlow?: number; // m³/s
  internalGain: number; // W, explicitly supplied external heat
  outdoorTemperature?: number; // absent: global environment
  floorId?: string; buildingId?: string;
}
export interface ThermalElement {
  id: string; name: string;
  kind: 'wall' | 'window' | 'door' | 'floor' | 'ceiling';
  from: string; to: string; // space IDs; the receiving endpoint may be 'outdoors', or 'ground' for a floor
  side?: 'north' | 'south' | 'east' | 'west' | 'floor' | 'ceiling';
  area?: number; // m²; absent: derived from side and owning space
  uValue: number; // W/(m² K)
  heatCapacity: number; // J/K, effective contribution; shared elements allocate half to each space
  parentId?: string; preset?: string;
  slab?: SlabOnGround; // floor facing 'ground' only: EN ISO 13370 data
}
export interface SpaceReading {
  temperature: number; outdoor: number; capacity: number; deviceHeat: number; internalHeat: number;
  adjacentHeat: number; envelopeLoss: number; groundLoss: number; ventilationLoss: number; netHeat: number; rate: number;
  storedEnergy: number; elementFlows: Record<string, number>; deviceFlows: Record<string, number>;
}
export const floorArea = (s: ThermalSpace) => s.width * s.length;
export const roomVolume = (s: ThermalSpace) => floorArea(s) * s.height;
export const outdoorTemperature = (p: Project, s: ThermalSpace) => s.outdoorTemperature ?? projectAmbient(p);
/** Temperature (°C) of an exterior endpoint as seen from a room: its outdoor boundary or the ground. */
export const exteriorTemperature = (p: Project, s: ThermalSpace, endpoint: string) => endpoint === GROUND ? groundTemperature(p) : outdoorTemperature(p, s);
export const roomPerimeter = (s: ThermalSpace) => 2 * (s.width + s.length);
/** Exposed perimeter (m) of a slab-on-ground floor element: as entered, else its room's whole perimeter. */
export const slabPerimeter = (p: Project, e: ThermalElement) => e.slab?.perimeter ?? roomPerimeter(p.thermalSpaces!.find(s => s.id === e.from)!);
/** True when the element's U-value is the EN ISO 13370 transmittance rather than an entered value. */
export const usesSlabTransmittance = (e: ThermalElement) => e.to === GROUND && e.slab?.floorResistance !== undefined;
/** Element U-value, W/(m²·K): EN ISO 13370 for a slab on ground with its floor resistance given (over the gross floor), else as entered. */
export function elementU(p: Project, e: ThermalElement) {
  if (!usesSlabTransmittance(e)) return e.uValue;
  return slabTransmittance(elementArea(p, e), slabPerimeter(p, e), e.slab!.wallThickness, e.slab!.soilConductivity, e.slab!.floorResistance!);
}
export function elementArea(p: Project, e: ThermalElement): number {
  if (e.area !== undefined) return e.area;
  const s = p.thermalSpaces!.find(s => s.id === e.from)!;
  return e.side === 'floor' || e.side === 'ceiling' ? floorArea(s) : (e.side === 'north' || e.side === 'south' ? s.width : s.length) * s.height;
}
/** Conducting area: gross area less openings and, for a floor, the area of underfloor loops laid on it. */
export const opaqueArea = (p: Project, e: ThermalElement) => elementArea(p, e) - (e.kind === 'floor' || e.kind === 'ceiling' ? heatedFloorArea(p, e) : 0) - (p.thermalElements ?? []).filter(o => o.parentId === e.id).reduce((sum, o) => sum + elementArea(p, o), 0);
export const ventilationConductance = (s: ThermalSpace) => AIR_DENSITY * AIR_CP * (s.ventilationMode === 'flow' ? s.ventilationFlow ?? 0 : s.airChangesPerHour * roomVolume(s) / 3600);
export const spaceCapacity = (p: Project, s: ThermalSpace) => AIR_DENSITY * AIR_CP * roomVolume(s) + s.addedHeatCapacity + (p.thermalElements ?? []).reduce((sum, e) => sum + (e.from === s.id || e.to === s.id ? e.heatCapacity / (isExterior(e.to) ? 1 : 2) : 0), 0);
export function makeThermalSpace(x = 0, y = 0, width = 5, length = 4): ThermalSpace {
  return { id: uid(), name: 'Thermal Space', x, y, width, length, height: 2.5, initialTemperature: 20, addedHeatCapacity: width * length * 100000, airChangesPerHour: 0.5, internalGain: 0 };
}
export function makeEnvelope(s: ThermalSpace): ThermalElement[] {
  return (['north', 'south', 'east', 'west', 'floor', 'ceiling'] as const).map(side => ({ id: uid(), name: `${side[0].toUpperCase()}${side.slice(1)}`, kind: side === 'floor' || side === 'ceiling' ? side : 'wall', side, from: s.id, to: 'outdoors', uValue: side === 'floor' ? 0.3 : 0.25, heatCapacity: 0, preset: 'Illustrative insulated construction' }));
}
const finite = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
export function thermalSpaceError(p: Project): string | null {
  if (p.thermalSpaces !== undefined && (!Array.isArray(p.thermalSpaces) || p.thermalSpaces.length > 32)) return 'At most 32 Thermal Spaces are supported.';
  const ground = groundModelError(p.ground); if (ground) return ground;
  if (p.thermalElements !== undefined && (!Array.isArray(p.thermalElements) || p.thermalElements.length > 256)) return 'At most 256 thermal construction elements are supported.';
  const ids = new Set(p.components.map(c => c.id));
  for (const s of p.thermalSpaces ?? []) {
    if (!s || typeof s.id !== 'string' || !s.id || ids.has(s.id) || typeof s.name !== 'string' || !s.name.trim() || s.name.length > 80 || !finite(s.x, -1e6, 1e6) || !finite(s.y, -1e6, 1e6) || ![s.width, s.length, s.height].every(v => finite(v, 0.1, 1000)) || !finite(s.initialTemperature, -100, 500) || !finite(s.addedHeatCapacity, 0, 1e12) || !finite(s.airChangesPerHour, 0, 1000) || !finite(s.internalGain, -1e9, 1e9) || (s.outdoorTemperature !== undefined && !finite(s.outdoorTemperature, -100, 500)) || (s.ventilationMode !== undefined && !['ach', 'flow'].includes(s.ventilationMode)) || (s.ventilationFlow !== undefined && !finite(s.ventilationFlow, 0, 1e6))) return 'Invalid Thermal Space geometry or physical parameters.';
    ids.add(s.id);
  }
  const spaces = new Set((p.thermalSpaces ?? []).map(s => s.id));
  for (const c of p.components) if (c.thermalSpacePinned !== undefined && typeof c.thermalSpacePinned !== "boolean") return `${c.name}: thermal assignment pin must be boolean.`;
  for (const c of p.components) if (c.thermalSpaceId !== undefined && !spaces.has(c.thermalSpaceId)) return `${c.name}: invalid Thermal Space assignment.`;
  for (const e of p.thermalElements ?? []) {
    if (!e || typeof e.id !== 'string' || !e.id || ids.has(e.id) || typeof e.name !== 'string' || e.name.length > 80 || !['wall', 'window', 'door', 'floor', 'ceiling'].includes(e.kind) || !spaces.has(e.from) || (!isExterior(e.to) && !spaces.has(e.to)) || e.from === e.to || !finite(e.uValue, 0, 1e5) || !finite(e.heatCapacity, 0, 1e12) || (e.area !== undefined ? !finite(e.area, 0, 1e6) : !['north', 'south', 'east', 'west', 'floor', 'ceiling'].includes(e.side!))) return 'Invalid thermal construction element.';
    if (e.to === GROUND && (e.kind !== 'floor' || e.parentId)) return `${e.name}: only a floor can rest on the ground.`;
    if (e.slab !== undefined && (e.to !== GROUND || slabError(e.slab))) return e.to !== GROUND ? `${e.name}: slab-on-ground data needs the ground endpoint.` : slabError(e.slab);
    if (!isExterior(e.to) && !e.parentId && (p.thermalElements ?? []).some(x => x !== e && x.from === e.to && x.to === e.from && x.kind === e.kind)) return 'An interior partition must have one shared record, not one per room.';
    ids.add(e.id);
  }
  for (const e of p.thermalElements ?? []) {
    if (e.kind === 'window' || e.kind === 'door') {
      const parent = p.thermalElements?.find(x => x.id === e.parentId);
      if (!parent || parent.kind !== 'wall' || parent.from !== e.from || parent.to !== e.to || e.area === undefined) return 'Windows and doors must belong to a wall with the same thermal endpoints.';
    } else if (e.parentId) return 'Only windows and doors can be openings.';
    if ((e.kind === 'floor' || e.kind === 'ceiling') && opaqueArea(p, e) < 0) return `Underfloor heating covers more than the ${e.name} element's area.`;
    if (opaqueArea(p, e) < 0) return 'Window and door areas exceed the parent wall area.';
  }
  for (const s of p.thermalSpaces ?? []) {
    const heated = p.components.reduce((sum, c) => sum + (c.kind === 'underfloorHeating' && c.thermalSpaceId === s.id && roomCoupled(p, c) ? c.props.heatedArea as number : 0), 0);
    if (heated > floorArea(s) * (1 + 1e-9)) return `${s.name}: underfloor heating covers ${heated.toFixed(1)} m², more than the ${floorArea(s).toFixed(1)} m² floor.`;
  }
  if (p.challenge && ((p.thermalSpaces?.length ?? 0) > 0 || (p.thermalElements?.length ?? 0) > 0)) return 'Thermal Spaces are available in Free Sandbox; challenge environments are locked.';
  return null;
}
export function roomMatrix(p: Project, old: Record<string, number>, h: number) {
  const spaces = p.thermalSpaces ?? [], index = new Map(spaces.map((s, i) => [s.id, i]));
  const a = spaces.map(() => spaces.map(() => 0)), b = spaces.map(() => 0);
  spaces.forEach((s, i) => { const c = spaceCapacity(p, s) / h, g = ventilationConductance(s); a[i][i] = c + g; b[i] = c * old[s.id] + g * outdoorTemperature(p, s) + s.internalGain; });
  for (const e of p.thermalElements ?? []) {
    const i = index.get(e.from)!, j = index.get(e.to), g = elementU(p, e) * opaqueArea(p, e);
    a[i][i] += g;
    if (j === undefined) b[i] += g * exteriorTemperature(p, spaces[i], e.to);
    else { a[j][j] += g; a[i][j] -= g; a[j][i] -= g; }
  }
  return { a, b, index };
}
/** Shared zone rows for engine coupling and independent analytical validation. */
export function solveRoomBalance(p: Project, old: Record<string, number>, h: number, input: Record<string, number> = {}) {
  const { a, b } = roomMatrix(p, old, h);
  (p.thermalSpaces ?? []).forEach((s, i) => b[i] += input[s.id] ?? 0);
  const t = a.length ? solveLinear(a, b) : [];
  return Object.fromEntries((p.thermalSpaces ?? []).map((s, i) => [s.id, t[i]]));
}

export const roomMeasurements = ['roomTemperature', 'heatInput', 'internalHeat', 'adjacentHeat', 'envelopeLoss', 'groundLoss', 'ventilationLoss', 'netHeat', 'storedThermalEnergy', 'temperatureRate', 'effectiveHeatCapacity'] as const;
export function roomMeasurement(p: Project, temperatures: Record<string, number>, readings: Record<string, SpaceReading>, id: string, metric: string): number | null {
  const room = p.thermalSpaces?.find(s => s.id === id); if (!room || !(roomMeasurements as readonly string[]).includes(metric)) return null;
  const r = readings[id], t = temperatures[id] ?? room.initialTemperature;
  if (metric === 'roomTemperature') return t;
  if (metric === 'storedThermalEnergy') return spaceCapacity(p, room) * (t - room.initialTemperature);
  if (metric === 'effectiveHeatCapacity') return spaceCapacity(p, room);
  if (metric === 'heatInput') return r?.deviceHeat ?? 0;
  if (metric === 'internalHeat') return room.internalGain;
  if (metric === 'temperatureRate') return r?.rate ?? 0;
  return r && metric in r ? r[metric as keyof SpaceReading] as number : 0;
}
