import { describe, it, expect } from 'vitest';
import { Builder } from './scaling-validation';
import { Simulation } from './engine';
import { solveElectrical } from './electrical';
import { definitions, type Project, type Property } from './model';
function shared(soc = 50, capacity = 100) {
 const b = new Builder(), battery = b.add('lfpBattery', { initialSOC: soc, capacityAh: capacity });
 const controllers = [1000, 370].map((irradiance, k) => {
  const pv = b.add('solarPanel', { irradiance }), mppt = b.add('mpptController', { initialTrackingVoltage: 40 + k, maxCurrent: k ? 20 : 12 });
  b.wire(pv,'a',mppt,'a'); b.wire(pv,'b',mppt,'b'); b.wire(mppt,'oa',battery,'a'); b.wire(mppt,'ob',battery,'b'); return {pv,mppt};
 });
 return {b,battery,controllers};
}
function run(s: Simulation, t: number, h = 0.1) { for(let k=0;k<Math.round(t/h);k++) expect(s.step(h),`${s.time}: ${s.error}`).toBe(true); }
function edit(s: Simulation,id: string,props: Record<string,Property>) { expect(s.refresh({...s.project,components:s.project.components.map(c=>c.id===id?{...c,props:{...c.props,...props}}:c)} as Project),s.error??'').toBe(true); }
describe('adversarial solar audit',()=>{
 it.each([50,95,100])('two unequal MPPTs on one bus at %s%% SOC',soc=>{
  const {b,controllers,battery}=shared(soc); const s=new Simulation(b.p); expect(s.error).toBeNull(); run(s,2);
  for(const {mppt} of controllers) { const r=s.electrical.readings[mppt.id]; expect(r.secondaryCurrent!).toBeLessThanOrEqual(+mppt.props.maxCurrent+1e-7); expect(r.solar!.outputPower).toBeCloseTo(r.solar!.inputPower*.98,6); }
  expect(s.devices.batteries[battery.id]).toBeGreaterThanOrEqual(soc/100); expect(Math.abs(s.energyResidual)).toBeLessThan(1e-3);
 });
 it.each(['resistor','inverter'] as const)('full shared battery curtails and recovers a switched %s branch',kind=>{
  const {b,controllers,battery}=shared(100,0.1), sw=b.add('switch',{closed:false}), load=b.add('resistor',{resistance:kind==='inverter'?529:2,ratedPower:200});
  if(kind==='inverter') {
   const inv=b.add('inverter',{minVoltage:8,restartVoltage:10,maxInputVoltage:18}); b.wire(battery,'a',sw,'a');b.wire(sw,'b',inv,'a');b.wire(battery,'b',inv,'b');b.wire(inv,'oa',load,'a');b.wire(inv,'ob',load,'b');
  } else { b.wire(battery,'a',sw,'a');b.wire(sw,'b',load,'a');b.wire(battery,'b',load,'b'); }
  // This numerical curtailment fixture places the charger ceiling above the simplified full-pack OCV.
  for(const {mppt}of controllers)Object.assign(mppt.props,{absorptionVoltage:14.7,floatVoltage:14.65});
  const s=new Simulation(b.p); expect(s.error).toBeNull();run(s,0.2);
  expect(controllers.reduce((n,{pv})=>n+(s.electrical.readings[pv.id].solar?.outputPower??0),0)).toBeLessThan(1e-6);
  for(let k=0;k<3;k++) {edit(s,sw.id,{closed:true});run(s,0.3);expect(s.electrical.readings[load.id].power).toBeGreaterThan(40);expect(controllers.reduce((n,{pv})=>n+(s.electrical.readings[pv.id].solar?.outputPower??0),0)).toBeGreaterThan(40);edit(s,sw.id,{closed:false});run(s,0.3);}
  expect(Math.abs(s.energyResidual)).toBeLessThan(1e-3);
 });
 it('exploratory MPPT solves leave persistent state untouched',()=>{
  const {b}=shared(95);const s=new Simulation(b.p), before=s.devices.checkpoint();
  const runtime=s.devices.runtime(0.1);for(let k=0;k<3;k++) solveElectrical(s.project,{},runtime);
  expect(s.devices.checkpoint()).toEqual(before);
 });
 it.each([.01,.001])('tiny pack crosses the upper OCV knee with capacity %s Ah',capacity=>{
  const {b,battery}=shared(94,capacity),s=new Simulation(b.p);expect(s.error).toBeNull();run(s,.3,.01);
  expect(s.devices.batteries[battery.id]).toBeLessThanOrEqual(1);expect(s.electrical.readings[battery.id].heatPower!).toBeGreaterThanOrEqual(-1e-6);expect(Math.abs(s.energyResidual)).toBeLessThan(1e-3);
 });
 it('does not invent energy in an unpowered floating circuit',()=>{
  const b=new Builder(),r=b.add('resistor');const x=solveElectrical(b.p);expect(x.readings[r.id].power).toBe(0);expect(x.sourcePower).toBe(0);
 });
 it('rejects conflicting ideal voltage constraints',()=>{
  const b=new Builder(),a=b.add('source',{voltage:12}),c=b.add('source',{voltage:24});b.wire(a,'a',c,'a');b.wire(a,'b',c,'b');expect(()=>solveElectrical(b.p)).toThrow(/Singular/);
 });
});

it('two MPPT voltage regulators survive absorption, interruptions and float on one bus',()=>{
 const {b,controllers}=shared(95);for(const {mppt}of controllers)Object.assign(mppt.props,{absorptionVoltage:13.56,floatVoltage:13.5,rebulkVoltage:13.4,absorptionTime:1});
 const s=new Simulation(b.p);expect(s.error).toBeNull();run(s,.3);const before=controllers.map(({mppt})=>s.devices.solar[mppt.id].absorption);
 for(const {pv}of controllers)edit(s,pv.id,{irradiance:0});run(s,.4);for(const [k,{mppt}]of controllers.entries())expect(s.devices.solar[mppt.id].absorption).toBeCloseTo(before[k],8);
 for(const [k,{pv}]of controllers.entries())edit(s,pv.id,{irradiance:k?370:1000});run(s,1.3);
 expect(controllers.some(({mppt})=>s.devices.solar[mppt.id].absorption>=1)).toBe(true);
 for(const {mppt}of controllers){const x=s.electrical.readings[mppt.id].solar!;expect(x.outputPower).toBeCloseTo(x.inputPower*.98,6);}
 expect(Math.abs(s.energyResidual)).toBeLessThan(1e-3);
});
it('single MPPT absorption time pauses through darkness and resumes only at regulated voltage',()=>{
 const b=new Builder(),battery=b.add('lfpBattery',{initialSOC:95}),pv=b.add('solarPanel'),mppt=b.add('mpptController',{absorptionVoltage:13.56,floatVoltage:13.5,rebulkVoltage:13.4,absorptionTime:1});b.wire(pv,'a',mppt,'a');b.wire(pv,'b',mppt,'b');b.wire(mppt,'oa',battery,'a');b.wire(mppt,'ob',battery,'b');const s=new Simulation(b.p);expect(s.error).toBeNull();run(s,.3);const time=s.devices.solar[mppt.id].absorption;expect(time).toBeGreaterThan(.1);edit(s,pv.id,{irradiance:0});run(s,.5);expect(s.devices.solar[mppt.id].absorption).toBeCloseTo(time,9);edit(s,pv.id,{irradiance:1000});run(s,.8);expect(s.devices.solar[mppt.id].absorption).toBeGreaterThanOrEqual(1);expect(Math.abs(s.energyResidual)).toBeLessThan(1e-3);
});
it('rejects an undefined floating current-only island without inventing compliance voltage',()=>{
 const b=new Builder(),a=b.add('source'),c=b.add('source');b.wire(a,'a',c,'a');b.wire(a,'b',c,'b');expect(()=>solveElectrical(b.p,{}, {sourceModels:{[a.id]:{voltage:0,resistance:0,lower:1,upper:1},[c.id]:{voltage:0,resistance:0,lower:-1,upper:-1}}})).toThrow(/Singular/);
});
it('tiny LFP discharge approaches its lower boundary without artificial cooling and recovers by charging',()=>{
 const b=new Builder(),battery=b.add('lfpBattery',{initialSOC:4,capacityAh:.001,bmsLowVoltage:10}),pv=b.add('solarPanel',{enabled:false}),mppt=b.add('mpptController'),load=b.add('resistor',{resistance:10,ratedPower:100}),sw=b.add('switch',{closed:true});b.wire(pv,'a',mppt,'a');b.wire(pv,'b',mppt,'b');b.wire(mppt,'oa',battery,'a');b.wire(mppt,'ob',battery,'b');b.wire(battery,'a',sw,'a');b.wire(sw,'b',load,'a');b.wire(load,'b',battery,'b');const s=new Simulation(b.p);expect(s.error).toBeNull();run(s,.2,.01);expect(s.devices.batteries[battery.id]).toBeGreaterThanOrEqual(0);expect(s.devices.batteries[battery.id]).toBeLessThan(.04);expect(s.electrical.readings[battery.id].heatPower!).toBeGreaterThanOrEqual(-1e-6);edit(s,sw.id,{closed:false});edit(s,pv.id,{enabled:true});run(s,.05,.005);expect(s.devices.batteries[battery.id]).toBeGreaterThan(.1);expect(Math.abs(s.energyResidual)).toBeLessThan(1e-3);
});

import { inverterLoss } from './solar';
it.each(['inverter','hybridInverter'] as const)('the %s loss curve never exceeds its published maximum efficiency',kind=>{
 const b=new Builder(),c=b.add(kind);const peak=+c.props.peakEfficiency/100;
 for(let watts=1;watts<=+c.props.ratedPower;watts++){const efficiency=watts/(watts+inverterLoss(c,watts));expect(efficiency).toBeLessThanOrEqual(peak+1e-12);}
 const watts=+c.props.ratedPower/2;expect(watts/(watts+inverterLoss(c,watts))).toBeCloseTo(peak,12);
});
