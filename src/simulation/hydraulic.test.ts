import { describe, it, expect } from 'vitest';
import { connect, makeComponent, type Project, type Component, type Kind } from './model';
import { Simulation, FixedClock } from './engine';
import { solveHydraulic, frictionFactor, pipeLoss } from './hydraulic';
import { Multiphysics } from './multiphysics';
import { unitsSI as U, WATER_CP as CP, GRAVITY as G } from './units';
import { hydraulicStarter } from './hydraulic-projects';
import { parseProject, serializeProject } from './projects';
import { replayExperiment } from './replay';
import { transitionError, challengeError } from './integrity';
import { evaluateChallenge } from './challenges';
const blank = (): Project => ({ version: 3, id: 'test', name: 'Reference', components: [], connections: [] });
function add(p: Project, kind: Kind, props: Component['props'] = {}) { const c = makeComponent(kind, 0, 0, p.components); c.props = { ...c.props, ...props }; p.components.push(c); return c; }
function wire(p: Project, a: Component, ap: string, b: Component, bp: string) { p.connections = connect(p, { component: a.id, port: ap }, { component: b.id, port: bp }).connections; }
function run(s: Simulation, duration: number, dt = 1 / 60) { for (let i = 0; i < Math.round(duration / dt); i++) { if (!s.step(dt)) throw Error(`${s.time}: ${s.error}`); } return s; }
function gravity(propsA: Component['props'] = {}, propsB: Component['props'] = {}, kind: Kind = 'pipe') {
  const p = blank(), a = add(p, 'tank', { volume: 10, capacity: 20, elevation: 2, ...propsA }), b = add(p, 'tank', { volume: 0, capacity: 20, ...propsB }), pipe = add(p, kind);
  wire(p, a, 'fluid', pipe, 'inlet'); wire(p, pipe, 'outlet', b, 'fluid');
  return { p, a, b, pipe };
}
describe('hydraulic reference mechanics', () => {
  it('centralizes reversible SI/display conversions', () => {
    expect(U.m3ToLiters(U.litersToM3(100))).toBe(100);
    expect(U.m3sToLpm(U.lpmToM3s(60))).toBe(60);
    expect(U.paToBar(U.barToPa(2))).toBe(2);
    expect(U.kToCelsius(U.celsiusToK(20))).toBe(20);
    expect(U.radToRpm(U.rpmToRad(3000))).toBeCloseTo(3000, 10);
  });
  it('matches Hagen–Poiseuille and has a finite zero-flow limit', () => {
    const p = makeComponent('pipe', 0, 0); const q = 1e-6;
    // Published μ(20 °C, 1 atm) = 1.0016 mPa·s (IAPWS 2008); default fluid temperature 20 °C.
    const reference = 128 * 1.0016e-3 * 5 * q / (Math.PI * 0.025 ** 4);
    expect(Math.abs(pipeLoss(p, q).dp / reference - 1)).toBeLessThan(1e-4);
    expect(pipeLoss(p, 0).dp).toBe(0);
    expect(frictionFactor(1000, 0)).toBe(0.064);
    expect(frictionFactor(1e5, 0.001)).toBeGreaterThan(0.02);
    for (const re of [2300, 4000]) expect(Math.abs(frictionFactor(re - 0.001, 0.001) - frictionFactor(re + 0.001, 0.001))).toBeLessThan(1e-7);
    expect(pipeLoss(p, -q).dp).toBe(-pipeLoss(p, q).dp);
  });
  it('solves hydrostatic boundaries and physical pipe resistance independently of drawing', () => {
    const { p, a, b, pipe } = gravity(); const state = new Multiphysics(); state.initialize(p);
    const wide = solveHydraulic(p, state.tanks); pipe.props.diameter = 0.012;
    const narrow = solveHydraulic(p, state.tanks);
    expect(wide.readings[pipe.id].flow).toBeGreaterThan(narrow.readings[pipe.id].flow);
    // 10 L of 20 °C water (998.207 kg/m³, published) over 0.1 m²: p = ρ·g·h.
    expect(wide.readings[a.id].pressure).toBeCloseTo(998.207 * G * 0.1, 2);
    expect(wide.readings[b.id].pressure).toBe(0);
    pipe.x = 10000; expect(solveHydraulic(p, state.tanks).readings[pipe.id].flow).toBe(narrow.readings[pipe.id].flow);
    expect(wide.residual).toBeLessThan(1e-12);
  });
  it('solves parallel flow and continuity at junctions', () => {
    const { p, a, b, pipe } = gravity(); p.connections = [];
    const junction = add(p, 'fluidJunction'), second = add(p, 'pipe'), inlet = add(p, 'pipe');
    wire(p, a, 'fluid', inlet, 'inlet'); wire(p, inlet, 'outlet', junction, 'fluid');
    for (const branch of [pipe, second]) { wire(p, junction, 'fluid', branch, 'inlet'); wire(p, branch, 'outlet', b, 'fluid'); }
    const state = new Multiphysics(); state.initialize(p); const r = solveHydraulic(p, state.tanks);
    expect(r.readings[pipe.id].flow).toBeCloseTo(r.readings[second.id].flow, 12);
    expect(r.readings[inlet.id].flow).toBeCloseTo(2 * r.readings[pipe.id].flow, 12);
  });
  it('permits reversed pipes and prevents check-valve reverse flow', () => {
    const { p, pipe } = gravity({ elevation: 0 }, { elevation: 2, volume: 10 }, 'pipe');
    const state = new Multiphysics(); state.initialize(p);
    expect(solveHydraulic(p, state.tanks).readings[pipe.id].flow).toBeLessThan(0);
    const check = gravity({ elevation: 0 }, { elevation: 2, volume: 10 }, 'checkValve');
    const cs = new Multiphysics(); cs.initialize(check.p);
    expect(solveHydraulic(check.p, cs.tanks).readings[check.pipe.id].flow).toBe(0);
  });
  for (const dt of [0.1, 0.05, 1 / 60]) {
    it(`conserves mass at empty/full boundary crossings at dt=${dt}`, () => {
      // The receiver fills within the run and then spills over its rim (no implicit shut-off):
      // the source drains completely and the 0.09 L excess leaves as overflow.
      // The receiver fills within the run, surcharges above its rim and spills over its weir
      // (no implicit shut-off): the source drains completely and no water is lost.
      const { p, a, b } = gravity({ volume: 0.1, capacity: 1 }, { volume: 0.99, capacity: 1 });
      const s = run(new Simulation(p), 1, dt);
      expect(s.multiphysics.tanks[a.id].volume).toBeCloseTo(0, 12);
      expect(s.multiphysics.tanks[b.id].volume).toBeGreaterThanOrEqual(0.001);
      expect(s.multiphysics.tanks[b.id].volume + s.multiphysics.overflowed[b.id]).toBeCloseTo(0.00109, 9);
      expect(s.multiphysics.massResidual).toBeCloseTo(0, 8);
      const empty = gravity({ volume: 0.01 }, { volume: 0, capacity: 1 });
      const e = run(new Simulation(empty.p), 1, dt);
      expect(e.multiphysics.tanks[empty.a.id].mass).toBeCloseTo(0, 10);
      // 0.01 L at 20 °C: 0.01 L × 0.998207 kg/L (published density).
      expect(Math.abs(e.multiphysics.tanks[empty.b.id].mass / (0.01 * 0.998207) - 1)).toBeLessThan(5e-6);
      expect(e.multiphysics.hydraulic.readings[empty.pipe.id].flow).toBe(0);
    });
  }
  it('uses mass-weighted enthalpy mixing, including hydraulic dissipation', () => {
    const { p, a, b, pipe } = gravity({ volume: 0.1, initialTemperature: 60, loss: 0 }, { volume: 0.2, capacity: 1, initialTemperature: 20, loss: 0 });
    // Ideal-mixing reference: a zero-volume pipe (a 2.45 L pipe would retain the 0.1 L slug).
    pipe.props.inventory = false;
    // Initial masses from the initial volumes and temperatures (densities 983.20 and 998.207 kg/m³).
    const initial = structuredClone(new Simulation(p).multiphysics.tanks);
    const initialEnthalpy = initial[a.id].mass * CP * U.celsiusToK(60) + initial[b.id].mass * CP * U.celsiusToK(20);
    expect(Math.abs(initial[a.id].mass / (1e-4 * 983.2) - 1)).toBeLessThan(2e-5);
    const s = run(new Simulation(p), 5);
    expect(s.multiphysics.tanks[a.id].mass).toBeCloseTo(0, 9);
    const destination = s.multiphysics.tanks[b.id];
    // Mass-weighted mixing with published densities: 0.1 L at 60 °C (983.20 kg/m³), 0.2 L at 20 °C (998.207 kg/m³).
    expect(U.kToCelsius(destination.temperature)).toBeCloseTo((0.1 * 983.2 * 60 + 0.2 * 998.207 * 20) / (0.1 * 983.2 + 0.2 * 998.207), 1);
    expect(destination.mass * CP * destination.temperature + s.ambientEnergy - initialEnthalpy).toBeCloseTo(s.multiphysics.dissipation, 5);
    expect(Math.abs(s.energyResidual)).toBeLessThan(0.02);
  });
});
describe('coupled electrical mechanical hydraulic thermal systems', () => {
  it('matches the DC motor steady state, back EMF and energy ledger', () => {
    const p = blank(), supply = add(p, 'source'), motor = add(p, 'motor');
    wire(p, supply, 'a', motor, 'a'); wire(p, motor, 'b', supply, 'b');
    const s = run(new Simulation(p), 10); const m = s.multiphysics.motors[motor.id];
    const expected = 0.08 * 24 / (1.2 * 0.0005 + 0.08 ** 2);
    expect(m.omega).toBeCloseTo(expected, 1);
    expect(m.current).toBeCloseTo((24 - 0.08 * m.omega) / 1.2, 2);
    expect(Math.abs(s.energyResidual)).toBeLessThan(1e-5);
    expect(s.multiphysics.kineticEnergy(p)).toBeGreaterThan(200);
    expect(s.multiphysics.copperEnergy).toBeGreaterThan(0);
  });
  it('increases motor current under a defined shaft load and supports stall', () => {
    const p = blank(), source = add(p, 'source'), motor = add(p, 'motor'); wire(p, source, 'a', motor, 'a'); wire(p, motor, 'b', source, 'b');
    const unloaded = run(new Simulation(p), 6);
    motor.props.loadTorque = 0.5;
    const loaded = run(new Simulation(p), 6);
    expect(loaded.multiphysics.motors[motor.id].current).toBeGreaterThan(unloaded.multiphysics.motors[motor.id].current);
    expect(loaded.multiphysics.motors[motor.id].omega).toBeLessThan(unloaded.multiphysics.motors[motor.id].omega);
    motor.props.loadTorque = 1.6;
    const stalled = run(new Simulation(p), 0.5);
    expect(Math.abs(stalled.multiphysics.motors[motor.id].omega)).toBeLessThan(1e-8);
    expect(stalled.multiphysics.motors[motor.id].current).toBeCloseTo(20, 8);
  });
  it('changes actual flow, motor load and electrical consumption when restricted', () => {
    const p = hydraulicStarter('transfer'), valve = p.components.find(c => c.kind === 'valve')!, motor = p.components.find(c => c.kind === 'motor')!, pump = p.components.find(c => c.kind === 'pump')!;
    const open = run(new Simulation(p), 5), edited = structuredClone(p); edited.components.find(c => c.id === valve.id)!.props.opening = 5;
    const closed = run(new Simulation(edited), 5);
    expect(open.multiphysics.hydraulic.readings[pump.id].flow).toBeGreaterThan(closed.multiphysics.hydraulic.readings[pump.id].flow);
    expect(Math.abs(open.multiphysics.motors[motor.id].current - closed.multiphysics.motors[motor.id].current)).toBeGreaterThan(0.05);
    const r = open.multiphysics.hydraulic.readings[pump.id];
    expect(r.hydraulicPower).toBeLessThanOrEqual(r.shaftPower);
    expect(open.multiphysics.massResidual).toBeCloseTo(0, 8);
    expect(Math.abs(open.energyResidual)).toBeLessThan(0.1);
  });
  it('coasts after power loss, retains inventory and records fault timestamps', () => {
    const p = hydraulicStarter('transfer'), motor = p.components.find(c => c.kind === 'motor')!, pump = p.components.find(c => c.kind === 'pump')!;
    const s = run(new Simulation(p), 3), speed = s.multiphysics.motors[motor.id].omega;
    expect(s.injectFault(motor.id, 'powerLoss')).toBeNull();
    s.step();
    expect(s.multiphysics.motors[motor.id].omega).toBeLessThan(speed);
    expect(s.multiphysics.motors[motor.id].omega).toBeGreaterThan(0);
    expect(s.multiphysics.hydraulic.readings[pump.id].flow).toBeGreaterThan(0);
    expect(s.multiphysics.motors[motor.id].current).toBe(0);
    expect(s.events.some(e => e.time >= 3 - 1e-9 && e.message.includes('powerLoss'))).toBe(true);
    run(s, 8); expect(s.multiphysics.massResidual).toBeCloseTo(0, 8);
  });
  it('advects heat through a powered heated cooling loop with conservation', () => {
    const s = run(new Simulation(hydraulicStarter('circulation')), 2);
    expect(s.ambientEnergy).toBeGreaterThan(500);
    expect(s.multiphysics.massResidual).toBeCloseTo(0, 8);
    expect(Math.abs(s.energyResidual)).toBeLessThan(0.1);
    const destination = s.project.components.find(c => c.name === 'Destination tank')!;
    expect(s.temperatures[destination.id]).toBeGreaterThan(20);
  });
  it('honors real valve faults and finite actuator response', () => {
    const p = hydraulicStarter('transfer'), valve = p.components.find(c => c.kind === 'valve')!;
    valve.kind = 'actuatedValve'; valve.props = { ...makeComponent('actuatedValve', 0, 0).props, opening: 100 };
    const s = run(new Simulation(p), 2);
    const edit = structuredClone(p); edit.components.find(c => c.id === valve.id)!.props.opening = 0; expect(s.refresh(edit)).toBe(true);
    run(s, 1); expect(s.multiphysics.positions[valve.id]).toBeCloseTo(80, 8);
    s.injectFault(valve.id, 'stuckClosed'); s.step(); expect(s.multiphysics.hydraulic.readings[valve.id].flow).toBe(0);
  });
  it('rejects live inventory edits, sealed tanks, cross-domain wiring and challenge exploits', () => {
    const p = hydraulicStarter('transfer'), s = run(new Simulation(p), 0.1), tank = p.components.find(c => c.kind === 'tank')!;
    const edited = structuredClone(p); edited.components.find(c => c.id === tank.id)!.props.volume = Number(tank.props.volume) - 1;
    expect(transitionError(p, edited, s.time)).toMatch(/Reset/);
    edited.components.find(c => c.id === tank.id)!.props.vented = false;
    expect(() => new Simulation(edited)).toThrow(/Sealed/);
    const challenge = hydraulicStarter('transfer'); challenge.challenge = 'transfer';
    expect(challengeError(challenge)).toBeNull(); challenge.components.find(c => c.kind === 'pump')!.props.shutoffHead = 1000;
    expect(challengeError(challenge)).toMatch(/catalog/);
    const invalid = structuredClone(p); invalid.connections[0].domain = 'hydraulic'; expect(() => new Simulation(invalid)).toThrow(/domain/);
    const disconnected = hydraulicStarter('transfer', true); expect(evaluateChallenge(disconnected, new Simulation(disconnected))?.complete).toBe(false);
  });
  it('round trips new topology and deterministically replays all domains and faults', () => {
    const p = hydraulicStarter('transfer'), s = run(new Simulation(p), 1), motor = p.components.find(c => c.kind === 'motor')!;
    expect(parseProject(JSON.parse(serializeProject(p)))).toEqual(p);
    s.injectFault(motor.id, 'powerLoss'); run(s, 1);
    const replay = replayExperiment(p, [{ at: 1, fault: { id: motor.id, type: 'powerLoss' } }], 2);
    expect(replay.multiphysics.tanks).toEqual(s.multiphysics.tanks);
    expect(replay.multiphysics.motors).toEqual(s.multiphysics.motors);
    expect(replay.suppliedEnergy).toBe(s.suppliedEnergy);
  });
  it('quantifies timestep convergence and rendering-independent scheduling', () => {
    const p = hydraulicStarter('transfer');
    const result = [1 / 60, 1 / 120, 1 / 240].map(dt => run(new Simulation(p), 2, dt));
    const destination = p.components.find(c => c.name === 'Destination tank')!;
    const volumes = result.map(s => s.multiphysics.tanks[destination.id].volume);
    expect(Math.abs(volumes[0] - volumes[2])).toBeLessThan(2e-6);
    const currents = result.map(s => s.multiphysics.motors[p.components.find(c => c.kind === 'motor')!.id].current);
    expect(Math.abs(currents[0] - currents[2])).toBeLessThan(0.03);
    const a = new Simulation(p), b = new Simulation(p), ca = new FixedClock(), cb = new FixedClock();
    for (let i = 0; i < 60; i++) ca.advance(1 / 30, 1, true, () => a.step());
    for (let i = 0; i < 288; i++) cb.advance(1 / 144, 1, true, () => b.step());
    expect(a.multiphysics.tanks).toEqual(b.multiphysics.tanks);
  });
});

describe('multiphysics run integrity', () => {
  it('restores validated live archives and rejects forged replay configuration', async () => {
    const { createRunArchive, restoreRunArchive } = await import('./replay');
    const p = hydraulicStarter('transfer'), s = run(new Simulation(p), 0.2);
    const archive = createRunArchive(p, p, [], s.time), restored = await restoreRunArchive(archive, async () => {});
    expect(restored.simulation.multiphysics.tanks).toEqual(s.multiphysics.tanks);
    expect(restored.simulation.multiphysics.motors).toEqual(s.multiphysics.motors);
    archive.configuration.name = 'Forged current configuration';
    await expect(restoreRunArchive(archive, async () => {})).rejects.toThrow(/configuration/);
  });
  it('accounts for depletion as an explicit mass/enthalpy/potential export', () => {
    const p = hydraulicStarter('transfer'), s = run(new Simulation(p), 1), source = p.components.find(c => c.name === 'Source reservoir')!;
    const before = s.energyResidual;
    s.injectFault(source.id, 'depleted');
    expect(s.multiphysics.tanks[source.id].mass).toBe(0);
    expect(s.multiphysics.massResidual).toBeCloseTo(0, 8);
    expect(s.energyResidual).toBeCloseTo(before, 5);
    expect(s.multiphysics.removedEnergy).toBeGreaterThan(0);
  });
  it('propagates failed hydraulic sensors through the existing control architecture', () => {
    const p = hydraulicStarter('supply'), sensor = p.components.find(c => c.name === 'Primary level sensor')!, motor = p.components.find(c => c.kind === 'motor')!;
    const s = run(new Simulation(p), 1);
    expect(s.automation.sensors[sensor.id].valid).toBe(true);
    expect(s.injectFault(sensor.id, 'sensorFault')).toBeNull(); s.step();
    expect(s.automation.sensors[sensor.id].valid).toBe(false);
    expect(s.multiphysics.motors[motor.id].current).toBe(0);
    expect(s.multiphysics.motors[motor.id].omega).toBeGreaterThan(0);
  });
  it('rejects manual actuator intervention, demand edits, malformed imports and budget exploits', () => {
    const p = hydraulicStarter('pressure'); p.challenge = 'pressure';
    const s = run(new Simulation(p), 0.1), edited = structuredClone(p);
    edited.components.find(c => c.kind === 'source')!.props.voltage = 20;
    expect(transitionError(p, edited, s.time)).toMatch(/autonomously/);
    const adopted = new Simulation(blank()); expect(adopted.refresh(p)).toBe(true); adopted.step();
    const unscored = structuredClone(p); delete unscored.challenge;
    expect(adopted.refresh(unscored)).toBe(false); expect(adopted.error).toMatch(/identity/);
    const late = run(new Simulation(blank()), 0.1); expect(late.refresh(p)).toBe(false); expect(late.error).toMatch(/Reset/);
    const malformed = structuredClone(p); malformed.components.find(c => c.name === 'Consumer demand')!.props.diameter = 0.001;
    expect(() => parseProject(malformed)).toThrow(/locked/);
    const budget = structuredClone(p); for (let i = 0; i < 12; i++) add(budget, 'motor');
    expect(challengeError(budget)).toMatch(/budget/);
    const unsupported = structuredClone(p); unsupported.components.find(c => c.kind === 'pipe')!.props.diameter = 0;
    expect(() => parseProject(unsupported)).toThrow(/range/);
    const fake = structuredClone(p); fake.components.find(c => c.kind === 'motor')!.props.torqueConstant = 2;
    expect(() => new Simulation(fake)).toThrow(/constants|catalog/);
  });
});

describe('hydraulic instrumentation validity and elevation', () => {
  it('does not invent fluid temperatures for empty tanks or non-advecting zero-volume pipes', async () => {
    const { readProbe } = await import('./measurements');
    const p = hydraulicStarter('transfer'), tank = p.components.find(c => c.name === 'Destination tank')!, pipe = p.components.find(c => c.kind === 'pipe')!;
    // This case promises zero-volume behavior; inventory pipes have real initialized water.
    pipe.props.inventory = false;
    const s = new Simulation(p);
    const temperature = (id: string) => readProbe({ id: 'temp', name: 'Fluid', component: id, measurement: 'fluidTemperature', color: '#ffffff', visible: true }, s);
    expect(temperature(tank.id)).toBeNull(); expect(temperature(pipe.id)).toBeNull();
    const staticProject = blank(), staticTank = add(staticProject, 'tank'), staticSimulation = new Simulation(staticProject);
    expect(readProbe({ id: 'p', name: 'Pressure', component: staticTank.id, measurement: 'pressure', color: '#ffffff', visible: true }, staticSimulation)).toBeCloseTo(998.207 * G * 0.01 / 0.1 / 100000, 7);
    run(s, 2); expect(temperature(tank.id)).toBeGreaterThan(19); expect(temperature(pipe.id)).toBeGreaterThan(19);
    const overpressure = blank(); add(overpressure, 'tank', { volume: 200, capacity: 200, surfaceArea: 0.001 });
    const rated = new Simulation(overpressure); rated.step(); expect(rated.violations.some(v => v.includes('pressure rating'))).toBe(true);
    const motor = p.components.find(c => c.kind === 'motor')!;
    const efficiency = () => readProbe({ id: 'eta', name: 'Motor efficiency', component: motor.id, measurement: 'efficiency', color: '#ffffff', visible: true }, s);
    expect(s.multiphysics.hydraulic.readings[tank.id].flow).toBeGreaterThan(0);
    expect(efficiency()).toBeGreaterThan(0); expect(efficiency()).toBeLessThan(100);
    s.injectFault(motor.id, 'powerLoss'); s.step(); expect(efficiency()).toBeNull();
  });
  it('elevation changes required head and the solved pump operating point', () => {
    const p = hydraulicStarter('transfer'), raised = structuredClone(p), destination = p.components.find(c => c.name === 'Destination tank')!, pump = p.components.find(c => c.kind === 'pump')!;
    raised.components.find(c => c.id === destination.id)!.props.elevation = 4;
    const low = run(new Simulation(p), 3), high = run(new Simulation(raised), 3);
    expect(low.multiphysics.hydraulic.readings[pump.id].flow).toBeGreaterThan(high.multiphysics.hydraulic.readings[pump.id].flow);
    expect(-high.multiphysics.hydraulic.readings[pump.id].differentialPressure).toBeGreaterThan(-low.multiphysics.hydraulic.readings[pump.id].differentialPressure);
    expect(high.multiphysics.massResidual).toBeCloseTo(0, 8);
  });
});
