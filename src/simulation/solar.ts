/** Averaged renewable-energy models. All dynamic memory belongs to Devices, including rollback. */
import { prop, type Component, type Project } from './model';
import type { ElectricalResult } from './electrical-core';

export const solarKinds = ['solarPanel', 'lfpBattery', 'mpptController', 'inverter', 'batteryProtection'];
export interface SolarState {
  target: number; direction: number; previousPower: number; elapsed: number;
  mode: string; absorption: number; running: boolean; overload: number;
  generated: number; output: number; lost: number;
}
export function initialSolarState(c: Component): SolarState {
  return { target: prop(c, 'initialTrackingVoltage', 40), direction: 1, previousPower: 0, elapsed: 0, mode: 'off', absorption: 0, running: false, overload: 0, generated: 0, output: 0, lost: 0 };
}
const fitCache = new Map<string, { a: number; rs: number; i0: number }>();
/** Fit the no-shunt single diode to Isc, Voc, Vmpp, Impp and d(VI)/dV=0. Shunt resistance is infinite. */
export function pvFit(c: Component) {
  const voc = prop(c, 'voc'), isc = prop(c, 'isc'), vm = prop(c, 'vmp'), im = prop(c, 'imp');
  const key = [voc, isc, vm, im].join(':');
  const cached = fitCache.get(key); if (cached) return cached;
  if (!(voc > vm && vm > 0 && isc > im && im > 0)) throw Error(`${c.name}: require Voc > Vmpp > 0 and Isc > Impp > 0.`);
  const evaluate = (a: number) => {
    const i0 = isc / Math.expm1(voc / a), rs = vm / im - a / (isc - im + i0);
    return { a, rs, i0, residual: a * Math.log1p((isc - im) / i0) - rs * im - vm };
  };
  let lo = voc / 700, hi = voc;
  for (let k = 0; k < 80; k++) { const mid = (lo + hi) / 2; if (evaluate(mid).residual < 0) lo = mid; else hi = mid; }
  const fit = evaluate((lo + hi) / 2);
  if (fit.rs < 0 || Math.abs(fit.residual) > 1e-7) throw Error(`${c.name}: STC ratings cannot fit a positive-series-resistance single diode.`);
  fitCache.set(key, fit); return fit;
}
/** Environment scaling preserves measured Isc and Voc coefficients; ideality voltage scales with absolute T. */
export function pvModel(c: Component) {
  const fit = pvFit(c), t = prop(c, 'cellTemperature') - 25;
  const g = c.props.enabled === false ? 0 : prop(c, 'irradiance') / 1000 * (1 - prop(c, 'shading') / 100);
  const a = fit.a * (298.15 + t) / 298.15, photo = prop(c, 'isc') * g * (1 + prop(c, 'currentCoefficient') * t);
  const vocT = prop(c, 'voc') * (1 + prop(c, 'voltageCoefficient') * t);
  const i0 = prop(c, 'isc') * (1 + prop(c, 'currentCoefficient') * t) / Math.expm1(vocT / a);
  const voc = a * Math.log1p(photo / i0), rs = fit.rs;
  // Solve junction voltage u = V + Rs·I by monotone bisection. Exponent limited only outside float range.
  const at = (v: number) => {
    let lo = Math.min(v, 0) - rs * i0, hi = Math.max(v, voc) + rs * photo;
    for (let k = 0; k < 65; k++) { const u = (lo + hi) / 2; const f = u - v - rs * (photo - i0 * Math.expm1(Math.min(700, u / a))); if (f > 0) hi = u; else lo = u; }
    const u = (lo + hi) / 2, diode = i0 * Math.exp(Math.min(700, u / a)) / a;
    return { current: photo - i0 * Math.expm1(Math.min(700, u / a)), slope: -diode / (1 + rs * diode) };
  };
  let lo = 0, hi = voc;
  for (let k = 0; k < 60; k++) { const v = (lo + hi) / 2, x = at(v); if (x.current + v * x.slope > 0) lo = v; else hi = v; }
  const vmp = (lo + hi) / 2, imp = at(vmp).current;
  return { at, voc, isc: at(0).current, vmp, imp, pmp: vmp * imp, irradiation: prop(c, 'area') * prop(c, 'irradiance') };
}
/** Idle + load-proportional switching + I² conduction loss. The configured peak is an upper bound. */
export function inverterLoss(c: Component, active: number, apparent = active) {
  const idle = prop(c, 'idlePower'), peakLoad = prop(c, 'ratedPower') / 2, excess = 100 / prop(c, 'peakEfficiency') - 1;
  if (2 * idle / peakLoad <= excess) {
    const switching = excess - 2 * idle / peakLoad;
    return idle + switching * active + idle * (apparent / peakLoad) ** 2;
  }
  // When idle consumption makes the requested half-load peak impossible, the maximum
  // occurs above it at 2 Pidle/(1/η − 1). No negative switching-loss coefficient is used.
  return idle + excess * excess * apparent * apparent / (4 * idle);
}
export function advanceSolar(project: Project, states: Record<string, SolarState>, r: ElectricalResult, h: number) {
  for (const c of project.components.filter(c => solarKinds.includes(c.kind))) {
    const s = states[c.id], x = r.readings[c.id]; if (!s || !x) continue;
    s.generated += (x.solar?.inputPower ?? 0) * h;
    s.output += (x.solar?.outputPower ?? (c.kind === 'solarPanel' ? -x.power : 0)) * h;
    s.lost += (x.heatPower ?? 0) * h;
    s.mode = x.solar?.mode ?? 'off'; s.running = !!x.solar?.running;
    if (c.kind === 'mpptController') {
      if (x.solar?.targetVoltage !== undefined) s.target = x.solar.targetVoltage;
      if (s.mode === 'absorption') s.absorption += h;
      if ((x.secondaryVoltage ?? 0) < prop(c, 'rebulkVoltage')) s.absorption = 0;
      s.elapsed = s.running ? s.elapsed + h : 0;
      if (s.running && s.elapsed + 1e-12 >= prop(c, 'trackingInterval')) {
        const power = x.solar?.inputPower ?? 0;
        if (x.solar?.trackingActive) {
          if (power < s.previousPower - 1e-7) s.direction *= -1;
          s.target = Math.max(1, Math.min(prop(c, 'maxInputVoltage') - 0.1, s.target + s.direction * prop(c, 'trackingStep')));
          s.previousPower = power;
        }
        s.elapsed = 0;
      }
    }
    if (c.kind === 'inverter') s.overload = (x.solar?.outputPower ?? 0) > prop(c, 'ratedPower') || (x.solar?.apparentPower ?? 0) > prop(c, 'ratedApparentPower') ? s.overload + h : 0;
  }
}
