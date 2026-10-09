import {
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
} from "lucide-react";
import { actions, availableHistory, simulation, useLab } from "../editor/store";
import {
  definitions,
  prop,
  type Component,
  type Terminal,
  type Connection,
} from "../simulation/model";
export function dimensions(c: Component) {
  return {
    w: c.kind === "tank" ? 202 : c.kind === "switch" ? 154 : 174,
    h: c.kind === "tank" ? 170 : c.kind === "switch" ? 100 : 132,
  };
}
export function portPoint(c: Component, port: string) {
  const { w, h } = dimensions(c);
  let x = port === "a" ? -12 : port === "b" ? w + 12 : w / 2,
    y = port === "heat" ? (c.kind === "tank" ? -12 : h + 12) : h / 2;
  const r = (c.rotation * Math.PI) / 180,
    dx = x - w / 2,
    dy = y - h / 2;
  return {
    x: c.x + w / 2 + dx * Math.cos(r) - dy * Math.sin(r),
    y: c.y + h / 2 + dx * Math.sin(r) + dy * Math.cos(r),
  };
}
function wirePath(w: Connection, cs: Component[]) {
  const c = cs.find((c) => c.id === w.from.component),
    d = cs.find((c) => c.id === w.to.component);
  if (!c || !d) return "";
  const a = portPoint(c, w.from.port),
    b = portPoint(d, w.to.port);
  if (w.domain === "thermal") {
    const y = (a.y + b.y) / 2;
    return `M${a.x},${a.y}V${y}H${b.x}V${b.y}`;
  }
  if (w.from.port === "a" && w.to.port === "a") {
    const y = Math.min(c.y, d.y) - 45;
    return `M${a.x},${a.y}H${a.x - 25}V${y}H${b.x - 25}V${b.y}H${b.x}`;
  }
  if (a.x > b.x + 80) {
    const y = Math.max(c.y + dimensions(c).h, d.y + dimensions(d).h) + 45;
    return `M${a.x},${a.y}H${a.x + 30}V${y}H${b.x + 30}V${b.y}H${b.x}`;
  }
  const x = (a.x + b.x) / 2;
  return `M${a.x},${a.y}H${x}V${b.y}H${b.x}`;
}
function CircuitSymbol({ c }: { c: Component }) {
  const w = dimensions(c).w,
    r = simulation.electrical.readings[c.id],
    power = r?.power ?? 0;
  const failed = simulation.failed[c.id];
  if (c.kind === "tank") {
    const temp = simulation.temperatures[c.id] ?? 20,
      fill = Math.min(1, prop(c, "volume") / prop(c, "capacity"));
    return (
      <g>
        <rect
          x="21"
          y="47"
          width="160"
          height="98"
          rx="5"
          fill="#121b22"
          stroke="#476471"
        />
        <path
          d={`M22 ${144 - 90 * fill}H180V140Q180 144 176 144H26Q22 144 22 140Z`}
          fill="#224b5b"
        />
        <path
          d={`M22 ${144 - 90 * fill}H180`}
          stroke="#61b4cf"
          strokeWidth="1.5"
        />
        <path d="M101 0V47" stroke="#ee9e70" strokeWidth="2" />
        <path
          d="M83 49v35q0 9 9 9h20q9 0 9-9V49"
          stroke="#d69769"
          strokeWidth="3"
          fill="none"
        />
        <text x="101" y="125" className="tank-number" textAnchor="middle">
          {temp.toFixed(2)}
          <tspan className="unit"> °C</tspan>
        </text>
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i}>
            <path d={`M167 ${56 + i * 19}h10`} stroke="#628693" />
            <text
              x="159"
              y={59 + i * 19}
              textAnchor="end"
              className="scale-label"
            >
              {Math.round(prop(c, "capacity") * (1 - i / 4))}
            </text>
          </g>
        ))}
      </g>
    );
  }
  if (c.kind === "source")
    return (
      <g>
        <rect
          x="17"
          y="43"
          width="140"
          height="61"
          rx="3"
          fill="#111a20"
          stroke="#3e4a52"
        />
        <text x="87" y="80" textAnchor="middle" className="supply-number">
          {prop(c, "voltage").toFixed(1)}
          <tspan className="unit"> V</tspan>
        </text>
        <circle cx="29" cy="92" r="2.5" fill="#79bca5" />
        <text x="39" y="95" className="scale-label">
          DC OUTPUT
        </text>
        <path d="M0 66H17M157 66H174" stroke="#bdad8c" />
        <text x="7" y="57" className="polarity">
          +
        </text>
        <text x="161" y="57" className="polarity">
          −
        </text>
      </g>
    );
  if (c.kind === "switch")
    return (
      <g>
        <path d="M0 51H49M106 51H154" stroke="#a0b1b8" strokeWidth="2" />
        <circle cx="49" cy="51" r="4" fill="#1b252d" stroke="#c4d0d7" />
        <circle cx="106" cy="51" r="4" fill="#1b252d" stroke="#c4d0d7" />
        <path
          d={c.props.closed ? "M49 51L106 51" : "M49 51L101 28"}
          stroke={c.props.closed ? "#a1c9b2" : "#b2bdc5"}
          strokeWidth="3"
        />
        <text x="77" y="82" className="component-state" textAnchor="middle">
          {c.props.closed ? "CLOSED" : "OPEN"}
        </text>
      </g>
    );
  if (c.kind === "lamp")
    return (
      <g>
        <path d="M0 66H62M112 66H174" stroke="#b1a489" strokeWidth="2" />
        {power > 1 && !failed && (
          <circle
            cx="87"
            cy="66"
            r="35"
            fill="#f2bd5b"
            opacity={Math.min(0.25, power / 120)}
            filter="url(#lampGlow)"
          />
        )}
        <circle
          cx="87"
          cy="66"
          r="25"
          fill={power > 1 && !failed ? "#403322" : "#172027"}
          stroke={power > 1 && !failed ? "#edc47a" : "#9ba9b3"}
          strokeWidth="2"
        />
        <path
          d="M70 49L104 83M70 83L104 49"
          stroke={power > 1 && !failed ? "#edc47a" : "#9ba9b3"}
          strokeWidth="2"
        />
        <text x="87" y="111" textAnchor="middle" className="component-state">
          {failed ? "FAILED" : power > 1 ? "ILLUMINATED" : "UNPOWERED"}
        </text>
      </g>
    );
  if (c.kind === "ground")
    return (
      <g stroke="#9ba9b3" fill="none">
        <path d="M0 66H87V81M65 81H109M72 89H102M80 97H94" />
      </g>
    );
  if (c.kind === "meter")
    return (
      <g>
        <path d="M0 66H57M117 66H174" stroke="#b1a489" />
        <circle cx="87" cy="66" r="29" fill="#131d24" stroke="#8ba7b5" />
        <text x="87" y="73" textAnchor="middle" className="meter-number">
          {(r?.voltage ?? 0).toFixed(1)} V
        </text>
      </g>
    );
  const heater = c.kind === "heater";
  return (
    <g>
      <path
        d="M0 66H34M140 66H174"
        stroke={heater ? "#d89870" : "#a1b2bc"}
        strokeWidth="2"
      />
      <path
        d="M34 66h9l7-14 12 28 12-28 12 28 12-28 12 28 12-28 7 14h11"
        fill="none"
        stroke={failed ? "#e26d72" : heater ? "#ed9b72" : "#bec8ce"}
        strokeWidth="2"
      />
      {heater && (
        <>
          <path d="M87 82V132" stroke="#d89870" strokeDasharray="4 3" />
          <text
            x="87"
            y="107"
            textAnchor="middle"
            className="component-state"
            fill="#d89870"
          >
            {(simulation.temperatures[c.id] ?? 20).toFixed(1)} °C
          </text>
        </>
      )}
      {c.kind === "fuse" && (
        <rect
          x="40"
          y="45"
          width="95"
          height="42"
          fill="none"
          stroke="#9ba9b3"
          rx="3"
        />
      )}
      {!heater && (
        <text x="87" y="110" textAnchor="middle" className="component-state">
          {failed ? "OPEN / FAILED" : `${prop(c, "resistance")} Ω`}
        </text>
      )}
    </g>
  );
}
export default function Workspace() {
  const state = useLab(),
    { project, selected, tool, grid, overlay } = state;
  const svg = useRef<SVGSVGElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const [camera, setCamera] = useState({ x: 20, y: 20, z: 1 });
  const [pending, setPending] = useState<Terminal | null>(null);
  const [cursor, setCursor] = useState({ x: 0, y: 0 });
  const [context, setContext] = useState<{ x: number; y: number } | null>(null);
  const [marquee, setMarquee] = useState<{
    x: number;
    y: number;
    x2: number;
    y2: number;
  } | null>(null);
  const gesture = useRef<{
    type: "pan" | "move" | "box";
    sx: number;
    sy: number;
    camera: typeof camera;
    positions: Record<string, { x: number; y: number }>;
  } | null>(null);
  const space = useRef(false);
  function fit() {
    const el = wrapper.current;
    if (!el) return;
    if (!project.components.length) {
      setCamera({ x: 60, y: 60, z: 1 });
      return;
    }
    const minX = Math.min(...project.components.map((c) => c.x)) - 65,
      minY = Math.min(...project.components.map((c) => c.y)) - 80,
      maxX =
        Math.max(...project.components.map((c) => c.x + dimensions(c).w)) + 70,
      maxY =
        Math.max(...project.components.map((c) => c.y + dimensions(c).h)) + 45;
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
      type: pan ? "pan" : id ? "move" : "box",
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
    if (g.type === "box")
      setMarquee((m) => (m ? { ...m, x2: p.x, y2: p.y } : null));
  }
  function up() {
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
  function portClick(t: Terminal) {
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
        <div className="tool-group">
          {[
            { id: "select", icon: MousePointer2, label: "Select (V)" },
            { id: "pan", icon: Hand, label: "Pan (H / Space)" },
            { id: "wire", icon: Cable, label: "Connect terminals (W)" },
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
            disabled={!selected.length}
            onClick={actions.rotate}
          >
            <RotateCw size={16} />
          </button>
          <button
            title="Duplicate (Ctrl D)"
            aria-label="Duplicate selected"
            disabled={!selected.length}
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
            <circle cx="1" cy="1" r=".75" fill="#38464c" />
          </pattern>
          <filter id="lampGlow">
            <feGaussianBlur stdDeviation="10" />
          </filter>
        </defs>
        {grid && <rect width="100%" height="100%" fill="url(#grid)" />}
        <g transform={`translate(${camera.x},${camera.y}) scale(${camera.z})`}>
          {project.connections.map((w) => {
            const path = wirePath(w, project.components),
              from = project.components.find((c) => c.id === w.from.component),
              r = from && simulation.electrical.readings[from.id];
            const live =
              state.running &&
              (w.domain === "thermal"
                ? simulation.electrical.dissipatedPower > 1
                : Math.abs(r?.current ?? 0) > 0.001);
            return (
              <g
                key={w.id}
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
                <path d={path} className="wire-line" pointerEvents="none" />
                {live && (
                  <path d={path} className="flow-line" pointerEvents="none" />
                )}
              </g>
            );
          })}
          {pending && (
            <path
              d={`M${portPoint(project.components.find((c) => c.id === pending.component)!, pending.port).x},${portPoint(project.components.find((c) => c.id === pending.component)!, pending.port).y}H${cursor.x}V${cursor.y}`}
              stroke="#b8c8d3"
              strokeDasharray="5 5"
              fill="none"
              pointerEvents="none"
            />
          )}
          {project.components.map((c) => {
            const { w, h } = dimensions(c),
              sel = selected.includes(c.id),
              r = simulation.electrical.readings[c.id],
              thermal = c.kind === "tank" || c.kind === "heater";
            return (
              <g
                key={c.id}
                data-component={c.kind}
                transform={`translate(${c.x},${c.y})`}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  down(e, c.id);
                }}
                onDoubleClick={() => actions.toggle(c.id)}
              >
                <g transform={`rotate(${c.rotation},${w / 2},${h / 2})`}>
                  <rect
                    width={w}
                    height={h}
                    rx="5"
                    className={`component-body ${sel ? "component-selected" : ""} ${simulation.failed[c.id] ? "component-failed" : ""}`}
                  />
                  <path d={`M0 31H${w}`} stroke="#344047" />
                  <text x="13" y="20" className="component-id">
                    {c.name}
                  </text>
                  <text
                    x={w - 12}
                    y="20"
                    textAnchor="end"
                    className={`component-domain ${thermal ? "thermal-text" : ""}`}
                  >
                    {c.kind === "tank"
                      ? "WATER"
                      : c.kind === "heater"
                        ? "HEATER"
                        : c.kind === "source"
                          ? "POWER"
                          : c.kind.toUpperCase()}
                  </text>
                  <CircuitSymbol c={c} />
                  {definitions[c.kind].ports.map((p) => {
                    const x =
                        p.id === "a" ? -12 : p.id === "b" ? w + 12 : w / 2,
                      y =
                        p.id === "heat"
                          ? c.kind === "tank"
                            ? -12
                            : h + 12
                          : h / 2;
                    const isPending =
                      pending?.component === c.id && pending.port === p.id;
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
                          portClick({ component: c.id, port: p.id });
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            portClick({ component: c.id, port: p.id });
                          }
                        }}
                      >
                        <path
                          d={
                            p.id === "heat"
                              ? `M${x} ${y}V${c.kind === "tank" ? 0 : h}`
                              : `M${x} ${y}H${p.id === "a" ? 0 : w}`
                          }
                          stroke="currentColor"
                        />
                        <circle cx={x} cy={y} r="13" fill="transparent" />
                        <circle cx={x} cy={y} r="5" className="port-circle" />
                        {p.domain === "thermal" && (
                          <circle cx={x} cy={y} r="2" fill="currentColor" />
                        )}
                      </g>
                    );
                  })}
                </g>
                <text
                  x={w / 2}
                  y={h + 32}
                  textAnchor="middle"
                  className="component-caption"
                >
                  {definitions[c.kind].label}
                </text>
                {overlay && (
                  <text
                    x={w / 2}
                    y={h + (c.kind === "heater" ? 64 : 49)}
                    textAnchor="middle"
                    className="live-caption"
                  >
                    {c.kind === "tank"
                      ? `${prop(c, "volume").toFixed(1)} L  ·  ${((prop(c, "volume") * 4180) / 1000).toFixed(1)} kJ/K`
                      : c.kind === "source"
                        ? `${Math.abs(r?.current ?? 0).toFixed(2)} A  ·  ${Math.abs(r?.power ?? 0).toFixed(1)} W`
                        : c.kind === "switch"
                          ? "Double-click to toggle"
                          : `${(r?.voltage ?? 0).toFixed(2)} V  ·  ${(r?.power ?? 0).toFixed(1)} W`}
                  </text>
                )}
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
              stroke="#8dd0b3"
              strokeDasharray="4 3"
            />
          )}
        </g>
      </svg>
      {!project.components.length && (
        <div className="empty-canvas">
          <span className="empty-cross">+</span>
          <h2>Your next experiment starts here.</h2>
          <p>
            Drag a component from the library onto the workspace.
            <br />
            Click two matching terminals to connect them.
          </p>
          <button onClick={() => actions.newProject("light")}>
            Load a simple circuit
          </button>
        </div>
      )}
      <div className="canvas-label">
        <span className="canvas-label-dot" />{" "}
        {project.challenge ? "CHALLENGE WORKSPACE" : "ENGINEERING WORKSPACE"}{" "}
        <span>SI UNITS</span>
      </div>
      <div className="canvas-hint">
        {pending
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
