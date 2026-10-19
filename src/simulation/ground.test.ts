import { describe, it, expect } from 'vitest';
import { Builder } from './scaling-validation';
import { Simulation } from './engine';
import type { Component, Project } from './model';
import { parseProject, serializeProject, starter } from './projects';
import { DEFAULT_GROUND_TEMPERATURE, GROUND, characteristicDimension, defaultSlab, equivalentThickness, groundTemperature, slabTransmittance, soilResistance } from './ground';
import { elementU, makeEnvelope, makeThermalSpace, opaqueArea, thermalSpaceError, type ThermalElement } from './thermal-spaces';
import { belowBoundary, characteristic, heatedFloorResistance, screedKey, upwardResistance } from './underfloor-heating';
import livingRoom from '../../examples/livingRoom.physics.json';

// ISO 13370 references are published values or were computed separately (Python, from the standard's slab-on-ground
// formulas) and are entered here as numbers; they do not come from ground.ts.

describe('EN ISO 13370 slab on ground', () => {
  it('reproduces the Physibel case study (12 × 9 m, λ 2.0, d_t 3.736 m → U_g 0.336 W/(m²·K))', () => {
    // Physibel knowledge base B6 "Floor thermal transmittance" (EN ISO 13370:2017 simplified method). w = 0 and R_f chosen
    // so that d_t is the published 3.736 m.
    const rf = 3.736 / 2 - 0.21;
    expect(characteristicDimension(108, 42)).toBeCloseTo(5.142857, 6);
    expect(equivalentThickness(0, 2, rf)).toBeCloseTo(3.736, 12);
    expect(Math.abs(slabTransmittance(108, 42, 0, 2, rf) - 0.336)).toBeLessThan(5e-4);
  });
  it('matches independent calculations on both branches', () => {
    expect(slabTransmittance(108, 42, 0.3, 2, 1.0)).toBeCloseTo(0.4105153, 6); // d_t 2.72 < B′ 5.14
    expect(slabTransmittance(20, 18, 0.3, 2, 0.1)).toBeCloseTo(1.0886342, 6); // uninsulated, d_t 0.92 < B′ 2.22
    expect(slabTransmittance(120, 44, 0.3, 2, 5)).toBeCloseTo(0.1513692, 6); // d_t 10.72 ≥ B′ 5.45
  });
  it('is monotonic and its two branches nearly meet at d_t = B′', () => {
    let last = Infinity;
    for (const rf of [0, 0.5, 1, 2, 3, 5, 8]) { const u = slabTransmittance(120, 44, 0.3, 2, rf); expect(u).toBeLessThan(last); last = u; }
    expect(slabTransmittance(120, 44, 0.3, 2, 2)).toBeLessThan(slabTransmittance(120, 60, 0.3, 2, 2)); // more exposed edge
    const b = characteristicDimension(120, 44), rf = (b - 0.3) / 2 - 0.21;
    const below = slabTransmittance(120, 44, 0.3, 2, rf - 1e-9), above = slabTransmittance(120, 44, 0.3, 2, rf + 1e-9);
    expect(Math.abs(below / above - 1)).toBeLessThan(0.06); // ISO's two expressions are not exactly continuous
  });
  it('splits into floor layers and a soil share that reproduce U once', () => {
    for (const rf of [0.1, 1, 2.7375, 5]) {
      const rg = soilResistance(120, 44, 0.3, 2, rf);
      expect(rg).toBeGreaterThan(0);
      expect(1 / (0.17 + rf + rg)).toBeCloseTo(slabTransmittance(120, 44, 0.3, 2, rf), 12);
    }
    expect(soilResistance(120, 44, 0.3, 2, 2.7375)).toBeCloseTo(1.4363636, 6); // independent: (0.457·B′ + d_t)/λ − R_si − R_f
  });
});

/** One room on the ground, every other surface adiabatic and no ventilation: only the floor exchanges with the outside. */
function groundRoom(floor: Partial<ThermalElement>, room: Partial<ReturnType<typeof makeThermalSpace>> = {}) {
  const s = Object.assign(makeThermalSpace(0, 0, 5, 4), { name: 'Ground room', airChangesPerHour: 0, initialTemperature: 20 }, room);
  const elements = makeEnvelope(s).map(e => e.kind === 'floor' ? { ...e, to: GROUND, slab: defaultSlab(), ...floor } : { ...e, uValue: 0 });
  return { s, elements, slab: elements.find(e => e.kind === 'floor')! };
}

describe('Rooms on the ground', () => {
  it('lose heat to the ground boundary, not to outdoor air, with the ISO 13370 U-value', () => {
    const { s, elements, slab } = groundRoom({ slab: { ...defaultSlab(), floorResistance: 0.1 } }, { internalGain: 300, addedHeatCapacity: 2e5 });
    const p: Project = { version: 5, id: 'g', name: 'Ground', components: [], connections: [], probes: [], assemblies: [], environment: { ambient: -10 }, ground: { kind: 'fixed', temperature: 8 }, thermalSpaces: [s], thermalElements: elements };
    expect(thermalSpaceError(p)).toBeNull();
    expect(elementU(p, slab)).toBeCloseTo(1.0886342, 6);
    const sim = new Simulation(p);
    sim.advanceAdaptive(48 * 3600);
    expect(sim.error).toBeNull();
    const t = sim.spaceTemperatures[s.id], r = sim.spaceReadings[s.id];
    expect(t).toBeCloseTo(8 + 300 / (1.0886342 * 20), 4); // steady: gain = U·A·(θ − θ_g), outdoor −10 °C irrelevant
    expect(r.groundLoss).toBeCloseTo(300, 3);
    expect(r.envelopeLoss).toBe(0);
    expect(Math.abs(sim.energyResidual)).toBeLessThan(1e-6);
  });
  it('keep an entered U-value when no floor resistance is given', () => {
    const { s, elements, slab } = groundRoom({ uValue: 0.4 });
    const p = { version: 5, id: 'g', name: 'Ground', components: [], connections: [], probes: [], assemblies: [], thermalSpaces: [s], thermalElements: elements } as Project;
    expect(elementU(p, slab)).toBe(0.4);
    expect(groundTemperature(p)).toBe(DEFAULT_GROUND_TEMPERATURE);
  });
});

/** Underfloor loop fed from a large hot tank in a 5 × 4 m room on the ground; the room's other surfaces adiabatic. */
function heatedGroundRoom(heatedArea = 20, capacity = 1e9) {
  const b = new Builder(), common = { capacity: 300000, volume: 100000, surfaceArea: 100000, loss: 0, maxPressure: 1e7 };
  const hot = b.add('tank', { ...common, initialTemperature: 40, elevation: 0.5 }), cold = b.add('tank', { ...common, initialTemperature: 20 });
  const floor = b.add('underfloorHeating', { initialTemperature: 20, heatedArea, length: heatedArea / 0.15 });
  b.wire(hot, 'fluid', floor, 'inlet'); b.wire(floor, 'outlet', cold, 'fluid');
  const { s, elements, slab } = groundRoom({ slab: { ...defaultSlab(), floorResistance: 1.0 } }, { addedHeatCapacity: capacity });
  b.p = { ...b.p, version: 5, environment: { ambient: -5 }, ground: { kind: 'fixed', temperature: 9 }, thermalSpaces: [s], thermalElements: elements };
  const c = b.p.components.find(x => x.id === floor.id)!;
  c.thermalSpaceId = s.id; c.props = { ...c.props, ambientMode: 'inherit' };
  return { b, floor: c, room: s, slab };
}

describe('Underfloor heating on the ground', () => {
  it('adds the soil share below R_u once, from the heated floor’s own layers', () => {
    const { b, floor, slab } = heatedGroundRoom();
    const below = belowBoundary(b.p, floor);
    // Independent: R_f = s_u/λ_E + R_λ,B + R_u = 0.0375 + 0.1 + 1.25; d_t = 0.3 + 2·(0.17 + R_f + 0.04) = 3.495 ≥ B′ 2.222.
    expect(heatedFloorResistance(floor)).toBeCloseTo(1.3875, 12);
    expect(below).toMatchObject({ temperature: 9, ground: true });
    expect(below.resistance).toBeCloseTo(0.6977778, 6);
    // The loop's whole floor-to-ground path equals the ISO 13370 U of its layers (R_si convention aside: EN 1264's 1/10.8
    // above the pipes instead of ISO's 0.17 for downward flow).
    const total = upwardResistance(floor) + (floor.props.downwardResistance as number) + below.resistance;
    expect(total - 1 / 10.8 + 0.17).toBeCloseTo(1 / 0.4434044, 5);
    // The element's own U (R_f 1.0) is used only for the unheated area.
    expect(opaqueArea(b.p, slab)).toBeCloseTo(0, 12);
    expect(belowBoundary({ ...b.p, ground: { kind: 'fixed', temperature: 4 } }, floor).temperature).toBe(4);
  });
  it('sends downward heat through R_u + R_soil to the ground at every step and in the steady state', () => {
    const { b, floor, room } = heatedGroundRoom();
    const sim = new Simulation(b.p), area = 20, n = 16, rDown = 1.25 + 0.6977777777777778, ro = upwardResistance(floor);
    let released = 0, before = sim.ambientEnergy;
    for (let i = 0; i < 400; i++) {
      expect(sim.step(30, true)).toBe(true);
      const h = sim.multiphysics.hydraulic.readings[floor.id], screed = sim.multiphysics.pipeCells[screedKey(floor.id)];
      // Independent of the transport: each screed node conducts (S − θ_g)/(R_u + R_soil) over 1/16 of the area.
      const expected = screed.reduce((sum, t) => sum + area / n * (t - 273.15 - 9) / rDown, 0);
      expect(Math.abs(h.downwardLoss! - expected)).toBeLessThan(1e-9 * Math.max(1, expected));
      released += h.downwardLoss! * 30;
    }
    // Downward heat leaves the system: the only exterior exchange in this room.
    expect(Math.abs(sim.ambientEnergy - before - released) / released).toBeLessThan(1e-9);
    expect(sim.spaceReadings[room.id].groundLoss).toBe(0); // no unheated floor left
    sim.advanceAdaptive(72 * 3600);
    expect(sim.error).toBeNull();
    const h = sim.multiphysics.hydraulic.readings[floor.id], t = sim.spaceTemperatures[room.id];
    // Steady EN 1264 balance at each plane node, summed: q_u = (R_o·q + θ_i − θ_g)/R_u,total.
    expect(Math.abs(h.downwardLoss! / ((ro * h.duty! + area * (t - 9)) / rDown) - 1)).toBeLessThan(1e-4);
    // and the characteristic still holds upward, independent of what is below.
    expect(h.duty! / area / h.excessTemperature!).toBeLessThan(characteristic(floor) * 1.02);
    expect(Math.abs(sim.energyResidual)).toBeLessThan(0.05);
  });
  it('conserves energy with a partly heated slab and a finite room', () => {
    const { b, floor, room, slab } = heatedGroundRoom(12, 2e6);
    expect(opaqueArea(b.p, slab)).toBeCloseTo(8, 12);
    const sim = new Simulation(b.p), u = elementU(b.p, slab);
    expect(u).toBeCloseTo(0.5353956, 6); // independent: R_f 1.0, B′ 2.222 m, d_t 2.72 m ≥ B′ → λ/(0.457·B′ + d_t)
    for (let i = 0; i < 240; i++) {
      expect(sim.step(30, true)).toBe(true);
      const r = sim.spaceReadings[room.id];
      expect(r.groundLoss).toBeCloseTo(u * 8 * (sim.spaceTemperatures[room.id] - 9), 9);
    }
    expect(Math.abs(sim.energyResidual)).toBeLessThan(0.05);
  });
});

describe('Compatibility and validation', () => {
  it('reads existing projects unchanged: floors stay on outdoor air and no ground field appears', () => {
    const p = parseProject(livingRoom);
    expect(p.ground).toBeUndefined();
    expect(p.thermalElements!.some(e => e.to === GROUND)).toBe(false);
    expect(p.thermalElements!.every(e => elementU(p, e) === e.uValue)).toBe(true);
    expect(serializeProject(p)).not.toMatch(/"ground":|"slab":/);
  });
  it('rejects ground on walls, slab data off the ground and out-of-range values', () => {
    const { s, elements } = groundRoom({});
    const base = { version: 5, id: 'g', name: 'Ground', components: [], connections: [], probes: [], assemblies: [], thermalSpaces: [s] } as Project;
    const wall = elements.map(e => e.kind === 'wall' ? { ...e, to: GROUND } : e);
    expect(thermalSpaceError({ ...base, thermalElements: wall })).toMatch(/only a floor can rest on the ground/);
    const outdoors = elements.map(e => e.kind === 'floor' ? { ...e, to: 'outdoors' } : e);
    expect(thermalSpaceError({ ...base, thermalElements: outdoors })).toMatch(/needs the ground endpoint/);
    const soil = elements.map(e => e.kind === 'floor' ? { ...e, slab: { ...defaultSlab(), soilConductivity: 0 } } : e);
    expect(thermalSpaceError({ ...base, thermalElements: soil })).toMatch(/slab-on-ground/);
    expect(thermalSpaceError({ ...base, thermalElements: elements, ground: { kind: 'fixed', temperature: 80 } })).toMatch(/Ground temperature/);
    expect(thermalSpaceError({ ...base, thermalElements: elements, ground: { kind: 'seasonal' } as unknown as Project['ground'] })).toMatch(/Unknown ground model/);
    expect(thermalSpaceError({ ...base, thermalElements: elements })).toBeNull();
  });
  it('round-trips the ground model and slab data', () => {
    const { b } = heatedGroundRoom();
    const loaded = parseProject(JSON.parse(serializeProject(b.p)));
    expect(loaded.ground).toEqual({ kind: 'fixed', temperature: 9 });
    expect(loaded.thermalElements).toEqual(b.p.thermalElements);
  });
  it('puts the heat-pump house on the ground', () => {
    const p = starter('heatPumpHouse'), floor = p.thermalElements!.find(e => e.kind === 'floor')!, c = p.components.find(x => x.kind === 'underfloorHeating')! as Component;
    expect(floor.to).toBe(GROUND);
    expect(p.ground).toBeUndefined(); // the documented default
    const below = belowBoundary(p, c);
    expect(below.temperature).toBe(DEFAULT_GROUND_TEMPERATURE);
    expect(below.resistance).toBeCloseTo(1.4363636, 6);
    expect(elementU(p, floor)).toBeCloseTo(0.2302098, 6);
    expect(serializeProject(parseProject(JSON.parse(serializeProject(p))))).toBe(serializeProject(p));
  });
});
