// Independent analytical circuits, published bounds and conservation campaigns. No reference-score rewrites.
import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
const bundle=await build({stdin:{contents:`export { Simulation } from './src/simulation/engine';export { hybridStarter } from './src/simulation/hybrid-projects';export { hybridProvenance } from './src/simulation/hybrid-provenance';export { Builder } from './src/simulation/scaling-validation';export { batteryEnergy } from './src/simulation/devices';export { solveElectrical } from './src/simulation/electrical';`,resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
const {Simulation,hybridStarter,hybridProvenance,Builder,batteryEnergy,solveElectrical}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const rows=[],ledgers=[];
function check(category,name,expected,measured,tolerance,unit=''){const error=Math.abs(expected-measured);rows.push({category,name,expected,measured,absoluteError:error,relativeError:expected?error/Math.abs(expected):null,tolerance,unit,pass:Number.isFinite(measured)&&error<=tolerance});}
function run(s,t,h=.05){if(s.error)throw Error(s.error);for(let k=0;k<Math.round(t/h);k++)if(!s.step(h))throw Error(`${s.time}: ${s.error}`);}
function refresh(s,id,props){if(!s.refresh({...s.project,components:s.project.components.map(c=>c.id===id?{...c,props:{...c.props,...props}}:c)}))throw Error(s.error);}
function withoutPV(){const p=hybridStarter('gridBackup'),ids=new Set(p.components.filter(c=>['solarPanel','mpptController'].includes(c.kind)).map(c=>c.id));p.components=p.components.filter(c=>!ids.has(c.id));p.connections=p.connections.filter(w=>!ids.has(w.from.component)&&!ids.has(w.to.component));p.probes=p.probes.filter(q=>!ids.has(q.component));return p;}
// An analytical 1 kW resistive circuit with 300 W current injection: the source must supply 700 W.
{
 const b=new Builder(),grid=b.add('sourceAC',{voltage:230}),injection=b.add('sourceAC'),load=b.add('resistor',{resistance:52.9});b.wire(grid,'a',injection,'a');b.wire(grid,'b',injection,'b');b.wire(grid,'a',load,'a');b.wire(grid,'b',load,'b');

 const r=solveElectrical(b.p,{}, {acInjections:{[injection.id]:[-300/230,0]}});check('Independent analytical network','1 kW load minus 300 W injection',700,-r.readings[grid.id].power,1e-8,'W');
}
for(const direction of ['invert','charge']){
 const p=withoutPV(),hybrid=p.components.find(c=>c.kind==='hybridInverter'),meter=p.components.find(c=>c.kind==='gridMeter');Object.assign(hybrid.props,{energyMode:'power',activeSetpoint:direction==='invert'?1200:-1000,allowExport:true});const s=new Simulation(p);run(s,.3);const x=s.electrical.readings[hybrid.id].hybrid;
 check('Analytical command',`${direction} AC conversion`,direction==='invert'?1200:-1000,x.acPower,1e-6,'W');
 if(direction==='invert')check('Published fitting constraint','95% maximum efficiency at assumed half-load peak',.95,x.acPower/x.dcPower,1e-9,'1');
 else check('Assumed loss law','94% charger conversion plus 11 W electronics',-929,x.dcPower,1e-6,'W');
 check('Device conservation',`${direction} converter balance`,0,x.dcPower-x.acPower-x.conversionLoss,1e-7,'W');
 check('Device conservation',`${direction} transfer boundary`,0,x.acInputPower+x.acPower-x.outputPower-x.transferLoss,1e-7,'W');
 check('Global conservation',`${direction} short-run residual`,0,s.energyResidual,1e-3,'J');
 check('Measured boundary',`${direction} meter/source consistency`,0,s.electrical.readings[meter.id].hybrid.gridPower+s.electrical.readings[p.components.find(c=>c.kind==='sourceAC').id].power,1e-7,'W');
}
for(const mode of ['gridSolar','hybridStorage','zeroExport','gridBackup','multipleSolar']){
 const p=hybridStarter(mode),s=new Simulation(p);run(s,.3);check('Example',`${mode} solved and conserved`,0,s.energyResidual,1e-3,'J');
 const hybrid=p.components.find(c=>c.kind==='hybridInverter'||c.kind==='gridInverter');const x=s.electrical.readings[hybrid.id].hybrid;
 check('Device conservation',`${mode} DC/AC balance`,0,x.dcPower-x.acPower-x.conversionLoss,1e-7,'W');
 if(mode==='zeroExport')check('Control',`zero-export measured at PCC`,0,s.electrical.readings[p.components.find(c=>c.kind==='gridMeter').id].hybrid.gridPower,1e-5,'W');
}
// One hour spans the SOC reserve transition: no fast PV tracker forces switching-frequency steps.
{
 const p=withoutPV(),battery=p.components.find(c=>c.kind==='lfpBattery'),meter=p.components.find(c=>c.kind==='gridMeter'),hybrid=p.components.find(c=>c.kind==='hybridInverter'),initialSOC=25; battery.props.initialSOC=initialSOC; const s=new Simulation(p),initial=batteryEnergy(battery,initialSOC/100);
 if(!s.advanceAdaptive(3600))throw Error(s.error);
 const imported=s.devices.hybrid[meter.id].imported,exported=s.devices.hybrid[meter.id].exported,chemical=batteryEnergy(battery,s.devices.batteries[battery.id])-initial;
 check('Long-duration conservation','3600 s absolute global residual',0,s.energyResidual,.01,'J');check('Long-duration conservation','3600 s relative global residual',0,Math.abs(s.energyResidual)/Math.max(1,imported,Math.abs(chemical)),1e-10,'1');
 check('SOC policy','reserve is not depleted while grid-connected',1,Number(s.devices.batteries[battery.id]>=+hybrid.props.reserveSOC/100-1e-10),0,'boolean');
 ledgers.push({scenario:'3600 s grid storage',duration:s.time,gridImported:imported,gridExported:exported,chemicalChange:chemical,converterLoss:s.devices.hybrid[hybrid.id].converterLossEnergy,transferLoss:s.devices.hybrid[hybrid.id].transferLossEnergy,batteryHeat:s.devices.batteryHeat[battery.id],loadElectrical:p.components.filter(c=>c.kind==='resistor').reduce((n,c)=>n+(s.componentEnergy[c.id]??0),0),meterLoss:s.componentEnergy[meter.id]??0,globalStoredChange:s.storedEnergy,ambientHeat:s.ambientEnergy,netExternal:s.suppliedEnergy,absoluteResidual:s.energyResidual,relativeResidual:Math.abs(s.energyResidual)/Math.max(1,imported,Math.abs(chemical)),units:'J'});
}
// Solar, cloud, load removal, blackout, and grid return use real project edits and accepted states.
{
 const p=hybridStarter('hybridStorage'),s=new Simulation(p),grid=p.components.find(c=>c.kind==='sourceAC'),hybrid=p.components.find(c=>c.kind==='hybridInverter'),meter=p.components.find(c=>c.kind==='gridMeter');run(s,.3);
 for(const weather of [1000,200,0]){for(const pv of s.project.components.filter(c=>c.kind==='solarPanel'))refresh(s,pv.id,{irradiance:weather});if(!s.advanceAdaptive(20))throw Error(s.error);}
 refresh(s,grid.id,{enabled:false});if(!s.advanceAdaptive(20))throw Error(s.error);check('Isolation','disabled utility receives no power',0,s.electrical.readings[grid.id].power,1e-9,'W');
 refresh(s,grid.id,{enabled:true,phase:90});if(!s.advanceAdaptive(20))throw Error(s.error);check('Recovery','qualified grid reconnects',1,Number(s.electrical.readings[hybrid.id].hybrid.connected),0,'boolean');
 check('Conservation','100 s weather/outage/global residual',0,s.energyResidual,.01,'J');
 const panels=p.components.filter(c=>c.kind==='solarPanel'),controllers=p.components.filter(c=>c.kind==='mpptController'),battery=p.components.find(c=>c.kind==='lfpBattery');
 ledgers.push({scenario:'weather and grid transitions',duration:s.time,incident:panels.reduce((n,c)=>n+s.devices.solar[c.id].generated,0),extractedPV:panels.reduce((n,c)=>n+s.devices.solar[c.id].output,0),rejectedSolar:panels.reduce((n,c)=>n+s.devices.solar[c.id].lost,0),mpptLoss:controllers.reduce((n,c)=>n+s.devices.solar[c.id].lost,0),gridImported:s.devices.hybrid[meter.id].imported,gridExported:s.devices.hybrid[meter.id].exported,converterLoss:s.devices.hybrid[hybrid.id].converterLossEnergy,transferLoss:s.devices.hybrid[hybrid.id].transferLossEnergy,batteryHeat:s.devices.batteryHeat[battery.id],chemicalChange:batteryEnergy(battery,s.devices.batteries[battery.id])-batteryEnergy(battery,+battery.props.initialSOC/100),loadElectrical:p.components.filter(c=>c.kind==='resistor').reduce((n,c)=>n+(s.componentEnergy[c.id]??0),0),meterLoss:s.componentEnergy[meter.id]??0,globalStoredChange:s.storedEnergy,ambientHeat:s.ambientEnergy,netExternal:s.suppliedEnergy,absoluteResidual:s.energyResidual,relativeResidual:Math.abs(s.energyResidual)/Math.max(1,Math.abs(s.suppliedEnergy)),units:'J'});
}
for(const ledger of ledgers) {
 const input=(ledger.incident??0)+ledger.gridImported-ledger.gridExported;
 const used=(ledger.rejectedSolar??0)+(ledger.mpptLoss??0)+ledger.converterLoss+ledger.transferLoss+ledger.batteryHeat+ledger.chemicalChange+ledger.loadElectrical+ledger.meterLoss;
 ledger.deviceChainResidual=input-used;ledger.deviceChainRelative=Math.abs(input-used)/Math.max(1,Math.abs(input),Math.abs(used));
 check('Device-chain conservation',`${ledger.scenario} absolute residual`,0,ledger.deviceChainResidual,.01,'J');
 check('Device-chain conservation',`${ledger.scenario} relative residual`,0,ledger.deviceChainRelative,1e-10,'1');
}
const report={model:'Grid-connected hybrid energy',reference:hybridProvenance,rows,ledgers,pass:rows.every(r=>r.pass),limitations:'Published efficiency is a fitting bound, not a measured held-out curve. Charger efficiency, peak-load position, surge duration, phase slew and qualification delay are assumptions. Grid validity is reference detection in an RMS model, not a certified anti-islanding test. Component tests separately cover faults, reactive load, rollback, serialization and timestep refinement.'};
async function writeChanged(path,text){let old;try{old=await readFile(path,'utf8');}catch{}if(old!==text)await writeFile(path,text);}
await writeChanged('validation/hybrid-energy.json',JSON.stringify(report,null,2)+'\n');
await writeChanged('validation/hybrid-energy.md',`# Hybrid energy validation\n\nGenerated by \`npm run validate:hybrid\`. Equations, audit findings and sources: [HYBRID-ENERGY.md](../docs/HYBRID-ENERGY.md).\n\n| Category | Check | Expected | Measured | Absolute error | Tolerance | Pass |\n| --- | --- | ---: | ---: | ---: | ---: | --- |\n${rows.map(r=>`| ${r.category} | ${r.name} (${r.unit}) | ${r.expected.toPrecision(9)} | ${r.measured.toPrecision(9)} | ${r.absoluteError.toPrecision(4)} | ${r.tolerance.toPrecision(4)} | ${r.pass?'yes':'NO'} |`).join('\n')}\n\n## Energy ledgers\n\n\`\`\`json\n${JSON.stringify(ledgers,null,2)}\n\`\`\`\n\n${report.limitations}\n\nReference: [${hybridProvenance.reference}](${hybridProvenance.datasheet}).\n`);
for(const r of rows.filter(r=>!r.pass))console.error(r);console.log(`Hybrid validation: ${rows.filter(r=>r.pass).length}/${rows.length} passed.`);if(!report.pass)process.exitCode=1;
