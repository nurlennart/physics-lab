import { build } from 'esbuild';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
const bundle = await build({ stdin: { contents: `export { Simulation } from './src/simulation/engine'; export { starter, parseProject, serializeProject } from './src/simulation/projects'; export { examples } from './src/simulation/learning'; export { readProbe } from './src/simulation/measurements';`, resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', write: false });
const { Simulation, starter, parseProject, serializeProject, examples, readProbe } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
// --write regenerates the importable files first, so the file runs below check exactly what is written.
if (process.argv.includes('--write')) {
  for (const mode of ['blank', ...examples.map(e => e.mode)]) {
    const p = starter(mode);
    // Stable identifiers keep checked-in scenarios reproducible across regenerations.
    const ids = new Map([[p.id, `example-${mode}`]]);
    for (const [group, entries] of Object.entries({ component: p.components, connection: p.connections, probe: p.probes ?? [], joint: p.world?.joints ?? [] })) entries.forEach((entry, i) => ids.set(entry.id, `${mode}-${group}-${i + 1}`));
    const stable = JSON.parse(serializeProject(p), (_, value) => typeof value === 'string' ? ids.get(value) ?? value : value);
    parseProject(stable);
    await writeFile(`examples/${mode}.physics.json`, JSON.stringify(stable, null, 2) + '\n');
  }
}
const reports = [];
const selected = process.env.PHYSICS_EXAMPLES?.split(',');
for (const example of examples.filter(e => !selected || selected.includes(e.mode))) {
 for (const source of ['generated', 'file']) {
  const p = parseProject(source === 'file' ? JSON.parse(await readFile(`examples/${example.mode}.physics.json`, 'utf8')) : JSON.parse(serializeProject(starter(example.mode))));
  const s = new Simulation(p), duration = example.mode === 'automated' ? 1800 : example.mode === 'supply' ? 720 : example.mode === 'circulation' ? 300 : example.mode === 'pressure' ? 195 : 60;
  // Exercise real-time startup, then the same adaptive advance used by the sandbox UI.
  for (let i = 0; i < 60; i++) if (!s.step()) break;
  if (!s.error && !s.adaptiveUnavailable()) s.advanceAdaptive(duration - s.time);
  else for (let i = 60; i < duration * 60; i++) if (!s.step()) break;
  const probes = p.probes.map(probe => ({ name: probe.name, value: readProbe(probe, s) }));
  const report = { mode: example.mode, source, simulatedSeconds: s.time, error: s.error, violations: s.violations, failed: s.failed, suppliedEnergy: s.suppliedEnergy, energyResidual: s.energyResidual, massResidual: s.multiphysics.massResidual, probes };
  reports.push(report);
  console.log(JSON.stringify(report));
 }
}
await mkdir('validation', { recursive: true });
let combined = reports;
if (selected) {
  const previous = JSON.parse(await readFile('validation/examples.json', 'utf8'));
  combined = examples.flatMap(e => ['generated', 'file'].map(source => reports.find(r => r.mode === e.mode && r.source === source) ?? previous.find(r => r.mode === e.mode && (r.source ?? 'generated') === source))).filter(Boolean);
}
await writeFile('validation/examples.json', JSON.stringify(combined, null, 2) + '\n');
if (reports.some(r => (r.mode === 'exchanger' && !(r.probes.find(p => p.name === 'Recovered heat')?.value > 0)) || (r.mode === 'circulation' && r.probes.find(p => p.name === 'Delivery flow')?.value < 1) || Math.abs(r.massResidual) > 1e-6 || r.error || r.violations.length || Object.keys(r.failed).length || r.probes.some(p => p.value === null || !Number.isFinite(p.value)))) process.exitCode = 1;
