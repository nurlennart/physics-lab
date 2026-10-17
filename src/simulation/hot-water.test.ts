import { describe, expect, it } from 'vitest';
import { Simulation } from './engine';
import { Builder } from './scaling-validation';
import { prop, type Property } from './model';

function advance(s: Simulation, seconds: number, chunk = 60) {
  for (let t = 0; t < seconds - 1e-9; t += chunk) { s.advanceAdaptive(Math.min(chunk, seconds - t)); if (s.error) throw Error(s.error); }
}
/**
 * Heat pump at A7 with a radiator-like heating branch (A) and a WH 290 cylinder coil (B) behind a diverting valve VW1,
 * the cylinder sensor wired to TW1 and VW1 driven by the heat pump.
 */
function rig(heatPump: Record<string, Property> = {}, cylinder = 38) {
  const b = new Builder(); b.p.environment = { ambient: 7 };
  const mains = b.add('sourceAC', { voltage: 230, maxCurrent: 40, maxPower: 9200 });
  const hp = b.add('heatPump', { hotWater: true, targetMode: 'fixed', setpoint: 35, backupStages: 0, initialTemperature: 30, powerOnDelay: 0, ...heatPump });
  const pump = b.add('circulator', { mode: 'constantPressure', headSetpoint: 4 });
  const valve = b.add('divertingValve');
  const heating = b.add('radiator', { naturalUA: 250, forcedUA: 0, ambient: 20, ambientMode: 'override' });
  const flow = b.add('pipe', { diameter: 0.028, length: 3, segments: 2, initialTemperature: 30 });
  const tank = b.add('storageTank', { initialTemperature: cylinder, ambientMode: 'override', ambient: 20 }, 'wh290');
  const sensor = b.add('sensor', { target: tank.id, quantity: 'fluidTemperature' });
  const vessel = b.add('expansionVessel', { nominalVolume: 17, precharge: 75000, fillPressure: 130000 }, 'bosch17');
  b.wire(mains, 'a', hp, 'L'); b.wire(mains, 'b', hp, 'N'); b.wire(mains, 'a', pump, 'a'); b.wire(mains, 'b', pump, 'b');
  b.wire(hp, 'outlet', valve, 'inlet'); b.wire(valve, 'outletA', heating, 'inlet'); b.wire(valve, 'outletB', flow, 'inlet'); b.wire(flow, 'outlet', tank, 'coilIn');
  b.wire(heating, 'outlet', pump, 'inlet'); b.wire(tank, 'coilOut', pump, 'inlet'); b.wire(pump, 'outlet', hp, 'inlet'); b.wire(vessel, 'fluid', pump, 'inlet');
  b.wire(sensor, 'out', hp, 'dhwSensor'); b.wire(hp, 'dhw', valve, 'position');
  return { b, hp, valve, tank, heating };
}

describe('3-way diverting valve', () => {
  it('splits the flow by its position, runs at its running time and springs back to A without a command', () => {
    const { b, valve, hp } = rig({ hotWater: false });
    const s = new Simulation(b.p);
    advance(s, 300);
    const flow = (part: string) => s.multiphysics.hydraulic.readings[`${valve.id}#${part}`].flow;
    expect(s.multiphysics.positions[valve.id]).toBe(0);
    expect(flow('b')).toBe(0); expect(flow('a')).toBeGreaterThan(1e-4);
    // Unwired command: the position parameter; half way the paths share the flow.
    s.refresh({ ...s.project, connections: s.project.connections.filter(w => !(w.to.component === valve.id && w.to.port === 'position')), components: s.project.components.map(c => c.id === valve.id ? { ...c, props: { ...c.props, position: 50 } } : c) });
    s.step(0.1);
    expect(s.multiphysics.positions[valve.id]).toBeCloseTo(100 * 0.1 / prop(valve, 'responseTime'), 9);
    advance(s, 30, 1);
    expect(s.multiphysics.positions[valve.id]).toBe(50);
    expect(flow('a')).toBeGreaterThan(0); expect(flow('b')).toBeGreaterThan(0);
    expect(s.multiphysics.hydraulic.readings[valve.id].flow).toBeCloseTo(flow('a') + flow('b'), 15);
    expect(s.injectFault(valve.id, 'controlLost')).toBeNull();
    advance(s, 30, 1);
    expect(s.multiphysics.positions[valve.id]).toBe(0);
    expect(Math.abs(s.energyResidual)).toBeLessThan(1e-3); void hp;
  });
});

describe('heat pump hot-water mode', () => {
  it('charges the cylinder with priority: VW1 to B, flow target = cylinder + Ladedelta, back to heating at the stop temperature', () => {
    const { b, hp, valve, tank } = rig({ dhwStart: 40, dhwStop: 44 });
    const s = new Simulation(b.p), st = () => s.multiphysics.heatPumps[hp.id];
    advance(s, 120);
    expect(st().dhw).toBe(true);
    expect(s.multiphysics.positions[valve.id]).toBe(100);
    const sensor = s.fluidTemperatureMeasurement(tank.id)!;
    expect(st().target).toBeCloseTo(sensor + prop(hp, 'dhwDelta'), 0);
    // Heating gets no water while the valve is at B.
    expect(s.multiphysics.hydraulic.readings[`${valve.id}#a`].flow).toBe(0);
    let charged = 0;
    for (let t = 0; t < 3600 && !charged; t += 60) { advance(s, 60); if (!st().dhw) charged = s.time; }
    expect(charged).toBeGreaterThan(0);
    expect(s.fluidTemperatureMeasurement(tank.id)!).toBeGreaterThanOrEqual(44 - 0.2);
    advance(s, 60);
    expect(s.multiphysics.positions[valve.id]).toBe(0);
    expect(st().target).toBe(35);
    const dhwCop = st().dhwHeat / st().dhwElectricity;
    advance(s, 1200);
    const view = s.multiphysics.heatPumpView[hp.id];
    // Hot water at a higher condensing temperature: a visibly lower COP than heating at 35 °C.
    expect(dhwCop).toBeLessThan(view.cop! - 0.4);
    expect(st().dhwCharges).toBe(1);
    expect(s.events.some(e => e.message.includes('hot water charged'))).toBe(true);
    expect(Math.abs(s.energyResidual)).toBeLessThan(1e-2);
  });

  it('ends a charge at the maximum hot-water time and gives heating the same time before the next charge', () => {
    const { b, hp } = rig({ dhwStart: 50, dhwStop: 65, dhwMaxTime: 600 });
    const s = new Simulation(b.p), st = () => s.multiphysics.heatPumps[hp.id];
    advance(s, 60);
    expect(st().dhw).toBe(true);
    advance(s, 600);
    expect(st().dhw).toBe(false);
    expect(st().dhwBlockedUntil).toBeGreaterThan(s.time);
    advance(s, st().dhwBlockedUntil - s.time - 30);
    expect(st().dhw).toBe(false);
    advance(s, 90);
    expect(st().dhw).toBe(true);
    expect(st().dhwCharges).toBe(2);
    expect(s.events.some(e => e.message.includes('min limit'))).toBe(true);
  });

  it('charges hot water with heating disabled (summer) and stops when charged; no charge without the sensor', () => {
    const { b, hp } = rig({ enabled: false, dhwStart: 40, dhwStop: 43 });
    const s = new Simulation(b.p), st = () => s.multiphysics.heatPumps[hp.id];
    advance(s, 120);
    expect(st().dhw).toBe(true); expect(st().mode).toBe('heating');
    for (let t = 0; t < 3600 && st().dhw; t += 60) advance(s, 60);
    advance(s, 60);
    expect(st().dhw).toBe(false); expect(st().mode).toBe('off');
    const unwired = rig({ dhwStart: 40 });
    unwired.b.p.connections = unwired.b.p.connections.filter(w => w.to.port !== 'dhwSensor');
    const u = new Simulation(unwired.b.p); advance(u, 120);
    expect(u.multiphysics.heatPumps[unwired.hp.id].dhw).toBe(false);
  });
});
