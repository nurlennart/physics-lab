import { inspectorMeasurements, measurementLabel } from "../simulation/capabilities";
import { useState } from "react";
import {
  SlidersHorizontal,
  ChevronDown,
  Info,
  Trash2,
  MousePointer2,
  TriangleAlert,
  Activity,
} from "lucide-react";
import { actions, simulation, useLab } from "../editor/store";
import {
  definitions,
  componentCost,
  prop,
  isThermalMass,
  type Component,
  type Measurement,
} from "../simulation/model";
import { thermalThreshold } from "../simulation/parameters";
import { ParameterSections, DerivedValues, RatingIndicators, ModelAndPresets, EnvironmentPanel } from "./ParameterEditor";
import { allowedFaults, type FaultType } from "../simulation/automation";
import {
  measurements,
  formatReading,
  readProbe,
  units,
  probeUnit,
} from "../simulation/measurements";
import { pumpCurve } from "../simulation/hydraulic";
import { ComponentIcon } from "./Icons";
export default function Inspector() {
  const s = useLab(),
    c = s.project.components.find((c) => c.id === s.selected[0]);
  const [tab, setTab] = useState("properties"),
    [metric, setMetric] = useState<Measurement>("temperature");
  if (!c)
    return (
      <aside className="inspector">
        <div className="panel-heading">
          <h2>Inspector</h2>
          <SlidersHorizontal size={15} />
        </div>
        <div className="inspector-empty">
          <MousePointer2 size={25} />
          <h3>
            {s.selectedWire ? "Connection selected" : "Inspect your experiment"}
          </h3>
          <p>
            {s.selectedWire
              ? "Drag highlighted bend points to route the wire. Press Delete to remove it."
              : "Select a component to inspect calculated measurements and configure its model."}
          </p>
          {s.selectedWire && !s.project.challenge && (
            <button className="text-link" onClick={actions.disconnect}>
              Inject disconnected-wire fault
            </button>
          )}
        </div>
        {!s.selectedWire && <EnvironmentPanel />}
        {s.selectedWire && <p className="field-hint wire-hint">Wires are ideal zero-resistance connections. Insert a Power cable component to model conductor resistance, voltage drop and heating.</p>}
      </aside>
    );
  const d = definitions[c.kind],
    options = measurements(c),
    status = simulation.failed[c.id]
      ? "failedOpen"
      : (simulation.automation.status[c.id] ?? "healthy");
  const sensor = simulation.automation.sensors[c.id],
    temp = sensor ? sensor.valid ? Number(sensor.value) : undefined : simulation.temperatures[c.id],
    h = simulation.multiphysics.hydraulic.readings[c.id],
    r = simulation.electrical.readings[c.id],
    v = simulation.automation.signals[c.id];
  const primary =
    c.kind === 'rigidBody' ? simulation.spatial.readings[c.id]?.y.toFixed(3) ?? '—' : c.kind === 'forceActuator' ? (readProbe({ component: c.id, measurement: c.props.axis === 'torque' ? 'appliedTorque' : 'appliedForce' } as Parameters<typeof readProbe>[0], simulation)?.toFixed(3) ?? '—') : isThermalMass(c) || sensor
      ? temp === undefined
        ? "—"
        : formatReading(temp, 2)
      : h ? (h.flow * 60000).toFixed(3) : v
        ? v.valid
          ? typeof v.value === "boolean"
            ? v.value
              ? "ON"
              : "OFF"
            : Number(v.value).toFixed(2)
          : "INVALID"
        : r?.voltageValid === false
          ? "—"
          : (r?.voltage.toFixed(2) ?? "—");
  return (
    <aside className="inspector">
      <div className="panel-heading">
        <h2>Inspector</h2>
        <SlidersHorizontal size={15} />
      </div>
      <div
        className={`inspector-component ${isThermalMass(c) ? "thermal" : ""}`}
      >
        <span className="inspector-icon">
          <ComponentIcon kind={c.kind} size={23} />
        </span>
        <div>
          <h3>{d.label}</h3>
          <span className="mono muted">{c.name}</span>
        </div>
        <button aria-label="Delete component" onClick={actions.remove}>
          <Trash2 size={14} />
        </button>
      </div>
      <div className="inspector-tabs">
        <button
          className={tab === "properties" ? "active" : ""}
          onClick={() => setTab("properties")}
        >
          Properties
        </button>
        <button
          className={tab === "model" ? "active" : ""}
          onClick={() => setTab("model")}
        >
          Physical model
        </button>
      </div>
      <div className="inspector-scroll">
        {tab === "model" ? (
          <div className="model-description">
            <Info size={18} />
            <h3>{d.label}</h3>
            <p>{d.description}.</p>
            <p>
              {c.kind === "pipe" ? "Δp = f(L/D)ρv|v|/2. Reynolds number selects 64/Re in laminar flow and Swamee–Jain in turbulence, blended over Re 2300–4000. Visual length does not change physical length. Thermal UA is explicit; material and insulation metadata do not derive it." : "Hydraulic quantities use SI internally. Vented finite tanks enforce inventory boundaries. Motor current includes shaft back EMF; pump load feeds back into acceleration. Zero-volume pipes carry heat conservatively; travel time and water hammer are deferred."}
            </p><p>
              Controllers use the simulation clock. Relay contact resistance
              dissipates I²R into its thermal mass. Sensors read the selected
              thermal state. Cooling uses UA(T − Tcoolant) to an ideal
              reservoir. The independent cutoff has its own sensor and latching
              series contact. Switching arcs and coil power are omitted.
            </p>
            <button
              className="text-link"
              onClick={() => actions.set({ view: "models" })}
            >
              Read model documentation
            </button>
          </div>
        ) : (
          <>
            <div className="inspector-section">
              <div className="section-label">
                <span>LIVE MEASUREMENTS</span>
                <span
                  className={
                    status === "healthy" ? "live-badge" : "invalid-badge"
                  }
                >
                  {status.toUpperCase()}
                </span>
              </div>
              <div
                className={`primary-reading ${isThermalMass(c) || sensor ? "thermal-text" : "electrical-text"}`}
              >
                <span>{primary}</span>
                <small>
                  {c.kind === 'rigidBody' ? 'm' : c.kind === 'forceActuator' ? c.props.axis === 'torque' ? 'N·m' : 'N' : sensor ? ["sensor", "thermostat", "safety"].includes(c.kind) ? "°C" : definitions[c.kind].ports.find(p => p.id === "out")?.unit ?? "°C" : isThermalMass(c) ? "°C" : h ? "L/min" : v ? "" : "V"}
                </small>
              </div>
              <div className="reading-caption">
                {c.kind === 'rigidBody' ? 'Calculated world height' : c.kind === 'forceActuator' ? 'Calculated applied load' : sensor
                  ? "Measured physical state"
                  : isThermalMass(c)
                    ? "Thermal state"
                    : h
                      ? c.kind === "heatExchanger" ? "Hot stream flow" : "Calculated fluid flow"
                    : v
                      ? "Control output"
                      : "Terminal voltage"}
              </div>
              <div className="measurement-list">
                {inspectorMeasurements(c, !!simulation.electrical.readings[c.id]?.ac, s.project.connections.some((w) => w.domain === "hydraulic" && (w.from.component === c.id || w.to.component === c.id)))
                  .map((m) => {
                    const value = readProbe(
                      {
                        id: "",
                        name: "",
                        component: c.id,
                        measurement: m,
                        color: "#ffffff",
                        visible: true,
                      },
                      simulation,
                    );
                    return (
                      <div key={m}>
                        <span>
                          {measurementLabel(c, m, !!simulation.electrical.readings[c.id]?.ac)}
                        </span>
                        <strong>
                          {value === null
                            ? "—"
                            : formatReading(value,
                                m === "state" || m === "signal" ? 2 : 3,
                              )}{" "}
                          <small>
                            {probeUnit(
                              { component: c.id, measurement: m },
                              s.project,
                            )}
                          </small>
                        </strong>
                      </div>
                    );
                  })}
              </div>
              {sensor && !sensor.valid && <p className="field-hint">{sensor.reason}</p>}
              {v && !v.valid && <p className="field-hint">{v.reason}</p>}
            </div>
            {c.kind === "pump" && (() => {
              const rpm = readProbe({ component: c.id, measurement: "rpm" } as Parameters<typeof readProbe>[0], simulation) ?? 0;
              const omega = rpm * Math.PI / 30, ratio = omega / prop(c, "ratedSpeed"), qMax = prop(c, "ratedFlow") * Math.max(0.01, ratio) * Math.SQRT2;
              const headMax = Math.max(0.1, prop(c, "shutoffHead") * ratio * ratio);
              const points = Array.from({ length: 25 }, (_, i) => { const q = qMax * i / 24; return `${20 + 215 * q / qMax},${115 - 95 * pumpCurve(c, omega, q).head / headMax}`; }).join(" ");
              return <div className="inspector-section"><div className="section-label">PUMP OPERATING CURVE</div><svg viewBox="0 0 260 145" role="img" aria-label="Pump head versus flow with calculated operating point"><path d="M20 15V115H240" fill="none" stroke="#506570"/><polyline points={points} fill="none" stroke="#78b8d1" strokeWidth="2"/><circle cx={20 + 215 * Math.max(0, h?.flow ?? 0) / qMax} cy={115 - 95 * pumpCurve(c, omega, h?.flow ?? 0).head / headMax} r="4" fill="#e9bd6a"/><text x="20" y="137" fill="#9aabb5" fontSize="10">0 → {(qMax * 60000).toFixed(1)} L/min · {headMax.toFixed(2)} m shutoff</text></svg><p className="field-hint">Curve at actual {rpm.toFixed(0)} RPM. Dot shows solved flow and gross impeller head; internal loss reduces net outlet rise.</p></div>;
            })()}
            <RatingIndicators c={c} />
            <ModelAndPresets c={c} />
            <ParameterSections c={c} />
            <DerivedValues c={c} />
            {['rigidBody', 'motor', 'pump', 'tank', 'heater', 'cooler'].includes(c.kind) && <div className="inspector-section"><button className="fault-button" disabled={!c.spatial && simulation.time > 0} onClick={() => c.spatial ? actions.workspace('physical') : actions.associate(c.id)}>{c.spatial ? 'Locate same component in Physical view' : 'Place component in Physical view'}</button></div>}
            {c.kind === "safety" && (
              <div className="inspector-section">
                <div className="section-label">INDEPENDENT PROTECTION</div>
                <p className="field-hint">
                  Own sensing path. Trip is latched. Reset below{" "}
                  {(prop(c, "threshold") - prop(c, "resetMargin")).toFixed(1)}
                  °C. Welded contacts ignore the latch; no certification is
                  implied.
                </p>
                <button
                  className="fault-button"
                  disabled={
                    !simulation.automation.memory[c.id]?.tripped || s.busy
                  }
                  onClick={() => actions.resetSafety(c.id)}
                >
                  Manually reset safety latch
                </button>
              </div>
            )}
            {(c.kind === "breaker" || c.kind === "motorProtector") && (
              <div className="inspector-section">
                <div className="section-label">
                  <span>PROTECTION STATE</span>
                  <span className={simulation.breakers[c.id]?.tripped ? "invalid-badge" : "live-badge"}>{simulation.breakers[c.id]?.tripped ? "TRIPPED" : c.props.closed === false ? "OPEN" : "CLOSED"}</span>
                </div>
                <div className="rating-bar">
                  <div><span>Thermal memory</span><strong>{(((simulation.breakers[c.id]?.theta ?? 0) / thermalThreshold(c.kind) ** 2) * 100).toFixed(1)} % of trip</strong></div>
                  <i><b style={{ width: `${Math.min(100, ((simulation.breakers[c.id]?.theta ?? 0) / thermalThreshold(c.kind) ** 2) * 100)}%` }} /></i>
                </div>
                <button className="fault-button" disabled={!simulation.breakers[c.id]?.tripped || s.busy} onClick={() => actions.resetSafety(c.id)}>
                  Re-close after trip
                </button>
                <p className="field-hint">Thermal image θ = (I/In)² with time constant τ heats and cools continuously; re-closing is possible once θ has cooled below rated heating.</p>
              </div>
            )}
            {c.kind === "reset" && (
              <button
                className="fault-button"
                onClick={() => actions.pulse(c.id)}
              >
                Send one-step reset pulse
              </button>
            )}
            <div className="inspector-section">
              <div className="section-label">
                <Activity size={13} /> MEASUREMENT PROBES
              </div>
              <select
                className="wide-select"
                aria-label="Probe measurement"
                value={options.includes(metric) ? metric : options[0]}
                onChange={(e) => setMetric(e.target.value as Measurement)}
              >
                {options
                  .filter((x) => x !== "nodeVoltage")
                  .map((x) => (
                    <option key={x} value={x}>
                      {measurementLabel(c, x)} [{units[x]}]
                    </option>
                  ))}
              </select>
              <button
                className="text-link"
                onClick={() =>
                  actions.addProbe(
                    c.id,
                    options.includes(metric) && metric !== "nodeVoltage"
                      ? metric
                      : options.find((x) => x !== "nodeVoltage")!,
                  )
                }
              >
                Add trace for {c.name}
              </button>
              <p className="field-hint">
                Differential node probes: choose Node measurement mode in the
                canvas toolbar, then reference and measured terminals.
              </p>
            </div>
            {allowedFaults(c).length > 0 && (
              <details className="inspector-section">
                <summary className="section-label">EXPERIMENT FAULTS</summary>
                <p className="field-hint">
                  Faults change actual behavior and are recorded for replay.
                  Reset removes faults.
                </p>
                <select
                  className="wide-select"
                  aria-label="Inject component fault"
                  disabled={!!s.project.challenge || s.busy}
                  value={simulation.faults[c.id] ?? ""}
                  onChange={(e) =>
                    actions.fault(
                      c.id,
                      (e.target.value || null) as FaultType | null,
                    )
                  }
                >
                  <option value="">Healthy / clear injected fault</option>
                  {allowedFaults(c).map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
                {s.project.challenge && (
                  <p className="field-hint">
                    Fault schedule belongs to this scored scenario.
                  </p>
                )}
              </details>
            )}
            {simulation.failed[c.id] && (
              <div className="component-warning">
                <TriangleAlert size={15} />
                {simulation.tripped[c.id] ? "Output protection tripped. Reset to re-arm." : "Permanent failure. Reset to replace."}
              </div>
            )}
          </>
        )}
      </div>
      <div className="inspector-footer">
        <span>{componentCost(c).estimated ? "Estimated cost (custom sizing)" : "Component cost"}</span>
        <strong>€{componentCost(c).cost.toFixed(2)}</strong>
      </div>
    </aside>
  );
}
