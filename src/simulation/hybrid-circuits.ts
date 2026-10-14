import { acDischargeBudget, essActiveCommand, solarSurplus } from './ess';
/** Grid-following current injection and isolated backup, coupled through actual MNA port powers. */
import { definitions, prop, type Component, type Project, type Terminal } from './model';
import type { ElectricalReading, ElectricalResult, ElectricalRuntime } from './electrical-core';
import { hybridKinds, hybridRatedPower, initialHybridState, phaseDifference, type HybridReading } from './hybrid';
import { inverterLoss } from './solar';
type Solve=(p:Project,f:Record<string,boolean>,r:ElectricalRuntime)=>ElectricalResult;
type Cx=[number,number];
const magnitude=(x:Cx)=>Math.hypot(...x), subtract=(a:Cx,b:Cx):Cx=>[a[0]-b[0],a[1]-b[1]];
const power=(v:Cx,i:Cx):Cx=>[v[0]*i[0]+v[1]*i[1],v[1]*i[0]-v[0]*i[1]];
const cache=new WeakMap<Project,ReturnType<typeof expandFresh>>();
function expandFresh(p:Project) {
 const ids=new Map<string,string[]>(), used=new Set(p.components.map(c=>c.id));
 const components=p.components.flatMap(c=>{
  if(!hybridKinds.includes(c.kind))return [c];
  const kinds:Component['kind'][]=c.kind==='gridMeter'?['resistor','junction']:c.kind==='gridInverter'?['source','sourceAC']:['source','sourceAC','resistor','resistor'];
  const parts=kinds.map((kind,k)=>{let id=`${c.id}#grid${k}`;while(used.has(id))id+='#';used.add(id);return {...c,id,kind,props:{...definitions[kind].defaults,enabled:true,...(kind==='source'?{mode:'internal',internalResistance:0}:{ }),...(kind==='sourceAC'?{voltage:prop(c,'voltage'),frequency:prop(c,'frequency'),internalResistance:0,phase:0}:{}),...(kind==='resistor'?{resistance:c.kind==='gridMeter'?prop(c,'resistance'):0.002,tempCoefficient:0,tolerance:0}:{})}};});
  ids.set(c.id,parts.map(c=>c.id));return parts;
 });
 const map=(t:Terminal):Terminal=>{
  const parts=ids.get(t.component);if(!parts)return t;
  const c=p.components.find(c=>c.id===t.component)!;
  if(c.kind==='gridMeter')return{component:parts[t.port==='reference'?1:0],port:t.port==='reference'?'a':t.port};
  if(t.port==='a'||t.port==='b')return{component:parts[0],port:t.port};
  if(c.kind==='gridInverter')return{component:parts[1],port:t.port==='ga'?'a':'b'};
  if(t.port==='ga'||t.port==='gb')return{component:parts[t.port==='ga'?2:3],port:'a'};
  return{component:parts[1],port:t.port==='oa'?'a':'b'};
 };
 const connections=p.connections.filter(w=>w.domain==='electrical').map(w=>({...w,from:map(w.from),to:map(w.to)}));
 for(const c of p.components.filter(c=>c.kind==='hybridInverter')) {
  const [,,line,neutral]=ids.get(c.id)!;
  for(const [id,port] of [[line,'oa'],[neutral,'ob']])connections.push({id:`${id}#transfer`,domain:'electrical',from:{component:id,port:'b'},to:map({component:c.id,port})});
 }
 return{project:{...p,components,connections},ids,map};
}
function expand(p:Project){let e=cache.get(p);if(!e){e=expandFresh(p);cache.set(p,e);}return e;}
export function solveHybrid(p:Project,failed:Record<string,boolean>,runtime:ElectricalRuntime,solve:Solve):ElectricalResult {
 const e=expand(p),units=p.components.filter(c=>hybridKinds.includes(c.kind)),converters=units.filter(c=>c.kind!=='gridMeter');
 const state=(c:Component)=>runtime.devices?.hybrid?.[c.id]??initialHybridState(c);
 const key=(c:Component,port:string)=>{const t=e.map({component:c.id,port});return `${t.component}:${t.port}`;};
 const phasor=(r:ElectricalResult,c:Component,a:string,b:string):Cx=>subtract(r.phasors?.[key(c,a)]??[r.nodes[key(c,a)]??0,0],r.phasors?.[key(c,b)]??[r.nodes[key(c,b)]??0,0]);
 const dcVoltage=(r:ElectricalResult,c:Component)=>r.readings[e.ids.get(c.id)![0]]?.voltage??0;
 const failures={...failed}, models={...runtime.sourceModels}, injections={...runtime.acInjections};
 // Open both transfer poles and all converter ports before testing the external voltage reference.
 for(const c of converters)e.ids.get(c.id)!.forEach(id=>{failures[id]=true;});
 let result=solve(e.project,failures,runtime);
 const grid=new Map<string,{valid:boolean;voltage:number;frequency:number;phase:number;connected:boolean}>();
 for(const c of converters) {
  const v=phasor(result,c,'ga','gb'),voltage=magnitude(v),freq=Object.values(result.readings).find(r=>r.ac&&r.frequency&&r.voltage===voltage)?.frequency;
  // Frequency comes from a real AC source in this island, never a disconnected converter.
  const island=result.nodeIslands?.[key(c,'ga')];
  const source=e.project.components.find(x=>x.kind==='sourceAC'&&!failures[x.id]&&x.props.enabled!==false&&result.nodeIslands?.[`${x.id}:a`]===island);
  const frequency=source?prop(source,'frequency'):freq??0;
  const valid=!!source&&result.nodeIslands?.[key(c,'ga')]===result.nodeIslands?.[key(c,'gb')]&&voltage>=prop(c,'gridMinVoltage')&&voltage<=prop(c,'gridMaxVoltage')&&frequency>=prop(c,'gridMinFrequency')&&frequency<=prop(c,'gridMaxFrequency');
  if(c.kind==='hybridInverter'&&result.nodeIslands?.[key(c,'oa')]&&[result.nodeIslands[key(c,'ga')],result.nodeIslands[key(c,'gb')]].includes(result.nodeIslands[key(c,'oa')])) throw Error(`${c.name}: backup output has an external AC source or a bypass to the grid. Remove that connection.`);
  const phase=Math.atan2(v[1],v[0])*180/Math.PI,s=state(c);
  const synchronized=Math.abs(phaseDifference(phase,s.phase))<=prop(c,'syncTolerance')&&Math.abs(frequency-s.frequency)<.01;
  const connected=valid&&(s.connected||s.gridStable+1e-10>=prop(c,'reconnectDelay'))&&synchronized&&c.props.enabled!==false&&!failed[c.id]&&s.fault!=='transfer overcurrent';
  grid.set(c.id,{valid,voltage,frequency,phase,connected});
 }
 const dcTargets:Record<string,number>={},activePower:Record<string,number>={},dcDemand:Record<string,number>={},currentCap:Record<string,number>={},modes=new Map<string,string>(),faults=new Map<string,string>();
 const enabled=new Map<string,boolean>(),backups=new Map<string,boolean>();
 for(const c of converters) {
  const s=state(c),g=grid.get(c.id)!,v=dcVoltage(result,c),battery=p.components.find(b=>b.id===c.props.batteryTarget);
  const ok=result.readings[e.ids.get(c.id)![0]]?.voltageValid!==false&&c.props.enabled!==false&&!failed[c.id]&&!s.fault&&(runtime.temperatures?.[c.id]??20)<=prop(c,'maxTemperature')&&v>=prop(c,c.kind==='hybridInverter'&&g.connected?'minVoltage':s.mode==='off'||s.mode==='DC voltage lockout'?'restartVoltage':'minVoltage')&&v<=prop(c,'maxInputVoltage');
  dcTargets[c.id]=c.kind==='gridInverter'&&g.connected&&ok?Math.max(prop(c,'minVoltage'),(s.target>.98*v?.85*v:s.target)):s.target;
  enabled.set(c.id,ok);activePower[c.id]=c.props.standby&&g.connected?-prop(c,'standbyPower'):0;dcDemand[c.id]=0;currentCap[c.id]=prop(c,'maxDCDischargeCurrent');
  const canDischarge=!battery || (runtime.devices?.batteries[battery.id]??prop(battery,'initialSOC')/100)>1e-14 && v>prop(battery,'bmsLowVoltage',0) && (runtime.temperatures?.[battery.id]??20)>=prop(battery,'minDischargeTemperature',-Infinity);
  const backup=canDischarge&&c.kind==='hybridInverter'&&!g.connected&&ok&&!c.props.standby&&s.outageElapsed+1e-10>=prop(c,'transferTime');
  if(!g.connected&&!canDischarge)enabled.set(c.id,false);
  backups.set(c.id,backup);
  modes.set(c.id,!ok?s.fault||'DC voltage lockout':c.props.standby?'standby':g.connected?'grid connected':backup?'backup':g.valid?'synchronizing':'transfer interruption');
  const parts=e.ids.get(c.id)!;parts.forEach(id=>failures[id]=false);
  if(c.kind==='hybridInverter'){failures[parts[2]]=failures[parts[3]]=!g.connected;}
  failures[parts[0]]=!enabled.get(c.id) || c.kind==='gridInverter' && (!g.connected || c.props.standby===true);
  failures[parts[1]]=!(g.connected&&ok||backup);
  // LFP packs: 3.2 V per cell. A generic battery has no cell count; use its mid-range OCV.
  const nominal=battery?battery.props.cells?prop(battery,'cells')*3.2:(prop(battery,'emptyVoltage')+prop(battery,'fullVoltage'))/2:0;
  if(c.kind==='hybridInverter'&&battery&&Math.abs(nominal-48)>16&&prop(c,'minVoltage')>=38)throw Error(`${c.name}: 48 V configuration requires a compatible external battery; selected pack is ${+nominal.toFixed(2)} V nominal.`);
 }
 let error=Infinity;
 const prepare = (last: ElectricalResult | undefined, networkModels: NonNullable<ElectricalRuntime['sourceModels']>, networkFailures: Record<string, boolean>) => {
  if(last) result=last;
  for(const c of converters) {
   const [dc,ac]=e.ids.get(c.id)!,s=state(c),g=grid.get(c.id)!,v=Math.max(1,dcVoltage(result,c));
   if(c.kind==='gridInverter')models[dc]={voltage:Math.min(dcTargets[c.id],prop(c,'maxInputVoltage')-.1),resistance:0,lower:0,upper:currentCap[c.id]};
   else {
    const battery=p.components.find(b=>b.id===c.props.batteryTarget);
    const inhibited=battery&&((runtime.devices?.batteries[battery.id]??prop(battery,'initialSOC')/100)<=1e-14||v<=prop(battery,'bmsLowVoltage',0));
    const i=inhibited?Math.min(0,dcDemand[c.id]/v):dcDemand[c.id]/v;
    const chargeVoltage=s.absorption>=prop(c,'absorptionTime')?prop(c,'floatVoltage'):prop(c,'absorptionVoltage');
    models[dc]=i<0?{voltage:chargeVoltage,resistance:0,lower:i,upper:0}:i>0
      ?{voltage:0,resistance:v*v/dcDemand[c.id],lower:0,upper:Infinity}
      :{voltage:0,resistance:0,lower:0,upper:0};
   }
   if(backups.get(c.id)) {
    delete injections[ac];const part=e.project.components.find(x=>x.id===ac)!;part.props={...part.props,phase:s.phase,frequency:s.frequency};
   } else {
    const voltage=phasor(result,c,c.kind==='gridInverter'?'ga':'oa',c.kind==='gridInverter'?'gb':'ob'),v2=Math.max(1,magnitude(voltage)**2),q=c.props.standby?0:prop(c,'reactiveSetpoint');
    const maxS=Math.min(prop(c,'ratedApparentPower'),prop(c,'maxACCurrent')*Math.sqrt(v2));
    let reactive:number,real:number;
    if(c.kind==='gridInverter') {
     const input=Math.max(0,result.readings[dc]?.power??0),coefficient=inverterLoss(c,0,1)-prop(c,'idlePower');
     const reactiveCap=coefficient>0?Math.min(maxS,Math.sqrt(Math.max(0,input-prop(c,'idlePower'))/coefficient)):maxS;
     reactive=Math.max(-reactiveCap,Math.min(reactiveCap,q));
     const realCap=Math.max(0,Math.min(Math.sqrt(Math.max(0,maxS**2-reactive**2)),acDischargeBudget(c,input,reactive)));
     real=Math.max(0,Math.min(realCap,activePower[c.id]));
    } else {
     real=Math.max(-maxS,Math.min(maxS,activePower[c.id]));
     const reactiveCap=Math.sqrt(Math.max(0,maxS**2-real**2));reactive=Math.max(-reactiveCap,Math.min(reactiveCap,q));
    }
    injections[ac]=[-(real*voltage[0]+reactive*voltage[1])/v2,-(real*voltage[1]-reactive*voltage[0])/v2];
   }
  }
  for (const c of converters) for (const id of e.ids.get(c.id)!) {
    if (models[id]) networkModels[id] = models[id];
    networkFailures[id] = failures[id];
  }
 };
 const observe = (next: ElectricalResult, tangent?: (patch: Partial<ElectricalRuntime>) => ElectricalResult) => {
  const previous=result; result=next;
  error=0;
  const change=(record:Record<string,number>,id:string,next:number)=>{error=Math.max(error,Math.abs(next-record[id])/Math.max(1,Math.abs(next)));record[id]+=.5*(next-record[id]);};
  for(const c of converters) {
   if(!enabled.get(c.id))continue;
   const [dc,ac,line,neutral]=e.ids.get(c.id)!,g=grid.get(c.id)!,s=state(c),x=result.readings[dc],y=result.readings[ac],v=x.voltage;
   const disconnect=(fault:string)=>{faults.set(c.id,fault);enabled.set(c.id,false);failures[dc]=failures[ac]=true;error=1;};
   if(backups.get(c.id)&&g.voltage<1e-6&&magnitude(phasor(result,c,'ga','gb'))>1e-6)throw Error(`${c.name}: backup wiring would energize the external grid. Remove the bypass connection.`);
   if(v<prop(c,'minVoltage')||v>prop(c,'maxInputVoltage')){disconnect('DC voltage lockout');continue;}
   const delivered=-y.power,apparent=Math.hypot(y.power,y.reactivePower??0),rated=hybridRatedPower(c,runtime.temperatures?.[c.id]??20);
   if(backups.get(c.id)&&(apparent>prop(c,'maxACCurrent')*Math.max(1,y.voltage)||apparent>prop(c,'surgePower')||delivered>prop(c,'surgePower')||s.overload+1e-10>=prop(c,'surgeTime')&&(delivered>rated||apparent>prop(c,'ratedApparentPower')))){disconnect('overload');continue;}
   if(g.connected&&c.kind==='hybridInverter'&&Math.max(Math.abs(result.readings[line].current),Math.abs(result.readings[neutral].current))>prop(c,'transferCurrent')){disconnect('transfer overcurrent');failures[line]=failures[neutral]=true;grid.get(c.id)!.connected=false;continue;}
   const loss=c.props.standby?prop(c,'standbyPower'):delivered>=0?inverterLoss(c,Math.max(0,delivered),apparent):(-delivered)*(1-prop(c,'chargeEfficiency')/100)+inverterLoss(c,0,Math.abs(y.reactivePower??0));
   const needed=delivered+loss;
   if(c.kind==='gridInverter') {
    if(!g.connected||c.props.standby){failures[dc]=true;continue;}
    if(x.power<prop(c,'idlePower')-1e-8){disconnect('insufficient DC power');continue;}
    const released=x.regulation==='cc'?(tangent?tangent({sourceModels:{[dc]:{...models[dc],upper:prop(c,'maxDCDischargeCurrent')}}}):solve(e.project,failures,{...runtime,sourceModels:{...models,[dc]:{...models[dc],upper:prop(c,'maxDCDischargeCurrent')}},acInjections:injections})):result;
    const available=Math.max(0,released.readings[dc].power-loss);
    const meter=p.components.find(m=>m.id===c.props.gridMeterTarget),flow=meter?meterFlow(result,meter):null;
    if(!c.props.allowExport&&!flow){disconnect('PCC meter missing');continue;}
    const command=flow?Math.min(rated,available,activePower[c.id]+flow[0]+(c.props.allowExport?prop(c,'exportLimit'):0)):Math.min(rated,available);
    change(activePower,c.id,Math.max(0,command));
    const limited=command<available-1e-8 || activePower[c.id]>=rated-1e-6;
    const nextCap=limited?Math.min(prop(c,'maxDCDischargeCurrent'),Math.max(0,(delivered+loss)/v)):prop(c,'maxDCDischargeCurrent');
    const cap=currentCap[c.id],residual=nextCap-cap;let next=cap+.5*residual;
    const di=released.readings[dc].current-x.current;
    if(limited&&x.regulation==='cc'&&Math.abs(di)>1e-12) {
     const dv=(released.readings[dc].voltage-v)/di,derivative=-(delivered+loss)*dv/(v*v)-1,root=cap-residual/derivative;
     if(derivative< -1e-6 && root>=0 && root<=prop(c,'maxDCDischargeCurrent') && Math.abs(root-cap)<.1*Math.max(1,cap))next=cap+.5*(root-cap);
    }
    error=Math.max(error,Math.abs(residual)/Math.max(1,nextCap));currentCap[c.id]=next;
   } else {
    change(dcDemand,c.id,needed);
    error=Math.max(error,Math.abs(x.power-needed)/Math.max(1,Math.abs(needed)));
    if(Math.abs(x.current)>prop(c,x.current>=0?'maxDCDischargeCurrent':'maxChargeCurrent')*(1+1e-8)){disconnect('DC current limit');continue;}
    if(g.connected&&c.props.standby)change(activePower,c.id,-prop(c,'standbyPower'));
    if(g.connected&&!c.props.standby) {
     const target=p.components.find(b=>b.id===c.props.batteryTarget),soc=target?runtime.devices?.batteries[target.id]??prop(target,'initialSOC')/100:null;
     const meter=p.components.find(m=>m.id===c.props.gridMeterTarget),m=meter?meterFlow(result,meter):null;
     if(!m){disconnect('PCC meter missing');continue;}
     const solarAvailable=solarSurplus(p,result,target,result.nodeIds?.[key(c,'a')],!!c.props.coordinateSolar&&soc!==null&&soc>=.999);
     let command=essActiveCommand(c,{acPower:activePower[c.id],dcPower:x.power,batteryPower:target?result.readings[target.id]?.power??0:0,soc,capacityAh:target?prop(target,'capacityAh'):0,dcVoltage:v,gridVoltage:g.voltage,gridPower:m[0],gridReactive:m[1],converterReactive:-(y.reactivePower??0),h:runtime.devices?.h??1/60,solarAvailable});
     if(command<0) {
      if(models[dc].lower<0&&(x.regulation==='cv'||v>=(s.absorption>=prop(c,'absorptionTime')?prop(c,'floatVoltage'):prop(c,'absorptionVoltage'))-1e-8))command=Math.max(command,(x.power-inverterLoss(c,0,Math.abs(y.reactivePower??0)))/(prop(c,'chargeEfficiency')/100));
      if(soc!==null&&soc>=1-1e-12)command=Math.max(command,-prop(c,'idlePower')/(prop(c,'chargeEfficiency')/100));
      command=Math.max(command,-prop(c,'maxChargeCurrent')*v/(prop(c,'chargeEfficiency')/100));
     }
     const maxS=Math.min(prop(c,'ratedApparentPower'),prop(c,'maxACCurrent')*g.voltage),maxP=Math.min(rated,maxS,prop(c,'maxDCDischargeCurrent')*v*.9);
     change(activePower,c.id,Math.max(-maxP,Math.min(maxP,command)));
    }
   }
   // AC power/current iteration must converge as well as the DC converter boundary.
   if(!backups.get(c.id))error=Math.max(error,Math.abs(y.power-previous.readings[ac].power)/Math.max(1,Math.abs(y.power)));
  }
  return error;
 };
 if (e.project.components.some(c=>['solarPanel','lfpBattery','mpptController','inverter','batteryProtection'].includes(c.kind))) {
  result=solve(e.project,failures,{...runtime,sourceModels:models,acInjections:injections,coupling:{prepare,residual:observe}});
 } else for(let k=0;k<300;k++) {
  prepare(result,models,failures);
  const next=solve(e.project,failures,{...runtime,sourceModels:models,acInjections:injections});
  if(observe(next)<1e-10)break;
  if(k===299)throw Error(`Hybrid electrical coupling did not converge (relative residual ${error}).`);
 }
 function vChargeStage(c:Component,v:number){return v>=prop(c,'absorptionVoltage')-1e-6?'grid charging · absorption':'grid charging · bulk';}
 function meterFlow(r:ElectricalResult,m:Component):Cx|null {
  if(m.kind!=='gridMeter')return null;
  const x=r.readings[e.ids.get(m.id)![0]],i=x?.currentPhasor;if(!i)return[0,0];return power(phasor(r,m,'a','reference'),i);
 }
 const meterFlows=new Map(units.filter(c=>c.kind==='gridMeter').map(c=>[c.id,meterFlow(result,c)]));
 for(const c of units) {
  const parts=e.ids.get(c.id)!,[dc,ac,line,neutral]=parts;
  let reading:ElectricalReading;
  if(c.kind==='gridMeter') {
   const x=result.readings[dc],flow=meterFlow(result,c)??[0,0];reading={...x,voltage:magnitude(phasor(result,c,'a','reference')),reactivePower:flow[1],heatPower:x.power};
   reading.hybrid={acInputPower:flow[0],mode:'measuring',gridValid:!!x.ac,connected:!!x.ac,backupAvailable:false,gridVoltage:reading.voltage,gridFrequency:x.frequency??0,gridPhase:0,gridPower:flow[0],gridReactive:flow[1],dcPower:0,acPower:0,outputPower:0,conversionLoss:0,transferLoss:x.power,overload:false,fault:'',soc:null};
  } else {
   const x=result.readings[dc],y=result.readings[ac],g=grid.get(c.id)!,s=state(c),loss=x.power+y.power,transferLoss=c.kind==='hybridInverter'?result.readings[line].power+result.readings[neutral].power:0;
   if(loss< -1e-6)throw Error(`${c.name}: converter output exceeds input by ${-loss} W.`);
   result.sourcePower+=x.power+y.power;result.dissipatedPower+=loss;
   const meter=p.components.find(m=>m.id===c.props.gridMeterTarget),flow=meter?meterFlows.get(meter.id):null;
   const battery=p.components.find(b=>b.id===c.props.batteryTarget),soc=battery?runtime.devices?.batteries[battery.id]??prop(battery,'initialSOC')/100:null;
   const outputV=phasor(result,c,c.kind==='gridInverter'?'ga':'oa',c.kind==='gridInverter'?'gb':'ob');
   const contactI:Cx=c.kind==='hybridInverter'?result.readings[line].currentPhasor??[0,0]:[0,0];
   const converterI=y.currentPhasor??[0,0],outI:Cx=[contactI[0]-converterI[0],contactI[1]-converterI[1]],out=power(outputV,outI);
   const h:HybridReading={targetVoltage:c.kind==='gridInverter'&&enabled.get(c.id)&&g.connected?dcTargets[c.id]:undefined,acInputPower:c.kind==='hybridInverter'?power(phasor(result,c,'ga','gb'),contactI)[0]:y.power,mode:faults.get(c.id)||modes.get(c.id)!,gridValid:g.valid,connected:g.connected,backupAvailable:magnitude(outputV)>1&&c.kind==='hybridInverter',gridVoltage:g.voltage,gridFrequency:g.frequency,gridPhase:g.phase,gridPower:flow?.[0]??(c.kind==='hybridInverter'?power(phasor(result,c,'ga','gb'),contactI)[0]:y.power),gridReactive:flow?.[1]??0,dcPower:x.power,acPower:-y.power,outputPower:out[0],conversionLoss:loss,transferLoss,overload:-y.power>hybridRatedPower(c,runtime.temperatures?.[c.id]??20)||Math.hypot(y.power,y.reactivePower??0)>prop(c,'ratedApparentPower'),fault:faults.get(c.id)==='overload'||faults.get(c.id)==='transfer overcurrent'?faults.get(c.id)!:'',soc};
   if(g.connected&&h.dcPower< -1e-6) h.mode=s.absorption>=prop(c,'absorptionTime')?'grid charging · float':vChargeStage(c,x.voltage);
   // The input current limit applies to import; export is bounded separately by exportLimit.
   if(g.connected&&h.gridPower>0&&Math.hypot(h.gridPower,h.gridReactive)>prop(c,'acInputCurrentLimit')*g.voltage+1e-5) h.mode='grid import limit exceeded';
   reading={...x,power:loss+transferLoss,heatPower:loss+transferLoss,reactivePower:-(y.reactivePower??0),secondaryVoltage:magnitude(outputV),secondaryCurrent:magnitude(outI),hybrid:h,solar:{inputPower:Math.max(0,x.power)+Math.max(0,y.power),outputPower:Math.max(0,-x.power)+Math.max(0,-y.power),efficiency:Math.max(Math.abs(x.power),Math.abs(y.power))>1e-9?Math.min(Math.abs(x.power),Math.abs(y.power))/Math.max(Math.abs(x.power),Math.abs(y.power)):0,mode:h.mode,running:enabled.get(c.id)===true}};
  }
  result.readings[c.id]=reading;
  for(const field of ['nodes','nodeIds','nodeIslands','phasors'] as const) {
   const values=result[field];if(!values)continue;
   for(const port of definitions[c.kind].ports.filter(p=>p.domain==='electrical')){const t=e.map({component:c.id,port:port.id}),k=`${t.component}:${t.port}`;if(k in values)(values as Record<string,unknown>)[`${c.id}:${port.id}`]=values[k];}
   parts.forEach(id=>{delete values[`${id}:a`];delete values[`${id}:b`];});
  }
  parts.forEach(id=>delete result.readings[id]);
 }
 result.powerResidual=result.sourcePower-result.dissipatedPower-(result.storedPower??0);
 return result;
}
