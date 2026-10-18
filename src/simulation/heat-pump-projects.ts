import { applyDerived } from './parameters';
import { catalog, connect, makeComponent, uid, type Component, type Kind, type Measurement, type Project, type Property } from './model';
import { makeEnvelope, makeThermalSpace } from './thermal-spaces';

export type HeatPumpMode = 'heatPumpHouse' | 'heatPumpCold' | 'heatPumpBuffer';
export const heatPumpTitles: Record<HeatPumpMode, string> = {
  heatPumpHouse: 'Heat pump and underfloor heating',
  heatPumpCold: 'Heat pump in a cold snap',
  heatPumpBuffer: 'Heat pump with a buffer tank',
};
/**
 * A Bosch Compress 6800i AW 7 OR-S heats a 120 m² single-zone house through wet-screed underfloor heating (FLOORTEC
 * tacker 16 × 2, 100 mm spacing, twelve 100 m loops under the whole floor, R_λ,B 0.10). Envelope ≈ 200 W/K: about 6 kW at
 * −10 °C, 3.6 kW at +2 °C and below the 1.8 kW minimum modulation on mild days. The heating curve runs from 25 °C (20 °C
 * outdoor) to 35 °C (−10 °C).
 */
export function heatPumpStarter(mode: HeatPumpMode): Project {
  // Every house has hot water: the indoor unit's 3-way valve VW1 serves a Bosch WH 290 cylinder through its coil.
  const cold = mode === 'heatPumpCold', buffered = mode === 'heatPumpBuffer', dhw = true;
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
  const hp = add('heatPump', 330, 330, { targetMode: 'curve', curveDesignOutdoor: -10, curveDesignFlow: 35, curveFootFlow: 25, relativeHumidity: cold ? 80 : 85, initialTemperature: 25, hotWater: dhw }, 'Bosch CS6800iAW 7 OR-S');
  const pump = add('circulator', 330, 650, { mode: 'constantPressure', headSetpoint: 4 }, 'Circulator · 4 m constant');
  const supply = add('pipe', dhw ? 950 : 640, 330, { diameter: 0.028, length: 10, thermalUA: 1, segments: 2, initialTemperature: 25 }, 'Insulated flow · 10 m');
  // Downward resistance 2.6 m²K/W: the floor element's U 0.35 W/(m²·K) less the screed and covering above the pipes (R_o 0.23).
  const floor = add('underfloorHeating', 1300, 560, { heatedArea: 120, loops: 12, pipeSpacing: 0.1, downwardResistance: 2.6, initialTemperature: cold ? 33 : 27 }, 'Underfloor heating · 12 loops');
  floor.variant = 'spacing100';
  const back = add('pipe', 640, 650, { diameter: 0.028, length: 10, thermalUA: 1, segments: 2, initialTemperature: 25 }, 'Insulated return · 10 m');
  // The whole circuit is indoors: pipe losses warm the house (outside it, still pipes would freeze in a cold snap).
  for (const c of [floor, supply, back]) { c.thermalSpaceId = room.id; c.thermalSpacePinned = true; }
  wire(mains, 'a', hp, 'L'); wire(mains, 'b', hp, 'N'); wire(backupSupply, 'a', hp, 'BL'); wire(backupSupply, 'b', hp, 'BN');
  wire(mains, 'a', pump, 'a'); wire(mains, 'b', pump, 'b');
  // Hot water: the indoor unit's 3-way valve VW1 diverts the flow from the heating (A) to the cylinder coil (B) while the
  // controller charges; the cylinder sensor TW1 decides. The coil return joins the heating return before the pump.
  const valve = dhw ? add('divertingValve', 640, 330, {}, 'VW1 · heating / hot water') : undefined;
  if (valve) { wire(hp, 'outlet', valve, 'inlet'); wire(valve, 'outletA', supply, 'inlet'); } else wire(hp, 'outlet', supply, 'inlet');
  wire(supply, 'outlet', floor, 'inlet'); wire(floor, 'outlet', back, 'inlet'); wire(pump, 'outlet', hp, 'inlet');
  // A series buffer in the return (Bosch: "serieller Puffer"): the heat for defrosting comes from its stored water.
  const buffer = buffered ? add('storageTank', 980, 740, { initialTemperature: 25 }, 'Bosch BH 120-5 · series buffer') : undefined;
  if (buffer) { buffer.thermalSpaceId = room.id; buffer.thermalSpacePinned = true; wire(back, 'outlet', buffer, 'p1'); wire(buffer, 'p2', pump, 'inlet'); }
  else wire(back, 'outlet', pump, 'inlet');
  const cylinder = dhw ? hotWaterSide() : undefined;
  // The indoor unit's own expansion vessel (17 L, 0.75 bar) on the pump suction and its 3 bar safety valve on the flow.
  const vessel = add('expansionVessel', 640, 850, { nominalVolume: 17, precharge: 75000, fillPressure: 130000 }, 'Bosch indoor-unit vessel · 17 L'); vessel.variant = 'bosch17';
  const relief = add('safetyValve', 640, 170, {}, 'Safety valve · 3 bar');
  wire(vessel, 'fluid', pump, 'inlet'); wire(relief, 'inlet', hp, 'outlet');
  function hotWaterSide() {
    const coilFlow = add('pipe', 1300, 760, { diameter: 0.028, length: 4, thermalUA: 0.5, segments: 2, initialTemperature: 25 }, 'Flow to coil · 4 m');
    const coilReturn = add('pipe', 640, 1100, { diameter: 0.028, length: 4, thermalUA: 0.5, segments: 2, initialTemperature: 25 }, 'Return from coil · 4 m');
    for (const c of [coilFlow, coilReturn]) { c.thermalSpaceId = room.id; c.thermalSpacePinned = true; }
    const tank = makeComponent('storageTank', 980, 1060, p.components); tank.variant = 'wh290';
    tank.props = applyDerived('storageTank', { ...catalog(tank).props, initialTemperature: cold ? 47 : 38 }); tank.name = 'Bosch Stora WH 290 LP1 B'; p.components.push(tank);
    tank.thermalSpaceId = room.id; tank.thermalSpacePinned = true;
    const tw1 = add('sensor', 330, 1000, { target: tank.id, quantity: 'fluidTemperature' }, 'TW1 · cylinder sensor');
    const header = add('tank', 1600, 740, { capacity: 1000, volume: 800, surfaceArea: 1, elevation: 6, initialTemperature: 10, loss: 0, vesselHeatCapacity: 0 }, 'Cold mains (header tank, 10 °C)');
    const coldPipe = add('pipe', 1300, 1150, { diameter: 0.02, length: 8, segments: 2, initialTemperature: 10 }, 'Cold feed · 8 m');
    const hotPipe = add('pipe', 1600, 1000, { diameter: 0.02, length: 8, segments: 2, initialTemperature: cold ? 47 : 38 }, 'Hot draw-off · 8 m');
    const tap = add('valve', 1600, 1250, { diameter: 0.015, opening: 0 }, 'Hot tap (closed)');
    const drain = add('tank', 1600, 1480, { capacity: 2000, volume: 0, surfaceArea: 1, elevation: 0, initialTemperature: 20, loss: 0, vesselHeatCapacity: 0 }, 'Bath / drain');
    wire(valve!, 'outletB', coilFlow, 'inlet'); wire(coilFlow, 'outlet', tank, 'coilIn'); wire(tank, 'coilOut', coilReturn, 'inlet'); wire(coilReturn, 'outlet', pump, 'inlet');
    wire(tw1, 'out', hp, 'dhwSensor'); wire(hp, 'dhw', valve!, 'position');
    wire(header, 'fluid', coldPipe, 'inlet'); wire(coldPipe, 'outlet', tank, 'p1'); wire(tank, 'p2', hotPipe, 'inlet'); wire(hotPipe, 'outlet', tap, 'inlet'); wire(tap, 'outlet', drain, 'fluid');
    return tank;
  }
  trace(hp, 'fluidTemperature', 'Flow temperature', '#F59B85'); trace(hp, 'returnTemperature', 'Return temperature', '#8CC6F8'); trace(hp, 'targetTemperature', 'Flow target', '#9AA6B6');
  trace(hp, 'heatOutput', 'Heat output', '#F5A524'); trace(hp, 'power', 'Electrical input', '#E5C07B'); trace(hp, 'cop', 'COP', '#7EE0B5');
  trace(hp, 'compressorSpeed', 'Compressor speed', '#C4B0FC'); trace(hp, 'frostMass', 'Frost on coil', '#A5D8FF'); trace(hp, 'defrosting', 'Defrost active', '#5EC8E5');
  trace(hp, 'backupPower', 'Backup heater', '#FF7B72'); trace(hp, 'environmentHeat', 'Heat from outdoor air', '#9BE9A8'); trace(hp, 'seasonalCop', 'Seasonal performance factor', '#D2A8FF');
  p.probes!.push({ id: uid(), name: 'House air', component: room.id, targetKind: 'space', measurement: 'roomTemperature', visible: true, color: '#C4CDD8' });
  trace(floor, 'surfaceTemperature', 'Floor surface', '#E6A0C4');
  p.probes!.push({ id: uid(), name: 'House heat loss', component: room.id, targetKind: 'space', measurement: 'envelopeLoss', visible: true, color: '#8CC6F8' });
  trace(vessel, 'pressure', 'System pressure', '#8CC6F8');
  if (buffer) { trace(buffer, 'topTemperature', 'Buffer top', '#F59B85'); trace(buffer, 'bottomTemperature', 'Buffer lower sensor', '#8CC6F8'); }
  if (cylinder) {
    trace(hp, 'hotWater', 'Hot-water mode (VW1 → B)', '#F5A524'); trace(cylinder, 'fluidTemperature', 'Cylinder sensor TW1', '#FF7B72');
    trace(cylinder, 'topTemperature', 'Cylinder top', '#F59B85'); trace(cylinder, 'heatDuty', 'Coil heat into the cylinder', '#E5C07B');
    // Undefined until a charge has run: the cold snap starts with a charged cylinder.
    if (!cold) trace(hp, 'hotWaterCop', 'Hot-water performance factor', '#9BE9A8');
  }
  trace(hp, 'energyResidual', 'Energy balance residual', '#94a3b8');
  return p;
}
