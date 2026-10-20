import { simulation } from '../editor/store';
import { type Component, projectWeather } from '../simulation/model';
import { panelConditions } from '../simulation/solar';
import { batteryEnergy } from '../simulation/devices';
import { panelModel } from '../simulation/solar-circuits';
import { solarVariantProvenance } from '../simulation/solar-provenance';
export function SolarInspector({ c }: { c: Component }) {
  const r = simulation.electrical.readings[c.id], s = r?.solar, provenance = solarVariantProvenance(c.kind, c.variant);
  if (!provenance) return null;
  const weather = projectWeather(simulation.project), conditions = c.kind === 'solarPanel' ? panelConditions(c, weather) : null, m = c.kind === 'solarPanel' ? panelModel(c, weather) : null;
  const maxV = m ? Math.max(1, m.voc) : 1, maxI = m ? Math.max(1, m.isc) : 1, maxP = m ? Math.max(1, m.pmp) : 1;
  const x = (v: number) => 30 + v / maxV * 240, yi = (i: number) => 135 - i / maxI * 110, yp = (p: number) => 135 - p / maxP * 110;
  const samples = m ? Array.from({ length: 101 }, (_, k) => { const v = maxV * k / 100, i = m.at(v).current; return { v, i, p: v * i }; }) : [];
  return <section className="inspector-section" aria-label="Solar energy model">
    <div className="section-label">Energy flow & operating state</div>
    <p role="status">{simulation.time === 0 ? 'Ready · paused solve preview' : s?.mode ?? (c.kind === 'lfpBattery' ? (r?.current ?? 0) > 0 ? 'Charging' : (r?.current ?? 0) < 0 ? 'Discharging' : 'Idle / BMS limited' : 'Off')}</p>
    {c.kind === 'lfpBattery' && <p>{((simulation.devices.batteries[c.id] ?? 0) * 100).toFixed(2)}% SOC · {(batteryEnergy(c, simulation.devices.batteries[c.id] ?? 0) / 3600000).toFixed(3)} kWh chemical storage · {(r?.chemicalPower ?? 0).toFixed(1)} W into storage</p>}
    {simulation.time > 0 && s && c.kind !== 'lfpBattery' && <p>{s.inputPower.toFixed(1)} W in → {s.outputPower.toFixed(1)} W out · {(r?.heatPower ?? 0).toFixed(1)} W loss</p>}
    {c.kind === 'mpptController' && simulation.time > 0 && <p>{s?.trackingActive ? 'P&O tracking active' : 'Tracking held during regulation / curtailment'} · target {(s?.targetVoltage ?? 0).toFixed(2)} V</p>}
    {m && <>
      <svg viewBox="0 0 300 165" role="img" aria-label="PV I-V and P-V curves with operating point and maximum power point">
        <path d="M30 15V135H280" fill="none" stroke="currentColor" />
        <polyline points={samples.map(p => `${x(p.v)},${yi(p.i)}`).join(' ')} fill="none" stroke="#38bdf8" strokeWidth="2" />
        <polyline points={samples.map(p => `${x(p.v)},${yp(p.p)}`).join(' ')} fill="none" stroke="#f59e0b" strokeWidth="2" />
        <circle cx={x(m.vmp)} cy={yp(m.pmp)} r="4" fill="#f59e0b" />
        <circle cx={x(r?.voltage ?? 0)} cy={yi(-(r?.current ?? 0))} r="4" fill="#38bdf8" />
        <text x="30" y="155" fill="currentColor" fontSize="10">0 V</text><text x="230" y="155" fill="currentColor" fontSize="10">{m.voc.toFixed(1)} V</text>
        <text x="35" y="12" fill="#38bdf8" fontSize="10">I: {m.isc.toFixed(2)} A</text><text x="170" y="12" fill="#f59e0b" fontSize="10">P: {m.pmp.toFixed(1)} W</text>
      </svg>
      <p>Blue: current & operating point. Amber: power & MPP. Independent vertical scales.</p>
      <p>{conditions!.irradiance.toFixed(0)} W/m² · {conditions!.cellTemperature.toFixed(1)} °C cell{conditions!.fromWeather ? ' (from the weather: sun and outdoor air)' : ''} · MPP {m.vmp.toFixed(2)} V × {m.imp.toFixed(2)} A</p>
    </>}
    <details><summary>Model provenance & limitations</summary><p><a href={provenance.url} target="_blank" rel="noreferrer">{provenance.reference}</a></p><p>{provenance.facts}</p><p>{provenance.assumptions}</p></details>
  </section>;
}
