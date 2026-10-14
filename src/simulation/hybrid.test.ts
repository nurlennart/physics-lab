import { describe,it,expect } from 'vitest';
import { Builder } from './scaling-validation';
import { Simulation } from './engine';
import { solveElectrical } from './electrical';
import { type Component,type Project,type Property } from './model';
import { hybridRig, run, edit } from './hybrid-test-helpers';
describe('grid converters through actual MNA',()=>{
 it('stamps controlled phasor current without creating a voltage reference',()=>{
  const b=new Builder(),grid=b.add('sourceAC',{voltage:230}),inj=b.add('sourceAC'),load=b.add('resistor',{resistance:52.9});b.wire(grid,'a',inj,'a');b.wire(grid,'b',inj,'b');b.wire(grid,'a',load,'a');b.wire(grid,'b',load,'b');
  const r=solveElectrical(b.p,{}, {acInjections:{[inj.id]:[-300/230,0]}});expect(r.readings[grid.id].power).toBeCloseTo(-700,8);expect(r.readings[inj.id].power).toBeCloseTo(-300,8);expect(r.readings[load.id].power).toBeCloseTo(1000,8);
  grid.props.enabled=false;const off=solveElectrical(b.p,{}, {acInjections:{[inj.id]:[-300/230,0]}});expect(off.readings[load.id].power).toBe(0);
 });
 it('supplies local and protected loads with measured zero-export self consumption',()=>{
  const {b,meter,hybrid,backup}=hybridRig(),s=new Simulation(b.p);expect(s.error).toBeNull();run(s,.1);
  expect(s.electrical.readings[backup.id].power).toBeGreaterThan(490);expect(s.electrical.readings[meter.id].hybrid!.gridPower).toBeCloseTo(50,5);
  const h=s.electrical.readings[hybrid.id].hybrid!;expect(h.connected).toBe(true);expect(h.acPower).toBeGreaterThan(940);expect(h.dcPower-h.acPower).toBeCloseTo(h.conversionLoss,7);expect(Math.abs(s.energyResidual)).toBeLessThan(1e-3);
 });
 it('charges a real external battery from the grid',()=>{
  const {b,battery,hybrid}=hybridRig();Object.assign(hybrid.props,{gridCharge:true});const s=new Simulation(b.p);expect(s.error).toBeNull();run(s,.1);expect(s.electrical.readings[battery.id].current).toBeGreaterThan(0);expect(s.electrical.readings[hybrid.id].hybrid!.acPower).toBeCloseTo(-1000,5);expect(Math.abs(s.energyResidual)).toBeLessThan(1e-3);
 });
 it('opens both transfer poles on grid loss and keeps only protected loads powered',()=>{
  const {b,hybrid,grid,local,backup}=hybridRig(),s=new Simulation(b.p);expect(s.error).toBeNull();run(s,.1);edit(s,grid,{enabled:false});
  expect(s.electrical.readings[local.id].power).toBe(0);expect(s.electrical.readings[hybrid.id].hybrid!.connected).toBe(false);run(s,.05);
  expect(s.electrical.readings[backup.id].power).toBeCloseTo(500,5);expect(s.electrical.readings[grid.id].power).toBe(0);expect(Math.abs(s.energyResidual)).toBeLessThan(1e-3);
  edit(s,grid,{enabled:true,phase:90});run(s,.1);expect(s.electrical.readings[hybrid.id].hybrid!.connected).toBe(false);run(s,1.1);expect(s.electrical.readings[hybrid.id].hybrid!.connected).toBe(true);
 });
});

it('converts real PV current into grid injection and exports only through the source',()=>{
 const b=new Builder(),pv=b.add('solarPanel'),grid=b.add('sourceAC',{voltage:230,maxCurrent:63}),inv=b.add('gridInverter',{reconnectDelay:.01}),load=b.add('resistor',{resistance:529,ratedPower:200});
 b.wire(pv,'a',inv,'a');b.wire(pv,'b',inv,'b');b.wire(grid,'a',inv,'ga');b.wire(grid,'b',inv,'gb');b.wire(grid,'a',load,'a');b.wire(grid,'b',load,'b');
 const s=new Simulation(b.p);expect(s.error).toBeNull();run(s,.1);expect(s.electrical.readings[grid.id].power).toBeGreaterThan(300);expect(s.electrical.readings[inv.id].hybrid!.acPower).toBeGreaterThan(400);expect(Math.abs(s.energyResidual)).toBeLessThan(1e-3);
 edit(s,grid,{enabled:false});run(s,.05);expect(s.electrical.readings[load.id].power).toBe(0);expect(s.electrical.readings[pv.id].solar!.outputPower).toBeLessThan(1e-7);
});

import { hybridStarter } from './hybrid-projects';
import { parseProject,serializeProject } from './projects';
import { readProbe } from './measurements';
it.each(['gridSolar','hybridStorage','zeroExport','gridBackup','multipleSolar'] as const)('imports and operates the %s example with conserved energy',mode=>{
 const p=parseProject(JSON.parse(serializeProject(hybridStarter(mode)))),s=new Simulation(p);expect(s.error).toBeNull();run(s,.3);
 expect(Object.values(s.electrical.readings).every(r=>Number.isFinite(r.power))).toBe(true);expect(Math.abs(s.energyResidual)).toBeLessThan(1e-3);
 for(const probe of p.probes??[])expect(readProbe(probe,s)).not.toBeNull();
 if(mode==='zeroExport'){const meter=p.components.find(c=>c.kind==='gridMeter')!;expect(Math.abs(s.electrical.readings[meter.id].hybrid!.gridPower)).toBeLessThan(1e-5);expect(p.components.filter(c=>c.kind==='solarPanel').reduce((sum,c)=>sum+(s.electrical.readings[c.id].solar?.outputPower??0),0)).toBeGreaterThan(400);}
});

it('tracks restored weak sunlight without preserving an unattainable DC target',()=>{
 const p=hybridStarter('gridSolar'),pv=p.components.find(c=>c.kind==='solarPanel')!,inv=p.components.find(c=>c.kind==='gridInverter')!,s=new Simulation(p);run(s,.3);edit(s,pv,{irradiance:0});run(s,.1);expect(s.electrical.readings[inv.id].hybrid!.acPower).toBe(0);edit(s,pv,{irradiance:40});run(s,.3);expect(s.electrical.readings[inv.id].hybrid!.acPower).toBeGreaterThan(0);expect(Math.abs(s.energyResidual)).toBeLessThan(1e-3);
});

it('curtails and restores real PV extraction after abrupt zero-export demand changes',()=>{
 const p=hybridStarter('zeroExport'),load=p.components.find(c=>c.name.startsWith('Household'))!,meter=p.components.find(c=>c.kind==='gridMeter')!,s=new Simulation(p);run(s,.3);
 const pvPower=()=>p.components.filter(c=>c.kind==='solarPanel').reduce((n,c)=>n+(s.electrical.readings[c.id].solar?.outputPower??0),0),before=pvPower();
 edit(s,load,{resistance:52900/50});run(s,.3);expect(pvPower()).toBeLessThan(before-200);expect(Math.abs(s.electrical.readings[meter.id].hybrid!.gridPower)).toBeLessThan(1e-5);
 edit(s,load,{resistance:52900/500});run(s,.3);expect(pvPower()).toBeGreaterThan(before+150);expect(Math.abs(s.electrical.readings[meter.id].hybrid!.gridPower)).toBeLessThan(1e-5);expect(Math.abs(s.energyResidual)).toBeLessThan(1e-3);
});
it('replays grid-loss edits with identical converter state and energy',async()=>{
 const {replayExperiment}=await import('./replay'),{b,grid}=hybridRig(),edited={...b.p,components:b.p.components.map(c=>c.id===grid.id?{...c,props:{...c.props,enabled:false}}:c)},s=new Simulation(b.p);
 run(s,.1,1/60);expect(s.refresh(edited)).toBe(true);run(s,.2,1/60);
 const replay=replayExperiment(b.p,[{at:.1,project:edited}],.3);
 expect(replay.error).toBeNull();expect(replay.devices.checkpoint()).toEqual(s.devices.checkpoint());expect(replay.suppliedEnergy).toBe(s.suppliedEnergy);expect(replay.energyResidual).toBe(s.energyResidual);
});
