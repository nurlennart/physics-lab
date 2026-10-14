import { describe,it,expect } from 'vitest';
import { Builder } from './scaling-validation';
import { Simulation } from './engine';
import { solveElectrical } from './electrical';
import { type Component,type Project,type Property } from './model';
export function hybridRig() {
 const b=new Builder(),battery=b.add('lfpBattery',{cells:16,emptyVoltage:40,fullVoltage:54.4,bmsLowVoltage:44.8,bmsHighVoltage:60,internalResistance:.0032,maxPower:10240,heatCapacity:56000});
 const grid=b.add('sourceAC',{voltage:230,maxCurrent:63}),meter=b.add('gridMeter'),hybrid=b.add('hybridInverter',{batteryTarget:battery.id,gridMeterTarget:meter.id,reconnectDelay:.01});
 const local=b.add('resistor',{resistance:105.8,ratedPower:1000}),backup=b.add('resistor',{resistance:105.8,ratedPower:1000});
 b.wire(grid,'a',meter,'a');b.wire(meter,'b',hybrid,'ga');b.wire(meter,'b',local,'a');b.wire(grid,'b',local,'b');b.wire(grid,'b',hybrid,'gb');b.wire(grid,'b',meter,'reference');b.wire(battery,'a',hybrid,'a');b.wire(battery,'b',hybrid,'b');b.wire(hybrid,'oa',backup,'a');b.wire(hybrid,'ob',backup,'b');
 return{b,battery,grid,meter,hybrid,local,backup};
}
export const run=(s:Simulation,t:number,h=.01)=>{for(let k=0;k<Math.round(t/h);k++)expect(s.step(h),`${s.time}: ${s.error}`).toBe(true);};
export const edit=(s:Simulation,c:Component,props:Record<string,Property>)=>expect(s.refresh({...s.project,components:s.project.components.map(x=>x.id===c.id?{...x,props:{...x.props,...props}}:x)} as Project),s.error??'').toBe(true);
