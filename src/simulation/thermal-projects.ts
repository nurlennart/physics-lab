import { connect, makeComponent, uid, type Project } from './model';
import { deviceStarter } from './device-projects';
import { makeEnvelope, makeThermalSpace } from './thermal-spaces';

export function thermalStarter(mode: 'livingRoom' | 'roomCooldown'): Project {
  let p = deviceStarter('kermi');
  const room = makeThermalSpace(860, 240, 5, 4); room.name = 'Living Room'; room.initialTemperature = 15;
  p.version = 5; p.name = mode === 'livingRoom' ? 'Heated living room' : 'Heating switched off';
  p.environment = { ambient: 0 }; p.thermalSpaces = [room]; p.thermalElements = makeEnvelope(room);
  const north = p.thermalElements[0];
  p.thermalElements.push({ id: uid(), name: 'Double-glazed window', kind: 'window', from: room.id, to: 'outdoors', area: 2, parentId: north.id, uValue: 1.1, heatCapacity: 0, preset: 'Illustrative modern glazing' });
  const radiator = p.components.find(c => c.kind === 'panelRadiator')!;
  radiator.thermalSpaceId = room.id; radiator.thermalSpacePinned = true;
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
