import { prop, type Component } from './model';

/** RA 2910 scale at Xp = 2 K (Danfoss VDSXG202, pp. 3–5). 0 denotes frost protection. */
const dialTemperatures = [7, 13, 17, 20, 23, 26];
export function trvSetpoint(c: Component): number {
  const dial = Math.max(0, Math.min(5, prop(c, 'dial'))), i = Math.floor(dial);
  return dialTemperatures[i] + (dialTemperatures[Math.min(5, i + 1)] - dialTemperatures[i]) * (dial - i);
}
/** RA-FN 15 Kv at 0, 0.5, 1, 1.5 and 2 K deviation from closure; linear interpolation.
 * Beyond the published 2 K point we assume maximum lift at 3 K (Kvs = 0.90 m³/h).
 * The returned position is effective Kv/Kvs, not measured stem travel.
 */
export function trvPosition(c: Component, sensorTemperature: number): number {
  const deviation = trvSetpoint(c) + 2 - sensorTemperature;
  const points = [[0, 0], [0.5, 0.22], [1, 0.43], [1.5, 0.57], [2, 0.73], [3, 0.9]];
  if (deviation <= 0) return 0;
  for (let i = 1; i < points.length; i++) {
    const [a, ka] = points[i - 1], [b, kb] = points[i];
    if (deviation <= b) return 100 * (ka + (kb - ka) * (deviation - a) / (b - a)) / 0.9;
  }
  return 100;
}
/** Exact first-order sensing response to the interval's held ambient, °C. No energy source. */
export function trvSensorStep(c: Component, previous: number, ambient: number, dt: number): number {
  return previous + (ambient - previous) * -Math.expm1(-dt / prop(c, 'sensorTimeConstant'));
}
