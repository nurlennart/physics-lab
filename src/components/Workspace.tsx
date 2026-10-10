import { T } from "../theme/tokens";
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
export { dimensions, portPoint } from "../editor/geometry";
function CircuitSymbol({ c }: { c: Component }) {
  const w = dimensions(c).w,
    r = simulation.electrical.readings[c.id],
    power = r?.power ?? 0;
  const failed = simulation.failed[c.id];
  if (c.kind === "tank") {
    const temp = simulation.temperatures[c.id] ?? 20,
      fill = Math.min(1, (simulation.multiphysics.tanks[c.id]?.volume ?? prop(c, "volume") / 1000) * 1000 / prop(c, "capacity"));
    return (
      <g>
        <rect
          x="21"
          y="47"
          width="160"
          height="98"
          rx="5"
          fill={T.n3}
          stroke={T.n11}
        />
        <path
          d={`M22 ${144 - 90 * fill}H180V140Q180 144 176 144H26Q22 144 22 140Z`}
          fill={T.hydraulicDim}
        />
        <path
          d={`M22 ${144 - 90 * fill}H180`}
          stroke={T.hydraulic}
          strokeWidth="1.5"
        />
        <path d="M101 0V47" stroke={T.thermalText} strokeWidth="2" />
        <path
          d="M83 49v35q0 9 9 9h20q9 0 9-9V49"
          stroke={T.thermalText}
          strokeWidth="3"
          fill="none"
        />
        <text x="101" y="125" className="tank-number" textAnchor="middle">
          {temp.toFixed(2)}
          <tspan className="unit"> °C</tspan>
        </text>
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i}>
            <path d={`M167 ${56 + i * 19}h10`} stroke={T.n11} />
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
  if (["motor", "inductionMotor", "pump"].includes(c.kind)) {
    const speed = c.kind === "motor" || c.kind === "inductionMotor" ? simulation.multiphysics.motors[c.id]?.omega ?? 0 : (() => { const wire = simulation.project.connections.find(w => w.domain === "mechanical" && (w.from.component === c.id || w.to.component === c.id)); return wire ? simulation.multiphysics.motors[wire.from.component === c.id ? wire.to.component : wire.from.component]?.omega ?? 0 : 0; })();
    return <g><path d="M0 66H52M122 66H174M87 0V32" stroke={T.hydraulic} strokeWidth="2"/><circle cx="87" cy="66" r="34" fill={T.n5} stroke={T.hydraulic} strokeWidth="2"/><path d="M65 66H109M87 44V88" stroke={T.hydraulic} transform={`rotate(${speed * simulation.time * 180 / Math.PI},87,66)`}/><text x="87" y="119" textAnchor="middle" className="scale-label">{(speed * 30 / Math.PI).toFixed(0)} RPM</text></g>;
  }
  if (c.kind === "heatExchanger") {
    const hot = simulation.multiphysics.hydraulic.readings[`${c.id}#hot`], cold = simulation.multiphysics.hydraulic.readings[`${c.id}#cold`];
    return (
      <g>
        <rect x="18" y="30" width="138" height="72" rx="4" fill={T.n5} stroke={T.hydraulic} />
        <path d="M0 40H174" stroke={T.thermalText} strokeWidth="2" />
        <path d="M174 99H0" stroke={T.hydraulic} strokeWidth="2" />
        <path d="M30 48V91M50 48V91M70 48V91M90 48V91M110 48V91M130 48V91M150 48V91" stroke={T.n11} />
        <text x="87" y="73" textAnchor="middle" className="component-state">{((hot?.duty ?? 0) / 1000).toFixed(2)} kW · UA {prop(c, "ua")} W/K</text>
        <text x="87" y="123" textAnchor="middle" className="scale-label">A {((hot?.flow ?? 0) * 60000).toFixed(1)} · B {((cold?.flow ?? 0) * 60000).toFixed(1)} L/min</text>
      </g>
    );
  }
  if (["pipe", "valve", "checkValve", "actuatedValve", "fluidJunction", "pressureReducingValve"].includes(c.kind)) {
    const r = simulation.multiphysics.hydraulic.readings[c.id], opening = simulation.faults[c.id] === "stuckClosed" ? 0 : simulation.faults[c.id] === "stuckOpen" ? 100 : c.kind === "checkValve" ? (Math.abs(r?.flow ?? 0) > 1e-12 ? 100 : 0) : simulation.multiphysics.positions[c.id] ?? prop(c, "opening", 100);
    return <g><path d="M0 66H174" stroke={T.hydraulic} strokeWidth={c.kind === "pipe" ? 8 : 2}/>{c.kind.includes("alve") && <path d="M61 49L111 83V49L61 83Z" fill={T.n8} stroke={T.hydraulicText}/>}<text x="87" y="107" textAnchor="middle" className="scale-label">{c.kind.includes("alve") ? `${opening.toFixed(0)}% · ` : ""}{((r?.flow ?? 0) * 60000).toFixed(2)} L/min</text><text x="87" y="123" textAnchor="middle" className="scale-label">{((r?.pressure ?? 0) / 100000).toFixed(3)} bar {Math.abs(r?.flow ?? 0) < 1e-12 ? "" : r!.flow > 0 ? "→" : "←"}</text></g>;
  }
  if (c.kind === "source3")
    return (
      <g>
        <rect x="17" y="43" width="140" height="61" rx="3" fill={T.n3} stroke={T.n10} />
        <text x="87" y="80" textAnchor="middle" className="supply-number">
          {prop(c, "lineVoltage").toFixed(0)}
          <tspan className="unit"> V 3~</tspan>
        </text>
        <circle cx="29" cy="92" r="2.5" fill={c.props.enabled === false || failed ? T.faultText : T.ok} />
        <text x="39" y="95" className="scale-label">{c.props.enabled === false ? "OUTPUT OFF" : failed ? "TRIPPED" : `${prop(c, "frequency")} Hz · PER-PHASE MODEL`}</text>
        <path d="M0 66H17M157 66H174" stroke={T.n13} />
        <text x="5" y="57" className="polarity">L</text>
        <text x="161" y="57" className="polarity">N</text>
      </g>
    );
  if (c.kind === "source")
    return (
      <g>
        <rect
          x="17"
          y="43"
          width="140"
          height="61"
          rx="3"
          fill={T.n3}
          stroke={T.n10}
        />
        <text x="87" y="80" textAnchor="middle" className="supply-number">
          {prop(c, "voltage").toFixed(1)}
          <tspan className="unit"> V</tspan>
        </text>
        <circle cx="29" cy="92" r="2.5" fill={c.props.enabled === false || failed ? T.faultText : r?.regulation === "cc" ? T.electricalText : T.ok} />
        <text x="39" y="95" className="scale-label">
          {c.props.enabled === false ? "OUTPUT OFF" : failed ? "TRIPPED" : r?.regulation === "cc" ? "CC LIMIT" : c.props.mode === "cvcc" ? "DC OUT · CV/CC" : c.props.mode === "cc" ? "DC OUT · CC" : "DC OUTPUT"}
        </text>
        <path d="M0 66H17M157 66H174" stroke={T.n13} />
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
        <path d="M0 51H49M106 51H154" stroke={T.n13} strokeWidth="2" />
        <circle cx="49" cy="51" r="4" fill={T.n6} stroke={T.n14} />
        <circle cx="106" cy="51" r="4" fill={T.n6} stroke={T.n14} />
        <path
          d={c.props.closed ? "M49 51L106 51" : "M49 51L101 28"}
          stroke={c.props.closed ? T.n13 : T.n14}
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
        <path d="M0 66H62M112 66H174" stroke={T.n12} strokeWidth="2" />
        {power > 1 && !failed && (
          <circle
            cx="87"
            cy="66"
            r="35"
            fill={T.electricalText}
            opacity={Math.min(0.25, power / 120)}
            filter="url(#lampGlow)"
          />
        )}
        <circle
          cx="87"
          cy="66"
          r="25"
          fill={power > 1 && !failed ? T.n8 : T.n5}
          stroke={power > 1 && !failed ? T.electricalText : T.n13}
          strokeWidth="2"
        />
        <path
          d="M70 49L104 83M70 83L104 49"
          stroke={power > 1 && !failed ? T.electricalText : T.n13}
          strokeWidth="2"
        />
        <text x="87" y="111" textAnchor="middle" className="component-state">
          {failed ? "FAILED" : power > 1 ? "ILLUMINATED" : "UNPOWERED"}
        </text>
      </g>
    );
  if (c.kind === "ground")
    return (
      <g stroke={T.n13} fill="none">
        <path d="M0 66H87V81M65 81H109M72 89H102M80 97H94" />
      </g>
    );
  if (c.kind === "meter")
    return (
      <g>
        <path d="M0 66H57M117 66H174" stroke={T.n12} />
        <circle cx="87" cy="66" r="29" fill={T.n4} stroke={T.n13} />
        <text x="87" y="73" textAnchor="middle" className="meter-number">
          {(r?.voltage ?? 0).toFixed(1)} V
        </text>
      </g>
    );
  if (["relay", "safety"].includes(c.kind)) {
    const on = simulation.automation.contacts[c.id],
      trip = simulation.automation.memory[c.id]?.tripped;
    return (
      <g>
        <path d="M0 66H47M125 66H174" stroke={T.n12} />
        <circle cx="47" cy="66" r="4" fill={T.mechanicalText} />
        <path
          d={on ? "M47 66H125" : "M47 66L118 42"}
          stroke={trip ? T.faultText : T.n13}
          strokeWidth="3"
        />
        {c.kind === "relay" && (
          <path
            d="M125 107H174M125 66V107"
            fill="none"
            stroke={T.n11}
            strokeDasharray="3 3"
          />
        )}
        <text
          x="87"
          y="113"
          textAnchor="middle"
          className="component-state"
          fill={trip ? T.faultText : T.mechanicalText}
        >
          {trip ? "TRIPPED / LATCHED" : on ? "CONTACT CLOSED" : "CONTACT OPEN"}
        </text>
      </g>
    );
  }
  if (c.kind === "junction")
    return (
      <g>
        <path d="M0 66H87" stroke={T.electricalText} />
        <circle cx="87" cy="66" r="7" fill={T.electricalText} />
        <text x="87" y="108" textAnchor="middle" className="component-state">
          EXPLICIT NODE
        </text>
      </g>
    );
  if (c.kind === "cooler")
    return (
      <g stroke={T.hydraulic}>
        <path d="M40 50V94H134V50M50 57H124M50 68H124M50 79H124" fill="none" />
        <text x="87" y="114" textAnchor="middle" className="component-state">
          {simulation.faults[c.id] === "coolingFailed"
            ? "COOLANT LOST"
            : `${prop(c, "conductance")} W/K`}
        </text>
      </g>
    );
  if (c.kind === "thermalMass")
    return (
      <g>
        <rect x="37" y="44" width="100" height="52" rx="4" fill={T.n5} stroke={T.thermal} />
        <path d="M47 44V34M62 44V34M77 44V34M92 44V34M107 44V34M122 44V34" stroke={T.n11} />
        <text x="87" y="76" textAnchor="middle" className="component-state" fill={T.thermalText}>
          {(simulation.temperatures[c.id] ?? prop(c, "initialTemperature")).toFixed(1)} °C
        </text>
        <text x="87" y="114" textAnchor="middle" className="component-state">
          {(prop(c, "heatCapacity") / 1000).toPrecision(3)} kJ/K · {prop(c, "loss")} W/K
        </text>
      </g>
    );
  if (c.kind === "breaker" || c.kind === "motorProtector") {
    const tripped = simulation.breakers[c.id]?.tripped, open = tripped || c.props.closed === false;
    return (
      <g>
        <path d="M0 66H55M119 66H174" stroke={T.n13} strokeWidth="2" />
        <path d={open ? "M55 66L112 44" : "M55 66L119 66"} stroke={tripped ? T.faultText : T.n14} strokeWidth="2" />
        <rect x="70" y="76" width="34" height="16" rx="2" fill="none" stroke={T.n12} />
        <text x="87" y="110" textAnchor="middle" className="component-state">
          {prop(c, "ratedCurrent")} A · {tripped ? "TRIPPED" : open ? "OPEN" : "CLOSED"}
        </text>
      </g>
    );
  }
  if (definitions[c.kind].ports.some((p) => p.domain === "control")) {
    const v = simulation.automation.signals[c.id],
      sensor = simulation.automation.sensors[c.id];
    return (
      <g>
        <rect
          x="20"
          y="44"
          width="134"
          height="49"
          rx="3"
          fill={T.n4}
          stroke={T.n11}
        />
        <text
          x="87"
          y="75"
          textAnchor="middle"
          className="meter-number"
          fill={T.mechanicalText}
        >
          {!v?.valid
            ? "INVALID"
            : typeof v.value === "boolean"
              ? v.value
                ? "ON"
                : "OFF"
              : Number(v.value).toFixed(2)}
        </text>
        <text x="87" y="114" textAnchor="middle" className="component-state">
          {sensor?.valid
            ? Number(sensor.value).toPrecision(5) + " " + (definitions[c.kind].ports.find(p => p.id === "out")?.unit ?? "°C")
            : c.kind === "timer"
              ? `${simulation.automation.memory[c.id]?.elapsed.toFixed(2) ?? "0"} s`
              : definitions[c.kind].spec}
        </text>
      </g>
    );
  }
  const heater = c.kind === "heater";
  return (
    <g>
      <path
        d="M0 66H34M140 66H174"
        stroke={heater ? T.thermalText : T.n13}
        strokeWidth="2"
      />
      <path
        d="M34 66h9l7-14 12 28 12-28 12 28 12-28 12 28 12-28 7 14h11"
        fill="none"
        stroke={failed ? T.faultText : heater ? T.thermalText : T.n14}
        strokeWidth="2"
      />
      {heater && (
        <>
          <path d="M87 82V132" stroke={T.thermalText} strokeDasharray="4 3" />
          <text
            x="87"
            y="107"
            textAnchor="middle"
            className="component-state"
            fill={T.thermalText}
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
          stroke={T.n13}
          rx="3"
        />
      )}
      {!heater && (
        <text x="87" y="110" textAnchor="middle" className="component-state">
          {failed
            ? "OPEN / FAILED"
            : c.kind === "cable"
              ? `${c.props.material === "aluminium" ? "Al" : "Cu"} ${prop(c, "area")} mm² · ${prop(c, "length")} m`
              : `${Number(prop(c, "resistance").toPrecision(4))} Ω`}
        </text>
      )}
    </g>
  );
}

/** Signed volume flow along a hydraulic wire (from → to), from the branch reading at either end. */
function wireFlow(w: Connection) {
  if (w.domain !== "hydraulic") return 0;
  const h = simulation.multiphysics.hydraulic;
  const portFlow = (id: string, port: string) => { const reading = h.readings[id]; if (!reading || !["inlet", "outlet"].includes(port)) return undefined; return reading.flow * (port === "outlet" ? 1 : -1); };
  return portFlow(w.from.component, w.from.port) ?? -(portFlow(w.to.component, w.to.port) ?? 0);
}
/** Physical domain that colours a component's identifier (control and sensors stay neutral). */
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
  const bend = useRef<{
    id: string;
    index: number;
    route: { x: number; y: number }[];
  } | null>(null);
  const space = useRef(false);
  function fit() {
    const el = wrapper.current;
    if (!el) return;
    if (!project.components.length) {
      setCamera({ x: 60, y: 60, z: 1 });
      return;
    }
    const routes = project.connections.flatMap((w) =>
      routePoints(w, project.components),
    );
    const minX =
        Math.min(
          ...project.components.map((c) => c.x),
          ...routes.map((p) => p.x),
        ) - 65,
      minY =
        Math.min(
          ...project.components.map((c) => c.y),
          ...routes.map((p) => p.y),
        ) - 80,
      maxX =
        Math.max(
          ...project.components.map((c) => c.x + dimensions(c).w),
          ...routes.map((p) => p.x),
        ) + 70,
      maxY =
        Math.max(
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
    if (g.type === "box")
      setMarquee((m) => (m ? { ...m, x2: p.x, y2: p.y } : null));
  }
  function up() {
    bend.current = null;
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
            <circle cx="1" cy="1" r=".75" fill={T.n9} />
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
                  routePoints(w, project.components)
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
                            route: routePoints(w, project.components).slice(
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
          {pending && (
            <path
              d={`M${portPoint(project.components.find((c) => c.id === pending.component)!, pending.port).x},${portPoint(project.components.find((c) => c.id === pending.component)!, pending.port).y}H${cursor.x}V${cursor.y}`}
              stroke={T.n14}
              strokeDasharray="5 5"
              fill="none"
              pointerEvents="none"
            />
          )}
          {project.components.map((c) => {
            const { w, h } = dimensions(c),
              sel = selected.includes(c.id),
              r = simulation.electrical.readings[c.id];
            return (
              <g
                key={c.id}
                data-component={c.kind}
                className={`component-node domain-${domainOf(c)}`}
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
                    rx="8"
                    className={`component-body ${sel ? "component-selected" : ""} ${simulation.failed[c.id] ? "component-failed" : ""}`}
                  />
                  <path d={`M0 31H${w}`} stroke={T.n9} />
                  <text x="13" y="20" className="component-id">
                    {c.name}
                  </text>
                  <CircuitSymbol c={c} />
                  {definitions[c.kind].ports.map((p) => {
                    const { x, y } = portLocal(c, p.id);
                    const branches = project.connections.filter(
                      (w) =>
                        w.domain === "electrical" &&
                        ((w.from.component === c.id && w.from.port === p.id) ||
                          (w.to.component === c.id && w.to.port === p.id)),
                    ).length;
                    const potential =
                      state.nodeMode && p.domain === "electrical"
                        ? nodeVoltage(
                            simulation.electrical,
                            `${c.id}:${p.id}`,
                            state.reference
                              ? `${state.reference.component}:${state.reference.port}`
                              : undefined,
                          )
                        : null;
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
                        <title>{p.label}</title>
                        {branches > 1 && (
                          <circle cx={x} cy={y} r="8" fill={T.electricalText} />
                        )}
                        {state.nodeMode && p.domain === "electrical" && (
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
                        <path
                          d={
                            p.domain === "control" &&
                            ["relay", "safety", "cooler"].includes(c.kind)
                              ? `M${x} ${y}V${h}`
                              : p.id === "heat"
                                ? `M${x} ${y}V${c.kind === "tank" ? 0 : h}`
                                : `M${x} ${y}H${x < 0 ? 0 : w}`
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
                      ? (simulation.multiphysics.overflowRate[c.id] ?? 0) > 1e-9
                        ? `FULL · overflowing ${((simulation.multiphysics.overflowRate[c.id] ?? 0) * 60000).toFixed(2)} L/min · ${((simulation.multiphysics.overflowed[c.id] ?? 0) * 1000).toFixed(2)} L spilled`
                        : `${((simulation.multiphysics.tanks[c.id]?.volume ?? prop(c, "volume") / 1000) * 1000).toFixed(2)} L  ·  ${((simulation.multiphysics.tanks[c.id]?.mass ?? prop(c, "volume")) * 4.18).toFixed(1)} kJ/K`
                      : c.kind === "heatExchanger"
                        ? `${((simulation.multiphysics.hydraulic.readings[c.id]?.duty ?? 0) / 1000).toFixed(1)} kW heat · ${c.props.arrangement}`
                      : c.kind === "pump"
                        ? `${((simulation.multiphysics.hydraulic.readings[c.id]?.flow ?? 0) * 60000).toFixed(2)} L/min · ${(simulation.multiphysics.hydraulic.readings[c.id]?.shaftPower ?? 0).toFixed(1)} W shaft`
                        : ["pipe", "valve", "checkValve", "actuatedValve", "fluidJunction"].includes(c.kind)
                          ? `${((simulation.multiphysics.hydraulic.readings[c.id]?.pressure ?? 0) / 100000).toFixed(3)} bar · Δp ${((simulation.multiphysics.hydraulic.readings[c.id]?.differentialPressure ?? 0) / 100000).toFixed(3)} bar`
                        : c.kind === "motor"
                          ? `${(simulation.multiphysics.motors[c.id]?.current ?? 0).toFixed(2)} A armature · ${(simulation.multiphysics.motors[c.id]?.shaftPower ?? 0).toFixed(1)} W shaft`
                        : c.kind === "inductionMotor"
                          ? `${(simulation.multiphysics.motors[c.id]?.current ?? 0).toFixed(2)} A line · slip ${((simulation.electrical.readings[c.id]?.machine?.slip ?? 1) * 100).toFixed(1)} % · ${(simulation.multiphysics.motors[c.id]?.shaftPower ?? 0).toFixed(0)} W shaft`
                        : simulation.electrical.readings[c.id]?.ac
                          ? `${(simulation.electrical.readings[c.id]?.voltage ?? 0).toFixed(1)} V~ · ${((isSource(c) ? -1 : 1) * (simulation.electrical.readings[c.id]?.power ?? 0)).toFixed(0)} W · ${((isSource(c) ? -1 : 1) * (simulation.electrical.readings[c.id]?.reactivePower ?? 0)).toFixed(0)} var`
                      : c.kind === "source"
                        ? `${Math.abs(r?.current ?? 0).toFixed(2)} A  ·  ${Math.abs(r?.power ?? 0).toFixed(1)} W`
                        : c.kind === "switch"
                          ? "Double-click to toggle"
                          : simulation.automation.status[c.id] &&
                              definitions[c.kind].ports.some(
                                (p) => p.domain === "control",
                              )
                            ? simulation.automation.status[c.id].toUpperCase()
                            : `${(r?.voltage ?? 0).toFixed(2)} V  ·  ${(r?.power ?? 0).toFixed(1)} W`}
                  </text>
                )}
              </g>
            );
          })}
          {camera.z >= 0.5 && project.connections.map((w) => {
            const value = wireValue(w, project, wireFlow(w)), at = value && chipAnchor(routePoints(w, project.components));
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
