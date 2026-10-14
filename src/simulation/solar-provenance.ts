/** Manufacturer references intentionally live outside catalog labels and project serialization. */
export const solarProvenance: Record<string, { reference: string; url: string; facts: string; assumptions: string }> = {
  solarPanel: {
    reference: 'Trina Solar Vertex S+ TSM-450NEG9R.28, TSM_EN_2024_A_S1',
    url: 'https://static.trinasolar.com/sites/default/files/Datasheet_Vertex%20S%2B_NEG9R.28_EN_2024_A_S1_web.pdf',
    facts: 'STC 450 W, Voc 52.9 V, Isc 10.74 A, Vmpp 44.6 V, Impp 10.09 A. Voc −0.24%/K, Isc +0.04%/K; area 1762 × 1134 mm. Published NOCT point: 344 W at 800 W/m², nominal cell temperature 43°C.',
    assumptions: 'Series resistance and diode ideality voltage fitted to STC points and stationary MPP; infinite shunt resistance. Temperature scaling uses Voc and Isc coefficients, not an independently forced power coefficient. Shading is uniform irradiance reduction; bypass diodes, mismatch and local maxima are omitted. Cell temperature is prescribed by an external reservoir. Unconverted sunlight leaves that reservoir; no thermal panel dynamics.' },
  lfpBattery: {
    reference: 'Victron Lithium Battery Smart 12.8/100 and 25.6/100',
    url: 'https://www.victronenergy.com/upload/documents/Datasheet-12,8-&-25,6-Volt-lithium-iron-phosphate-batteries-Smart-EN.pdf',
    facts: '100 Ah, 4/8 cells, 1280/2560 Wh nominal; 0.8/1.6 mΩ. Maximum charge/discharge 200 A; recommended charge ≤50 A, discharge ≤100 A. Charge +5…50°C, discharge −20…50°C; end of discharge 11.2/22.4 V; recommended absorption 14.2/28.4 V and float 13.5/27 V.',
    assumptions: 'The reference pack REQUIRES an external BMS. This generic component bundles a simplified directional BMS and configurable overcurrent isolation, with immediate thermal recovery. SOC curve is a typical rested LFP open-circuit table (2.5–3.40 V per cell, 13.6 V full for 4 cells), not a measured manufacturer curve; the 3.65 V per cell charge cut-off is a terminal voltage under charge, not an OCV. Coulombic efficiency 99.5%, lumped heat capacity and UA are assumed. Published 92% round-trip efficiency is not forced; actual efficiency depends on current, voltage and losses. Cold capacity derating, cell imbalance, ageing and hysteresis omitted.' },
  mpptController: {
    reference: 'Victron SmartSolar MPPT 100/20',
    url: 'https://www.victronenergy.com/media/pg/Manual_SmartSolar_MPPT_75-10_up_to_100-20/en/technical-specifications.html',
    facts: '100 V maximum PV Voc, 20 A PV short-circuit/output current limits; nominal 290 W at 12 V / 580 W at 24 V; peak efficiency 98%; startup PV > battery +5 V, running +1 V. Full output to 40°C, operating to 60°C.',
    assumptions: 'Educational perturb-and-observe voltage tracker, not proprietary firmware; 0.25 V perturbations every 0.2 s. Constant 98% converter efficiency; no standby consumption or gradual thermal derating. Absorption duration 1800 s assumed. Profiles use battery-recommended LFP voltages. Galvanically separate averaged ports; reference hardware is common-negative. No equalization or integrated load output.' },
  inverter: {
    reference: 'Victron Phoenix / Inverter VE.Direct 24/500, 230 V',
    url: 'https://www.victronenergy.com/upload/documents/Datasheet-Phoenix-Inverter-VE.Direct-250VA-1200VA-EN.pdf',
    facts: '500 VA / 400 W continuous at 25°C; 350 W at 40°C; 900 W peak; 230 V, 50/60 Hz; 90% peak efficiency, 6.5 W idle, 1.5 W ECO; low shutdown/restart 18.6/21.8 V, upper input 34 V.',
    assumptions: 'Ideal sinusoidal RMS output; switching, harmonics, DC ripple and inverter startup inrush omitted. Nonnegative idle + load-proportional + quadratic apparent-load loss, calibrated so efficiency never exceeds the configured maximum. Peak load is half rated power when feasible (assumed); otherwise it is derived from idle power and maximum efficiency. Two-second surge duration assumed, not published. Overload latches until reset. Explicit standby disables output; automatic ECO polling and temperature derating omitted.' },
  batteryProtection: {
    reference: 'Victron Smart BatteryProtect 12/24 V 65 A (behavior reference)',
    url: 'https://www.victronenergy.com/battery_protect/smart-battery-protect',
    facts: 'Independent downstream load protection; distinct from battery cell BMS. Reference family includes a 65 A continuous variant and configurable low voltage programs.',
    assumptions: 'Immediate 11.8 V disconnect / 12.8 V recovery, 2 mΩ on resistance, thermal capacity/UA and 65°C cutoff are educational choices. Overcurrent latches until reset. Remote enable is a logical signal. Bidirectional ideal contact; reference hardware is unidirectional and must not directly switch inverter input. Use inverter remote control in a real installation. Quiescent power, delays and reverse-current protections omitted.' },
};

export const solarVariantProvenance = (kind: string, variant?: string) => {
  const base = solarProvenance[kind];
  if (kind === 'mpptController' && variant === '48V') return {
    reference: 'Victron SmartSolar MPPT 150/35 · 48 V configuration',
    url: 'https://www.victronenergy.com/media/pg/Manual_SmartSolar_MPPT_150-35__150-45/en/technical-specifications.html',
    facts: '12/24/48 V battery; 35 A output; nominal 2000 W PV at 48 V; 40 A PV short-circuit rating; 150 V absolute maximum, 145 V operating/startup ceiling; peak efficiency 98%; startup +5 V, running +1 V.',
    assumptions: base.assumptions + ' This variant uses the existing averaged model with a 145 V operating cutoff. Two reference panels in series suit the 48 V bus. Quiescent current and absolute-maximum damage above 150 V are not simulated.',
  };
  if (kind === 'lfpBattery' && variant === 'sixteenCell') return { ...base, reference: base.reference + ' · two 25.6 V / 100 Ah packs in series', assumptions: base.assumptions + ' The 51.2 V / 100 Ah configuration derives capacity, voltage, 3.2 mΩ resistance and thermal mass from two 25.6 V packs; it is not a separately published 51.2 V product. An appropriate external BMS is required by the reference hardware.' };
  return base;
};
