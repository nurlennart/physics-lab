import { useEffect, useState } from 'react';
import { actions, simulation } from '../editor/store';
import { prop, type Component } from '../simulation/model';
import { circuitIndices, circuitKey, manifoldBasisLabels, manifoldModelBasis, meterReading } from '../simulation/heating-manifold';

const fmt = (v: number, digits = 1) => v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

function Cell({ label, value, change }: { label: string; value: number; change: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return <input aria-label={label} inputMode="decimal" value={draft} onChange={e => setDraft(e.target.value)}
    onBlur={() => { const v = Number(draft); if (draft.trim() && Number.isFinite(v) && v !== value) change(v); else setDraft(String(value)); }}
    onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()} style={{ width: '4.5em' }} />;
}

/** Per-circuit inserts, planned and metered flows, actuators and balancing of an Oventrop Multidis SF manifold. */
export function HeatingManifoldInspector({ c }: { c: Component }) {
  const started = simulation.time > 0, readings = simulation.multiphysics.hydraulic.readings, h = readings[c.id];
  const range = prop(c, 'meterRange'), wired = new Set(simulation.project.connections.filter(w => w.domain === 'control' && w.to.component === c.id).map(w => w.to.port));
  const connected = (k: number) => simulation.project.connections.some(w => (w.from.component === c.id && w.from.port === `flow${k}`) || (w.to.component === c.id && w.to.port === `flow${k}`));
  const dp = h?.differentialPressure ?? 0;
  return <div className="inspector-section" data-testid="manifold-section">
    <div className="section-label">Heating circuit manifold · Oventrop Multidis SF · {circuitIndices(c).length} circuits</div>
    <p className="field-hint" data-testid="manifold-status">{started ? `${fmt(Math.abs(h?.flow ?? 0) * 60000)} l/min in total · Δp flow to return bar ${fmt(dp / 1000)} kPa${dp > prop(c, 'maxDifferentialPressure') ? ' (above the 1 bar limit)' : ''}` : `kvs ${prop(c, 'kvs')} m³/h per circuit · flow meters 0–${range} l/min`}</p>
    <table className="manifold-table" data-testid="manifold-circuits" style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
      <thead><tr><th style={{ textAlign: 'left' }}>Circuit</th><th>Setting %</th><th>Planned l/min</th><th>Meter l/min</th><th>Actuator</th></tr></thead>
      <tbody>{circuitIndices(c).map(k => {
        const q = readings[circuitKey(c.id, k)]?.flow ?? 0, meter = meterReading(q, range), stroke = simulation.multiphysics.positions[circuitKey(c.id, k)] ?? 100;
        return <tr key={k} data-testid={`manifold-circuit-${k}`}>
          <td>{k}{connected(k) ? '' : ' · plugged'}</td>
          <td><Cell label={`Circuit ${k} setting`} value={prop(c, `setting${k}`)} change={v => actions.property(c.id, `setting${k}`, v)} /></td>
          <td><Cell label={`Circuit ${k} planned flow`} value={prop(c, `planned${k}`)} change={v => actions.property(c.id, `planned${k}`, v)} /></td>
          <td style={{ textAlign: 'right' }}>{started && connected(k) ? `${meter.beyond ? '> ' : ''}${fmt(meter.value, 2)}` : '—'}</td>
          <td style={{ textAlign: 'right' }}>{wired.has(`act${k}`) ? `${fmt(stroke, 0)} %` : 'none (open)'}</td>
        </tr>;
      })}</tbody>
    </table>
    <button className="text-link" data-testid="manifold-balance" disabled={!started} onClick={() => actions.balanceManifold(c.id)}>Balance to planned flows</button>
    <p className="field-hint">Balancing sets each regulating insert for its planned flow at the measured bar-to-bar differential pressure, as an installer does by reading the flow meters. The pump then meets a new total flow, so advance and balance again: a few rounds converge. A circuit that cannot reach its planned flow stays fully open. Wired actuators are normally closed: true opens, false or a lost signal closes over {prop(c, 'actuatorTime')} s.</p>
    <details style={{ marginTop: 12 }}><summary className="section-label">Model basis · data provenance</summary>
      {manifoldModelBasis(c).map(b => <p className="field-hint" key={b.kind} data-testid={`manifold-basis-${b.kind}`}><strong>{manifoldBasisLabels[b.kind]}:</strong> {b.text}</p>)}
    </details>
  </div>;
}
