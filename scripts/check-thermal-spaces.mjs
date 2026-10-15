import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

const bundle = await build({ stdin: { contents: `export { Simulation } from './src/simulation/engine'; export { starter } from './src/simulation/projects';`, resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', write: false });
const { Simulation, starter } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const duration = Number(process.env.PHYSICS_THERMAL_DURATION ?? 3600);
const reports = [];
for (const mode of ['kermi', 'livingRoom', 'roomCooldown']) {
  const s = new Simulation(starter(mode)), started = performance.now();
  const heating = s.advanceAdaptive(duration);
  const room = s.project.thermalSpaces?.[0], heated = room ? s.spaceTemperatures[room.id] : null;
  const heatingMs = performance.now() - started;
  let cooling;
  if (mode === 'roomCooldown' && duration >= 3600) cooling = s.advanceAdaptive(7200);
  const report = { mode, heatingSeconds: duration, heatingMs, simulatedSecondsPerWallSecond: duration * 1000 / heatingMs, heatingSteps: heating.steps, maxHeatingStep: heating.maxTaken, totalSeconds: s.time, totalMs: performance.now() - started, heatedTemperature: heated, finalTemperature: room ? s.spaceTemperatures[room.id] : null, coolingSteps: cooling?.steps ?? 0, error: s.error, violations: s.violations, suppliedEnergy: s.suppliedEnergy, roomStored: s.roomStored, energyResidual: s.energyResidual, massResidual: s.multiphysics.massResidual, boilerStages: Object.values(s.multiphysics.boilers).map(b => b.stages) };
  report.pass = !report.error && !report.violations.length && Math.abs(report.energyResidual) < 0.5 && Math.abs(report.massResidual) < 1e-6 && (!room || duration < 3600 || (heated > room.initialTemperature && (mode !== 'roomCooldown' || (report.finalTemperature < heated && report.boilerStages.every(n => n === 0)))));
  reports.push(report); console.log(JSON.stringify(report));
}
// Release checks print current timings without rewriting the historical benchmark artifact.
if (!process.argv.includes('--check')) await writeFile('validation/thermal-spaces.json', JSON.stringify({ executedAt: new Date().toISOString(), duration, reports }, null, 2) + '\n');
if (reports.some(r => !r.pass)) process.exitCode = 1;
