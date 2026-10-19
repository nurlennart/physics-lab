import { effectiveAmbient } from "../simulation/environment";
import { simulation } from '../editor/store';
import { prop, type Component } from '../simulation/model';
import { FLOORTEC_B, belowBoundary, characteristic, floorBasisLabels, floorCellCapacity, floorModelBasis, floortec, limitFlux, loopCount, screedCapacity, screedKey, surfaceTemperature } from '../simulation/underfloor-heating';
import { T } from '../theme/tokens';

const fmt = (v: number, digits = 1) => v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export function UnderfloorHeatingInspector({ c }: { c: Component }) {
  const started = simulation.time > 0, h = simulation.multiphysics.hydraulic.readings[c.id];
  const water = simulation.multiphysics.pipeCells[c.id] ?? [], screed = simulation.multiphysics.pipeCells[screedKey(c.id)] ?? [];
  const air = effectiveAmbient(simulation.project, c), below = belowBoundary(simulation.project, c), area = prop(c, 'heatedArea');
  const average = (t: number[], fallback: number) => t.length ? t.reduce((a, x) => a + x, 0) / t.length - 273.15 : fallback;
  const mean = average(water, prop(c, 'initialTemperature')), plane = average(screed, prop(c, 'initialTemperature'));
  const flow = h?.flow ?? 0, flowing = started && Math.abs(flow) >= 1e-12, massFlow = Math.abs(flow) * 1000 * 3600;
  const output = started ? h?.duty ?? 0 : 0, downward = started ? h?.downwardLoss ?? 0 : 0, input = started ? h?.heatInput ?? 0 : 0, flux = output / area;
  const surface = surfaceTemperature(flux, air), maxSurface = prop(c, 'maxSurfaceTemperature'), limit = limitFlux(maxSurface, air);
  const stored = water.reduce((sum, t) => sum + floorCellCapacity(c) * (t - 273.15 - air), 0) + screed.reduce((sum, t) => sum + screedCapacity(c) * (t - 273.15 - air), 0);
  const room = c.thermalSpaceId && simulation.project.thermalSpaces?.find(s => s.id === c.thermalSpaceId);
  const status = !started ? 'Ready' : surface > maxSurface ? `Floor surface above ${maxSurface} °C` : flowing ? `${flow < 0 ? 'Reverse flow · ' : ''}Heating the floor` : 'No flow: the screed releases its heat';
  const belowName = below.space ? simulation.project.thermalSpaces?.find(s => s.id === below.space)?.name ?? 'room below' : below.ground ? 'the ground' : room ? 'outdoors' : 'ambient';

  // Temperature history: supply, return, mean water, screed, surface, room air.
  const history = simulation.samples.filter(s => s.floorTemperatures?.[c.id]).slice(-1200);
  const start = history[0]?.time ?? 0, span = Math.max(1, (history.at(-1)?.time ?? 0) - start);
  const values = history.flatMap(s => { const t = s.floorTemperatures![c.id]; return [t.ret, t.mean, t.screed, t.surface, t.air, ...(t.supply === null ? [] : [t.supply])]; });
  const low = Math.floor(Math.min(air, ...values) / 5) * 5, high = Math.max(low + 10, Math.ceil(Math.max(air + 10, ...values) / 5) * 5);
  const ty = (t: number) => 116 - 98 * (t - low) / (high - low), tx = (time: number) => 22 + 214 * (time - start) / span;
  type Key = 'ret' | 'mean' | 'screed' | 'surface' | 'air';
  const line = (key: Key) => history.map(s => `${tx(s.time)},${ty(s.floorTemperatures![c.id][key])}`).join(' ');
  const supplyLine = history.filter(s => s.floorTemperatures![c.id].supply !== null).map(s => `${tx(s.time)},${ty(s.floorTemperatures![c.id].supply!)}`).join(' ');

  // EN 1264 characteristic q(Δθ_H) with the FLOORTEC point for this spacing and covering, the limit flux and the operating point.
  const k = characteristic(c), maxExcess = 30, maxFlux = Math.max(k * maxExcess, limit * 1.1), cx = (dt: number) => 22 + 214 * dt / maxExcess, cy = (q: number) => 116 - 98 * q / maxFlux;
  const catalog = prop(c, 'systemConstant') === FLOORTEC_B && prop(c, 'outerDiameter') === 0.016 && prop(c, 'screedCover') === floortec.cover;
  const row = [0, 0.05, 0.1, 0.15].indexOf(prop(c, 'coveringResistance')), column = floortec.spacings.findIndex(t => Math.abs(t - prop(c, 'pipeSpacing')) < 1e-9);
  const tabulated = catalog && row >= 0 && column >= 0 ? floortec.flux[row][column] / floortec.excess : undefined;
  const excess = h?.excessTemperature ?? mean - air;
  return <div className="inspector-section" data-testid="underfloor-section">
    <div className="section-label">Underfloor heating · {fmt(area, 1)} m² · {fmt(prop(c, 'pipeSpacing') * 1000, 0)} mm spacing · {loopCount(c)} × {fmt(prop(c, 'length'), 0)} m</div>
    <p className="field-hint" data-testid="underfloor-status"><strong>{status}</strong> · {started ? `${fmt(output, 0)} W to the ${fmt(air)} °C room, ${fmt(downward, 0)} W down to ${belowName}` : `K_H ${fmt(k, 2)} W/(m²·K) · water and screed at ${fmt(mean)} °C`}</p>
    {below.ground && <p className="field-hint" data-testid="underfloor-ground">On the ground: downward loss crosses R_u {fmt(prop(c, 'downwardResistance'), 2)} plus the soil's {fmt(below.resistance, 2)} m²·K/W (EN ISO 13370 share for this slab, below this floor's own layers) to the fixed {fmt(below.temperature)} °C ground boundary.</p>}
    {!room && <p className="field-hint">Not in a Thermal Space: the floor heats the {c.props.ambientMode === 'override' ? 'local' : 'experiment'} ambient, which also stands for the space below. Assign it to a room to heat that room.</p>}
    <svg viewBox="0 0 260 160" role="img" aria-label="Underfloor supply, return, mean water, screed, floor surface and room air temperature history">
      <path d="M22 15V116H238" fill="none" stroke={T.n11}/>
      <polyline points={line('air')} fill="none" stroke={T.n13} strokeDasharray="4 3"/>
      <polyline points={line('surface')} fill="none" stroke={T.n14} strokeWidth="1"/>
      <polyline points={line('screed')} fill="none" stroke={T.thermal} strokeWidth="2"/>
      <polyline points={line('ret')} fill="none" stroke={T.hydraulicText} strokeWidth="1.5"/>
      <polyline points={line('mean')} fill="none" stroke={T.thermal} strokeWidth="1" strokeDasharray="2 2"/>
      {supplyLine && <polyline points={supplyLine} fill="none" stroke={T.thermalText} strokeWidth="2"/>}
      <text x="22" y="132" fill={T.n13} fontSize="10">{low}–{high} °C · last {fmt(span / 3600, 1)} h</text>
      <text x="22" y="148" fill={T.thermalText} fontSize="10">Supply</text><text x="58" y="148" fill={T.hydraulicText} fontSize="10">Return</text><text x="96" y="148" fill={T.thermal} fontSize="10">Screed</text><text x="134" y="148" fill={T.n14} fontSize="10">Surface</text><text x="176" y="148" fill={T.n13} fontSize="10">Room ···</text>
    </svg>
    <svg viewBox="0 0 260 160" role="img" aria-label="EN 1264 characteristic: heat flux versus heating medium excess temperature, FLOORTEC table point, limit heat flux and operating point">
      <path d="M22 15V116H238" fill="none" stroke={T.n11}/>
      <line x1={cx(0)} y1={cy(0)} x2={cx(maxExcess)} y2={cy(k * maxExcess)} stroke={T.thermalText} strokeWidth="2"/>
      <line x1={cx(0)} y1={cy(limit)} x2={cx(maxExcess)} y2={cy(limit)} stroke={T.warning} strokeDasharray="4 3"/>
      {tabulated !== undefined && [15, 20, 25, 30].map(dt => <circle key={dt} cx={cx(dt)} cy={cy(tabulated * dt)} r="3.5" fill="none" stroke={T.n14}/>)}
      {started && <circle cx={cx(Math.max(0, Math.min(maxExcess, excess)))} cy={cy(Math.max(0, Math.min(maxFlux, flux)))} r="4" fill={T.electricalText}/>}
      <text x="22" y="132" fill={T.n13} fontSize="10">Δθ_H 0–{maxExcess} K · q 0–{fmt(maxFlux, 0)} W/m²</text>
      <text x="22" y="148" fill={T.thermalText} fontSize="10">EN 1264</text><text x="70" y="148" fill={T.n14} fontSize="10">○ FLOORTEC</text><text x="132" y="148" fill={T.warning} fontSize="10">q_G {maxSurface} °C</text><text x="200" y="148" fill={T.electricalText} fontSize="10">● now</text>
    </svg>
    <p className="field-hint">Line: q = K_H·Δθ_H. Circles: {tabulated !== undefined ? 'the FLOORTEC table for this spacing and covering (tabulated against the arithmetic mean water temperature)' : 'none for this configuration (FLOORTEC tabulates 100–300 mm with R_λ,B 0, 0.05, 0.10 and 0.15)'}. Dashed: the limit flux q_G of the base curve at {maxSurface} °C. Dot: upward flux against the mean water excess; it leaves the line while the screed stores or releases heat, or when the space below is not at room temperature.</p>
    <div className="measurement-list summary" data-testid="underfloor-readings">
      <div><span>Supply water</span><strong>{flowing && h?.supplyTemperature !== undefined ? `${fmt(h.supplyTemperature - 273.15)} °C` : '—'}</strong></div>
      <div><span>Return water</span><strong>{flowing && h?.returnTemperature !== undefined ? `${fmt(h.returnTemperature - 273.15)} °C` : '—'}</strong></div>
      <div><span>Mean water excess Δθ</span><strong>{fmt(excess)} K</strong></div>
      <div><span>Heat flux up</span><strong>{started ? `${fmt(flux, 1)} W/m²` : '—'}</strong><small>limit {fmt(limit, 0)} W/m²</small></div>
      <div><span>Heat to the room</span><strong>{started ? `${fmt(output, 0)} W` : '—'}</strong></div>
      <div><span>Loss downwards</span><strong>{started ? `${fmt(downward, 0)} W` : '—'}</strong><small>to {belowName} at {fmt(below.temperature)} °C</small></div>
      <div><span>Water heat input ṁ·c·ΔT</span><strong>{started ? `${fmt(input, 0)} W` : '—'}</strong></div>
      <div><span>Screed (pipe plane)</span><strong>{fmt(plane)} °C</strong></div>
      <div><span>Floor surface (mean)</span><strong>{started ? `${fmt(surface)} °C` : '—'}</strong><small>EN 1264 base curve</small></div>
      <div><span>Stored above room air</span><strong>{fmt(stored / 3.6e6, 2)} kWh</strong></div>
      <div><span>Mass flow</span><strong>{started ? `${fmt(massFlow)} kg/h` : '—'}</strong><small>{fmt(massFlow / loopCount(c))} kg/h per loop</small></div>
      <div><span>Pressure drop</span><strong>{started ? `${fmt((h?.differentialPressure ?? 0) / 1000, 2)} kPa` : '—'}</strong><small>{started ? `${fmt(h?.velocity ?? 0, 2)} m/s in the loop` : ''}</small></div>
    </div>
    <details style={{ marginTop: 12 }}><summary className="section-label">Model basis · data provenance</summary>
      {floorModelBasis(c).map(b => <p className="field-hint" key={b.kind} data-testid={`underfloor-basis-${b.kind}`}><strong>{floorBasisLabels[b.kind]}:</strong> {b.text}</p>)}
    </details>
  </div>;
}
