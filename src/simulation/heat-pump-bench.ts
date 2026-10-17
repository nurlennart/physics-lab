/**
 * Test-bench harness for the heat pump: the production controller (`controlHeatPump`), plan and state update run
 * against a held boundary (EN 14511-style: water outlet and air fixed), the compressor at a fixed heating speed.
 * Used by heat-pump.test.ts and scripts/check-heat-pump.mjs to compare defrost cycles with Bosch and measured data;
 * no defrost logic is duplicated here.
 */
import type { Component, Property } from './model';
import type { Simulation } from './engine';
import { advanceHeatPump, controlHeatPump, newHeatPump, planHeatPump, type HeatPumpInputs } from './heat-pump';

export interface BenchDefrost { start: number; end: number; intensive: boolean; water: number; electrical: number; frost: number; residual: number; peakCoil: number; minWaterEvaporating: number;
  /** Cumulative heat and electrical energy of the run at this defrost's end (J): complete cycles integrate between ends. */
  heatAtEnd: number; electricalAtEnd: number }
export interface BenchResult { heat: number; electrical: number; seconds: number; defrosts: BenchDefrost[]; peakResidual: number }

/** Minimal simulation context for the controller: no wired controls, no faults; log messages are collected. */
const context = (log: string[]) => ({ project: { connections: [] }, automation: { input: () => ({ valid: false }), status: {} }, faults: {}, log: (m: string) => log.push(m) }) as unknown as Simulation;

/** Output (W) and COP over complete groups of `group` defrost cycles: between the first and the last group end. */
export function completeCycles(r: BenchResult, group: number) {
  const n = Math.floor((r.defrosts.length - 1) / group) * group;
  if (n < group) return null;
  const a = r.defrosts[0], b = r.defrosts[n], heat = b.heatAtEnd - a.heatAtEnd;
  return { cycles: n, seconds: b.end - a.end, output: heat / (b.end - a.end), cop: heat / (b.electricalAtEnd - a.electricalAtEnd) };
}
/**
 * Run `hours` at air `air` (°C), relative humidity `rh` (%), water held at `water` (°C) and flow `flow` (m³/s), the
 * compressor at `speed` while heating. Records every defrost: duration, heat drawn from the water and electrical input.
 */
export function defrostBench(c: Component, options: { air: number; rh: number; water: number; speed: number; hours: number; flow?: number; props?: Record<string, Property> }): BenchResult {
  const unit = { ...c, props: { ...c.props, relativeHumidity: options.rh, setpoint: 75, backupStages: 0, ...options.props } };
  const st = newHeatPump(unit, options.air), log: string[] = [], s = context(log);
  Object.assign(st, { mode: 'heating', startedAt: -1e9, restartAt: 0, demand: true });
  const result: BenchResult = { heat: 0, electrical: 0, seconds: options.hours * 3600, defrosts: [], peakResidual: 0 };
  let current: BenchDefrost | undefined, evaporating = 0;
  for (let t = 0; t < result.seconds; t++) {
    const x: HeatPumpInputs = { water: options.water, air: options.air, flow: options.flow ?? 16 / 60000, voltage: 230, powered: true, backupVoltage: 0, condensing: 30, evaporating };
    const before = st.mode;
    controlHeatPump(s, unit, st, t, x);
    if (st.mode === 'heating') { st.command = options.speed; st.speed = options.speed; st.demand = true; }
    if (st.mode === 'defrost' && before !== 'defrost') current = { start: t, end: t, intensive: st.intensive, water: 0, electrical: 0, frost: st.frost, residual: st.residualIce, peakCoil: -Infinity, minWaterEvaporating: Infinity, heatAtEnd: 0, electricalAtEnd: 0 };
    if (current && st.mode !== 'defrost') { Object.assign(current, { end: t, heatAtEnd: result.heat, electricalAtEnd: result.electrical }); result.defrosts.push(current); current = undefined; }
    const plan = planHeatPump(unit, st, x, 1);
    advanceHeatPump(unit, st, plan, x, 1, plan.electrical, 0);
    evaporating = plan.point.evaporating;
    result.heat += plan.condenser; result.electrical += plan.electrical;
    result.peakResidual = Math.max(result.peakResidual, st.residualIce);
    if (current) { current.water -= plan.condenser; current.electrical += plan.electrical; current.peakCoil = Math.max(current.peakCoil, st.coilTemperature); current.minWaterEvaporating = Math.min(current.minWaterEvaporating, plan.point.evaporating); }
  }
  return result;
}
