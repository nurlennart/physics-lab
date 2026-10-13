// Independent datasheet/analytical calibration report; regression assertions also run in the release gate.
import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
const bundle = await build({ stdin: { contents: `export { Simulation } from './src/simulation/engine'; export { Builder } from './src/simulation/scaling-validation'; export { solveElectrical } from './src/simulation/electrical';`, resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', write: false });
const { Simulation, Builder, solveElectrical } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
function rig(props = {}, single = false) {
  const b = new Builder(), boiler = b.add('electricBoiler', props);
  const sources = [0, -120, 120].slice(0, single ? 1 : 3).map(phase => b.add('sourceAC', { phase, maxCurrent: 63, maxPower: 15000 }));
  for (let i = 0; i < 3; i++) b.wire(sources[single ? 0 : i], 'a', boiler, `L${i + 1}`);
  for (const c of sources) b.wire(c, 'b', boiler, 'N');
  return { b, boiler, sources };
}
const rows = [];
function row(name, reference, modeled, tolerance, basis) { const error = Math.abs(modeled - reference); const pass = Number.isFinite(modeled) && error <= tolerance; rows.push({ name, reference, modeled, absoluteError: error, tolerance, pass, basis }); if (!pass) throw Error(name); }
for (const single of [false, true]) {
  const { b, boiler, sources } = rig({}, single), e = solveElectrical(b.p, {}, { boilers: { [boiler.id]: 3 } });
  row(single ? '230 V bridged live current (A)' : '230 V phase L1 current (A)', single ? 39.2 : 13.1, Math.abs(e.readings[sources[0].id].current), single ? 0.196 : 0.0655, 'Bosch manual Table 7; ±0.5%');
}
const { b, boiler } = rig({ maxStages: 1, loss: 0 });
const sim = new Simulation(b.p);
for (let i = 0; i < 300; i++) if (!sim.step(0.1)) throw Error(sim.error);
const cw = 3.7 * 4180 + 3500, ce = 1500, total = cw + ce, tau = cw * ce / (1200 * total);
const difference = 3000 / 1200 * cw / total * (1 - Math.exp(-30 / tau));
const expected = 20 + (3000 * 30 - ce * difference) / total;
row('Isolated water temperature at 30 s, 3 kW (°C)', expected, sim.fluidTemperatureMeasurement(boiler.id), 0.0001, 'Independent analytic two-body solution; assumed metal capacities and transfer coefficient; no shell loss');
row('Water/steel stored energy at 30 s (J)', cw * (sim.fluidTemperatureMeasurement(boiler.id) - 20), sim.waterStored, 0.0001, 'Independent reconstruction from final state');
row('Element stored energy at 30 s (J)', ce * (sim.multiphysics.boilers[boiler.id].elementTemperature - 293.15), sim.heaterStored, 0.0001, 'Independent reconstruction from final state');
row('Warm-up energy residual (J)', 0, sim.energyResidual, 0.0001, 'Terminal input = physical storage + ambient loss');
const tripRig = rig({ loss: 0 }), trip = new Simulation(tripRig.b.p);
trip.injectFault(tripRig.boiler.id, 'stuckClosed');
while (trip.time < 220 && !trip.multiphysics.boilers[tripRig.boiler.id].fault) if (!trip.step(0.1)) throw Error(trip.error);
row('Water temperature at first STB trip (°C)', 95, trip.fluidTemperatureMeasurement(tripRig.boiler.id), 0.05, 'Bosch §6.2.1; 0.1 s integration crossing tolerance');
row('STB-event energy residual (J)', 0, trip.energyResidual, 0.0001, 'No temperature clamp at the limiter');
const f = v => Number(v.toPrecision(10));
let md = '# Electric boiler calibration snapshot\n\nReference: [Bosch Tronic Heat 3000 9, manual 6720859226 (2018/09)](https://bosch-de-de.boschhc-documents.com/download/pdf/file/6720859226). This report compares published currents and limiter temperature plus independent analytical/storage calculations. It does not establish accuracy of assumed transient coefficients against manufacturer laboratory traces.\n\n| Check | Reference | Model | Absolute error | Allowed error | Result |\n| --- | ---: | ---: | ---: | ---: | --- |\n';
for (const r of rows) md += `| ${r.name} | ${f(r.reference)} | ${f(r.modeled)} | ${f(r.absoluteError)} | ${r.tolerance} | ${r.pass ? 'PASS' : 'FAIL'} |\n`;
md += `\nThe analytic warm-up uses C_w = ${cw} J/K, C_e = ${ce} J/K, G = 1200 W/K and τ = ${f(tau)} s. With D(t) = (P/G)·C_w/(C_w+C_e)·(1−exp(−t/τ)), T_w(t) = 20+(P·t−C_e·D(t))/(C_w+C_e). The applied power is one actual 3 kW resistive stage for 30 s, shell UA zero, no flow.\n\nAt the first trip (${f(trip.time)} simulated seconds), the protection opens the heating stages; stored element heat remains and can continue to warm the water. Full regression coverage is in boiler.test.ts, the preset campaign and browser tests. Model assumptions and remaining limits: [ELECTRIC-BOILER.md](../docs/ELECTRIC-BOILER.md).\n`;
const previous = await readFile('validation/boiler.md', 'utf8').catch(() => '');
if (previous !== md) await writeFile('validation/boiler.md', md);
console.log(JSON.stringify(rows.map(r => ({ check: r.name, model: f(r.modeled), error: f(r.absoluteError), pass: r.pass })), null, 2));
