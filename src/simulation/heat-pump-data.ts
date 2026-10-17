/**
 * Bosch Compress 6800i AW 7 OR-S (R290 monobloc outdoor unit, 230 V single phase) with the CS6800iAW 12 E
 * indoor unit's electric backup heater. Published data only; the model constants fitted to it live in
 * heat-pump.ts. Sources:
 *  - [IM] Bosch installation manual "Air to water heat pump AW 4|5|7 OR-S", 6721866761 (2023/06), §10.1–10.2;
 *  - [ErP] Bosch energy data sheet CS6800iAW 7 ORE-S (EU 811/2013, 813/2013), 6721860629 (2026/02);
 *  - [IDU] Bosch installation manual indoor unit CS6800iAW 12 E, 6721892050 (2025/04), §3.3, §5.2, §7, §10.1.
 */
export const heatPumpSources = {
  outdoor: { label: 'Bosch installation manual AW 4|5|7 OR-S, 6721866761 (2023/06)', url: 'https://www.worcester-bosch.co.uk/support/literature/download/6721866761' },
  erp: { label: 'Bosch energy data sheet CS6800iAW 7 ORE-S, 6721860629 (2026/02)', url: 'https://bosch-de-de.boschhc-documents.com/download/pdf/file/6721860629' },
  indoor: { label: 'Bosch installation manual indoor unit CS6800iAW 12 E, 6721892050 (2025/04)', url: 'https://bosch-de-de.boschhc-documents.com/download/pdf/file/6721892050' },
};

/** One published heating operating point: outdoor air and water outlet (°C), heat output (W), COP (–). */
export interface RatingPoint { label: string; air: number; flow: number; output: number; cop: number; kind: 'maximum' | 'part load' | 'minimum'; source: 'IM' | 'ErP'; note: string }

/**
 * EN 14511 points [IM, Table 7] and EN 14825 part-load points [ErP] for the 7 OR-S. `fit` points calibrate the
 * steady (frost-free) cycle model; the others are withheld checks. Below +7 °C air the EN 14511/14825 tests
 * integrate defrost cycles, so A2 data contain the defrost penalty that the frost model adds dynamically.
 */
export const ratingPoints: (RatingPoint & { fit: boolean })[] = [
  { label: 'A7/W35 maximum', air: 7, flow: 35, output: 7970, cop: 3.07, kind: 'maximum', source: 'IM', note: 'EN 14511', fit: true },
  { label: 'A7/W55 maximum', air: 7, flow: 55, output: 7450, cop: 2.64, kind: 'maximum', source: 'IM', note: 'EN 14511', fit: true },
  { label: 'A−7/W35 maximum', air: -7, flow: 35, output: 6710, cop: 2.36, kind: 'maximum', source: 'IM', note: 'EN 14511', fit: true },
  { label: 'A−10/W35 maximum', air: -10, flow: 35, output: 5860, cop: 2.23, kind: 'maximum', source: 'IM', note: 'EN 14511', fit: true },
  { label: 'A7/W35 nominal', air: 7, flow: 35, output: 2840, cop: 4.85, kind: 'part load', source: 'IM', note: 'EN 14511', fit: true },
  { label: 'Tj +12 °C, W30', air: 12, flow: 30, output: 1800, cop: 5.75, kind: 'minimum', source: 'ErP', note: 'EN 14825 average climate, 55 °C application; capacity at minimum speed', fit: true },
  { label: 'Tj +7 °C, W36', air: 7, flow: 36, output: 2500, cop: 4.68, kind: 'part load', source: 'ErP', note: 'EN 14825 average climate, 55 °C application', fit: true },
  { label: 'Tj −7 °C, W52', air: -7, flow: 52, output: 5900, cop: 2.09, kind: 'maximum', source: 'ErP', note: 'EN 14825 bivalent point (capacity limited)', fit: true },
  { label: 'Tj −10 °C, W55', air: -10, flow: 55, output: 5200, cop: 1.83, kind: 'maximum', source: 'ErP', note: 'EN 14825 design point (TOL −22 °C)', fit: true },
  { label: 'A2/W35 maximum', air: 2, flow: 35, output: 7090, cop: 2.83, kind: 'maximum', source: 'IM', note: 'EN 14511, includes defrost', fit: false },
  { label: 'A2/W35 nominal', air: 2, flow: 35, output: 2870, cop: 4.06, kind: 'part load', source: 'IM', note: 'EN 14511, includes defrost', fit: false },
  { label: 'Tj +2 °C, W42', air: 2, flow: 42, output: 3500, cop: 3.49, kind: 'part load', source: 'ErP', note: 'EN 14825, includes defrost', fit: false },
];

/** Published limits and installation data. */
export const bosch = {
  /** [IM] modulation range at A2/W35 (W). */
  modulation: [1800, 7100],
  /** [IM] maximum current (A), fuse 16 A gL/C, 230 V 1N AC 50 Hz, cos φ > 0.99 at maximum output. */
  maxCurrent: 13.1, powerFactor: 0.99,
  /** [IM] maximum number of compressor starts per hour. */
  maxStarts: 6,
  /** [IM] nominal and maximum air flow (m³/h). */
  airFlow: 1670,
  /** [IM §10.2] heat pump switches off at about −23 °C / +45 °C outdoor, restarts above about −17 °C / below +42 °C. */
  cutout: { low: -23, lowRestart: -17, high: 45, highRestart: 42 },
  /** [IM Fig. 42] operating envelope, heating without booster: maximum flow temperature (°C) over outdoor air (°C), digitised from the vector figure; lower edge 15 °C. */
  envelope: [[-22, 59], [10, 75], [25, 75], [45, 60]] as [number, number][], envelopeMinFlow: 15,
  /** [ErP] standby / off / thermostat-off power and crankcase heater power (W). */
  standbyPower: 15, crankcasePower: 32,
  /** [IDU §5.2] nominal flows for the 7 kW unit (l/min) and minimum flow in defrost and cooling (l/min). */
  nominalFlowFloor: 20, nominalFlowRadiator: 12.5, defrostMinFlow: 14,
  /** [IDU §10.1] backup heater stages (kW): 3 and 6 kW at 230 V 1N, 9 kW only at 400 V 3N. Overheat protection opens above 88 °C (manual reset). */
  backupStage: 3000, backupLimit: 88,
  /** [IDU §7] dry-run check at power-on: compressor and backup heater blocked for 2 minutes. */
  powerOnCheck: 120,
  /** [IM] maximum flow temperature, heat pump only (°C); [IDU] 0.7–3 bar operating pressure. */
  maxFlow: 75, maxPressure: 300000,
  /** [ErP] rated heat output (kW), TOL, WTOL, Psup. */
  ratedOutput: 7000,
};
