import { describe, it, expect } from 'vitest';
import { Builder } from './scaling-validation';
import { Simulation } from './engine';
import { makeComponent, type Component, type Project, type Property } from './model';
import { bosch, ratingPoints } from './heat-pump-data';
import { advanceHeatPump, defrostPoint, electricalLimit, envelopeMaxFlow, frostRate, heatingPoint, maxSpeed, MIN_SPEED, newHeatPump, planHeatPump, pointCOP, r290Pressure, r290Temperature, speedForOutput, type HeatPumpInputs } from './heat-pump';
import { makeEnvelope, makeThermalSpace } from './thermal-spaces';
import { starter, parseProject, serializeProject } from './projects';

/** Heat pump on 230 V with an external circulator, a pipe and a radiator to a fixed 20 °C room. */
export function heatPumpRig(props: Record<string, Property> = {}, options: { air?: number; sinkUA?: number; volume?: number; voltage?: number; pump?: boolean } = {}) {
  const b = new Builder();
  b.p.environment = { ambient: options.air ?? 2 };
  const hp = b.add('heatPump', props), mains = b.add('sourceAC', { voltage: options.voltage ?? 230, maxCurrent: 63, maxPower: 15000 });
  const pump = b.add('circulator', { headSetpoint: 4 }), sink = b.add('radiator', { naturalUA: options.sinkUA ?? 400, forcedUA: 0, ambient: 20, ambientMode: 'override' });
  const pipe = b.add('pipe', { diameter: 0.028, length: (options.volume ?? 20) / (Math.PI * 0.014 ** 2 * 1000), thermalUA: 0, segments: 4 });
  b.wire(mains, 'a', hp, 'L'); b.wire(mains, 'b', hp, 'N'); b.wire(mains, 'a', hp, 'BL'); b.wire(mains, 'b', hp, 'BN');
  if (options.pump !== false) { b.wire(mains, 'a', pump, 'a'); b.wire(mains, 'b', pump, 'b'); }
  b.wire(hp, 'outlet', pipe, 'inlet'); b.wire(pipe, 'outlet', sink, 'inlet'); b.wire(sink, 'outlet', pump, 'inlet'); b.wire(pump, 'outlet', hp, 'inlet');
  return { b, hp, mains, pump, sink };
}
function advance(s: Simulation, seconds: number, chunk = 30) {
  for (let t = 0; t < seconds - 1e-9; t += chunk) { s.advanceAdaptive(Math.min(chunk, seconds - t)); if (s.error) throw Error(s.error); }
}
const edit = (s: Simulation, id: string, props: Record<string, Property>) =>
  expect(s.refresh({ ...s.project, components: s.project.components.map(c => c.id === id ? { ...c, props: { ...c.props, ...props } } : c) } as Project), s.error ?? '').toBe(true);
const unit = (props: Record<string, Property> = {}) => { const c = makeComponent('heatPump', 0, 0, []); Object.assign(c.props, props); return c; };

describe('Bosch CS6800iAW 7 OR-S calibration (steady, frost-free cycle)', () => {
  const at = (r: (typeof ratingPoints)[number]) => pointCOP(heatingPoint(speedForOutput(r.output, r.air, r.flow), r.air, r.flow));
  it('reproduces the fitted EN 14511 / EN 14825 points at their published capacity', () => {
    const errors = ratingPoints.filter(r => r.fit).map(r => at(r) / r.cop - 1);
    for (const e of errors) expect(Math.abs(e)).toBeLessThan(0.06);
    expect(Math.sqrt(errors.reduce((s, e) => s + e * e, 0) / errors.length)).toBeLessThan(0.025);
  });
  it('lies above the withheld A2 points, whose Bosch tests include defrost, by less than 10 %', () => {
    for (const r of ratingPoints.filter(r => !r.fit)) { const e = at(r) / r.cop - 1; expect(e).toBeGreaterThan(-0.03); expect(e).toBeLessThan(0.1); }
  });
  it('defines 100 % speed at the A7/W35 maximum and the minimum speed at 1.8 kW A2/W35', () => {
    expect(heatingPoint(1, 7, 35).condenser).toBeCloseTo(7970, -1);
    expect(heatingPoint(MIN_SPEED, 2, 35).condenser / bosch.modulation[0]).toBeCloseTo(1, 2);
    expect(heatingPoint(maxSpeed(-10), -10, 35).condenser).toBeCloseTo(5860, -1);
  });
  it('stays below the Carnot limit between water and air, and the electrical input within 13.1 A', () => {
    for (const air of [-20, -10, -7, 2, 7, 15]) for (const water of [25, 35, 45, 55]) {
      if (!(water <= envelopeMaxFlow(air))) continue;
      for (const n of [MIN_SPEED, 0.5, maxSpeed(air)]) {
        const p = heatingPoint(n, air, water), cop = pointCOP(p);
        expect(cop).toBeLessThan((water + 273.15) / (water - air));
        expect(cop).toBeGreaterThan(1);
        expect(p.condenser).toBeCloseTo(p.evaporator + p.compressor, 6);
        expect(p.evaporating).toBeLessThan(air); expect(p.condensing).toBeGreaterThan(water);
      }
    }
    expect(electricalLimit(unit(), 230)).toBeCloseTo(13.1 * 230 * 0.99, 9);
  });
  it('loses COP with flow temperature and gains it with outdoor temperature and part load', () => {
    expect(pointCOP(heatingPoint(0.6, 2, 45))).toBeLessThan(pointCOP(heatingPoint(0.6, 2, 35)));
    expect(pointCOP(heatingPoint(0.6, 7, 35))).toBeGreaterThan(pointCOP(heatingPoint(0.6, -7, 35)));
    expect(pointCOP(heatingPoint(0.4, 7, 35))).toBeGreaterThan(pointCOP(heatingPoint(1, 7, 35)));
  });
  it('follows the Bosch operating envelope and the R290 saturation fit', () => {
    expect(envelopeMaxFlow(-22)).toBe(59); expect(envelopeMaxFlow(-10)).toBe(65); expect(envelopeMaxFlow(10)).toBe(75);
    expect(envelopeMaxFlow(25)).toBe(75); expect(envelopeMaxFlow(45)).toBe(60); expect(envelopeMaxFlow(-23)).toBeNaN();
    expect(r290Pressure(273.15)).toBeCloseTo(4.74, 2); expect(r290Pressure(333.15)).toBeCloseTo(21.2, 1);
    expect(r290Temperature(r290Pressure(300))).toBeCloseTo(300, 9);
  });
});

describe('Frost and defrost', () => {
  it('forms frost only below 0 °C coil surface, faster in humid air, never in dry air', () => {
    const c = unit({ relativeHumidity: 84 });
    const a7 = heatingPoint(1, 7, 35), a2 = heatingPoint(1, 2, 35), ua = 750;
    expect(frostRate(c, 7, a7.evaporating, a7.fanFraction, ua)).toBe(0);
    const humid = frostRate(c, 2, a2.evaporating, a2.fanFraction, ua);
    expect(humid).toBeGreaterThan(1e-4);
    expect(frostRate(unit({ relativeHumidity: 60 }), 2, a2.evaporating, a2.fanFraction, ua)).toBeLessThan(humid);
    expect(frostRate(unit({ relativeHumidity: 0 }), 2, a2.evaporating, a2.fanFraction, ua)).toBe(0);
    expect(frostRate(c, 2, a2.evaporating, 0, ua)).toBe(0);
  });
  it('reverses the cycle: heat leaves the water, the compressor input and that heat reach the coil', () => {
    const d = defrostPoint(0.4, 30, -3);
    expect(d.water).toBeGreaterThan(1000); expect(d.compressor).toBeGreaterThan(100);
    expect(d.coil).toBeCloseTo(d.water + d.compressor, 6);
    expect(d.evaporating).toBeLessThan(30); expect(d.condensing).toBeGreaterThan(-3);
  });
  it('integrates EN 14511 A2/W35 within 8 % of Bosch output and COP, including frost and defrost cycles', () => {
    // Test-bench boundary as in EN 14511: water outlet held at 35 °C, air 2 °C / 84 % RH, fixed compressor speed.
    // Maximum: averaged over complete defrost cycles after the first. Nominal: frost grows so slowly at part load
    // that one defrost falls within 6 h, so the whole run is averaged.
    for (const [output, cop, speed, cyclesNeeded] of [[7090, 2.83, 1, 2], [2870, 4.06, speedForOutput(2870 / 0.95, 2, 35), 1]] as const) {
      const c = unit({ relativeHumidity: 84 }), st = newHeatPump(c, 2);
      Object.assign(st, { mode: 'heating', startedAt: -1e9, restartAt: 0 });
      const x: HeatPumpInputs = { water: 35, air: 2, flow: 4e-4, voltage: 230, powered: true, backupVoltage: 0, condensing: 30, evaporating: 0 };
      let heat = 0, electricity = 0, cycles = 0, start = 0, t = 0;
      for (; t < 6 * 3600; t++) {
        if (st.mode === 'heating' && st.frost >= Number(c.props.frostTrigger) && t - st.lastDefrostEnd >= Number(c.props.minDefrostInterval)) { st.mode = 'defrost'; st.defrostStart = t; }
        if (st.mode === 'defrost' && (st.frost <= 1e-9 && st.coilTemperature >= Number(c.props.defrostEndTemperature) || t - st.defrostStart >= Number(c.props.maxDefrostTime))) {
          st.mode = 'drip'; st.dripUntil = t + Number(c.props.dripTime); st.lastDefrostEnd = t;
          if (++cycles === 1 && cyclesNeeded > 1) { start = t; heat = 0; electricity = 0; }
        }
        if (st.mode === 'drip' && t >= st.dripUntil) st.mode = 'heating';
        st.command = st.mode === 'heating' ? speed : st.mode === 'defrost' ? Number(c.props.defrostSpeed) / 100 : 0;
        if (st.mode === 'heating') st.speed = speed;
        const plan = planHeatPump(c, st, x, 1);
        advanceHeatPump(c, st, plan, x, 1, plan.electrical, 0);
        heat += plan.condenser; electricity += plan.electrical;
      }
      expect(cycles).toBeGreaterThanOrEqual(cyclesNeeded);
      expect(Math.abs(heat / (t - start) / output - 1)).toBeLessThan(0.08);
      expect(Math.abs(heat / electricity / cop - 1)).toBeLessThan(0.08);
    }
  });
});

describe('Heat pump in the coupled engine', () => {
  it('holds the power-on check at standby and crankcase power, then starts', () => {
    const { b, hp } = heatPumpRig();
    const s = new Simulation(b.p);
    advance(s, 100, 10);
    expect(s.multiphysics.heatPumps[hp.id].mode).toBe('off');
    expect(s.electrical.readings[hp.id].compressorPower).toBeCloseTo(bosch.standbyPower + bosch.crankcasePower, 9);
    advance(s, 60, 10);
    expect(s.multiphysics.heatPumps[hp.id].mode).toBe('heating');
  });
  it('conserves energy through frost build-up and reverse-cycle defrosts (2 °C, 85 % RH)', () => {
    const { b, hp } = heatPumpRig({ relativeHumidity: 85 }, { volume: 40 });
    const s = new Simulation(b.p);
    advance(s, 2.5 * 3600, 60);
    const st = s.multiphysics.heatPumps[hp.id];
    expect(st.defrosts).toBeGreaterThanOrEqual(2);
    expect(st.defrostHeat).toBeGreaterThan(0);
    expect(Math.abs(s.energyResidual)).toBeLessThan(1e-3);
    expect(Math.abs(s.multiphysics.massResidual)).toBeLessThan(1e-9);
    // Environment heat + electricity = heat into the water + heat released to the air (first law, cumulative).
    const spf = (st.heat - st.defrostHeat) / st.electricity;
    expect(spf).toBeGreaterThan(2.8); expect(spf).toBeLessThan(5);
    expect(s.violations).toEqual([]);
  });
  it('cycles at low load within 6 starts per hour and the minimum run time', () => {
    // 12 °C outdoors with a small emitter: the demand is below the minimum modulation.
    const { b, hp } = heatPumpRig({ setpoint: 35 }, { air: 12, sinkUA: 40, volume: 30 });
    const s = new Simulation(b.p), starts: number[] = [];
    let previous = 'off', runs: number[] = [], since = 0;
    for (let t = 0; t < 3 * 3600; t += 10) {
      s.advanceAdaptive(10); if (s.error) throw Error(s.error);
      const st = s.multiphysics.heatPumps[hp.id];
      if (st.mode === 'heating' && previous === 'off') { starts.push(s.time); since = s.time; }
      if (st.mode === 'off' && previous === 'heating') runs.push(s.time - since);
      previous = st.mode;
    }
    expect(starts.length).toBeGreaterThanOrEqual(4);
    for (let i = 6; i < starts.length; i++) expect(starts[i] - starts[i - 6]).toBeGreaterThanOrEqual(3600 - 20);
    for (const r of runs) expect(r).toBeGreaterThanOrEqual(300 - 20);
    expect(Math.abs(s.energyResidual)).toBeLessThan(1e-3);
  });
  it('in freezing conditions brings in the backup heater, cuts out below −23 °C and restarts above −17 °C', () => {
    const { b, hp } = heatPumpRig({ setpoint: 40, backupDelay: 600 }, { air: -15, sinkUA: 300, volume: 30 });
    const s = new Simulation(b.p);
    advance(s, 1800, 30);
    let st = s.multiphysics.heatPumps[hp.id];
    expect(st.mode).toBe('heating');
    // Bivalent: the backup heater joined after the compressor had run at its limit for the backup delay.
    expect(st.speed).toBeLessThanOrEqual(maxSpeed(-15) + 1e-9);
    expect(Math.abs(s.electrical.readings[hp.id].current)).toBeLessThanOrEqual(13.1 * (1 + 1e-6));
    expect(st.backupHeat).toBeGreaterThan(0);
    expect(s.refresh({ ...s.project, environment: { ambient: -24 } })).toBe(true);
    advance(s, 600, 30);
    st = s.multiphysics.heatPumps[hp.id];
    expect(st.mode).toBe('off'); expect(st.ambientLock).toBe(true); expect(st.backupStages).toBe(2);
    expect(s.refresh({ ...s.project, environment: { ambient: -19 } })).toBe(true);
    advance(s, 600, 30);
    expect(s.multiphysics.heatPumps[hp.id].ambientLock).toBe(true);
    expect(s.refresh({ ...s.project, environment: { ambient: -16 } })).toBe(true);
    advance(s, 900, 30);
    expect(s.multiphysics.heatPumps[hp.id].ambientLock).toBe(false);
    expect(s.multiphysics.heatPumps[hp.id].mode).toBe('heating');
    expect(Math.abs(s.energyResidual)).toBeLessThan(1e-3);
  });
  it('locks out on undervoltage and repeats the power-on check after recovery', () => {
    const { b, hp, mains } = heatPumpRig({}, { air: 7 });
    const s = new Simulation(b.p);
    advance(s, 300, 10);
    expect(s.multiphysics.heatPumps[hp.id].mode).toBe('heating');
    edit(s, mains.id, { voltage: 180 });
    advance(s, 20, 5);
    expect(s.multiphysics.heatPumps[hp.id].mode).toBe('off');
    expect(s.multiphysics.heatPumpView[hp.id].electrical).toBe(0);
    edit(s, mains.id, { voltage: 230 });
    advance(s, 60, 5);
    expect(s.multiphysics.heatPumps[hp.id].mode).toBe('off');
    expect(s.multiphysics.heatPumps[hp.id].status).toBe('Power-on check (2 min)');
    // Power-on check (2 min) and the 5 min minimum off time since the stop both have to elapse.
    advance(s, 260, 5);
    expect(s.multiphysics.heatPumps[hp.id].mode).toBe('heating');
    expect(Math.abs(s.energyResidual)).toBeLessThan(1e-3);
  });
  it('never runs the compressor or backup heater without flow', () => {
    const { b, hp } = heatPumpRig({}, { pump: false });
    const s = new Simulation(b.p);
    advance(s, 600, 30);
    const st = s.multiphysics.heatPumps[hp.id];
    expect(st.startCount).toBe(0); expect(st.backupStages).toBe(0); expect(st.status).toBe('Waiting for flow');
  });
  it('stops a running compressor when the circulator fails', () => {
    const { b, hp, pump } = heatPumpRig({}, { air: 7 });
    const s = new Simulation(b.p);
    advance(s, 300, 10);
    expect(s.multiphysics.heatPumps[hp.id].mode).toBe('heating');
    expect(s.injectFault(pump.id, 'motorFailure')).toBeNull();
    advance(s, 120, 5);
    expect(s.multiphysics.heatPumps[hp.id].mode).toBe('off');
    expect(Math.abs(s.energyResidual)).toBeLessThan(1e-3);
  });
  it('trips on low pressure after an outdoor fan failure and locks out on the third trip until reset', () => {
    const { b, hp } = heatPumpRig({ minOffTime: 60 }, { air: -5 });
    const s = new Simulation(b.p);
    advance(s, 300, 10);
    expect(s.injectFault(hp.id, 'coolingFailed')).toBeNull();
    advance(s, 3000, 30);
    const st = s.multiphysics.heatPumps[hp.id];
    expect(st.fault).toBe('low pressure'); expect(st.mode).toBe('off');
    expect(s.injectFault(hp.id, null)).toBeNull();
    advance(s, 300, 30);
    expect(s.multiphysics.heatPumps[hp.id].fault).toBe('low pressure');
    expect(s.resetSafety(hp.id)).toBeNull();
    advance(s, 400, 30);
    expect(s.multiphysics.heatPumps[hp.id].mode).toBe('heating');
  });
  it('latches the backup heater overheat protection above 88 °C', () => {
    const { b, hp } = heatPumpRig({ setpoint: 40 }, { air: -24 });
    const s = new Simulation(b.p);
    advance(s, 200, 10);
    expect(s.multiphysics.heatPumps[hp.id].backupStages).toBe(2);
    s.multiphysics.heatPumps[hp.id].elementTemperature = 273.15 + 89;
    advance(s, 5, 1);
    expect(s.multiphysics.heatPumps[hp.id].backupFault).toBe(true);
    expect(s.multiphysics.heatPumps[hp.id].backupStages).toBe(0);
  });
  it('draws its evaporator heat from the Thermal Space it is assigned to', () => {
    const { b, hp } = heatPumpRig({ setpoint: 30 }, { air: 5 });
    const room = makeThermalSpace(0, 0, 4, 4); room.initialTemperature = 20; room.addedHeatCapacity = 2e6;
    b.p.version = 5; b.p.thermalSpaces = [room]; b.p.thermalElements = makeEnvelope(room);
    const unitInRoom = b.p.components.find(c => c.id === hp.id)!; unitInRoom.thermalSpaceId = room.id; unitInRoom.thermalSpacePinned = true;
    const s = new Simulation(b.p);
    advance(s, 1200, 30);
    expect(Math.abs(s.multiphysics.heatPumpView[hp.id].inputs.air - s.spaceTemperatures[room.id])).toBeLessThan(0.01);
    expect(s.spaceTemperatures[room.id]).toBeLessThan(19);
    expect(Math.abs(s.energyResidual)).toBeLessThan(1e-3);
  });
  it('is deterministic and agrees between fixed 0.1 s steps and adaptive macro steps', () => {
    const { b, hp } = heatPumpRig({}, { air: 7 });
    const fixed = new Simulation(b.p), adaptive = new Simulation(b.p), again = new Simulation(b.p);
    for (let i = 0; i < 6000; i++) expect(fixed.step(0.1)).toBe(true);
    advance(adaptive, 600, 30); advance(again, 600, 30);
    expect(again.fluidTemperatureMeasurement(hp.id)).toBe(adaptive.fluidTemperatureMeasurement(hp.id));
    expect(Math.abs(fixed.fluidTemperatureMeasurement(hp.id)! - adaptive.fluidTemperatureMeasurement(hp.id)!)).toBeLessThan(0.05);
    expect(Math.abs(fixed.multiphysics.heatPumps[hp.id].heat / adaptive.multiphysics.heatPumps[hp.id].heat - 1)).toBeLessThan(0.005);
  });
  it('runs both starters, imports and exports them unchanged', () => {
    for (const mode of ['heatPumpHouse', 'heatPumpCold'] as const) {
      const p = starter(mode), copy = parseProject(JSON.parse(serializeProject(p)));
      expect(serializeProject(copy)).toBe(serializeProject(p));
      const s = new Simulation(copy); expect(s.error).toBeNull();
      advance(s, 900, 30);
      expect(s.violations).toEqual([]);
      expect(Math.abs(s.energyResidual)).toBeLessThan(1e-3);
    }
  });
});

export type { Component };
