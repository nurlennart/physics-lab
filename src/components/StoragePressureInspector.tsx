import { effectiveAmbient } from "../simulation/environment";
import { simulation } from '../editor/store';
import { prop, type Component } from '../simulation/model';
import { coilLayers, layerAt, layerCapacity, storageBasisLabels, storageGeometry, storageLayers, storageModelBasis } from '../simulation/storage-tank';
import { fullLiftFlow, pressureBasisLabels, safetyValveModelBasis, valveSetPoints, vesselModelBasis, vesselPressure, waterAtPressure } from '../simulation/expansion';
import { T } from '../theme/tokens';

const fmt = (v: number, digits = 1) => v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Stratified storage tank: the layer profile with ports, coil and sensors, readings and data provenance. */
export function StorageTankInspector({ c }: { c: Component }) {
  const started = simulation.time > 0, n = storageLayers(c), coil = coilLayers(c), h = simulation.multiphysics.hydraulic.readings[c.id];
  const cells = (simulation.multiphysics.pipeCells[c.id] ?? Array(n).fill(prop(c, 'initialTemperature') + 273.15)).map(t => t - 273.15);
  const air = effectiveAmbient(simulation.project, c), low = Math.floor(Math.min(air, ...cells) / 10) * 10, high = Math.max(low + 10, Math.ceil(Math.max(...cells) / 10) * 10);
  const tx = (t: number) => 70 + 170 * (t - low) / (high - low), ly = (k: number) => 140 - 124 * (k + 0.5) / n, hy = (percent: number) => 140 - 124 * percent / 100;
  const profile = cells.map((t, k) => `${tx(t)},${ly(k)}`).join(' ');
  const stored = cells.reduce((sum, t) => sum + layerCapacity(c) * (t - prop(c, 'initialTemperature')), 0);
  const loss = cells.reduce((sum, t) => sum + prop(c, 'loss') / n * (t - air), 0);
  const ports = (['p1', 'p2', 'p3', 'p4'] as const).map(id => ({ id, height: prop(c, `${id}Height`), flow: simulation.multiphysics.hydraulic.readings[`${c.id}#${id}`]?.flow ?? 0 }));
  return <div className="inspector-section" data-testid="storage-tank-section">
    <div className="section-label">{c.variant === 'wh290' ? 'Bosch Stora WH 290 LP1 B · hot-water cylinder' : 'Stratified storage tank'}</div>
    <p className="field-hint" data-testid="storage-status"><strong>{fmt(cells[n - 1])} °C top · {fmt(cells[0])} °C bottom</strong> · {fmt(prop(c, 'storageVolume'), 0)} L in {n} layers of {fmt(storageGeometry(c).layerHeight * 100)} cm{coil.length ? ` · coil ${started ? `${fmt((h?.duty ?? 0) / 1000, 2)} kW into the store` : `${fmt(prop(c, 'coilUA'), 0)} W/K`}` : ''}</p>
    <svg viewBox="0 0 260 168" role="img" aria-label="Temperature profile over the height of the tank with ports, coil and sensor positions">
      <rect x="20" y="16" width="34" height="124" rx="6" fill={T.n4} stroke={T.n11}/>
      {cells.map((t, k) => <rect key={k} x="20" y={140 - 124 * (k + 1) / n} width="34" height={124 / n + 0.3} fill={T.thermal} fillOpacity={Math.max(0.04, Math.min(0.85, (t - low) / Math.max(10, high - low)))}/>)}
      {coil.length > 0 && <path d={`M24 ${hy(prop(c, 'coilTop'))}${coil.map((_, i) => `L${i % 2 ? 24 : 50} ${hy(prop(c, 'coilTop')) + (hy(prop(c, 'coilBottom')) - hy(prop(c, 'coilTop'))) * (i + 1) / coil.length}`).join('')}`} fill="none" stroke={T.hydraulicText} strokeWidth="1.25"/>}
      {ports.map(p => <g key={p.id}><path d={`M${p.id === 'p1' || p.id === 'p2' ? 8 : 54} ${hy(p.height)}h12`} stroke={Math.abs(p.flow) > 1e-9 ? T.hydraulic : T.n11} strokeWidth="2.5"/><text x={p.id === 'p1' || p.id === 'p2' ? 2 : 58} y={hy(p.height) + 3} fill={T.n13} fontSize="8">{p.id.slice(1)}</text></g>)}
      {[prop(c, 'sensorTopHeight'), prop(c, 'sensorBottomHeight')].map((s, i) => <circle key={i} cx="37" cy={hy(s)} r="2.5" fill={T.electricalText}/>)}
      <path d="M70 16V140H240" fill="none" stroke={T.n11}/>
      <path d={`M${tx(air)} 16V140`} stroke={T.n13} strokeDasharray="3 3"/>
      <polyline points={profile} fill="none" stroke={T.thermalText} strokeWidth="2"/>
      <text x="70" y="154" fill={T.n13} fontSize="10">{low}–{high} °C over the height · air {fmt(air)} °C ···</text>
      <text x="70" y="166" fill={T.electricalText} fontSize="10">● sensors</text>{coil.length > 0 && <text x="130" y="166" fill={T.hydraulicText} fontSize="10">coil</text>}
    </svg>
    <div className="measurement-list summary" data-testid="storage-readings">
      <div><span>Upper sensor</span><strong>{fmt(cells[layerAt(c, prop(c, 'sensorTopHeight'))])} °C</strong></div>
      <div><span>Lower sensor</span><strong>{fmt(cells[layerAt(c, prop(c, 'sensorBottomHeight'))])} °C</strong></div>
      <div><span>Stored since reset</span><strong>{fmt(stored / 3.6e6, 2)} kWh</strong></div>
      <div><span>Standby loss now</span><strong>{fmt(loss, 0)} W</strong><small>{fmt(prop(c, 'standbyHeatLoss'), 0)} W at 65/20 °C</small></div>
      {ports.map(p => <div key={p.id}><span>Port {p.id.slice(1)} · {fmt(p.height, 0)} %</span><strong>{started ? `${fmt(p.flow * 60000, 2)} L/min` : '—'}</strong><small>{p.flow > 1e-9 ? 'in' : p.flow < -1e-9 ? 'out' : ''}</small></div>)}
    </div>
    <details style={{ marginTop: 12 }}><summary className="section-label">Model basis · data provenance</summary>
      {storageModelBasis(c).map(b => <p className="field-hint" key={b.kind} data-testid={`storage-basis-${b.kind}`}><strong>{storageBasisLabels[b.kind]}:</strong> {b.text}</p>)}
    </details>
  </div>;
}

/** Expansion vessel: pressure versus water-side volume with the fill point, working range and the operating point. */
export function ExpansionVesselInspector({ c }: { c: Component }) {
  const v = simulation.multiphysics.vessels[c.id], vn = prop(c, 'nominalVolume') / 1000, system = v?.system ?? 0.1;
  const pmax = Math.max(prop(c, 'maxPressure'), prop(c, 'fillPressure')) * 1.3;
  const px = (w: number) => 22 + 214 * w / vn, py = (p: number) => 116 - 98 * Math.max(0, p) / pmax;
  const curve = Array.from({ length: 81 }, (_, i) => { const w = vn * 0.94 * i / 80; return `${px(w)},${py(vesselPressure(c, w, system))}`; }).join(' ');
  const fill = waterAtPressure(c, prop(c, 'fillPressure'), system), working = waterAtPressure(c, prop(c, 'maxPressure') - 50000, system);
  const reserve = Math.max(0.005 * system, 0.003);
  return <div className="inspector-section" data-testid="expansion-vessel-section">
    <div className="section-label">{c.variant === 'bosch17' ? 'Bosch indoor-unit expansion vessel' : 'Membrane expansion vessel'}</div>
    <p className="field-hint" data-testid="vessel-status"><strong>{fmt((v?.pressure ?? prop(c, 'fillPressure')) / 1e5, 2)} bar</strong> · {fmt(Math.max(0, v?.water ?? fill) * 1000, 2)} L on the water side · circuit {fmt(system * 1000, 0)} L, expanded {fmt((v?.expansion ?? 0) * 1000, 2)} L since fill{simulation.faults[c.id] === 'gasLoss' ? ' · cushion lost' : ''}</p>
    <svg viewBox="0 0 260 160" role="img" aria-label="Cushion pressure versus water-side volume with fill point, working limit and operating point">
      <path d="M22 15V116H238" fill="none" stroke={T.n11}/>
      <path d={`M22 ${py(prop(c, 'maxPressure'))}H238`} stroke={T.faultText} strokeDasharray="4 3"/>
      <polyline points={curve} fill="none" stroke={T.hydraulicText} strokeWidth="2"/>
      <circle cx={px(Math.max(0, fill))} cy={py(prop(c, 'fillPressure'))} r="3.5" fill="none" stroke={T.n14}/>
      {v && <circle cx={px(Math.max(0, Math.min(vn, v.water)))} cy={py(v.pressure)} r="4" fill={T.electricalText}/>}
      <text x="22" y="132" fill={T.n13} fontSize="10">water side 0–{fmt(vn * 1000, 0)} L · 0–{fmt(pmax / 1e5, 1)} bar</text>
      <text x="22" y="148" fill={T.hydraulicText} fontSize="10">gas law</text><text x="70" y="148" fill={T.n14} fontSize="10">○ fill</text><text x="108" y="148" fill={T.faultText} fontSize="10">--- rating</text><text x="166" y="148" fill={T.electricalText} fontSize="10">● now</text>
    </svg>
    <div className="measurement-list summary" data-testid="vessel-readings">
      <div><span>Water at fill</span><strong>{fmt(Math.max(0, fill) * 1000, 2)} L</strong></div>
      <div><span>Usable to {fmt((prop(c, 'maxPressure') - 50000) / 1e5, 1)} bar</span><strong>{fmt(Math.max(0, working - fill) * 1000, 2)} L</strong><small>expansion it can take</small></div>
      <div><span>EN 12828 reserve</span><strong>{fmt(reserve * 1000, 2)} L</strong><small>0.5 % of the circuit, ≥ 3 L</small></div>
    </div>
    <details style={{ marginTop: 12 }}><summary className="section-label">Model basis · data provenance</summary>
      {vesselModelBasis(c).map(b => <p className="field-hint" key={b.kind}><strong>{pressureBasisLabels[b.kind]}:</strong> {b.text}</p>)}
    </details>
  </div>;
}

export function SafetyValveInspector({ c }: { c: Component }) {
  const r = simulation.multiphysics.hydraulic.readings[c.id], lift = simulation.multiphysics.positions[c.id] ?? 0, { set, full, reseat } = valveSetPoints(c);
  return <div className="inspector-section" data-testid="safety-valve-section">
    <div className="section-label">Safety valve · {fmt(set / 1e5, 1)} bar</div>
    <p className="field-hint" data-testid="valve-status"><strong>{lift > 0 ? `Open, ${fmt(lift, 0)} % lift` : 'Closed'}</strong> · {fmt((r?.differentialPressure ?? 0) / 1e5, 2)} bar across the disc · {fmt((simulation.multiphysics.discharged[c.id] ?? 0) * 1000, 2)} L discharged in {simulation.multiphysics.valveOpenings[c.id] ?? 0} openings</p>
    <div className="measurement-list summary">
      <div><span>Responds at</span><strong>{fmt(set / 1e5, 2)} bar</strong></div>
      <div><span>Full lift at</span><strong>{fmt(full / 1e5, 2)} bar</strong><small>{fmt(fullLiftFlow(c, full) * 60000, 1)} L/min</small></div>
      <div><span>Reseats at</span><strong>{fmt(reseat / 1e5, 2)} bar</strong></div>
    </div>
    <details style={{ marginTop: 12 }}><summary className="section-label">Model basis · data provenance</summary>
      {safetyValveModelBasis(c).map(b => <p className="field-hint" key={b.kind}><strong>{pressureBasisLabels[b.kind]}:</strong> {b.text}</p>)}
    </details>
  </div>;
}
