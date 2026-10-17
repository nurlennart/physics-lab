// Bosch Compress 6800i AW 7 OR-S: calibration and validation report (validation/heat-pump.md, heat-pump.json).
// Published data: src/simulation/heat-pump-data.ts. Model: docs/HEAT-PUMP.md.
import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
const bundle = await build({ stdin: { contents: `
  export { Simulation } from './src/simulation/engine';
  export { starter, parseProject, serializeProject } from './src/simulation/projects';
  export * from './src/simulation/heat-pump';
  export * from './src/simulation/heat-pump-data';
  export * from './src/simulation/heat-pump-bench';
  export { Builder } from './src/simulation/scaling-validation';
  export { makeComponent } from './src/simulation/model';
`, resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', write: false });
const m = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const f = (v, d = 3) => Number.isFinite(v) ? v.toFixed(d) : '—';
const pct = v => `${v >= 0 ? '+' : ''}${(100 * v).toFixed(1)} %`;
const report = { generated: 'npm run validate:heatpump', rating: [], bench: [], scenarios: [] };

// 1. Steady (frost-free) cycle at each published point, the published output imposed.
for (const r of m.ratingPoints) {
  const n = m.speedForOutput(r.output, r.air, r.flow), p = m.heatingPoint(n, r.air, r.flow), cop = m.pointCOP(p);
  report.rating.push({ point: r.label, source: r.source, use: r.fit ? 'fitted' : 'withheld', output: r.output, cop: r.cop, model: cop, error: cop / r.cop - 1, speed: n, evaporating: p.evaporating, condensing: p.condensing });
}
const fitted = report.rating.filter(r => r.use === 'fitted'), rms = Math.sqrt(fitted.reduce((s, r) => s + r.error ** 2, 0) / fitted.length);
if (rms > 0.025 || fitted.some(r => Math.abs(r.error) > 0.06)) throw Error(`Calibration regressed: RMS ${rms}`);

// 2. EN 14511-style bench with the production controller: water outlet held, air at the EN 14511 humidity, fixed
// compressor speed for 72 h; frost growth, normal and intensive defrosts, drip time and coil recovery integrated over
// complete groups of five defrost cycles (four normal, one intensive). Bands: ±8 % nominal points, ±10 % maximum.
const median = a => { const x = [...a].sort((p, q) => p - q); return x.length ? x[Math.floor(x.length / 2)] : NaN; };
function bench(label, air, rh, water, speed, published, band) {
  const c = m.makeComponent('heatPump', 0, 0, []), r = m.defrostBench(c, { air, rh, water, speed, hours: 72 }), g = m.completeCycles(r, 5);
  const steady = m.heatingPoint(speed, air, water), output = g ? g.output : r.heat / r.seconds, cop = g ? g.cop : r.heat / r.electrical;
  const normal = r.defrosts.filter(d => !d.intensive), intensive = r.defrosts.filter(d => d.intensive);
  report.bench.push({ test: label, steadyOutput: steady.condenser, steadyCOP: m.pointCOP(steady), integratedOutput: output, integratedCOP: cop, publishedOutput: published[0], publishedCOP: published[1],
    outputError: output / published[0] - 1, copError: cop / published[1] - 1, band, defrosts: r.defrosts.length, intensive: intensive.length,
    defrostPeriod: r.defrosts.length > 1 ? median(r.defrosts.slice(1).map((d, i) => d.start - r.defrosts[i].start)) : null,
    normalSeconds: median(normal.map(d => d.end - d.start)), normalKWh: median(normal.map(d => d.water / 3.6e6)), intensiveSeconds: median(intensive.map(d => d.end - d.start)), intensiveKWh: median(intensive.map(d => d.water / 3.6e6)) });
  if (Math.abs(output / published[0] - 1) > band || Math.abs(cop / published[1] - 1) > band) throw Error(`${label}: integrated bench outside ${band * 100} %`);
}
bench('A2/W35 maximum', 2, 84, 35, 1, [7090, 2.83], 0.1);
bench('A2/W35 nominal', 2, 84, 35, m.speedForOutput(2870 / 0.95, 2, 35), [2870, 4.06], 0.08);
bench('ErP Tj +2 °C, W42', 2, 84, 42, m.speedForOutput(3500 / 0.95, 2, 42), [3500, 3.49], 0.08);
bench('A7/W35 maximum (no frost)', 7, 87, 35, 1, [7970, 3.07], 0.08);

// 3. Full engine scenarios from the starters: energy ledger, events and timing.
async function scenario(label, mode, hours, environment, check, floorUA) {
  const p = m.parseProject(JSON.parse(m.serializeProject(m.starter(mode))));
  if (environment !== undefined) p.environment = { ambient: environment };
  // A single open underfloor zone (the others closed) emits less than the minimum compressor output.
  if (floorUA !== undefined) p.components = p.components.map(c => c.kind === 'pipe' && c.thermalSpaceId ? { ...c, props: { ...c.props, thermalUA: floorUA } } : c);
  const s = new m.Simulation(p); if (s.error) throw Error(s.error);
  const hp = p.components.find(c => c.kind === 'heatPump'), room = p.thermalSpaces[0].id, t0 = performance.now();
  let maxStartsPerHour = 0, minRun = Infinity, since = 0, previous = 'off';
  const starts = [];
  for (let t = 0; t < hours * 3600; t += 10) {
    s.advanceAdaptive(10); if (s.error) throw Error(`${label}: ${s.error}`);
    const st = s.multiphysics.heatPumps[hp.id];
    if (st.mode === 'heating' && previous === 'off') { starts.push(s.time); since = s.time; maxStartsPerHour = Math.max(maxStartsPerHour, starts.filter(x => s.time - x < 3600).length); }
    if (st.mode === 'off' && previous === 'heating') minRun = Math.min(minRun, s.time - since);
    previous = st.mode;
  }
  const st = s.multiphysics.heatPumps[hp.id];
  const row = { scenario: label, outdoor: p.environment.ambient, hours, wallSeconds: (performance.now() - t0) / 1000, energyResidual: s.energyResidual, supplied: s.suppliedEnergy, heat: st.heat - st.defrostHeat, compressorElectricity: st.electricity, backupHeat: st.backupHeat, spf: (st.heat - st.defrostHeat) / st.electricity, defrosts: st.defrosts, starts: st.startCount, maxStartsPerHour, minRun: Number.isFinite(minRun) ? minRun : null, room: s.spaceTemperatures[room], violations: s.violations.length };
  report.scenarios.push(row);
  if (Math.abs(s.energyResidual) > 1e-3 || s.violations.length || maxStartsPerHour > 6) throw Error(`${label}: ${JSON.stringify(row)}`);
  check?.(row);
}
await scenario('House, 2 °C / 85 % RH (defrost)', 'heatPumpHouse', 6, undefined, r => { if (r.defrosts < 2) throw Error('expected defrosts'); });
await scenario('Cold snap, −15 °C (backup heater)', 'heatPumpCold', 3, undefined, r => { if (!(r.backupHeat > 0)) throw Error('expected backup heat'); });
await scenario('Mild day, 12 °C, one underfloor zone open (60 W/K): low-load cycling', 'heatPumpHouse', 3, 12, r => { if (r.starts < 3 || r.minRun < 300 - 10) throw Error(`expected cycling within the minimum run time: ${JSON.stringify(r)}`); }, 60);

// 4. Timestep: fixed 0.1 s steps against adaptive 30 s macro steps over 10 min of warm-up at 7 °C.
{
  const p = m.parseProject(JSON.parse(m.serializeProject(m.starter('heatPumpHouse')))); p.environment = { ambient: 7 };
  const a = new m.Simulation(p), b = new m.Simulation(p), hp = p.components.find(c => c.kind === 'heatPump');
  for (let i = 0; i < 6000; i++) if (!a.step(0.1)) throw Error(a.error);
  for (let t = 0; t < 600; t += 30) b.advanceAdaptive(30);
  report.timestep = { fixedFlow: a.fluidTemperatureMeasurement(hp.id), adaptiveFlow: b.fluidTemperatureMeasurement(hp.id), fixedHeat: a.multiphysics.heatPumps[hp.id].heat, adaptiveHeat: b.multiphysics.heatPumps[hp.id].heat };
  if (Math.abs(report.timestep.fixedFlow - report.timestep.adaptiveFlow) > 0.05) throw Error('timestep refinement');
}

// 5. Field comparison: 48 h of real Zagreb weather (hourly temperature and humidity, Open-Meteo archive) replayed through
// the coupled engine into a radiator system carrying the measured load, against the measured Bosch 5800i
// (heatpumpmonitor.org #920). Different size (4 kW field unit, 7 kW model); the circulator runs a constant ~16 l/min,
// where the Bosch indoor pump runs ~8 l/min heating and ~16 l/min in defrost; the system water volume is unknown (60 L).
const field = JSON.parse(await readFile('validation/heat-pump-field.json', 'utf8'));
{
  const w0 = field.weather[0], b = new m.Builder(); b.p.environment = { ambient: w0.air };
  const hp = b.add('heatPump', { setpoint: 35, relativeHumidity: w0.rh, backupStages: 0, initialTemperature: 33 });
  const mains = b.add('sourceAC', { voltage: 230, maxCurrent: 40, maxPower: 9200 }), pump = b.add('circulator', { mode: 'constantSpeed', speedSetting: 75 });
  const load = field.window.meanHeatW / (field.window.meanFlowC - 1 - field.period.roomAirC);
  const sink = b.add('radiator', { naturalUA: load, forcedUA: 0, ambient: field.period.roomAirC, ambientMode: 'override' });
  const pipe = b.add('pipe', { diameter: 0.028, length: 60 / (Math.PI * 0.014 ** 2 * 1000), thermalUA: 0, segments: 6, initialTemperature: 33 });
  b.wire(mains, 'a', hp, 'L'); b.wire(mains, 'b', hp, 'N'); b.wire(mains, 'a', pump, 'a'); b.wire(mains, 'b', pump, 'b');
  b.wire(hp, 'outlet', pipe, 'inlet'); b.wire(pipe, 'outlet', sink, 'inlet'); b.wire(sink, 'outlet', pump, 'inlet'); b.wire(pump, 'outlet', hp, 'inlet');
  const s = new m.Simulation(b.p); if (s.error) throw Error(s.error);
  const t0 = performance.now(), events = []; let prev = 'off', ev = null, heat = 0, electricity = 0;
  // One warm-up hour at the first weather point, then 48 hourly weather steps.
  for (let hour = 0; hour <= field.weather.length; hour++) {
    const w = field.weather[Math.max(0, hour - 1)];
    if (!s.refresh({ ...s.project, environment: { ambient: w.air }, components: s.project.components.map(c => c.id === hp.id ? { ...c, props: { ...c.props, relativeHumidity: w.rh } } : c) })) throw Error(s.error);
    for (let k = 0; k < 360; k++) {
      s.advanceAdaptive(10); if (s.error) throw Error(s.error);
      const st = s.multiphysics.heatPumps[hp.id], v = s.multiphysics.heatPumpView[hp.id], water = v.inputs.water, counting = hour > 0;
      if (counting) { heat += v.heatOutput * 10; electricity += v.electrical * 10; }
      if (st.mode === 'defrost' && prev !== 'defrost') ev = { start: s.time, intensive: st.intensive, water: 0, before: water, min: water };
      if (ev) { ev.water += Math.max(0, -v.heatOutput) * 10; ev.min = Math.min(ev.min, water); }
      if (ev && st.mode !== 'defrost') { ev.end = s.time; if (counting) events.push(ev); ev = null; }
      prev = st.mode;
    }
  }
  const normal = events.filter(e => !e.intensive), intensive = events.filter(e => e.intensive), gaps = events.slice(1).map((e, i) => (e.start - events[i].start) / 60);
  const measured = field.window.defrosts, mNormal = measured.filter(d => d.durationMin < 8), mIntensive = measured.filter(d => d.durationMin >= 8);
  report.field = {
    model: { defrosts: events.length, intensive: intensive.length, normalMin: median(normal.map(e => (e.end - e.start) / 60)), normalKWh: median(normal.map(e => e.water / 3.6e6)), normalDip: median(normal.map(e => e.before - e.min)),
      intensiveMin: median(intensive.map(e => (e.end - e.start) / 60)), intensiveKWh: median(intensive.map(e => e.water / 3.6e6)), intensiveDip: median(intensive.map(e => e.before - e.min)), intervalMin: median(gaps), cop: heat / electricity, meanHeatW: heat / (48 * 3600), energyResidual: s.energyResidual, wallSeconds: (performance.now() - t0) / 1000 },
    measured: { defrosts: measured.length, intensive: mIntensive.length, normalMin: median(mNormal.map(d => d.durationMin)), normalKWh: median(mNormal.map(d => d.waterKWh)), normalDip: median(mNormal.map(d => d.dipK)),
      intensiveMin: median(mIntensive.map(d => d.durationMin)), intensiveKWh: median(mIntensive.map(d => d.waterKWh)), intensiveDip: median(mIntensive.map(d => d.dipK)),
      intervalMin: median(measured.slice(1).map((d, i) => (Date.parse(d.start) - Date.parse(measured[i].start)) / 60000)), cop: field.window.cop, meanHeatW: field.window.meanHeatW },
    period: field.period,
  };
  const r = report.field;
  if (Math.abs(r.model.energyResidual) > 1e-3 || s.violations.length) throw Error('field replay: ledger or violations');
  if (r.model.defrosts < 0.5 * r.measured.defrosts || r.model.defrosts > 1.5 * r.measured.defrosts) throw Error(`field replay: ${r.model.defrosts} defrosts vs ${r.measured.defrosts} measured`);
}

let md = `# Heat pump calibration and validation\n\nReference: Bosch Compress 6800i AW 7 OR-S (R290). Sources: [${m.heatPumpSources.outdoor.label}](${m.heatPumpSources.outdoor.url}), [${m.heatPumpSources.erp.label}](${m.heatPumpSources.erp.url}), [${m.heatPumpSources.indoor.label}](${m.heatPumpSources.indoor.url}). Model and assumptions: [HEAT-PUMP.md](../docs/HEAT-PUMP.md). Regenerate with \`npm run validate:heatpump\`.\n\n`;
md += `## 1. Steady cycle at the published points\n\nThe published heat output is imposed (compressor speed solved); the model's frost-free COP is compared with Bosch. Six cycle coefficients were fitted to the nine *fitted* points (RMS ${(100 * rms).toFixed(2)} %). The *withheld* A2/+2 °C points include defrost in the Bosch tests, so the steady model is expected above them.\n\n| Point | Source | Use | Output (W) | Bosch COP | Model COP | Error | Speed | T_e (°C) | T_c (°C) |\n| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n`;
for (const r of report.rating) md += `| ${r.point} | ${r.source} | ${r.use} | ${r.output} | ${f(r.cop, 2)} | ${f(r.model)} | ${pct(r.error)} | ${f(100 * r.speed, 1)} % | ${f(r.evaporating, 1)} | ${f(r.condensing, 1)} |\n`;
md += `\n## 2. EN 14511-style bench with frost and defrost\n\nProduction controller, water outlet held, air at the EN 14511 humidity, fixed compressor speed for 72 h. Frost growth, normal and intensive (every 5th) defrosts, drip time and coil recovery are integrated over complete groups of five defrost cycles. Bands: ±8 % (nominal points), ±10 % (A2 maximum, see HEAT-PUMP.md). Holding the water fixed makes defrosts shorter than in a real system; the field comparison (section 5) uses the coupled engine.\n\n| Test | Steady output (W) | Steady COP | Integrated output (W) | Integrated COP | Bosch output (W) | Bosch COP | Output error | COP error | Defrosts (intensive) | Period (min) | Normal: s / kWh | Intensive: s / kWh |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n`;
for (const r of report.bench) md += `| ${r.test} | ${f(r.steadyOutput, 0)} | ${f(r.steadyCOP)} | ${f(r.integratedOutput, 0)} | ${f(r.integratedCOP)} | ${r.publishedOutput} | ${r.publishedCOP} | ${pct(r.outputError)} | ${pct(r.copError)} | ${r.defrosts} (${r.intensive}) | ${r.defrostPeriod ? f(r.defrostPeriod / 60, 0) : '—'} | ${f(r.normalSeconds, 0)} / ${f(r.normalKWh)} | ${f(r.intensiveSeconds, 0)} / ${f(r.intensiveKWh)} |\n`;
md += `\n## 3. Coupled engine scenarios (starters)\n\n120 m² single-zone house, underfloor loop, weather-compensated flow target; fixed 10 s macro steps of the adaptive integrator. The energy residual closes electrical input, outdoor-air heat, meltwater, coil storage, water/room storage and envelope losses.\n\n| Scenario | Outdoor (°C) | Hours | Net heat (kWh) | Outdoor-unit electricity (kWh) | Backup heat (kWh) | SPF | Defrosts | Starts | Max starts / h | Shortest run (s) | House air (°C) | Energy residual (J) | Wall time (s) |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n`;
for (const r of report.scenarios) md += `| ${r.scenario} | ${r.outdoor} | ${r.hours} | ${f(r.heat / 3.6e6, 2)} | ${f(r.compressorElectricity / 3.6e6, 2)} | ${f(r.backupHeat / 3.6e6, 2)} | ${f(r.spf, 2)} | ${r.defrosts} | ${r.starts} | ${r.maxStartsPerHour} | ${r.minRun === null ? '—' : f(r.minRun, 0)} | ${f(r.room, 2)} | ${r.energyResidual.toExponential(2)} | ${f(r.wallSeconds, 1)} |\n`;
md += `\n## 4. Timestep\n\nFixed 0.1 s steps against adaptive 30 s macro steps (0.5 s heat-pump substeps), 10 min warm-up at 7 °C: flow temperature ${f(report.timestep.fixedFlow, 4)} vs ${f(report.timestep.adaptiveFlow, 4)} °C, compressor heat ${f(report.timestep.fixedHeat / 1e6, 4)} vs ${f(report.timestep.adaptiveHeat / 1e6, 4)} MJ.\n\n\n## 5. Field comparison: measured Bosch Compress 5800i (4 kW), Zagreb\n\nSource: ${field.source.system}; ${field.source.api}. Weather: ${field.source.weather}. Processing: ${field.source.processing}\n\n48 h (${field.window.from} – ${field.window.to}, outdoor ${Math.min(...field.weather.map(w => w.air))} … ${Math.max(...field.weather.map(w => w.air))} °C, RH median ${median(field.weather.map(w => w.rh))} %) replayed through the coupled engine with the real hourly weather, a radiator load sized to the measured mean heat at the measured flow temperature, a constant ~16 l/min circulator and an assumed 60 L of system water. The field unit is the 4 kW size of the same R290 outdoor-unit family; per-defrost duration and energy (same housing and coil family, same firmware) are compared directly, intervals and dips depend on load, humidity and installation, the COP on unit size, metering (the field meters include the indoor pumps) and installation.\n\n| Quantity | Model (7 kW, engine) | Measured window | Measured 14-day median (IQR) | Class |\n| --- | ---: | ---: | ---: | --- |\n| Defrosts in 48 h (intensive) | ${report.field.model.defrosts} (${report.field.model.intensive}) | ${report.field.measured.defrosts} (${report.field.measured.intensive}) | — | calibrated (frost trigger) |\n| Interval between defrosts (min) | ${f(report.field.model.intervalMin, 0)} | ${f(report.field.measured.intervalMin, 0)} | ${field.period.intervalMin.median} (${field.period.intervalMin.iqr.join('–')}) | calibrated |\n| Normal defrost duration (min) | ${f(report.field.model.normalMin, 2)} | ${f(report.field.measured.normalMin, 2)} | ${f(field.period.normal.durationMin.median, 2)} (${field.period.normal.durationMin.iqr.join('–')}) | calibrated (end temperature) |\n| Normal defrost heat from the water (kWh) | ${f(report.field.model.normalKWh)} | ${f(report.field.measured.normalKWh)} | ${f(field.period.normal.waterKWh.medianRecomputed)} (${field.period.normal.waterKWh.iqr.join('–')}) | calibrated (coil capacity) |\n| Intensive defrost duration (min) | ${f(report.field.model.intensiveMin, 2)} | ${f(report.field.measured.intensiveMin, 2)} | ${f(field.period.intensive.durationMin.median, 2)} (${field.period.intensive.durationMin.iqr.join('–')}) | firmware minimum (documented 9–16 min) |\n| Intensive defrost heat from the water (kWh) | ${f(report.field.model.intensiveKWh)} | ${f(report.field.measured.intensiveKWh)} | ${f(field.period.intensive.waterKWh.medianRecomputed)} (${field.period.intensive.waterKWh.iqr.join('–')}) | predicted (not fitted) |\n| Flow dip, normal / intensive (K) | ${f(report.field.model.normalDip, 1)} / ${f(report.field.model.intensiveDip, 1)} | ${f(report.field.measured.normalDip, 1)} / ${f(report.field.measured.intensiveDip, 1)} | ${f(field.period.normal.dipK, 1)} / ${f(field.period.intensive.dipK, 1)} | installation-dependent, unvalidated |\n| COP over 48 h incl. defrost | ${f(report.field.model.cop, 2)} | ${f(report.field.measured.cop, 2)} | — | extrapolated (lab-calibrated cycle) |\n| Mean heat (W) | ${f(report.field.model.meanHeatW, 0)} | ${f(report.field.measured.meanHeatW, 0)} | — | imposed (load) |\n\nEnergy residual of the replay: ${report.field.model.energyResidual.toExponential(2)} J (wall time ${f(report.field.model.wallSeconds, 0)} s).\n\nWall times are measured on the machine that ran this report, not a performance guarantee.\n`;
const json = JSON.stringify(report, (k, v) => typeof v === 'number' ? Number(v.toPrecision(8)) : v, 2) + '\n';
const strip = text => text.replace(/\| [0-9.]+ \|\n/g, '|\n');
const previous = await readFile('validation/heat-pump.md', 'utf8').catch(() => '');
// Wall times differ between runs; rewrite only when a physical result changes.
if (strip(previous).replace(/Wall time.*\n/, '') !== strip(md).replace(/Wall time.*\n/, '')) { await writeFile('validation/heat-pump.md', md); await writeFile('validation/heat-pump.json', json); }
console.log(md);
