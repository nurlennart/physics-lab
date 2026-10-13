import { simulation } from '../editor/store';
import { prop, type Component } from '../simulation/model';
import { en442Output, kermiChartSlope, kermiHydraulics, kermiModels, kermiReference, logMeanExcess, nominalMassFlow, panelBasisLabels, panelCellCapacity, panelModelBasis, tablePairs } from '../simulation/panel-radiator';
import { T } from '../theme/tokens';

const fmt = (v: number, digits = 1) => v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export function PanelRadiatorInspector({ c }: { c: Component }) {
  const started = simulation.time > 0, h = simulation.multiphysics.hydraulic.readings[c.id], cells = simulation.multiphysics.pipeCells[c.id] ?? [];
  const air = prop(c, 'ambient', 20), model = kermiModels[c.variant ?? 'standard'];
  const mean = cells.length ? cells.reduce((a, t) => a + t, 0) / cells.length - 273.15 : prop(c, 'initialTemperature');
  const flow = h?.flow ?? 0, flowing = started && Math.abs(flow) >= 1e-12, massFlow = Math.abs(flow) * 1000 * 3600;
  const output = started ? h?.duty ?? 0 : 0, input = started ? h?.heatInput ?? 0 : 0;
  const stored = cells.reduce((sum, t) => sum + panelCellCapacity(c) * (t - 273.15 - air), 0);
  const status = !started ? 'Ready' : flowing ? `${flow < 0 ? 'Reverse flow · ' : ''}Heating the room` : 'No flow: stored heat goes to the room';

  // Temperature history (supply, return, mean water, air).
  const history = simulation.samples.filter(s => s.panelTemperatures?.[c.id]).slice(-1200);
  const start = history[0]?.time ?? 0, span = Math.max(1, (history.at(-1)?.time ?? 0) - start);
  const values = history.flatMap(s => { const t = s.panelTemperatures![c.id]; return [t.ret, t.mean, t.air, ...(t.supply === null ? [] : [t.supply])]; });
  const low = Math.floor(Math.min(air, ...values) / 10) * 10, high = Math.max(low + 10, Math.ceil(Math.max(air + 10, ...values) / 10) * 10);
  const ty = (t: number) => 116 - 98 * (t - low) / (high - low), tx = (time: number) => 22 + 214 * (time - start) / span;
  const line = (key: 'ret' | 'mean' | 'air') => history.map(s => `${tx(s.time)},${ty(s.panelTemperatures![c.id][key])}`).join(' ');
  const supplyLine = history.filter(s => s.panelTemperatures![c.id].supply !== null).map(s => `${tx(s.time)},${ty(s.panelTemperatures![c.id].supply!)}`).join(' ');

  // EN 442 characteristic Φ(ΔT) with Kermi's published points and the present operating point.
  const maxExcess = 60, maxOutput = en442Output(c, maxExcess), cx = (dt: number) => 22 + 214 * dt / maxExcess, cy = (q: number) => 116 - 98 * q / maxOutput;
  const curve = Array.from({ length: 61 }, (_, i) => `${cx(i)},${cy(en442Output(c, i))}`).join(' ');
  const catalog = model && prop(c, 'ratedOutput') === model.output && prop(c, 'exponent') === model.exponent;
  const published = catalog ? [[75, 65, model.output], ...tablePairs.map(([s, r], i) => [s, r, model.table[i] * model.length / 1000])] : [[75, 65, prop(c, 'ratedOutput')]];
  const excess = h?.excessTemperature ?? mean - air;

  const group = model?.hydraulic ?? '12-33', chart = kermiHydraulics[group].chartPa100 * (massFlow / 100) ** kermiChartSlope;
  return <div className="inspector-section" data-testid="panel-radiator-section">
    <div className="section-label">{model ? `Kermi therm-x2 Profil-K · type ${model.type} · ${model.height} × ${model.length} mm` : 'Panel radiator'}</div>
    <p className="field-hint" data-testid="panel-status"><strong>{status}</strong> · {started ? `${fmt(output, 0)} W to the ${fmt(air)} °C room air · mean water ${fmt(mean)} °C` : `Φ₅₀ ${fmt(prop(c, 'ratedOutput'), 0)} W at 75/65/20 °C · water at ${fmt(mean)} °C`}</p>
    <svg viewBox="0 0 260 160" role="img" aria-label="Radiator supply, return, mean water and room air temperature history">
      <path d="M22 15V116H238" fill="none" stroke={T.n11}/>
      <polyline points={line('air')} fill="none" stroke={T.n13} strokeDasharray="4 3"/>
      <polyline points={line('ret')} fill="none" stroke={T.hydraulicText} strokeWidth="1.5"/>
      <polyline points={line('mean')} fill="none" stroke={T.thermal} strokeWidth="1"/>
      {supplyLine && <polyline points={supplyLine} fill="none" stroke={T.thermalText} strokeWidth="2"/>}
      <text x="22" y="132" fill={T.n13} fontSize="10">{low}–{high} °C · last {fmt(span, 0)} s</text>
      <text x="22" y="148" fill={T.thermalText} fontSize="10">Supply</text><text x="66" y="148" fill={T.hydraulicText} fontSize="10">Return</text><text x="110" y="148" fill={T.thermal} fontSize="10">Mean</text><text x="148" y="148" fill={T.n13} fontSize="10">Room air ···</text>
    </svg>
    <svg viewBox="0 0 260 160" role="img" aria-label="EN 442 characteristic: heat output versus excess temperature with Kermi published points and the operating point">
      <path d="M22 15V116H238" fill="none" stroke={T.n11}/>
      <polyline points={curve} fill="none" stroke={T.thermalText} strokeWidth="2"/>
      {published.map(([s, r, q]) => <circle key={`${s}/${r}`} cx={cx(logMeanExcess(s, r, 20))} cy={cy(q)} r="3.5" fill="none" stroke={T.n14}/>)}
      {started && <circle cx={cx(Math.max(0, Math.min(maxExcess, excess)))} cy={cy(Math.max(0, Math.min(maxOutput, output)))} r="4" fill={T.electricalText}/>}
      <text x="22" y="132" fill={T.n13} fontSize="10">ΔT 0–{maxExcess} K · Φ 0–{fmt(maxOutput, 0)} W</text>
      <text x="22" y="148" fill={T.thermalText} fontSize="10">EN 442 curve</text><text x="96" y="148" fill={T.n14} fontSize="10">○ Kermi table</text><text x="170" y="148" fill={T.electricalText} fontSize="10">● now</text>
    </svg>
    <p className="field-hint">Curve: Φ = K_m·ΔT^n from Φ₅₀ and n. Circles: {catalog ? 'Kermi published outputs at 75/65, 70/55, 55/45 and 45/40 °C (20 °C air)' : 'the configured Φ₅₀'}. Dot: present output against the mean exchange excess; it leaves the curve only while the water and steel store or release heat.</p>
    <div className="measurement-list summary" data-testid="panel-readings">
      <div><span>Supply water</span><strong>{flowing && h?.supplyTemperature !== undefined ? `${fmt(h.supplyTemperature - 273.15)} °C` : '—'}</strong></div>
      <div><span>Return water</span><strong>{flowing && h?.returnTemperature !== undefined ? `${fmt(h.returnTemperature - 273.15)} °C` : '—'}</strong></div>
      <div><span>Excess ΔT (EN 442)</span><strong>{fmt(excess)} K</strong></div>
      <div><span>Heat output</span><strong>{started ? `${fmt(output, 0)} W` : '—'}</strong></div>
      <div><span>Water heat input ṁ·c·ΔT</span><strong>{started ? `${fmt(input, 0)} W` : '—'}</strong></div>
      <div><span>Radiant / convective</span><strong>{started ? `${fmt(output * prop(c, 'radiantShare') / 100, 0)} / ${fmt(output * (1 - prop(c, 'radiantShare') / 100), 0)} W` : '—'}</strong></div>
      <div><span>Stored above room air</span><strong>{fmt(stored / 1000)} kJ</strong></div>
      <div><span>Mass flow</span><strong>{started ? `${fmt(massFlow)} kg/h` : '—'}</strong><small>nominal {fmt(nominalMassFlow(c) * 3600)} kg/h</small></div>
      <div><span>Pressure drop</span><strong>{started ? `${fmt((h?.differentialPressure ?? 0) / 100, 2)} mbar` : '—'}</strong>{started && massFlow > 1 && model && prop(c, 'lossCoefficient') === kermiHydraulics[group].lossCoefficient && prop(c, 'laminarK') === kermiHydraulics[group].laminarK && prop(c, 'diameter') === 0.016 && <small>Kermi chart {fmt(chart / 100, 2)} mbar</small>}</div>
    </div>
    <details style={{ marginTop: 12 }}><summary className="section-label">Model basis · data provenance</summary>
      {panelModelBasis(c).map(b => <p className="field-hint" key={b.kind} data-testid={`panel-basis-${b.kind}`}><strong>{panelBasisLabels[b.kind]}:</strong> {b.text}</p>)}
      <p className="field-hint">{kermiReference.note}</p>
      <a href={kermiReference.url} target="_blank" rel="noreferrer">{kermiReference.title}</a>
    </details>
  </div>;
}
