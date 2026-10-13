// Kermi therm-x2 calibration snapshot: the full engine against published Kermi data and analytic references.
// References are computed here from the Kermi tables and textbook formulas; regression assertions run in
// src/simulation/panel-radiator.test.ts as part of the release gate.
import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
const bundle = await build({ stdin: { contents: `
  export { Simulation } from './src/simulation/engine'; export { Builder } from './src/simulation/scaling-validation';
  export { Multiphysics } from './src/simulation/multiphysics'; export { solveHydraulic } from './src/simulation/hydraulic';
  export { kermiModels, kermiHydraulics, kermiReference } from './src/simulation/panel-radiator';
`, resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', write: false });
const { Simulation, Builder, Multiphysics, solveHydraulic, kermiModels, kermiHydraulics, kermiReference } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const CP = 4180, lmtd = (s, r, a) => (s - r) / Math.log((s - a) / (r - a));
const rows = [];
function row(section, name, reference, modeled, tolerance, basis) {
  const error = Math.abs(modeled - reference), pass = Number.isFinite(modeled) && error <= tolerance;
  rows.push({ section, name, reference, modeled, error, tolerance, pass, basis });
  if (!pass) console.error(`FAIL ${name}: ${modeled} vs ${reference}`);
}
function rig(supply, air, variant = 'standard', props = {}) {
  const b = new Builder(), common = { capacity: 300000, volume: 100000, surfaceArea: 100000, loss: 0, maxPressure: 1e7 };
  const hot = b.add('tank', { ...common, initialTemperature: supply }), cold = b.add('tank', { ...common, initialTemperature: air });
  const radiator = b.add('panelRadiator', { initialTemperature: air, ambient: air, ...props }, variant);
  b.wire(hot, 'fluid', radiator, 'inlet'); b.wire(radiator, 'outlet', cold, 'fluid');
  return { b, hot, radiator };
}
function tune(r, massFlow) {
  let lo = 0, hi = 5;
  for (let i = 0; i < 80; i++) {
    r.hot.props.elevation = (lo + hi) / 2;
    const m = new Multiphysics(); m.initialize(r.b.p);
    if (solveHydraulic(r.b.p, m.tanks).readings[r.radiator.id].flow * 1000 > massFlow) hi = (lo + hi) / 2; else lo = (lo + hi) / 2;
  }
}
function steady(supply, ret, air, table, variant = 'standard', seconds = 5400) {
  const r = rig(supply, air, variant); tune(r, table / (CP * (supply - ret)));
  const s = new Simulation(r.b.p); s.advanceAdaptive(seconds);
  if (s.error) throw Error(s.error);
  return { s, h: s.multiphysics.hydraulic.readings[r.radiator.id] };
}

// 1. Published outputs at their flows (type 22, 600 × 1000, every room temperature of the Kermi table).
const table22 = { 16: [1506, 1007, 734], 18: [1422, 930, 662], 20: [1338, 854, 593], 22: [1255, 780, 525], 24: [1174, 707, 459] };
const pairs = [[70, 55], [55, 45], [45, 40]];
const points = [[75, 65, 20, 1666], ...Object.entries(table22).flatMap(([air, values]) => pairs.map(([s, r], i) => [s, r, +air, values[i]]))];
for (const [supply, ret, air, table] of points) {
  const { h, s } = steady(supply, ret, air, table);
  row('Kermi FK0220610 (type 22, 600 × 1000) — published output', `${supply}/${ret}/${air} °C output (W)`, table, h.duty, Math.max(1, 0.002 * table), 'Kermi Technik p. 23–24 (rounded to 1 W); flow set to Φ/(c·ΔT)');
  row('Kermi FK0220610 (type 22, 600 × 1000) — published output', `${supply}/${ret}/${air} °C return (°C)`, ret, h.returnTemperature - 273.15, 0.03, 'Same point: modeled return at the published flow');
  if (Math.abs(s.energyResidual) > 0.5) throw Error('energy residual');
}
// 2. Every catalog size at 55/45/20 °C and 70/55/20 °C.
for (const [id, m] of Object.entries(kermiModels)) for (const [i, [supply, ret]] of [[0, pairs[0]], [1, pairs[1]]]) {
  const table = m.table[i] * m.length / 1000, { h } = steady(supply, ret, 20, table, id);
  row('Catalog sizes', `${m.article} ${supply}/${ret}/20 °C output (W)`, table, h.duty, Math.max(1, 0.002 * table), 'Kermi Technik p. 24, W/m × length');
}
// 3. Off-design flows at 70 °C supply: EN 442 characteristic solved independently (Kermi conversion method).
const nominal = 1666 / (CP * 10);
for (const share of [0.02, 0.1, 0.5, 1, 2]) {
  const r = rig(70, 20); tune(r, share * nominal);
  const s = new Simulation(r.b.p); s.advanceAdaptive(share < 0.05 ? 24 * 3600 : 4 * 3600);
  const h = s.multiphysics.hydraulic.readings[r.radiator.id], m = h.flow * 1000;
  let lo = 20, hi = 70;
  for (let i = 0; i < 200; i++) { const t = (lo + hi) / 2; if (m * CP * (70 - t) > 1666 * (lmtd(70, t, 20) / (10 / Math.log(55 / 45))) ** 1.293) lo = t; else hi = t; }
  row('EN 442 characteristic at off-design flow (70 °C supply, 20 °C air)', `${(share * 100).toFixed(0)} % of nominal flow: return (°C)`, lo, h.returnTemperature - 273.15, 0.02, 'Independent bisection of ṁ·c·(T_s − T_r) = Φ₅₀·(ΔT_ln/ΔT₅₀)^n');
  row('EN 442 characteristic at off-design flow (70 °C supply, 20 °C air)', `${(share * 100).toFixed(0)} % of nominal flow: output (W)`, m * CP * (70 - lo), h.duty, 0.001 * m * CP * (70 - lo), 'Same reference');
}
// 4. Pressure drop against the Kermi chart lines.
for (const [variant, group] of [['standard', '12-33'], ['type11', '10/11']]) for (const kgh of [50, 100, 143, 300, 600]) {
  const r = rig(70, 20, variant); tune(r, kgh / 3600);
  const m = new Multiphysics(); m.initialize(r.b.p);
  const dp = solveHydraulic(r.b.p, m.tanks).readings[r.radiator.id].differentialPressure, chart = kermiHydraulics[group].chartPa100 * (kgh / 100) ** 1.987;
  row('Pressure drop (Profil-K, same-side connection, 70 °C water)', `types ${group} at ${kgh} kg/h (Pa)`, chart, dp, 0.015 * chart, 'Kermi Technik p. 148, chart line from its vector path');
}
// 5. Zero-flow cooling from 70 °C: C·dθ/dt = −K_m·θⁿ, analytic.
{
  const b = new Builder(), radiator = b.add('panelRadiator', { initialTemperature: 70, ambient: 20 }), s = new Simulation(b.p);
  const C = 6.08 * CP + 29.63 * 450, km = 1666 / (10 / Math.log(55 / 45)) ** 1.293, n = 1.293;
  for (let i = 0; i < 3600; i++) s.step(0.5, true);
  const theta = (50 ** (1 - n) + (n - 1) * km * 1800 / C) ** (1 / (1 - n));
  row('Zero flow', 'mean water after 30 min from 70 °C (°C)', 20 + theta, s.fluidTemperatureMeasurement(radiator.id), 0.02, 'Analytic solution of C·dθ/dt = −K_m·θⁿ; C = 6.08 L water + 29.63 kg × 450 J/(kg·K)');
  row('Zero flow', 'heat given to the room in 30 min (kJ)', C * (50 - theta) / 1000, s.ambientEnergy / 1000, 0.01 * C * (50 - theta) / 1000, 'Stored-energy change of the same solution');
  row('Zero flow', 'energy residual (J)', 0, s.energyResidual, 1e-6, 'Ledger: storage + room heat');
}
// 6. Timestep convergence of the warm-up front (outlet at 240 s, nominal flow, 75 °C supply).
const outlet = h => { const r = rig(75, 20); tune(r, nominal); const s = new Simulation(r.b.p); for (let i = 0; i < Math.round(240 / h); i++) s.step(h, h > 0.1); return s.multiphysics.pipeCells[r.radiator.id].at(-1) - 273.15; };
const reference = outlet(0.05), convergence = [8, 4, 2, 1].map(h => ({ h, value: outlet(h) })).map(c => ({ ...c, error: Math.abs(c.value - reference) }));

const f = v => Number(Number(v).toPrecision(7));
let md = `# Panel radiator calibration snapshot\n\nReference: [${kermiReference.title}](${kermiReference.url}). ${kermiReference.note} Every row compares the full simulation engine (hydraulic network, enthalpy transport, 16-cell water and steel inventory, energy ledger) with a number published by Kermi or with an independent analytic solution; no row calls the radiator model to compute its reference. Regenerate with \`npm run validate:radiator\`.\n`;
let section = '';
for (const r of rows) {
  if (r.section !== section) { section = r.section; md += `\n## ${section}\n\n| Check | Reference | Model | Error | Tolerance | Result | Basis |\n| --- | --- | --- | --- | --- | --- | --- |\n`; }
  md += `| ${r.name} | ${f(r.reference)} | ${f(r.modeled)} | ${f(r.error)} | ${f(r.tolerance)} | ${r.pass ? 'PASS' : 'FAIL'} | ${r.basis} |\n`;
}
md += `\n## Timestep convergence (backward Euler)\n\nOutlet temperature 240 s after hot water at nominal flow reaches a radiator at 20 °C; reference step 0.05 s gives ${f(reference)} °C.\n\n| Step (s) | Outlet (°C) | Error (K) | Ratio to the next finer step |\n| --- | --- | --- | --- |\n`;
convergence.forEach((c, i) => { md += `| ${c.h} | ${f(c.value)} | ${f(c.error)} | ${i + 1 < convergence.length ? f(c.error / convergence[i + 1].error) : '—'} |\n`; });
md += `\nRatios near 2 confirm first-order convergence. During normal runs the adaptive integrator limits radiator cells to 0.05 K per step, so warm-up fronts are resolved; steady states are exact for any step.\n`;
const previous = await readFile('validation/panel-radiator.md', 'utf8').catch(() => '');
if (previous !== md) await writeFile('validation/panel-radiator.md', md);
console.log(`${rows.filter(r => r.pass).length}/${rows.length} checks passed; worst relative output error ${f(Math.max(...rows.filter(r => r.name.includes('output')).map(r => r.error / Math.abs(r.reference))))}`);
if (rows.some(r => !r.pass)) process.exit(1);
