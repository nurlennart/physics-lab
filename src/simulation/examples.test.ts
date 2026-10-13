import { describe, expect, it } from 'vitest';
import { Simulation } from './engine';
import { exampleFile, examples } from './learning';
import { parseProject, starter } from './projects';

const modes = ['blank', ...examples.map(e => e.mode)];
const fsName = 'node:fs', fs = await import(/* @vite-ignore */ fsName) as { readFileSync(p: URL, e: string): string };
const file = (mode: string) => JSON.parse(fs.readFileSync(new URL(`../../examples/${mode}.physics.json`, import.meta.url), 'utf8'));

describe('checked-in example files', () => {
  it.each(modes)('%s is current (regenerate with node scripts/check-examples.mjs --write)', mode => {
    expect(file(mode)).toEqual(exampleFile(mode));
  });

  it.each(examples.map(e => e.mode))('%s imported behaves like the generated starter at 20 °C and 35 °C', mode => {
    for (const ambient of [20, 35]) {
      const run = (p: ReturnType<typeof parseProject>) => {
        const s = new Simulation(parseProject({ ...p, environment: { ambient } }));
        for (let i = 0; i < 60; i++) if (!s.step()) break;
        const ids = s.project.components.map(c => c.id);
        return {
          error: s.error, time: s.time, supplied: s.suppliedEnergy, stored: s.storedEnergy, ambient: s.ambientEnergy, residual: s.energyResidual,
          temperatures: ids.map(id => s.temperatures[id]), cells: ids.map(id => s.multiphysics.pipeCells[id]), failed: Object.keys(s.failed).length,
        };
      };
      const imported = run(parseProject(file(mode))), generated = run(starter(mode as Parameters<typeof starter>[0]));
      expect(imported, `${mode} at ${ambient} °C`).toEqual(generated);
      expect(imported.error).toBeFalsy();
    }
  }, 120_000);
});
