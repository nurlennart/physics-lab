import { describe, expect, it, vi } from 'vitest';
import { AIR_CP, AIR_DENSITY, makeEnvelope, makeThermalSpace, opaqueArea, roomVolume, solveRoomBalance, spaceCapacity, thermalSpaceError, ventilationConductance } from './thermal-spaces';
import { starter, parseProject, serializeProject } from './projects';
import { Simulation } from './engine';
import { makeComponent, connect } from './model';
import { readProbe } from './measurements';
import { panelCapacity } from './panel-radiator';
import { createRunArchive, restoreRunArchive } from './replay';

export function roomProject() {
  const p = starter('blank'), room = makeThermalSpace();
  p.version = 5; p.thermalSpaces = [room]; p.thermalElements = []; p.environment = { ambient: 0 };
  return { p, room };
}
describe('thermal zone equations and schema', () => {
  it('uses SI dimensions, air capacity and effective contents', () => {
    const { p, room } = roomProject();
    expect(roomVolume(room)).toBe(50);
    expect(spaceCapacity(p, room)).toBe(50 * AIR_DENSITY * AIR_CP + 2e6);
    expect(ventilationConductance(room)).toBeCloseTo(8.375, 10);
  });
  it('subtracts openings and validates oversized windows', () => {
    const { p, room } = roomProject(); p.thermalElements = makeEnvelope(room);
    const wall = p.thermalElements[0];
    p.thermalElements.push({ id: 'window', name: 'Window', kind: 'window', from: room.id, to: 'outdoors', area: 3, uValue: 1.1, heatCapacity: 0, parentId: wall.id });
    expect(opaqueArea(p, wall)).toBe(9.5);
    expect(thermalSpaceError(p)).toBeNull();
    p.thermalElements.at(-1)!.area = 20;
    expect(thermalSpaceError(p)).toMatch(/exceed/);
  });
  it('converges to analytical cooling and constant-power heating', () => {
    const { p, room } = roomProject(); room.initialTemperature = 15;
    const C = spaceCapacity(p, room), G = ventilationConductance(room);
    for (const Q of [0, 500]) {
      room.internalGain = Q;
      const expected = Q / G + (15 - Q / G) * Math.exp(-G * 3600 / C);
      const errors = [60, 30, 15].map(h => {
        let t = { [room.id]: 15 };
        for (let at = 0; at < 3600; at += h) t = solveRoomBalance(p, t, h);
        return Math.abs(t[room.id] - expected);
      });
      expect(errors[0] / errors[1]).toBeCloseTo(2, 1);
      expect(errors[1] / errors[2]).toBeCloseTo(2, 1);
      expect(errors[2]).toBeLessThan(0.001);
    }
  });
  it('conserves energy between unequal rooms at very large steps', () => {
    const { p, room: a } = roomProject(), b = makeThermalSpace(600, 0, 2, 3);
    p.thermalSpaces!.push(b); a.airChangesPerHour = b.airChangesPerHour = 0;
    p.thermalElements = [{ id: 'partition', name: 'Partition', kind: 'wall', from: a.id, to: b.id, area: 10, uValue: 5, heatCapacity: 1e5 }];
    const ca = spaceCapacity(p, a), cb = spaceCapacity(p, b), t = solveRoomBalance(p, { [a.id]: 60, [b.id]: 10 }, 1e6);
    expect(ca * (t[a.id] - 60) + cb * (t[b.id] - 10)).toBeCloseTo(0, 5);
    expect(t[a.id]).toBeGreaterThan(t[b.id]); expect(t[b.id]).toBeGreaterThan(10);
  });
  it('round-trips new and old projects and rejects non-finite configuration', () => {
    const { p, room } = roomProject();
    expect(parseProject(JSON.parse(serializeProject(p)))).toEqual(p);
    expect(parseProject(starter('blank')).thermalSpaces).toBeUndefined();
    room.width = Infinity;
    expect(() => parseProject(p)).toThrow(/Thermal Space/);
  });
});

describe('accepted multiphysics zone coupling', () => {
  it('advances a cooling room through the engine and conserves external energy', () => {
    const { p, room } = roomProject(); room.initialTemperature = 15;
    const s = new Simulation(p), C = spaceCapacity(p, room), G = ventilationConductance(room);
    expect(s.step(30, true), s.error ?? '').toBe(true);
    expect(s.spaceTemperatures[room.id]).toBeCloseTo(C * 15 / (C + 30 * G), 10);
    expect(s.energyResidual).toBeCloseTo(0, 6);
    expect(s.spaceReadings[room.id].netHeat).toBeCloseTo(C * s.spaceReadings[room.id].rate, 6);
  });
  it('transfers precisely the radiator water/steel energy into an insulated room, without overshoot', () => {
    const { p, room } = roomProject(); room.airChangesPerHour = 0; room.addedHeatCapacity = 0;
    const radiator = makeComponent('panelRadiator', 20, 20); radiator.thermalSpaceId = room.id; radiator.props.initialTemperature = 70; p.components.push(radiator);
    const s = new Simulation(p), C = spaceCapacity(p, room), cr = panelCapacity(radiator);
    for (let i = 0; i < 20; i++) expect(s.step(30, true), s.error ?? '').toBe(true);
    const air = s.spaceTemperatures[room.id], water = s.multiphysics.pipeCells[radiator.id].reduce((a, b) => a + b, 0) / 16 - 273.15;
    expect(air).toBeGreaterThan(20); expect(air).toBeLessThan(water);
    expect(C * (air - 20) + cr * (water - 70)).toBeCloseTo(0, 5);
    expect(s.energyResidual).toBeCloseTo(0, 5);
    expect(s.ambientEnergy).toBeCloseTo(0, 6);
  });
  it('couples body losses rather than electrical nameplate power', () => {
    const { p, room } = roomProject(); room.airChangesPerHour = 0;
    const body = makeComponent('thermalMass', 0, 0); body.props.initialTemperature = 80; body.thermalSpaceId = room.id; p.components.push(body);
    const s = new Simulation(p);
    expect(s.step(30, true), s.error ?? '').toBe(true);
    expect(s.spaceTemperatures[room.id]).toBeGreaterThan(20);
    expect(s.temperatures[body.id]).toBeLessThan(80);
    expect(s.energyResidual).toBeCloseTo(0, 6);
  });
  it('converges under timestep refinement for actual finite radiator/room exchange', () => {
    const run = (h: number) => {
      const { p, room } = roomProject(); room.airChangesPerHour = 0; room.addedHeatCapacity = 0;
      const rad = makeComponent('panelRadiator', 0, 0); rad.props.initialTemperature = 70; rad.thermalSpaceId = room.id; p.components.push(rad);
      const s = new Simulation(p); for (let t = 0; t < 600; t += h) expect(s.step(h, h > 0.1)).toBe(true);
      expect(Math.abs(s.energyResidual)).toBeLessThan(0.5); return s.spaceTemperatures[room.id];
    };
    const reference = run(0.5), errors = [30, 15, 7.5].map(h => Math.abs(run(h) - reference));
    expect(errors[0] / errors[1]).toBeGreaterThan(1.5); expect(errors[1] / errors[2]).toBeGreaterThan(1.5); expect(errors[2]).toBeLessThan(0.1);
  });
  it('keeps component overrides outside the room energy balance', () => {
    const { p, room } = roomProject(); room.airChangesPerHour = 0;
    const radiator = makeComponent('panelRadiator', 0, 0); radiator.thermalSpaceId = room.id; radiator.props.initialTemperature = 70; radiator.props.ambientMode = 'override'; radiator.props.ambient = 5; p.components.push(radiator);
    const s = new Simulation(p); expect(s.step(30, true)).toBe(true);
    expect(s.spaceTemperatures[room.id]).toBeCloseTo(20, 10); expect(s.ambientEnergy).toBeGreaterThan(0); expect(s.energyResidual).toBeCloseTo(0, 5);
  });
  it('stops new electrical heat after failure while retained body heat still warms the room', () => {
    const { p, room } = roomProject(); room.airChangesPerHour = 0;
    const heater = makeComponent('heater', 100, 100), source = makeComponent('source', 0, 0);
    heater.thermalSpaceId = room.id; source.props.voltage = 120; p.components.push(heater, source);
    let rig = connect(p, { component: source.id, port: 'a' }, { component: heater.id, port: 'a' });
    rig = connect(rig, { component: heater.id, port: 'b' }, { component: source.id, port: 'b' });
    const s = new Simulation(rig); for (let i = 0; i < 100; i++) expect(s.step(0.1)).toBe(true);
    const supplied = s.suppliedEnergy, body = s.temperatures[heater.id], air = s.spaceTemperatures[room.id];
    expect(s.injectFault(heater.id, 'failedOpen')).toBeNull();
    for (let i = 0; i < 10; i++) expect(s.step(0.1)).toBe(true);
    expect(s.suppliedEnergy).toBeCloseTo(supplied, 6); expect(s.temperatures[heater.id]).toBeLessThan(body); expect(s.spaceTemperatures[room.id]).toBeGreaterThan(air); expect(s.energyResidual).toBeCloseTo(0, 5);
  });
  it('heats using the existing Bosch/circulator/Kermi circuit and retains residual tolerances', () => {
    const p = starter('kermi'), room = makeThermalSpace(); room.initialTemperature = 15; room.addedHeatCapacity = 1e5;
    p.version = 5; p.thermalSpaces = [room]; p.thermalElements = makeEnvelope(room); p.environment = { ambient: 0 };
    const radiator = p.components.find(c => c.kind === 'panelRadiator')!; radiator.thermalSpaceId = room.id;
    const s = new Simulation(p); const run = s.advanceAdaptive(900);
    expect(s.error).toBeNull(); expect(run.done).toBe(true); expect(s.spaceTemperatures[room.id]).toBeGreaterThan(15);
    expect(Math.abs(s.energyResidual)).toBeLessThan(0.5); expect(s.multiphysics.massResidual).toBeCloseTo(0, 6);
  }, 60_000);
  it('refreshes without integration and replays room state deterministically', async () => {
    const { p, room } = roomProject(); room.internalGain = 500;
    const s = new Simulation(p); expect(s.refresh(p)).toBe(true); expect(s.roomStored).toBe(0);
    const run = s.advanceAdaptive(60);
    const archive = createRunArchive(s.project, p, [{ at: 0, adaptive: { duration: 60, steps: run.steps, tolerance: 0.05, maxStep: 30 } }], s.time);
    const restored = (await restoreRunArchive(archive, async () => {})).simulation;
    expect(restored.spaceTemperatures).toEqual(s.spaceTemperatures); expect(restored.roomStored).toBe(s.roomStored); expect(s.energyResidual).toBeCloseTo(0, 6);
  });
  it('rolls back all room, component and energy state when an accepted solve fails', () => {
    const { p, room } = roomProject(); room.internalGain = 500;
    const radiator = makeComponent('panelRadiator', 0, 0); radiator.thermalSpaceId = room.id; radiator.props.initialTemperature = 70; p.components.push(radiator);
    const s = new Simulation(p), before = structuredClone({ room: s.spaceTemperatures, cells: s.multiphysics.pipeCells, stored: s.storedEnergy, ambient: s.ambientEnergy, supplied: s.suppliedEnergy });
    const advance = s.multiphysics.advance.bind(s.multiphysics);
    vi.spyOn(s.multiphysics, 'advance').mockImplementationOnce((s, h) => { advance(s, h); throw Error('Injected thermal failure'); });
    expect(s.step(0.1)).toBe(false); expect(s.time).toBe(0);
    expect({ room: s.spaceTemperatures, cells: s.multiphysics.pipeCells, stored: s.storedEnergy, ambient: s.ambientEnergy, supplied: s.suppliedEnergy }).toEqual(before);
    expect(s.roomStored).toBe(0); expect(s.spaceReadings).toEqual({});
  });
  it('rejects live capacity edits while retaining temperature through ambient and membership edits', () => {
    const { p, room } = roomProject(), s = new Simulation(p); s.step(0.1);
    const before = s.spaceTemperatures[room.id];
    expect(s.refresh({ ...p, thermalSpaces: [{ ...room, addedHeatCapacity: 3e6 }] })).toBe(false);
    expect(s.refresh({ ...p, environment: { ambient: 30 } })).toBe(true); expect(s.spaceTemperatures[room.id]).toBe(before);
    expect(s.step(0.1)).toBe(true); expect(s.spaceTemperatures[room.id]).toBeGreaterThan(before); expect(s.energyResidual).toBeCloseTo(0, 6);
  });
  it('sensors and persisted chart probes read live zone temperatures', () => {
    const { p, room } = roomProject(); room.internalGain = 500;
    const sensor = makeComponent('sensor', 0, 0); sensor.props.target = room.id; sensor.props.resolution = 1e-9; p.components.push(sensor);
    p.probes = [{ id: 'room-probe', component: room.id, targetKind: 'space', measurement: 'roomTemperature', name: 'Room temperature', visible: true, color: '#C4CDD8' }];
    const s = new Simulation(parseProject(JSON.parse(serializeProject(p))));
    expect(s.step(0.1)).toBe(true); expect(s.refresh(s.project)).toBe(true);
    expect(s.automation.sensors[sensor.id].value).toBeCloseTo(s.spaceTemperatures[room.id], 6);
    expect(readProbe(p.probes[0], s)).toBe(s.spaceTemperatures[room.id]);
  });
  it('uses matching electrical and accepted-storage coefficients for a temperature-dependent battery', () => {
    const { p, room } = roomProject(); room.airChangesPerHour = 0;
    const battery = makeComponent('battery', 0, 0), load = makeComponent('resistor', 200, 0);
    Object.assign(battery.props, { heatCapacity: 20, resistanceActivation: 8000, selfDischarge: 0 });
    Object.assign(load.props, { resistance: 1, ratedPower: 1000, heatCapacity: 1e5 });
    battery.thermalSpaceId = load.thermalSpaceId = room.id; p.components.push(battery, load);
    let rig = connect(p, { component: battery.id, port: 'a' }, { component: load.id, port: 'a' });
    rig = connect(rig, { component: load.id, port: 'b' }, { component: battery.id, port: 'b' });
    const s = new Simulation(rig);
    for (let i = 0; i < 20; i++) { expect(s.step(30, true), s.error ?? '').toBe(true); expect(Math.abs(s.energyResidual)).toBeLessThan(1e-5); }
    expect(s.spaceTemperatures[room.id]).toBeGreaterThan(20); expect(s.devices.batteries[battery.id]).toBeLessThan(0.8);
  });
  it('conserves room exchange in the engine and gives equal/opposite partition readings', () => {
    const { p, room: a } = roomProject(), b = makeThermalSpace(600, 0, 2, 3);
    a.airChangesPerHour = b.airChangesPerHour = 0; a.initialTemperature = 60; b.initialTemperature = 10;
    p.thermalSpaces!.push(b); p.thermalElements = [{ id: 'shared', name: 'Partition', kind: 'wall', from: a.id, to: b.id, area: 10, uValue: 5, heatCapacity: 1e5 }];
    const s = new Simulation(p); expect(s.step(30, true)).toBe(true);
    expect(s.spaceReadings[a.id].adjacentHeat).toBeCloseTo(-s.spaceReadings[b.id].adjacentHeat, 8); expect(s.energyResidual).toBeCloseTo(0, 6);
  });
  it('retains conservative flowing and reverse-flow water coupling to a room', () => {
    for (const reverse of [false, true]) {
      const { p, room } = roomProject(); room.airChangesPerHour = 0;
      const hot = makeComponent('tank', 0, 0), cold = makeComponent('tank', 400, 0), rad = makeComponent('panelRadiator', 200, 0);
      hot.props.initialTemperature = 75; hot.props.elevation = 0.03; hot.props.loss = cold.props.loss = 0; rad.thermalSpaceId = room.id;
      p.components.push(hot, cold, rad);
      let rig = connect(p, { component: hot.id, port: 'fluid' }, { component: rad.id, port: reverse ? 'outlet' : 'inlet' });
      rig = connect(rig, { component: rad.id, port: reverse ? 'inlet' : 'outlet' }, { component: cold.id, port: 'fluid' });
      const s = new Simulation(rig); for (let i = 0; i < 20; i++) expect(s.step(0.1), s.error ?? '').toBe(true);
      expect(Math.sign(s.multiphysics.hydraulic.readings[rad.id].flow)).toBe(reverse ? -1 : 1);
      expect(s.spaceTemperatures[room.id]).toBeGreaterThan(20); expect(Math.abs(s.energyResidual)).toBeLessThan(0.5);
    }
  });
});
