import { describe, expect, it } from 'vitest';
import { Simulation } from './engine';
import { Builder } from './scaling-validation';
import { pipeEnthalpy } from './hydraulic';
import { prop, type Component, type Project } from './model';
import { WATER_CP } from './units';
import { kellDensity } from './water';
import { coilUAFromRating, layerCapacity, mixInversions, storageResponse, storageLayers, coilLayers } from './storage-tank';
import { ATMOSPHERE, valveSetPoints, vesselPressure, waterAtPressure } from './expansion';
import { deviceStarter } from './device-projects';
import { catalog, connect, makeComponent, type Kind, type Property } from './model';
import { applyDerived } from './parameters';

function advance(s: Simulation, seconds: number, chunk = 30) {
  for (let t = 0; t < seconds - 1e-9; t += chunk) { s.advanceAdaptive(Math.min(chunk, seconds - t)); if (s.error) throw Error(s.error); }
}
const layers = (s: Simulation, c: Component) => s.multiphysics.pipeCells[c.id].map(t => t - 273.15);
const stablyStratified = (cells: number[]) => cells.every((t, k) => k === 0 || kellDensity(cells[k - 1]) >= kellDensity(t) - 1e-9);

/** Gravity rig: a hot header tank feeds port 1 (top) and the storage tank drains from port 2 (bottom) to a low tank. */
function chargingRig(top: number, bottom: number, storage: Record<string, Property> = {}) {
  const b = new Builder();
  const header = b.add('tank', { capacity: 2000, volume: 1500, surfaceArea: 1, elevation: 3, initialTemperature: 60, loss: 0, vesselHeatCapacity: 0 }, 'standard', 'Header');
  const sink = b.add('tank', { capacity: 2000, volume: 10, surfaceArea: 1, elevation: 0, initialTemperature: 20, loss: 0, vesselHeatCapacity: 0 }, 'standard', 'Sink');
  const tank = b.add('storageTank', { storageVolume: 100, tankHeight: 1, initialTemperature: 20, standbyHeatLoss: 0, p1Height: top, p2Height: bottom, ...storage });
  const feed = b.add('pipe', { length: 20, diameter: 0.012, inventory: false });
  const drain = b.add('pipe', { length: 20, diameter: 0.012, inventory: false });
  b.wire(header, 'fluid', feed, 'inlet'); b.wire(feed, 'outlet', tank, 'p1'); b.wire(tank, 'p2', drain, 'inlet'); b.wire(drain, 'outlet', sink, 'fluid');
  return { b, tank, header, sink };
}

describe('stratified storage tank', () => {
  it('meets the Bosch BH 120-5 standby rating: 52 W at 65/20 °C and about 1.2 kWh per day', () => {
    const b = new Builder(), tank = b.add('storageTank', { initialTemperature: 65 });
    b.p.environment = { ambient: 20 };
    const s = new Simulation(b.p);
    expect(prop(tank, 'loss') * 45).toBeCloseTo(52, 9);
    expect(s.step(0.1)).toBe(true);
    expect(s.ambientEnergy / 0.1).toBeCloseTo(52, 1);
    advance(s, 86400, 600);
    // Held at 65 °C the loss is Bosch's 52 W × 24 h ≈ 1.2 kWh/d; left to cool freely it follows the lumped decay
    // E = C·45 K·(1 − e^(−UA·t/C)) (the store stays nearly uniform: wall losses mix by inversion).
    const C = storageLayers(tank) * layerCapacity(tank), ua = prop(tank, 'loss');
    expect(s.ambientEnergy / (C * 45 * -Math.expm1(-ua * 86400 / C)) - 1).toBeLessThan(0.01);
    expect(s.ambientEnergy / 3.6e6).toBeGreaterThan(1.1); expect(s.ambientEnergy / 3.6e6).toBeLessThan(1.25);
    // Uncharged energy balance: stored enthalpy change equals the loss.
    const stored = pipeEnthalpy(s.project, s.multiphysics.pipeCells) - storageLayers(tank) * layerCapacity(tank) * (65 + 273.15);
    expect(stored + s.ambientEnergy).toBeCloseTo(0, 2);
    expect(stablyStratified(layers(s, tank))).toBe(true);
    expect(Math.abs(s.energyResidual)).toBeLessThan(1e-3);
  });

  it('charges as a stratified plug: the bottom outlet stays cold until the store has been displaced once', () => {
    const { b, tank } = chargingRig(95, 5);
    const s = new Simulation(b.p);
    s.step(0.1);
    const q = s.multiphysics.hydraulic.readings[`${tank.id}#p1`].flow, displacement = 0.1 / q;
    expect(q * 60000).toBeGreaterThan(1);
    advance(s, 0.5 * displacement, 10);
    const outletHalf = s.multiphysics.hydraulic.readings[`${tank.id}#p2`].temperature - 273.15;
    // A fully mixed tank would already deliver 20 + 40·(1 − e^−0.5) = 35.7 °C.
    expect(outletHalf).toBeLessThan(23);
    expect(layers(s, tank).at(-1)).toBeGreaterThan(58);
    advance(s, 1.5 * displacement, 10);
    expect(s.multiphysics.hydraulic.readings[`${tank.id}#p2`].temperature - 273.15).toBeGreaterThan(50);
    expect(stablyStratified(layers(s, tank))).toBe(true);
    expect(Math.abs(s.energyResidual)).toBeLessThan(1e-3);
    expect(Math.abs(s.multiphysics.massResidual)).toBeLessThan(1e-9);
  });

  it('lets hot water entering low rise by buoyancy (inversion mixing) and keeps the store stable', () => {
    const { b, tank } = chargingRig(5, 50);
    const s = new Simulation(b.p);
    advance(s, 300, 10);
    const cells = layers(s, tank);
    expect(cells.at(-1)!).toBeGreaterThan(21);
    expect(stablyStratified(cells)).toBe(true);
    expect(Math.abs(s.energyResidual)).toBeLessThan(1e-3);
  });

  it('mixes density inversions conservatively, including the anomaly below 4 °C', () => {
    const t = [300, 320, 310, 305].map(x => x), energy = t.reduce((a, b) => a + b, 0);
    mixInversions(t);
    expect(t.reduce((a, b) => a + b, 0)).toBeCloseTo(energy, 10);
    expect(stablyStratified(t.map(k => k - 273.15))).toBe(true);
    // Below 4 °C colder water is lighter: 1 °C above 3 °C is stable.
    const cold = [276.15, 274.15]; mixInversions(cold); expect(cold).toEqual([276.15, 274.15]);
  });

  it('reproduces the Bosch WH 290 coil rating (11.0 kW at 55 °C flow, 45 °C store, 1,000 l/h) exactly', () => {
    const ua = coilUAFromRating(11000, 55, 45, 1000);
    expect(ua).toBeCloseTo(3418.8, 1);
    // Steady state of the coil cells against a store held at 45 °C (very large store, very long implicit step).
    const c = makeComponent('storageTank', 0, 0, []); c.variant = 'wh290';
    c.props = applyDerived('storageTank', { ...catalog(c).props, ...{ storageVolume: 1e9, coil: true, coilVolume: 22, coilUA: ua, coilTop: 61, coilBottom: 17 } });
    const n = storageLayers(c), m = coilLayers(c).length, rate = 1000 / 3600;
    const r = storageResponse(c, Array(n).fill(318.15), Array(m).fill(318.15), [], [], { node: 'in', rate, heat: 0, forward: true }, 318.15, 1e4);
    const order = [...r.coilCells.keys()], last = r.n + order.at(-1)!;
    const outlet = r.base[last] + r.response.get('in')![last] * 328.15;
    expect(Math.abs(rate * WATER_CP * (328.15 - outlet) / 11000 - 1)).toBeLessThan(1e-3);
  });

  it('heats a cylinder through its coil, conserving energy, with the coil water separate from the store', () => {
    let p: Project = deviceStarter('boiler');
    const add = (kind: Kind, props: Record<string, Property> = {}, variant?: string) => { const c = makeComponent(kind, 0, 0, p.components); if (variant) c.variant = variant; c.props = applyDerived(kind, { ...catalog(c).props, ...props }); p.components.push(c); return c; };
    const radiator = p.components.find(c => c.kind === 'radiator')!, supply = p.components.find(c => c.name.startsWith('Insulated supply'))!, valve = p.components.find(c => c.kind === 'valve')!;
    const cylinder = add('storageTank', { initialTemperature: 15 }, 'wh290');
    p = { ...p, components: p.components.filter(c => c.id !== radiator.id), connections: p.connections.filter(w => w.from.component !== radiator.id && w.to.component !== radiator.id) };
    p = connect(p, { component: supply.id, port: 'outlet' }, { component: cylinder.id, port: 'coilIn' });
    p = connect(p, { component: cylinder.id, port: 'coilOut' }, { component: valve.id, port: 'inlet' });
    const s = new Simulation(p);
    const before = layers(s, cylinder).reduce((a, t) => a + t, 0);
    advance(s, 1200, 30);
    const after = layers(s, cylinder);
    expect(after.reduce((a, t) => a + t, 0)).toBeGreaterThan(before + 20 * 5);
    // The coil heats the lower part first; the top above the coil warms by conduction and inversion mixing only.
    expect(s.multiphysics.hydraulic.readings[cylinder.id].duty).toBeGreaterThan(1000);
    expect(stablyStratified(after)).toBe(true);
    expect(Math.abs(s.energyResidual)).toBeLessThan(1e-2);
  });
});

/** Sealed loop of pipes warmed by a 60 °C environment, with a membrane vessel and optionally a safety valve. */
function sealedLoop(vessel: Record<string, Property> = {}, valve = false, liters = 50) {
  const b = new Builder();
  const pipes = [0, 1].map(() => b.add('pipe', { length: liters / 1000 / (Math.PI * 0.05 ** 2 / 4) / 2, diameter: 0.05, thermalUA: 400, initialTemperature: 20, segments: 4 }));
  b.wire(pipes[0], 'outlet', pipes[1], 'inlet'); b.wire(pipes[1], 'outlet', pipes[0], 'inlet');
  const v = b.add('expansionVessel', vessel);
  b.wire(v, 'fluid', pipes[0], 'inlet');
  const sv = valve ? b.add('safetyValve') : undefined;
  if (sv) b.wire(sv, 'inlet', pipes[1], 'inlet');
  b.p.environment = { ambient: 60 };
  return { b, vessel: v, valve: sv, pipes };
}

describe('expansion vessel and safety valve', () => {
  it('holds the fill pressure cold and follows the isothermal gas law as the circuit expands (Kell densities)', () => {
    const { b, vessel } = sealedLoop({ nominalVolume: 25, precharge: 150000, fillPressure: 180000 });
    const s = new Simulation(b.p);
    expect(s.multiphysics.vessels[vessel.id].pressure).toBeCloseTo(180000, 6);
    expect(s.multiphysics.hydraulic.readings[vessel.id].pressure).toBeCloseTo(180000, 3);
    advance(s, 4 * 3600, 300);
    const water = s.project.components.filter(c => c.kind === 'pipe').reduce((sum, c) => sum + prop(c, 'length') * Math.PI * prop(c, 'diameter') ** 2 / 4 * 1000, 0);
    const temperature = s.multiphysics.pipeCells[s.project.components.find(c => c.kind === 'pipe')!.id][0] - 273.15;
    expect(temperature).toBeGreaterThan(59.9);
    // Independent: the circuit's water expands from 20 °C to its present temperature at fixed mass.
    const expansion = water / 1000 * (kellDensity(20) / kellDensity(temperature) - 1);
    expect(s.multiphysics.pipeCells[s.project.components.find(c => c.kind === 'pipe')!.id].every(t => Math.abs(t - 273.15 - temperature) < 1e-6)).toBe(true);
    const vn = 0.025, fill = vn * (1 - (150000 + ATMOSPHERE) / (180000 + ATMOSPHERE));
    const expected = (150000 + ATMOSPHERE) * vn / (vn - fill - expansion) - ATMOSPHERE;
    expect(s.multiphysics.vessels[vessel.id].expansion).toBeCloseTo(expansion, 12);
    expect(s.multiphysics.vessels[vessel.id].pressure).toBeCloseTo(expected, 0);
    expect(s.multiphysics.hydraulic.readings[vessel.id].pressure).toBeCloseTo(expected, 0);
    expect(expected / 1e5).toBeGreaterThan(1.85);
    expect(Math.abs(s.multiphysics.massResidual)).toBeLessThan(1e-12);
  });

  it('a flat vessel (no precharge) lets the pressure climb steeply; losing the cushion while running drops it', () => {
    const flat = new Simulation(sealedLoop({ nominalVolume: 25, precharge: 0, fillPressure: 150000 }, false, 150).b.p);
    const good = new Simulation(sealedLoop({ nominalVolume: 25, precharge: 120000, fillPressure: 150000 }, false, 150).b.p);
    advance(flat, 3600, 300); advance(good, 3600, 300);
    const id = (s: Simulation) => s.project.components.find(c => c.kind === 'expansionVessel')!.id;
    expect(flat.multiphysics.vessels[id(flat)].pressure).toBeGreaterThan(good.multiphysics.vessels[id(good)].pressure + 0.3e5);
    const before = good.multiphysics.vessels[id(good)].pressure;
    expect(good.injectFault(id(good), 'gasLoss')).toBeNull();
    const v = good.multiphysics.vessels[id(good)], c = good.project.components.find(c => c.kind === 'expansionVessel')!;
    expect(v.pressure).toBeCloseTo(ATMOSPHERE * prop(c, 'nominalVolume') / 1000 / (prop(c, 'nominalVolume') / 1000 - v.water) - ATMOSPHERE, 3);
    expect(v.pressure).toBeLessThan(before);
  });

  it('an undersized vessel lifts the 3 bar safety valve: pressure bounded by TRD 721, water and energy leave exactly', () => {
    const { b, vessel, valve } = sealedLoop({ nominalVolume: 8, precharge: 150000, fillPressure: 180000 }, true, 300);
    const s = new Simulation(b.p);
    let peak = 0;
    for (let t = 0; t < 6 * 3600; t += 60) { advance(s, 60, 60); peak = Math.max(peak, s.multiphysics.hydraulic.readings[valve!.id].differentialPressure); }
    const { set, full, reseat } = valveSetPoints(valve!);
    // Sampled once a minute: the valve holds the circuit between its reseat and set pressure, never near full lift.
    expect(peak).toBeGreaterThan(reseat);
    expect(peak).toBeLessThan(Math.min(full, set + 0.5e5));
    expect(s.multiphysics.valveOpenings[valve!.id]).toBeGreaterThan(0);
    const v = s.multiphysics.vessels[vessel.id], discharged = s.multiphysics.discharged[valve!.id];
    expect(discharged * 1000).toBeGreaterThan(1);
    // Water conservation: discharge = expansion − growth of the vessel's water side.
    expect(discharged).toBeCloseTo(v.expansion - (v.water - waterAtPressure(vessel, 180000, v.system)), 6);
    expect(s.multiphysics.removedMass).toBeCloseTo(discharged * 1000, 6);
    expect(Math.abs(s.multiphysics.massResidual)).toBeLessThan(1e-9);
    expect(s.multiphysics.cushionWork).toBeGreaterThan(0);
    expect(Math.abs(s.energyResidual)).toBeLessThan(1e-2);
    expect(s.events.some(e => e.message.includes('opened at'))).toBe(true);
  });

  it('a seized safety valve leaves the overpressure unchecked and reports the rating violation', () => {
    const { b, valve } = sealedLoop({ nominalVolume: 8, precharge: 150000, fillPressure: 180000 }, true, 300);
    const s = new Simulation(b.p);
    expect(s.injectFault(valve!.id, 'stuckClosed')).toBeNull();
    try { advance(s, 6 * 3600, 300); } catch { /* the cushion may bottom out */ }
    expect(s.multiphysics.discharged[valve!.id]).toBe(0);
    expect(s.violations.some(v => v.includes('pressure rating') || v.includes('fully compressed'))).toBe(true);
  });

  it('agrees between fixed steps and adaptive macro steps', () => {
    const project = sealedLoop({ nominalVolume: 12 }).b.p, fixed = new Simulation(project), adaptive = new Simulation(project);
    for (let i = 0; i < 6000; i++) fixed.step(0.1);
    advance(adaptive, 600, 60);
    const id = fixed.project.components.find(c => c.kind === 'expansionVessel')!.id;
    const rise = fixed.multiphysics.vessels[id].pressure - prop(fixed.project.components.find(c => c.id === id)!, 'fillPressure');
    expect(rise).toBeGreaterThan(1e4);
    expect(Math.abs(fixed.multiphysics.vessels[id].pressure - adaptive.multiphysics.vessels[id].pressure)).toBeLessThan(0.02 * rise);
  });

  it('pressure function: fill point, gas law and the empty-vessel branch are continuous', () => {
    const c = makeComponent('expansionVessel', 0, 0, []);
    const fill = waterAtPressure(c, 180000, 0.1);
    expect(vesselPressure(c, fill, 0.1)).toBeCloseTo(180000, 6);
    expect(vesselPressure(c, 1e-12, 0.1)).toBeCloseTo(150000, 3);
    expect(vesselPressure(c, -1e-12, 0.1)).toBeCloseTo(150000, 0);
    expect(vesselPressure(c, -1e-3, 0.1)).toBeLessThan(0);
  });

  it('rejects a second vessel in one circuit, a vessel in a vented circuit and a safety valve without a water reserve', () => {
    const two = sealedLoop(); const extra = two.b.add('expansionVessel'); two.b.wire(extra, 'fluid', two.pipes[1], 'inlet');
    expect(new Simulation(two.b.p).error ?? '').toContain('one expansion vessel per sealed circuit');
    const b = new Builder(), tank = b.add('tank'), pipe = b.add('pipe'), v = b.add('expansionVessel');
    b.wire(tank, 'fluid', pipe, 'inlet'); b.wire(v, 'fluid', pipe, 'outlet');
    expect(new Simulation(b.p).error ?? '').toContain('vented tank');
    const c = new Builder(), loop = [c.add('pipe'), c.add('pipe')], sv = c.add('safetyValve');
    c.wire(loop[0], 'outlet', loop[1], 'inlet'); c.wire(loop[1], 'outlet', loop[0], 'inlet'); c.wire(sv, 'inlet', loop[0], 'inlet');
    expect(new Simulation(c.p).error ?? '').toContain('expansion vessel');
  });
});
