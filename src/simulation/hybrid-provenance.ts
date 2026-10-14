export const hybridProvenance = {
 reference: 'Victron MultiPlus-II 48/3000/35-32 230 V (3 kVA family)',
 datasheet: 'https://www.victronenergy.com/upload/documents/Datasheet-MultiPlus-II-inverter-charger-EN-.pdf',
 manual: 'https://www.victronenergy.com/media/pg/MultiPlus-II_230V/en/description.html',
 ess: 'https://www.victronenergy.com/media/pg/Energy_Storage_System/en/configuration.html',
 published: '48 V class; DC 38–66 V; 2400 W / 3000 VA at 25°C, 2200 W at 40°C, 1700 W at 65°C; 5500 W peak; 95% maximum inverter efficiency; 11 W no-load, 2 W Search; 35 A charger; 32 A transfer/input; 230 V ±2%, 50 Hz ±0.1%; AC acceptance 187–265 V, 45–65 Hz. UPS switchover <20 ms. Fixed Q is one documented grid-code reactive mode.',
 assumptions: 'RMS fundamental model, not switching firmware or grid-code certification. Peak efficiency occurs at half load; nonnegative load-proportional and quadratic apparent-load losses, respecting the published efficiency ceiling. Charger efficiency 94%, 2-second surge, 16 ms backup interruption, 60-second qualification delay, phase/frequency slew, a conservative 75 A DC current limit, derived 24 A AC surge bound and contact resistance are educational assumptions. LFP charge profile 56.8/54 V replaces the reference lead-acid 57.6/55.2 V. No BatteryLife, tariff scheduling, frequency-shift PV coordination, second AC output, harmonics or ground-relay/RCD model. The separate grid-following inverter uses this converter envelope as an engineering reference, not a claim that the reference product accepts PV directly.',
};
