import { expect, it } from 'vitest';
import { layoutEquipment } from './spatial-layout';
import { starter, parseProject, serializeProject } from '../simulation/projects';
import { makeComponent } from '../simulation/model';
import { physicalKinds, spatialError } from '../simulation/spatial-model';
import { Simulation } from '../simulation/engine';

it('mounts shared equipment without changing engineering identity, connections or existing placement', () => {
  const p = starter('heat'), original = structuredClone(p), placed = layoutEquipment(p);
  expect(p).toEqual(original);
  expect(placed.connections).toBe(p.connections);
  expect(placed.components.map(c => c.id)).toEqual(p.components.map(c => c.id));
  expect(placed.components.every(c => !!c.spatial === physicalKinds.has(c.kind))).toBe(true);
  expect(placed.components.filter(c => c.spatial).every(c => c.spatial!.type === 'static' && !c.spatial!.collision && !c.spatial!.elevationLinked)).toBe(true);
  expect(spatialError(placed)).toBeNull();
  placed.components.find(c => c.kind === 'tank')!.spatial!.x = 25;
  const added = makeComponent('motor', 400, 200, placed.components);
  const extended = layoutEquipment({ ...placed, components: [...placed.components, added] });
  expect(extended.components.find(c => c.kind === 'tank')!.spatial!.x).toBe(25);
  expect(extended.components.at(-1)!.spatial).toBeDefined();
  expect(parseProject(JSON.parse(serializeProject(extended)))).toEqual(extended);
});

it('static automatic housings leave electrical, thermal, hydraulic and shaft physics unchanged', () => {
  const close = (a: unknown, b: unknown) => {
    if (typeof a === 'number' && typeof b === 'number') { expect(b).toBeCloseTo(a, 8); return; }
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      expect(Object.keys(b)).toEqual(Object.keys(a));
      for (const key of Object.keys(a)) close((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]);
    } else expect(b).toEqual(a);
  };
  for (const mode of ['heat', 'transfer'] as const) {
    const p = starter(mode), a = new Simulation(p), b = new Simulation(layoutEquipment(p));
    for (let step = 0; step < 120; step++) { expect(a.step(), a.error ?? '').toBe(true); expect(b.step(), b.error ?? '').toBe(true); }
    close(a.temperatures, b.temperatures);
    close(a.electrical, b.electrical);
    close(a.multiphysics.motors, b.multiphysics.motors);
    close(a.multiphysics.tanks, b.multiphysics.tanks);
    expect(b.energyResidual).toBeCloseTo(a.energyResidual, 7);
  }
});
