import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
const bundle = await build({ stdin: { contents: `export { Simulation } from './src/simulation/engine'; export { hydraulicStarter } from './src/simulation/hydraulic-projects'; export { evaluateChallenge } from './src/simulation/challenges';`, resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', write: false });
await writeFile('/tmp/physics-coupled.mjs', bundle.outputFiles[0].text);
const { Simulation, hydraulicStarter, evaluateChallenge } = await import(`/tmp/physics-coupled.mjs?${Date.now()}`);
const reports = [];
for (const mode of (process.env.PHYSICS_MODES ?? 'transfer,pressure,supply,circulation').split(',')) {
  const p = hydraulicStarter(mode); if (mode !== 'circulation') p.challenge = mode;
  const s = new Simulation(p); const count = mode === 'supply' ? 720 : mode === 'pressure' ? 195 : mode === 'circulation' ? 60 : 180;
  const started = performance.now();
  for (let t = 0; t < count * 60; t++) { if (!s.step()) break; if (evaluateChallenge(p, s)?.complete) break; }
  const report = { mode, time: s.time, wallMs: performance.now()-started, solverMs: s.solverMs, error: s.error, violations: s.violations, tanks: s.multiphysics.tanks, motors: s.multiphysics.motors, hydraulic: s.multiphysics.hydraulic.readings, energyResidual: s.energyResidual, supplied: s.suppliedEnergy, massResidual: s.multiphysics.massResidual, metrics: s.hydraulicChallenge, challenge: evaluateChallenge(p, s) };
  reports.push(report);
  console.log(JSON.stringify({ mode, time: report.time, wallMs: report.wallMs, error: report.error, violations: report.violations, massResidual: report.massResidual, energyResidual: report.energyResidual, metrics: report.metrics, challenge: report.challenge }));
}
await writeFile('validation/coupled.json', JSON.stringify({ executedAt: new Date().toISOString(), reports }, null, 2) + '\n');
if (reports.some(r => r.error || r.violations.length || (r.challenge && !r.challenge.complete))) process.exitCode = 1;
