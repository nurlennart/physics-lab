// Bosch Compress 6800i AW 7 OR-S: calibration and validation report (validation/heat-pump.md, heat-pump.json).
// Published data: src/simulation/heat-pump-data.ts. Model: docs/HEAT-PUMP.md.
import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
const bundle = await build({ stdin: { contents: `
  export { Simulation } from './src/simulation/engine';
  export { starter, parseProject, serializeProject } from './src/simulation/projects';
  export * from './src/simulation/heat-pump';
  export * from './src/simulation/heat-pump-data';
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

// 2. EN 14511-style bench at A2/W35 (84 % RH), water outlet held, compressor speed fixed: frost and defrost cycles integrated.
function bench(label, air, rh, water, speed, published, wholeRun) {
  const c = m.makeComponent('heatPump', 0, 0, []); c.props.relativeHumidity = rh;
  const st = m.newHeatPump(c, air); Object.assign(st, { mode: 'heating', startedAt: -1e9, restartAt: 0 });
  const x = { water, air, flow: 4e-4, voltage: 230, powered: true, backupVoltage: 0, condensing: 30, evaporating: 0 };
  let heat = 0, electricity = 0, cycles = 0, start = 0, t = 0, defrostTime = 0;
  for (; t < 6 * 3600; t++) {
    if (st.mode === 'heating' && st.frost >= c.props.frostTrigger && t - st.lastDefrostEnd >= c.props.minDefrostInterval) { st.mode = 'defrost'; st.defrostStart = t; }
    if (st.mode === 'defrost' && (st.frost <= 1e-9 && st.coilTemperature >= c.props.defrostEndTemperature || t - st.defrostStart >= c.props.maxDefrostTime)) {
      st.mode = 'drip'; st.dripUntil = t + c.props.dripTime; st.lastDefrostEnd = t; defrostTime += t - st.defrostStart;
      if (++cycles === 1 && !wholeRun) { start = t; heat = 0; electricity = 0; }
    }
    if (st.mode === 'drip' && t >= st.dripUntil) st.mode = 'heating';
    st.command = st.mode === 'heating' ? speed : st.mode === 'defrost' ? c.props.defrostSpeed / 100 : 0;
    if (st.mode === 'heating') st.speed = speed;
    const plan = m.planHeatPump(c, st, x, 1);
    m.advanceHeatPump(c, st, plan, x, 1, plan.electrical, 0);
    heat += plan.condenser; electricity += plan.electrical;
  }
  const steady = m.heatingPoint(speed, air, water), output = heat / (t - start), cop = heat / electricity;
  report.bench.push({ test: label, steadyOutput: steady.condenser, steadyCOP: m.pointCOP(steady), integratedOutput: output, integratedCOP: cop, publishedOutput: published[0], publishedCOP: published[1], outputError: output / published[0] - 1, copError: cop / published[1] - 1, defrosts: cycles, defrostPeriod: cycles > 1 && !wholeRun ? (t - start) / (cycles - 1) : null, meanDefrost: cycles ? defrostTime / cycles : null });
  if (Math.abs(output / published[0] - 1) > 0.08 || Math.abs(cop / published[1] - 1) > 0.08) throw Error(`${label}: integrated bench outside 8 %`);
}
bench('A2/W35 maximum', 2, 84, 35, 1, [7090, 2.83], false);
bench('A2/W35 nominal', 2, 84, 35, m.speedForOutput(2870 / 0.95, 2, 35), [2870, 4.06], true);
bench('ErP Tj +2 °C, W42', 2, 84, 42, m.speedForOutput(3500 / 0.95, 2, 42), [3500, 3.49], true);
bench('A7/W35 maximum (no frost)', 7, 87, 35, 1, [7970, 3.07], true);

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
await scenario('House, 2 °C / 85 % RH (defrost)', 'heatPumpHouse', 3, undefined, r => { if (r.defrosts < 2) throw Error('expected defrosts'); });
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

let md = `# Heat pump calibration and validation\n\nReference: Bosch Compress 6800i AW 7 OR-S (R290). Sources: [${m.heatPumpSources.outdoor.label}](${m.heatPumpSources.outdoor.url}), [${m.heatPumpSources.erp.label}](${m.heatPumpSources.erp.url}), [${m.heatPumpSources.indoor.label}](${m.heatPumpSources.indoor.url}). Model and assumptions: [HEAT-PUMP.md](../docs/HEAT-PUMP.md). Regenerate with \`npm run validate:heatpump\`.\n\n`;
md += `## 1. Steady cycle at the published points\n\nThe published heat output is imposed (compressor speed solved); the model's frost-free COP is compared with Bosch. Six cycle coefficients were fitted to the nine *fitted* points (RMS ${(100 * rms).toFixed(2)} %). The *withheld* A2/+2 °C points include defrost in the Bosch tests, so the steady model is expected above them.\n\n| Point | Source | Use | Output (W) | Bosch COP | Model COP | Error | Speed | T_e (°C) | T_c (°C) |\n| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n`;
for (const r of report.rating) md += `| ${r.point} | ${r.source} | ${r.use} | ${r.output} | ${f(r.cop, 2)} | ${f(r.model)} | ${pct(r.error)} | ${f(100 * r.speed, 1)} % | ${f(r.evaporating, 1)} | ${f(r.condensing, 1)} |\n`;
md += `\n## 2. EN 14511-style bench with frost and defrost\n\nWater outlet held, air at the EN 14511 humidity, fixed compressor speed for 6 h; the model's frost growth, reverse-cycle defrost, drip time and coil recovery are integrated. Maximum points are averaged over complete cycles after the first defrost; slow-frosting part-load points over the whole run. Pass band ±8 %.\n\n| Test | Steady output (W) | Steady COP | Integrated output (W) | Integrated COP | Bosch output (W) | Bosch COP | Output error | COP error | Defrosts | Period (min) | Mean defrost (s) |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n`;
for (const r of report.bench) md += `| ${r.test} | ${f(r.steadyOutput, 0)} | ${f(r.steadyCOP)} | ${f(r.integratedOutput, 0)} | ${f(r.integratedCOP)} | ${r.publishedOutput} | ${r.publishedCOP} | ${pct(r.outputError)} | ${pct(r.copError)} | ${r.defrosts} | ${r.defrostPeriod ? f(r.defrostPeriod / 60, 1) : '—'} | ${r.meanDefrost ? f(r.meanDefrost, 0) : '—'} |\n`;
md += `\n## 3. Coupled engine scenarios (starters)\n\n120 m² single-zone house, underfloor loop, weather-compensated flow target; fixed 10 s macro steps of the adaptive integrator. The energy residual closes electrical input, outdoor-air heat, meltwater, coil storage, water/room storage and envelope losses.\n\n| Scenario | Outdoor (°C) | Hours | Net heat (kWh) | Outdoor-unit electricity (kWh) | Backup heat (kWh) | SPF | Defrosts | Starts | Max starts / h | Shortest run (s) | House air (°C) | Energy residual (J) | Wall time (s) |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n`;
for (const r of report.scenarios) md += `| ${r.scenario} | ${r.outdoor} | ${r.hours} | ${f(r.heat / 3.6e6, 2)} | ${f(r.compressorElectricity / 3.6e6, 2)} | ${f(r.backupHeat / 3.6e6, 2)} | ${f(r.spf, 2)} | ${r.defrosts} | ${r.starts} | ${r.maxStartsPerHour} | ${r.minRun === null ? '—' : f(r.minRun, 0)} | ${f(r.room, 2)} | ${r.energyResidual.toExponential(2)} | ${f(r.wallSeconds, 1)} |\n`;
md += `\n## 4. Timestep\n\nFixed 0.1 s steps against adaptive 30 s macro steps (0.5 s heat-pump substeps), 10 min warm-up at 7 °C: flow temperature ${f(report.timestep.fixedFlow, 4)} vs ${f(report.timestep.adaptiveFlow, 4)} °C, compressor heat ${f(report.timestep.fixedHeat / 1e6, 4)} vs ${f(report.timestep.adaptiveHeat / 1e6, 4)} MJ.\n\nWall times are measured on the machine that ran this report, not a performance guarantee.\n`;
const json = JSON.stringify(report, (k, v) => typeof v === 'number' ? Number(v.toPrecision(8)) : v, 2) + '\n';
const strip = text => text.replace(/\| [0-9.]+ \|\n/g, '|\n');
const previous = await readFile('validation/heat-pump.md', 'utf8').catch(() => '');
// Wall times differ between runs; rewrite only when a physical result changes.
if (strip(previous).replace(/Wall time.*\n/, '') !== strip(md).replace(/Wall time.*\n/, '')) { await writeFile('validation/heat-pump.md', md); await writeFile('validation/heat-pump.json', json); }
console.log(md);
