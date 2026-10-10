/**
 * Centralised liquid-water properties.
 *
 * Viscosity: IAPWS R12-08 (2008), "Release on the IAPWS Formulation 2008 for the
 * Viscosity of Ordinary Water Substance", equations (10)–(12) with the critical
 * enhancement μ̄₂ = 1 (it matters only within ~±1 K of the critical point).
 * The formulation needs density; at 1 atm it is taken from Kell (1975),
 * J. Chem. Eng. Data 20(1):97–105, valid 0–150 °C (±0.01 kg/m³ below 100 °C).
 *
 * Model decision (documented in docs/PHYSICS.md): density and specific heat stay
 * the constant model values ρ = 1000 kg/m³ and c_p = 4180 J/kg·K for mass,
 * volume, hydrostatics and enthalpy. Over 1–95 °C real density varies by 3.8 %
 * and c_p by 1 %; making them variable would require thermal expansion of tank
 * inventories, a pressure–volume-consistent energy ledger and variable-density
 * hydrostatics, which are not implemented. Only the viscosity, which changes
 * 4-fold over the range and directly sets laminar/transitional friction, varies.
 */
export const WATER_MODEL_DENSITY = 1000;
export const WATER_MODEL_CP = 4180;
/** Liquid water at 1 atm: below 0 °C it freezes, above 99.97 °C it boils. */
export const LIQUID_RANGE_C: [number, number] = [0, 100];

/** Kell (1975) density of air-free liquid water at 1 atm, kg/m³ (T in °C, 0–150 °C). */
export function kellDensity(celsius: number) {
  const t = celsius;
  return (999.83952 + 16.945176 * t - 7.9870401e-3 * t ** 2 - 46.170461e-6 * t ** 3 + 105.56302e-9 * t ** 4 - 280.54253e-12 * t ** 5) / (1 + 16.87985e-3 * t);
}
const H0 = [1.67752, 2.20462, 0.6366564, -0.241605];
/** Non-zero H_ij of IAPWS R12-08 Table 2 as [i, j, H_ij]. */
const HIJ: [number, number, number][] = [
  [0, 0, 5.20094e-1], [1, 0, 8.50895e-2], [2, 0, -1.08374], [3, 0, -2.89555e-1],
  [0, 1, 2.22531e-1], [1, 1, 9.99115e-1], [2, 1, 1.88797], [3, 1, 1.26613], [5, 1, 1.20573e-1],
  [0, 2, -2.81378e-1], [1, 2, -9.06851e-1], [2, 2, -7.72479e-1], [3, 2, -4.89837e-1], [4, 2, -2.5704e-1],
  [0, 3, 1.61913e-1], [1, 3, 2.57399e-1],
  [0, 4, -3.25372e-2], [3, 4, 6.98452e-2],
  [4, 5, 8.72102e-3],
  [3, 6, -4.35673e-3], [5, 6, -5.93264e-4],
];
/** IAPWS 2008 dynamic viscosity (Pa·s) from temperature (K) and density (kg/m³), μ̄₂ = 1. */
export function iapwsViscosity(kelvin: number, density: number) {
  const t = kelvin / 647.096, d = density / 322;
  const mu0 = (100 * Math.sqrt(t)) / H0.reduce((sum, h, i) => sum + h / t ** i, 0);
  const x = 1 / t - 1, y = d - 1;
  const mu1 = Math.exp(d * HIJ.reduce((sum, [i, j, h]) => sum + h * x ** i * y ** j, 0));
  return mu0 * mu1 * 1e-6;
}
export class WaterPropertyError extends Error {}
/** Dynamic viscosity of liquid water at 1 atm (Pa·s). Throws outside the liquid range; never extrapolates. */
export function waterViscosity(celsius: number) {
  if (!Number.isFinite(celsius) || celsius < LIQUID_RANGE_C[0] || celsius > LIQUID_RANGE_C[1])
    throw new WaterPropertyError(`Water viscosity requested at ${Number.isFinite(celsius) ? celsius.toFixed(2) : celsius} °C, outside the liquid range 0–100 °C at 1 atm (IAPWS 2008 + Kell 1975).`);
  return iapwsViscosity(celsius + 273.15, kellDensity(celsius));
}
const cache = new Map<number, number>();
/** Viscosity from a temperature in kelvin, memoised to 0.01 K (property evaluation is on the hot path). */
export function viscosityK(kelvin: number) {
  const key = Math.round(kelvin * 100);
  let mu = cache.get(key);
  if (mu === undefined) {
    mu = waterViscosity(key / 100 - 273.15);
    if (cache.size > 20000) cache.clear();
    cache.set(key, mu);
  }
  return mu;
}
