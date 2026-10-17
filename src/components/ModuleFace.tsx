import type { ReactNode } from "react";
import { T } from "../theme/tokens";
import { definitions, prop, textProp, type Component } from "../simulation/model";
import { simulation } from "../editor/store";
import { dimensions, portLocal, storageY, STORAGE_BASE, STORAGE_TOP } from "../editor/geometry";
import { coilLayers, layerAt, storageLayers } from "../simulation/storage-tank";
import { effectiveAmbient } from "../simulation/environment";
import { trvSetpoint, trvTemperatureLabel } from "../simulation/thermostatic-valve";

/**
 * Schematic module faces (docs/DESIGN.md § Modules). Every module answers, in this order: what it is (symbol and
 * name), where to connect it (its real terminals, labelled where polarity or function matters), what it is doing
 * (status lamp and state line) and its one most important measurement (hero value). Everything else is in the
 * Inspector. Faces only read simulation state; module size and terminal positions come from editor/geometry.
 */

/**
 * Before the first Run the experiment is ready but not running: the canvas shows no operating values
 * (currents, powers, flows, speeds) and nothing glows. The engine still holds the switch-on solution.
 */
export const hasStarted = () => simulation.time > 0;
/** Module names are 600 12 px IBM Plex Mono at −0.4 px tracking (6.8 px per character): shorten to `room` px with an ellipsis. */
export function fitName(name: string, room: number) {
  const fits = Math.floor(room / 6.8);
  return name.length <= fits ? name : `${name.slice(0, fits - 1).trimEnd()}…`;
}

type Tone = "ok" | "idle" | "warning" | "fault";
/** Health shown by the status lamp: fault (failed, tripped, latched), warning (outside rating, degraded), ok (operating) or idle. */
export function moduleStatus(c: Component): { tone: Tone; text: string } | null {
  if (c.kind === "ground" || c.kind === "junction" || c.kind === "fluidJunction") return null;
  const s = simulation, status = s.automation.status[c.id], fault = s.faults[c.id];
  const hybrid = s.electrical.readings[c.id]?.hybrid, boiler = s.multiphysics.boilers[c.id];
  if (s.failed[c.id]) return { tone: "fault", text: s.tripped[c.id] ? "Protection tripped" : "Failed" };
  if (s.breakers[c.id]?.tripped) return { tone: "fault", text: "Tripped" };
  if (boiler?.fault) return { tone: "fault", text: boiler.fault === "flow" ? "Flow interlock" : "Overtemperature cutout" };
  const hp = s.multiphysics.heatPumps[c.id];
  if (hp?.fault || hp?.backupFault) return { tone: "fault", text: hp.fault ? `Locked out: ${hp.fault}` : "Backup heater overheat" };
  if (hp && hasStarted() && hp.mode === "defrost") return { tone: "warning", text: "Defrosting" };
  if (hybrid?.fault) return { tone: "fault", text: hybrid.fault };
  if (status === "tripped" || s.automation.memory[c.id]?.tripped) return { tone: "fault", text: "Tripped / latched" };
  if (fault) return { tone: "fault", text: `Injected fault: ${fault}` };
  if (status === "sensorFault" || status === "controlLost") return { tone: "warning", text: status === "sensorFault" ? "Sensor fault" : "Control signal lost" };
  if (status === "overloaded" || (s.overload[c.id] ?? 0) > 0 || hybrid?.overload) return { tone: "warning", text: "Outside rating" };
  if (s.multiphysics.circulators[c.id]?.lockedOut) return { tone: "warning", text: "Undervoltage lockout" };
  if ((s.multiphysics.overflowRate[c.id] ?? 0) > 1e-9) return { tone: "warning", text: "Overflowing" };
  if (c.kind === "safetyValve" && hasStarted() && (s.multiphysics.positions[c.id] ?? 0) > 0) return { tone: "warning", text: "Discharging" };
  const vessel = s.multiphysics.vessels[c.id];
  if (vessel && hasStarted() && vessel.water < 0) return { tone: "warning", text: "Vessel empty: below precharge" };
  if (vessel && hasStarted() && vessel.water > 0.98 * prop(c, "nominalVolume") / 1000) return { tone: "fault", text: "Cushion fully compressed" };
  return hasStarted() && active(c) ? { tone: "ok", text: "Operating" } : { tone: "idle", text: hasStarted() ? "Idle" : "Ready" };
}
/** Whether a module is doing work: power, flow, rotation, a true control output. */
function active(c: Component) {
  const s = simulation, r = s.electrical.readings[c.id], h = s.multiphysics.hydraulic.readings[c.id], v = s.automation.signals[c.id];
  // A heat pump's control output is its hot-water valve command, not its operating state.
  if (v && c.kind !== "heatPump") return v.valid && (typeof v.value === "boolean" ? v.value : true);
  if (s.multiphysics.motors[c.id]) return Math.abs(s.multiphysics.motors[c.id].omega) > 0.5;
  if (s.multiphysics.shaftElements[c.id]) return Math.abs(s.multiphysics.shaftElements[c.id].omega) > 0.5;
  if (c.kind === "switch") return c.props.closed === true;
  if (c.kind === "tank" || c.kind === "thermalMass") return true;
  if (r?.hybrid) return r.hybrid.mode !== "off" && r.hybrid.mode !== "standby";
  if (r?.solar) return r.solar.running;
  if (r?.drive) return r.drive.running;
  if (h && Math.abs(h.flow) > 1e-7) return true;
  return !!r && (Math.abs(r.power) > 0.05 || Math.abs(r.current) > 1e-3);
}

/** Terminal labels by port, drawn by the workspace next to each terminal; `strip` puts them on the terminal line. */
export type Pins = { labels: Record<string, string>; strip?: boolean };
/** `title`: the full state text when the state line shows a compact form. */
type Face = { symbol: ReactNode; hero?: string; detail?: string; title?: string; tone?: "fault" | "warning" | "thermal"; pins?: Pins; readoutY?: number };

// Number formatting: three significant figures with an SI prefix, or fixed decimals for familiar quantities.
const PREFIX: [number, string][] = [[1e6, "M"], [1e3, "k"], [1, ""], [1e-3, "m"], [1e-6, "µ"], [1e-9, "n"]];
function si(v: number, unit: string, space = true) {
  const a = Math.abs(v);
  if (!Number.isFinite(v)) return `— ${unit}`;
  if (a < 1e-12) return `0${space ? " " : ""}${unit}`;
  const [k, p] = PREFIX.find(([k]) => a >= k * 0.9995) ?? PREFIX[PREFIX.length - 1], x = v / k;
  const digits = Math.abs(x) >= 100 ? 0 : Math.abs(x) >= 10 ? 1 : 2;
  return `${x.toFixed(digits)}${space ? " " : ""}${p}${unit}`;
}
/** Power: below 10 mW a schematic reading is numerical noise, not information. */
const watts = (w: number) => si(Math.abs(w) < 0.01 ? 0 : w, "W");
const celsius = (t: number) => `${t.toFixed(1)} °C`;
const lpm = (q: number) => `${(q * 60000).toFixed(Math.abs(q * 60000) >= 100 ? 0 : 1)} L/min`;
const rpm = (omega: number) => `${Math.abs(omega * 30 / Math.PI).toFixed(0)} RPM`;
const sentence = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
/** Converter states in the width beside a terminal strip; the full engine wording stays in the tooltip and Inspector. */
const compactMode = (mode: string) => sentence(mode.replace(/^grid charging · /, "charging · ").replace(/^grid import limit exceeded$/, "over import limit"));

// Line work: neutral ink for symbols, domain colour for conductors (wires continue into the module).
const INK = T.n14, FAINT = T.n11, SW = 1.75;
/** Horizontal leads from both module edges to a symbol spanning x0..x1 on the terminal axis. */
function Leads({ x0, x1, y = 66, w = 174, color = T.electrical, width = 2 }: { x0: number; x1: number; y?: number; w?: number; color?: string; width?: number }) {
  return <path d={`M0 ${y}H${x0}M${x1} ${y}H${w}`} stroke={color} strokeWidth={width} fill="none" />;
}
/** Function block or converter housing. */
const Box = ({ x, y, w, h, live }: { x: number; y: number; w: number; h: number; live?: boolean }) =>
  <rect x={x} y={y} width={w} height={h} rx="3" fill={T.n4} stroke={live ? T.n15 : INK} strokeWidth={SW} />;
const Glyph = ({ x, y, children, size = 13, mono, color = INK }: { x: number; y: number; children: ReactNode; size?: number; mono?: boolean; color?: string }) =>
  <text x={x} y={y} textAnchor="middle" className={mono ? "face-glyph mono" : "face-glyph"} fontSize={size} fill={color}>{children}</text>;
/** DC (=) and AC (~) marks for converter glyphs. */
const Dc = ({ x, y }: { x: number; y: number }) => <path d={`M${x - 8} ${y - 2}h16M${x - 8} ${y + 3}h4m4 0h4m4 0h0`} stroke={INK} strokeWidth="1.5" fill="none" />;
const Ac = ({ x, y }: { x: number; y: number }) => <path d={`M${x - 9} ${y}c3-6 6-6 9 0s6 6 9 0`} stroke={INK} strokeWidth="1.5" fill="none" />;
/** Converter housing with a diagonal and the input/output marks (IEC 60617 converter). */
function Converter({ x, y, w, h, from, to, live, flow = 0 }: { x: number; y: number; w: number; h: number; from: "dc" | "ac"; to: "dc" | "ac"; live?: boolean; flow?: number }) {
  const cx = x + w / 2, cy = y + h / 2;
  return <g>
    <Box x={x} y={y} w={w} h={h} live={live} />
    {flow !== 0 && <path d={`M${cx - 9} ${cy - 7}L${cx + 9} ${cy + 7}M${cx + 9} ${cy + 7}l-7.5 -0.6M${cx + 9} ${cy + 7}l-2.9 -7`} stroke={T.electricalText} strokeWidth="1.75" strokeLinecap="round" fill="none" transform={flow < 0 ? `rotate(180,${cx},${cy})` : undefined} />}
    <path d={`M${x + 4} ${y + h - 4}L${x + w - 4} ${y + 4}`} stroke={FAINT} strokeWidth="1.25" />
    {from === "dc" ? <Dc x={x + w * 0.3} y={y + h * 0.32} /> : <Ac x={x + w * 0.3} y={y + h * 0.32} />}
    {to === "dc" ? <Dc x={x + w * 0.7} y={y + h * 0.72} /> : <Ac x={x + w * 0.7} y={y + h * 0.72} />}
  </g>;
}
/** Normally open contact on the axis between x0 and x1, open or closed. */
const Contact = ({ x0, x1, y = 66, closed, color = INK }: { x0: number; x1: number; y?: number; closed: boolean; color?: string }) =>
  <g>
    <circle cx={x0} cy={y} r="2.5" fill={color} />
    <path d={closed ? `M${x0} ${y}L${x1} ${y}` : `M${x0} ${y}L${x1 - 4} ${y - 18}`} stroke={color} strokeWidth="2" strokeLinecap="round" />
    <path d={`M${x1} ${y}v-8`} stroke={color} strokeWidth="1.5" />
  </g>;
/** Rotating machine: circle with letter and supply mark. */
const Machine = ({ cx = 87, cy = 66, r = 24, letter, mark, angle }: { cx?: number; cy?: number; r?: number; letter: string; mark?: string; angle?: number }) =>
  <g>
    <circle cx={cx} cy={cy} r={r} fill={T.n4} stroke={INK} strokeWidth={SW} />
    {angle !== undefined && <path d={`M${cx} ${cy - r + 3}v5`} stroke={T.mechanicalText} strokeWidth="2" transform={`rotate(${angle},${cx},${cy})`} />}
    <Glyph x={cx} y={cy + (mark ? 1 : 5)} size={15}>{letter}</Glyph>
    {mark === "=" ? <Dc x={cx} y={cy + 10} /> : mark && <Glyph x={cx} y={cy + 14} size={12} mono>{mark}</Glyph>}
  </g>;
/** Centrifugal pump: circle with the discharge triangle pointing downstream and the impeller turning by its rotation. */
const PumpSymbol = ({ cx = 87, cy = 66, r = 22, angle = 0 }: { cx?: number; cy?: number; r?: number; angle?: number }) =>
  <g>
    <circle cx={cx} cy={cy} r={r} fill={T.n4} stroke={INK} strokeWidth={SW} />
    <path d={`M${cx - r * 0.55} ${cy - r * 0.83}L${cx + r} ${cy}L${cx - r * 0.55} ${cy + r * 0.83}`} stroke={INK} strokeWidth="1.25" fill="none" />
    <path d={`M${cx - 7} ${cy}h14M${cx} ${cy - 7}v14`} stroke={T.hydraulicText} strokeWidth="1.5" transform={`rotate(${angle},${cx},${cy})`} />
  </g>;
/** Two-way valve body (bow tie), filled when shut. */
const ValveBody = ({ cx = 87, cy = 66, opening = 100 }: { cx?: number; cy?: number; opening?: number }) =>
  <path d={`M${cx - 18} ${cy - 12}L${cx + 18} ${cy + 12}V${cy - 12}L${cx - 18} ${cy + 12}Z`} fill={opening < 0.5 ? INK : T.n4} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />;
/** ISA instrument bubble with its tag letters. */
const Bubble = ({ tag, cx = 87, cy = 66 }: { tag: string; cx?: number; cy?: number }) =>
  <g>
    <circle cx={cx} cy={cy} r="20" fill={T.n4} stroke={INK} strokeWidth={SW} />
    <Glyph x={cx} y={cy + 5} size={13} mono>{tag}</Glyph>
  </g>;
/** Horizontal fill gauge (state of charge, opening, level): track and value, no labels. */
const Gauge = ({ x, y, w, value, color }: { x: number; y: number; w: number; value: number; color: string }) =>
  <g>
    <rect x={x} y={y} width={w} height="4" rx="2" fill={T.n7} />
    <rect x={x} y={y} width={Math.max(0, Math.min(1, value)) * w} height="4" rx="2" fill={color} />
  </g>;

/** Shaft speed and angle of the motor driving a shaft-train element, if one is coupled. */
function shaftDriver(c: Component) {
  const s = simulation, wire = s.project.connections.find((w) => w.domain === "mechanical" && !s.disconnected.has(w.id) && (w.from.component === c.id || w.to.component === c.id));
  return wire ? s.multiphysics.motors[wire.from.component === c.id ? wire.to.component : wire.from.component] : undefined;
}
const opening = (c: Component) => {
  const s = simulation, r = s.multiphysics.hydraulic.readings[c.id];
  return s.faults[c.id] === "stuckClosed" ? 0 : s.faults[c.id] === "stuckOpen" ? 100 : c.kind === "checkValve" ? (Math.abs(r?.flow ?? 0) > 1e-12 ? 100 : 0) : s.multiphysics.positions[c.id] ?? prop(c, "opening", 100);
};
const targetName = (c: Component) => simulation.project.components.find((x) => x.id === c.props.target)?.name;
const signalText = (c: Component) => {
  const v = simulation.automation.signals[c.id];
  return !v ? undefined : !v.valid ? "Invalid" : typeof v.value === "boolean" ? (v.value ? "On" : "Off") : Number(v.value).toPrecision(4);
};

function face(c: Component): Face {
  const s = simulation, started = hasStarted(), r = s.electrical.readings[c.id], hr = s.multiphysics.hydraulic.readings[c.id];
  const failed = !!s.failed[c.id], power = started ? r?.power ?? 0 : 0;
  const pm = { labels: { a: "+", b: "−" } }, ln = { labels: { a: "L", b: "N" } };
  switch (c.kind) {
    case "source": {
      const off = c.props.enabled === false, cc = r?.regulation === "cc";
      return {
        symbol: <g><Leads x0={67} x1={107} /><circle cx="87" cy="66" r="20" fill={T.n4} stroke={INK} strokeWidth={SW} /><Dc x={87} y={65} /></g>,
        hero: `${prop(c, "voltage").toFixed(1)} V`,
        detail: off ? "Output off" : failed ? "Tripped" : started ? `${si(Math.abs(r?.current ?? 0), "A")} · ${watts(Math.abs(r?.power ?? 0))}${cc ? " · CC" : ""}` : c.props.mode === "cvcc" ? `CV/CC · ${prop(c, "maxCurrent")} A limit` : c.props.mode === "cc" ? "Constant current" : "DC output",
        tone: off || failed ? "fault" : undefined, pins: pm,
      };
    }
    case "sourceAC": case "source3": {
      const three = c.kind === "source3", off = c.props.enabled === false;
      return {
        symbol: <g><Leads x0={67} x1={107} /><circle cx="87" cy="66" r="20" fill={T.n4} stroke={INK} strokeWidth={SW} /><Ac x={87} y={three ? 61 : 66} />{three && <Glyph x={87} y={78} size={12} mono>3~</Glyph>}</g>,
        hero: `${prop(c, three ? "lineVoltage" : "voltage").toFixed(0)} V${three ? " 3~" : "~"} · ${prop(c, "frequency", 50)} Hz`,
        detail: off ? "Output off" : failed ? "Tripped" : started ? `${si(Math.abs(r?.current ?? 0), "A")} · ${watts(Math.abs(r?.power ?? 0))}` : three ? "Per-phase model" : "Voltage reference",
        tone: off || failed ? "fault" : undefined, pins: ln,
      };
    }
    case "ground":
      return { symbol: <g><path d="M0 66H87V80" stroke={T.electrical} strokeWidth="2" fill="none" /><path d="M69 80H105M75 88H99M81 96H93" stroke={INK} strokeWidth={SW} /></g> };
    case "junction":
      return { symbol: <g><path d="M0 66H87" stroke={T.electrical} strokeWidth="2" /><circle cx="87" cy="66" r="5" fill={T.electrical} /></g>, detail: "Explicit node" };
    case "resistor": case "fuse": case "cable": case "heater": {
      const heater = c.kind === "heater", hot = heater && started && power > 1 && !failed;
      const body = c.kind === "fuse"
        ? <g><rect x="61" y="58" width="52" height="16" rx="2" fill={T.n4} stroke={failed ? T.faultText : INK} strokeWidth={SW} /><path d={failed ? "M61 66H80M94 66H113" : "M61 66H113"} stroke={failed ? T.faultText : INK} strokeWidth="1.5" /></g>
        : c.kind === "cable"
          ? <g><path d="M48 60H126M48 72H126" stroke={INK} strokeWidth={SW} /><ellipse cx="48" cy="66" rx="3" ry="6" fill={T.n4} stroke={INK} strokeWidth="1.5" /><ellipse cx="126" cy="66" rx="3" ry="6" fill={T.n4} stroke={INK} strokeWidth="1.5" /></g>
          : <g><rect x="59" y="57" width="56" height="18" rx="2" fill={hot ? T.thermalDeep : T.n4} stroke={failed ? T.faultText : heater ? T.thermalText : INK} strokeWidth={SW} />{heater && <path d="M65 75l8-18M77 75l8-18M89 75l8-18M101 75l8-18" stroke={hot ? T.thermalText : FAINT} strokeWidth="1.25" />}</g>;
      const temp = s.temperatures[c.id] ?? prop(c, "initialTemperature", 20);
      return {
        symbol: <g><Leads x0={c.kind === "cable" ? 45 : 59} x1={c.kind === "cable" ? 129 : 115} />{body}</g>,
        hero: heater ? celsius(temp) : c.kind === "fuse" ? `${prop(c, "ratedCurrent")} A` : c.kind === "cable" ? `${c.props.material === "aluminium" ? "Al" : "Cu"} ${prop(c, "area")} mm² · ${prop(c, "length")} m` : si(prop(c, "resistance"), "Ω"),
        detail: failed ? (c.kind === "fuse" ? "Blown" : "Open / failed") : started ? (heater ? `${watts(power)} heating` : `${watts(power)} loss`) : heater ? `${watts(prop(c, "ratedPower"))} rated` : c.kind === "fuse" ? "Protective fuse" : c.kind === "cable" ? `${si(prop(c, "resistance"), "Ω")}` : `${watts(prop(c, "ratedPower"))} rated`,
        tone: failed ? "fault" : heater ? "thermal" : undefined,
      };
    }
    case "lamp": {
      const lit = power > 1 && !failed;
      return {
        symbol: <g>
          <Leads x0={67} x1={107} />
          {lit && <circle cx="87" cy="66" r="30" fill={T.electricalText} opacity={Math.min(0.28, power / 100)} filter="url(#lampGlow)" />}
          <circle cx="87" cy="66" r="18" fill={lit ? T.electricalDeep : T.n4} stroke={lit ? T.electricalText : INK} strokeWidth={SW} />
          <path d="M74.3 53.3L99.7 78.7M74.3 78.7L99.7 53.3" stroke={lit ? T.electricalText : INK} strokeWidth="1.5" />
        </g>,
        hero: lit ? watts(power) : undefined,
        detail: failed ? "Failed" : lit ? "Illuminated" : "Unpowered", tone: failed ? "fault" : undefined,
      };
    }
    case "switch":
      return { symbol: <g><Leads x0={50} x1={104} y={50} w={154} /><Contact x0={50} x1={104} y={50} closed={c.props.closed === true} /></g>, detail: c.props.closed ? "Closed" : "Open" };
    case "meter":
      return {
        symbol: <g><Leads x0={67} x1={107} width={1.5} /><circle cx="87" cy="66" r="20" fill={T.n4} stroke={INK} strokeWidth={SW} /><Glyph x={87} y={71} size={15}>V</Glyph></g>,
        hero: started ? `${(r?.voltage ?? 0).toFixed(2)} V${r?.ac ? "~" : ""}` : "— V", pins: pm,
      };
    case "capacitor":
      return {
        symbol: <g><Leads x0={81} x1={93} /><path d="M81 50V82M93 50V82" stroke={INK} strokeWidth="2.5" /></g>,
        hero: r?.ac && r.frequency ? `X ${si(1 / (2 * Math.PI * r.frequency * prop(c, "capacitance")), "Ω")}` : `${(s.devices.capacitors[c.id] ?? prop(c, "chargeVoltage")).toFixed(2)} V`,
        detail: si(prop(c, "capacitance"), "F"),
      };
    case "inductor":
      return {
        symbol: <g><Leads x0={57} x1={117} /><path d="M57 66a7.5 7.5 0 0 1 15 0a7.5 7.5 0 0 1 15 0a7.5 7.5 0 0 1 15 0a7.5 7.5 0 0 1 15 0" stroke={INK} strokeWidth={SW} fill="none" /></g>,
        hero: r?.ac && r.frequency ? `X ${si(2 * Math.PI * r.frequency * prop(c, "inductance"), "Ω")}` : si(s.devices.inductors[c.id] ?? 0, "A"),
        detail: si(prop(c, "inductance"), "H"),
      };
    case "battery": case "lfpBattery": {
      // Terminal power follows the load convention: positive is energy into the pack (charging).
      const soc = s.devices.batteries[c.id] ?? prop(c, "initialSOC") / 100, p = r?.power ?? 0;
      return {
        symbol: <g>
          <Leads x0={72} x1={102} />
          <path d="M72 50V82M84 58V74M90 50V82M102 58V74" stroke={INK} strokeWidth="2.5" />
          <Gauge x={57} y={90} w={60} value={soc} color={soc < 0.15 ? T.warning : T.ok} />
        </g>,
        hero: `${(soc * 100).toFixed(1)} %`,
        detail: failed ? "Disconnected" : started && Math.abs(p) > 0.05 ? `${p > 0 ? "Charging" : "Discharging"} ${watts(Math.abs(p))}` : c.kind === "lfpBattery" ? `${(prop(c, "fullVoltage") * 0.9412).toFixed(1)} V · ${prop(c, "capacityAh")} Ah` : `${prop(c, "capacityAh")} Ah`,
        tone: failed ? "fault" : undefined, pins: pm,
      };
    }
    case "solarPanel": {
      const out = r?.solar?.outputPower ?? 0;
      return {
        symbol: <g>
          <Leads x0={55} x1={119} />
          <rect x="55" y="48" width="64" height="38" rx="2" fill={T.n4} stroke={INK} strokeWidth={SW} />
          <path d="M71 48V86M87 48V86M103 48V86M55 67H119" stroke={FAINT} strokeWidth="1" />
          <path d="M65 40l5 5M87 36v7M109 40l-5 5" stroke={prop(c, "irradiance") > 0 ? T.electricalText : FAINT} strokeWidth="1.5" strokeLinecap="round" />
        </g>,
        hero: started ? watts(out) : `${prop(c, "irradiance").toFixed(0)} W/m²`,
        detail: started ? `${prop(c, "irradiance").toFixed(0)} W/m² · ${prop(c, "cellTemperature")} °C` : `${prop(c, "cellTemperature")} °C cell`, pins: pm,
      };
    }
    case "mpptController": case "inverter": {
      const sol = r?.solar, inverter = c.kind === "inverter";
      return {
        symbol: <Converter x={56} y={42} w={62} h={46} from="dc" to={inverter ? "ac" : "dc"} live={started && sol?.running} />,
        hero: started ? watts(sol?.outputPower ?? 0) : inverter ? watts(prop(c, "ratedPower")) : `${prop(c, "maxCurrent")} A`,
        detail: started ? sentence(sol?.mode ?? "off") : inverter ? `${prop(c, "voltage")} V~ out` : `${prop(c, "maxInputVoltage")} V PV`,
        pins: { labels: inverter ? { a: "DC+", b: "DC−", oa: "L", ob: "N" } : { a: "PV+", b: "PV−", oa: "BAT+", ob: "BAT−" }, strip: true },
      };
    }
    case "hybridInverter": case "gridInverter": {
      const x = r?.hybrid, hybrid = c.kind === "hybridInverter";
      return {
        // Arrow: energy from the battery to AC (inverting) or from AC into the battery (charging).
        symbol: <Converter x={60} y={40} w={54} h={46} from="dc" to="ac" live={started && !!x && x.mode !== "off"} flow={hybrid && started && Math.abs(x?.dcPower ?? 0) >= 1 ? Math.sign(x!.dcPower) : 0} />,
        hero: started ? watts(Math.abs(hybrid ? x?.dcPower ?? 0 : x?.acPower ?? 0)) : `${watts(prop(c, "ratedPower"))}`,
        detail: started ? compactMode(x?.mode ?? "off") : hybrid ? "Hybrid ESS" : "Grid following",
        title: started ? sentence(x?.mode ?? "off") : undefined,
        tone: x?.fault ? "fault" : undefined,
        pins: { labels: hybrid ? { a: "BAT+", b: "BAT−", ga: "IN L", gb: "IN N", oa: "OUT L", ob: "OUT N" } : { a: "DC+", b: "DC−", ga: "L", gb: "N" }, strip: true },
      };
    }
    case "gridMeter": {
      const p = r?.hybrid?.gridPower ?? 0;
      return {
        symbol: <g><Leads x0={62} x1={112} /><rect x="62" y="50" width="50" height="32" rx="3" fill={T.n4} stroke={INK} strokeWidth={SW} /><Glyph x={87} y={70} size={12} mono>kWh</Glyph><path d="M87 31V50" stroke={T.electrical} strokeWidth="1.5" /></g>,
        hero: started ? watts(Math.abs(p)) : "PCC meter",
        detail: started ? (Math.abs(p) < 0.5 ? "Balanced" : p > 0 ? "Importing" : "Exporting") : "Signed P / Q",
        pins: { labels: { a: "IN", b: "OUT", reference: "N" } },
      };
    }
    case "batteryProtection": {
      const on = !!r?.solar?.running;
      return {
        symbol: <g><Leads x0={60} x1={114} /><Contact x0={60} x1={114} closed={on} /><path d="M87 31V46" stroke={T.electrical} strokeWidth="1.5" strokeDasharray="3 3" /></g>,
        hero: started ? `${(r?.voltage ?? 0).toFixed(2)} V` : `${prop(c, "disconnectVoltage")} V cut-off`,
        detail: started ? sentence(r?.solar?.mode ?? "off") : `${prop(c, "ratedCurrent")} A`,
        pins: { labels: { a: "IN", b: "OUT", reference: "−", enable: "EN" } },
      };
    }
    case "contactor": {
      const closed = !failed && (s.faults[c.id] === "stuckClosed" || (s.faults[c.id] !== "stuckOpen" && !!s.devices.contactors[c.id]?.closed));
      return {
        symbol: <g>
          <Leads x0={62} x1={112} />
          <Contact x0={62} x1={112} closed={closed} />
          <path d="M87 62V72" stroke={FAINT} strokeDasharray="2 2" />
          <rect x="74" y="72" width="26" height="10" rx="1" fill={closed ? T.n7 : T.n4} stroke={INK} strokeWidth="1.5" />
        </g>,
        hero: closed ? "Closed" : "Open",
        detail: started ? `Coil ${(r?.coilVoltage ?? 0).toFixed(1)} V` : `${prop(c, "coilVoltage")} V DC coil`,
        pins: { labels: { ca: "A1", cb: "A2" } },
      };
    }
    case "transformer":
      return {
        symbol: <g>
          <path d="M0 39.6H62V48M0 92.4H62V84M174 39.6H112V48M174 92.4H112V84" stroke={T.electrical} strokeWidth="2" fill="none" />
          <path d="M62 48a6 6 0 0 1 0 12a6 6 0 0 1 0 12a6 6 0 0 1 0 12M112 48a6 6 0 0 0 0 12a6 6 0 0 0 0 12a6 6 0 0 0 0 12" stroke={INK} strokeWidth={SW} fill="none" />
          <path d="M82 46V86M92 46V86" stroke={INK} strokeWidth="1.5" />
          <circle cx="72" cy="47" r="2.5" fill={INK} /><circle cx="102" cy="47" r="2.5" fill={INK} />
        </g>,
        hero: `${prop(c, "ratedVoltage").toFixed(0)} / ${(prop(c, "ratedVoltage") / prop(c, "turnsRatio")).toPrecision(3)} V`,
        detail: started ? `${watts(Math.abs((r?.secondaryVoltage ?? 0) * (r?.secondaryCurrent ?? 0)))} out` : `${si(prop(c, "ratedPower"), "VA")} isolated`,
        pins: { labels: { a: "P1", b: "P2", sa: "S1", sb: "S2" } },
      };
    case "relay": case "safety": {
      const on = !!s.automation.contacts[c.id], trip = !!s.automation.memory[c.id]?.tripped;
      return {
        symbol: <g>
          <Leads x0={56} x1={118} />
          {c.kind === "relay"
            ? <g>
              <path d="M174 107H150V80H120" stroke={T.electrical} strokeWidth="2" fill="none" />
              <path d="M118 66v-8M120 80v8" stroke={INK} strokeWidth="1.5" />
              <circle cx="56" cy="66" r="2.5" fill={INK} />
              <path d={on ? "M56 66L118 66" : "M56 66L118 79"} stroke={trip ? T.faultText : INK} strokeWidth="2" strokeLinecap="round" />
            </g>
            : <g><Contact x0={56} x1={118} closed={on} color={trip ? T.faultText : INK} /><path d="M87 70V80M80 80h14" stroke={FAINT} strokeDasharray="2 3" /></g>}
        </g>,
        hero: trip ? "Tripped / latched" : on ? "Closed" : "Open",
        tone: trip ? "fault" : undefined,
        pins: { labels: c.kind === "relay" ? { a: "COM", b: "NO", nc: "NC", in: "IN", out: "OUT" } : { out: "OUT" } },
      };
    }
    case "breaker": case "motorProtector": {
      const tripped = !!s.breakers[c.id]?.tripped, open = tripped || c.props.closed === false;
      return {
        symbol: <g>
          <Leads x0={58} x1={116} />
          <Contact x0={58} x1={116} closed={!open} color={tripped ? T.faultText : INK} />
          <path d="M112 62l8 8M120 62l-8 8" stroke={INK} strokeWidth="1.5" />
          {c.kind === "motorProtector" && <path d="M79 78h6v6h6v-6h6" stroke={FAINT} strokeWidth="1.5" fill="none" />}
        </g>,
        hero: `${prop(c, "ratedCurrent")} A`,
        detail: tripped ? "Tripped" : open ? "Open" : "Closed",
        tone: tripped ? "fault" : undefined, pins: { labels: { out: "OUT" } },
      };
    }
    case "starDeltaStarter": case "softStarter": {
      const st = s.multiphysics.starters[c.id], mode = st?.mode ?? "off", live = mode !== "off" && mode !== "open";
      return {
        symbol: <g>
          <Leads x0={60} x1={114} />
          <Box x={60} y={48} w={54} h={36} live={live} />
          {c.kind === "starDeltaStarter"
            ? <g stroke={INK} strokeWidth="1.5" fill="none"><path d="M75 58v8l-6 6M75 66l6 6" stroke={mode === "star" ? T.electricalText : FAINT} /><path d="M99 57l-7 13h14z" stroke={mode === "delta" ? T.electricalText : FAINT} /></g>
            : <g stroke={INK} strokeWidth="1.5" fill="none"><path d="M70 76L90 56h14" stroke={mode === "ramp" ? T.electricalText : FAINT} /><path d="M70 78h34" stroke={mode === "bypass" ? T.electricalText : FAINT} /></g>}
        </g>,
        hero: c.kind === "softStarter" && mode === "ramp" ? `${st?.stopping ? "Stop" : "Ramp"} ${((st?.ratio ?? 1) * 100).toFixed(0)} %` : sentence(mode),
        detail: started ? `${Math.abs(r?.current ?? 0).toFixed(1)} A line` : `${prop(c, "ratedCurrent")} A`,
        pins: { labels: { a: "L", b: "M", start: "START" } },
      };
    }
    case "vfd": {
      const d = r?.drive;
      return {
        symbol: <Converter x={58} y={38} w={58} h={44} from="ac" to="ac" live={!!d?.running} />,
        hero: d?.running ? `${d.frequency.toFixed(1)} Hz` : "Stopped",
        detail: d?.running ? `${watts(d.outputPower)} out` : d?.energized ? "DC link charged" : `${watts(prop(c, "ratedPower"))}`,
        pins: { labels: { a: "L", b: "N", oa: "U", ob: "N", run: "RUN", frequency: "f*" }, strip: true },
      };
    }
    case "motor": case "inductionMotor": {
      const m = s.multiphysics.motors[c.id], three = c.kind === "inductionMotor";
      return {
        symbol: <g><Leads x0={63} x1={111} y={66} /><path d="M87 31V44" stroke={T.mechanical} strokeWidth="3" /><Machine r={three ? 22 : 20} letter="M" mark={three ? "3~" : "="} angle={((m?.angle ?? 0) * 180 / Math.PI) % 360} /></g>,
        hero: started ? rpm(m?.omega ?? 0) : three ? `${watts(prop(c, "ratedPower"))}` : `${prop(c, "ratedVoltage")} V · ${prop(c, "ratedCurrent")} A`,
        detail: started ? `${Math.abs(m?.current ?? 0).toFixed(1)} A · ${watts(m?.shaftPower ?? 0)} shaft` : three ? "Induction machine" : "Brushed DC",
        pins: { labels: three ? { a: "L", b: "N", enable: "EN" } : { a: "+", b: "−", enable: "EN", speed: "SPD" } },
      };
    }
    case "pump": {
      const m = shaftDriver(c);
      return {
        symbol: <g><Leads x0={65} x1={109} color={T.hydraulic} width={3} /><path d="M87 31V44" stroke={T.mechanical} strokeWidth="3" /><PumpSymbol angle={((m?.angle ?? 0) * 180 / Math.PI) % 360} /></g>,
        hero: started ? lpm(hr?.flow ?? 0) : `${prop(c, "shutoffHead")} m shutoff`,
        detail: m ? rpm(m.omega) : "Not driven · free shaft",
      };
    }
    case "circulator": {
      const st = s.multiphysics.circulators[c.id], view = s.multiphysics.circulatorView[c.id];
      const mode = { proportionalPressure: `PP ${prop(c, "headSetpoint")} m`, constantPressure: `CP ${prop(c, "headSetpoint")} m`, constantSpeed: `${prop(c, "speedSetting")} % speed` }[String(c.props.mode)] ?? "";
      return {
        symbol: <g>
          <Leads x0={69} x1={105} color={T.hydraulic} width={3} />
          <path d="M52.2 31V40H74M121.8 31V40H100" stroke={T.electrical} strokeWidth="1.5" fill="none" />
          <rect x="74" y="35" width="26" height="10" rx="2" fill={T.n4} stroke={INK} strokeWidth="1.25" />
          <PumpSymbol r={18} angle={((st?.angle ?? 0) * 180 / Math.PI) % 360} />
        </g>,
        hero: started ? lpm(hr?.flow ?? 0) : mode,
        detail: started ? (st?.lockedOut ? "Undervoltage · off" : `${rpm(st?.omega ?? 0)} · ${watts(view?.inputPower ?? 0)}`) : `${prop(c, "ratedVoltage")} V · ${prop(c, "ratedPower")} W`,
        tone: st?.lockedOut ? "warning" : undefined,
        pins: { labels: { enable: "EN", speed: "SPD" } },
      };
    }
    case "flywheel": case "dynamometer": {
      const m = shaftDriver(c), ratio = c.kind === "flywheel" ? prop(c, "gearRatio", 1) : 1, angle = ((m?.angle ?? 0) / ratio * 180 / Math.PI) % 360, el = s.multiphysics.shaftElements[c.id];
      const shaft = <path d="M87 31V44" stroke={T.mechanical} strokeWidth="3" />;
      return c.kind === "flywheel"
        ? {
          symbol: <g>{shaft}<circle cx="87" cy="66" r="24" fill={T.n4} stroke={INK} strokeWidth={SW} /><circle cx="87" cy="66" r="15" fill="none" stroke={FAINT} /><circle cx="87" cy="66" r="3.5" fill={INK} /><path d="M87 44V51" stroke={T.mechanicalText} strokeWidth="2.5" transform={`rotate(${angle},87,66)`} /></g>,
          hero: m ? rpm(m.omega / ratio) : "Not coupled",
          detail: started ? `${si(el?.kinetic ?? 0, "J")} stored` : `${prop(c, "inertia")} kg·m²${ratio !== 1 ? ` · ${ratio}:1` : ""}`,
        }
        : {
          symbol: <g>{shaft}<rect x="65" y="44" width="44" height="44" rx="4" fill={T.n4} stroke={INK} strokeWidth={SW} /><path d="M73 78a16 16 0 0 1 28 0" stroke={FAINT} fill="none" /><path d="M87 78V60" stroke={T.mechanicalText} strokeWidth="2" transform={`rotate(${Math.max(-60, Math.min(60, (el?.torque ?? 0) / prop(c, "ratedTorque") * 120 - 60))},87,78)`} /><circle cx="87" cy="78" r="2.5" fill={INK} /></g>,
          hero: started ? `${(el?.torque ?? 0).toFixed(1)} N·m` : `${prop(c, "ratedTorque")} N·m`,
          detail: started ? `${watts(el?.power ?? 0)} absorbed` : sentence(textProp(c, "absorber").replace(/([A-Z])/g, " $1").toLowerCase()),
          pins: { labels: { torque: "T*" } },
        };
    }
    case "rigidBody": case "forceActuator":
      return c.kind === "rigidBody"
        ? { symbol: <g><path d="M87 31V46" stroke={T.mechanical} strokeWidth="3" /><rect x="65" y="46" width="44" height="36" rx="3" fill={T.n4} stroke={INK} strokeWidth={SW} /><path d="M65 82l44-36" stroke={FAINT} /></g>, hero: started ? `y ${(s.spatial.readings[c.id]?.y ?? 0).toFixed(3)} m` : undefined, detail: "Physical view body" }
        : { symbol: <g><path d="M60 66H106" stroke={INK} strokeWidth="2.5" /><path d="M104 56l14 10-14 10z" fill={INK} /></g>, hero: `${prop(c, "value")} ${c.props.axis === "torque" ? "N·m" : "N"}`, detail: targetName(c) ? `on ${targetName(c)}` : "No target", pins: { labels: { in: "IN" } } };
    case "pipe":
      return {
        symbol: <g><path d="M0 66H174" stroke={T.hydraulic} strokeWidth="9" /><path d="M0 66H174" stroke={T.hydraulicDeep} strokeWidth="5" /><path d="M44 58v16M130 58v16" stroke={INK} strokeWidth="1.5" /></g>,
        hero: started ? lpm(hr?.flow ?? 0) : `${prop(c, "length")} m · Ø${(prop(c, "diameter") * 1000).toFixed(0)} mm`,
        detail: started ? `Δp ${si(Math.abs(hr?.differentialPressure ?? 0), "Pa")}` : prop(c, "insulation") > 0 ? "Insulated" : sentence(textProp(c, "material", "steel")),
      };
    case "valve": case "checkValve": case "actuatedValve": case "thermostaticValve": case "pressureReducingValve": {
      const o = opening(c);
      const extra = c.kind === "checkValve" ? <circle cx="87" cy="66" r="4" fill={INK} />
        : c.kind === "thermostaticValve" ? <g><path d="M87 54V49" stroke={INK} strokeWidth="1.5" /><circle cx="87" cy="39" r="10" fill={T.n4} stroke={INK} strokeWidth="1.25" /><Glyph x={87} y={43} size={11} mono>{prop(c, 'dial') === 0 ? '❄' : prop(c, 'dial')}</Glyph></g>
        : c.kind === "actuatedValve" ? <g><path d="M87 54V48" stroke={INK} strokeWidth="1.5" /><rect x="77" y="36" width="20" height="12" rx="2" fill={T.n4} stroke={INK} strokeWidth="1.25" /><Glyph x={87} y={46} size={12} mono>M</Glyph></g>
        : c.kind === "pressureReducingValve" ? <path d="M87 54V42M80 42h14M81 38l12-4M81 34l12-4" stroke={INK} strokeWidth="1.25" fill="none" />
        : <path d="M87 54V44M79 44h16" stroke={INK} strokeWidth="1.5" />;
      return {
        symbol: <g><Leads x0={69} x1={105} color={T.hydraulic} width={3} /><ValveBody opening={o} />{extra}</g>,
        hero: c.kind === "checkValve" ? (o > 0 ? "Open" : "Closed") : `${o.toFixed(0)} % ${c.kind === 'thermostaticValve' ? 'Kv' : 'open'}`,
        detail: c.kind === "thermostaticValve" ? `${prop(c, 'dial') === 0 ? '❄' : prop(c, 'dial')} · ≈${trvTemperatureLabel(trvSetpoint(c))} °C` : started ? lpm(hr?.flow ?? 0) : c.kind === "pressureReducingValve" ? `${(prop(c, "pressureSetpoint") / 1e5).toFixed(2)} bar set` : sentence(textProp(c, "characteristic", "linear").replace(/([A-Z])/g, " $1").toLowerCase()),
        title: c.kind === "thermostaticValve" ? `Effective Kv/Kvs ${(o / 100).toFixed(3)} · sensed ${(s.multiphysics.trvSensors[c.id] ?? effectiveAmbient(s.project, c)).toFixed(1)} °C · closes at ${trvTemperatureLabel(trvSetpoint(c) + 2)} °C` : undefined,
        pins: { labels: { position: "POS" } },
      };
    }
    case "fluidJunction":
      return { symbol: <g><path d="M87 66V132" stroke={T.hydraulic} strokeWidth="3" /><circle cx="87" cy="66" r="7" fill={T.hydraulic} /></g>, hero: started ? `${((hr?.pressure ?? 0) / 1e5).toFixed(3)} bar` : undefined };
    case "heatExchanger": {
      const hot = s.multiphysics.hydraulic.readings[`${c.id}#hot`];
      return {
        symbol: <g>
          <path d="M0 39.6H60M114 39.6H174" stroke={T.thermal} strokeWidth="3" />
          <path d="M0 99H60M114 99H174" stroke={T.hydraulic} strokeWidth="3" />
          <rect x="60" y="34" width="54" height="71" rx="3" fill={T.n4} stroke={INK} strokeWidth={SW} />
          <path d="M60 39.6H70V58H104V39.6H114" stroke={T.thermalText} strokeWidth="1.5" fill="none" />
          <path d="M114 99H104V80H70V99H60" stroke={T.hydraulicText} strokeWidth="1.5" fill="none" />
          <path d="M66 69H108" stroke={FAINT} strokeDasharray="3 3" />
        </g>,
        hero: started ? watts(Math.abs(hot?.duty ?? 0)) : `UA ${si(prop(c, "ua"), "W/K")}`,
        pins: { labels: { hotIn: "A in", hotOut: "A out", coldIn: "B in", coldOut: "B out" } },
        readoutY: 124,
      };
    }
    case "radiator": {
      const fan = started ? r?.fanPower ?? 0 : 0;
      return {
        symbol: <g>
          <Leads x0={50} x1={124} color={T.hydraulic} width={3} />
          <rect x="50" y="46" width="74" height="40" rx="2" fill={T.n4} stroke={INK} strokeWidth={SW} />
          <path d="M58 46v40M66 46v40M74 46v40M82 46v40M92 46v40M100 46v40M108 46v40M116 46v40" stroke={T.n8} />
          <circle cx="87" cy="66" r="13" fill={T.n4} stroke={INK} strokeWidth="1.5" />
          <path d="M80 59l14 14M94 59l-14 14" stroke={fan > 0.5 ? T.electricalText : FAINT} strokeWidth="1.5" transform={`rotate(${fan > 0.5 ? (simulation.time * 720) % 360 : 0},87,66)`} />
        </g>,
        hero: started ? `${watts(Math.abs(hr?.duty ?? 0))} rejected` : `${prop(c, "naturalUA") + prop(c, "forcedUA")} W/K`,
        pins: { labels: { a: "+", b: "−" } },
      };
    }
    case "panelRadiator": {
      const cells = (s.multiphysics.pipeCells[c.id] ?? []).map((t) => t - 273.15), air = effectiveAmbient(s.project, c);
      const mean = cells.length ? cells.reduce((a, t) => a + t, 0) / cells.length : prop(c, "initialTemperature"), flowing = started && Math.abs(hr?.flow ?? 0) >= 1e-12;
      const width = 92 / Math.max(1, cells.length);
      return {
        symbol: <g>
          <path d="M0 66H22V50H41M133 82H152V66H174" fill="none" stroke={T.hydraulic} strokeWidth="3" />
          <rect x="41" y="42" width="92" height="48" rx="2" fill={T.n4} />
          {cells.map((t, i) => <rect key={i} x={41 + i * width} y="42" width={width} height="48" fill={T.thermal} fillOpacity={Math.max(0.04, Math.min(0.8, (t - air) / 60))} />)}
          {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => <path key={i} d={`M${49 + i * 7.6} 46V86`} stroke={T.n9} strokeWidth="0.75" />)}
          <rect x="41" y="42" width="92" height="48" rx="2" fill="none" stroke={INK} strokeWidth={SW} />
        </g>,
        hero: flowing && hr?.supplyTemperature !== undefined && hr.returnTemperature !== undefined ? `${(hr.supplyTemperature - 273.15).toFixed(1)} → ${(hr.returnTemperature - 273.15).toFixed(1)} °C` : celsius(mean),
        detail: started ? `${watts(hr?.duty ?? 0)} to room` : `Φ₅₀ ${prop(c, "ratedOutput").toFixed(0)} W`,
        tone: "thermal",
      };
    }
    case "storageTank": {
      const n = storageLayers(c), cells = (s.multiphysics.pipeCells[c.id] ?? Array(n).fill(prop(c, "initialTemperature") + 273.15)).map((t) => t - 273.15);
      const lo = Math.min(20, ...cells), column = STORAGE_BASE - STORAGE_TOP, band = column / n, coil = coilLayers(c), y0 = STORAGE_TOP - 4, y1 = STORAGE_BASE + 4;
      const port = (id: string, left: boolean) => { const y = storageY(prop(c, `${id}Height`)); return <path key={id} d={left ? `M0 ${y}H58` : `M116 ${y}H174`} stroke={T.hydraulic} strokeWidth="3" />; };
      const top = cells[n - 1] ?? 20, bottom = cells[layerAt(c, prop(c, "sensorBottomHeight"))] ?? 20;
      return {
        symbol: <g>
          {port("p1", true)}{port("p2", true)}{port("p3", false)}{port("p4", false)}
          <clipPath id={`st-${c.id}`}><rect x="58" y={y0} width="58" height={y1 - y0} rx="10" /></clipPath>
          <rect x="58" y={y0} width="58" height={y1 - y0} rx="10" fill={T.n4} />
          <g clipPath={`url(#st-${c.id})`}>{cells.map((t, k) => <rect key={k} x="58" y={STORAGE_BASE - (k + 1) * band - (k === n - 1 ? 4 : 0)} width="58" height={band + 0.3 + (k === n - 1 || k === 0 ? 4 : 0)} fill={T.thermal} fillOpacity={Math.max(0.04, Math.min(0.85, (t - lo) / 55))} />)}</g>
          {coil.length > 0 && <path d={`M68 ${STORAGE_BASE - (coil[0] + 1) * band + 2}${coil.map((k, i) => ` L${i % 2 ? 68 : 106} ${STORAGE_BASE - k * band - 1}`).join("")}`} fill="none" stroke={T.hydraulicText} strokeWidth="1.5" />}
          <rect x="58" y={y0} width="58" height={y1 - y0} rx="10" fill="none" stroke={INK} strokeWidth={SW} />
        </g>,
        hero: `${top.toFixed(1)} / ${bottom.toFixed(1)} °C`,
        detail: started ? (coil.length ? `Coil ${watts(hr?.duty ?? 0)}` : lpm(hr?.flow ?? 0)) : `${prop(c, "storageVolume").toFixed(0)} L · ${n} layers`,
        title: "Top layer / lower sensor temperature",
        tone: "thermal",
        pins: { labels: { p1: "1", p2: "2", p3: "3", p4: "4", coilIn: "C in", coilOut: "C out" } },
      };
    }
    case "expansionVessel": {
      const v = s.multiphysics.vessels[c.id], share = v ? Math.max(0, Math.min(1, v.water / (prop(c, "nominalVolume") / 1000))) : 0;
      // Horizontal capsule: water enters from the left, the membrane moves right as the nitrogen (right) is compressed.
      const membrane = 56 + 70 * share;
      return {
        symbol: <g>
          <clipPath id={`ev-${c.id}`}><rect x="54" y="42" width="74" height="44" rx="22" /></clipPath>
          <rect x="54" y="42" width="74" height="44" rx="22" fill={T.n4} />
          <rect x="54" y="42" width={membrane - 54} height="44" fill={T.hydraulicDeep} clipPath={`url(#ev-${c.id})`} opacity={share > 0 ? 1 : 0} />
          <path d={`M${membrane} 43V85`} stroke={T.hydraulicText} strokeWidth="1.5" />
          <path d="M0 64H54" stroke={T.hydraulic} strokeWidth="3" />
          <path d="M128 64H138M138 59v10" stroke={INK} strokeWidth="1.5" />
          <rect x="54" y="42" width="74" height="44" rx="22" fill="none" stroke={s.faults[c.id] === "gasLoss" ? T.faultText : INK} strokeWidth={SW} />
        </g>,
        hero: `${((v?.pressure ?? prop(c, "fillPressure")) / 1e5).toFixed(2)} bar`,
        detail: started && v ? `${(Math.max(0, v.water) * 1000).toFixed(2)} L water` : `${prop(c, "nominalVolume")} L · ${(prop(c, "precharge") / 1e5).toFixed(2)} bar gas`,
        title: "Gauge pressure at the vessel; water held on the water side",
      };
    }
    case "divertingValve": {
      const x = (s.multiphysics.positions[c.id] ?? prop(c, "position")) / 100, open = (share: number) => share > 0.02 ? T.hydraulic : FAINT;
      return {
        // Two triangles toward A (right) and B (down) from the common port; each path is drawn by its opening.
        symbol: <g>
          <path d="M0 66H70" stroke={T.hydraulic} strokeWidth="3" />
          <path d="M104 66H174" stroke={open(1 - x)} strokeWidth="3" />
          <path d="M122 66V83" stroke={open(x)} strokeWidth="3" />
          <path d="M70 54L87 66L70 78Z" fill={T.n4} stroke={INK} strokeWidth="1.25" />
          <path d="M104 54L87 66L104 78Z" fill={1 - x > 0.02 ? T.hydraulicDeep : T.n4} stroke={INK} strokeWidth="1.25" />
          <path d="M75 83L87 66L99 83Z" fill={x > 0.02 ? T.hydraulicDeep : T.n4} stroke={INK} strokeWidth="1.25" />
          <path d="M99 83H122" stroke={open(x)} strokeWidth="3" />
          <path d="M87 66V48M78 36h18v12H78Z" stroke={INK} strokeWidth="1.25" fill={T.n4} />
          <Glyph x={87} y={46} size={12} mono>M</Glyph>
        </g>,
        hero: x <= 0.005 ? "A · heating" : x >= 0.995 ? "B · hot water" : `${(x * 100).toFixed(0)} % to B`,
        detail: started ? lpm(hr?.flow ?? 0) : `Kvs ${prop(c, "kvs")} · ${prop(c, "responseTime")} s`,
        pins: { labels: { inlet: "AB", outletA: "A", outletB: "B", position: "POS" } },
      };
    }
    case "safetyValve": {
      const lift = started ? s.multiphysics.positions[c.id] ?? 0 : 0;
      return {
        symbol: <g>
          <Leads x0={69} x1={105} color={T.hydraulic} width={3} />
          <ValveBody opening={lift} />
          <path d="M87 54V49M81 49h12M83 47l8-3M83 43l8-3M83 39l8-3" stroke={INK} strokeWidth="1.25" fill="none" />
          <path d="M105 66H174" stroke={lift > 0 ? T.hydraulic : FAINT} strokeWidth="3" strokeDasharray={lift > 0 ? undefined : "4 4"} />
        </g>,
        hero: lift > 0 ? `Open ${lift.toFixed(0)} %` : `${(prop(c, "setPressure") / 1e5).toFixed(1)} bar set`,
        detail: started ? `${((s.multiphysics.discharged[c.id] ?? 0) * 1000).toFixed(2)} L discharged` : "Closed",
        tone: lift > 0 ? "warning" : undefined,
      };
    }
    case "heatPump": {
      const st = s.multiphysics.heatPumps[c.id], view = s.multiphysics.heatPumpView[c.id], water = s.fluidTemperatureMeasurement(c.id) ?? prop(c, "initialTemperature");
      const running = started && (st?.mode === "heating" || st?.mode === "defrost"), defrost = started && st?.mode === "defrost";
      const frost = started ? Math.min(1, (st?.frost ?? 0) / Math.max(1e-6, prop(c, "frostTrigger"))) : 0;
      return {
        symbol: <g>
          <path d="M0 66H44M130 66H174" fill="none" stroke={T.hydraulic} strokeWidth="3" />
          <rect x="44" y="42" width="86" height="44" rx="4" fill={T.n4} stroke={st?.fault || st?.backupFault ? T.faultText : INK} strokeWidth={SW} />
          <circle cx="68" cy="64" r="15" fill="none" stroke={defrost ? T.hydraulic : INK} strokeWidth="1.5" />
          {[0, 120, 240].map((a) => <path key={a} d="M68 64l0 -12" stroke={running ? T.thermalText : FAINT} strokeWidth="2" transform={`rotate(${a + (running ? (st?.speed ?? 0) * 40 : 0)} 68 64)`} />)}
          {/* Frost on the coil: the hatched bar fills toward the defrost trigger. */}
          <rect x="94" y="48" width="28" height="32" rx="2" fill="none" stroke={FAINT} strokeWidth="1" />
          <rect x="94" y={80 - 32 * frost} width="28" height={32 * frost} fill={T.hydraulic} opacity="0.35" />
          {[0, 1, 2].map((i) => <path key={i} d={`M98 ${56 + i * 8}h20`} stroke={FAINT} strokeWidth="0.75" />)}
        </g>,
        hero: celsius(water),
        detail: st?.fault ? "Locked out" : !started ? `Target ${prop(c, "setpoint")} °C` : st?.dhw && st.mode === "heating" ? `Hot water · ${watts(view?.heatOutput ?? 0)} · COP ${view?.cop?.toFixed(2) ?? "—"}` : defrost ? `Defrost · ${watts(-(view?.heatOutput ?? 0))} from water` : st?.mode === "heating" ? `${watts(view?.heatOutput ?? 0)} · COP ${view?.cop?.toFixed(2) ?? "—"}${st.backupStages ? ` · +${st.backupStages * 3} kW` : ""}` : st?.backupStages ? `Backup ${st.backupStages * 3} kW` : st?.mode === "drip" ? "Drip time" : "Standby",
        title: started ? st?.status : undefined,
        tone: st?.fault || st?.backupFault ? "fault" : "thermal",
        pins: { labels: { L: "L", N: "N", BL: "BL", BN: "BN", enable: "EN", setpoint: "SET", reset: "RST", defrost: "DEF", dhwSensor: "TW1", dhw: "VW1" } },
      };
    }
    case "electricBoiler": {
      const st = s.multiphysics.boilers[c.id], water = s.fluidTemperatureMeasurement(c.id) ?? prop(c, "initialTemperature");
      const stages = started ? st?.stages ?? 0 : 0;
      return {
        symbol: <g>
          <path d="M0 66H50M124 66H174" fill="none" stroke={T.hydraulic} strokeWidth="3" />
          <rect x="50" y="42" width="74" height="44" rx="6" fill={T.n4} stroke={st?.fault ? T.faultText : INK} strokeWidth={SW} />
          {[0, 1, 2].map((i) => <path key={i} d={`M${69 + 18 * i} 46v6l-4 4 8 6-8 6 4 4v6`} fill="none" stroke={i < stages ? T.thermalText : FAINT} strokeWidth="1.75" />)}
        </g>,
        hero: celsius(water),
        detail: st?.fault ? "Tripped" : started ? `${stages}/3 stages · ${watts(power)}` : `Target ${prop(c, "setpoint")} °C`,
        tone: st?.fault ? "fault" : "thermal",
        pins: { labels: { L1: "L1", L2: "L2", L3: "L3", N: "N", PE: "PE", enable: "EN", setpoint: "SET", reset: "RST" } },
      };
    }
    case "tank": {
      const temp = s.temperatures[c.id] ?? 20, volume = (s.multiphysics.tanks[c.id]?.volume ?? prop(c, "volume") / 1000) * 1000;
      const fill = Math.min(1, volume / prop(c, "capacity")), top = 155 - 104 * fill;
      return {
        symbol: <g>
          <rect x="26" y="42" width="150" height="114" rx="6" fill={T.n4} stroke={INK} strokeWidth={SW} />
          <path d={`M27 ${top}H175V150Q175 155 170 155H32Q27 155 27 150Z`} fill={T.hydraulicDeep} />
          <path d={`M27 ${top}H175`} stroke={T.hydraulic} strokeWidth="1.5" />
          <path d="M101 31V42" stroke={T.thermal} strokeWidth="2" />
          <path d="M91 44v22q0 6 6 6h8q6 0 6-6V44" stroke={T.thermalText} strokeWidth="2" fill="none" />
          <path d="M202 28H188V50H176" stroke={T.hydraulic} strokeWidth="3" fill="none" />
          <path d="M101 156V170" stroke={T.hydraulic} strokeWidth="3" />
          {[0, 1, 2, 3, 4].map((i) => <path key={i} d={`M168 ${52 + i * 25}h7`} stroke={FAINT} />)}
          <text x="101" y="116" className="tank-number" textAnchor="middle">{temp.toFixed(2)}<tspan className="unit"> °C</tspan></text>
          <text x="101" y="138" className="face-state" textAnchor="middle">{`${volume.toFixed(volume >= 100 ? 0 : 1)} / ${prop(c, "capacity")} L`}</text>
        </g>,
      };
    }
    case "thermalMass":
      return {
        symbol: <g><rect x="52" y="44" width="70" height="44" rx="3" fill={T.n4} stroke={INK} strokeWidth={SW} /><path d="M52 56l12-12M52 70l26-26M52 84l40-40M64 88l44-44M78 88l44-44M92 88l30-30M106 88l16-16" stroke={T.n8} /></g>,
        hero: celsius(s.temperatures[c.id] ?? prop(c, "initialTemperature")), detail: `${si(prop(c, "heatCapacity"), "J/K")} · ${prop(c, "loss")} W/K`, tone: "thermal",
      };
    case "cooler":
      return {
        symbol: <g><path d="M52 50h70M52 62h70M52 74h70" stroke={T.hydraulicText} strokeWidth="1.5" /><rect x="48" y="44" width="78" height="36" rx="3" fill="none" stroke={INK} strokeWidth={SW} /></g>,
        hero: s.faults[c.id] === "coolingFailed" ? "Coolant lost" : `${prop(c, "conductance")} W/K`, tone: s.faults[c.id] === "coolingFailed" ? "fault" : undefined,
        pins: { labels: { in: "IN" } },
      };
  }
  // Instrumentation and control blocks: ISA bubbles for sensors, IEC 61131 function blocks for logic.
  const sensorTag: Record<string, string> = { sensor: "TT", pressureSensor: "PT", flowSensor: "FT", levelSensor: "LT", positionSensor: "ZT", speedSensor: "ST" };
  const sensor = s.automation.sensors[c.id], unit = definitions[c.kind].ports.find((p) => p.id === "out")?.unit ?? "";
  if (sensorTag[c.kind])
    return {
      symbol: <g><Bubble tag={sensorTag[c.kind]} /><path d="M107 66H174" stroke={T.n13} strokeWidth="1.5" strokeDasharray="2 3" /></g>,
      hero: sensor?.valid ? `${Number(sensor.value).toPrecision(4)} ${unit}` : started ? "Invalid" : "—",
      detail: targetName(c) ? `→ ${targetName(c)}` : "No target", tone: started && !sensor?.valid ? "warning" : undefined,
    };
  const fn: Record<string, string> = { pid: "PID", scale: "k·x+b", limiter: "LIM", filter: "PT1", rateLimiter: "RAMP", selector: "SEL", comparator: ({ lt: "<", le: "≤", gt: ">", ge: "≥" } as Record<string, string>)[textProp(c, "mode", "lt")] ?? "CMP", hysteresis: "HYS", thermostat: "θ", timer: ({ onDelay: "TON", offDelay: "TOF", pulse: "TP" } as Record<string, string>)[textProp(c, "mode", "onDelay")] ?? "T", and: "&", or: "≥1", not: "1", constant: "K", latch: "SR", reset: "R" };
  const labels: Record<string, Record<string, string>> = { comparator: { in: "IN", ref: "REF" }, selector: { in: "A", in2: "B", select: "SEL" }, and: { in: "1", in2: "2" }, or: { in: "1", in2: "2" }, latch: { set: "S", reset: "R" } };
  const out = signalText(c);
  return {
    symbol: <g>
      <Box x={58} y={40} w={58} h={52} />
      <Glyph x={87} y={71} size={fn[c.kind]?.length > 3 ? 12 : 14} mono>{fn[c.kind] ?? "f"}</Glyph>
      {c.kind === "not" && <circle cx="120" cy="66" r="4" fill={T.n3} stroke={INK} strokeWidth="1.5" />}
      {definitions[c.kind].ports.filter((p) => p.domain === "control").map((p) => { const q = portLocal(c, p.id); return q.y > 92 ? null : <path key={p.id} d={q.x < 0 ? `M0 ${q.y}H58` : `M${c.kind === "not" ? 124 : 116} ${q.y}H174`} stroke={T.n13} strokeWidth="1.5" />; })}
    </g>,
    hero: out ?? "—",
    detail: c.kind === "thermostat" ? `${prop(c, "setpoint")} °C · ${prop(c, "hysteresis")} K band`
      : c.kind === "hysteresis" ? `${prop(c, "low")} / ${prop(c, "high")}`
      : c.kind === "timer" ? `${s.automation.memory[c.id]?.elapsed?.toFixed(2) ?? "0.00"} s` : definitions[c.kind].spec,
    tone: out === "Invalid" ? "warning" : undefined,
    pins: { labels: labels[c.kind] ?? {}, strip: c.kind === "selector" },
  };
}

/** Readout fonts (styles.css: .face-value, .face-state, .pin-label) with per-character fallbacks for unloaded fonts. */
const FONTS = { value: ['500 13px "IBM Plex Mono"', 8], state: ['400 12px "IBM Plex Sans"', 6.6], pin: ['500 12px "IBM Plex Mono"', 7.2] } as const;
const widths = new Map<string, number>();
let context: CanvasRenderingContext2D | null | undefined;
/** Rendered width of `text` in px: measured once the web fonts have loaded (and cached), estimated before. */
function textWidth(text: string, font: keyof typeof FONTS) {
  const [css, char] = FONTS[font], key = `${font}|${text}`, cached = widths.get(key);
  if (cached !== undefined) return cached;
  if (context === undefined) try { context = document.createElement("canvas").getContext("2d"); } catch { context = null; }
  if (!context || typeof document === "undefined" || document.fonts?.status !== "loaded") return text.length * char;
  context.font = css;
  const width = context.measureText(text).width;
  widths.set(key, width);
  return width;
}
/** Shorten a readout to `width` px with an ellipsis (the full text is the tooltip). */
function fit(text: string | undefined, width: number, font: keyof typeof FONTS) {
  if (text === undefined || textWidth(text, font) <= width) return text;
  let n = text.length - 1;
  while (n > 1 && textWidth(`${text.slice(0, n).trimEnd()}…`, font) > width) n--;
  return `${text.slice(0, n).trimEnd()}…`;
}
/** Terminal labels of a module (only real ports of its catalog definition). */
export function modulePins(c: Component): Pins | undefined {
  const pins = face(c).pins;
  if (!pins) return undefined;
  const ports = new Set(definitions[c.kind].ports.map((p) => p.id));
  return { ...pins, labels: Object.fromEntries(Object.entries(pins.labels).filter(([id]) => ports.has(id))) };
}

/** Symbol, hero value and state line inside a module; the workspace draws the frame, name band, lamp and terminals. */
export function ModuleFace({ c }: { c: Component }) {
  const { w, h } = dimensions(c), f = face(c);
  // Terminals entering from below keep the bottom row for their labels: the readout moves up one line.
  const bottomLabels = Object.keys(f.pins?.labels ?? {}).some((id) => portLocal(c, id).y > h);
  const both = f.hero !== undefined && f.detail !== undefined;
  const heroY = f.readoutY ?? (c.kind === "switch" ? h - 16 : (bottomLabels ? h - 34 : h - 24) + (both ? 0 : 7));
  const toneClass = f.tone ? ` ${f.tone}` : "", alarm = f.tone === "fault" || f.tone === "warning" ? toneClass : "";
  const detailY = f.hero === undefined ? heroY : heroY + 15;
  // Edge labels of side terminals beside a readout row narrow that row to the free span between them.
  const free = (baseline: number) => {
    let left = 6, right = w - 6;
    for (const [id, text] of Object.entries(f.pins?.labels ?? {})) {
      const q = portLocal(c, id), y = f.pins?.strip ? q.y + 4.5 : q.y - 7, extent = (f.pins?.strip ? 12 : 7) + textWidth(text, "pin") + 5;
      if (y - 11 > baseline + 3 || y + 3 < baseline - 11) continue;
      if (q.x < 0) left = Math.max(left, extent);
      else if (q.x > w) right = Math.min(right, w - extent);
    }
    return [left, right];
  };
  const rows = [f.hero !== undefined ? free(heroY) : null, f.detail !== undefined ? free(detailY) : null].filter((r): r is number[] => !!r);
  const left = Math.max(...rows.map((r) => r[0])), right = Math.min(...rows.map((r) => r[1]));
  // Rows centre on the module unless centred text would reach a narrowed side: then they align to that side's edge.
  const half = Math.max(f.hero === undefined ? 0 : textWidth(f.hero, "value"), f.detail === undefined ? 0 : textWidth(f.detail, "state")) / 2;
  const centred = Math.abs(left - (w - right)) < 4 || (w / 2 - half >= left && w / 2 + half <= right);
  const anchor = centred ? "middle" : w - right > left ? "end" : "start", x = centred ? w / 2 : anchor === "end" ? right : left;
  const span = (r: number[] | null | undefined) => (r ? (anchor === "end" ? right - r[0] : anchor === "start" ? r[1] - left : Math.min(w / 2 - r[0], r[1] - w / 2) * 2) : 0);
  const hero = fit(f.hero, span(f.hero !== undefined ? rows[0] : null), "value"), detail = fit(f.detail, span(rows.at(-1)), "state");
  return <g>
    {f.symbol}
    {hero !== undefined && <text x={x} y={heroY} textAnchor={anchor} className={`face-value${toneClass}`}>{hero}{hero !== f.hero && <title>{f.hero}</title>}</text>}
    {detail !== undefined && <text x={x} y={detailY} textAnchor={anchor} className={`face-state${alarm}`}>{detail}{(detail !== f.detail || f.title) && <title>{f.title ?? f.detail}</title>}</text>}
  </g>;
}
