import { catalog, connect, makeComponent, uid, type Component, type Kind, type Measurement, type Project, type Property } from './model';
export const hybridTitles={gridSolar:'Grid-tied solar inverter',hybridStorage:'Grid-connected hybrid storage',zeroExport:'Zero-export household',gridBackup:'Grid outage and backup',multipleSolar:'Multiple solar controllers'};
export type HybridMode=keyof typeof hybridTitles;
export function hybridStarter(mode:HybridMode):Project {
 let p:Project={version:3,id:uid(),name:hybridTitles[mode],components:[],connections:[],probes:[],assemblies:[]};
 const add=(kind:Kind,x:number,y:number,name:string,props:Record<string,Property>={},variant='standard')=>{const c=makeComponent(kind,x,y,p.components);c.variant=variant;c.props={...catalog(c).props,...props};c.name=name;p.components.push(c);return c;};
 const wire=(a:Component,ap:string,b:Component,bp:string)=>{p=connect(p,{component:a.id,port:ap},{component:b.id,port:bp});};
 const probe=(c:Component,measurement:Measurement,name:string,color='#38bdf8')=>p.probes!.push({id:uid(),component:c.id,measurement,name,color,visible:true});
 const grid=add('sourceAC',70,430,'Utility grid · 230 V',{voltage:230,maxCurrent:63}),meter=add('gridMeter',390,430,'Point of common coupling');
 wire(grid,'a',meter,'a');wire(grid,'b',meter,'reference');
 const local=add('resistor',710,730,'Household demand · 300 W',{resistance:52900/300,ratedPower:600,heatCapacity:2000,loss:5});wire(meter,'b',local,'a');wire(grid,'b',local,'b');
 probe(meter,'gridPower','Grid import (+) / export (−)');probe(meter,'gridImportEnergy','Purchased grid energy');probe(meter,'gridExportEnergy','Exported grid energy','#22c55e');probe(local,'power','Household AC consumption','#f97316');
 if(mode==='gridSolar') {
  const pv=add('solarPanel',70,100,'Solar Panel (PV)'),inv=add('gridInverter',710,100,'Grid-Connected Inverter',{gridMeterTarget:meter.id,reconnectDelay:.1});wire(pv,'a',inv,'a');wire(pv,'b',inv,'b');wire(meter,'b',inv,'ga');wire(grid,'b',inv,'gb');probe(pv,'outputPower','PV generated power','#f59e0b');probe(inv,'acConversionPower','AC solar injection','#22c55e');
 } else {
  const battery=add('lfpBattery',1030,100,'LiFePO4 Battery · 51.2 V',mode==='zeroExport'?{initialSOC:100}:{},'sixteenCell');
  const hybrid=add('hybridInverter',1030,430,'Hybrid Inverter / Charger',{batteryTarget:battery.id,gridMeterTarget:meter.id,reconnectDelay:.1,gridSetpoint:mode==='zeroExport'?0:50,allowExport:mode==='hybridStorage'});
  wire(battery,'a',hybrid,'a');wire(battery,'b',hybrid,'b');wire(meter,'b',hybrid,'ga');wire(grid,'b',hybrid,'gb');
  const backup=add('resistor',1350,430,'Protected AC demand · 200 W',{resistance:264.5,ratedPower:500,heatCapacity:2000,loss:5});wire(hybrid,'oa',backup,'a');wire(hybrid,'ob',backup,'b');
  for(let k=0;k<(mode==='multipleSolar'?2:1);k++) {
   const y=k?1030:100,a=add('solarPanel',70,y,`PV string ${k+1} · module 1`,{irradiance:k?650:1000}),b=add('solarPanel',390,y,`PV string ${k+1} · module 2`,{irradiance:k?650:1000}),mppt=add('mpptController',710,y,`MPPT Charge Controller ${k+1}`,{},'48V');
   wire(a,'b',b,'a');wire(a,'a',mppt,'a');wire(b,'b',mppt,'b');wire(mppt,'oa',battery,'a');wire(mppt,'ob',battery,'b');probe(mppt,'outputPower',`Solar charger ${k+1} output`,'#f59e0b');
  }
  probe(battery,'stateOfCharge','Battery SOC');probe(battery,'chemicalEnergy','Stored chemical energy','#a78bfa');probe(battery,'current','Battery current (+ charging)','#06b6d4');probe(hybrid,'acConversionPower','Hybrid AC conversion','#22c55e');probe(hybrid,'backupAvailable','Protected output available');probe(backup,'power','Protected AC consumption','#f97316');probe(hybrid,'conversionLoss','Hybrid losses','#ef4444');
 }
 return p;
}
