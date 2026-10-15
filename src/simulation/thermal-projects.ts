import { connect, makeComponent, uid, type Project } from './model';
import { deviceStarter } from './device-projects';
import { makeEnvelope, makeThermalSpace } from './thermal-spaces';

export function thermalStarter(mode: 'livingRoom' | 'roomCooldown' | 'thermostaticRoom'): Project {
  let p = deviceStarter('kermi');
  const room = makeThermalSpace(860, 240, 5, 4); room.name = 'Living Room'; room.initialTemperature = 15;
  p.version = 5; p.name = mode === 'livingRoom' ? 'Heated living room' : 'Heating switched off';
  p.environment = { ambient: 0 }; p.thermalSpaces = [room]; p.thermalElements = makeEnvelope(room);
  const north = p.thermalElements[0];
  p.thermalElements.push({ id: uid(), name: 'Double-glazed window', kind: 'window', from: room.id, to: 'outdoors', area: 2, parentId: north.id, uValue: 1.1, heatCapacity: 0, preset: 'Illustrative modern glazing' });
  const radiator = p.components.find(c => c.kind === 'panelRadiator')!;
  radiator.thermalSpaceId = room.id; radiator.thermalSpacePinned = true;
  if (mode === 'thermostaticRoom') {
    p.name = 'Thermostatic radiator room'; room.initialTemperature = 20;
    const valve = makeComponent('thermostaticValve', 1120, 540, p.components);
    valve.thermalSpaceId = room.id; valve.thermalSpacePinned = true; p.components.push(valve);
    const supply = p.connections.find(w => w.domain === 'hydraulic' && w.to.component === radiator.id && w.to.port === 'inlet')!;
    p.connections = p.connections.filter(w => w.id !== supply.id);
    p = connect(p, supply.from, { component: valve.id, port: 'inlet' });
    p = connect(p, { component: valve.id, port: 'outlet' }, { component: radiator.id, port: 'inlet' });
    const boiler = p.components.find(c => c.kind === 'electricBoiler')!, pump = p.components.find(c => c.kind === 'circulator')!;
    const bypass = makeComponent('valve', 480, 910, p.components);
    bypass.name = 'Minimum-flow bypass'; Object.assign(bypass.props, { diameter: 0.015, lossCoefficient: 100, opening: 100 }); p.components.push(bypass);
    p = connect(p, { component: boiler.id, port: 'outlet' }, { component: bypass.id, port: 'inlet' });
    p = connect(p, { component: bypass.id, port: 'outlet' }, { component: pump.id, port: 'inlet' });
    p.probes!.push({ id: uid(), component: valve.id, measurement: 'position', name: 'TRV effective opening', visible: true, color: '#9AA6B6' });
  }
  for (const [metric, label, color] of [['roomTemperature', 'Room air', '#C4CDD8'], ['heatInput', 'Room device gain', '#F59B85'], ['envelopeLoss', 'Envelope loss', '#8CC6F8'], ['ventilationLoss', 'Ventilation loss', '#9AA6B6'], ['storedThermalEnergy', 'Room stored energy Δ', '#C4B0FC']] as const) {
    p.probes!.push({ id: uid(), name: label, component: room.id, targetKind: 'space', measurement: metric, visible: true, color });
  }
  if (mode === 'roomCooldown') {
    const target = p.components.find(c => c.kind === 'constant')!, boiler = p.components.find(c => c.kind === 'electricBoiler')!;
    const demand = makeComponent('comparator', 40, 930, p.components); demand.props.mode = 'gt'; demand.props.reference = 0; demand.name = 'Heating start'; p.components.push(demand);
    const timer = makeComponent('timer', 330, 930, p.components); timer.props.mode = 'pulse'; timer.props.delay = 3600; timer.name = 'Heating for one hour'; p.components.push(timer);
    p = connect(p, { component: target.id, port: 'out' }, { component: demand.id, port: 'in' });
    p = connect(p, { component: demand.id, port: 'out' }, { component: timer.id, port: 'in' });
    p = connect(p, { component: timer.id, port: 'out' }, { component: boiler.id, port: 'enable' });
  }
  return p;
}
