// Stratified storage, expansion vessel and safety valve: calibration snapshot against Bosch, Reflex and TRD 721 data
// and analytic references, plus the heat-pump buffer and hot-water scenarios. Regression assertions run in
// src/simulation/storage-pressure.test.ts as part of the release gate; this report documents the numbers.
import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
const bundle = await build({ stdin: { contents: `
  export { Simulation } from './src/simulation/engine'; export { Builder } from './src/simulation/scaling-validation';
  export { starter } from './src/simulation/projects'; export { readProbe } from './src/simulation/measurements';
  export { storageResponse, storageLayers, coilLayers, coilUAFromRating, layerCapacity } from './src/simulation/storage-tank';
  export { vesselPressure, waterAtPressure, valveSetPoints, ATMOSPHERE } from './src/simulation/expansion';
  export { catalog, makeComponent, prop } from './src/simulation/model'; export { applyDerived } from './src/simulation/parameters';
  export { kellDensity } from './src/simulation/water';
`, resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', write: false });
const m = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const CP = 4180, rows = [];
function row(section, name, reference, modeled, tolerance, basis) {
  const error = Math.abs(modeled - reference), pass = Number.isFinite(modeled) && error <= tolerance;
  rows.push({ section, name, reference, modeled, error, tolerance, pass, basis });
  if (!pass) console.error(`FAIL ${name}: ${modeled} vs ${reference}`);
}
const advance = (s, seconds, chunk = 60) => { for (let t = 0; t < seconds - 1e-9; t += chunk) { s.advanceAdaptive(Math.min(chunk, seconds - t)); if (s.error) throw Error(s.error); } };

// 1. Standby loss (ErP, EN 12897: 65 °C store in 20 °C air).
for (const [variant, label, S] of [['standard', 'BH 120-5 1 B', 52], ['wh290', 'Stora WH 290 LP1 B', 67]]) {
  const b = new m.Builder(), tank = b.add('storageTank', { initialTemperature: 65 }, variant); b.p.environment = { ambient: 20 };
  const s = new m.Simulation(b.p); for (let i = 0; i < 60; i++) s.step();
  row('Standby loss', `${label}: loss at 65/20 °C (W)`, S, s.ambientEnergy / s.time, 0.2, 'Bosch ErP standby loss S');
  advance(s, 86400, 900);
  const C = m.storageLayers(tank) * m.layerCapacity(tank), ua = m.prop(tank, 'loss');
  row('Standby loss', `${label}: 24 h free cool-down loss (kWh)`, C * 45 * -Math.expm1(-ua * 86400 / C) / 3.6e6, s.ambientEnergy / 3.6e6, 0.01, 'Lumped decay C·45 K·(1 − e^(−UA·t/C)); Bosch held at 65 °C: 52 W × 24 h = 1.25 kWh (printed 1.2 kWh/d)');
  row('Conservation', `${label}: energy residual after 24 h (J)`, 0, s.energyResidual, 1e-2, 'Ledger closure');
}

// 2. Coil rating: Bosch WH 290 LP1, 11.0 kW at 55 °C flow, 45 °C store, 1,000 l/h; other flows predicted.
const coil = m.makeComponent('storageTank', 0, 0, []); coil.variant = 'wh290';
coil.props = m.applyDerived('storageTank', { ...m.catalog(coil).props, storageVolume: 1e9 });
const n = m.storageLayers(coil), cells = m.coilLayers(coil).length;
for (const [lph, supply] of [[1000, 55], [500, 55], [1500, 55], [1000, 50]]) {
  const rate = lph / 3600, r = m.storageResponse(coil, Array(n).fill(318.15), Array(cells).fill(318.15), [], [], { node: 'in', rate, heat: 0, forward: true }, 318.15, 1e4);
  const last = r.n + [...r.coilCells.keys()].at(-1), out = r.base[last] + r.response.get('in')[last] * (supply + 273.15);
  const ua = m.prop(coil, 'coilUA'), expected = rate * CP * (supply - 45) * (1 - Math.exp(-ua / (rate * CP)));
  row('Coil', `Coil output at ${supply} °C, 45 °C store, ${lph} l/h (W)`, lph === 1000 && supply === 55 ? 11000 : expected, rate * CP * (supply + 273.15 - out), lph === 1000 && supply === 55 ? 11 : 0.002 * expected, lph === 1000 && supply === 55 ? 'Bosch WH 290 LP1 maximum coil output (fitted)' : 'Exponential cell chain against ε = 1 − e^(−UA/ṁc) with the fitted UA (predicted; Bosch gives one point)');
}

// 3. Plug-flow charging against ideal plug flow and a fully mixed tank.
{
  const b = new m.Builder();
  const header = b.add('tank', { capacity: 2000, volume: 1500, surfaceArea: 1, elevation: 3, initialTemperature: 60, loss: 0, vesselHeatCapacity: 0 });
  const sink = b.add('tank', { capacity: 2000, volume: 10, surfaceArea: 1, initialTemperature: 20, loss: 0, vesselHeatCapacity: 0 });
  const tank = b.add('storageTank', { storageVolume: 100, tankHeight: 1, initialTemperature: 20, standbyHeatLoss: 0, p1Height: 95, p2Height: 5, vesselHeatCapacity: 0 });
  const a = b.add('pipe', { length: 20, diameter: 0.012, inventory: false }), d = b.add('pipe', { length: 20, diameter: 0.012, inventory: false });
  b.wire(header, 'fluid', a, 'inlet'); b.wire(a, 'outlet', tank, 'p1'); b.wire(tank, 'p2', d, 'inlet'); b.wire(d, 'outlet', sink, 'fluid');
  const s = new m.Simulation(b.p); s.step(0.1);
  const q = s.multiphysics.hydraulic.readings[`${tank.id}#p1`].flow, tau = 0.1 / q;
  for (const x of [0.5, 0.9, 1.1, 1.5]) {
    advance(s, x * tau - s.time, 10);
    const outlet = s.multiphysics.hydraulic.readings[`${tank.id}#p2`].temperature - 273.15, mixed = 20 + 40 * -Math.expm1(-x);
    rows.push({ section: 'Stratification', name: `Outlet after ${x} displacements (°C): model ${outlet.toFixed(2)}, ideal plug ${x < 1 ? 20 : 60}, fully mixed ${mixed.toFixed(2)}`, reference: x < 1 ? 20 : 60, modeled: outlet, error: Math.abs(outlet - (x < 1 ? 20 : 60)), tolerance: x === 0.5 || x === 1.5 ? 4 : 20, pass: x === 0.5 ? outlet < 23 : x === 1.5 ? outlet > 56 : true, basis: '20 layers, 100 L, 1 m column: numerical and conductive spreading of the thermocline (information for 0.9/1.1)' });
  }
  row('Conservation', 'Charging: energy residual (J)', 0, s.energyResidual, 1e-2, 'Ledger closure incl. header and sink tanks');
}

// 4. Expansion vessel: gas law against Kell expansion of a uniformly heated sealed loop.
{
  const b = new m.Builder();
  const pipes = [0, 1].map(() => b.add('pipe', { length: 12.73, diameter: 0.05, thermalUA: 400, initialTemperature: 10, segments: 4 }));
  b.wire(pipes[0], 'outlet', pipes[1], 'inlet'); b.wire(pipes[1], 'outlet', pipes[0], 'inlet');
  const vessel = b.add('expansionVessel'); b.wire(vessel, 'fluid', pipes[0], 'inlet'); b.p.environment = { ambient: 70 };
  const s = new m.Simulation(b.p); advance(s, 6 * 3600, 600);
  const V = pipes.reduce((a, c) => a + Math.PI * 0.05 ** 2 / 4 * 12.73, 0), T = s.multiphysics.pipeCells[pipes[0].id][0] - 273.15;
  const E = V * (m.kellDensity(10) / m.kellDensity(T) - 1), vn = 0.025, fill = vn * (1 - (150000 + m.ATMOSPHERE) / (180000 + m.ATMOSPHERE));
  row('Expansion vessel', `Expansion of ${(V * 1000).toFixed(1)} L from 10 to ${T.toFixed(2)} °C (L)`, E * 1000, s.multiphysics.vessels[vessel.id].expansion * 1000, 1e-6, 'Kell (1975) densities at fixed mass');
  row('Expansion vessel', 'Reflex N 25 (1.5 bar precharge, 1.8 bar fill): pressure (bar)', ((150000 + m.ATMOSPHERE) * vn / (vn - fill - E) - m.ATMOSPHERE) / 1e5, s.multiphysics.hydraulic.readings[vessel.id].pressure / 1e5, 1e-5, 'Isothermal gas law p₀·V_n/(V_n − V_w)');
  row('Expansion vessel', 'Usable volume between 1.8 and 2.5 bar (L)', 25 * ((150000 + m.ATMOSPHERE) / (180000 + m.ATMOSPHERE) - (150000 + m.ATMOSPHERE) / (250000 + m.ATMOSPHERE)) * 1000 / 1000,
    (m.waterAtPressure(vessel, 250000, 0.05) - m.waterAtPressure(vessel, 180000, 0.05)) * 1000, 1e-9, 'Sizing: end pressure 0.5 bar below the 3 bar valve (EN 12828)');
}

// 5. Safety valve: undersized vessel on a 300 L circuit heated from 20 to 60 °C.
{
  const b = new m.Builder();
  const pipes = [0, 1].map(() => b.add('pipe', { length: 76.4, diameter: 0.05, thermalUA: 400, initialTemperature: 20, segments: 4 }));
  b.wire(pipes[0], 'outlet', pipes[1], 'inlet'); b.wire(pipes[1], 'outlet', pipes[0], 'inlet');
  const vessel = b.add('expansionVessel', { nominalVolume: 8 }), valve = b.add('safetyValve');
  b.wire(vessel, 'fluid', pipes[0], 'inlet'); b.wire(valve, 'inlet', pipes[1], 'inlet'); b.p.environment = { ambient: 60 };
  const s = new m.Simulation(b.p); let peak = 0;
  for (let t = 0; t < 8 * 3600; t += 5) { advance(s, 5, 5); peak = Math.max(peak, s.multiphysics.hydraulic.readings[valve.id].differentialPressure); }
  const v = s.multiphysics.vessels[vessel.id], { set, reseat } = m.valveSetPoints(valve), discharged = s.multiphysics.discharged[valve.id];
  row('Safety valve', 'Peak pressure at the valve (bar), TRD 721 limit set + 0.5 bar', set / 1e5, peak / 1e5, 0.5, 'Must not exceed 3.5 bar; sampled every 5 s');
  row('Safety valve', 'Pressure after heating (bar), between reseat and set', (set + reseat) / 2e5, v.pressure / 1e5, (set - reseat) / 2e5 + 0.01, 'Simmering at the reseat pressure');
  row('Safety valve', 'Discharged water = expansion − growth of the vessel water side (L)', (v.expansion - (v.water - m.waterAtPressure(vessel, 180000, v.system))) * 1000, discharged * 1000, 1e-6, 'Volume balance of the sealed circuit');
  row('Conservation', 'Safety valve: mass residual (kg)', 0, s.multiphysics.massResidual, 1e-9, 'Discharged mass leaves through the ledger');
  row('Conservation', 'Safety valve: energy residual (J)', 0, s.energyResidual, 1e-2, 'Cushion work Π·Q on the discharged water booked');
  rows.push({ section: 'Safety valve', name: `Openings ${s.multiphysics.valveOpenings[valve.id]}, discharged ${(discharged * 1000).toFixed(2)} L, exported ${(s.multiphysics.removedEnergy / 1e6).toFixed(3)} MJ`, reference: 0, modeled: 0, error: 0, tolerance: 0, pass: s.multiphysics.valveOpenings[valve.id] > 0, basis: 'Information' });
}

// 6. Heat pump: defrost with and without a series buffer; hot-water charging COP.
const defrostDip = mode => {
  const p = m.starter(mode), s = new m.Simulation(p), hp = p.components.find(c => c.kind === 'heatPump');
  const flow = p.probes.find(q => q.name === 'Flow temperature');
  let low = Infinity, defrosts = 0, last = 'off';
  for (let t = 0; t < 6 * 3600; t += 30) {
    advance(s, 30, 30);
    const mode = s.multiphysics.heatPumps[hp.id].mode; if (mode === 'defrost' && last !== 'defrost') defrosts++; last = mode;
    if (s.time > 3600 && (mode === 'defrost' || mode === 'drip')) low = Math.min(low, m.readProbe(flow, s));
  }
  return { low, defrosts, residual: s.energyResidual, cop: (s.multiphysics.heatPumps[hp.id].heat - s.multiphysics.heatPumps[hp.id].defrostHeat) / s.multiphysics.heatPumps[hp.id].electricity };
};
const house = defrostDip('heatPumpHouse'), buffered = defrostDip('heatPumpBuffer');
rows.push({ section: 'Heat pump', name: `Lowest flow temperature during defrost (°C): ${house.low.toFixed(2)} without buffer (≈ 60 L circuit), ${buffered.low.toFixed(2)} with the 123 L series buffer`, reference: house.low, modeled: buffered.low, error: buffered.low - house.low, tolerance: 0, pass: buffered.low > house.low, basis: `${house.defrosts} / ${buffered.defrosts} defrosts in 6 h; performance factor ${house.cop.toFixed(2)} / ${buffered.cop.toFixed(2)}. Bosch: defrost energy comes from the buffer and system water. Predicted, unvalidated` });
row('Conservation', 'Heat pump with buffer, 6 h: energy residual (J)', 0, buffered.residual, 0.01, 'Ledger closure');
{
  // Hot-water priority in the house example: the cylinder starts at 38 °C, so the first charge runs at once through VW1.
  const p = m.starter('heatPumpHouse'), s = new m.Simulation(p), hp = p.components.find(c => c.kind === 'heatPump');
  let charged = NaN;
  for (let t = 0; t < 2 * 3600; t += 60) { advance(s, 60, 60); if (Number.isNaN(charged) && !s.multiphysics.heatPumps[hp.id].dhw && s.time > 600) charged = s.time; }
  const st = s.multiphysics.heatPumps[hp.id], dhwFactor = st.dhwHeat / st.dhwElectricity, heating = s.multiphysics.heatPumpView[hp.id].cop;
  rows.push({ section: 'Heat pump', name: `Hot-water priority at 2 °C (cylinder 38 → ${m.prop(hp, 'dhwStop')} °C in ${(charged / 60).toFixed(0)} min, flow target cylinder + ${m.prop(hp, 'dhwDelta')} K): performance factor ${dhwFactor.toFixed(2)} while charging, COP ${heating.toFixed(2)} heating afterwards`, reference: 3.07 - 2.64, modeled: heating - dhwFactor, error: 0, tolerance: 0, pass: dhwFactor < heating - 0.5 && st.dhwCharges >= 1, basis: 'Bosch EN 14511 at maximum output: A7/W35 COP 3.07, A7/W55 COP 2.64; start/stop/Ladedelta from the owners\' documentation example' });
  row('Conservation', 'Hot-water priority, 2 h: energy residual (J)', 0, s.energyResidual, 0.01, 'Ledger closure');
}

const pass = rows.every(r => r.pass);
await writeFile('validation/storage-pressure.json', JSON.stringify(rows, null, 2) + '\n');
const fmt = v => typeof v === 'number' ? (Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(3) : Number(v.toPrecision(6)).toString()) : v;
const md = ['# Storage tank, expansion vessel and safety valve — calibration snapshot', '', 'Generated by `npm run validate:storage` (scripts/check-storage.mjs). Model description: [docs/STORAGE-AND-PRESSURE.md](../docs/STORAGE-AND-PRESSURE.md).', '',
  `${rows.filter(r => r.pass).length}/${rows.length} rows pass.`, '', '| Section | Quantity | Reference | Model | Error | Tolerance | Pass | Basis |', '| --- | --- | ---: | ---: | ---: | ---: | --- | --- |',
  ...rows.map(r => `| ${r.section} | ${r.name} | ${fmt(r.reference)} | ${fmt(r.modeled)} | ${fmt(r.error)} | ${fmt(r.tolerance)} | ${r.pass ? 'yes' : '**no**'} | ${r.basis} |`), ''].join('\n');
await writeFile('validation/storage-pressure.md', md);
console.log(JSON.stringify({ rows: rows.length, passed: rows.filter(r => r.pass).length }));
if (!pass) process.exitCode = 1;
