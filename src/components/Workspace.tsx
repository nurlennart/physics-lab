import { ThermalRegions } from './ThermalRegions';
import { THERMAL_PLAN_SCALE } from '../simulation/thermal-spaces';
import { T } from "../theme/tokens";
import {
  memo,
  useCallback,
  useState,
  useRef,
  useEffect,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  MousePointer2,
  Hand,
  Cable,
  Undo2,
  Redo2,
  Copy,
  RotateCw,
  Trash2,
  Grid2X2,
  Scan,
  Plus,
  Minus,
  Maximize,
  Check,
  ChevronDown,
  Pencil,
} from "lucide-react";
import { actions, availableHistory, simulation, useLab } from "../editor/store";
import {
  definitions,
  isSource,
  prop,
  type Component,
  type Connection,
  type Terminal,
} from "../simulation/model";
import {
  dimensions,
  portPoint,
  portLocal,
  wirePath,
  routePoints,
} from "../editor/geometry";
import { nodeVoltage } from "../simulation/electrical";
import { ModuleFace, hasStarted, fitName, moduleStatus, modulePins } from "./ModuleFace";
export { dimensions, portPoint } from "../editor/geometry";
export { hasStarted, fitName } from "./ModuleFace";
/** Signed volume flow along a hydraulic wire (from → to), from the branch reading at either end. */
function wireFlow(w: Connection) {
  if (w.domain !== "hydraulic") return 0;
  const h = simulation.multiphysics.hydraulic;
  const portFlow = (id: string, port: string) => { const reading = h.readings[id]; if (!reading || !["inlet", "outlet"].includes(port)) return undefined; return reading.flow * (port === "outlet" ? 1 : -1); };
  return portFlow(w.from.component, w.from.port) ?? -(portFlow(w.to.component, w.to.port) ?? 0);
}
/** Physical domain that colours a component's identifier (control and sensors stay neutral). */
/** Readout sign: sources and solar panels show delivered power as positive; batteries keep the load convention
 * (charging positive, as on the module face and Victron displays). */
const delivered = (c: Component) => ((isSource(c) && c.kind !== "battery" && c.kind !== "lfpBattery") || c.kind === "solarPanel" ? -1 : 1);
const domainOf = (c: Component) => ({ Electrical: "electrical", Thermal: "thermal", Hydraulic: "hydraulic", Mechanical: "mechanical" } as Record<string, string>)[definitions[c.kind].category] ?? "control";
/** Readable number of significant digits for live chips. */
const chipNumber = (v: number) => { const a = Math.abs(v); return a >= 100 ? a.toFixed(0) : a >= 10 ? a.toFixed(1) : a.toFixed(2); };
/**
 * Live value carried by a wire, or null when it cannot be stated exactly:
 * hydraulic flow at its port, shaft speed of a connected motor, and electrical current only where a
 * two-terminal element is the sole branch at that terminal (then the wire current equals the element current).
 */
function wireValue(w: Connection, project: { components: Component[]; connections: Connection[] }, fluidFlow: number): string | null {
  if (w.domain === "hydraulic") return Math.abs(fluidFlow) > 1e-9 ? `${chipNumber(fluidFlow * 60000)} L/min` : null;
  if (w.domain === "mechanical") {
    const motor = [w.from.component, w.to.component].map((id) => simulation.multiphysics.motors[id]).find(Boolean);
    return motor ? `${(Math.abs(motor.omega) * 30 / Math.PI).toFixed(0)} rpm` : null;
  }
  if (w.domain !== "electrical") return null;
  for (const end of [w.from, w.to]) {
    const c = project.components.find((x) => x.id === end.component);
    if (!c || definitions[c.kind].ports.filter((p) => p.domain === "electrical").length !== 2) continue;
    const wires = project.connections.filter((x) => x.domain === "electrical" && [x.from, x.to].some((t) => t.component === end.component && t.port === end.port));
    const r = simulation.electrical.readings[c.id];
    if (wires.length === 1 && r && Math.abs(r.current) > 1e-6) return `${chipNumber(r.current)} A`;
  }
  return null;
}
/** Midpoint of the longest segment of a routed wire: away from the terminals, where a chip fits. */
function chipAnchor(points: { x: number; y: number }[]) {
  let best = { x: 0, y: 0, length: -1 };
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length > best.length) best = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, length };
  }
  return best.length > 40 ? best : null;
}
/**
 * Terminals and terminal labels of one module. They change only with the configuration, the wire being drawn and the
 * node-measurement mode, so they are kept out of the instrument refresh while running (`live` changes only while
 * node voltages are shown).
 */
const ModuleTerminals = memo(function ModuleTerminals({ c, w, h, connections, pendingPort, nodeMode, reference, onPort }: {
  c: Component; w: number; h: number; connections: Connection[]; pendingPort: string | null; nodeMode: boolean; reference: Terminal | null; live: number; onPort: (t: Terminal) => void;
}) {
  const pins = modulePins(c);
  return (
    <>
      {definitions[c.kind].ports.map((p) => {
        const { x, y } = portLocal(c, p.id);
        const branches = connections.filter(
          (w) =>
            w.domain === "electrical" &&
            ((w.from.component === c.id && w.from.port === p.id) ||
              (w.to.component === c.id && w.to.port === p.id)),
        ).length;
        const potential =
          nodeMode && p.domain === "electrical"
            ? nodeVoltage(
                simulation.electrical,
                `${c.id}:${p.id}`,
                reference
                  ? `${reference.component}:${reference.port}`
                  : undefined,
              )
            : null;
        const isPending =
          pendingPort === p.id;
        return (
          <g
            key={p.id}
            className={`terminal ${p.domain} ${isPending ? "pending" : ""}`}
            data-port={`${c.name}:${p.id}`}
            aria-label={`${c.name} ${p.label}`}
            role="button"
            tabIndex={0}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onPort({ component: c.id, port: p.id });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onPort({ component: c.id, port: p.id });
              }
            }}
          >
            <title>{p.label}</title>
            {branches > 1 && (
              <circle cx={x} cy={y} r="8" fill={T.electricalText} />
            )}
            {nodeMode && p.domain === "electrical" && (
              <text
                x={x}
                y={y - 17}
                className="node-reading"
                textAnchor="middle"
              >
                {potential === null
                  ? "undefined"
                  : potential.toFixed(2) + " V"}
              </text>
            )}
            {/* Stub from the terminal straight to the module edge it faces. */}
            <path
              d={x < 0 ? `M${x} ${y}H0` : x > w ? `M${x} ${y}H${w}` : y < 0 ? `M${x} ${y}V0` : `M${x} ${y}V${h}`}
              stroke="currentColor"
              strokeWidth="2"
            />
            <circle cx={x} cy={y} r="13" fill="transparent" />
            <circle cx={x} cy={y} r="5" className="port-circle" />
            {p.domain === "thermal" && (
              <circle cx={x} cy={y} r="2" fill="currentColor" />
            )}
          </g>
        );
      })}
      {pins && (
        // Terminal labels: a separate, non-interactive layer, so each terminal's hit area stays its port.
        // On the body: on the terminal line at the edge of a terminal strip, above a lead that runs on
        // into the symbol, or above a terminal entering from below; a terminal entering from above is
        // labelled beside its stub (the name band is above it inside).
        <g className="pin-labels">
          {Object.entries(pins.labels).map(([id, text]) => {
            const { x, y } = portLocal(c, id), domain = definitions[c.kind].ports.find((p) => p.id === id)?.domain;
            const at: { x: number; y: number; a: "start" | "middle" | "end" } = x < 0 ? (pins.strip ? { x: 12, y: y + 4.5, a: "start" } : { x: 7, y: y - 7, a: "start" })
              : x > w ? (pins.strip ? { x: w - 12, y: y + 4.5, a: "end" } : { x: w - 7, y: y - 7, a: "end" })
              : y < 0 ? { x: x + 8, y: -5, a: "start" } : { x, y: h - 5, a: "middle" };
            return (
              <g key={id} className={`terminal-label ${domain}`}>
                {pins.strip && (x < 0 || x > w) && <path d={`M${x < 0 ? 0 : w} ${y}h${x < 0 ? 7 : -7}`} stroke="currentColor" strokeWidth="2" />}
                <text x={at.x} y={at.y} textAnchor={at.a} className={`pin-label${y < 0 ? " outside" : ""}`}>{text}</text>
              </g>
            );
          })}
        </g>
      )}
    </>
  );
});
/** Wires drawn again, clipped to the module bodies; configuration only. */
const WireOverlay = memo(function WireOverlay({ components, connections, selectedWire, disconnected }: { components: Component[]; connections: Connection[]; selectedWire: string | null; disconnected: string }) {
  void disconnected;
  return (
    <>
      <clipPath id="module-bodies">
        {components.map((c) => {
          const { w, h } = dimensions(c);
          return <rect key={c.id} x={c.x} y={c.y} width={w} height={h} transform={`rotate(${c.rotation},${c.x + w / 2},${c.y + h / 2})`} />;
        })}
      </clipPath>
      <g clipPath="url(#module-bodies)" pointerEvents="none" className="wire-overlay">
        {connections.map((w) => (
          <g key={w.id} className={`connection ${w.domain} ${selectedWire === w.id ? "selected-wire" : ""}`}>
            <path d={wirePath(w, components, connections)} className="wire-line" opacity={simulation.disconnected.has(w.id) ? 0.25 : 1} />
          </g>
        ))}
      </g>
    </>
  );
});
export default function Workspace() {
  const state = useLab(),
    { project, selected, tool, grid, overlay } = state;
  const svg = useRef<SVGSVGElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const [camera, setCamera] = useState({ x: 20, y: 20, z: 1 });
  // Module readouts are fitted with measured text widths once the web fonts have loaded: redraw then.
  const [, setFontsLoaded] = useState(false);
  useEffect(() => {
    document.fonts?.ready.then(() => setFontsLoaded(true));
  }, []);
  const [pending, setPending] = useState<Terminal | null>(null);
  // The terminal a wire was started from can disappear (Delete, undo, loading a project): drop the pending wire.
  const pendingComponent = pending ? project.components.find((c) => c.id === pending.component) : undefined;
  useEffect(() => {
    if (pending && !pendingComponent) setPending(null);
  }, [pending, pendingComponent]);
  const [cursor, setCursor] = useState({ x: 0, y: 0 });
  const [context, setContext] = useState<{ x: number; y: number } | null>(null);
  const [marquee, setMarquee] = useState<{
    x: number;
    y: number;
    x2: number;
    y2: number;
  } | null>(null);
  const gesture = useRef<{
    type: "pan" | "move" | "box" | "room";
    sx: number;
    sy: number;
    camera: typeof camera;
    positions: Record<string, { x: number; y: number }>;
  } | null>(null);
  const bend = useRef<{
    id: string;
    index: number;
    route: { x: number; y: number }[];
  } | null>(null);
  const space = useRef(false);
  function fit() {
    const el = wrapper.current;
    if (!el) return;
    if (!project.components.length && !project.thermalSpaces?.length) {
      setCamera({ x: 60, y: 60, z: 1 });
      return;
    }
    const routes = project.connections.flatMap((w) =>
      routePoints(w, project.components, project.connections),
    );
    const minX =
        Math.min(
          ...(project.thermalSpaces ?? []).map(r => r.x),
          ...project.components.map((c) => c.x),
          ...routes.map((p) => p.x),
        ) - 65,
      minY =
        Math.min(
          ...(project.thermalSpaces ?? []).map(r => r.y),
          ...project.components.map((c) => c.y),
          ...routes.map((p) => p.y),
        ) - 80,
      maxX =
        Math.max(
          ...(project.thermalSpaces ?? []).map(r => r.x + r.width * THERMAL_PLAN_SCALE),
          ...project.components.map((c) => c.x + dimensions(c).w),
          ...routes.map((p) => p.x),
        ) + 70,
      maxY =
        Math.max(
          ...(project.thermalSpaces ?? []).map(r => r.y + r.length * THERMAL_PLAN_SCALE),
          ...project.components.map((c) => c.y + dimensions(c).h),
          ...routes.map((p) => p.y),
        ) + 45;
    const z = Math.min(
      1.25,
      (el.clientWidth - 50) / (maxX - minX),
      (el.clientHeight - 50) / (maxY - minY),
    );
    setCamera({
      x: (el.clientWidth - (maxX - minX) * z) / 2 - minX * z,
      y: (el.clientHeight - (maxY - minY) * z) / 2 - minY * z,
      z,
    });
  }
  useEffect(() => {
    const observer = new ResizeObserver(() => fit());
    if (wrapper.current) observer.observe(wrapper.current);
    return () => observer.disconnect();
  }, [project.id]);
  useEffect(() => {
    setPending(null);
    fit();
  }, [project.id]);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (
        e.code === "Space" &&
        !["INPUT", "SELECT", "TEXTAREA"].includes(
          (e.target as HTMLElement).tagName,
        )
      ) {
        e.preventDefault();
        space.current = true;
      }
      if (e.key === "Escape") {
        setPending(null);
        setContext(null);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") space.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);
  const local = (x: number, y: number) => {
    const r = svg.current!.getBoundingClientRect();
    return {
      x: (x - r.left - camera.x) / camera.z,
      y: (y - r.top - camera.y) / camera.z,
    };
  };
  function down(e: ReactPointerEvent, id?: string) {
    if (e.button !== 0 && e.button !== 1) return;
    setContext(null);
    if (pending && !id) {
      setPending(null);
      return;
    }
    const pan = tool === "pan" || space.current || e.button === 1;
    const p = local(e.clientX, e.clientY);
    let ids = selected;
    if (id && !pan) {
      ids = e.shiftKey
        ? selected.includes(id)
          ? selected.filter((x) => x !== id)
          : [...selected, id]
        : selected.includes(id)
          ? selected
          : [id];
      actions.select(ids);
      if (tool === "wire") return;
      actions.beginMove();
    } else if (!pan) {
      if (!e.shiftKey) actions.select([]);
      setMarquee({ x: p.x, y: p.y, x2: p.x, y2: p.y });
    }
    gesture.current = {
      type: pan ? "pan" : id ? "move" : tool === "room" ? "room" : "box",
      sx: e.clientX,
      sy: e.clientY,
      camera: { ...camera },
      positions: Object.fromEntries(
        project.components
          .filter((c) => ids.includes(c.id))
          .map((c) => [c.id, { x: c.x, y: c.y }]),
      ),
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function move(e: ReactPointerEvent) {
    const p = local(e.clientX, e.clientY);
    setCursor(p);
    if (bend.current) {
      const b = bend.current;
      const route = b.route.map((v, i) =>
        i === b.index
          ? { x: Math.round(p.x / 20) * 20, y: Math.round(p.y / 20) * 20 }
          : v,
      );
      actions.route(b.id, route);
      return;
    }
    const g = gesture.current;
    if (!g) return;
    const dx = (e.clientX - g.sx) / g.camera.z,
      dy = (e.clientY - g.sy) / g.camera.z;
    if (g.type === "pan")
      setCamera({
        ...g.camera,
        x: g.camera.x + e.clientX - g.sx,
        y: g.camera.y + e.clientY - g.sy,
      });
    if (g.type === "move")
      actions.move(
        Object.fromEntries(
          Object.entries(g.positions).map(([id, v]) => [
            id,
            {
              x: grid ? Math.round((v.x + dx) / 20) * 20 : v.x + dx,
              y: grid ? Math.round((v.y + dy) / 20) * 20 : v.y + dy,
            },
          ]),
        ),
      );
    if (g.type === "box" || g.type === "room")
      setMarquee((m) => (m ? { ...m, x2: p.x, y2: p.y } : null));
  }
  function up() {
    bend.current = null;
    if (gesture.current?.type === 'room' && marquee) {
      const x = Math.min(marquee.x, marquee.x2), y = Math.min(marquee.y, marquee.y2);
      const width = Math.abs(marquee.x2 - marquee.x) / THERMAL_PLAN_SCALE, length = Math.abs(marquee.y2 - marquee.y) / THERMAL_PLAN_SCALE;
      if (width >= 0.4 && length >= 0.4) actions.addRoom(x, y, width, length);
    }
    if (gesture.current?.type === 'move') actions.finishMove();
    if (gesture.current?.type === "box" && marquee) {
      const m = marquee;
      const found = project.components.filter(
        (c) =>
          c.x >= Math.min(m.x, m.x2) &&
          c.x <= Math.max(m.x, m.x2) &&
          c.y >= Math.min(m.y, m.y2) &&
          c.y <= Math.max(m.y, m.y2),
      );
      if (Math.abs(m.x - m.x2) > 5) actions.select(found.map((c) => c.id));
    }
    gesture.current = null;
    setMarquee(null);
  }
  function zoom(f: number, px?: number, py?: number) {
    const el = wrapper.current!;
    const x = px ?? el.clientWidth / 2,
      y = py ?? el.clientHeight / 2;
    setCamera((c) => {
      const z = Math.max(0.25, Math.min(2, c.z * f));
      return { z, x: x - ((x - c.x) * z) / c.z, y: y - ((y - c.y) * z) / c.z };
    });
  }
  // A stable handler for the memoised terminals; it always runs the current click logic.
  const portClickRef = useRef<(t: Terminal) => void>(() => {});
  portClickRef.current = portClick;
  const onPort = useCallback((t: Terminal) => portClickRef.current(t), []);
  function portClick(t: Terminal) {
    if (state.nodeMode) {
      const c = project.components.find((c) => c.id === t.component)!;
      if (
        definitions[c.kind].ports.find((p) => p.id === t.port)?.domain !==
        "electrical"
      )
        return;
      if (!state.reference) {
        actions.set({ reference: t });
        return;
      }
      actions.addProbe(t.component, "nodeVoltage", t.port, state.reference);
      return;
    }

    if (pending) {
      if (actions.wire(pending, t)) setPending(null);
    } else {
      setPending(t);
      actions.select([t.component]);
    }
  }
  const hist = availableHistory();
  return (
    <div
      className="workspace"
      ref={wrapper}
      onContextMenu={(e) => {
        e.preventDefault();
        const r = wrapper.current!.getBoundingClientRect();
        setContext({ x: e.clientX - r.left, y: e.clientY - r.top });
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const kind = e.dataTransfer.getData("physics-component");
        if (kind && kind in definitions) {
          const p = local(e.clientX, e.clientY);
          actions.add(kind as Component["kind"], p.x - 85, p.y - 60);
        }
      }}
    >
      <div className="canvas-toolbar">
        <button
          className={state.nodeMode ? "active" : ""}
          title="Node measurement: click reference, then measured terminals"
          aria-label="Node measurement mode"
          onClick={() =>
            actions.set({ nodeMode: !state.nodeMode, reference: null })
          }
        >
          <Scan size={16} />
        </button>
        <div className="tool-group">
          {[
            { id: "select", icon: MousePointer2, label: "Select (V)" },
            { id: "pan", icon: Hand, label: "Pan (H / Space)" },
            { id: "wire", icon: Cable, label: "Connect terminals (W)" },
            { id: "room", icon: Grid2X2, label: "Draw Thermal Space" },
          ].map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              className={tool === id ? "active" : ""}
              aria-label={label}
              title={label}
              onClick={() => actions.set({ tool: id as typeof tool })}
            >
              <Icon size={17} />
            </button>
          ))}
        </div>
        <div className="tool-group">
          <button
            title="Undo (Ctrl Z)"
            aria-label="Undo"
            disabled={!hist.undo}
            onClick={actions.undo}
          >
            <Undo2 size={16} />
          </button>
          <button
            title="Redo (Ctrl Shift Z)"
            aria-label="Redo"
            disabled={!hist.redo}
            onClick={actions.redo}
          >
            <Redo2 size={16} />
          </button>
        </div>
        <div className="tool-group">
          <button
            title="Rotate (R)"
            aria-label="Rotate selected"
            disabled={!project.components.some(c => selected.includes(c.id))}
            onClick={actions.rotate}
          >
            <RotateCw size={16} />
          </button>
          <button
            title="Duplicate (Ctrl D)"
            aria-label="Duplicate selected"
            disabled={!project.components.some(c => selected.includes(c.id))}
            onClick={actions.duplicate}
          >
            <Copy size={16} />
          </button>
          <button
            title="Delete"
            aria-label="Delete selected"
            disabled={!selected.length && !state.selectedWire}
            onClick={actions.remove}
          >
            <Trash2 size={16} />
          </button>
        </div>
        <span className="toolbar-spacer" />
        <button
          className={grid ? "active subtle" : ""}
          title="Snap and grid"
          aria-label="Toggle grid"
          onClick={() => actions.set({ grid: !grid })}
        >
          <Grid2X2 size={16} />
        </button>
        <button
          className={overlay ? "active subtle" : ""}
          title="Live measurements"
          aria-label="Toggle measurements"
          onClick={() => actions.set({ overlay: !overlay })}
        >
          <Scan size={16} />
        </button>
      </div>
      <svg
        className={`construction-canvas tool-${tool}`}
        ref={svg}
        aria-label="Interactive engineering construction canvas"
        onPointerDown={(e) => down(e)}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onWheel={(e) => {
          const r = svg.current!.getBoundingClientRect();
          zoom(
            e.deltaY < 0 ? 1.1 : 1 / 1.1,
            e.clientX - r.left,
            e.clientY - r.top,
          );
        }}
      >
        <defs>
          <pattern
            id="grid"
            width={20 * camera.z}
            height={20 * camera.z}
            patternUnits="userSpaceOnUse"
            x={camera.x}
            y={camera.y}
          >
            <circle cx="1" cy="1" r=".75" fill={T.n9} />
          </pattern>
          <filter id="lampGlow">
            <feGaussianBlur stdDeviation="10" />
          </filter>
        </defs>
        {grid && <rect width="100%" height="100%" fill="url(#grid)" />}
        <g transform={`translate(${camera.x},${camera.y}) scale(${camera.z})`}>
          <ThermalRegions zoom={camera.z} panning={() => space.current} />
          {project.connections.map((w) => {
            const path = wirePath(w, project.components, project.connections),
              from = project.components.find((c) => c.id === w.from.component),
              r = from && simulation.electrical.readings[from.id];
            const fluidFlow = wireFlow(w);
            const live =
              state.running &&
              (w.domain === "hydraulic" ? Math.abs(fluidFlow) > 1e-12 : w.domain === "thermal"
                ? simulation.electrical.dissipatedPower > 1
                : Math.abs(r?.current ?? 0) > 0.001);
            return (
              <g
                key={w.id}
                style={{ animationDirection: fluidFlow < 0 ? "reverse" : "normal" }}
                className={`connection ${w.domain} ${live ? "flowing" : ""} ${state.selectedWire === w.id ? "selected-wire" : ""}`}
              >
                <path
                  d={path}
                  className="wire-hit"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    actions.select([], w.id);
                  }}
                />
                <path
                  d={path}
                  className="wire-line"
                  pointerEvents="none"
                  opacity={simulation.disconnected.has(w.id) ? 0.25 : 1}
                />
                {state.selectedWire === w.id &&
                  routePoints(w, project.components, project.connections)
                    .slice(1, -1)
                    .map((pt, i) => (
                      <circle
                        key={i}
                        cx={pt.x}
                        cy={pt.y}
                        r="6"
                        className="bend-handle"
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          actions.beginMove();
                          bend.current = {
                            id: w.id,
                            index: i,
                            route: routePoints(w, project.components, project.connections).slice(
                              1,
                              -1,
                            ),
                          };
                          e.currentTarget.setPointerCapture(e.pointerId);
                        }}
                      />
                    ))}
                {live && (
                  <path d={path} className="flow-line" pointerEvents="none" />
                )}
              </g>
            );
          })}
          {pendingComponent && pending && (
            <path
              d={`M${portPoint(pendingComponent, pending.port).x},${portPoint(pendingComponent, pending.port).y}H${cursor.x}V${cursor.y}`}
              stroke={T.n14}
              strokeDasharray="5 5"
              fill="none"
              pointerEvents="none"
            />
          )}
          {project.components.map((c) => {
            const { w, h } = dimensions(c),
              sel = selected.includes(c.id),
              r = simulation.electrical.readings[c.id],
              status = moduleStatus(c),
              // The name runs from x = 12 to the status lamp; terminals on the right edge inside the name band (grid side of
              // inverters, tank overflow) take the end of the band.
              nameWidth = definitions[c.kind].ports.some((p) => { const q = portLocal(c, p.id); return q.x > w && q.y < 31; }) ? w - 68 : w - 35;
            return (
              <g
                key={c.id}
                data-component={c.kind}
                data-status={status?.tone}
                className={`component-node domain-${domainOf(c)}`}
                transform={`translate(${c.x},${c.y})`}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  down(e, c.id);
                }}
                onDoubleClick={(e) => {
                  // The module holds pointer capture, so locate the double-click in module coordinates
                  // (undoing its rotation): the 31 px name band renames, the body operates (switches).
                  const p = local(e.clientX, e.clientY), r = (-c.rotation * Math.PI) / 180, dx = p.x - c.x - w / 2, dy = p.y - c.y - h / 2;
                  const y = dx * Math.sin(r) + dy * Math.cos(r) + h / 2;
                  if (y >= 0 && y <= 31) actions.requestRename(c.id);
                  else actions.toggle(c.id);
                }}
              >
                <g transform={`rotate(${c.rotation},${w / 2},${h / 2})`}>
                  <rect
                    width={w}
                    height={h}
                    rx="6"
                    className={`component-body ${sel ? "component-selected" : ""} ${simulation.failed[c.id] ? "component-failed" : ""}`}
                  />
                  <path d={`M1 31V7a6 6 0 0 1 6-6H${w - 7}a6 6 0 0 1 6 6V31Z`} className="component-header" />
                  <path d={`M0 31.5H${w}`} className="component-rule" />
                  <text x="12" y="20.5" className="component-id">
                    {fitName(c.name, nameWidth)}
                    <title>{c.name}</title>
                  </text>
                  {status && (
                    <g className={`status-lamp ${status.tone}`}>
                      <title>{status.text}</title>
                      <circle cx={w - 15} cy="16" r="4.5" />
                    </g>
                  )}
                  <ModuleFace c={c} />
                  <ModuleTerminals c={c} w={w} h={h} connections={project.connections} pendingPort={pending?.component === c.id ? pending.port : null}
                    nodeMode={state.nodeMode} reference={state.reference} live={state.nodeMode ? state.revision : 0} onPort={onPort} />
                </g>
                <text
                  x={w / 2}
                  y={h + 32}
                  textAnchor="middle"
                  className="component-caption"
                >
                  {definitions[c.kind].label}
                </text>
                {overlay && (hasStarted() || c.kind === "tank") && (
                  <text
                    x={w / 2}
                    y={h + (c.kind === "heater" ? 64 : 49)}
                    textAnchor="middle"
                    className="live-caption"
                  >
                    {c.kind === "tank"
                      ? (simulation.multiphysics.overflowRate[c.id] ?? 0) > 1e-9
                        ? `FULL · overflowing ${((simulation.multiphysics.overflowRate[c.id] ?? 0) * 60000).toFixed(2)} L/min · ${((simulation.multiphysics.overflowed[c.id] ?? 0) * 1000).toFixed(2)} L spilled`
                        : `${((simulation.multiphysics.tanks[c.id]?.volume ?? prop(c, "volume") / 1000) * 1000).toFixed(2)} L  ·  ${((simulation.multiphysics.tanks[c.id]?.mass ?? prop(c, "volume")) * 4.18).toFixed(1)} kJ/K`
                      : c.kind === "heatExchanger"
                        ? `${((simulation.multiphysics.hydraulic.readings[c.id]?.duty ?? 0) / 1000).toFixed(1)} kW heat · ${c.props.arrangement}`
                      : c.kind === "pump"
                        ? `${((simulation.multiphysics.hydraulic.readings[c.id]?.flow ?? 0) * 60000).toFixed(2)} L/min · ${(simulation.multiphysics.hydraulic.readings[c.id]?.shaftPower ?? 0).toFixed(1)} W shaft`
                      : c.kind === "circulator"
                        ? `${((simulation.multiphysics.hydraulic.readings[c.id]?.flow ?? 0) * 60000).toFixed(2)} L/min · ${(-(simulation.multiphysics.hydraulic.readings[c.id]?.differentialPressure ?? 0) / 9806.65).toFixed(2)} m head`
                      : c.kind === "expansionVessel"
                        ? `${((simulation.multiphysics.vessels[c.id]?.pressure ?? 0) / 100000).toFixed(3)} bar · expansion ${((simulation.multiphysics.vessels[c.id]?.expansion ?? 0) * 1000).toFixed(2)} L`
                      : c.kind === "safetyValve"
                        ? `${((simulation.multiphysics.hydraulic.readings[c.id]?.differentialPressure ?? 0) / 100000).toFixed(3)} bar · ${((simulation.multiphysics.hydraulic.readings[c.id]?.flow ?? 0) * 60000).toFixed(2)} L/min discharge`
                      : c.kind === "storageTank"
                        ? `${((simulation.multiphysics.hydraulic.readings[c.id]?.flow ?? 0) * 60000).toFixed(2)} L/min through · coil ${((simulation.multiphysics.hydraulic.readings[c.id]?.duty ?? 0) / 1000).toFixed(2)} kW`
                      : c.kind === "panelRadiator"
                        ? `${((simulation.multiphysics.hydraulic.readings[c.id]?.flow ?? 0) * 60000).toFixed(2)} L/min · ΔT ${(simulation.multiphysics.hydraulic.readings[c.id]?.excessTemperature ?? 0).toFixed(1)} K`
                        : ["pipe", "valve", "checkValve", "actuatedValve", "thermostaticValve", "fluidJunction"].includes(c.kind)
                          ? `${((simulation.multiphysics.hydraulic.readings[c.id]?.pressure ?? 0) / 100000).toFixed(3)} bar · Δp ${((simulation.multiphysics.hydraulic.readings[c.id]?.differentialPressure ?? 0) / 100000).toFixed(3)} bar`
                        : c.kind === "motor"
                          ? `${(simulation.multiphysics.motors[c.id]?.current ?? 0).toFixed(2)} A armature · ${(simulation.multiphysics.motors[c.id]?.shaftPower ?? 0).toFixed(1)} W shaft`
                        : c.kind === "flywheel"
                          ? `${((simulation.multiphysics.shaftElements[c.id]?.kinetic ?? 0) / 1000).toFixed(2)} kJ stored · ${(simulation.multiphysics.shaftElements[c.id]?.torque ?? 0).toFixed(1)} N·m shaft`
                        : c.kind === "dynamometer"
                          ? `${(simulation.multiphysics.shaftElements[c.id]?.torque ?? 0).toFixed(1)} N·m · ${((simulation.multiphysics.shaftElements[c.id]?.power ?? 0) / 1000).toFixed(2)} kW absorbed`
                        : c.kind === "vfd"
                          ? (() => { const d = simulation.electrical.readings[c.id]?.drive; return d?.running ? `${d.frequency.toFixed(1)} Hz · ${d.outputCurrent.toFixed(1)} A out · ${d.inputPower.toFixed(0)} W in` : d?.energized ? "Output off · DC link charged" : "No supply"; })()
                        : c.kind === "starDeltaStarter" || c.kind === "softStarter"
                          ? `${Math.abs(simulation.electrical.readings[c.id]?.current ?? 0).toFixed(1)} A line · ${(simulation.multiphysics.starters[c.id]?.mode ?? "off").toUpperCase()}`
                        : c.kind === "inductionMotor"
                          ? `${(simulation.multiphysics.motors[c.id]?.current ?? 0).toFixed(2)} A line · slip ${((simulation.electrical.readings[c.id]?.machine?.slip ?? 1) * 100).toFixed(1)} % · ${(simulation.multiphysics.motors[c.id]?.shaftPower ?? 0).toFixed(0)} W shaft`
                        : simulation.electrical.readings[c.id]?.ac
                          ? `${(simulation.electrical.readings[c.id]?.voltage ?? 0).toFixed(1)} V~ · ${(delivered(c) * (simulation.electrical.readings[c.id]?.power ?? 0)).toFixed(0)} W · ${(delivered(c) * (simulation.electrical.readings[c.id]?.reactivePower ?? 0)).toFixed(0)} var`
                      : c.kind === "source"
                        ? `${Math.abs(r?.current ?? 0).toFixed(2)} A  ·  ${(-(r?.power ?? 0)).toFixed(1)} W`
                        : c.kind === "switch"
                          ? "Double-click to toggle"
                          : simulation.automation.status[c.id] &&
                              definitions[c.kind].ports.some(
                                (p) => p.domain === "control",
                              )
                            ? simulation.automation.status[c.id].toUpperCase()
                            : `${(r?.voltage ?? 0).toFixed(2)} V  ·  ${(delivered(c) * (r?.power ?? 0)).toFixed(1)} W`}
                  </text>
                )}
              </g>
            );
          })}
          {/* Wires drawn again, clipped to the module bodies: a wire that still crosses a module (hand-placed bends,
              or no free route) stays visible instead of disappearing behind it. */}
          <WireOverlay components={project.components} connections={project.connections} selectedWire={state.selectedWire} disconnected={[...simulation.disconnected].join(",")} />
          {camera.z >= 0.5 && hasStarted() && project.connections.map((w) => {
            const value = wireValue(w, project, wireFlow(w)), at = value && chipAnchor(routePoints(w, project.components, project.connections));
            if (!value || !at) return null;
            // Counter-scale so chips stay about 12 px on screen at any zoom.
            const k = Math.min(2.2, Math.max(0.9, 1 / camera.z)), width = value.length * 7.4 + 14;
            return (
              <g key={`chip-${w.id}`} className={`wire-chip ${w.domain}`} transform={`translate(${at.x},${at.y}) scale(${k})`} pointerEvents="none">
                <rect x={-width / 2} y={-11} width={width} height={22} rx={6} />
                <text x={0} y={4} textAnchor="middle">{value}</text>
              </g>
            );
          })}
          {marquee && (
            <rect
              x={Math.min(marquee.x, marquee.x2)}
              y={Math.min(marquee.y, marquee.y2)}
              width={Math.abs(marquee.x - marquee.x2)}
              height={Math.abs(marquee.y - marquee.y2)}
              fill="#6ab49720"
              stroke={T.okText}
              strokeDasharray="4 3"
            />
          )}
        </g>
      </svg>
      {!project.components.length && (
        <div className="empty-canvas">
          <span className="empty-cross">+</span>
          <h2>{project.challenge ? "Your mission. Your circuit." : "Your next experiment starts here."}</h2>
          <p>
            Drag a component from the library onto the workspace.
            <br />
            Click two matching terminals to connect them.
          </p>
          <button onClick={() => actions.set({ view: project.challenge ? 'guidebook' : 'examples' })}>
            {project.challenge ? 'Open mission guidebook' : 'Explore starters & examples'}
          </button>
        </div>
      )}
      <div className="canvas-label">
        <span className="canvas-label-dot" />{" "}
        {project.challenge ? "CHALLENGE WORKSPACE" : "ENGINEERING WORKSPACE"}{" "}
        <span>SI UNITS</span>
      </div>
      <div className="canvas-hint">
        {state.nodeMode
          ? state.reference
            ? "Click terminals to add differential voltage traces; toggle mode to exit."
            : "Click an electrical terminal to choose the voltage reference."
          : pending
            ? "Select a matching terminal · Esc to cancel"
            : tool === "wire"
              ? "Click two terminals to connect"
              : tool === "pan"
                ? "Drag to pan · Scroll to zoom"
                : "Drag to move · Click terminals to connect · Space to pan"}
      </div>
      <div className="zoom-controls">
        <button aria-label="Zoom out" onClick={() => zoom(1 / 1.15)}>
          <Minus size={14} />
        </button>
        <span>{Math.round(camera.z * 100)}%</span>
        <button aria-label="Zoom in" onClick={() => zoom(1.15)}>
          <Plus size={14} />
        </button>
        <i />
        <button
          title="Fit experiment"
          aria-label="Fit experiment"
          onClick={fit}
        >
          <Maximize size={14} />
        </button>
      </div>
      {selected.length > 1 && (
        <div className="selection-info">
          <Check size={14} />
          {selected.length} selected{" "}
          <button
            onClick={() => {
              const cs = project.components.filter((c) =>
                selected.includes(c.id),
              );
              actions.beginMove();
              actions.move(
                Object.fromEntries(
                  cs.map((c) => [
                    c.id,
                    { x: c.x, y: Math.round(cs[0].y / 20) * 20 },
                  ]),
                ),
              );
            }}
          >
            Align horizontally
          </button>
        </div>
      )}
      {context && (
        <div
          className="context-menu"
          style={{
            left: Math.min(
              context.x,
              (wrapper.current?.clientWidth ?? 800) - 190,
            ),
            top: Math.min(
              context.y,
              (wrapper.current?.clientHeight ?? 500) - 180,
            ),
          }}
        >
          <button
            disabled={!selected.length}
            onClick={() => {
              actions.duplicate();
              setContext(null);
            }}
          >
            <Copy size={14} />
            Duplicate <kbd>Ctrl D</kbd>
          </button>
          <button
            disabled={!selected.length}
            onClick={() => {
              actions.rotate();
              setContext(null);
            }}
          >
            <RotateCw size={14} />
            Rotate <kbd>R</kbd>
          </button>
          <button
            disabled={selected.length !== 1 || !!project.challenge}
            onClick={() => {
              actions.requestRename(selected[0]);
              setContext(null);
            }}
          >
            <Pencil size={14} />
            Rename <kbd>F2</kbd>
          </button>
          <button
            disabled={!selected.length && !state.selectedWire}
            onClick={() => {
              actions.remove();
              setContext(null);
            }}
          >
            <Trash2 size={14} />
            Delete <kbd>Del</kbd>
          </button>
          <button
            onClick={() => {
              fit();
              setContext(null);
            }}
          >
            <Maximize size={14} />
            Fit experiment
          </button>
        </div>
      )}
    </div>
  );
}
