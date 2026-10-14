import { describe, expect, it, vi } from 'vitest';
import { Builder } from './scaling-validation';
import { pvFit, pvModel } from './solar';
import { solveElectrical } from './electrical';
import { Simulation } from './engine';
import { solarStarter } from './solar-projects';
import { parseProject, serializeProject } from './projects';
import { readProbe } from './measurements';
import { type Project, type Property } from './model';
import { batteryEnergy } from './devices';

function rig(ac = false) {
  const b = new Builder(), pv = b.add('solarPanel'), mppt = b.add('mpptController', ac ? { absorptionVoltage: 28.4, floatVoltage: 27, rebulkVoltage: 26.4, minVoltage: 16 } : {}), battery = b.add('lfpBattery', ac ? { cells: 8, emptyVoltage: 20, fullVoltage: 27.2, bmsLowVoltage: 22.4, bmsHighVoltage: 30, internalResistance: 0.0016 } : {});
  b.wire(pv, 'a', mppt, 'a'); b.wire(pv, 'b', mppt, 'b'); b.wire(mppt, 'oa', battery, 'a'); b.wire(mppt, 'ob', battery, 'b');
  let inverter, load;
  if (ac) { inverter = b.add('inverter'); load = b.add('resistor', { resistance: 529, ratedPower: 200 }); b.wire(battery, 'a', inverter, 'a'); b.wire(battery, 'b', inverter, 'b'); b.wire(inverter, 'oa', load, 'a'); b.wire(inverter, 'ob', load, 'b'); }
  return { b, pv, mppt, battery, inverter, load };
}
const run = (s: Simulation, seconds: number, dt = 0.1) => { for (let i = 0; i < Math.round(seconds / dt); i++) expect(s.step(dt), s.error ?? '').toBe(true); };
describe('renewable electrical network', () => {
  it('fits four STC ratings and the stationary MPP of a single diode', () => {
    const b = new Builder(), p = b.add('solarPanel'), m = pvModel(p);
    expect(pvFit(p).rs).toBeGreaterThan(0);
    expect(m.at(0).current).toBeCloseTo(10.74, 7);
    expect(m.at(52.9).current).toBeCloseTo(0, 7);
    expect(m.at(44.6).current).toBeCloseTo(10.09, 7);
    expect(m.vmp).toBeCloseTo(44.6, 7);
  });
  it('solves PV loads, open and short circuits through MNA', () => {
    for (const resistance of [0.001, 44.6 / 10.09, 1e9]) {
      const b = new Builder(), p = b.add('solarPanel'), load = b.add('resistor', { resistance }); b.wire(p, 'a', load, 'a'); b.wire(p, 'b', load, 'b');
      const r = solveElectrical(b.p), x = r.readings[p.id];
      expect(-x.current).toBeCloseTo(pvModel(p).at(x.voltage).current, 6);
      expect(Math.abs(r.powerResidual!)).toBeLessThan(1e-5);
    }
  });
  it('tracks the actual panel and charges finite storage, with conserved energy', () => {
    const { b, pv, mppt, battery } = rig(); solveElectrical(b.p); const s = new Simulation(b.p); expect(s.error).toBeNull();
    const before = batteryEnergy(battery, 0.5); run(s, 12);
    expect(s.devices.batteries[battery.id]).toBeGreaterThan(0.5);
    expect(-s.electrical.readings[pv.id].power).toBeGreaterThan(200);
    expect(s.electrical.readings[mppt.id].solar!.outputPower).toBeGreaterThan(200);
    expect(batteryEnergy(battery, s.devices.batteries[battery.id])).toBeGreaterThan(before);
    expect(Math.abs(s.energyResidual)).toBeLessThan(1e-3);
  });
  it('drives an existing AC load with DC bus energy', () => {
    const { b, inverter, load } = rig(true); const s = new Simulation(b.p); expect(s.error).toBeNull(); run(s, 1);
    expect(s.electrical.readings[load!.id].power).toBeCloseTo(100, 6);
    expect(s.electrical.readings[inverter!.id].solar!.inputPower).toBeGreaterThan(100);
    expect(Math.abs(s.energyResidual)).toBeLessThan(1e-3);
  });
});

const edit = (s: Simulation, id: string, props: Record<string, Property>) => expect(s.refresh({ ...s.project, components: s.project.components.map(c => c.id === id ? { ...c, props: { ...c.props, ...props } } : c) } as Project), s.error ?? '').toBe(true);
it.each([449, 449.9, 450, 450.013])('balances current-limited MPPT at %s W near the PV power maximum', watts => {
  const b = new Builder(), pv = b.add('solarPanel'), mppt = b.add('mpptController', { initialTrackingVoltage: 44.6, absorptionVoltage: 28.4, minVoltage: 16 }), bus = b.add('source', { voltage: watts * 0.98 / 20 - 0.02, internalResistance: 0.001, mode: 'internal' });
  b.wire(pv, 'a', mppt, 'a'); b.wire(pv, 'b', mppt, 'b'); b.wire(mppt, 'oa', bus, 'a'); b.wire(mppt, 'ob', bus, 'b');
  const r = solveElectrical(b.p), x = r.readings[mppt.id];
  expect(x.solar!.inputPower).toBeCloseTo(watts, 6);
  expect(x.solar!.outputPower).toBeCloseTo(watts * 0.98, 6);
  expect(r.readings[pv.id].voltage).toBeGreaterThan(pvModel(pv).vmp);
  expect(-r.readings[pv.id].current).toBeCloseTo(pvModel(pv).at(r.readings[pv.id].voltage).current, 8);
  expect(Math.abs(r.powerResidual!)).toBeLessThan(1e-7);
});
it('charges the off-grid example from 1% SOC for four minutes without losing coupling', () => {
  const p = solarStarter('solarOffGrid'), battery = p.components.find(c => c.kind === 'lfpBattery')!;
  battery.props.initialSOC = 1;
  const s = new Simulation(p); expect(s.error).toBeNull();
  run(s, 240);
  expect(s.devices.batteries[battery.id]).toBeGreaterThan(0.01);
  expect(Math.abs(s.energyResidual)).toBeLessThan(1e-3);
}, 120000);

it.each(['enabled', 'irradiance'] as const)('restarts MPPT after sunlight is restored via %s', parameter => {
  const p = solarStarter('solarOffGrid'), pv = p.components.find(c => c.kind === 'solarPanel')!, mppt = p.components.find(c => c.kind === 'mpptController')!;
  const s = new Simulation(p); run(s, 2);
  for (let cycle = 0; cycle < 2; cycle++) {
    edit(s, pv.id, { [parameter]: parameter === 'enabled' ? false : 0 }); run(s, 1);
    expect(s.electrical.readings[mppt.id].solar!.running).toBe(false);
    edit(s, pv.id, { [parameter]: parameter === 'enabled' ? true : 1000 }); run(s, 10);
    expect(s.electrical.readings[mppt.id].solar!.trackingEfficiency).toBeGreaterThan(0.99);
  }
  expect(Math.abs(s.energyResidual)).toBeLessThan(1e-3);
});
it('starts with a low configured tracking target despite the charging-induced battery voltage rise', () => {
  const { b, pv, mppt } = rig(true); mppt.props.initialTrackingVoltage = 1;
  const s = new Simulation(b.p); run(s, 0.4);
  expect(s.electrical.readings[mppt.id].solar!.running).toBe(true);
  expect(s.electrical.readings[mppt.id].solar!.outputPower).toBeGreaterThan(200);
  edit(s, pv.id, { enabled: false }); run(s, 0.1);
  edit(s, pv.id, { enabled: true }); run(s, 0.4);
  expect(s.electrical.readings[mppt.id].solar!.running).toBe(true);
  expect(Math.abs(s.energyResidual)).toBeLessThan(1e-3);
});
describe('solar references, events and numerical integrity', () => {
  it('checks the unused manufacturer NOCT point and temperature coefficients', () => {
    const b = new Builder(), c = b.add('solarPanel'), ref = pvModel(c);
    const noct = pvModel({ ...c, props: { ...c.props, irradiance: 800, cellTemperature: 43 } });
    // Independent published NOCT values (not fitting inputs), with 3% rating/model tolerance.
    expect(Math.abs(noct.pmp - 344) / 344).toBeLessThan(0.03);
    expect(Math.abs(noct.voc - 50.2) / 50.2).toBeLessThan(0.015);
    expect(Math.abs(noct.isc - 8.66) / 8.66).toBeLessThan(0.01);
    const hot = pvModel({ ...c, props: { ...c.props, cellTemperature: 50 } });
    expect(hot.voc).toBeCloseTo(52.9 * (1 - 0.0024 * 25), 6);
    expect(hot.isc / ref.isc).toBeCloseTo(1 + 0.0004 * 25, 6);
    expect(hot.pmp).toBeLessThan(ref.pmp);
  });
  it.each(['series', 'parallel'])('uses real %s wiring for multiple panels', topology => {
    const b = new Builder(), a = b.add('solarPanel'), c = b.add('solarPanel'), load = b.add('resistor', { resistance: 44.6 / 10.09 * (topology === 'series' ? 2 : 0.5) });
    if (topology === 'series') { b.wire(a, 'b', c, 'a'); b.wire(a, 'a', load, 'a'); b.wire(c, 'b', load, 'b'); }
    else { b.wire(a, 'a', c, 'a'); b.wire(a, 'b', c, 'b'); b.wire(a, 'a', load, 'a'); b.wire(a, 'b', load, 'b'); }
    const r = solveElectrical(b.p); expect(r.readings[load.id].power).toBeCloseTo(900.028, 5); expect(Math.abs(r.powerResidual!)).toBeLessThan(1e-5);
  });
  it('converges P&O, tracks clouds and heat, then discharges at night', () => {
    const { b, pv, mppt, battery } = rig(true), s = new Simulation(b.p); run(s, 10);
    expect(s.electrical.readings[mppt.id].solar!.trackingEfficiency).toBeGreaterThan(0.99);
    edit(s, pv.id, { irradiance: 400, cellTemperature: 60 }); run(s, 15);
    expect(s.electrical.readings[mppt.id].solar!.trackingEfficiency).toBeGreaterThan(0.98);
    const before = s.devices.batteries[battery.id]; edit(s, pv.id, { irradiance: 0 }); run(s, 2);
    expect(s.devices.batteries[battery.id]).toBeLessThan(before);
    expect(s.electrical.readings[mppt.id].solar!.outputPower).toBe(0);
    expect(Math.abs(s.energyResidual)).toBeLessThan(1e-3);
  });
  it.each([0, 100])('recovers or terminates charge at %s percent SOC', initialSOC => {
    const { b, battery, mppt } = rig(); battery.props.initialSOC = initialSOC;
    const s = new Simulation(b.p); expect(s.error).toBeNull(); run(s, 1);
    if (!initialSOC) expect(s.devices.batteries[battery.id]).toBeGreaterThan(0);
    else { expect(s.electrical.readings[mppt.id].solar!.outputPower).toBeLessThan(1e-6); expect(s.devices.batteries[battery.id]).toBe(1); }
    expect(Math.abs(s.energyResidual)).toBeLessThan(1e-3);
  });
  it('handles missing battery, missing PV and overvoltage without generated power', () => {
    for (const missing of ['battery', 'pv', 'overvoltage']) {
      const { b, battery, pv, mppt } = rig();
      if (missing === 'overvoltage') mppt.props.maxInputVoltage = 50;
      else b.p.connections = b.p.connections.filter(w => w.from.component !== (missing === 'battery' ? battery.id : pv.id) && w.to.component !== (missing === 'battery' ? battery.id : pv.id));
      const s = new Simulation(b.p); expect(s.error).toBeNull(); run(s, 0.5);
      expect(s.electrical.readings[mppt.id].solar!.outputPower).toBe(0);
    }
  });
  it('integrates battery SOC from actual signed current, blocks cold charge and trips excessive discharge', () => {
    const b = new Builder(), battery = b.add('lfpBattery'), load = b.add('resistor', { resistance: 10 }); b.series(battery, load);
    const s = new Simulation(b.p), before = s.devices.batteries[battery.id]; run(s, 0.1);
    expect(s.devices.batteries[battery.id]).toBeCloseTo(before + s.electrical.readings[battery.id].current * 0.1 / 360000, 10);
    const cold = rig(); cold.b.p.environment = { ambient: 0 }; const cs = new Simulation(cold.b.p); run(cs, 0.5);
    expect(cs.devices.batteries[cold.battery.id]).toBe(0.5);
    edit(s, load.id, { resistance: 0.01 }); run(s, 0.1);
    expect(s.devices.solar[battery.id].mode).toBe('overcurrent'); expect(s.electrical.readings[load.id].power).toBe(0);
  });
  it.each([0, 100, 200, 400])('inverter powers %s W with positive measured DC losses', watts => {
    const b = new Builder(), dc = b.add('source', { voltage: 25.6, maxCurrent: 100 }), inv = b.add('inverter'); b.series(dc, inv);
    if (watts) { const load = b.add('resistor', { resistance: 52900 / watts, ratedPower: 1000 }); b.wire(inv, 'oa', load, 'a'); b.wire(inv, 'ob', load, 'b'); }
    const s = new Simulation(b.p); expect(s.error).toBeNull(); run(s, 0.1);
    const r = s.electrical.readings[inv.id]; expect(r.solar!.outputPower).toBeCloseTo(watts, 7);
    expect(r.solar!.inputPower).toBeGreaterThan(watts); expect(r.heatPower).toBeGreaterThan(0);
    if (!watts) expect(r.solar!.inputPower).toBeCloseTo(6.5, 6);
    if (watts === 200) expect(r.solar!.efficiency).toBeCloseTo(0.9, 7);
  });
  it('supports standby, timed surge, overload shutdown and voltage hysteresis', () => {
    const b = new Builder(), dc = b.add('source', { voltage: 25.6, maxCurrent: 100 }), inv = b.add('inverter'), load = b.add('resistor', { resistance: 52900 / 600, ratedPower: 1000 });
    b.series(dc, inv); b.wire(inv, 'oa', load, 'a'); b.wire(inv, 'ob', load, 'b');
    const s = new Simulation(b.p); run(s, 1); expect(s.electrical.readings[load.id].power).toBeCloseTo(600, 7);
    run(s, 1.2); expect(s.electrical.readings[load.id].power).toBe(0); expect(s.devices.solar[inv.id].mode).toBe('overload');
    const r = rig(true); r.inverter!.props.standby = true; const standby = new Simulation(r.b.p); run(standby, 0.1);
    expect(standby.electrical.readings[r.inverter!.id].solar!.inputPower).toBeCloseTo(1.5, 6); expect(standby.electrical.readings[r.load!.id].power).toBe(0);
  });
  it('isolates a downstream load with hysteresis and a logical remote input', () => {
    const b = new Builder(), src = b.add('source', { voltage: 13.2 }), protect = b.add('batteryProtection'), load = b.add('resistor', { resistance: 10 }), remote = b.add('constant', { value: 1 }), compare = b.add('comparator', { mode: 'gt', reference: 0.5 });
    b.wire(src, 'a', protect, 'a'); b.wire(src, 'b', protect, 'reference'); b.wire(protect, 'b', load, 'a'); b.wire(load, 'b', src, 'b');
    b.wire(remote, 'out', compare, 'in'); b.wire(compare, 'out', protect, 'enable');
    const s = new Simulation(b.p); run(s, 0.1); expect(s.electrical.readings[load.id].power).toBeGreaterThan(1);
    edit(s, src.id, { voltage: 11.7 }); run(s, 0.1); expect(s.electrical.readings[load.id].power).toBe(0);
    edit(s, src.id, { voltage: 12.5 }); run(s, 0.1); expect(s.electrical.readings[load.id].power).toBe(0);
    edit(s, src.id, { voltage: 13.2 }); run(s, 0.1); expect(s.electrical.readings[load.id].power).toBeGreaterThan(1);
    edit(s, remote.id, { value: 0 }); run(s, 0.1); expect(s.electrical.readings[load.id].power).toBe(0);
    edit(s, remote.id, { value: 1 }); run(s, 0.1); expect(s.electrical.readings[load.id].power).toBeGreaterThan(1);
  });
  it('rolls back tracker memory, accumulated energies and chemical storage after a rejected step', () => {
    const { b } = rig(true), s = new Simulation(b.p), before = s.devices.checkpoint();
    const advance = s.multiphysics.advance.bind(s.multiphysics), spy = vi.spyOn(s.multiphysics, 'advance').mockImplementation((world, h) => { advance(world, h); throw Error('acceptance failure'); });
    expect(s.step(0.1)).toBe(false); expect(s.devices.checkpoint()).toEqual(before); expect(s.suppliedEnergy).toBe(0); expect(s.time).toBe(0); spy.mockRestore();
  });
  it.each(['solarCharging', 'solarOffGrid', 'solarCirculation', 'solarExperiment'] as const)('serializes generic %s, resolves probes and conserves energy', mode => {
    const project = solarStarter(mode), serialized = serializeProject(project);
    expect(serialized).not.toMatch(/Victron|Trina|Phoenix|SmartSolar|BatteryProtect/);
    const s = new Simulation(parseProject(JSON.parse(serialized))); expect(s.error).toBeNull(); run(s, 1);
    for (const p of project.probes!) expect(Number.isFinite(readProbe(p, s))).toBe(true);
    expect(s.violations).toEqual([]); expect(Math.abs(s.energyResidual)).toBeLessThan(1e-3);
  });
});

describe('solar regulation interoperability', () => {
  it('regulates absorption then float on the battery terminal voltage', () => {
    // Reference 14.2 V absorption / 13.5 V float profile; a 1 Ah pack at 99.95 % reaches full within 0.1 s.
    const { b, battery, mppt } = rig(); Object.assign(battery.props, { initialSOC: 99.95, capacityAh: 1 });
    mppt.props.absorptionTime = 1;
    const s = new Simulation(b.p); expect(s.error).toBeNull(); run(s, 1.5);
    expect(s.devices.solar[mppt.id].absorption).toBeGreaterThanOrEqual(1);
    expect(s.electrical.readings[mppt.id].solar!.mode).toBe('float');
    expect(Math.abs(s.energyResidual)).toBeLessThan(1e-3);
  });
  it('restarts the inverter only above its recovery threshold', () => {
    const b = new Builder(), source = b.add('source', { voltage: 25.6, maxCurrent: 100 }), inv = b.add('inverter'); b.series(source, inv);
    const s = new Simulation(b.p); run(s, 0.1); expect(s.devices.solar[inv.id].running).toBe(true);
    edit(s, source.id, { voltage: 18 }); run(s, 0.1); expect(s.devices.solar[inv.id].running).toBe(false);
    edit(s, source.id, { voltage: 20 }); run(s, 0.1); expect(s.devices.solar[inv.id].running).toBe(false);
    edit(s, source.id, { voltage: 22 }); run(s, 0.1); expect(s.devices.solar[inv.id].running).toBe(true);
  });
  it('handles reversed component order and common negative converter wiring', () => {
    const { b, pv, mppt, battery } = rig(); b.p.components.reverse(); b.wire(pv, 'b', battery, 'b');
    const s = new Simulation(b.p); expect(s.error).toBeNull(); run(s, 0.2);
    expect(s.electrical.readings[mppt.id].solar!.outputPower).toBeGreaterThan(200);
    expect(Math.abs(s.energyResidual)).toBeLessThan(1e-3);
  });
  it('opens overheated converters without drawing or supplying electrical power', () => {
    const { b, inverter, mppt } = rig(true); b.p.environment = { ambient: 70 };
    const s = new Simulation(b.p); expect(s.error).toBeNull();
    expect(s.electrical.readings[inverter!.id].solar!.inputPower).toBe(0);
    expect(s.electrical.readings[mppt.id].solar!.outputPower).toBe(0);
  });
});

it('enforces the battery terminal power limit with BMS isolation', () => {
  const b = new Builder(), battery = b.add('lfpBattery', { maxPower: 10 }), load = b.add('resistor', { resistance: 10 }); b.series(battery, load);
  const s = new Simulation(b.p); run(s, 0.1); expect(s.electrical.readings[load.id].power).toBe(0); expect(s.devices.solar[battery.id].mode).toBe('overcurrent');
});

it('accounts for measured throughput across the distribution switch and converter input energy', () => {
  const p = solarStarter('solarOffGrid'), protect = p.components.find(c => c.kind === 'batteryProtection')!, mppt = p.components.find(c => c.kind === 'mpptController')!;
  const s = new Simulation(p); run(s, 0.1); const x = s.electrical.readings[protect.id];
  expect(x.solar!.inputPower).toBeGreaterThan(20); expect(x.solar!.outputPower).toBeGreaterThan(20);
  expect(x.solar!.inputPower - x.solar!.outputPower).toBeCloseTo(x.heatPower!, 9);
  expect(s.devices.solar[mppt.id].generated).toBeGreaterThan(40);
});

it('holds the tracker at full battery and resumes conversion when a real load is switched on', () => {
  const { b, battery, mppt } = rig(); Object.assign(battery.props, { initialSOC: 100, capacityAh: 0.1 });
  const sw = b.add('switch', { closed: false }), load = b.add('resistor', { resistance: 2, ratedPower: 200 });
  b.wire(battery, 'a', sw, 'a'); b.wire(sw, 'b', load, 'a'); b.wire(load, 'b', battery, 'b');
  const s = new Simulation(b.p); run(s, 15); expect(s.devices.solar[mppt.id].target).toBe(40);
  edit(s, sw.id, { closed: true }); run(s, 2, 0.01);
  expect(s.electrical.readings[mppt.id].solar!.outputPower).toBeGreaterThan(50);
  expect(s.electrical.readings[load.id].power).toBeGreaterThan(50);
  expect(Math.abs(s.energyResidual)).toBeLessThan(1e-3);
});

it('solves fifty parallel CV/CC supplies without cycling', () => {
  const b = new Builder(), load = b.add('resistor', { resistance: 100 });
  for (let k = 1; k <= 50; k++) {
    const source = b.add('source', { voltage: k, mode: 'cvcc', internalResistance: 1, maxCurrent: 0.01 }); b.wire(source, 'a', load, 'a'); b.wire(source, 'b', load, 'b');
  }
  const r = solveElectrical(b.p);
  // At 17 V: 33 supplies deliver 10 mA, 16 absorb 10 mA, and the 17 V source is at zero current.
  // Net 0.17 A = 17 V / 100 Ω, independently satisfying both KCL and every compliance bound.
  expect(r.readings[load.id].voltage).toBeCloseTo(17, 10); expect(Math.abs(r.powerResidual!)).toBeLessThan(1e-9);
});

it('resolves fast charging across an LFP OCV knee without artificial battery cooling', () => {
  const p = solarStarter('solarCharging'), battery = p.components.find(c => c.kind === 'lfpBattery')!;
  Object.assign(battery.props, { initialSOC: 94, capacityAh: 0.01 });
  for (const h of [0.1, 0.01]) {
    const s = new Simulation(p); run(s, 0.1, h);
    expect(s.electrical.readings[battery.id].heatPower!).toBeGreaterThanOrEqual(-1e-6);
    expect(s.devices.batteries[battery.id]).toBeGreaterThan(0.94);
    expect(Math.abs(s.energyResidual)).toBeLessThan(1e-3);
  }
});
