import { describe, it, expect } from 'vitest';
import { Builder } from './scaling-validation';
import { Simulation } from './engine';
import { Multiphysics } from './multiphysics';
import type { Component, Project, Property } from './model';
import { hybridStarter } from './hybrid-projects';
import { starter } from './projects';

// The engine skips its start-of-step refresh in purely electrical projects while its discrete key (tripped and failed
// devices, faults, contacts, disconnected wires) and the project are unchanged (engine.ts, solve). The key does not hold
// the devices' inner states (battery limits, BMS, converter modes), so every transition below is run twice, with the
// skip and with a refresh at every step, and the complete state must agree bit for bit after every step. Each case
// checks that its transition really happens inside the run (not through an edit, unless stated) and that the skip
// was really taken.

/** Complete observable state of a run. */
const state = (s: Simulation) => JSON.stringify([
  s.time, s.error, s.devices.batteries, s.devices.solar, s.devices.hybrid, s.devices.capacitors, s.devices.inductors, s.devices.contactors,
  s.electrical.readings, s.temperatures, s.breakers, s.failed, s.tripped, s.automation.contacts, s.automation.signals,
  s.energyResidual, s.suppliedEnergy, s.violations, s.events.map(e => `${e.time}:${e.message}`),
]);
/** Count calls of the refresh on one simulation. */
function countRefreshes(s: Simulation) {
  let n = 0;
  const original = Multiphysics.prototype.refresh;
  const wrap = (mp: Multiphysics) => { mp.refresh = function (this: Multiphysics, sim: Simulation) { if (sim === s) n++; return original.call(this, sim); }; };
  wrap(s.multiphysics);
  return { count: () => n, rewrap: () => wrap(s.multiphysics) };
}
/**
 * Runs `p` twice for `steps` fixed steps (with the skip, and with a refresh at every step), applying `act` to both
 * before each step, and compares the complete state after every step. Returns the skipping run for checks.
 */
function compare(p: Project, steps: number, act?: (s: Simulation, step: number) => void) {
  const skipping = new Simulation(structuredClone(p)), reference = new Simulation(structuredClone(p));
  reference.skipRedundantRefresh = false;
  expect(skipping.error).toBeNull();
  const refreshes = countRefreshes(skipping);
  for (let i = 0; i < steps; i++) {
    act?.(skipping, i); act?.(reference, i);
    refreshes.rewrap();
    const a = skipping.step(1 / 60), b = reference.step(1 / 60);
    expect(a, `step ${i}`).toBe(b);
    expect(state(skipping), `state after step ${i + 1}`).toBe(state(reference));
    if (!a) break;
  }
  expect(refreshes.count(), 'refresh skipped on unchanged steps').toBeLessThan(steps / 2);
  return skipping;
}
const edit = (s: Simulation, c: Component, props: Record<string, Property>) =>
  expect(s.refresh({ ...s.project, components: s.project.components.map(x => x.id === c.id ? { ...x, props: { ...x.props, ...props } } : x) } as Project), s.error ?? '').toBe(true);

describe('refresh skip across state changes inside the simulation', () => {
  it('a fuse melts on overload', () => {
    const b = new Builder(), battery = b.add('battery', { initialSOC: 90, maxCurrent: 1e4 }), fuse = b.add('fuse', { ratedCurrent: 2, tripTime: 0.1 }), load = b.add('resistor', { resistance: 0.5, ratedPower: 1e6 });
    b.series(battery, fuse, load);
    const s = compare(b.p, 120);
    expect(s.failed[fuse.id], 'the fuse melted during the run').toBe(true);
  });
  it('a breaker trips magnetically, is reset after cooling and stays closed on a lighter load', () => {
    const b = new Builder(), battery = b.add('battery', { initialSOC: 90, maxCurrent: 1e4 }), breaker = b.add('breaker', { ratedCurrent: 2 }), load = b.add('resistor', { resistance: 0.2, ratedPower: 1e6 });
    b.series(battery, breaker, load);
    let tripped = false, reset = false;
    const s = compare(b.p, 600, (sim, i) => {
      if (sim.breakers[breaker.id]?.tripped && sim.skipRedundantRefresh) tripped = true;
      // Reset (an operator action, after cooling) with the load raised to 100 Ω.
      if (i === 300) { edit(sim, sim.project.components.find(c => c.id === load.id)!, { resistance: 100 }); const error = sim.resetBreaker(breaker.id); if (sim.skipRedundantRefresh) reset = error === null; }
    });
    expect(tripped, 'the breaker tripped inside the run').toBe(true);
    expect(reset, 'the reset was accepted').toBe(true);
    expect(s.breakers[breaker.id].tripped).toBe(false);
  });
  it('a battery reaches full charge and then empty', () => {
    const full = new Builder(), battery = full.add('battery', { capacityAh: 0.00002, initialSOC: 99, internalResistance: 0.2 }), charger = full.add('source', { voltage: 15, ratedVoltage: 30, maxCurrent: 1e5 });
    full.series(charger, battery);
    expect(compare(full.p, 120).devices.batteries[battery.id]).toBeCloseTo(1, 9);
    const empty = new Builder(), cell = empty.add('battery', { capacityAh: 0.00002, initialSOC: 1 }), load = empty.add('resistor', { resistance: 10 });
    empty.series(cell, load);
    expect(compare(empty.p, 120).devices.batteries[cell.id]).toBe(0);
  });
  it('an LFP pack runs down to its BMS low-voltage cut-off', () => {
    const b = new Builder(), pack = b.add('lfpBattery', { capacityAh: 0.0005, initialSOC: 3 }), load = b.add('resistor', { resistance: 2, ratedPower: 1e4 });
    b.series(pack, load);
    const s = compare(b.p, 900);
    expect(s.electrical.readings[load.id].power, 'the BMS isolated the load').toBeLessThan(1e-6);
  });
  it('an inverter goes into overload shutdown after its surge time', () => {
    const b = new Builder(), dc = b.add('source', { voltage: 25.6, maxCurrent: 100 }), inv = b.add('inverter'), load = b.add('resistor', { resistance: 52900 / 600, ratedPower: 1000 });
    b.series(dc, inv); b.wire(inv, 'oa', load, 'a'); b.wire(inv, 'ob', load, 'b');
    const s = compare(b.p, 180);
    expect(s.devices.solar[inv.id].mode).toBe('overload');
  });
  it('a grid-tied inverter disconnects on grid loss and reconnects by itself when the grid returns', () => {
    const p = hybridStarter('gridSolar'), grid = p.components.find(c => c.kind === 'sourceAC')!, inv = p.components.find(c => c.kind === 'gridInverter')!;
    const modes = new Set<string>();
    const s = compare(p, 900, (sim, i) => {
      // The grid is switched off and on again by edits; the inverter's disconnection, waiting and reconnection follow inside.
      if (i === 120) edit(sim, sim.project.components.find(c => c.id === grid.id)!, { enabled: false });
      if (i === 300) edit(sim, sim.project.components.find(c => c.id === grid.id)!, { enabled: true });
      if (sim.skipRedundantRefresh) modes.add(`${sim.devices.hybrid[inv.id]?.connected}`);
    });
    expect([...modes].sort()).toEqual(['false', 'true']);
    expect(s.devices.hybrid[inv.id].connected, 'reconnected after the grid returned').toBe(true);
  });
  it('a hybrid inverter transfers to backup after a grid outage', () => {
    const p = hybridStarter('gridBackup'), grid = p.components.find(c => c.name === 'Utility grid') ?? p.components.find(c => c.kind === 'sourceAC')!, hybrid = p.components.find(c => c.kind === 'hybridInverter')!;
    const s = compare(p, 240, (sim, i) => { if (i === 60) edit(sim, sim.project.components.find(c => c.id === grid.id)!, { enabled: false }); });
    expect(s.devices.hybrid[hybrid.id].mode).toBe('backup');
  });
  it('a supply trips its electronic output protection on inrush', () => {
    const b = new Builder(), source = b.add('source', { voltage: 12, maxCurrent: 1 }), r = b.add('resistor', { resistance: 1, ratedPower: 1e4 }), cap = b.add('capacitor', { capacitance: 0.1 });
    b.series(source, r, cap);
    const s = compare(b.p, 60);
    expect(s.failed[source.id], 'the supply switched itself off').toBe(true);
  });
  it('a controller switches a load on and off by itself', () => {
    // Hysteresis on the load resistor's temperature drives a relay in the load circuit: the load heats, the relay opens,
    // it cools, the relay closes again.
    const b = new Builder(), battery = b.add('battery', { initialSOC: 90, maxCurrent: 1e4 }), relay = b.add('relay', { resistance: 0.01 });
    const load = b.add('resistor', { resistance: 2, ratedPower: 1e4, heatCapacity: 2, loss: 0.5, maxTemperature: 500 });
    b.wire(battery, 'a', relay, 'a'); b.wire(relay, 'b', load, 'a'); b.wire(load, 'b', battery, 'b');
    const sensor = b.add('sensor', { target: load.id }), control = b.add('hysteresis', { low: 25, high: 30, initialOn: true });
    b.wire(sensor, 'out', control, 'in'); b.wire(control, 'out', relay, 'in');
    let switches = 0, last: boolean | undefined;
    compare(b.p, 1800, sim => {
      if (!sim.skipRedundantRefresh) return;
      const on = sim.automation.contacts[relay.id];
      if (last !== undefined && on !== last) switches++;
      last = on;
    });
    expect(switches, 'the relay switched by itself at least twice').toBeGreaterThanOrEqual(2);
  });
  it('never skips where the refresh does real work: water, motors, rooms', () => {
    for (const mode of ['circulation', 'induction', 'livingRoom'] as const) {
      const s = new Simulation(starter(mode)), refreshes = countRefreshes(s);
      for (let i = 0; i < 30; i++) { refreshes.rewrap(); expect(s.step(1 / 60), `${mode}: ${s.error}`).toBe(true); }
      expect(refreshes.count(), mode).toBe(30);
    }
  });
});
