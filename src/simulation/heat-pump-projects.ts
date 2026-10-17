import { applyDerived } from './parameters';
import { connect, makeComponent, uid, type Component, type Kind, type Measurement, type Project, type Property } from './model';
import { makeEnvelope, makeThermalSpace } from './thermal-spaces';

export type HeatPumpMode = 'heatPumpHouse' | 'heatPumpCold';
export const heatPumpTitles: Record<HeatPumpMode, string> = {
  heatPumpHouse: 'Heat pump and underfloor heating',
  heatPumpCold: 'Heat pump in a cold snap',
};
/**
 * A Bosch Compress 6800i AW 7 OR-S heats a 120 m² single-zone house through an underfloor loop (an equivalent 60 m,
 * 32 mm pipe whose heat goes to the room). Envelope ≈ 200 W/K: about 6 kW at −10 °C, 3.6 kW at +2 °C and below the
 * 1.8 kW minimum modulation on mild days. The heating curve runs from 25 °C (20 °C outdoor) to 35 °C (−10 °C).
 */
export function heatPumpStarter(mode: HeatPumpMode): Project {
  const cold = mode === 'heatPumpCold';
  let p: Project = { version: 5, id: uid(), name: heatPumpTitles[mode], components: [], connections: [], probes: [], assemblies: [], environment: { ambient: cold ? -15 : 2 } };
  const add = (kind: Kind, x: number, y: number, props: Record<string, Property> = {}, name?: string) => {
    const c = makeComponent(kind, x, y, p.components); c.props = applyDerived(kind, { ...c.props, ...props }); if (name) c.name = name; p.components.push(c); return c;
  };
  const wire = (a: Component, ap: string, b: Component, bp: string) => { p = connect(p, { component: a.id, port: ap }, { component: b.id, port: bp }); };
  const trace = (c: Component, measurement: Measurement, name: string, color: string) => p.probes!.push({ id: uid(), component: c.id, measurement, name, color, visible: true });
  const room = makeThermalSpace(900, 160, 12, 10);
  Object.assign(room, { name: 'House (single zone)', initialTemperature: cold ? 19 : 20, airChangesPerHour: 0.6 });
  const envelope = makeEnvelope(room).map(e => e.kind === 'wall' ? { ...e, uValue: 0.5, preset: 'Illustrative 1990s masonry' } : e.kind === 'floor' ? { ...e, uValue: 0.35 } : e);
  const north = envelope.find(e => e.side === 'north')!, south = envelope.find(e => e.side === 'south')!;
  envelope.push({ id: uid(), name: 'North windows', kind: 'window', from: room.id, to: 'outdoors', area: 5, parentId: north.id, uValue: 1.3, heatCapacity: 0, preset: 'Illustrative double glazing' });
  envelope.push({ id: uid(), name: 'South windows', kind: 'window', from: room.id, to: 'outdoors', area: 10, parentId: south.id, uValue: 1.3, heatCapacity: 0, preset: 'Illustrative double glazing' });
  p.thermalSpaces = [room]; p.thermalElements = envelope;
  const mains = add('sourceAC', 40, 40, { voltage: 230, maxCurrent: 16, maxPower: 3680 }, 'Mains · outdoor unit 16 A');
  const backupSupply = add('sourceAC', 330, 40, { voltage: 230, maxCurrent: 32, maxPower: 7360 }, 'Mains · backup heater 32 A');
  const hp = add('heatPump', 330, 330, { targetMode: 'curve', curveDesignOutdoor: -10, curveDesignFlow: 35, curveFootFlow: 25, relativeHumidity: cold ? 80 : 85, initialTemperature: 25 }, 'Bosch CS6800iAW 7 OR-S');
  const pump = add('circulator', 330, 650, { mode: 'constantPressure', headSetpoint: 4 }, 'Circulator · 4 m constant');
  const supply = add('pipe', 640, 330, { diameter: 0.028, length: 10, thermalUA: 1, segments: 2, initialTemperature: 25 }, 'Insulated flow · 10 m');
  const floor = add('pipe', 1300, 560, { diameter: 0.032, length: 60, thermalUA: 520, segments: 6, initialTemperature: 25 }, 'Underfloor loop (equivalent)');
  const back = add('pipe', 640, 650, { diameter: 0.028, length: 10, thermalUA: 1, segments: 2, initialTemperature: 25 }, 'Insulated return · 10 m');
  floor.thermalSpaceId = room.id; floor.thermalSpacePinned = true;
  wire(mains, 'a', hp, 'L'); wire(mains, 'b', hp, 'N'); wire(backupSupply, 'a', hp, 'BL'); wire(backupSupply, 'b', hp, 'BN');
  wire(mains, 'a', pump, 'a'); wire(mains, 'b', pump, 'b');
  wire(hp, 'outlet', supply, 'inlet'); wire(supply, 'outlet', floor, 'inlet'); wire(floor, 'outlet', back, 'inlet'); wire(back, 'outlet', pump, 'inlet'); wire(pump, 'outlet', hp, 'inlet');
  trace(hp, 'fluidTemperature', 'Flow temperature', '#F59B85'); trace(hp, 'returnTemperature', 'Return temperature', '#8CC6F8'); trace(hp, 'targetTemperature', 'Flow target', '#9AA6B6');
  trace(hp, 'heatOutput', 'Heat output', '#F5A524'); trace(hp, 'power', 'Electrical input', '#E5C07B'); trace(hp, 'cop', 'COP', '#7EE0B5');
  trace(hp, 'compressorSpeed', 'Compressor speed', '#C4B0FC'); trace(hp, 'frostMass', 'Frost on coil', '#A5D8FF'); trace(hp, 'defrosting', 'Defrost active', '#5EC8E5');
  trace(hp, 'backupPower', 'Backup heater', '#FF7B72'); trace(hp, 'environmentHeat', 'Heat from outdoor air', '#9BE9A8'); trace(hp, 'seasonalCop', 'Seasonal performance factor', '#D2A8FF');
  p.probes!.push({ id: uid(), name: 'House air', component: room.id, targetKind: 'space', measurement: 'roomTemperature', visible: true, color: '#C4CDD8' });
  p.probes!.push({ id: uid(), name: 'House heat loss', component: room.id, targetKind: 'space', measurement: 'envelopeLoss', visible: true, color: '#8CC6F8' });
  trace(hp, 'energyResidual', 'Energy balance residual', '#94a3b8');
  return p;
}
