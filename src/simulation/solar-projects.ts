import { catalog, connect, ENVIRONMENT_TARGET, makeComponent, uid, type Component, type Kind, type Measurement, type Project, type Property } from './model';
import { summerDesignDay } from './weather';
export type SolarMode = 'solarCharging' | 'solarOffGrid' | 'solarCirculation' | 'solarExperiment' | 'solarDay';
export const solarTitles: Record<SolarMode, string> = { solarCharging: 'Basic solar charging', solarOffGrid: 'Off-grid solar system', solarCirculation: 'Solar-powered circulation', solarExperiment: 'Solar performance experiment', solarDay: 'Off-grid solar through a June day' };
export function solarStarter(mode: SolarMode): Project {
  let p: Project = { version: 3, id: uid(), name: solarTitles[mode], components: [], connections: [], probes: [], assemblies: [] };
  const add = (kind: Kind, x: number, y: number, name: string, props: Record<string, Property> = {}, variant?: string) => {
    const c = makeComponent(kind, x, y, p.components); c.variant = variant ?? 'standard'; c.name = name; c.props = { ...catalog(c).props, ...props }; p.components.push(c); return c;
  };
  const wire = (a: Component, ap: string, b: Component, bp: string) => { p = connect(p, { component: a.id, port: ap }, { component: b.id, port: bp }); };
  const probe = (c: Component, measurement: Measurement, name: string, color: string) => p.probes!.push({ id: uid(), component: c.id, measurement, name, color, visible: true });
  // A June day: the off-grid system with the module in the sun (30° tilt, facing south) of a clear design day (weather.ts).
  const day = mode === 'solarDay', offGrid = mode === 'solarOffGrid' || day;
  if (day) p.weather = { ...summerDesignDay(), startHour: 6 };
  const bank24 = offGrid || mode === 'solarExperiment';
  const pv = add('solarPanel', 70, 110, day ? 'Solar Panel (PV) · 30° south' : 'Solar Panel (PV)', day ? { conditions: 'weather', tilt: 30, azimuth: 180 } : {});
  const mppt = add('mpptController', 390, 110, 'MPPT Charge Controller', {}, bank24 ? '24V' : undefined);
  const battery = add('lfpBattery', 710, 110, 'LiFePO4 Battery', mode === 'solarCirculation' ? { initialSOC: 20 } : {}, bank24 ? 'eightCell' : undefined);
  wire(pv, 'a', mppt, 'a'); wire(pv, 'b', mppt, 'b'); wire(mppt, 'oa', battery, 'a'); wire(mppt, 'ob', battery, 'b');
  probe(pv, 'outputPower', 'PV generated power', '#f59e0b'); probe(mppt, 'outputPower', 'Charger output', '#22c55e');
  probe(battery, 'stateOfCharge', 'Battery SOC', '#38bdf8'); probe(battery, 'chemicalEnergy', 'Stored chemical energy', '#a78bfa'); probe(battery, 'current', 'Battery current (+ charging)', '#06b6d4');
  if (offGrid || mode === 'solarCirculation') {
    const protection = add('batteryProtection', 710, 400, 'DC load protection', bank24 ? { disconnectVoltage: 23.6, restartVoltage: 25.6 } : {});
    wire(battery, 'a', protection, 'a'); wire(battery, 'b', protection, 'reference');
    if (offGrid) {
      const inverter = add('inverter', 1030, 110, 'DC/AC Inverter');
      const ac = add('resistor', 1350, 110, '230 V AC load · 100 W', { resistance: 529, ratedPower: 150, heatCapacity: 1000, loss: 3 });
      const dc = add('resistor', 1030, 400, 'DC lighting branch · 20 W', { resistance: 32.768, ratedPower: 40, heatCapacity: 300, loss: 1 });
      wire(battery, 'a', inverter, 'a'); wire(battery, 'b', inverter, 'b'); wire(inverter, 'oa', ac, 'a'); wire(inverter, 'ob', ac, 'b');
      wire(protection, 'b', dc, 'a'); wire(battery, 'b', dc, 'b');
      probe(inverter, 'inputPower', 'Inverter DC input', '#ef4444'); probe(ac, 'power', 'AC useful load', '#f97316'); probe(dc, 'power', 'DC useful load', '#eab308');
    } else {
      const pump = add('circulator', 1030, 400, '12 V DC circulator', {}, 'dc12');
      const supply = add('pipe', 1030, 700, 'Supply pipe · 10 m', { length: 10, diameter: 0.02 });
      const valve = add('valve', 710, 700, 'Loop balancing valve', { diameter: 0.02 });
      const back = add('pipe', 390, 700, 'Return pipe · 10 m', { length: 10, diameter: 0.02 });
      wire(protection, 'b', pump, 'a'); wire(battery, 'b', pump, 'b');
      wire(pump, 'outlet', supply, 'inlet'); wire(supply, 'outlet', valve, 'inlet'); wire(valve, 'outlet', back, 'inlet'); wire(back, 'outlet', pump, 'inlet');
      probe(pump, 'power', 'Circulator electrical power', '#ef4444'); probe(pump, 'flow', 'Circulation flow', '#06b6d4');
    }
  }
  if (mode === 'solarExperiment') {
    const hot = add('solarPanel', 70, 470, 'Warm PV · lower irradiance', { irradiance: 600, cellTemperature: 60 });
    const tracker = add('mpptController', 390, 470, 'Second MPPT Charge Controller', {}, '24V');
    const bank = add('lfpBattery', 710, 470, 'Second LiFePO4 Battery', {}, 'eightCell');
    wire(hot, 'a', tracker, 'a'); wire(hot, 'b', tracker, 'b'); wire(tracker, 'oa', bank, 'a'); wire(tracker, 'ob', bank, 'b');
    for (const [panel, control, color] of [[pv, mppt, '#f59e0b'], [hot, tracker, '#38bdf8']] as const) {
      probe(panel, 'voltage', `${panel.name} operating voltage`, color); probe(panel, 'mppPower', `${panel.name} available MPP`, color); probe(control, 'trackingEfficiency', `${control.name} tracking efficiency`, color);
    }
  }
  if (day) {
    probe(pv, 'planeIrradiance', 'Sunlight on the module', '#fde047'); probe(pv, 'cellTemperature', 'Cell temperature', '#fb7185');
    for (const [measurement, name, color] of [['sunElevation', 'Sun elevation', '#facc15'], ['outdoorTemperature', 'Outdoor air', '#9AA6B6']] as const)
      p.probes!.push({ id: uid(), name, component: ENVIRONMENT_TARGET, targetKind: 'environment', measurement, visible: true, color });
  }
  // Global ledger probes are supported on batteries through the general measurement contract.
  return p;
}
