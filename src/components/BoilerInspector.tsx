import { actions, simulation, useLab } from '../editor/store';
import { prop, type Component } from '../simulation/model';
import { boilerBasis, boilerReference } from '../simulation/boiler';
import { T } from '../theme/tokens';

export function BoilerInspector({ c }: { c: Component }) {
  const lab = useLab(), state = simulation.multiphysics.boilers[c.id], r = simulation.electrical.readings[c.id];
  const supply = simulation.fluidTemperatureMeasurement(c.id) ?? prop(c, 'initialTemperature');
  const history = simulation.samples.filter(s => s.boilerTemperatures?.[c.id]).slice(-1200);
  const start = history[0]?.time ?? 0, span = Math.max(1, (history.at(-1)?.time ?? 0) - start);
  const data = history.flatMap(s => { const t = s.boilerTemperatures![c.id]; return [t.supply, t.element, t.target]; });
  const low = Math.min(20, ...data), high = Math.max(100, ...data), y = (t: number) => 116 - 98 * (t - low) / (high - low);
  const curve = (key: 'supply' | 'element' | 'target') => history.map(s => `${22 + 214 * (s.time - start) / span},${y(s.boilerTemperatures![c.id][key])}`).join(' ');
  return <div className="inspector-section" data-testid="boiler-section">
    <div className="section-label">Bosch Tronic Heat 3000 · 9 kW</div>
    <p className={`field-hint${state?.fault ? ' warn' : ''}`} data-testid="boiler-status"><strong>{state?.status ?? 'Ready'}</strong> · supply {supply.toFixed(1)} °C → target {(state?.setpoint ?? prop(c, 'setpoint')).toFixed(1)} °C</p>
    <svg viewBox="0 0 260 160" role="img" aria-label="Boiler water, element and target temperature history">
      <path d="M22 15V116H238" fill="none" stroke={T.n11}/>
      <path d={`M22 ${y(prop(c, 'tripTemperature'))}H238`} stroke={T.faultText} strokeDasharray="2 4"/>
      <polyline points={curve('target')} fill="none" stroke={T.n13} strokeDasharray="4 3"/>
      <polyline points={curve('element')} fill="none" stroke={T.electricalText} strokeWidth="1.5"/>
      <polyline points={curve('supply')} fill="none" stroke={T.thermalText} strokeWidth="2"/>
      <text x="22" y="132" fill={T.n13} fontSize="10">{low.toFixed(0)}–{high.toFixed(0)} °C · last {span.toFixed(0)} s</text>
      <text x="22" y="148" fill={T.thermalText} fontSize="10">Water</text><text x="74" y="148" fill={T.electricalText} fontSize="10">Element</text><text x="140" y="148" fill={T.n13} fontSize="10">Target ··· limiter</text>
    </svg>
    <div className="measurement-list" style={{ gridTemplateColumns: '1fr' }}>{[0, 1, 2].map(i => <div key={i}><span>L{i + 1} · stage {i + 1}</span><strong>{r?.stageVoltages?.[i]?.toFixed(1) ?? '—'} V · {r?.stageCurrents?.[i]?.toFixed(2) ?? '—'} A</strong></div>)}</div>
    <p className="field-hint">External pump required. Three-phase: wire L1/L2/L3 to separate 230 V phases with shared N. Single-phase: bridge all three live terminals to 230 V. PE is the isolated chassis; earth-fault leakage is outside this model.</p>
    <button className="fault-button" disabled={!state?.fault || lab.busy} onClick={() => actions.resetSafety(c.id)}>Manually reset boiler protection</button>
    <details><summary className="section-label">Model basis · specifications and assumptions</summary>
    {boilerBasis.map(b => <p className="field-hint" key={b.label}><strong>{b.label}:</strong> {b.text}</p>)}
    <a href={boilerReference} target="_blank" rel="noreferrer">Bosch installation manual · 6720859226</a></details>
  </div>;
}
