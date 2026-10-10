import { describe, expect, it } from 'vitest';
import { catalog, connect, makeComponent, prop, type Component, type Project } from './model';
import { Simulation } from './engine';
import { industrialStarter } from './hydraulic-projects';
import { parseProject, serializeProject, starter } from './projects';
import { catalogError, challengeError } from './integrity';

function variant(c: Component, id: string) { c.variant = id; c.props = { ...catalog(c).props }; }
function run(p: Project, seconds: number) {
  const s = new Simulation(p);
  for (let i = 0; i < seconds * 60; i++) expect(s.step(), s.error ?? 'simulation advance').toBe(true);
  expect(s.error).toBeNull();
  expect(Object.keys(s.failed)).toHaveLength(0);
  return s;
}

describe('larger DC motors and industrial pumping', () => {
  for (const [id, voltage, load] of [['traction48', 48, 0.8], ['industrial180', 180, 5]] as const) {
    it(`${voltage} V model matches loaded back-EMF equilibrium and conserves energy`, () => {
      let p: Project = { version: 3, id, name: id, components: [], connections: [] };
      const source = makeComponent('source', 0, 0), motor = makeComponent('motor', 300, 0);
      variant(source, 'motorSupply'); variant(motor, id);
      source.props.voltage = voltage; motor.props.loadTorque = load;
      p.components.push(source, motor);
      p = connect(p, { component: source.id, port: 'a' }, { component: motor.id, port: 'a' });
      p = connect(p, { component: motor.id, port: 'b' }, { component: source.id, port: 'b' });
      const s = run(p, 15), m = s.multiphysics.motors[motor.id];
      const k = prop(motor, 'torqueConstant'), r = prop(motor, 'resistance'), b = prop(motor, 'friction');
      const expected = (k * voltage - r * load) / (k * k + r * b);
      expect(m.omega / expected).toBeCloseTo(1, 4);
      expect(m.current).toBeCloseTo((voltage - k * m.omega) / r, 4);
      expect(m.shaftPower).toBeGreaterThan(voltage === 180 ? 1000 : 100);
      expect(Math.abs(s.energyResidual)).toBeLessThan(0.001);
      expect(catalogError(motor)).toBeNull();
    });
  }

  it('pumps finite water uphill twelve metres at industrial scale with load feedback', () => {
    const p = starter('industrial'), motor = p.components.find(c => c.kind === 'motor')!, pump = p.components.find(c => c.kind === 'pump')!;
    const source = p.components.find(c => c.name === 'Source reservoir')!, dest = p.components.find(c => c.name === 'Destination tank')!;
    expect(parseProject(JSON.parse(serializeProject(p)))).toEqual(p);
    const s = run(p, 15), h = s.multiphysics.hydraulic.readings[pump.id];
    expect(h.flow * 60000).toBeGreaterThan(100);
    expect(h.hydraulicPower).toBeGreaterThan(500);
    expect(h.hydraulicPower).toBeLessThanOrEqual(h.shaftPower);
    expect(s.multiphysics.tanks[dest.id].mass).toBeGreaterThan(20);
    // 2,000 L at 20 °C (998.207 kg/m³, published); mass is conserved exactly.
    expect(s.multiphysics.tanks[source.id].mass + s.multiphysics.tanks[dest.id].mass).toBeCloseTo(s.multiphysics.initialMass, 6);
    expect(Math.abs(s.multiphysics.initialMass / (2 * 998.207) - 1)).toBeLessThan(2e-5);
    expect(Math.abs(s.energyResidual)).toBeLessThan(5);
    const restricted = industrialStarter(); restricted.components.find(c => c.kind === 'valve')!.props.opening = 10;
    const closed = run(restricted, 15), cm = restricted.components.find(c => c.kind === 'motor')!, cp = restricted.components.find(c => c.kind === 'pump')!;
    expect(closed.multiphysics.hydraulic.readings[cp.id].flow).toBeLessThan(h.flow);
    expect(Math.abs(closed.multiphysics.motors[cm.id].current - s.multiphysics.motors[motor.id].current)).toBeGreaterThan(0.5);
  });

  it('keeps larger ratings purchased and rejects industrial supply in 24 V assignments', () => {
    const p = industrialStarter(), motor = p.components.find(c => c.kind === 'motor')!;
    motor.props.ratedPower = 100000;
    expect(catalogError(motor)).toMatch(/catalog/);
    const scored = starter('transfer', true), supply = scored.components.find(c => c.kind === 'source')!;
    variant(supply, 'motorSupply');
    expect(challengeError(scored)).toMatch(/voltage|24/i);
  });
});
