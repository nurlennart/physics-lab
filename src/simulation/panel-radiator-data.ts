/** Kermi therm-x2 Profil-K catalog data (no imports: shared by the catalog in model.ts and the model). */
export const kermiReference = {
  title: 'Kermi GmbH, Technik therm-x2 Flachheizkörper (Stand Februar 2018)',
  url: 'https://www.alternative-haustechnik.de/media/8d/23/30/1682398475/db-kermi-x2-fhk.pdf',
  note: 'Manufacturer document, distributor-hosted copy. The 2015 edition (Stand März 2015) has identical registered output data, exponents, weights, water contents and pressure-drop lines.',
};

/**
 * Published Kermi data per catalog variant. Output and exponent: "Registrierte Leistungsdaten" (φ_SL·L, p. 22);
 * weight and water: "Gewicht, Wasserinhalt" (pp. 20–21); pressure group: "Durchflussdiagramm" (p. 148).
 */
/** `table` = published W per metre at 70/55, 55/45 and 45/40 °C with 20 °C air ("Wärmeleistung je Heizkörpermeter", p. 24). */
export interface KermiModel { article: string; type: string; height: number; length: number; output: number; exponent: number; water: number; mass: number; radiant: number; hydraulic: '10/11' | '12-33'; table: [number, number, number] }
/** Table points are the published per-metre outputs; multiply by the length in metres. */
export const tablePairs: [number, number][] = [[70, 55], [55, 45], [45, 40]];
export const kermiModels: Record<string, KermiModel> = {
  standard: { article: 'FK0220610', type: '22', height: 600, length: 1000, output: 1666, exponent: 1.2930, water: 6.08, mass: 29.63, radiant: 30, hydraulic: '12-33', table: [1338, 854, 593] },
  type11: { article: 'FK0110610', type: '11', height: 600, length: 1000, output: 979, exponent: 1.2721, water: 3.04, mass: 18.06, radiant: 35, hydraulic: '10/11', table: [789, 507, 354] },
  type33: { article: 'FK0330610', type: '33', height: 600, length: 1000, output: 2236, exponent: 1.2866, water: 9.12, mass: 44.32, radiant: 20, hydraulic: '12-33', table: [1798, 1150, 800] },
  type22tall: { article: 'FK0220910', type: '22', height: 900, length: 1000, output: 2295, exponent: 1.3069, water: 8.70, mass: 44.45, radiant: 30, hydraulic: '12-33', table: [1839, 1168, 808] },
  type22long: { article: 'FK0220614', type: '22', height: 600, length: 1400, output: 2332, exponent: 1.2930, water: 8.52, mass: 40.96, radiant: 30, hydraulic: '12-33', table: [1338, 854, 593] },
};
/**
 * Two-K fits (K₁/Re + K∞, Ø16 mm reference bore, viscosity at 70 °C) to the Kermi pressure-drop lines for
 * Profil-K, same-side connection, extracted from the chart's vector paths: types 12–33 1.813 mbar and types
 * 10/11 1.243 mbar at 100 kg/h, slope 1.987 in log–log. Within 1.1 % of both lines over 35–1,000 kg/h.
 */
export const kermiHydraulics = {
  '12-33': { lossCoefficient: 18.6, laminarK: 1602, chartPa100: 181.3 },
  '10/11': { lossCoefficient: 12.76, laminarK: 1099, chartPa100: 124.3 },
};
export const kermiChartSlope = 1.987;

