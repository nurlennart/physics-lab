import { useEffect, useState } from 'react';
import { Trash2, Plus } from 'lucide-react';
import { actions, simulation, useLab } from '../editor/store';
import { heatedFloorArea } from '../simulation/underfloor-heating';
import { DEFAULT_GROUND_TEMPERATURE, GROUND, characteristicDimension, defaultSlab, equivalentThickness, groundModel } from '../simulation/ground';
import { elementArea, elementU, floorArea, opaqueArea, outdoorTemperature, slabPerimeter, usesSlabTransmittance, roomMeasurements, roomMeasurement, roomVolume, spaceCapacity, type ThermalElement, type ThermalSpace } from '../simulation/thermal-spaces';
import { formatReading, units } from '../simulation/measurements';

function NumberField({ label, value, unit, disabled, change }: { label: string; value: number; unit: string; disabled?: boolean; change: (v: number) => unknown }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return <label className="room-field"><span>{label}</span><div><input aria-label={label} inputMode="decimal" value={draft} disabled={disabled} onChange={e => setDraft(e.target.value)} onBlur={() => { const v = Number(draft); if (draft.trim() && Number.isFinite(v) && v !== value) change(v); setDraft(String(value)); }} onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()} /><small>{unit}</small></div></label>;
}
function SlabFields({ e, locked }: { e: ThermalElement; locked: boolean }) {
  const p = useLab().project, slab = e.slab!, iso = usesSlabTransmittance(e);
  const set = (patch: Partial<NonNullable<ThermalElement['slab']>>) => actions.element(e.id, { slab: { ...slab, ...patch } });
  const b = characteristicDimension(elementArea(p, e), slabPerimeter(p, e));
  return <div data-testid="slab-fields">
    <label className="room-field"><span>{e.name} U-value source</span><select aria-label={`${e.name} U-value source`} disabled={locked} value={iso ? 'iso' : 'entered'} onChange={ev => set({ floorResistance: ev.target.value === 'iso' ? 3 : undefined })}><option value="entered">Entered U-value</option><option value="iso">EN ISO 13370 from floor layers</option></select></label>
    {iso && <NumberField label={`${e.name} floor resistance R_f`} value={slab.floorResistance!} unit="m²·K/W" disabled={locked} change={v => set({ floorResistance: v })} />}
    <NumberField label={`${e.name} exposed perimeter`} value={slabPerimeter(p, e)} unit="m" disabled={locked} change={v => set({ perimeter: v })} />
    <NumberField label={`${e.name} wall thickness`} value={slab.wallThickness} unit="m" disabled={locked} change={v => set({ wallThickness: v })} />
    <NumberField label={`${e.name} soil conductivity`} value={slab.soilConductivity} unit="W/(m·K)" disabled={locked} change={v => set({ soilConductivity: v })} />
    <p className="field-hint" data-testid="slab-basis">B′ = A/(½P) = {b.toFixed(2)} m{iso ? ` · d_t = ${equivalentThickness(slab.wallThickness, slab.soilConductivity, slab.floorResistance!).toFixed(2)} m · U = ${elementU(p, e).toFixed(3)} W/(m²·K)` : ''}. {iso ? 'EN ISO 13370 steady-state slab-on-ground transmittance (R_si 0.17, R_se 0.04), over the whole floor area; no edge insulation, no periodic (seasonal) part.' : 'The entered U-value is used as is; it must already include the soil. B′ is used for underfloor heating on this floor.'} Soil 2.0 W/(m·K) is the ISO value for unknown soil (sand or gravel; clay or silt 1.5, rock 3.5). Underfloor heating on this floor adds the soil's share of the same calculation below its own layers.</p>
  </div>;
}
export function ThermalSpaceInspector({ room }: { room: ThermalSpace }) {
  const state = useLab(), p = state.project, locked = simulation.time > 0 || state.busy;
  const overlay = state.thermalOverlay;
  const setOverlay = (value: boolean) => actions.set({ thermalOverlay: value });
  const [name, setName] = useState(room.name);
  useEffect(() => setName(room.name), [room.id, room.name]);
  const edit = (field: keyof ThermalSpace, v: number) => actions.room(room.id, { [field]: v });
  const temperature = simulation.spaceTemperatures[room.id] ?? room.initialTemperature;
  return <aside className="inspector thermal-space-inspector">
    <div className="panel-heading"><h2>Thermal Space</h2><button aria-label="Delete room" onClick={actions.remove}><Trash2 size={15} /></button></div>
    <div className="inspector-scroll">
      <div className="room-temperature"><span>{name}</span><strong>{temperature.toFixed(2)}<small> °C</small></strong><p>Well-mixed air and effective contents</p></div>
      <section className="inspector-section"><div className="section-label">Configuration {locked && <span>RESET TO EDIT GEOMETRY</span>}</div>
        <label className="room-field"><span>Room name</span><input aria-label="Room name" value={name} maxLength={80} onChange={e => setName(e.target.value)} onBlur={() => { actions.room(room.id, { name: name.trim() }); setName(room.name); }} onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()} /></label>
        {([['width', 'Room width', 'm'], ['length', 'Room length', 'm'], ['height', 'Ceiling height', 'm'], ['initialTemperature', 'Initial air temperature', '°C'], ['addedHeatCapacity', 'Additional effective capacity', 'J/K']] as const).map(([field, label, unit]) => <NumberField key={field} label={label} value={room[field]} unit={unit} disabled={locked} change={v => edit(field, v)} />)}
        <p className="field-hint">Air: 1.2 kg/m³ × 1005 J/(kg·K). Additional capacity represents contents and participating fabric at the same zone temperature. Default: 100 kJ/(m²·K), an editable assumption.</p>
        <div className="room-derived"><span>Floor area <b>{floorArea(room).toFixed(2)} m²</b></span><span>Volume <b>{roomVolume(room).toFixed(2)} m³</b></span><span>Effective capacity <b>{formatReading(spaceCapacity(p, room) / 1e6)} MJ/K</b></span><span>Plan scale <b>100 canvas units / m</b></span></div>
      </section>
      <section className="inspector-section"><div className="section-label">Environment and gains</div>
        <label className="room-field"><span>Outdoor boundary</span><select aria-label="Outdoor boundary" value={room.outdoorTemperature === undefined ? 'global' : 'override'} onChange={e => actions.room(room.id, { outdoorTemperature: e.target.value === 'global' ? undefined : outdoorTemperature(p, room) })}><option value="global">Global environment</option><option value="override">Local outdoor override</option></select></label>
        <NumberField label="Outdoor temperature" value={outdoorTemperature(p, room)} unit="°C" change={v => room.outdoorTemperature === undefined ? actions.environment(v) : edit('outdoorTemperature', v)} />
        {(p.thermalElements ?? []).some(e => e.from === room.id && e.to === GROUND) && <><NumberField label="Ground temperature" value={groundModel(p).temperature} unit="°C" change={v => actions.groundTemperature(v)} />
          <p className="field-hint" data-testid="ground-hint">Fixed ground boundary for every floor on the ground in this project: the annual mean outdoor temperature of EN ISO 13370's steady-state method{p.ground ? '' : `, here the assumed default ${DEFAULT_GROUND_TEMPERATURE} °C (not a site value)`}. No seasonal swing and no soil heat storage.</p></>}
        <label className="room-field"><span>Ventilation model</span><select aria-label="Ventilation model" disabled={locked} value={room.ventilationMode ?? 'ach'} onChange={e => actions.room(room.id, { ventilationMode: e.target.value as 'ach' | 'flow' })}><option value="ach">Air changes per hour</option><option value="flow">Airflow</option></select></label>
        {room.ventilationMode === 'flow' ? <NumberField label="Ventilation airflow" value={room.ventilationFlow ?? 0} unit="m³/s" disabled={locked} change={v => edit('ventilationFlow', v)} /> : <NumberField label="Air changes per hour" value={room.airChangesPerHour} unit="1/h" disabled={locked} change={v => edit('airChangesPerHour', v)} />}
        <NumberField label="Internal heat gain" value={room.internalGain} unit="W" change={v => edit('internalGain', v)} />
        <p className="field-hint">Internal gain is declared external heat input. Device gains come from their actual heat exchange.</p>
      </section>
      <section className="inspector-section"><div className="section-label">Construction</div>
        {(p.thermalElements ?? []).filter(e => e.from === room.id || e.to === room.id).map(e => <div key={e.id} className="room-element">
          <div className="room-element-title"><b>{e.name} · {e.kind}</b><button aria-label={`Remove ${e.name}`} disabled={locked} onClick={() => actions.element(e.id, null)}><Trash2 size={12} /></button></div>
          <NumberField label={`${e.name} U-value`} value={usesSlabTransmittance(e) ? Number(elementU(p, e).toFixed(4)) : e.uValue} unit="W/(m²·K)" disabled={locked || usesSlabTransmittance(e)} change={v => actions.element(e.id, { uValue: v, preset: undefined })} />
          <NumberField label={`${e.name} area`} value={elementArea(p, e)} unit="m²" disabled={locked} change={v => actions.element(e.id, { area: v })} />
          {e.side && e.area !== undefined && <button className="text-link" disabled={locked} onClick={() => actions.element(e.id, { area: undefined })}>Use geometry-derived area</button>}
          <NumberField label={`${e.name} effective capacity`} value={e.heatCapacity} unit="J/K" disabled={locked} change={v => actions.element(e.id, { heatCapacity: v })} />
          {!e.parentId && <label className="room-field"><span>Adjacent environment</span><select aria-label={`${e.name} adjacency`} disabled={locked || e.from !== room.id} value={e.to} onChange={ev => actions.element(e.id, { to: ev.target.value, slab: ev.target.value === GROUND ? e.slab ?? defaultSlab() : undefined })}><option value="outdoors">Outdoors</option>{e.kind === 'floor' && <option value={GROUND}>Ground (slab on ground)</option>}{(p.thermalSpaces ?? []).filter(r => r.id !== e.from).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>}
          {e.kind === 'wall' && <><p className="field-hint">Opaque area: {opaqueArea(p, e).toFixed(2)} m²{e.to !== 'outdoors' ? ' · Shared once between both zones. Remove the other zone’s redundant exterior surface if replacing it.' : ''}</p><div className="room-element-actions"><button disabled={locked} onClick={() => actions.opening(e.id, 'window')}><Plus size={12} /> Window</button><button disabled={locked} onClick={() => actions.opening(e.id, 'door')}><Plus size={12} /> Door</button></div></>}
          {e.to === GROUND && e.slab && <SlabFields e={e} locked={locked} />}
          {(e.kind === 'floor' || e.kind === 'ceiling') && heatedFloorArea(p, e) > 0 && <p className="field-hint">Underfloor heating covers {heatedFloorArea(p, e).toFixed(2)} m²: the floor conducts room air through the remaining {opaqueArea(p, e).toFixed(2)} m², the loop's own downward loss crosses the rest.</p>}
          {e.preset && <p className="field-hint">{e.preset}; U-value is an assumption, not a certified assembly.</p>}
        </div>)}
      </section>
      <section className="inspector-section"><div className="section-label">Calculated measurements</div>
        {roomMeasurements.map(metric => <div className="room-reading" key={metric}><span>{metric.replace(/([A-Z])/g, ' $1')}</span><b>{formatReading(roomMeasurement(simulation.project, simulation.spaceTemperatures, simulation.spaceReadings, room.id, metric) ?? 0)} {units[metric]}</b><button aria-label={`Chart ${metric}`} onClick={() => actions.addProbe(room.id, metric)}><Plus size={12} /></button></div>)}
        <p className="field-hint">Stored energy is relative to the initial temperature. Positive losses leave the room. Rates describe the last accepted thermal interval.</p>
        <button className="text-link" aria-pressed={overlay} onClick={() => setOverlay(!overlay)}>{overlay ? 'Hide' : 'Show'} surface and device heat flows</button>
        {overlay && <div className="room-derived">{Object.entries(simulation.spaceReadings[room.id]?.elementFlows ?? {}).map(([id, q]) => <span key={id}>{p.thermalElements?.find(e => e.id === id)?.name}<b>{q.toFixed(1)} W outward</b></span>)}{Object.entries(simulation.spaceReadings[room.id]?.deviceFlows ?? {}).map(([id, q]) => <span key={id}>{p.components.find(c => c.id === id)?.name}<b>{q.toFixed(1)} W input</b></span>)}</div>}
      </section>
    </div>
  </aside>;
}
