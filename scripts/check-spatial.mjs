import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
const bundle = await build({ stdin: { contents: `export { Simulation } from './src/simulation/engine'; export { mechanicalStarter } from './src/simulation/spatial-projects'; export { evaluateChallenge } from './src/simulation/challenges';`, resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', write: false });
await writeFile('/tmp/physics-spatial-check.mjs', bundle.outputFiles[0].text);
const { Simulation, mechanicalStarter, evaluateChallenge } = await import(`/tmp/physics-spatial-check.mjs?${Date.now()}`);
const reports = [];
for (const mode of (process.env.PHYSICS_MODES ?? 'mechanism,rotor,descent,lift,rotation').split(',')) {
  const p = mechanicalStarter(mode);
  if (['descent', 'lift', 'rotation'].includes(mode)) p.challenge = mode;
  const s = new Simulation(p), duration = mode === 'rotation' ? 70 : mode === 'mechanism' ? 60 : mode === 'rotor' ? 10 : 60;
  const start = performance.now();
  for (let i = 0; i < Math.round(duration * 60); i++) { if (!s.step()) break; if (evaluateChallenge(p, s)?.complete) break; }
  const report = { mode, time: s.time, wallMs: performance.now() - start, error: s.error, violations: s.violations, bodies: s.spatial.readings, motors: s.multiphysics.motors, mechanical: { externalWork: s.spatial.externalWork, shaftWork: s.spatial.shaftWork, contactLoss: s.spatial.contactLoss, dampingLoss: s.spatial.dampingLoss, residual: s.spatial.residual, maxImpactSpeed: s.spatial.maxImpactSpeed }, energyResidual: s.energyResidual, suppliedEnergy: s.suppliedEnergy, metrics: s.mechanicalChallenge, challenge: evaluateChallenge(p, s) };
  reports.push(report);
  console.log(JSON.stringify({ ...report, bodies: Object.values(report.bodies).map(b => ({ x: b.x, y: b.y, omega: b.omega, vy: b.vy })) }));
}
await writeFile('validation/spatial.json', JSON.stringify({ executedAt: new Date().toISOString(), reports }, null, 2) + '\n');
if (reports.some(r => r.error || r.violations.length || (r.challenge && !r.challenge.complete))) process.exitCode = 1;
