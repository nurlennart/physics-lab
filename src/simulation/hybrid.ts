/** Accepted-state memory only. Electrical trial solves never mutate these records. */
import { prop, type Component, type Project } from './model';
import type { ElectricalResult } from './electrical-core';
export const hybridKinds = ['gridInverter', 'hybridInverter', 'gridMeter'];
export interface HybridReading {
 targetVoltage?: number;
 acInputPower: number;
 mode: string; gridValid: boolean; connected: boolean; backupAvailable: boolean;
 gridVoltage: number; gridFrequency: number; gridPhase: number; gridPower: number; gridReactive: number;
 dcPower: number; acPower: number; outputPower: number; conversionLoss: number; transferLoss: number;
 overload: boolean; fault: string; soc: number | null;
}
export interface HybridState {
 mode: string; connected: boolean; gridValid: boolean; gridStable: number; outageElapsed: number; phase: number; frequency: number;
 overload: number; fault: string; imported: number; exported: number; dcIn: number; dcOut: number; lost: number; converterLossEnergy: number; transferLossEnergy: number;
 target: number; elapsed: number; direction: number; previousPower: number; absorption: number;
}
export function initialHybridState(c: Component): HybridState {
 return { mode:'off', connected:false, gridValid:false, gridStable:0, outageElapsed:0, phase:0, frequency:prop(c,'frequency',50), overload:0, fault:'', imported:0, exported:0, dcIn:0, dcOut:0, lost:0, converterLossEnergy:0, transferLossEnergy:0, target:prop(c,'dcTrackingVoltage',44.6),elapsed:0,direction:1,previousPower:0,absorption:0 };
}
export const phaseDifference = (a: number,b: number) => ((a-b+540)%360)-180;
export function hybridRatedPower(c: Component, t: number) {
 const rating=prop(c,'ratedPower'); return rating*(t<=25?1:t<=40?1-(t-25)/15*(1-2200/2400):2200/2400-(Math.min(t,65)-40)/25*(500/2400));
}
export function advanceHybrid(p: Project, states: Record<string,HybridState>, r: ElectricalResult,h:number) {
 for(const c of p.components.filter(c=>hybridKinds.includes(c.kind))) {
  const s=states[c.id], x=r.readings[c.id]?.hybrid; if(!s||!x) continue;
  s.mode=x.mode;s.connected=x.connected;s.gridValid=x.gridValid;
  s.gridStable=x.gridValid?s.gridStable+h:0;s.outageElapsed=x.connected?0:s.outageElapsed+h;
  if(x.fault) s.fault=x.fault;
  s.overload=x.overload?s.overload+h:0;
  if(x.gridValid) {s.phase+=Math.max(-prop(c,'phaseSlew',90)*h,Math.min(prop(c,'phaseSlew',90)*h,phaseDifference(x.gridPhase,s.phase)));s.frequency+=Math.max(-h,Math.min(h,x.gridFrequency-s.frequency));} else s.frequency=prop(c,'frequency',50);
  s.imported+=Math.max(0,x.gridPower)*h;s.exported+=Math.max(0,-x.gridPower)*h;
  s.dcIn+=Math.max(0,x.dcPower)*h;s.dcOut+=Math.max(0,-x.dcPower)*h;s.lost+=(x.conversionLoss+x.transferLoss)*h;s.converterLossEnergy+=x.conversionLoss*h;s.transferLossEnergy+=x.transferLoss*h;
  if(c.kind==='gridInverter') {
   if(x.targetVoltage!==undefined)s.target=x.targetVoltage;
   s.elapsed+=h;
   if(x.connected&&s.elapsed+1e-12>=prop(c,'dcTrackingInterval')) {
    const power=Math.max(0,x.dcPower);
    if(power>0 && x.acPower<hybridRatedPower(c,20)-1 && Math.abs((r.readings[c.id]?.voltage??0)-s.target)<1e-6) {
     if(power<s.previousPower-1e-7)s.direction*=-1;
     s.target=Math.max(prop(c,'minVoltage'),Math.min(prop(c,'maxInputVoltage')-.1,s.target+s.direction*prop(c,'dcTrackingStep')));s.previousPower=power;
    }
    s.elapsed=0;
   }
  }
  if(c.kind==='hybridInverter') {
   // Any regulated AC charging counts, including surplus from AC-coupled PV, not only grid charging.
   if(x.connected&&x.acPower<0&&!c.props.standby&&(r.readings[c.id]?.voltage??0)>=prop(c,'absorptionVoltage')-1e-6)s.absorption+=h;
   if((r.readings[c.id]?.voltage??0)<prop(c,'rebulkVoltage'))s.absorption=0;
  }
 }
}
export function hybridEventLimit(p: Project, states: Record<string,HybridState>) {
 let limit=Infinity;
 for(const c of p.components.filter(c=>hybridKinds.includes(c.kind)&&c.kind!=='gridMeter')) {
  const s=states[c.id]; if(!s)continue;
  for(const d of [!s.connected&&s.gridValid?prop(c,'reconnectDelay')-s.gridStable:Infinity,!s.connected?prop(c,'transferTime')-s.outageElapsed:Infinity,s.overload>0?prop(c,'surgeTime')-s.overload:Infinity,c.kind==='gridInverter'&&s.connected?prop(c,'dcTrackingInterval')-s.elapsed:Infinity,!s.connected&&s.gridValid&&s.gridStable>=prop(c,'reconnectDelay')?.05:Infinity])if(d>1e-9)limit=Math.min(limit,d);
 }
 return limit;
}
