import { T } from "../theme/tokens";
import { measurementLabel } from "../simulation/capabilities";
import { useState } from "react";
import {
  ChartNoAxesCombined,
  List,
  Scale,
  Download,
  RotateCcw,
  Plus,
  X,
} from "lucide-react";
import { actions, simulation, useLab } from "../editor/store";
import {
  units,
  formatReading,
  measurements,
  readProbe,
  probeUnit,
} from "../simulation/measurements";
import { type Measurement, type Probe } from "../simulation/model";
export function formatTime(t: number) {
  const ticks = Math.round(t * 100);
  return `${String(Math.floor(ticks / 360000)).padStart(2, "0")}:${String(Math.floor(ticks / 6000) % 60).padStart(2, "0")}:${((ticks % 6000) / 100).toFixed(2).padStart(5, "0")}`;
}
function Plot({
  probes,
  start,
  end,
}: {
  probes: Probe[];
  start: number;
  end: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const samples = simulation.samples.filter(
      (s) => s.time >= start && s.time <= end,
    ),
    points = samples.filter(
      (_, i) => i % Math.max(1, Math.floor(samples.length / 600)) === 0,
    ),
    values = points.flatMap((s) =>
      probes
        .map((p) => s.values[p.id])
        .filter((v): v is number => typeof v === "number"),
    );
  const min = Math.min(0, ...values),
    max = Math.max(min + 1, ...values),
    pad = (max - min) * 0.08,
    lo = min - pad,
    hi = max + pad;
  const sample =
    hover === null
      ? undefined
      : samples.reduce<(typeof samples)[number] | undefined>(
          (best, s) =>
            !best || Math.abs(s.time - hover) < Math.abs(best.time - hover)
              ? s
              : best,
          undefined,
        );
  return (
    <div className="trace-plot">
      <div className="trace-unit">
        {probeUnit(probes[0], simulation.project)}{" "}
        {sample && (
          <span>
            {sample.time.toFixed(3)} s ·{" "}
            {probes
              .map(
                (p) =>
                  `${p.name}: ${sample.values[p.id] === null || sample.values[p.id] === undefined ? "invalid" : sample.values[p.id]!.toFixed(4)}`,
              )
              .join(" · ")}
          </span>
        )}
      </div>
      <svg
        viewBox="0 0 900 94"
        preserveAspectRatio="none"
        role="img"
        aria-label={`${probeUnit(probes[0], simulation.project)} measurement traces`}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHover(
            start +
              Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) *
                (end - start),
          );
        }}
        onPointerLeave={() => setHover(null)}
      >
        {[0, 1, 2].map((i) => (
          <g key={i}>
            <line
              x1="52"
              x2="890"
              y1={10 + i * 30}
              y2={10 + i * 30}
              stroke={T.n9}
              strokeDasharray="3 4"
            />
            <text x="45" y={14 + i * 30} textAnchor="end">
              {(hi - ((hi - lo) * i) / 2).toPrecision(3)}
            </text>
          </g>
        ))}
        {probes.map((p) => {
          let pen = false;
          const d = points
            .map((s) => {
              const v = s.values[p.id];
              if (typeof v !== "number") {
                pen = false;
                return "";
              }
              const command = pen ? "L" : "M";
              pen = true;
              return `${command}${52 + ((s.time - start) / Math.max(0.001, end - start)) * 838},${70 - ((v - lo) / (hi - lo)) * 60}`;
            })
            .join(" ");
          return (
            <path
              key={p.id}
              d={d}
              fill="none"
              stroke={p.color}
              strokeWidth="1.6"
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
        <text x="52" y="91">
          {start.toFixed(1)} s
        </text>
        <text x="890" y="91" textAnchor="end">
          {end.toFixed(1)} s
        </text>
        {points.length < 2 && (
          <text x="470" y="45" textAnchor="middle">
            Run the simulation to record measurements
          </text>
        )}
      </svg>
    </div>
  );
}
export default function Telemetry() {
  const s = useLab(),
    [target, setTarget] = useState(""),
    [metric, setMetric] = useState<Measurement>("temperature"),
    [window, setWindow] = useState(600),
    [offset, setOffset] = useState(0),
    [manage, setManage] = useState(false);
  const probes = s.project.probes ?? [],
    c =
      s.project.components.find((c) => c.id === target) ??
      s.project.components[0],
    options = c ? measurements(c).filter((x) => x !== "nodeVoltage") : [],
    validMetric = options.some((x) => x === metric) ? metric : options[0];
  const end = Math.max(0.25, simulation.time - offset),
    start = Math.max(simulation.samples[0]?.time ?? 0, end - window),
    visible = probes.filter((p) => p.visible),
    groups = [...new Set(visible.map((p) => probeUnit(p, s.project)))];
  const a = simulation.samples.find((x) => x.time >= start),
    b = [...simulation.samples].reverse().find((x) => x.time <= end),
    delta = (
      key:
        | "kinetic" | "potential" | "shaftExport" | "copper" | "pumpWork" | "hydraulicWork" | "dissipation"
        | "supplied" | 'spatialEnergy' | 'spatialExternal' | 'mechanicalLoss'
        | "energy"
        | "waterStored"
        | "heaterStored"
        | "stored"
        | "ambient",
    ) => (b?.[key] ?? 0) - (a?.[key] ?? 0);
  const balance = delta("supplied") + delta('spatialExternal') - delta("stored") - delta("ambient") - delta("kinetic") - delta("potential") - delta("shaftExport") - delta('spatialEnergy') - delta('mechanicalLoss');
  return (
    <section className="telemetry">
      <div className="telemetry-top">
        <div className="telemetry-tabs">
          {(
            [
              {
                id: "telemetry",
                label: "Live telemetry",
                Icon: ChartNoAxesCombined,
              },
              { id: "events", label: "Event log", Icon: List },
              { id: "energy", label: "Energy balance", Icon: Scale },
            ] as const
          ).map(({ id, label, Icon }) => (
            <button
              key={id}
              className={s.panel === id ? "active" : ""}
              onClick={() => actions.set({ panel: id })}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>
        <div className="telemetry-actions">
          {s.panel === "events" && (
            <button
              className="csv-button"
              disabled={s.busy}
              onClick={actions.replay}
            >
              <RotateCcw size={13} />
              Replay experiment
            </button>
          )}
          <button className="csv-button" onClick={actions.exportCSV}>
            <Download size={13} />
            Export CSV
          </button>
        </div>
      </div>
      {s.panel === "events" ? (
        <div className="event-log">
          {[...simulation.events].reverse().map((e, i) => (
            <div className={`log-row ${e.level}`} key={i}>
              <time>{formatTime(e.time)}</time>
              <span className="event-level">{e.level.toUpperCase()}</span>
              <span>{e.message}</span>
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="chart-heading">
            <label>
              Time window{" "}
              <select
                aria-label="Chart time window"
                value={window}
                onChange={(e) => setWindow(Number(e.target.value))}
              >
                {[30, 60, 300, 600, 1800, 3600, 21600, 86400, 604800].map((x) => (
                  <option key={x} value={x}>
                    {x < 3600 ? `${x} s` : x < 86400 ? `${x / 3600} h` : `${x / 86400} d`}
                  </option>
                ))}
              </select>
            </label>
            <label>
              History{" "}
              <input
                aria-label="Chart history offset"
                type="range"
                min={0}
                max={Math.max(0, simulation.time - 1)}
                step={0.25}
                value={offset}
                onChange={(e) => setOffset(Number(e.target.value))}
              />
            </label>
            <span>
              {formatTime(simulation.time)} · {simulation.sampleInterval <= 0.25 ? "4 samples/s" : `1 sample / ${simulation.sampleInterval} s`} ·{" "}
              {s.busy ? "Advancing" : s.running ? "Recording" : "Paused"}
            </span>
            {s.panel === "telemetry" && (
              <button onClick={() => setManage(!manage)}>
                <Plus size={13} />
                Manage traces
              </button>
            )}
          </div>
          {s.panel === "energy" ? (
            <div className="energy-panel">
              <div>
                <span>Selected interval</span>
                <strong>
                  {(a?.time ?? 0).toFixed(2)}–{(b?.time ?? 0).toFixed(2)} s
                </strong>
              </div>
              {[
                { name: "Electrical supplied", value: delta("supplied") },
                { name: 'External mechanical work (signed)', value: delta('spatialExternal') },
                { name: 'Spatial kinetic / potential / spring Δ', value: delta('spatialEnergy') },
                { name: 'Contact, stop and brake heat', value: delta('mechanicalLoss') },
                { name: "Electrical conversion (internal)", value: delta("energy") },
                { name: "Motor copper heat (internal)", value: delta("copper") },
                { name: "Pump shaft work (internal)", value: delta("pumpWork") },
                { name: "Net pump hydraulic work Δp·Q (internal)", value: delta("hydraulicWork") },
                { name: "Hydraulic dissipation (internal)", value: delta("dissipation") },
                { name: "Rotor kinetic energy Δ", value: delta("kinetic") },
                { name: "Fluid potential energy Δ", value: delta("potential") },
                { name: "External shaft, drain & overflow export", value: delta("shaftExport") },
                { name: "Water storage Δ", value: delta("waterStored") },
                { name: "Element storage Δ", value: delta("heaterStored") },
                {
                  name: "Other storage Δ",
                  value:
                    delta("stored") -
                    delta("waterStored") -
                    delta("heaterStored"),
                },
                { name: "Ambient + coolant heat", value: delta("ambient") },
              ].map((x) => (
                <div key={x.name}>
                  <span>{x.name}</span>
                  <strong>
                    {(x.value / 1000).toFixed(4)} <small>kJ</small>
                  </strong>
                </div>
              ))}
              <div>Mass residual <strong>{simulation.multiphysics.massResidual.toExponential(3)} kg</strong></div>
              <div>Hydraulic continuity <strong>{simulation.multiphysics.hydraulic.residual.toExponential(3)} m³/s</strong></div>
              <div className="energy-error">
                <Scale size={16} />
                <span>
                  Conservation residual{" "}
                  <strong>{balance.toExponential(3)} J</strong>
                </span>
                <p>
                  Electrical supply + signed external mechanical work = thermal, rotational, gravitational and spring storage changes + external heat, contact/brake losses and exported shaft/drain energy. Electrical
                  dissipation is an internal conversion, not an additional
                  output. Signed ambient heat includes the ideal coolant
                  reservoir. Interval endpoints use recorded samples.
                </p>
              </div>
            </div>
          ) : (
            <>
              {manage && (
                <div className="probe-manager">
                  <div className="probe-add">
                    <select
                      aria-label="Trace component"
                      value={c?.id ?? ""}
                      onChange={(e) => setTarget(e.target.value)}
                    >
                      {s.project.components.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="Chart measurement"
                      value={validMetric ?? ""}
                      onChange={(e) => setMetric(e.target.value as Measurement)}
                    >
                      {options.map((m) => (
                        <option key={m} value={m}>
                          {m} [{units[m]}]
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => c && actions.addProbe(c.id, validMetric)}
                    >
                      Add trace
                    </button>
                  </div>
                  {probes.map((p) => (
                    <div className="probe-row" key={p.id}>
                      <input
                        aria-label={`Show ${p.name}`}
                        type="checkbox"
                        checked={p.visible}
                        onChange={(e) =>
                          actions.probe(p.id, { visible: e.target.checked })
                        }
                      />
                      <input
                        aria-label={`Color ${p.name}`}
                        type="color"
                        value={p.color}
                        onChange={(e) =>
                          actions.probe(p.id, { color: e.target.value })
                        }
                      />
                      <input
                        aria-label={`Trace name ${p.name}`}
                        value={p.name}
                        onChange={(e) =>
                          actions.probe(p.id, {
                            name: e.target.value.slice(0, 80),
                          })
                        }
                      />
                      {s.project.components.find(c => c.id === p.component)?.kind === "heatExchanger" && <select aria-label={`Stream for ${p.name}`} value={p.port ?? "hot"} onChange={e => actions.probe(p.id, { port: e.target.value })}><option value="hot">A / hot stream</option><option value="cold">B / cold stream</option></select>}
                      <span>
                        {s.project.components.find(c => c.id === p.component) && !measurements(s.project.components.find(c => c.id === p.component)!).includes(p.measurement) ? "Unavailable: target does not model this quantity" : p.measurement} ·{" "}
                        {p.reference
                          ? "differential"
                          : p.measurement === "nodeVoltage"
                            ? "local reference"
                            : p.component.slice(0, 5)}
                      </span>
                      <button
                        aria-label={`Remove ${p.name}`}
                        onClick={() => actions.probe(p.id, null)}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="trace-readouts">
                {visible.map((p) => {
                  const v = readProbe(p, simulation);
                  return (
                    <label key={p.id}>
                      <i style={{ background: p.color }} />
                      {p.name}
                      <strong>
                        {v === null ? "invalid" : formatReading(v)}{" "}
                        <small>{probeUnit(p, s.project)}</small>
                      </strong>
                    </label>
                  );
                })}
              </div>
              <div className="multi-chart">
                {groups.map((unit) => (
                  <Plot
                    key={unit}
                    probes={visible.filter(
                      (p) => probeUnit(p, s.project) === unit,
                    )}
                    start={start}
                    end={end}
                  />
                ))}
                {!visible.length && (
                  <p className="field-hint">
                    Add a targeted measurement in the inspector or Manage
                    traces.
                  </p>
                )}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
