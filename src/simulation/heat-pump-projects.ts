import { applyDerived } from './parameters';
import { catalog, connect, makeComponent, uid, type Component, type Kind, type Measurement, type Project, type Property } from './model';
import { makeEnvelope, makeThermalSpace } from './thermal-spaces';

export type HeatPumpMode = 'heatPumpHouse' | 'heatPumpCold' | 'heatPumpBuffer' | 'heatPumpHotWater';
export const heatPumpTitles: Record<HeatPumpMode, string> = {
  heatPumpHouse: 'Heat pump and underfloor heating',
  heatPumpCold: 'Heat pump in a cold snap',
  heatPumpBuffer: 'Heat pump with a buffer tank',
  heatPumpHotWater: 'Heat pump charging a hot-water cylinder',
};
/**
 * A Bosch Compress 6800i AW 7 OR-S heats a 120 m² single-zone house through an underfloor loop (an equivalent 60 m,
 * 32 mm pipe whose heat goes to the room). Envelope ≈ 200 W/K: about 6 kW at −10 °C, 3.6 kW at +2 °C and below the
 * 1.8 kW minimum modulation on mild days. The heating curve runs from 25 °C (20 °C outdoor) to 35 °C (−10 °C).
 */
export function heatPumpStarter(mode: HeatPumpMode): Project {
  if (mode === 'heatPumpHotWater') return hotWaterStarter();
  const cold = mode === 'heatPumpCold', buffered = mode === 'heatPumpBuffer';
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
  wire(hp, 'outlet', supply, 'inlet'); wire(supply, 'outlet', floor, 'inlet'); wire(floor, 'outlet', back, 'inlet'); wire(pump, 'outlet', hp, 'inlet');
  // A series buffer in the return (Bosch: "serieller Puffer"): the heat for defrosting comes from its stored water.
  const buffer = buffered ? add('storageTank', 980, 740, { initialTemperature: 25 }, 'Bosch BH 120-5 · series buffer') : undefined;
  if (buffer) { buffer.thermalSpaceId = room.id; buffer.thermalSpacePinned = true; wire(back, 'outlet', buffer, 'p1'); wire(buffer, 'p2', pump, 'inlet'); }
  else wire(back, 'outlet', pump, 'inlet');
  // The indoor unit's own expansion vessel (17 L, 0.75 bar) on the pump suction and its 3 bar safety valve on the flow.
  const vessel = add('expansionVessel', 640, 850, { nominalVolume: 17, precharge: 75000, fillPressure: 130000 }, 'Bosch indoor-unit vessel · 17 L'); vessel.variant = 'bosch17';
  const relief = add('safetyValve', 640, 170, {}, 'Safety valve · 3 bar');
  wire(vessel, 'fluid', pump, 'inlet'); wire(relief, 'inlet', hp, 'outlet');
  trace(hp, 'fluidTemperature', 'Flow temperature', '#F59B85'); trace(hp, 'returnTemperature', 'Return temperature', '#8CC6F8'); trace(hp, 'targetTemperature', 'Flow target', '#9AA6B6');
  trace(hp, 'heatOutput', 'Heat output', '#F5A524'); trace(hp, 'power', 'Electrical input', '#E5C07B'); trace(hp, 'cop', 'COP', '#7EE0B5');
  trace(hp, 'compressorSpeed', 'Compressor speed', '#C4B0FC'); trace(hp, 'frostMass', 'Frost on coil', '#A5D8FF'); trace(hp, 'defrosting', 'Defrost active', '#5EC8E5');
  trace(hp, 'backupPower', 'Backup heater', '#FF7B72'); trace(hp, 'environmentHeat', 'Heat from outdoor air', '#9BE9A8'); trace(hp, 'seasonalCop', 'Seasonal performance factor', '#D2A8FF');
  p.probes!.push({ id: uid(), name: 'House air', component: room.id, targetKind: 'space', measurement: 'roomTemperature', visible: true, color: '#C4CDD8' });
  p.probes!.push({ id: uid(), name: 'House heat loss', component: room.id, targetKind: 'space', measurement: 'envelopeLoss', visible: true, color: '#8CC6F8' });
  trace(vessel, 'pressure', 'System pressure', '#8CC6F8');
  if (buffer) { trace(buffer, 'topTemperature', 'Buffer top', '#F59B85'); trace(buffer, 'bottomTemperature', 'Buffer lower sensor', '#8CC6F8'); }
  trace(hp, 'energyResidual', 'Energy balance residual', '#94a3b8');
  return p;
}
/**
 * The same heat pump with a fixed 55 °C flow target charging a Bosch Stora WH 290 cylinder through its coil, as in
 * hot-water mode (the indoor unit's 3-way diverting valve is replaced by a dedicated circuit). Outdoor A7. A vented
 * header tank stands in for the cold mains; the closed tap leads to a drain tank.
 */
function hotWaterStarter(): Project {
  let p: Project = { version: 5, id: uid(), name: heatPumpTitles.heatPumpHotWater, components: [], connections: [], probes: [], assemblies: [], environment: { ambient: 7 } };
  const add = (kind: Kind, x: number, y: number, props: Record<string, Property> = {}, name?: string, variant?: string) => {
    const c = makeComponent(kind, x, y, p.components); if (variant) c.variant = variant;
    c.props = applyDerived(kind, { ...catalog(c).props, ...props }); if (name) c.name = name; p.components.push(c); return c;
  };
  const wire = (a: Component, ap: string, b: Component, bp: string) => { p = connect(p, { component: a.id, port: ap }, { component: b.id, port: bp }); };
  const trace = (c: Component, measurement: Measurement, name: string, color: string) => p.probes!.push({ id: uid(), component: c.id, measurement, name, color, visible: true });
  const mains = add('sourceAC', 40, 40, { voltage: 230, maxCurrent: 16, maxPower: 3680 }, 'Mains · outdoor unit 16 A');
  const backupSupply = add('sourceAC', 330, 40, { voltage: 230, maxCurrent: 32, maxPower: 7360 }, 'Mains · backup heater 32 A');
  const hp = add('heatPump', 330, 330, { targetMode: 'fixed', setpoint: 55, backupStages: 0, relativeHumidity: 70, initialTemperature: 15 }, 'Bosch CS6800iAW 7 OR-S · DHW 55 °C');
  const pump = add('circulator', 330, 650, { mode: 'constantSpeed', speedSetting: 100 }, 'Charging pump');
  const flow = add('pipe', 640, 330, { diameter: 0.028, length: 6, thermalUA: 0.8, segments: 2, initialTemperature: 15 }, 'Flow to coil · 6 m');
  const back = add('pipe', 640, 650, { diameter: 0.028, length: 6, thermalUA: 0.8, segments: 2, initialTemperature: 15 }, 'Return from coil · 6 m');
  const cylinder = add('storageTank', 980, 420, { initialTemperature: 15, ambientMode: 'override', ambient: 20 }, 'Bosch Stora WH 290 LP1 B', 'wh290');
  const vessel = add('expansionVessel', 640, 850, {}, 'Bosch indoor-unit vessel · 17 L', 'bosch17');
  const relief = add('safetyValve', 640, 170, {}, 'Safety valve · 3 bar');
  const mainsTank = add('tank', 1300, 120, { capacity: 1000, volume: 800, surfaceArea: 1, elevation: 6, initialTemperature: 10, loss: 0, vesselHeatCapacity: 0 }, 'Cold mains (header tank, 10 °C)');
  const coldPipe = add('pipe', 1300, 420, { diameter: 0.02, length: 8, segments: 2, initialTemperature: 10 }, 'Cold feed · 8 m');
  const hotPipe = add('pipe', 1300, 700, { diameter: 0.02, length: 8, segments: 2, initialTemperature: 15 }, 'Hot draw-off · 8 m');
  const tap = add('valve', 1600, 700, { diameter: 0.015, opening: 0 }, 'Hot tap (closed)');
  const drain = add('tank', 1600, 920, { capacity: 2000, volume: 0, surfaceArea: 1, elevation: 0, initialTemperature: 20, loss: 0, vesselHeatCapacity: 0 }, 'Bath / drain');
  wire(mains, 'a', hp, 'L'); wire(mains, 'b', hp, 'N'); wire(backupSupply, 'a', hp, 'BL'); wire(backupSupply, 'b', hp, 'BN');
  wire(mains, 'a', pump, 'a'); wire(mains, 'b', pump, 'b');
  wire(hp, 'outlet', flow, 'inlet'); wire(flow, 'outlet', cylinder, 'coilIn'); wire(cylinder, 'coilOut', back, 'inlet'); wire(back, 'outlet', pump, 'inlet'); wire(pump, 'outlet', hp, 'inlet');
  wire(vessel, 'fluid', pump, 'inlet'); wire(relief, 'inlet', hp, 'outlet');
  wire(mainsTank, 'fluid', coldPipe, 'inlet'); wire(coldPipe, 'outlet', cylinder, 'p1'); wire(cylinder, 'p2', hotPipe, 'inlet'); wire(hotPipe, 'outlet', tap, 'inlet'); wire(tap, 'outlet', drain, 'fluid');
  trace(hp, 'fluidTemperature', 'Flow temperature', '#F59B85'); trace(hp, 'returnTemperature', 'Return temperature', '#8CC6F8');
  trace(hp, 'heatOutput', 'Heat output', '#F5A524'); trace(hp, 'power', 'Electrical input', '#E5C07B'); trace(hp, 'cop', 'COP', '#7EE0B5');
  trace(hp, 'condensingTemperature', 'Condensing temperature', '#FF7B72'); trace(hp, 'compressorSpeed', 'Compressor speed', '#C4B0FC');
  trace(cylinder, 'topTemperature', 'Cylinder top', '#F59B85'); trace(cylinder, 'fluidTemperature', 'Cylinder upper sensor', '#F5A524'); trace(cylinder, 'bottomTemperature', 'Cylinder lower sensor', '#8CC6F8');
  trace(cylinder, 'heatDuty', 'Coil heat into the store', '#F5A524'); trace(cylinder, 'storedHeat', 'Stored heat', '#D2A8FF');
  trace(hp, 'seasonalCop', 'Performance factor so far', '#9BE9A8'); trace(vessel, 'pressure', 'System pressure', '#8CC6F8');
  trace(hp, 'energyResidual', 'Energy balance residual', '#94a3b8');
  return p;
}
