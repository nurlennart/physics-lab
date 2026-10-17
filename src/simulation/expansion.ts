/**
 * Membrane expansion vessel and spring-loaded safety valve of a sealed heating circuit.
 * Data provenance, equations and calibration: docs/STORAGE-AND-PRESSURE.md.
 *
 * Vessel: an isothermal gas cushion (nitrogen precharge p₀ filling the nominal volume V_n with the water side empty)
 * compressed by the water side volume V_w:   p_abs = p₀,abs·V_n/(V_n − V_w).
 * The circuit's water keeps its fixed (reference-density) masses in the transport cells. Thermal expansion is the
 * volume those masses occupy beyond their volume at the fill state, E = Σ m_i·(1/ρ(T_i) − 1/ρ(T_i,fill)) (Kell),
 * and is displaced into the vessel: V_w = V_w,fill + E − V_lost, where V_lost is water discharged by safety valves.
 */
import { prop, type Component } from './model';
import { WATER_RHO as RHO } from './units';
import { kellDensity } from './water';
import { vaporPressure } from './hydraulic';

export const ATMOSPHERE = 101325;
/** Isothermal compressibility of liquid water near 20–60 °C (1/Pa); stiffness of a circuit whose vessel is empty. */
export const WATER_COMPRESSIBILITY = 4.5e-10;
/** Below this share of the nominal volume the gas law continues linearly (the membrane bottoms out). */
const MIN_GAS_SHARE = 0.02;

export interface VesselState {
  /** Ledger water (kg) and its enthalpy (J): changes only with discharged water. */
  mass: number; enthalpy: number; temperature: number;
  /** Water-side volume at the fill state (m³); null until the first solve knows the circuit volume. */
  fillWater: number | null;
  /** Last evaluated water-side volume, thermal expansion since fill (m³), circuit water volume (m³) and gauge pressure (Pa). */
  water: number; expansion: number; system: number; pressure: number;
  /** Rate of the gauge pressure over the last accepted substep (Pa/s). */
  rate: number;
}
export const newVessel = (c: Component): VesselState => {
  const temperature = prop(c, 'initialTemperature', 20) + 273.15;
  return { mass: 0, enthalpy: 0, temperature, fillWater: null, water: 0, expansion: 0, system: 0, pressure: prop(c, 'fillPressure'), rate: 0 };
};
/** Water-side volume (m³) that holds a gauge pressure p in the gas cushion (inverse of vesselPressure for V_w ≥ 0). */
export function waterAtPressure(c: Component, gauge: number, system: number) {
  const vn = prop(c, 'nominalVolume') / 1000, p0 = prop(c, 'precharge') + ATMOSPHERE, p = gauge + ATMOSPHERE;
  if (gauge <= prop(c, 'precharge')) return (gauge - prop(c, 'precharge')) * WATER_COMPRESSIBILITY * Math.max(system, 1e-4);
  return vn * (1 - p0 / p);
}
/**
 * Gauge pressure (Pa) of the cushion for a water-side volume V_w (m³). V_w < 0: the vessel is empty and the rigid
 * circuit's water is decompressed (κ·V_system), bounded below by vapour pressure. Near a fully compressed cushion the
 * gas law continues with its own slope (the membrane is backed by the vessel shell).
 */
export function vesselPressure(c: Component, water: number, system: number, celsius = 20) {
  const vn = prop(c, 'nominalVolume') / 1000, p0 = prop(c, 'precharge') + ATMOSPHERE;
  if (water <= 0) return Math.max(vaporPressure(celsius) - ATMOSPHERE, prop(c, 'precharge') + water / (WATER_COMPRESSIBILITY * Math.max(system, 1e-4)));
  const minGas = MIN_GAS_SHARE * vn, gas = vn - water;
  if (gas >= minGas) return p0 * vn / gas - ATMOSPHERE;
  return p0 * vn / minGas + p0 * vn / (minGas * minGas) * (minGas - gas) - ATMOSPHERE;
}
/** Cushion stiffness dp/dV_w (Pa/m³) at a water-side volume. */
export function vesselStiffness(c: Component, water: number, system: number) {
  const dv = Math.max(1e-9, 1e-6 * prop(c, 'nominalVolume') / 1000);
  return (vesselPressure(c, water + dv, system) - vesselPressure(c, water - dv, system)) / (2 * dv);
}
/** Kell density (kg/m³) of each cell temperature (K). */
export const cellDensities = (cells: readonly number[]) => cells.map(t => kellDensity(Math.max(0, Math.min(100, t - 273.15))));
/**
 * Volume (m³) the water of fixed containers occupies at its present temperatures, filled at densities ρ_fill: each cell
 * of container volume V = m/ρ_ref holds the water that filled it, now at V·ρ_fill/ρ(T).
 */
export const inventoryVolumeAt = (mass: number, cells: readonly number[], fill: readonly number[]) => cells.reduce((sum, t, i) => sum + mass / RHO * (fill[i] ?? 1000) / kellDensity(Math.max(0, Math.min(100, t - 273.15))), 0);

/** Spring-loaded safety valve (TRD 721 type "H" for 3 bar heating circuits). */
export const valveSetPoints = (c: Component) => {
  const set = prop(c, 'setPressure');
  return { set, full: set + prop(c, 'fullLiftOverpressure'), reseat: set - prop(c, 'blowdown') };
};
/**
 * Lift (0–100 %) from the differential pressure across the disc. Closed, it lifts when Δp reaches the set pressure;
 * open, the lift is proportional between the reseat pressure and full lift, so it pops partly open at the set
 * pressure and closes again below the reseat pressure (blowdown).
 */
export function valveLift(c: Component, differential: number, lift: number) {
  const { set, full, reseat } = valveSetPoints(c);
  const open = lift > 0 ? differential > reseat : differential >= set;
  return open ? Math.max(0, Math.min(100, (differential - reseat) / (full - reseat) * 100)) : 0;
}
/** Water discharge at full lift (m³/s) for a differential pressure (Pa): Q = K_v·√(Δp/1 bar). */
export const fullLiftFlow = (c: Component, differential: number) => prop(c, 'kvs') / 3600 * Math.sqrt(Math.max(0, differential) / 1e5);

export type PressureBasisKind = 'manufacturer' | 'standard' | 'derived' | 'assumed';
export const pressureBasisLabels: Record<PressureBasisKind, string> = {
  manufacturer: 'Manufacturer data',
  standard: 'Standard or code requirement',
  derived: 'Calculated',
  assumed: 'Model assumptions',
};
export function vesselModelBasis(c: Component): { kind: PressureBasisKind; text: string }[] {
  const bosch = c.variant === 'bosch17';
  return [
    { kind: 'manufacturer', text: bosch
      ? 'Expansion vessel of the Bosch CS6800iAW 12 M indoor unit (installation manual 6721877107, 2025/06): 17 l, factory precharge 0.75 bar, maximum operating pressure 3 bar; fill 0.2–0.5 bar above the precharge, at least 1.3–1.5 bar cold, at most 2.5 bar at maximum water temperature; precharge = 0.1 bar per metre of static height + 0.2 bar.'
      : 'Reflex N 25 (white, 3/1.5 bar): 25 l nominal volume, factory gas precharge 1.5 bar, permissible operating pressure 3 bar, maximum operating temperature at the membrane 70 °C, Ø 308 × 477 mm.' },
    { kind: 'standard', text: 'EN 12828 sizing: the vessel holds the expansion of the whole circuit between fill and maximum temperature plus a water reserve (0.5 % of the system volume, at least 3 l; Bosch: 1 % or 20 % of the nominal volume), at a final pressure 0.5 bar below the safety-valve set pressure.' },
    { kind: 'derived', text: `Water side at fill: V_w = V_n·(1 − p₀,abs/p_fill,abs) = ${(waterAtPressure(c, prop(c, 'fillPressure'), 0.1) * 1000).toFixed(2)} l. Expansion of every modelled inventory of the circuit (pipes, boiler and heat-pump water, radiators, buffer layers, coils) from Kell (1975) densities.` },
    { kind: 'assumed', text: 'Isothermal nitrogen cushion (slow expansion, vessel near room temperature); no gas permeation; the membrane bottoms out below 2 % gas volume; rigid pipework (steel and copper expansion, about a tenth of the water\'s, is neglected) and no unmodelled system volume; vessel water at the fill temperature; one vessel per sealed circuit; the cushion\'s compression energy (≈ ∫p·dV, a few kJ) lies outside the constant-c_p enthalpy model — only its work on discharged water is booked.' },
  ];
}
export function safetyValveModelBasis(c: Component): { kind: PressureBasisKind; text: string }[] {
  const { set, full, reseat } = valveSetPoints(c);
  return [
    { kind: 'standard', text: 'TRD 721 §7, valves marked "H" for hot-water generators up to 120 °C: spring loaded, respond at 3.0 bar at the latest, prevent an overpressure above 0.5 bar beyond it, close within 0.5 bar below the set pressure. Size by heat output (Tafel 3: DN 15 up to 50 kW, DN 20 up to 100 kW, DN 25 up to 200 kW).' },
    { kind: 'manufacturer', text: 'Bosch CS6800iAW: maximum operating pressure 3 bar; the discharge hose must lead to a frost-free drain. Bosch WH 290 LP1: drinking-water safety valve at least DN 20, 10 bar.' },
    { kind: 'derived', text: `Set ${(set / 1e5).toFixed(2)} bar, full lift at ${(full / 1e5).toFixed(2)} bar, reseat at ${(reseat / 1e5).toFixed(2)} bar; full-lift water discharge ${(fullLiftFlow(c, set) * 60000).toFixed(1)} l/min at the set pressure.` },
    { kind: 'assumed', text: `Proportional lift between reseat and full-lift pressure with a partial pop at the set pressure (spring valve without disc dynamics); K_v ${prop(c, 'kvs')} m³/h at full lift (a 3 bar heating valve's water capacity is not published; certified capacities are rated as steam); no simmer leakage; the discharged water leaves the system.` },
  ];
}
