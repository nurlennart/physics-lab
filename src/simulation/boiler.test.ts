import { describe, it, expect, vi } from 'vitest';
import { Builder } from './scaling-validation';
import { Simulation } from './engine';
import { solveElectrical } from './electrical';
import { boilerWaterCapacity } from './boiler';
import { WATER_CP } from './units';
import { pipeWaterMass } from './hydraulic';
import { type Property, type Project } from './model';
import { readProbe } from './measurements';
import { starter, parseProject } from './projects';

export function boilerRig(props: Record<string, Property> = {}, singlePhase = false, flowing = false) {
  const b = new Builder(), boiler = b.add('electricBoiler', props);
  const sources = [0, -120, 120].slice(0, singlePhase ? 1 : 3).map(phase => b.add('sourceAC', { voltage: 230, phase, maxCurrent: 63, maxPower: 15000 }));
  for (let i = 0; i < 3; i++) b.wire(sources[singlePhase ? 0 : i], 'a', boiler, `L${i + 1}`);
  for (const src of sources) b.wire(src, 'b', boiler, 'N');
  const earth = b.add('ground'); b.wire(earth, 'a', boiler, 'PE');
  let pump, valve;
  if (flowing) {
    pump = b.add('circulator'); valve = b.add('valve', { diameter: 0.02 });
    const supply = b.add('pipe', { diameter: 0.02, length: 8, thermalUA: 0 }), back = b.add('pipe', { diameter: 0.02, length: 8, thermalUA: 0 });
    const radiator = b.add('radiator', { naturalUA: 100, forcedUA: 0, ambient: 20 });
    b.wire(sources[0], 'a', pump, 'a'); b.wire(sources[0], 'b', pump, 'b');
    b.wire(boiler, 'outlet', supply, 'inlet'); b.wire(supply, 'outlet', radiator, 'inlet'); b.wire(radiator, 'outlet', valve, 'inlet');
    b.wire(valve, 'outlet', back, 'inlet'); b.wire(back, 'outlet', pump, 'inlet'); b.wire(pump, 'outlet', boiler, 'inlet');
  }
  return { b, boiler, sources, pump, valve };
}
function run(s: Simulation, duration: number, h = 0.1) {
  for (let i = 0; i < Math.round(duration / h); i++) if (!s.step(h)) throw Error(s.error ?? 'step failed');
}
function edit(s: Simulation, id: string, props: Record<string, Property>) {
  expect(s.refresh({ ...s.project, components: s.project.components.map(c => c.id === id ? { ...c, props: { ...c.props, ...props } } : c) } as Project), s.error ?? '').toBe(true);
}
const water = (s: Simulation, id: string) => s.multiphysics.pipeCells[id][0] - 273.15;

describe('Bosch TH3000 9 electrical calibration', () => {
  it('draws three actual phase-to-neutral stages and supports bridged 230 V wiring', () => {
    for (const single of [false, true]) {
      const { b, boiler, sources } = boilerRig({}, single);
      for (const count of [0, 1, 2, 3]) {
        const e = solveElectrical(b.p, {}, { boilers: { [boiler.id]: count } }), r = e.readings[boiler.id];
        expect(r.heatingPower).toBeCloseTo(count * 3000, 6);
        expect(r.power).toBeCloseTo(count * 3000 + 3, 6);
        expect(r.stageCurrents![0]).toBeCloseTo(count ? 3000 / 230 : 0, 8);
        expect(Math.abs(e.powerResidual ?? Infinity)).toBeLessThan(1e-7);
        if (count === 3) {
          const current = Math.abs(e.readings[sources[0].id].current);
          // Independent Bosch ratings (13.1 A per phase / 39.2 A bridged live).
          expect(Math.abs(current - (single ? 39.2 : 13.1)) / current).toBeLessThan(0.005);
          expect(r.current).toBeCloseTo(current, 8);
        }
      }
    }
  });
  it('uses V²/R rather than rated watts and resolves feeder voltage drop', () => {
    const { b, boiler, sources } = boilerRig();
    sources.forEach(c => { c.props.voltage = 207; c.props.internalResistance = 0.5; });
    const e = solveElectrical(b.p, {}, { boilers: { [boiler.id]: 3 } }), r = e.readings[boiler.id];
    const resistance = 230 ** 2 / 3000;
    expect(r.stageVoltages![1]).toBeCloseTo(207 * resistance / (resistance + 0.5), 7);
    expect(r.heatingPower).toBeCloseTo(r.stageVoltages!.reduce((sum, v) => sum + v * v / resistance, 0), 7);
    expect(r.heatingPower).toBeLessThan(7290);
  });
});
describe('boiler thermal physics and regulation', () => {
  it('matches 3.7 L storage and analytical isolated warm-up including element inertia', () => {
    const { b, boiler } = boilerRig({ loss: 0, maxStages: 1 });
    const s = new Simulation(b.p); expect(s.error).toBeNull(); run(s, 30);
    const state = s.multiphysics.boilers[boiler.id], cw = 3.7 * WATER_CP + 3500, ce = 1500;
    expect(boilerWaterCapacity(boiler)).toBe(cw);
    expect(cw * (water(s, boiler.id) - 20) + ce * (state.elementTemperature - 293.15)).toBeCloseTo(90000, 5);
    const tau = cw * ce / (1200 * (cw + ce));
    const difference = 3000 / 1200 * cw / (cw + ce) * (1 - Math.exp(-30 / tau));
    const expectedWater = 20 + (90000 - ce * difference) / (cw + ce);
    expect(water(s, boiler.id)).toBeCloseTo(expectedWater, 4);
    expect(Math.abs(s.energyResidual)).toBeLessThan(1e-6);
  });
  it('switches stages on simulation time independently of the outer timestep', () => {
    const states = [1 / 60, 0.1].map(h => {
      const { b, boiler } = boilerRig({ loss: 0 }); const s = new Simulation(b.p);
      run(s, 1, h); expect(s.multiphysics.boilers[boiler.id].stages).toBe(1);
      run(s, 2, h); expect(s.multiphysics.boilers[boiler.id].stages).toBe(2);
      run(s, 2, h); expect(s.multiphysics.boilers[boiler.id].stages).toBe(3);
      return { temperature: water(s, boiler.id), energy: s.suppliedEnergy };
    });
    expect(Math.abs(states[0].temperature - states[1].temperature)).toBeLessThan(0.004);
    expect(states[0].energy).toBeCloseTo(states[1].energy, 6);
  });
  it('cycles with hysteresis and restart inhibition at zero flow without normal safety trips', () => {
    const { b, boiler } = boilerRig({ setpoint: 35, loss: 60, antiCycleTime: 10 }); const s = new Simulation(b.p);
    run(s, 400);
    expect(s.multiphysics.boilers[boiler.id].switches).toBeGreaterThan(10);
    expect(water(s, boiler.id)).toBeGreaterThan(27);
    expect(water(s, boiler.id)).toBeLessThan(39);
    expect(s.multiphysics.boilers[boiler.id].fault).toBe('');
    expect(Math.abs(s.energyResidual)).toBeLessThan(1e-5);
  });
  it('latches independent overtemperature on welded regulation, and rejects hot manual resets', () => {
    const { b, boiler } = boilerRig({ loss: 0 }); const s = new Simulation(b.p);
    s.injectFault(boiler.id, 'stuckClosed'); run(s, 190);
    const state = s.multiphysics.boilers[boiler.id];
    expect(state.fault).toBe('overtemperature'); expect(state.stages).toBe(0);
    expect(water(s, boiler.id)).toBeGreaterThan(95); expect(water(s, boiler.id)).toBeLessThan(97);
    expect(s.resetSafety(boiler.id)).toContain('Cool below');
    expect(Math.abs(s.energyResidual)).toBeLessThan(1e-5);
    edit(s, boiler.id, { loss: 200 }); run(s, 100);
    expect(water(s, boiler.id)).toBeLessThan(70);
    expect(s.resetSafety(boiler.id)).toBeNull(); expect(state.fault).toBe('');
  });
  it('proves flow optionally, latches on pump failure and conserves heat after shutdown', () => {
    const { b, boiler, pump } = boilerRig({ flowInterlock: true }, false, true); const s = new Simulation(b.p);
    run(s, 30); expect(s.multiphysics.boilers[boiler.id].fault).toBe('');
    expect(s.multiphysics.hydraulic.readings[boiler.id].flow).toBeGreaterThan(130 / 3600000);
    s.injectFault(pump!.id, 'motorFailure'); run(s, 8);
    expect(s.multiphysics.boilers[boiler.id].fault).toBe('flow');
    expect(s.resetSafety(boiler.id)).toContain('Restore circulation');
    s.injectFault(pump!.id, null); run(s, 5); expect(s.resetSafety(boiler.id)).toBeNull();
    edit(s, boiler.id, { enabled: false }); run(s, 10);
    expect(s.multiphysics.boilers[boiler.id].stages).toBe(0);
    expect(Math.abs(s.energyResidual)).toBeLessThan(0.001);
  });
  it('heats a closed pipe/radiator loop and closes the ledger through startup and power loss', () => {
    const { b, boiler, sources } = boilerRig({}, false, true); const s = new Simulation(b.p);
    run(s, 180);
    expect(water(s, boiler.id)).toBeGreaterThan(40);
    expect(s.multiphysics.hydraulic.readings[boiler.id].duty).toBeGreaterThan(0);
    // Independent stored-energy reconstruction, rather than trusting the accumulated ledger.
    const fluidStored = s.project.components.filter(c => s.multiphysics.pipeCells[c.id]).reduce((sum, c) => {
      const cells = s.multiphysics.pipeCells[c.id], capacity = c.kind === 'electricBoiler' ? 3.7 * WATER_CP + 3500 : pipeWaterMass(c) * WATER_CP;
      return sum + capacity * (cells.reduce((a, t) => a + t, 0) / cells.length - 293.15);
    }, 0);
    const elementStored = 1500 * (s.multiphysics.boilers[boiler.id].elementTemperature - 293.15);
    expect(Math.abs(s.storedEnergy - fluidStored - elementStored)).toBeLessThan(0.001);
    expect(Math.abs(s.waterStored - fluidStored)).toBeLessThan(0.001);
    expect(Math.abs(s.heaterStored - elementStored)).toBeLessThan(0.001);
    expect(Math.abs(s.energyResidual)).toBeLessThan(0.001);
    sources.forEach(src => edit(s, src.id, { enabled: false })); run(s, 5);
    expect(s.multiphysics.boilers[boiler.id].stages).toBe(0);
    expect(s.electrical.readings[boiler.id].power).toBe(0);
    expect(Math.abs(s.energyResidual)).toBeLessThan(0.001);
  });
  it('locks out on undervoltage and requires a healthy recovery interval', () => {
    const { b, boiler, sources } = boilerRig(); const s = new Simulation(b.p); run(s, 5);
    edit(s, sources[1].id, { voltage: 170 }); run(s, 0.1);
    expect(s.multiphysics.boilers[boiler.id].stages).toBe(0);
    edit(s, sources[1].id, { voltage: 230 }); run(s, 1);
    expect(s.multiphysics.boilers[boiler.id].stages).toBe(0); run(s, 15);
    expect(s.multiphysics.boilers[boiler.id].stages).toBe(3);
  });
});

describe('boiler system integration regressions', () => {
  it('preserves continuity and the specified pressure datum in a sealed filled loop', () => {
    const { b, boiler } = boilerRig({}, false, true); const s = new Simulation(b.p); run(s, 8);
    const readings = Object.values(s.multiphysics.hydraulic.readings);
    const flow = s.multiphysics.hydraulic.readings[boiler.id].flow;
    expect(flow).toBeGreaterThan(130 / 3600000);
    for (const r of readings) expect(r.flow).toBeCloseTo(flow, 12);
    expect(s.multiphysics.hydraulic.readings[boiler.id].inletPressure).toBeCloseTo(150000, 6);
    expect(Math.max(...readings.flatMap(r => [r.pressure, r.inletPressure]))).toBeLessThan(200000);
    expect(s.violations).toEqual([]);
  });
  it('rolls back water, elements, stages, controller memory and electrical state after a rejected coupled step', () => {
    const { b, boiler } = boilerRig({}, false, true); const s = new Simulation(b.p), reference = new Simulation(b.p);
    const before = structuredClone(s.multiphysics.boilers), waterBefore = structuredClone(s.multiphysics.pipeCells);
    const original = s.multiphysics.advance.bind(s.multiphysics);
    const spy = vi.spyOn(s.multiphysics, 'advance').mockImplementation((world, h) => { original(world, h); world.log('rejected trial'); throw Error('synthetic acceptance failure'); });
    expect(s.step(0.1)).toBe(false);
    expect(s.time).toBe(0); expect(s.suppliedEnergy).toBe(0); expect(s.storedEnergy).toBe(0);
    expect(s.multiphysics.boilers).toEqual(before); expect(s.multiphysics.pipeCells).toEqual(waterBefore);
    expect(s.events.some(e => e.message === 'rejected trial')).toBe(false);
    expect(s.electrical.readings[boiler.id].heatingPower).toBe(0);
    spy.mockRestore(); run(s, 6); run(reference, 6);
    expect(s.multiphysics.boilers).toEqual(reference.multiphysics.boilers);
    expect(s.multiphysics.pipeCells).toEqual(reference.multiphysics.pipeCells);
    expect(s.suppliedEnergy).toBe(reference.suppliedEnergy);
  });
  it('keeps paused solves energy neutral, exposes temperatures at rest and accepts ordinary temperature sensors', () => {
    const { b, boiler } = boilerRig({ heatCapacity: 1234.56789, vesselHeatCapacity: 3456.78901 }); const sensor = b.add('sensor', { target: boiler.id });
    const s = new Simulation(b.p); run(s, 8);
    const before = { stored: s.storedEnergy, supplied: s.suppliedEnergy, cells: structuredClone(s.multiphysics.pipeCells), boilers: structuredClone(s.multiphysics.boilers) };
    for (let i = 0; i < 5; i++) expect(s.refresh(s.project)).toBe(true);
    expect(s.storedEnergy).toBe(before.stored); expect(s.suppliedEnergy).toBe(before.supplied);
    expect(s.multiphysics.pipeCells).toEqual(before.cells); expect(s.multiphysics.boilers).toEqual(before.boilers);
    expect(s.automation.sensors[sensor.id].valid).toBe(true);
    expect(s.automation.sensors[sensor.id].value).toBeCloseTo(water(s, boiler.id), 2);
  });
  it('uses a wired supply target and fails off if its control connection becomes unavailable', () => {
    const { b, boiler } = boilerRig(); const target = b.add('constant', { value: 40 }); b.wire(target, 'out', boiler, 'setpoint');
    const s = new Simulation(b.p); run(s, 2);
    expect(s.multiphysics.boilers[boiler.id].setpoint).toBe(40);
    s.injectFault(target.id, 'controlLost'); run(s, 0.1);
    expect(s.multiphysics.boilers[boiler.id].stages).toBe(0);
    expect(s.multiphysics.boilers[boiler.id].status).toBe('Control unavailable');
    s.injectFault(target.id, null); run(s, 15);
    s.disconnect(s.project.connections.find(w => w.to.component === boiler.id && w.to.port === 'setpoint')!.id); run(s, 0.1);
    expect(s.multiphysics.boilers[boiler.id].stages).toBe(0);
    expect(s.multiphysics.boilers[boiler.id].status).toBe('Control unavailable');
  });
  it('conserves energy and stays bounded after valve closure without the optional flow interlock', () => {
    const { b, boiler, valve } = boilerRig({}, false, true); const s = new Simulation(b.p);
    run(s, 15); edit(s, valve!.id, { opening: 0 }); run(s, 200);
    expect(s.multiphysics.boilers[boiler.id].fault).toBe('');
    expect(water(s, boiler.id)).toBeLessThan(65);
    expect(Math.abs(s.energyResidual)).toBeLessThan(0.001);
    expect(s.fluidTemperatureMeasurement(boiler.id)).toBeDefined();
  });
  it('matches fixed-step operation during adaptive advance and round-trips the complete preset', () => {
    const p = parseProject(JSON.parse(JSON.stringify(starter('boiler')))), s = new Simulation(p), reference = new Simulation(p);
    expect(s.advanceAdaptive(10).done).toBe(true); expect(s.error).toBeNull(); run(reference, 10, 1 / 60);
    const boiler = p.components.find(c => c.kind === 'electricBoiler')!;
    expect(Math.abs(water(s, boiler.id) - water(reference, boiler.id))).toBeLessThan(0.03);
    expect(Math.abs(s.suppliedEnergy - reference.suppliedEnergy) / reference.suppliedEnergy).toBeLessThan(0.005);
    expect(Math.abs(s.energyResidual)).toBeLessThan(0.001);
    for (const probe of p.probes!) expect(readProbe(probe, s), probe.name).not.toBeNull();
  });
});

describe('explicit phase wiring and reset input', () => {
  it('resolves neutral current during unbalanced stages and does not send load current through PE', () => {
    const { b, boiler, sources } = boilerRig();
    b.p.connections = b.p.connections.filter(w => !(w.to.component === boiler.id && w.to.port === 'N'));
    const neutral = b.add('resistor', { resistance: 1e-6 });
    for (const src of sources) b.wire(src, 'b', neutral, 'b');
    b.wire(neutral, 'a', boiler, 'N');
    const earth = b.p.components.find(c => c.kind === 'ground')!;
    b.p.connections = b.p.connections.filter(w => !(w.to.component === boiler.id && w.to.port === 'PE'));
    const pe = b.add('resistor', { resistance: 1e-6 }); b.wire(earth, 'a', pe, 'a'); b.wire(pe, 'b', boiler, 'PE');
    const one = solveElectrical(b.p, {}, { boilers: { [boiler.id]: 1 } });
    expect(Math.abs(one.readings[neutral.id].current)).toBeCloseTo((3000 + 3) / 230, 2);
    const full = solveElectrical(b.p, {}, { boilers: { [boiler.id]: 3 } });
    expect(Math.abs(full.readings[neutral.id].current)).toBeCloseTo(3 / 230, 4);
    expect(full.readings[pe.id].current).toBe(0);
  });
  it('rejects hot reset pulses and accepts a fresh pulse after cooling', () => {
    const { b, boiler } = boilerRig({ tripTemperature: 45, resetTemperature: 40 });
    const reset = b.add('reset'); b.wire(reset, 'out', boiler, 'reset');
    const s = new Simulation(b.p); s.injectFault(boiler.id, 'stuckClosed'); run(s, 70);
    expect(s.multiphysics.boilers[boiler.id].fault).toBe('overtemperature');
    s.pulse(reset.id); run(s, 0.1); expect(s.multiphysics.boilers[boiler.id].fault).toBe('overtemperature');
    edit(s, boiler.id, { loss: 500 }); run(s, 40);
    expect(water(s, boiler.id)).toBeLessThan(40);
    s.pulse(reset.id); run(s, 0.1); expect(s.multiphysics.boilers[boiler.id].fault).toBe('');
    expect(s.automation.status[boiler.id]).not.toBe('tripped');
  });
  it('locks out loaded voltage collapse without synthesizing heater power', () => {
    const { b, boiler, sources } = boilerRig({ maxStages: 1 });
    sources[0].props.internalResistance = 10;
    const s = new Simulation(b.p); run(s, 8);
    expect(s.multiphysics.boilers[boiler.id].stages).toBe(0);
    expect(s.electrical.readings[boiler.id].heatingPower).toBe(0);
    expect(water(s, boiler.id)).toBeCloseTo(20, 8);
    expect(Math.abs(s.energyResidual)).toBeLessThan(1e-6);
  });
});

it('reports per-stage RMS current and average power when a step spans a switching deadline', () => {
  const { b, boiler } = boilerRig({ loss: 0 }); const s = new Simulation(b.p);
  run(s, 1.9); expect(s.step(0.05)).toBe(true); expect(s.step(0.1)).toBe(true);
  const r = s.electrical.readings[boiler.id];
  expect(r.heatingPower).toBeCloseTo(4500, 6);
  expect(r.stageCurrents![0]).toBeCloseTo(3000 / 230, 8);
  expect(r.stageCurrents![1]).toBeCloseTo(3000 / 230 / Math.SQRT2, 8);
  expect(r.stageCurrents![2]).toBe(0);
  expect(r.apparentPower).toBeCloseTo(r.power, 6);
  expect(r.powerFactor).toBeCloseTo(1, 10);
});
