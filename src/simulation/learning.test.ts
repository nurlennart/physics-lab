import { describe, expect, it } from 'vitest';
import { examples } from './learning';
import { starter, parseProject, serializeProject } from './projects';
import { challengeDefinition, challengeList, hydraulicState } from './challenges';
import { challengeError } from './integrity';
import { Simulation } from './engine';

describe('mission starting environments', () => {
  for (const d of challengeList()) it(`${d.id} starts with only valid fixed fixtures and usable probes`, () => {
    const p = d.scaffold();
    expect(challengeError(p)).toBeNull();
    expect(() => parseProject(JSON.parse(serializeProject(p)))).not.toThrow();
    expect(p.connections).toHaveLength(0);
    expect(p.components.every(c => ['tank', 'rigidBody'].includes(c.kind) || ['Consumer demand', 'Variable shaft load'].includes(c.name))).toBe(true);
    expect(p.probes?.every(probe => p.components.some(c => c.id === probe.component))).toBe(true);
    expect(p.world?.joints.every(j => p.components.some(c => c.id === j.a) && p.components.some(c => c.id === j.b)) ?? true).toBe(true);
    expect(d.guide.hints).toHaveLength(3);
  });
  it('injects the primary supply fault by circuit role, regardless of sensor name', () => {
    const p = starter('supply'); p.challenge = 'supply';
    const primary = p.components.find(c => c.name === 'Primary level sensor')!, supply = challengeDefinition('supply');
    primary.name = 'My own destination sensor';
    const s = new Simulation(p);
    s.time = 300;
    supply.update!(s, s.challengeState, 1 / 60);
    expect(hydraulicState(s).faultInjected).toBe(true);
    expect(s.faults[primary.id]).toBe('sensorFault');
  });
});

describe('example shelf', () => {
  it('keeps the heated loop circulating after five minutes without filling its receiver', () => {
    const p = starter('circulation'), s = new Simulation(p);
    s.advanceAdaptive(300);
    const pipe = p.components.find(c => c.kind === 'pipe')!;
    const destination = p.components.find(c => c.name === 'Destination tank')!;
    expect(s.error).toBeNull();
    expect(s.multiphysics.hydraulic.readings[pipe.id].flow * 60000).toBeGreaterThan(30);
    expect(s.multiphysics.tanks[destination.id].volume * 1000).toBeLessThan(Number(destination.props.capacity) * 0.9);
    expect(Math.abs(s.multiphysics.massResidual)).toBeLessThan(1e-6);
  });
  for (const example of examples) it(`${example.mode} has connected equipment and meaningful live measurements`, () => {
    const p = parseProject(JSON.parse(serializeProject(starter(example.mode))));
    const s = new Simulation(p);
    for (let i = 0; i < 60; i++) expect(s.step()).toBe(true);
    expect(s.error).toBeNull();
    // Direct-on-line starting current is within the motor starting allowance, so no example reports violations.
    expect(s.violations).toEqual([]);
    if (example.mode === 'induction') expect(s.electrical.readings[p.components.find(c => c.kind === 'inductionMotor')!.id].current).toBeLessThan(15);
    expect(Object.keys(s.failed)).toEqual([]);
    expect(p.probes?.length).toBeGreaterThan(0);
    if (example.mode !== 'mechanism' && example.mode !== 'descent' && example.mode !== 'exchanger' && example.mode !== 'battery') expect(s.suppliedEnergy).toBeGreaterThan(0);
  });
});

describe('heat exchanger example', () => {
  function experiment(ua = 5000) {
    const p = parseProject(JSON.parse(serializeProject(starter('exchanger'))));
    const hx = p.components.find(c => c.kind === 'heatExchanger')!;
    hx.props.ua = ua;
    const s = new Simulation(p);
    s.advanceAdaptive(60);
    return { p, s, hx, hot: s.multiphysics.hydraulic.readings[`${hx.id}#hot`], cold: s.multiphysics.hydraulic.readings[`${hx.id}#cold`] };
  }
  it('recovers heat between separate finite streams and conserves mass and energy', () => {
    const { p, s, hot, cold } = experiment();
    expect(s.error).toBeNull();
    expect(s.violations).toEqual([]);
    expect(hot.flow).toBeGreaterThan(0.001);
    expect(cold.flow).toBeGreaterThan(0.001);
    expect(hot.duty).toBeGreaterThan(100000);
    expect(hot.temperature - 273.15).toBeLessThan(75);
    expect(cold.temperature - 273.15).toBeGreaterThan(15);
    // 1.5 m³ per stream at its feed temperature (published densities 971.80 and 999.70 kg/m³).
    for (const [names, density] of [[['Hot feed · 80 °C', 'Cooled hot water'], 971.8], [['Cold feed · 10 °C', 'Warmed cold water'], 999.7]] as const) {
      const mass = names.reduce((total, name) => total + s.multiphysics.tanks[p.components.find(c => c.name === name)!.id].mass, 0);
      expect(Math.abs(mass / (1.5 * density) - 1)).toBeLessThan(2e-5);
    }
    expect(Math.abs(s.energyResidual)).toBeLessThan(0.5);
    expect(s.suppliedEnergy).toBe(0);
  });
  it('reducing UA decreases recovered heat and leaves the hot outlet warmer', () => {
    const strong = experiment(), weak = experiment(1000);
    expect(weak.hot.duty).toBeLessThan(Number(strong.hot.duty) * 0.3);
    expect(weak.hot.temperature).toBeGreaterThan(strong.hot.temperature);
    expect(weak.cold.temperature).toBeLessThan(strong.cold.temperature);
  });
});
