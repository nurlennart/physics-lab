import { useState, useEffect } from "react";
import {
  Activity,
  Download,
  ChartNoAxesCombined,
  List,
  Scale,
  ChevronDown,
  Flame,
  Zap,
  Timer,
  TriangleAlert,
  RotateCcw,
} from "lucide-react";
import { actions, simulation, useLab } from "../editor/store";
import type { Sample } from "../simulation/engine";
export function formatTime(t: number) {
  const ticks = Math.round(t * 100);
  return `${String(Math.floor(ticks / 360000)).padStart(2, "0")}:${String(Math.floor(ticks / 6000) % 60).padStart(2, "0")}:${((ticks % 6000) / 100).toFixed(2).padStart(5, "0")}`;
}
const channels: {
  key: keyof Sample;
  label: string;
  unit: string;
  color: string;
}[] = [
  {
    key: "temperature",
    label: "Water temperature",
    unit: "°C",
    color: "#eb9d72",
  },
  {
    key: "heaterTemperature",
    label: "Element temperature",
    unit: "°C",
    color: "#d8b67e",
  },
  { key: "power", label: "Electrical power", unit: "W", color: "#e1b667" },
  { key: "voltage", label: "Supply voltage", unit: "V", color: "#e1b667" },
  { key: "current", label: "Load current", unit: "A", color: "#91bda9" },
  { key: "energy", label: "Energy consumed", unit: "J", color: "#a293c7" },
];
export default function Telemetry() {
  const s = useLab(),
    [channel, setChannel] = useState<keyof Sample>("temperature");
  useEffect(() => {
    setChannel(
      s.project.components.some((c) => c.kind === "tank")
        ? "temperature"
        : "power",
    );
  }, [s.project.id]);
  const ch = channels.find((c) => c.key === channel)!;
  const samples = simulation.samples,
    points = samples.filter(
      (_, i) => i % Math.max(1, Math.floor(samples.length / 500)) === 0,
    );
  const values = points.map((p) => p[channel]),
    minValue = Math.min(...values, channel === "temperature" ? 20 : 0),
    maxValue = Math.max(...values, minValue + 1);
  const pad = (maxValue - minValue) * 0.15;
  const lo =
      channel === "temperature"
        ? Math.floor(minValue - pad)
        : Math.max(0, minValue - pad),
    hi = maxValue + pad;
  const end = Math.max(10, simulation.time),
    start = samples[0]?.time ?? 0;
  const W = 900,
    H = 120;
  const path = points
    .map(
      (p, i) =>
        `${i ? "L" : "M"}${48 + ((p.time - start) / (end - start)) * 830},${H - 15 - ((p[channel] - lo) / (hi - lo)) * 90}`,
    )
    .join(" ");
  const tank = s.project.components.find((c) => c.kind === "tank");
  const temperature = tank ? simulation.temperatures[tank.id] : undefined;
  const balance =
    simulation.energy - simulation.storedEnergy - simulation.ambientEnergy;
  return (
    <section className="telemetry">
      <div className="telemetry-top">
        <div className="telemetry-tabs">
          <button
            className={s.panel === "telemetry" ? "active" : ""}
            onClick={() => actions.set({ panel: "telemetry" })}
          >
            <ChartNoAxesCombined size={14} />
            Live telemetry
          </button>
          <button
            className={s.panel === "events" ? "active" : ""}
            onClick={() => actions.set({ panel: "events" })}
          >
            <List size={14} />
            Event log <span className="count">{simulation.events.length}</span>
          </button>
          <button
            className={s.panel === "energy" ? "active" : ""}
            onClick={() => actions.set({ panel: "energy" })}
          >
            <Scale size={14} />
            Energy balance
          </button>
        </div>
        <div className="telemetry-actions">
          {s.panel === "events" && (
            <button className="csv-button" onClick={actions.replay}>
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
      {s.panel === "telemetry" ? (
        <>
          <div className="telemetry-metrics">
            <div>
              <span>
                <Flame size={12} />
                WATER TEMPERATURE
              </span>
              <strong className="thermal-text">
                {temperature === undefined ? "—" : temperature.toFixed(2)}
                <small>°C</small>
              </strong>
            </div>
            <div>
              <span>
                <Zap size={12} />
                ELECTRICAL POWER
              </span>
              <strong>
                {simulation.error
                  ? "—"
                  : simulation.electrical.sourcePower.toFixed(1)}
                <small>W</small>
              </strong>
            </div>
            <div>
              <span>
                <Activity size={12} />
                ENERGY CONSUMED
              </span>
              <strong>
                {(simulation.energy / 1000).toFixed(2)}
                <small>kJ</small>
              </strong>
            </div>
            <div>
              <span>
                <Timer size={12} />
                SIMULATION TIME
              </span>
              <strong>
                {formatTime(simulation.time)}
                <small>s</small>
              </strong>
            </div>
          </div>
          <div className="chart-heading">
            <label>
              <i style={{ background: ch.color }} />
              <select
                value={channel}
                onChange={(e) => setChannel(e.target.value as keyof Sample)}
                aria-label="Chart measurement"
              >
                {channels.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
              <ChevronDown size={12} />
            </label>
            <span>
              {s.running ? "Recording" : "Paused"} · 4 samples/s · {ch.unit}
            </span>
          </div>
          <div className="chart">
            <svg
              viewBox={`0 0 ${W} ${H}`}
              preserveAspectRatio="none"
              aria-label={`${ch.label} over simulation time`}
              role="img"
            >
              <defs>
                <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={ch.color} stopOpacity=".13" />
                  <stop offset="100%" stopColor={ch.color} stopOpacity="0" />
                </linearGradient>
              </defs>
              {[0, 1, 2].map((i) => {
                const y = 15 + i * 45,
                  v = hi - ((hi - lo) * i) / 2;
                return (
                  <g key={i}>
                    <line
                      x1="48"
                      x2="880"
                      y1={y}
                      y2={y}
                      stroke="#2d373d"
                      strokeDasharray="3 4"
                    />
                    <text x="35" y={y + 4} textAnchor="end">
                      {v.toFixed(channel === "energy" ? 0 : 1)}
                    </text>
                  </g>
                );
              })}
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <g key={i}>
                  <line
                    x1={48 + i * 166}
                    x2={48 + i * 166}
                    y1="15"
                    y2="105"
                    stroke="#263138"
                  />
                  <text x={48 + i * 166} y="119" textAnchor="middle">
                    {(start + ((end - start) * i) / 5).toFixed(0)} s
                  </text>
                </g>
              ))}
              {points.length > 1 && (
                <>
                  <path
                    d={`${path}L${48 + ((points[points.length - 1].time - start) / (end - start)) * 830},105H48Z`}
                    fill="url(#chartFill)"
                  />
                  <path
                    d={path}
                    stroke={ch.color}
                    strokeWidth="1.7"
                    vectorEffect="non-scaling-stroke"
                    fill="none"
                  />
                </>
              )}
              {points.length <= 1 && (
                <text
                  x="470"
                  y="65"
                  textAnchor="middle"
                  className="chart-empty"
                >
                  Run the simulation to record measurements
                </text>
              )}
            </svg>
          </div>
        </>
      ) : s.panel === "events" ? (
        <div className="event-log">
          {[...simulation.events].reverse().map((e, i) => (
            <div className={`log-row ${e.level}`} key={`${e.time}-${i}`}>
              <time>{formatTime(e.time)}</time>
              <span className="event-level">{e.level.toUpperCase()}</span>
              <span>{e.message}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="energy-panel">
          <div>
            <span>Electrical input</span>
            <strong>
              {(simulation.energy / 1000).toFixed(4)} <small>kJ</small>
            </strong>
          </div>
          <span className="energy-equals">=</span>
          <div>
            <span>Stored thermal energy</span>
            <strong>
              {(simulation.storedEnergy / 1000).toFixed(4)} <small>kJ</small>
            </strong>
          </div>
          <span className="energy-equals">+</span>
          <div>
            <span>Heat to ambient</span>
            <strong>
              {(simulation.ambientEnergy / 1000).toFixed(4)} <small>kJ</small>
            </strong>
          </div>
          <div className="energy-error">
            <Scale size={16} />
            <span>
              Conservation residual{" "}
              <strong>{Math.abs(balance).toExponential(2)} J</strong>
            </span>
            <p>
              Electrical input equals the change in thermal storage plus ambient
              losses. Positive ambient heat denotes energy leaving the system.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
