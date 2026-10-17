/**
 * Inspector tables of the heat pump model, cached by their actual inputs: the Bosch reference comparison depends only
 * on the published points and the fitted cycle constants (computed once); the characteristic depends on the flow
 * temperature shown and the unit's electrical limit (rated voltage, maximum current). Telemetry updates do not
 * recompute either table.
 */
import { prop, type Component } from './model';
import { electricalLimit, envelopeMaxFlow, heatingPoint, maxSpeed, MIN_SPEED, pointCOP, speedForOutput } from './heat-pump';
import { ratingPoints } from './heat-pump-data';

export interface ReferenceRow { label: string; output: number; fit: boolean; bosch: number; model: number }
export interface CharacteristicRow { air: number; range: { min: number; max: number; minCOP: number; maxCOP: number } | null }

let reference: ReferenceRow[] | undefined;
/** Steady model COP at every published Bosch point (published output imposed). */
export function referenceTable(): ReferenceRow[] {
  return reference ??= ratingPoints.map(r => ({ label: r.label, output: r.output, fit: r.fit, bosch: r.cop, model: pointCOP(heatingPoint(speedForOutput(r.output, r.air, r.flow), r.air, r.flow)) }));
}

const AIRS = [-20, -10, -7, 2, 7, 12];
const characteristics = new Map<string, CharacteristicRow[]>();
/** Flow temperature (°C) the characteristic is evaluated at: the target, at least 25 °C, to the displayed whole degree. */
export const characteristicFlow = (target: number) => Math.round(Math.max(25, target));
/** Minimum- and maximum-output points (frost-free) at −20…+12 °C for one flow temperature and electrical limit. */
export function characteristicTable(c: Component, flow: number): CharacteristicRow[] {
  const voltage = prop(c, 'ratedVoltage'), current = prop(c, 'maxCurrent'), key = `${flow}|${voltage}|${current}`;
  const cached = characteristics.get(key);
  if (cached) return cached;
  const limit = electricalLimit(c, voltage) - 15;
  const rows = AIRS.map(air => {
    if (!Number.isFinite(envelopeMaxFlow(air)) || flow > envelopeMaxFlow(air)) return { air, range: null };
    let n = maxSpeed(air), top = heatingPoint(n, air, flow);
    if (top.compressor + top.fan > limit) {
      let lo = 0, hi = n;
      for (let k = 0; k < 40; k++) { const x = (lo + hi) / 2, p = heatingPoint(x, air, flow); if (p.compressor + p.fan > limit) hi = x; else lo = x; }
      n = lo; top = heatingPoint(n, air, flow);
    }
    const low = heatingPoint(MIN_SPEED, air, flow);
    return { air, range: { max: top.condenser, maxCOP: pointCOP(top), min: low.condenser, minCOP: pointCOP(low) } };
  });
  if (characteristics.size > 64) characteristics.clear();
  characteristics.set(key, rows);
  return rows;
}
