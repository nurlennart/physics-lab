/**
 * Kermi therm-x2 Profil-K panel radiator (EN 442 characteristic, finite water and steel inventory).
 * Data provenance, equations and calibration: docs/PANEL-RADIATOR.md.
 */
import { prop, type Component } from './model';
import { WATER_CP } from './units';
import { kermiModels } from './panel-radiator-data';
export { kermiChartSlope, kermiHydraulics, kermiModels, kermiReference, tablePairs, type KermiModel } from './panel-radiator-data';

/** Inventory cells in series along the flow path (front panel, then rear panel). */
export const PANEL_CELLS = 16;
/** EN 442 standard excess temperature: log-mean of 75/65 °C water in 20 °C air (K). */
export const NOMINAL_EXCESS = 10 / Math.log(55 / 45);
/** Kermi's printed rounding of the same value (Technik, conversion formula p. 162). */
export const KERMI_NOMINAL_EXCESS = 49.83;

/** Characteristic coefficient K_m = Φ₅₀/ΔT₅₀ⁿ (W/Kⁿ) of Φ = K_m·ΔT_ln^n. */
export const panelCoefficient = (c: Component) => prop(c, 'ratedOutput') / NOMINAL_EXCESS ** prop(c, 'exponent');
/** EN 442 steady output (W) at a given log-mean excess temperature; symmetric for water below the air. */
export const en442Output = (c: Component, excess: number) => Math.sign(excess) * panelCoefficient(c) * Math.abs(excess) ** prop(c, 'exponent');
/** Log-mean excess temperature (K) of supply/return water over the air temperature. */
export function logMeanExcess(supply: number, ret: number, air: number) {
  const a = supply - air, b = ret - air;
  if (a * b <= 0) return (a + b) / 2;
  return Math.abs(a - b) < 1e-9 * Math.abs(a) ? (a + b) / 2 : (a - b) / Math.log(a / b);
}
/**
 * Manufacturer method (Kermi Technik p. 162): steady return temperature and output for a supply
 * temperature, mass flow and air temperature, Φ = ṁ·c_p·(T_s − T_r) = K_m·ΔT_ln^n. Used for the Inspector's
 * characteristic and as an independent reference in tests (it does not call the transport model).
 */
export function en442Steady(c: Component, supply: number, massFlow: number, air: number) {
  if (massFlow <= 0 || supply === air) return { output: 0, ret: air };
  const sign = Math.sign(supply - air);
  let lo = 0, hi = Math.abs(supply - air);
  for (let i = 0; i < 200; i++) {
    const excess = (lo + hi) / 2, ret = air + sign * excess, q = massFlow * WATER_CP * Math.abs(supply - ret);
    if (q - Math.abs(en442Output(c, logMeanExcess(supply, ret, air))) > 0) lo = excess; else hi = excess;
  }
  const ret = air + sign * (lo + hi) / 2;
  return { output: massFlow * WATER_CP * (supply - ret), ret };
}
/** Water mass flow (kg/s) that gives the rated 75/65 °C spread at the rated output. */
export const nominalMassFlow = (c: Component) => prop(c, 'ratedOutput') / (WATER_CP * 10);
/** Heat capacity of one cell (J/K): water at the reference density and the lumped steel. */
export const panelCellCapacity = (c: Component) => (prop(c, 'waterVolume') * WATER_CP + prop(c, 'metalMass') * prop(c, 'metalSpecificHeat')) / PANEL_CELLS;
/** Total heat capacity (J/K) of water and steel. */
export const panelCapacity = (c: Component) => panelCellCapacity(c) * PANEL_CELLS;
/**
 * Air temperature (K) the radiator exchanges heat with. The one boundary a future thermal space replaces;
 * today the component's room-air property, an ideal boundary of unlimited capacity.
 */
export const panelAirTemperature = (c: Component) => prop(c, 'ambient', 20) + 273.15;

/**
 * Inlet weight w(x) = 1/x − 1/(eˣ − 1) of a cell's exchange temperature w·T_in + (1 − w)·T, with
 * x = g/(ṁ·c_p). The steady cell then attenuates the excess exactly by e^(−x) (the continuous profile of a
 * uniform conductance); w → ½ at high flow and → 0 without flow, and ṁ·c_p − g·w = g/(eˣ − 1) ≥ 0, so the
 * implicit chain has non-negative coefficients (no over- or undershoot of the air temperature).
 */
export function exchangeWeight(x: number) {
  if (!(x > 0)) return 0.5;
  if (x < 1e-4) return 0.5 - x / 12;
  if (x > 700) return 1 / x;
  return 1 / x - 1 / Math.expm1(x);
}
/**
 * Per-cell conductance g = K_m/N·|ΔT_m|^(n−1) and inlet weight for one interval, from the state at its start:
 * ΔT_m is the mean excess of the cells' exchange temperatures (the log-mean excess in steady state, so the
 * chain reproduces Φ = K_m·ΔT_ln^n). `cells` are in flow order; `inlet` is the upstream water temperature.
 */
export function panelExchange(c: Component, cells: number[], inlet: number | undefined, air: number, flowCapacity: number) {
  const n = cells.length, exponent = prop(c, 'exponent'), k = panelCoefficient(c) / n;
  const mean = (w: number) => cells.reduce((sum, t, i) => sum + w * ((i ? cells[i - 1] : inlet ?? t) - air) + (1 - w) * (t - air), 0) / n;
  const weight = (g: number) => flowCapacity > 0 ? exchangeWeight(g / flowCapacity) : 0;
  let g = k * Math.abs(mean(0)) ** (exponent - 1);
  const excess = mean(weight(g));
  g = k * Math.abs(excess) ** (exponent - 1);
  return { g, w: weight(g), excess };
}

export type PanelBasisKind = 'manufacturer' | 'derived' | 'fitted' | 'assumed';
export const panelBasisLabels: Record<PanelBasisKind, string> = {
  manufacturer: 'Manufacturer data (Kermi Technik)',
  derived: 'Calculated from manufacturer data',
  fitted: 'Fitted to a manufacturer chart',
  assumed: 'Model assumptions (not from Kermi data)',
};
/** Data provenance of the selected configuration (it may since have been edited). */
export function panelModelBasis(c: Component): { kind: PanelBasisKind; text: string }[] {
  const model = kermiModels[c.variant ?? 'standard'];
  const catalog = model && prop(c, 'ratedOutput') === model.output && prop(c, 'exponent') === model.exponent && prop(c, 'waterVolume') === model.water && prop(c, 'metalMass') === model.mass;
  return [
    { kind: 'manufacturer', text: model && catalog
      ? `therm-x2 Profil-K type ${model.type}, ${model.height} × ${model.length} mm (${model.article}): Φ₅₀ = ${model.output} W at 75/65/20 °C (EN 442 registered, φ_SL × length), exponent n = ${model.exponent.toFixed(4)}, ${model.water.toFixed(2)} L water, ${model.mass.toFixed(2)} kg, radiant share ${model.radiant} %, 10 bar / 110 °C. Serial (x2) flow: front panel first.`
      : 'None: a custom configuration (output, exponent, water or steel mass edited away from a Kermi catalog size).' },
    { kind: 'derived', text: `Φ = K_m·ΔT_ln^n with K_m = Φ₅₀/49.83ⁿ = ${panelCoefficient(c).toFixed(3)} W/Kⁿ, exactly Kermi's conversion method; steady return temperature from ṁ·c_p·(T_s − T_r) = Φ. Nominal flow ${(nominalMassFlow(c) * 3600).toFixed(1)} kg/h (10 K spread at Φ₅₀).` },
    { kind: 'fitted', text: `Pressure drop: two-K law (K∞ ${prop(c, 'lossCoefficient')}, K₁ ${prop(c, 'laminarK')}, Ø${(prop(c, 'diameter') * 1000).toFixed(0)} mm) fitted to the Kermi Profil-K line for types ${model?.hydraulic ?? '12–33'}, same-side connection, read from the chart's vector paths; the chart's water temperature is not stated (fit at 70 °C).` },
    { kind: 'assumed', text: `${PANEL_CELLS} well-mixed cells in series (internal mixing and transport delay); steel at the water temperature, c = ${prop(c, 'metalSpecificHeat')} J/(kg·K) for the whole listed mass (covers included); uniform local heat transfer; the same law below the air temperature (EN 442 rates heating only); reverse flow uses the same characteristic (Kermi rates top-in, bottom-out on one side); radiant share only splits the reported output.` },
  ];
}
