import { useState, type ReactNode } from 'react';
import { actions, simulation, useLab } from '../editor/store';
import { prop, type Component } from '../simulation/model';
import { heatPumpBasis } from '../simulation/heat-pump';
import { heatPumpSources } from '../simulation/heat-pump-data';
import { characteristicFlow, characteristicTable, referenceTable } from '../simulation/heat-pump-tables';
import { T } from '../theme/tokens';

const kw = (w: number) => `${(w / 1000).toFixed(2)} kW`;
/** A <details> panel whose body mounts only while open, so collapsed panels compute nothing. */
function Lazy({ summary, testId, children }: { summary: ReactNode; testId: string; children: () => ReactNode }) {
  const [open, setOpen] = useState(false);
  return <details data-testid={testId} onToggle={e => setOpen(e.currentTarget.open)}><summary className="section-label">{summary}</summary>{open && children()}</details>;
}
/** Cached by flow temperature, rated voltage and maximum current (heat-pump-tables.ts), not by telemetry. */
function Characteristic({ c, flow }: { c: Component; flow: number }) {
  return <><div className="measurement-list summary" style={{ gridTemplateColumns: '1fr' }} data-testid="heat-pump-characteristic">{characteristicTable(c, flow).map(m => <div key={m.air}><span>A{m.air}</span><strong>{m.range ? `${kw(m.range.min)}–${kw(m.range.max)} · COP ${m.range.minCOP.toFixed(2)}–${m.range.maxCOP.toFixed(2)}` : 'outside envelope'}</strong></div>)}</div>
    <p className="field-hint">Range from minimum speed to the speed or 13.1 A current limit. Defrost lowers the integrated output and COP below about +5 °C in humid air.</p></>;
}
/** Computed once from the published points and the fitted constants. */
function Reference() {
  return <><div className="measurement-list summary" style={{ gridTemplateColumns: '1fr' }} data-testid="heat-pump-reference">{referenceTable().map(r =>
    <div key={r.label}><span>{r.label} · {kw(r.output)} ({r.fit ? 'fitted' : 'withheld'})</span><strong>Bosch {r.bosch.toFixed(2)} · model {r.model.toFixed(2)} ({((r.model / r.bosch - 1) * 100).toFixed(1)} %)</strong></div>)}</div>
    <p className="field-hint">Model COPs are steady (frost-free) at the published output; withheld A2 points include defrost in the Bosch tests.</p></>;
}

export function HeatPumpInspector({ c }: { c: Component }) {
  const lab = useLab(), st = simulation.multiphysics.heatPumps[c.id], view = simulation.multiphysics.heatPumpView[c.id], started = simulation.time > 0;
  const flow = simulation.fluidTemperatureMeasurement(c.id) ?? prop(c, 'initialTemperature');
  const history = simulation.samples.filter(s => s.heatPumps?.[c.id]).slice(-1200);
  const start = history[0]?.time ?? 0, span = Math.max(1, (history.at(-1)?.time ?? 0) - start);
  const temps = history.flatMap(s => { const h = s.heatPumps![c.id]; return [h.flow, h.ret, h.target]; });
  const low = Math.min(10, ...temps), high = Math.max(60, ...temps), y = (t: number) => 104 - 86 * (t - low) / (high - low);
  const curve = (key: 'flow' | 'ret' | 'target') => history.map(s => `${22 + 214 * (s.time - start) / span},${y(s.heatPumps![c.id][key])}`).join(' ');
  const peak = Math.max(1000, ...history.map(s => Math.max(Math.abs(s.heatPumps![c.id].heat), s.heatPumps![c.id].electrical + s.heatPumps![c.id].backup)));
  const yp = (w: number) => 146 - 30 * w / peak;
  const powerCurve = (f: (h: NonNullable<typeof history[number]['heatPumps']>[string]) => number) => history.map(s => `${22 + 214 * (s.time - start) / span},${yp(f(s.heatPumps![c.id]))}`).join(' ');
  const air = view?.inputs.air ?? simulation.project.environment?.ambient ?? 20;
  const target = st?.target ?? prop(c, 'setpoint');
  const spf = st && st.electricity > 0 ? (st.heat - st.defrostHeat) / st.electricity : null;
  const rows: [string, string][] = [
    ['Mode', st?.status ?? 'Ready'],
    ['Flow → target', `${flow.toFixed(1)} → ${target.toFixed(1)} °C${st && st.requested > target + 0.05 ? ` (requested ${st.requested.toFixed(1)} °C; envelope limit)` : ''}`],
    ['Outdoor air', `${air.toFixed(1)} °C · ${prop(c, 'relativeHumidity').toFixed(0)} % RH`],
    ['Heat output', started && view ? kw(view.heatOutput) : '—'],
    ['Electrical input', started && view ? `${kw(view.electrical)}${view.backup > 0 ? ` + backup ${kw(view.backup)}` : ''}` : '—'],
    ['COP (instantaneous)', view?.cop != null ? view.cop.toFixed(2) : '—'],
    ['Compressor speed', `${((st?.speed ?? 0) * 100).toFixed(0)} %`],
    ['Evaporating / condensing', started && view && view.plan.mode !== 'off' && view.plan.mode !== 'drip' ? `${view.plan.point.evaporating.toFixed(1)} / ${view.plan.point.condensing.toFixed(1)} °C` : '—'],
    ['Heat from outdoor air', started && view ? kw(view.plan.air) : '—'],
    ['Frost on coil', `${((st?.frost ?? 0) * 1000).toFixed(0)} g of ${(prop(c, 'frostTrigger') * 1000).toFixed(0)} g trigger · coil ${(st?.coilTemperature ?? air).toFixed(1)} °C`],
    ['Starts (last hour / total)', `${st?.starts.length ?? 0} / ${st?.startCount ?? 0} (max ${prop(c, 'maxStarts')}/h)`],
    ['Defrosts', `${st?.defrosts ?? 0}${st && st.defrostHeat > 0 ? ` · ${(st.defrostHeat / 3.6e6).toFixed(3)} kWh from the water` : ''}`],
    ['Seasonal performance factor', spf !== null ? `${spf.toFixed(2)} (${((st!.heat - st!.defrostHeat) / 3.6e6).toFixed(2)} kWh / ${(st!.electricity / 3.6e6).toFixed(2)} kWh)` : '—'],
  ];
  const flowShown = characteristicFlow(target);
  return <div className="inspector-section" data-testid="heat-pump-section">
    <div className="section-label">Bosch Compress 6800i AW 7 OR-S · R290</div>
    <p className={`field-hint${st?.fault || st?.backupFault ? ' warn' : ''}`} data-testid="heat-pump-status"><strong>{st?.status ?? 'Ready'}</strong></p>
    <div className="measurement-list summary" style={{ gridTemplateColumns: '1fr' }}>{rows.map(([k, v]) => <div key={k}><span>{k}</span><strong>{v}</strong></div>)}</div>
    <svg viewBox="0 0 260 176" role="img" aria-label="Heat pump flow, return and target temperature; heat output and electrical input history">
      <path d="M22 15V104H238M22 116V146H238" fill="none" stroke={T.n11}/>
      <polyline points={curve('target')} fill="none" stroke={T.n13} strokeDasharray="4 3"/>
      <polyline points={curve('ret')} fill="none" stroke={T.hydraulic} strokeWidth="1.5"/>
      <polyline points={curve('flow')} fill="none" stroke={T.thermalText} strokeWidth="2"/>
      <polyline points={powerCurve(h => Math.max(0, h.heat))} fill="none" stroke={T.thermalText} strokeWidth="1.25"/>
      <polyline points={powerCurve(h => h.electrical + h.backup)} fill="none" stroke={T.electricalText} strokeWidth="1.25"/>
      <text x="22" y="160" fill={T.n13} fontSize="10">{low.toFixed(0)}–{high.toFixed(0)} °C · 0–{(peak / 1000).toFixed(1)} kW · last {span.toFixed(0)} s</text>
      <text x="22" y="173" fill={T.thermalText} fontSize="10">Flow / heat</text><text x="88" y="173" fill={T.hydraulic} fontSize="10">Return</text><text x="132" y="173" fill={T.electricalText} fontSize="10">Electrical</text><text x="192" y="173" fill={T.n13} fontSize="10">Target</text>
    </svg>
    <Lazy testId="heat-pump-characteristic-panel" summary={`Characteristic at ${flowShown} °C flow (model, frost-free)`}>{() => <Characteristic c={c} flow={flowShown} />}</Lazy>
    <p className="field-hint">External circulator required (Bosch: 20 l/min underfloor, 12.5 l/min radiators; 14 l/min during defrost). Wire L/N to 230 V for the outdoor unit and, for the backup heater, BL/BN to 230 V (3 kW per stage). A rising edge on DEF requests a manual defrost below 15 °C outdoor.</p>
    <button className="fault-button" disabled={!(st?.fault || st?.backupFault) || lab.busy} onClick={() => actions.resetSafety(c.id)}>Reset heat pump protection</button>
    <Lazy testId="heat-pump-basis-panel" summary="Model basis · manufacturer data and assumptions">{() => <>
      {heatPumpBasis.map(b => <p className="field-hint" key={b.label}><strong>{b.label}:</strong> {b.text}</p>)}
      <Reference />
      {Object.values(heatPumpSources).map(s => <p className="field-hint" key={s.url}><a href={s.url} target="_blank" rel="noreferrer">{s.label}</a></p>)}
    </>}</Lazy>
  </div>;
}
