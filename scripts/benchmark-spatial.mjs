import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { cpus } from 'node:os';
const bundle = await build({ stdin: { contents: `export { Simulation } from './src/simulation/engine'; export { makeComponent, uid } from './src/simulation/model'; export { defaultWorld, makeSpatial } from './src/simulation/spatial-model'; export { mechanicalStarter } from './src/simulation/spatial-projects';`, resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', write: false });
await writeFile('/tmp/physics-spatial-benchmark.mjs', bundle.outputFiles[0].text);
const { Simulation, makeComponent, uid, defaultWorld, makeSpatial, mechanicalStarter } = await import(`/tmp/physics-spatial-benchmark.mjs?${Date.now()}`);
const benchmarks = [];
for (const count of [10, 50, 100]) {
  const p = { version: 4, id: uid(), name: 'Falling body benchmark', components: [], connections: [], world: defaultWorld() };
  for (let i = 0; i < count; i++) { const c = makeComponent('rigidBody', 0, 0, p.components); c.spatial = i === 0 ? { ...makeSpatial('floor', 5, -0.25), width: 20, height: 0.5 } : { ...makeSpatial('circle', (i % 12) * 0.7, 1 + Math.floor(i / 12) * 0.7), width: 0.5, height: 0.5, mass: 1 }; p.components.push(c); }
  const start = performance.now(), s = new Simulation(p), initMs = performance.now() - start, durations = [];
  for (let i = 0; i < 600; i++) { const before = performance.now(); if (!s.step()) break; durations.push(performance.now() - before); }
  const sorted = [...durations].sort((a,b) => a-b);
  const report = { bodyCount: count, simulatedSeconds: s.time, initMs, meanStepMs: durations.reduce((a,b) => a+b,0) / durations.length, p95StepMs: sorted[Math.floor(sorted.length * 0.95)], maxStepMs: sorted.at(-1), activeBodies: Object.values(s.spatial.readings).filter(b => b.awake).length, error: s.error, violations: s.violations, energyResidualJ: s.energyResidual };
  benchmarks.push(report); console.log(JSON.stringify(report));
}
const p = mechanicalStarter('mechanism'), s = new Simulation(p), initial = s.spatial.energy, start = performance.now();
for (let i = 0; i < 600 * 60; i++) if (!s.step()) break;
const longRun = { seconds: s.time, wallMs: performance.now() - start, initialMechanicalJ: initial, residualJ: s.energyResidual, relativeResidual: Math.abs(s.energyResidual) / initial, error: s.error, violations: s.violations, bodies: s.spatial.readings, joints: s.spatial.jointReadings };
console.log(JSON.stringify({ longRun }));
await writeFile('validation/phase3a-performance.json', JSON.stringify({ executedAt: new Date().toISOString(), environment: { node: process.version, cpu: cpus()[0]?.model, platform: process.platform, note: 'Node solver-only timings, concurrent work may affect wall time; not a browser FPS claim' }, benchmarks, longRun }, null, 2) + '\n');
if (benchmarks.some(r => r.error || r.violations.length) || longRun.error || longRun.violations.length || longRun.relativeResidual > 0.005) process.exitCode = 1;
