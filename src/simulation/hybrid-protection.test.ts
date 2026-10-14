import { describe,it,expect,vi } from 'vitest';
import { hybridRig,run,edit } from './hybrid-test-helpers';
import { hybridStarter } from './hybrid-projects';
import { Simulation } from './engine';
import { solveElectrical } from './electrical';
import { Builder } from './scaling-validation';
import { initialHybridState } from './hybrid';
import { parseProject,serializeProject } from './projects';
import { captureAssembly,insertAssembly } from '../editor/assemblies';
import { readProbe } from './measurements';
describe('hybrid limits, transfer and conservation',()=>{
 it('respects the SOC reserve including control-electronics consumption',()=>{
  const {b,battery,hybrid}=hybridRig();battery.props.initialSOC=20;const s=new Simulation(b.p);expect(s.error).toBeNull();run(s,.02);const connectedSOC=s.devices.batteries[battery.id];run(s,.2);
  expect(s.devices.batteries[battery.id]).toBeGreaterThanOrEqual(connectedSOC-1e-12);expect(s.electrical.readings[hybrid.id].hybrid!.dcPower).toBeCloseTo(0,6);expect(Math.abs(s.energyResidual)).toBeLessThan(1e-3);
 });
 it('PowerControl reduces charging and PowerAssist supports a limited grid input',()=>{
  const {b,hybrid,meter}=hybridRig();Object.assign(hybrid.props,{gridCharge:true,acInputCurrentLimit:2});const s=new Simulation(b.p);expect(s.error).toBeNull();run(s,.1);
  expect(s.electrical.readings[hybrid.id].hybrid!.acPower).toBeGreaterThan(530);expect(s.electrical.readings[meter.id].hybrid!.gridPower).toBeLessThanOrEqual(460+1e-5);expect(Math.abs(s.energyResidual)).toBeLessThan(1e-3);
 });
 it.each([500,-500])('supports signed fixed-Q injection of %s var',reactiveSetpoint=>{
  const {b,hybrid,meter}=hybridRig();hybrid.props.reactiveSetpoint=reactiveSetpoint;const s=new Simulation(b.p);expect(s.error).toBeNull();run(s,.1);
  expect(s.electrical.readings[meter.id].hybrid!.gridReactive).toBeCloseTo(-reactiveSetpoint,4);const x=s.electrical.readings[hybrid.id].hybrid!;expect(x.dcPower-x.acPower).toBeCloseTo(x.conversionLoss,6);expect(Math.abs(s.energyResidual)).toBeLessThan(1e-3);
 });
 it('exports only when enabled and limits exported real power at the PCC',()=>{
  const {b,hybrid,meter}=hybridRig();Object.assign(hybrid.props,{energyMode:'power',activeSetpoint:1600,allowExport:true,exportLimit:200});const s=new Simulation(b.p);expect(s.error).toBeNull();run(s,.1);
  expect(s.electrical.readings[meter.id].hybrid!.gridPower).toBeCloseTo(-200,4);edit(s,hybrid,{allowExport:false});run(s,.1);expect(s.electrical.readings[meter.id].hybrid!.gridPower).toBeGreaterThan(-1e-5);
  expect(s.devices.hybrid[meter.id].exported).toBeGreaterThan(0);expect(s.devices.hybrid[meter.id].imported).toBeGreaterThan(0);expect(Math.abs(s.energyResidual)).toBeLessThan(1e-3);
 });
 it('resolves the configured 16 ms interruption inside a 100 ms outer step',()=>{
  const {b,grid,backup}=hybridRig(),s=new Simulation(b.p);expect(s.error).toBeNull();run(s,.1);edit(s,grid,{enabled:false});expect(s.step(.1),s.error??'').toBe(true);
  expect(s.electrical.readings[backup.id].power).toBeCloseTo(500*.084/.1,5);expect(Math.abs(s.energyResidual)).toBeLessThan(1e-3);
 });
 it('rejects an external bypass that would energize the utility during backup',()=>{
  const {b,hybrid,grid}=hybridRig();b.wire(hybrid,'oa',grid,'a');const s=new Simulation(b.p);expect(s.error).toMatch(/backup output.*bypass/);
 });
 it('reports an incompatible 12.8 V pack without silently adapting the 48 V converter',()=>{
  const {b,battery}=hybridRig();Object.assign(battery.props,{cells:4,emptyVoltage:10,fullVoltage:14.6,bmsLowVoltage:11.2,bmsHighVoltage:15});const s=new Simulation(b.p);expect(s.error).toMatch(/48 V configuration requires/);
 });
 it('does not power backup from an empty battery but can recharge it from grid',()=>{
  const {b,battery,hybrid,backup}=hybridRig();battery.props.initialSOC=0;Object.assign(hybrid.props,{gridCharge:true});const s=new Simulation(b.p);expect(s.error).toBeNull();run(s,.1);expect(s.devices.batteries[battery.id]).toBeGreaterThan(0);
  const grid=b.p.components.find(c=>c.kind==='sourceAC')!;edit(s,grid,{enabled:false});run(s,.03);expect(s.electrical.readings[backup.id].power).toBe(0);
 });
 it('grid undervoltage opens the transfer and leaves the protected output at 230 V',()=>{
  const {b,grid,hybrid,backup}=hybridRig(),s=new Simulation(b.p);expect(s.error).toBeNull();run(s,.1);edit(s,grid,{voltage:180});run(s,.05);expect(s.electrical.readings[hybrid.id].hybrid!.connected).toBe(false);expect(s.electrical.readings[backup.id].voltage).toBeCloseTo(230,7);
 });
 it('preserves every device state during exploratory hybrid electrical solves',()=>{
  const {b}=hybridRig(),s=new Simulation(b.p);run(s,.1);const before=s.devices.checkpoint();solveElectrical(s.project,{},s.devices.runtime(.01));expect(s.devices.checkpoint()).toEqual(before);
 });
 it('rolls back converter timers, meters, battery charge and energy on a rejected step',()=>{
  const {b}=hybridRig(),s=new Simulation(b.p);run(s,.1);const before=s.devices.checkpoint(),time=s.time,energy=s.suppliedEnergy;
  const solve=s.multiphysics.advance.bind(s.multiphysics);const fail=vi.spyOn(s.multiphysics,'advance').mockImplementation((...args)=>{solve(...args);throw Error('forced hybrid rejection');});
  expect(s.step(.01)).toBe(false);expect(s.devices.checkpoint()).toEqual(before);expect(s.time).toBe(time);expect(s.suppliedEnergy).toBe(energy);fail.mockRestore();
 });
 it('gives convergent charge and energy with refined timesteps',()=>{
  const {b,battery}=hybridRig();const result=[.02,.01].map(h=>{const s=new Simulation(b.p);run(s,.2,h);expect(Math.abs(s.energyResidual)).toBeLessThan(1e-3);return s.devices.batteries[battery.id];});expect(Math.abs(result[0]-result[1])).toBeLessThan(1e-6);
 });
 it('charges at the voltage limit without oscillating between bulk and absorption',()=>{
  const {b,battery,hybrid}=hybridRig();Object.assign(battery.props,{initialSOC:95,capacityAh:.1});Object.assign(hybrid.props,{gridCharge:true,gridChargeSOC:100,absorptionVoltage:54.5,floatVoltage:54.2,absorptionTime:1,rebulkVoltage:53.5});const s=new Simulation(b.p);expect(s.error).toBeNull();run(s,1.2);expect(s.devices.hybrid[hybrid.id].absorption).toBeGreaterThan(.5);expect(Math.abs(s.energyResidual)).toBeLessThan(1e-3);
 });
});

it('powers connected standby electronics from AC without draining the SOC reserve',()=>{
 const {b,battery,hybrid}=hybridRig();Object.assign(battery.props,{initialSOC:20});hybrid.props.standby=true;const s=new Simulation(b.p);expect(s.error).toBeNull();run(s,.02);const soc=s.devices.batteries[battery.id];run(s,.1);expect(s.devices.batteries[battery.id]).toBeCloseTo(soc,10);expect(s.electrical.readings[hybrid.id].hybrid!.conversionLoss).toBeCloseTo(2,7);
});
it('remaps ESS measurement references when duplicating and serializing an assembly',()=>{
 const {b}=hybridRig(),assembly=captureAssembly(b.p,b.p.components.map(c=>c.id)),copy=insertAssembly(b.p,assembly);
 const parsed=parseProject(JSON.parse(serializeProject(copy))),hybrids=parsed.components.filter(c=>c.kind==='hybridInverter');expect(hybrids).toHaveLength(2);expect(hybrids[0].props.batteryTarget).not.toBe(hybrids[1].props.batteryTarget);expect(hybrids[0].props.gridMeterTarget).not.toBe(hybrids[1].props.gridMeterTarget);const s=new Simulation(parsed);expect(s.error).toBeNull();run(s,.05);expect(Math.abs(s.energyResidual)).toBeLessThan(1e-3);
});
it('keeps real and reactive backup power distinct for an analytical series RL load',()=>{
 const {b,hybrid,grid,backup}=hybridRig();grid.props.enabled=false;b.p.components=b.p.components.filter(c=>c.id!==backup.id);b.p.connections=b.p.connections.filter(w=>w.from.component!==backup.id&&w.to.component!==backup.id);
 const r=b.add('resistor',{resistance:20,ratedPower:2000}),l=b.add('inductor',{resistance:1,tempCoefficient:0,inductance:.1,ratedCurrent:30});b.wire(hybrid,'oa',r,'a');b.wire(r,'b',l,'a');b.wire(l,'b',hybrid,'ob');const s=new Simulation(b.p);expect(s.error).toBeNull();run(s,.1);
 const expected=230**2*21/(21**2+(2*Math.PI*50*.1)**2),x=s.electrical.readings[hybrid.id].hybrid!;expect(x.acPower).toBeCloseTo(expected,6);expect(s.electrical.readings[l.id].reactivePower!).toBeGreaterThan(expected);expect(x.dcPower).toBeGreaterThan(x.acPower);expect(Math.abs(s.energyResidual)).toBeLessThan(1e-3);
});
it('trips a persistent backup surge after its duration and latches until Reset',()=>{
 const {b,grid,hybrid,backup}=hybridRig();grid.props.enabled=false;Object.assign(backup.props,{resistance:52900/3000,ratedPower:3500});const s=new Simulation(b.p);expect(s.error).toBeNull();run(s,.1);expect(s.electrical.readings[backup.id].power).toBeCloseTo(3000,6);run(s,2.1,.05);expect(s.devices.hybrid[hybrid.id].fault).toBe('overload');expect(s.electrical.readings[backup.id].power).toBe(0);expect(Math.abs(s.energyResidual)).toBeLessThan(1e-3);
});
it('the standalone inverter draws real load power plus apparent-current losses',()=>{
 const b=new Builder(),dc=b.add('source',{voltage:25.6,maxCurrent:100}),inv=b.add('inverter'),r=b.add('resistor',{resistance:100,ratedPower:500}),l=b.add('inductor',{resistance:1,tempCoefficient:0,inductance:.1,ratedCurrent:20});b.series(dc,inv);b.wire(inv,'oa',r,'a');b.wire(r,'b',l,'a');b.wire(l,'b',inv,'ob');const s=new Simulation(b.p);expect(s.error).toBeNull();run(s,.2);
 const real=230**2*101/(101**2+(2*Math.PI*50*.1)**2),x=s.electrical.readings[inv.id].solar!;expect(x.outputPower).toBeCloseTo(real,6);expect(x.inputPower).toBeGreaterThan(real);expect(Math.abs(s.energyResidual)).toBeLessThan(1e-3);
});
it('preserves the reserve when PowerAssist cannot satisfy the input limit',()=>{
 const {b,battery,hybrid}=hybridRig();battery.props.initialSOC=20;hybrid.props.acInputCurrentLimit=1;const s=new Simulation(b.p);expect(s.error).toBeNull();run(s,.02);const soc=s.devices.batteries[battery.id];run(s,.1);expect(s.devices.batteries[battery.id]).toBeGreaterThanOrEqual(soc-1e-12);expect(s.electrical.readings[hybrid.id].hybrid!.mode).toBe('grid import limit exceeded');expect(Math.abs(s.energyResidual)).toBeLessThan(1e-3);
});
it('depletes a tiny backup battery to its BMS cutoff without an undefined current-only bus',()=>{
 const {b,battery,grid,backup,hybrid}=hybridRig();battery.props.capacityAh=.01;grid.props.enabled=false;const s=new Simulation(b.p);expect(s.error).toBeNull();run(s,2,.02);expect(s.devices.batteries[battery.id]).toBeGreaterThanOrEqual(0);expect(s.electrical.readings[backup.id].power).toBe(0);expect(Math.abs(s.energyResidual)).toBeLessThan(1e-3);
});
it('shuts down conversion during a loaded DC voltage collapse',()=>{
 const {b,battery,grid,backup,hybrid}=hybridRig();grid.props.enabled=false;battery.props.internalResistance=5;const s=new Simulation(b.p);expect(s.error).toBeNull();run(s,.1);expect(s.electrical.readings[backup.id].power).toBe(0);expect(s.electrical.readings[hybrid.id].hybrid!.mode).toBe('DC voltage lockout');expect(Math.abs(s.energyResidual)).toBeLessThan(1e-3);
});

it.each(['hybrid','standalone'] as const)('starts an existing AC circulator through the %s converter and hydraulic solver',kind=>{
 const b=new Builder(),battery=b.add('lfpBattery',{},kind==='hybrid'?'sixteenCell':'eightCell'),inverter=b.add(kind==='hybrid'?'hybridInverter':'inverter',kind==='hybrid'?{batteryTarget:battery.id}:{}),pump=b.add('circulator'),pipe=b.add('pipe',{length:10,diameter:.02}),back=b.add('pipe',{length:10,diameter:.02}),valve=b.add('valve',{diameter:.02});
 b.wire(battery,'a',inverter,'a');b.wire(battery,'b',inverter,'b');b.wire(inverter,'oa',pump,'a');b.wire(inverter,'ob',pump,'b');b.wire(pump,'outlet',pipe,'inlet');b.wire(pipe,'outlet',valve,'inlet');b.wire(valve,'outlet',back,'inlet');b.wire(back,'outlet',pump,'inlet');const s=new Simulation(b.p);expect(s.error).toBeNull();run(s,kind==='hybrid'?4:1,1/60);expect(s.electrical.readings[pump.id].power).toBeGreaterThan(2.5);expect(s.multiphysics.hydraulic.readings[pump.id].flow).toBeGreaterThan(0);expect(Math.abs(s.energyResidual)).toBeLessThan(1e-3);
});
it('rejects a three-phase induction motor on a single-phase backup output',()=>{
 const {b,grid,hybrid}=hybridRig();grid.props.enabled=false;const motor=b.add('inductionMotor');b.wire(hybrid,'oa',motor,'a');b.wire(hybrid,'ob',motor,'b');const s=new Simulation(b.p);for(let k=0;k<10&&!s.error;k++)s.step(.01);expect(s.error).toMatch(/three-phase.*supply/);
});
