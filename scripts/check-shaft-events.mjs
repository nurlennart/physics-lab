import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
const bundle = await build({ stdin: { contents: `export { Simulation } from './src/simulation/engine'; export { mechanicalStarter } from './src/simulation/spatial-projects';`, resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', write: false });
await writeFile('/tmp/physics-shaft-events.mjs', bundle.outputFiles[0].text);
const { Simulation, mechanicalStarter } = await import(`/tmp/physics-shaft-events.mjs?${Date.now()}`);
const run = (s, t) => { for(let i=0;i<Math.round(t*60);i++) if(!s.step())throw Error(s.error); };
const reports=[];
{
 const p=mechanicalStarter('lift'), m=p.components.find(c=>c.kind==='motor'), b=p.components.find(c=>c.name==='Lift load'), rotor=p.components.find(c=>c.name==='Driven rotor');
 const s=new Simulation(p); run(s,3); const powered=structuredClone(s.spatial.readings); s.injectFault(m.id,'powerLoss'); run(s,3);
 reports.push({name:'Gravity-driven rack after electrical failure', time:s.time, beforeY:powered[b.id].y, afterY:s.spatial.readings[b.id].y, beforeOmega:powered[rotor.id].omega, afterOmega:s.spatial.readings[rotor.id].omega, current:s.multiphysics.motors[m.id].current, residualJ:s.energyResidual, error:s.error, violations:s.violations, pass:s.multiphysics.motors[m.id].current===0 && s.spatial.readings[rotor.id].omega<0 && Math.abs(s.energyResidual)<0.1});
}
{
 const p=mechanicalStarter('rotor'), m=p.components.find(c=>c.kind==='motor'), rotor=p.components.find(c=>c.name==='Driven rotor');
 m.props.speedControl=false; rotor.spatial.omega=350;
 const s=new Simulation(p), initial=s.spatial.energy; run(s,0.2);
 reports.push({name:'Overspeed motor regenerative braking', time:s.time, initialMechanicalJ:initial, finalMechanicalJ:s.spatial.energy, finalOmega:s.spatial.readings[rotor.id].omega, current:s.multiphysics.motors[m.id].current, signedElectricalSupplyJ:s.suppliedEnergy, thermalAndAmbientJ:s.storedEnergy+s.ambientEnergy, brakeHeatJ:s.spatial.dampingLoss, residualJ:s.energyResidual, error:s.error, violations:s.violations, pass:s.spatial.readings[rotor.id].omega<350 && s.suppliedEnergy<0 && Math.abs(s.energyResidual)<0.001});
}
console.log(JSON.stringify(reports,null,2));
await writeFile('validation/phase3a-shaft-events.json',JSON.stringify({executedAt:new Date().toISOString(),reports},null,2)+'\n');
if(reports.some(r=>!r.pass||r.error||r.violations.length))process.exitCode=1;
