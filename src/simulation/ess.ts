/** Reusable ESS measurements/commands. No energy is transferred here; MNA executes every command. */
import { prop, type Component, type Project } from './model';
import type { ElectricalResult } from './electrical-core';
import { inverterLoss } from './solar';
export function acDischargeBudget(c:Component,dcAvailable:number,reactive:number) {
 const idle=inverterLoss(c,0,Math.abs(reactive));
 if(dcAvailable<idle)return(dcAvailable-idle)/(prop(c,'chargeEfficiency')/100);
 let lo=0,hi=dcAvailable;
 for(let n=0;n<50;n++){const mid=(lo+hi)/2;if(mid+inverterLoss(c,mid,Math.hypot(mid,reactive))>dcAvailable)hi=mid;else lo=mid;}
 return(lo+hi)/2;
}
export function solarCoordination(p:Project,r:ElectricalResult,battery:Component|undefined,dcNode:string|undefined,voltage:number,enabled:boolean) {
 const commands:Record<string,number>={};let available=0;
 if(!enabled||!battery||!dcNode)return{commands,available};
 for(const controller of p.components.filter(c=>c.kind==='mpptController')) {
  if(r.nodeIds?.[`${controller.id}:oa`]!==dcNode)continue;
  const reading=r.readings[controller.id]?.solar;
  if(!reading||controller.props.enabled===false)continue;
  commands[controller.id]=Math.min(prop(battery,'bmsHighVoltage',prop(battery,'fullVoltage'))-.1,Math.max(prop(controller,'absorptionVoltage'),prop(battery,'fullVoltage')));
  available+=Math.min((reading.mppPower??0)*prop(controller,'conversionEfficiency')/100,prop(controller,'maxCurrent')*voltage);
 }
 return{commands,available};
}

export interface ESSMeasurements {
 acPower:number; dcPower:number; batteryPower:number; soc:number|null; capacityAh:number;
 dcVoltage:number; gridVoltage:number; gridPower:number; gridReactive:number; converterReactive:number; h:number; solarAvailable:number;
}
/** Positive command injects AC power. Import limits are soft when storage/ratings cannot assist. */
export function essActiveCommand(c:Component,m:ESSMeasurements) {
 let command=prop(c,'activeSetpoint');
 if(c.props.energyMode!=='power') {
  command=m.acPower+m.gridPower-prop(c,'gridSetpoint');
  if(c.props.energyMode==='keepCharged')command=Math.min(command,0);
  if(c.props.allowExport&&m.solarAvailable>0)command=Math.max(command,acDischargeBudget(c,m.solarAvailable,m.converterReactive));
  if((c.props.gridCharge||c.props.energyMode==='keepCharged')&&m.soc!==null&&m.soc*100<prop(c,'gridChargeSOC'))command=-prop(c,'gridChargePower');
  const gridLimit=prop(c,'acInputCurrentLimit')*m.gridVoltage;
  command=Math.max(command,m.acPower+m.gridPower-Math.sqrt(Math.max(0,gridLimit**2-m.gridReactive**2)));
 }
 // SOC reserve takes priority over PowerAssist while connected; unmet input limits are reported.
 const external=Math.max(0,m.dcPower+m.batteryPower);
 const stored=m.soc===null?0:Math.max(0,m.soc-prop(c,'reserveSOC')/100)*3600*m.capacityAh/Math.max(1e-9,m.h)*m.dcVoltage;
 command=Math.min(command,acDischargeBudget(c,external+stored,m.converterReactive));
 return Math.min(command,m.acPower+m.gridPower+(c.props.allowExport?prop(c,'exportLimit'):0));
}
