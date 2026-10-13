import { build } from 'esbuild';
import { writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const outfile = join(tmpdir(), `physics-solar-validation-${process.pid}.mjs`);
await build({ stdin: { contents: `export { Simulation } from './src/simulation/engine'; export { solarStarter } from './src/simulation/solar-projects'; export { pvModel, pvFit } from './src/simulation/solar'; export { Builder } from './src/simulation/scaling-validation'; export { solarProvenance } from './src/simulation/solar-provenance';`, resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', outfile });
const { Simulation, solarStarter, pvModel, pvFit, Builder, solarProvenance } = await import(pathToFileURL(outfile).href);
const rows = [];
function check(category, name, expected, measured, tolerance, unit = '') {
  const error = Math.abs(expected - measured), pass = Number.isFinite(measured) && error <= tolerance;
  rows.push({ category, name, expected, measured, error, tolerance, unit, pass });
}
const b = new Builder(), panel = b.add('solarPanel'), m = pvModel(panel), fit = pvFit(panel);
for (const [name, expected, measured, tol, unit] of [
  ['STC Isc', 10.74, m.isc, 1e-7, 'A'], ['STC Voc', 52.9, m.voc, 1e-7, 'V'],
  ['STC Vmpp', 44.6, m.vmp, 1e-7, 'V'], ['STC Impp', 10.09, m.imp, 1e-7, 'A'],
]) check('Fitting constraint', name, expected, measured, tol, unit);
const noct = pvModel({ ...panel, props: { ...panel.props, irradiance: 800, cellTemperature: 43 } });
check('Withheld manufacturer reference', 'NOCT power', 344, noct.pmp, 344 * 0.03, 'W');
check('Withheld manufacturer reference', 'NOCT Voc', 50.2, noct.voc, 50.2 * 0.015, 'V');
check('Withheld manufacturer reference', 'NOCT Isc', 8.66, noct.isc, 8.66 * 0.01, 'A');
const temperatureStep = pvModel({ ...panel, props: { ...panel.props, cellTemperature: 26 } });
check('Withheld manufacturer reference', 'Pmax temperature coefficient near STC', -0.29, (temperatureStep.pmp / m.pmp - 1) * 100, 0.06, '%/K');
const inverterFixture = new Builder(), source = inverterFixture.add('source', { voltage: 25.6, maxCurrent: 100 }), inv = inverterFixture.add('inverter'), load = inverterFixture.add('resistor', { resistance: 264.5, ratedPower: 500 });
inverterFixture.series(source, inv); inverterFixture.wire(inv, 'oa', load, 'a'); inverterFixture.wire(inv, 'ob', load, 'b');
const ac = new Simulation(inverterFixture.p); if (ac.error || !ac.step(0.1)) throw Error(ac.error ?? 'inverter failed');
check('Analytical network', '230 V / 264.5 Ω AC load', 200, ac.electrical.readings[load.id].power, 1e-7, 'W');
check('Calibration assumption', 'Inverter peak at half load', 0.9, ac.electrical.readings[inv.id].solar.efficiency, 1e-8, '1');
const runs = [];
for (const h of [0.1, 0.05]) {
  const p = solarStarter('solarOffGrid'), s = new Simulation(p), pv = p.components.find(c => c.kind === 'solarPanel'), battery = p.components.find(c => c.kind === 'lfpBattery');
  for (let k = 0; k < Math.round(20 / h); k++) if (!s.step(h)) throw Error(s.error ?? 'step failed');
  runs.push(s.devices.batteries[battery.id]);
  check('Conservation', `20 s coupled run at h=${h}`, 0, s.energyResidual, 1e-3, 'J');
  if (h === 0.1) {
    const start = s.devices.batteries[battery.id];
    if (!s.advanceAdaptive(580)) throw Error(s.error ?? 'adaptive daytime failed');
    const charged = s.devices.batteries[battery.id];
    if (!s.refresh({ ...s.project, components: s.project.components.map(c => c.id === pv.id ? { ...c, props: { ...c.props, irradiance: 0 } } : c) })) throw Error(s.error ?? 'night edit failed');
    if (!s.advanceAdaptive(600)) throw Error(s.error ?? 'adaptive night failed');
    check('Conservation', '1200 s solar + night global energy residual', 0, s.energyResidual, 0.01, 'J');
    check('Behavior', 'Sunlight charges battery while serving both loads', 1, Number(charged > start), 0, 'boolean');
    check('Behavior', 'Night draws down stored chemical charge', 1, Number(s.devices.batteries[battery.id] < charged), 0, 'boolean');
  }
}
check('Timestep convergence', 'SOC difference h=0.1 versus h=0.05 after 20 s', 0, Math.abs(runs[0] - runs[1]), 2e-6, '1');
const report = { model: 'Solar energy system', references: solarProvenance, fitted: { idealityVoltage: fit.a, seriesResistance: fit.rs }, rows, pass: rows.every(r => r.pass), limitations: 'NOCT is a manufacturer table reference, not an independent laboratory trace. Peak-efficiency load location and SOC curve are assumptions. Fixed maximum tolerances are stated per row; fitting constraints are not held-out validation.' };
async function writeChanged(path, text) { let old; try { old = await readFile(path, 'utf8'); } catch {} if (old !== text) await writeFile(path, text); }
await writeChanged('validation/solar-energy.json', JSON.stringify(report, null, 2) + '\n');
await writeChanged('validation/solar-energy.md', `# Solar energy validation\n\nGenerated by \`npm run validate:solar\`. Reference sources, equations and limitations: [SOLAR-ENERGY.md](../docs/SOLAR-ENERGY.md).\n\nFitted diode ideality voltage **${fit.a.toPrecision(7)} V**, series resistance **${fit.rs.toPrecision(7)} Ω**.\n\n| Category | Check | Expected | Measured | Absolute error | Tolerance | Pass |\n| --- | --- | ---: | ---: | ---: | ---: | --- |\n${rows.map(r => `| ${r.category} | ${r.name} (${r.unit}) | ${r.expected.toPrecision(8)} | ${r.measured.toPrecision(8)} | ${r.error.toPrecision(4)} | ${r.tolerance.toPrecision(4)} | ${r.pass ? 'yes' : 'NO'} |`).join('\n')}\n\n${report.limitations}\n\n## Reference provenance\n\n${Object.values(solarProvenance).map(ref => `- [${ref.reference}](${ref.url}): ${ref.facts}`).join('\n')}\n`);
for (const r of rows.filter(r => !r.pass)) console.error(r);
console.log(`Solar validation: ${rows.filter(r => r.pass).length}/${rows.length} passed.`);
if (!report.pass) process.exitCode = 1;
