import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
const bundle = await build({ stdin: { contents: `export { makeComponent, uid } from './src/simulation/model'; export { defaultWorld, makeSpatial } from './src/simulation/spatial-model';`, resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', write: false });
await writeFile('/tmp/physics-browser-bench-model.mjs', bundle.outputFiles[0].text);
const { makeComponent, uid, makeSpatial, defaultWorld } = await import(`/tmp/physics-browser-bench-model.mjs?${Date.now()}`);
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.addInitScript(() => { window.labBenchmarkTools = {}; Object.defineProperty(document, 'modelContext', { value: { registerTool(t) { window.labBenchmarkTools[t.name] = t; } } }); });
const baseURL = process.env.PHYSICS_LAB_URL ?? 'http://localhost:8080', reports = [];
for (const count of [10,50,100]) {
  await page.goto(baseURL);
  const p = { version: 4, id: uid(), name: `${count} body browser benchmark`, components: [], connections: [], world: defaultWorld(), probes: [], assemblies: [] };
  for (let i=0;i<count;i++) { const c=makeComponent('rigidBody',0,0,p.components); c.spatial=i===0 ? { ...makeSpatial('floor',5,-0.25), width:20, height:0.5 } : { ...makeSpatial('circle',(i%12)*0.7,1+Math.floor(i/12)*0.7), width:0.5,height:0.5,mass:1 }; p.components.push(c); }
  const loadStart=performance.now();
  await page.locator('input[type=file]').setInputFiles({ name:'benchmark.physics.json', mimeType:'application/json', buffer:Buffer.from(JSON.stringify(p)) });
  await page.getByLabel('Physical world canvas').waitFor();
  const loadAndRenderMs=performance.now()-loadStart;
  await page.evaluate(() => { window.benchmarkFrames=[]; window.benchmarkFrameStart=performance.now(); window.benchmarkFrameRunning=true; function frame(t) { window.benchmarkFrames.push(t); if(window.benchmarkFrameRunning) requestAnimationFrame(frame); } requestAnimationFrame(frame); });
  await page.getByRole('button',{name:'Run',exact:true}).click();
  await page.waitForTimeout(3000);
  const clickStart=performance.now(); await page.getByRole('button',{name:'Pause',exact:true}).click(); const pauseLatencyMs=performance.now()-clickStart;
  const render=await page.evaluate(() => { window.benchmarkFrameRunning=false; const f=window.benchmarkFrames; const dt=f.slice(1).map((v,i)=>v-f[i]); return { wallSeconds:(performance.now()-window.benchmarkFrameStart)/1000, frameCount:f.length, meanFrameIntervalMs:dt.reduce((a,b)=>a+b,0)/dt.length, maxFrameIntervalMs:Math.max(...dt) }; });
  const state=await page.evaluate(()=>window.labBenchmarkTools.read_lab_measurements.execute({}));
  const saveStart=performance.now(), download=page.waitForEvent('download'); await page.getByRole('button',{name:'Save project',exact:true}).click(); await download; const saveDownloadMs=performance.now()-saveStart;
  reports.push({ bodyCount:count, loadAndRenderMs, saveDownloadMs, pauseLatencyMs, ...render, simulatedSeconds:state.time, solverLastStepMs:Number.parseFloat(await page.locator('.solver-status strong').last().textContent()), error:state.error, warningCount:Number.parseInt(await page.locator('.warning-count').textContent(),10), spatialResidualJ:state.spatial.residual, note:'Three-second live production browser run; includes SVG/React/render/solver and automation overhead. Hardware/shared load specific; not a guaranteed FPS target.' });
  console.log(JSON.stringify(reports.at(-1)));
}
await browser.close();
await writeFile('validation/browser-benchmark.json',JSON.stringify({executedAt:new Date().toISOString(),baseURL,reports},null,2)+'\n');
if(reports.some(r=>r.error))process.exitCode=1;
