/**
 * EN 1264-2 characteristic factors and the FLOORTEC reference tables for the underfloor heating model.
 * Provenance, transcription and calibration: docs/UNDERFLOOR-HEATING.md.
 */

/** EN 1264-2 total heat transfer coefficient of a heated floor (convection + radiation), W/(m²·K). */
export const EN1264_ALPHA = 10.8;
/** EN 1264-2 reference construction of a_B: 45 mm cover of λ = 1.0 W/(m·K). */
export const EN1264_COVER_REF = 0.045;
export const EN1264_LAMBDA_REF = 1.0;
/** EN 1264-2 base characteristic curve q = 8.92·(θ_F,m − θ_i)^1.1 (system-independent). */
export const BASE_CURVE_K = 8.92;
export const BASE_CURVE_EXPONENT = 1.1;

/** Floor covering resistances R_λ,B (m²·K/W) at which EN 1264-2 tabulates its factors. */
export const coverings = [0, 0.05, 0.1, 0.15] as const;
/** Spacing factor a_T per covering resistance (EN 1264-2, type A systems). */
export const spacingFactor = [1.23, 1.188, 1.156, 1.134] as const;
/** Pipe spacings T (m) of the a_ü and a_D tables. */
export const spacings = [0.05, 0.075, 0.1, 0.15, 0.2, 0.225, 0.3, 0.375] as const;
/** Cover factor a_ü: rows by spacing, columns by covering resistance. */
export const coverFactor = [
  [1.069, 1.056, 1.043, 1.037], [1.066, 1.053, 1.041, 1.035], [1.063, 1.05, 1.039, 1.0335], [1.057, 1.046, 1.035, 1.0305],
  [1.051, 1.041, 1.031, 1.0275], [1.048, 1.038, 1.029, 1.026], [1.0395, 1.031, 1.0235, 1.021], [1.03, 1.0221, 1.0181, 1.015],
] as const;
/** Pipe diameter factor a_D: rows by spacing, columns by covering resistance. */
export const diameterFactor = [
  [1.013, 1.013, 1.012, 1.011], [1.021, 1.019, 1.016, 1.014], [1.029, 1.025, 1.022, 1.018], [1.04, 1.034, 1.029, 1.024],
  [1.046, 1.04, 1.035, 1.03], [1.049, 1.043, 1.038, 1.033], [1.053, 1.049, 1.044, 1.039], [1.056, 1.051, 1.046, 1.042],
] as const;

/**
 * FLOORTEC tacker system (Vogel & Noot, DIN-registered 7F147) with the FLOORTEC Alu-Verbundrohr 16 × 2 mm, 45 mm screed
 * over the pipe: "Schnellkalkulation" heat flux tables q (W/m²) per ÖNORM EN 1264, Technische Informationen pp. 522–525.
 * Rows below are the 40 °C mean water / 20 °C room block (flow 45 °C, return 35 °C). The tables are exactly linear in the
 * arithmetic mean excess (every block is this row × Δθ/20 K, to rounding), so one block holds the whole characteristic.
 */
export const floortec = {
  system: 'FLOORTEC tacker system, N. reg. 7F147',
  pipe: 'FLOORTEC Alu-Verbundrohr 16 × 2 mm',
  source: 'Vogel & Noot, FLOORTEC Technische Informationen (price list valid from 1 March 2012), pp. 522–525 and 594',
  cover: 0.045,
  excess: 20,
  spacings: [0.1, 0.15, 0.2, 0.25, 0.3],
  /** q (W/m²) at 20 K arithmetic mean excess, by covering resistance (rows as `coverings`) and spacing. */
  flux: [[130, 112, 97, 84, 73], [95, 84, 75, 66, 59], [75, 68, 61, 55, 50], [62, 57, 52, 48, 44]],
  /** Pipe data sheet (p. 594). */
  water: 0.113, mass: 0.104, conductivity: 0.43, roughness: 0.000007, maxTemperature: 95, maxPressure: 1000000,
} as const;
/** System constant B (W/(m²·K)) fitted to the FLOORTEC table (least squares in log q over all 20 points). */
export const FLOORTEC_B = 6.754;
/** EN 1264-2 standard B for plastic pipe of λ_R = 0.35 W/(m·K) and 2 mm wall. */
export const EN1264_B = 6.7;
