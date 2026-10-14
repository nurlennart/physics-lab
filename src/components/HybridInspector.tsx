import { simulation } from '../editor/store';
import { type Component, prop } from '../simulation/model';
import { hybridProvenance as ref } from '../simulation/hybrid-provenance';
export function HybridInspector({c}:{c:Component}) {
 if(!['gridInverter','hybridInverter','gridMeter'].includes(c.kind))return null;
 const r=simulation.electrical.readings[c.id],h=r?.hybrid,s=simulation.devices.hybrid[c.id];
 return <section className="inspector-section" aria-label="Grid energy model">
  <div className="section-label">Grid & conversion state</div>
  <p role="status">{simulation.time===0?'Ready · paused preview':h?.mode??'Off'} · {h?.connected?'Grid connected':'Grid isolated'}</p>
  <p>{(h?.gridVoltage??0).toFixed(1)} V · {(h?.gridFrequency??0).toFixed(2)} Hz · {h?.gridValid?'Grid reference accepted':'No accepted grid reference'}</p>
  <p>{(h?.gridPower??0).toFixed(1)} W grid (+ import) · {(h?.gridReactive??0).toFixed(1)} var</p>
  <p>{((s?.imported??0)/3600).toFixed(3)} Wh imported · {((s?.exported??0)/3600).toFixed(3)} Wh exported</p>
  {c.kind!=='gridMeter'&&<><p>{(h?.dcPower??0).toFixed(1)} W DC (+ discharge) · {(h?.acPower??0).toFixed(1)} W AC conversion (+ injection)</p><p>{(h?.conversionLoss??0).toFixed(1)} W conversion loss · {(h?.transferLoss??0).toFixed(3)} W transfer loss</p><p>{(h?.acInputPower??0).toFixed(1)} W at AC grid port · {(h?.outputPower??0).toFixed(1)} W AC output</p><p>Protected output: {h?.backupAvailable?'Available':'Unavailable'} · {(r?.secondaryVoltage??0).toFixed(1)} V</p><p>{h?.soc===null?'SOC measurement unassigned':`${((h?.soc??0)*100).toFixed(2)}% SOC`} · {prop(c,'reserveSOC')}% grid-connected reserve · export {c.props.allowExport?'permitted':'disabled'}</p></>}
  <details><summary>Model provenance & limitations</summary>{c.kind==='gridMeter'?<p>Generic RMS meter with an assumed 1 mΩ current shunt. Place its line path at the point of common coupling and connect neutral reference. Positive current flows from upstream a to downstream b. Meter dissipation is distinct from measured through-power.</p>:<><p><a href={ref.datasheet} target="_blank" rel="noreferrer">{ref.reference}</a></p><p>{ref.published}</p><p>{ref.assumptions}</p><p><a href={ref.ess} target="_blank" rel="noreferrer">ESS operating-policy reference</a></p></>}</details>
 </section>;
}
