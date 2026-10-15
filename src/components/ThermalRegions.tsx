import { T } from '../theme/tokens';
import { useRef, type PointerEvent } from 'react';
import { actions, simulation, useLab } from '../editor/store';
import { THERMAL_PLAN_SCALE as SCALE, type ThermalSpace } from '../simulation/thermal-spaces';

export function ThermalRegions({ zoom, panning }: { zoom: number; panning: () => boolean }) {
  const state = useLab();
  const drag = useRef<{ room: ThermalSpace; x: number; y: number; resize: boolean } | null>(null);
  function down(e: PointerEvent, room: ThermalSpace, resize = false) {
    if (e.button !== 0 || panning() || state.tool === 'pan' || state.tool === 'wire' || state.tool === 'room') return;
    e.stopPropagation(); actions.select([room.id]); actions.beginMove();
    drag.current = { room, x: e.clientX, y: e.clientY, resize }; e.currentTarget.setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent) {
    const g = drag.current; if (!g) return; e.stopPropagation();
    const dx = (e.clientX - g.x) / zoom, dy = (e.clientY - g.y) / zoom;
    const snap = (v: number) => state.grid ? Math.round(v / 20) * 20 : v;
    if (g.resize) actions.room(g.room.id, { width: Math.max(0.4, snap(g.room.width * SCALE + dx) / SCALE), length: Math.max(0.4, snap(g.room.length * SCALE + dy) / SCALE) }, false);
    else actions.room(g.room.id, { x: snap(g.room.x + dx), y: snap(g.room.y + dy) }, false);
  }
  return <g className="thermal-regions">{(state.project.thermalSpaces ?? []).map(room => {
    const w = room.width * SCALE, h = room.length * SCALE, selected = state.selected.includes(room.id), reading = simulation.spaceReadings[room.id], t = simulation.spaceTemperatures[room.id] ?? room.initialTemperature;
    return <g key={room.id} data-room-id={room.id} data-testid="thermal-space" transform={`translate(${room.x},${room.y})`} className={`thermal-region ${selected ? 'selected' : ''}`} onPointerMove={move} onPointerUp={e => { if (drag.current) { e.stopPropagation(); actions.finishMove(); drag.current = null; } }} onPointerCancel={() => { if (drag.current) actions.finishMove(); drag.current = null; }}>
      <rect width={w} height={h} rx={3} className="room-fill" pointerEvents="none" fill={t >= 20 ? T.thermal : T.hydraulic} fillOpacity={Math.min(0.1, 0.025 + Math.abs(t - 20) * 0.002)} />
      <rect width={w} height={h} rx={3} className="room-boundary" fill="none" pointerEvents="stroke" onPointerDown={e => down(e, room)} />
      <g className="room-caption" onPointerDown={e => down(e, room)} role="button" aria-label={`Select ${room.name}`}>
        <rect x={10} y={9} width={Math.min(w - 20, 220)} height={66} rx={4} />
        <text x={22} y={28} className="room-name">{room.name.slice(0, Math.max(6, Math.floor(w / 9)))}</text>
        <text x={22} y={55} className="room-live-temperature">{t.toFixed(1)}<tspan className="room-unit"> °C</tspan></text>
        <text x={112} y={54} className="room-flow">{reading ? `${reading.netHeat >= 0 ? '+' : ''}${reading.netHeat.toFixed(0)} W` : `${(room.width * room.length).toFixed(1)} m²`}</text>
      </g>
      <text x={w / 2} y={h - 12} textAnchor="middle" className="room-dimension" pointerEvents="none">{room.width.toFixed(2)} × {room.length.toFixed(2)} m · h {room.height.toFixed(2)} m</text>
      {(state.project.thermalElements ?? []).filter(e => e.from === room.id && e.parentId).map((e, i) => {
        const wall = state.project.thermalElements?.find(w => w.id === e.parentId), horizontal = wall?.side === 'north' || wall?.side === 'south';
        const px = wall?.side === 'west' ? 0 : wall?.side === 'east' ? w : Math.min(w - 30, w / 2 + i * 40), py = wall?.side === 'south' ? h : wall?.side === 'north' ? 0 : Math.min(h - 30, h / 2 + i * 40);
        return <path key={e.id} d={horizontal ? `M ${px - 15} ${py} h 30` : `M ${px} ${py - 15} v 30`} className={`room-opening ${e.kind}`} pointerEvents="none"><title>{e.name} · {e.area} m² · {e.uValue} W/(m²·K)</title></path>;
      })}
      {state.thermalOverlay && reading && <g className="room-thermal-overlay" pointerEvents="none">
        <text x={w - 14} y={28} textAnchor="end">Envelope {reading.envelopeLoss.toFixed(0)} W outward</text>
        <text x={w - 14} y={46} textAnchor="end">Ventilation {reading.ventilationLoss.toFixed(0)} W outward</text>
        <text x={w - 14} y={64} textAnchor="end">Storage Δ {(reading.storedEnergy / 1e6).toFixed(2)} MJ</text>
        {Object.entries(reading.deviceFlows).map(([id, q]) => { const c = state.project.components.find(c => c.id === id); return c ? <text key={id} x={c.x - room.x + 87} y={c.y - room.y - 24} textAnchor="middle">{q >= 0 ? '+' : ''}{q.toFixed(0)} W to room</text> : null; })}
        {Math.abs(reading.adjacentHeat) > 0.01 && <text x={w / 2} y={h - 32} textAnchor="middle">Adjacent rooms {reading.adjacentHeat >= 0 ? '+' : ''}{reading.adjacentHeat.toFixed(0)} W</text>}
      </g>}
      {selected && simulation.time === 0 && <rect aria-label={`Resize ${room.name}`} role="button" x={w - 6} y={h - 6} width={12} height={12} rx={2} className="room-resize" onPointerDown={e => down(e, room, true)} />}
    </g>;
  })}</g>;
}
