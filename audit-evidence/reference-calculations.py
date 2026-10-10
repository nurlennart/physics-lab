import json,math
from pathlib import Path
root=Path(__file__).parent
obs={}
for path in root.glob('*observations.json'):
 for x in json.loads(path.read_text()):obs[x['name']]=x['data']
P=1998.6118341559875; Ch=300.; Cw=41800.;G=180.;Uh=.5;Uw=2.2
a,b,c,d=-(G+Uh)/Ch,G/Ch,G/Cw,-(G+Uw)/Cw
def expA(t,x):
 mu=(a+d)/2; delta=math.sqrt(((a-d)/2)**2+b*c)
 u=math.exp((mu+delta)*t);v=math.exp((mu-delta)*t)
 z=(u+v)/2;q=(u-v)/(2*delta)
 return [z*x[0]+q*((a-mu)*x[0]+b*x[1]),z*x[1]+q*(c*x[0]+(d-mu)*x[1])]
det=a*d-b*c;xinf=[-d*P/Ch/det,c*P/Ch/det];z=expA(60,xinf);on=[xinf[i]-z[i] for i in range(2)];off=expA(60,on)
r={'thermal_parameters':{'P':P,'Ch':Ch,'Cw':Cw,'G':G,'Uh':Uh,'Uw':Uw},'thermal_exact60_C':[20+x for x in on],'thermal_exact120_after_off_C':[20+x for x in off], 'cooling_exact600_C':20+60*math.exp(-Uw*600/Cw),'water_only_ideal80_J':10*4180*60,'water_only_ideal80_s':10*4180*60/2000}
for n in ['T01-60s','T02-after60','T03-600','H01-10','H01-20','H04-20pct','H04-closed','H-sweep-baseline','H-sweep-higher','H-sweep-lower','H-sweep-narrow','H-sweep-long','H05-industrial','H06-empty','M-freefall-1','M-mechanism-10']:
 if n not in obs:continue
 s=obs[n];r[n]={'t':s['time'],'temps_C':s['temperatures'],'mass_kg':[v['mass'] for v in s['tanks'].values()],'motor':s['motors'],'flow_Lmin':[v['flow']*60000 for v in s['hydraulics']['readings'].values()],'energy_residual_J':s['energyResidualJ'],'electrical':s['readings'],'spatial':s['spatial']}
(root/'reference-results.json').write_text(json.dumps(r,indent=2));print(json.dumps(r,indent=2))
