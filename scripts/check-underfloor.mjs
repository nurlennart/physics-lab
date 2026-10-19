// Underfloor heating calibration snapshot: the full engine against the FLOORTEC tables, EN 1264 relations and analytic
// references. References are computed here from the published tables and closed-form solutions; regression assertions
// run in src/simulation/underfloor-heating.test.ts as part of the release gate.
import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
const bundle = await build({ stdin: { contents: `
  export { Simulation } from './src/simulation/engine'; export { Builder } from './src/simulation/scaling-validation';
  export { Multiphysics } from './src/simulation/multiphysics'; export { solveHydraulic } from './src/simulation/hydraulic';
  export { characteristic, upwardResistance, floorWaterMass, screedCapacity, screedKey, floortec, FLOOR_CELLS, FLOORTEC_B } from './src/simulation/underfloor-heating';
  export { makeEnvelope, makeThermalSpace } from './src/simulation/thermal-spaces';
  export { starter } from './src/simulation/projects';
  export { viscosityK } from './src/simulation/water';
`, resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', write: false });
const { Simulation, Builder, Multiphysics, solveHydraulic, characteristic, upwardResistance, floorWaterMass, screedCapacity, screedKey, floortec, FLOOR_CELLS, FLOORTEC_B, makeEnvelope, makeThermalSpace, starter, viscosityK } =
  await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const CP = 4180, coverings = [0, 0.05, 0.1, 0.15], lmtd = (s, r, a) => (s - r) / Math.log((s - a) / (r - a));
const rows = [];
function row(section, name, reference, modeled, tolerance, basis) {
  const error = Math.abs(modeled - reference), pass = Number.isFinite(modeled) && error <= tolerance;
  rows.push({ section, name, reference, modeled, error, tolerance, pass, basis });
  if (!pass) console.error(`FAIL ${name}: ${modeled} vs ${reference}`);
}
function rig(supply, air, props = {}) {
  const b = new Builder(), common = { capacity: 300000, volume: 100000, surfaceArea: 100000, loss: 0, maxPressure: 1e7 };
  const hot = b.add('tank', { ...common, initialTemperature: supply }), cold = b.add('tank', { ...common, initialTemperature: air });
  const floor = b.add('underfloorHeating', { initialTemperature: air, ambient: air, ...props });
  b.wire(hot, 'fluid', floor, 'inlet'); b.wire(floor, 'outlet', cold, 'fluid');
  return { b, hot, floor };
}
function tune(r, massFlow) {
  let lo = 0, hi = 5;
  for (let i = 0; i < 80; i++) {
    r.hot.props.elevation = (lo + hi) / 2;
    const m = new Multiphysics(); m.initialize(r.b.p);
    if (solveHydraulic(r.b.p, m.tanks).readings[r.floor.id].flow * 1000 > massFlow) hi = (lo + hi) / 2; else lo = (lo + hi) / 2;
  }
}

// 1. EN 1264-2 characteristic (B fitted) against every FLOORTEC 16 × 2 table point.
floortec.flux.forEach((values, r) => values.forEach((q, j) => {
  const r0 = rig(40, 20, { coveringResistance: coverings[r], pipeSpacing: floortec.spacings[j] });
  row('FLOORTEC tacker 16 × 2, 45 mm screed — EN 1264-2 characteristic', `R_λ,B ${coverings[r]}, T ${floortec.spacings[j] * 1000} mm: q at Δθ 20 K (W/m²)`, q, characteristic(r0.floor) * 20, 0.65, 'FLOORTEC Technische Informationen pp. 522–525 (rounded to 1 W/m²)');
}));
// 2. The dynamic loop in steady state reproduces K_H·Δθ_H (log-mean) at the table configurations.
for (const [r, j] of [[0, 1], [1, 1], [2, 1], [3, 1], [2, 0], [2, 2], [2, 3], [2, 4]]) {
  const rr = rig(45, 20, { coveringResistance: coverings[r], pipeSpacing: floortec.spacings[j] }); tune(rr, 80 / 3600);
  const s = new Simulation(rr.b.p); s.advanceAdaptive(96 * 3600);
  if (s.error) throw Error(s.error);
  const h = s.multiphysics.hydraulic.readings[rr.floor.id], area = rr.floor.props.heatedArea, ret = h.returnTemperature - 273.15;
  row('Steady loop: heat flux per log-mean excess (45 °C supply, 80 kg/h, 20 °C room)', `R_λ,B ${coverings[r]}, T ${floortec.spacings[j] * 1000} mm: q/Δθ_H (W/(m²·K))`, floortec.flux[r][j] / 20, h.duty / area / lmtd(45, ret, 20), 0.01 * floortec.flux[r][j] / 20, 'FLOORTEC q/Δθ (arithmetic mean in the tables); model: engine duty over its own log-mean excess');
  if (Math.abs(s.energyResidual) > 0.1) throw Error('energy residual');
}
// 3. Downward loss against EN 1264's q_u = (R_o·q + θ_i − θ_u)/R_u with a colder room below (both rooms of 1 GJ/K, near-fixed).
{
  const rr = rig(40, 20); tune(rr, 80 / 3600);
  const up = makeThermalSpace(0, 0, 5, 4), down = makeThermalSpace(0, 600, 5, 4);
  Object.assign(up, { initialTemperature: 20, addedHeatCapacity: 1e9 }); Object.assign(down, { initialTemperature: 10, addedHeatCapacity: 1e9 });
  const slab = { id: 'slab', name: 'Slab', kind: 'ceiling', from: down.id, to: up.id, side: 'ceiling', uValue: 1.5, heatCapacity: 0 };
  rr.b.p = { ...rr.b.p, version: 5, environment: { ambient: 0 }, thermalSpaces: [up, down], thermalElements: [...makeEnvelope(up).filter(e => e.side !== 'floor'), ...makeEnvelope(down).filter(e => e.side !== 'ceiling'), slab] };
  const c = rr.b.p.components.find(x => x.id === rr.floor.id); c.thermalSpaceId = up.id; c.props = { ...c.props, ambientMode: 'inherit' };
  const s = new Simulation(rr.b.p); s.advanceAdaptive(96 * 3600);
  const h = s.multiphysics.hydraulic.readings[c.id], area = c.props.heatedArea, q = h.duty / area, ro = upwardResistance(c), ru = c.props.downwardResistance;
  const ti = s.spaceTemperatures[up.id], tu = s.spaceTemperatures[down.id];
  row('Downward loss (EN 1264-2/-3), room below at 10 °C', 'q_u (W/m²)', (ro * q + ti - tu) / ru, h.downwardLoss / area, 1e-3 * (ro * q + ti - tu) / ru, 'EN 1264 q_u = (R_o·q + θ_i − θ_u)/R_u with the engine\'s own q, θ_i, θ_u');
  row('Downward loss (EN 1264-2/-3), room below at 10 °C', 'heat received by the room below (W)', h.downwardLoss, s.spaceReadings[down.id].deviceFlows[c.id], 1e-6 * h.downwardLoss, 'Room ledger: the same exchange credited to the lower room');
  row('Downward loss (EN 1264-2/-3), room below at 10 °C', 'energy residual (J)', 0, s.energyResidual, 0.1, 'Global ledger after 96 h');
}
// 4. Pressure drop: Darcy–Weisbach with Colebrook–White at FLOORTEC's 0.007 mm roughness (per loop of 100 m, 12 mm bore).
for (const kgh of [30, 100, 150, 200, 250]) {
  const rr = rig(40, 40); tune(rr, kgh / 3600);
  const m = new Multiphysics(); m.initialize(rr.b.p);
  const h = solveHydraulic(rr.b.p, m.tanks).readings[rr.floor.id], d = 0.012, q = h.flow, v = q / (Math.PI * d * d / 4), mu = viscosityK(313.15), re = 1000 * v * d / mu;
  let f = 0.02;
  for (let i = 0; i < 100; i++) f = (-2 * Math.log10(0.000007 / d / 3.7 + 2.51 / (re * Math.sqrt(f)))) ** -2;
  const ref = re < 2300 ? 128 * mu * 100 * q / (Math.PI * d ** 4) : f * 100 / d * 1000 * v * v / 2;
  row('Pressure drop per loop (16 × 2, 100 m, 40 °C water)', `${kgh} kg/h (Pa)`, ref, h.differentialPressure, 0.03 * ref, 'Colebrook–White (laminar: Hagen–Poiseuille), k = 0.007 mm (FLOORTEC data sheet p. 594); model uses Swamee–Jain. 30 kg/h is laminar; 60 kg/h (Re ≈ 2700) lies in the blended transition and is not compared');
}
// 5. Zero-flow cool-down from 40 °C into 20 °C: two coupled nodes per cell, closed form.
{
  const b = new Builder(), floor = b.add('underfloorHeating', { initialTemperature: 40, ambient: 20 });
  const k = characteristic(floor), ro = upwardResistance(floor), ru = floor.props.downwardResistance, a = floor.props.heatedArea / FLOOR_CELLS;
  const gwp = k * (1 + ro / ru) / (1 - ro * k) * a, G = (1 / ro + 1 / ru) * a, cw = floorWaterMass(floor) / FLOOR_CELLS * CP, cs = screedCapacity(floor);
  const A = [[-gwp / cw, gwp / cw], [gwp / cs, -(gwp + G) / cs]], tr = A[0][0] + A[1][1], det = A[0][0] * A[1][1] - A[0][1] * A[1][0];
  const l1 = tr / 2 + Math.sqrt(tr * tr / 4 - det), l2 = tr / 2 - Math.sqrt(tr * tr / 4 - det);
  const theta = t => { const e1 = Math.exp(l1 * t), e2 = Math.exp(l2 * t), f = (i, j) => ((A[i][j] - (i === j ? l2 : 0)) * e1 - (A[i][j] - (i === j ? l1 : 0)) * e2) / (l1 - l2); return [20 * (f(0, 0) + f(0, 1)), 20 * (f(1, 0) + f(1, 1))]; };
  const s = new Simulation(b.p);
  for (let i = 0; i < 6 * 360; i++) s.step(10, true);
  const [water, screed] = theta(6 * 3600), plane = s.multiphysics.pipeCells[screedKey(floor.id)].reduce((x, t) => x + t, 0) / FLOOR_CELLS - 273.15;
  row('Zero flow: cool-down from 40 °C into 20 °C air', 'screed after 6 h (°C)', 20 + screed, plane, 0.02, 'Closed-form two-node solution (water ↔ screed ↔ room/below); 10 s steps');
  row('Zero flow: cool-down from 40 °C into 20 °C air', 'water after 6 h (°C)', 20 + water, s.fluidTemperatureMeasurement(floor.id), 0.02, 'Same solution');
  row('Zero flow: cool-down from 40 °C into 20 °C air', 'floor time constant (h)', -1 / l1 / 3600, -1 / l1 / 3600, 0, `Slow eigenvalue: screed ${(cs * FLOOR_CELLS / 1e6).toFixed(2)} MJ/K over ${(G * FLOOR_CELLS).toFixed(1)} W/K (reported, not a check)`);
  row('Zero flow: cool-down from 40 °C into 20 °C air', 'energy residual (J)', 0, s.energyResidual, 1e-3, 'Ledger: storage + room heat');
}
// 6. Timestep convergence of the warm-up (outlet at 240 s, 80 kg/h, 45 °C supply).
const outlet = h => { const r = rig(45, 20); tune(r, 80 / 3600); const s = new Simulation(r.b.p); for (let i = 0; i < Math.round(240 / h); i++) s.step(h, h > 0.1); return s.multiphysics.pipeCells[r.floor.id].at(-1) - 273.15; };
const reference = outlet(0.05), convergence = [8, 4, 2, 1].map(h => ({ h, value: outlet(h) })).map(c => ({ ...c, error: Math.abs(c.value - reference) }));
// 7. Heat-pump house: 6 h with the twelve-loop floor (Bosch heat pump, weather-compensated flow, hot water first).
const house = (() => {
  const p = starter('heatPumpHouse'), s = new Simulation(p), started = performance.now();
  const floor = p.components.find(c => c.kind === 'underfloorHeating'), hp = p.components.find(c => c.kind === 'heatPump'), room = p.thermalSpaces[0];
  const samples = [];
  for (let i = 1; i <= 6; i++) {
    s.advanceAdaptive(3600);
    if (s.error) throw Error(s.error);
    const h = s.multiphysics.hydraulic.readings[floor.id];
    samples.push({ hour: i, room: s.spaceTemperatures[room.id], floor: h.duty, down: h.downwardLoss, hp: s.multiphysics.heatPumpView[hp.id]?.heatOutput ?? 0, residual: s.energyResidual });
  }
  return { samples, seconds: (performance.now() - started) / 1000, residual: s.energyResidual, room: s.spaceTemperatures[room.id] };
})();
row('Heat-pump house (120 m², twelve 100 m loops, 2 °C outdoors)', 'house air after 6 h (°C), within 19–22', 20.5, house.room, 1.5, 'Plausibility band around the 20 °C design room temperature');
row('Heat-pump house (120 m², twelve 100 m loops, 2 °C outdoors)', 'energy residual after 6 h (J)', 0, house.residual, 0.1, 'Global ledger');

const f = v => Number(Number(v).toPrecision(7));
let md = `# Underfloor heating calibration snapshot\n\nReference system: ${floortec.system} with the ${floortec.pipe}, 45 mm screed cover (${floortec.source}). System constant B = ${FLOORTEC_B} W/(m²·K), fitted to the 20 table points. Rows run the full simulation engine (hydraulic network, enthalpy transport, 16 water cells and 16 screed nodes, Thermal Spaces, energy ledger) against a published number, an EN 1264 relation or a closed-form solution; no row calls the transport to compute its reference. Regenerate with \`npm run validate:underfloor\`.\n`;
let section = '';
for (const r of rows) {
  if (r.section !== section) { section = r.section; md += `\n## ${section}\n\n| Check | Reference | Model | Error | Tolerance | Result | Basis |\n| --- | --- | --- | --- | --- | --- | --- |\n`; }
  md += `| ${r.name} | ${f(r.reference)} | ${f(r.modeled)} | ${f(r.error)} | ${f(r.tolerance)} | ${r.pass ? 'PASS' : 'FAIL'} | ${r.basis} |\n`;
}
md += `\n## Timestep convergence (backward Euler)\n\nOutlet temperature 240 s after 45 °C water at 80 kg/h reaches a floor at 20 °C; reference step 0.05 s gives ${f(reference)} °C.\n\n| Step (s) | Outlet (°C) | Error (K) | Ratio to the next finer step |\n| --- | --- | --- | --- |\n`;
convergence.forEach((c, i) => { md += `| ${c.h} | ${f(c.value)} | ${f(c.error)} | ${i + 1 < convergence.length ? f(c.error / convergence[i + 1].error) : '—'} |\n`; });
md += `\nRatios near 2 confirm first-order convergence. Steady states are exact for any step.\n\n## Heat-pump house, hourly\n\n| Hour | House air (°C) | Floor to house (W) | Floor downwards (W) | Heat-pump output (W) | Energy residual (J) |\n| --- | --- | --- | --- | --- | --- |\n`;
for (const x of house.samples) md += `| ${x.hour} | ${x.room.toFixed(2)} | ${x.floor.toFixed(0)} | ${x.down.toFixed(0)} | ${x.hp.toFixed(0)} | ${x.residual.toExponential(2)} |\n`;
md += `\nThe floor's downward loss goes to the room's floor boundary, which in this example is the ground: a fixed 10 °C (assumed annual mean) behind R_u plus the soil's EN ISO 13370 resistance (docs/GROUND.md). Hourly values are instantaneous at the end of each hour. Six simulated hours took about ${Math.round(house.seconds / 10) * 10} s on this host (not a guarantee).\n`;
const previous = await readFile('validation/underfloor-heating.md', 'utf8').catch(() => '');
// The timing sentence changes on every run; rewrite only when a result changes.
const strip = t => t.replace(/took about \d+ s/, '');
if (strip(previous) !== strip(md)) await writeFile('validation/underfloor-heating.md', md);
console.log(`${rows.filter(r => r.pass).length}/${rows.length} checks passed`);
if (rows.some(r => !r.pass)) process.exit(1);
