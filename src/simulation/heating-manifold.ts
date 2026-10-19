/**
 * Underfloor heating circuit manifold: Oventrop Multidis SF, type 140 43 (stainless steel 1.4301), flow bar with
 * integrated flow-meter and regulating inserts 0–5 l/min, return bar with M 30 × 1.5 valve inserts for thermal
 * actuators. Data provenance, equations and limits: docs/HEATING-MANIFOLD.md.
 */
import { MAX_CIRCUITS, prop, type Component } from './model';

export { MAX_CIRCUITS };
/** Published (Oventrop tender text, type 140 43): kvs per circuit, flow-meter range, operating limits. */
export const multidisSF = {
  type: '140 43', kvs: 1.1, meterRange: 5, maxPressure: 600000, maxTemperature: 80, maxDifferentialPressure: 100000,
  source: 'Oventrop GmbH & Co. KG, tender texts Multidis SF type 140 43 (2–12 circuits) and 140 45, via heinze.de (retrieved 2026-10-19)',
} as const;

export const circuitCount = (c: Component) => Math.max(2, Math.min(MAX_CIRCUITS, Math.round(prop(c, 'circuits', 2))));
export const circuitIndices = (c: Component) => Array.from({ length: circuitCount(c) }, (_, i) => i + 1);
/** Branch key and part of circuit k (1-based). */
export const circuitKey = (id: string, k: number) => `${id}#c${k}`;
export const actuatorKey = circuitKey;
/** Circuit number of a manifold port id (flowK, returnK, actK), or undefined for the main connections. */
export const portCircuit = (port: string) => { const m = /^(?:flow|return|act)(\d+)$/.exec(port); return m ? Number(m[1]) : undefined; };

/**
 * Relative flow coefficient Kv/Kvs of circuit k: the regulating insert's setting times the actuator stroke, each
 * linear (assumption: Oventrop publishes only Kvs; the installer sets the insert by reading the flow meter).
 */
export const circuitFraction = (setting: number, stroke: number) => Math.max(0, Math.min(1, setting / 100)) * Math.max(0, Math.min(1, stroke / 100));
/** Pressure drop (Pa) across the circuit's inserts at volume flow q (m³/s): Δp = 1 bar·(Q/Kv)², Q in m³/h. */
export const insertDrop = (q: number, kv: number) => kv > 0 ? 1e5 * (q * 3600 / kv) ** 2 : Infinity;
/** Flow-meter reading (l/min) of a flow q (m³/s): the sight glass ends at its range. */
export const meterReading = (q: number, range: number) => ({ value: Math.min(Math.abs(q) * 60000, range), beyond: Math.abs(q) * 60000 > range + 1e-9 });

export interface BalanceCircuit { circuit: number; flow: number; planned: number; setting: number; next: number; reachable: boolean }
/**
 * Commissioning calculation (hydraulic balancing) at the measured operating point. With the manifold differential
 * pressure H held at its measured value, circuit k's external path (loop and connection pipes) drops
 * Δp_ext = H − Δp_insert(Q_k) now and is assumed to scale as Q^1.75 (smooth-pipe turbulent law). The insert then gets the
 * Kv that leaves exactly H − Δp_ext(q_k) for the planned flow q_k. A circuit that would need more than Kvs stays fully
 * open and is reported unreachable. H itself changes when the pump meets a different total flow, so commissioning is
 * repeated with the system running, as on site: each round closes most of the remaining error.
 */
export function balance(c: Component, flows: Record<number, number>, stroke: Record<number, number>, differentialPressure: number): BalanceCircuit[] {
  const kvs = prop(c, 'kvs'), out: BalanceCircuit[] = [];
  for (const k of circuitIndices(c)) {
    const setting = prop(c, `setting${k}`), planned = prop(c, `planned${k}`) / 60000, q = Math.abs(flows[k] ?? 0), open = (stroke[k] ?? 100) / 100;
    const kv = kvs * circuitFraction(setting, 100) * open;
    if (q < 1e-9 || open <= 0 || planned <= 0 || differentialPressure <= 0) { out.push({ circuit: k, flow: q, planned, setting, next: setting, reachable: planned <= 0 }); continue; }
    const external = Math.max(0, differentialPressure - insertDrop(q, kv)), needed = external * (planned / q) ** 1.75;
    const left = differentialPressure - needed;
    const kvNeeded = left > 0 ? planned * 3600 / Math.sqrt(left / 1e5) / open : Infinity;
    const next = Math.min(100, 100 * kvNeeded / kvs);
    out.push({ circuit: k, flow: q, planned, setting, next: Math.max(1, Math.round(next * 10) / 10), reachable: kvNeeded <= kvs });
  }
  return out;
}

export const manifoldBasisLabels = { manufacturer: 'Manufacturer data', assumed: 'Assumption', model: 'Model' } as const;
export function manifoldModelBasis(c: Component) {
  return [
    { kind: 'manufacturer' as const, text: `Oventrop Multidis SF type ${multidisSF.type}: kvs ${multidisSF.kvs} m³/h per circuit, flow meters 0–${multidisSF.meterRange} l/min in the flow bar, thermostatable M 30 × 1.5 inserts in the return bar, 6 bar, 80 °C, 1 bar maximum differential pressure (${multidisSF.source}).` },
    { kind: 'assumed' as const, text: `Kv between closed and fully open is linear in the regulating setting and in the actuator stroke; Oventrop publishes only kvs. Thermal actuators are normally closed: an unpowered or invalid command closes the circuit, ${prop(c, 'actuatorTime')} s for the full stroke (typical wax actuators take about 3 minutes; no dead time).` },
    { kind: 'model' as const, text: `Each circuit is one valve branch from the flow bar through its loop to the return bar (inserts in series: kvs is the circuit value). The bars are ideal nodes: no pressure drop along them, no water volume and no heat loss, and the return bar mixes the circuits' returns. A circuit port left unconnected is plugged.` },
  ];
}
