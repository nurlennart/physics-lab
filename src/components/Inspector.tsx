import { useState, useEffect } from "react";
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
  catalog,
  prop,
  isThermalMass,
  type Component,
  type Measurement,
} from "../simulation/model";
import {
  liveProperties,
  configurableProperties,
  propertyError,
} from "../simulation/integrity";
import { allowedFaults, type FaultType } from "../simulation/automation";
import {
  measurements,
  readProbe,
  units,
  probeUnit,
} from "../simulation/measurements";
import { ComponentIcon } from "./Icons";
const labels: Record<string, string> = {
  voltage: "Supply voltage",
  volume: "Water volume",
  initialTemperature: "Initial temperature",
  ambient: "Ambient temperature",
  capacity: "Tank capacity",
  maxCurrent: "Current limit",
  loss: "Ambient loss (UA)",
  resistance: "Resistance",
  ratedPower: "Power rating",
  heatCapacity: "Thermal capacity",
  conductance: "Conductance (UA)",
  maxTemperature: "Temperature limit",
  target: "Thermal target",
  low: "ON below",
  high: "OFF at or above",
  setpoint: "Setpoint",
  hysteresis: "Hysteresis band",
  threshold: "Safety cutoff",
  resetMargin: "Reset margin",
  minRange: "Minimum reading",
  maxRange: "Maximum reading",
  resolution: "Resolution",
  lag: "Measurement lag",
  noise: "Noise amplitude",
  failOnSensor: "Trip on sensor fault",
  initialOn: "Initial output",
  ratedVoltage: "Rated voltage",
  ratedCurrent: "Rated current",
  reference: "Reference",
  delay: "Delay",
  enabled: "Enabled",
  value: "Value",
  closed: "Switch state",
  mode: "Mode",
};
const fieldUnits: Record<string, string> = {
  voltage: "V",
  ratedVoltage: "V",
  volume: "L",
  capacity: "L",
  initialTemperature: "°C",
  ambient: "°C",
  resistance: "Ω",
  ratedPower: "W",
  maxCurrent: "A",
  ratedCurrent: "A",
  loss: "W/K",
  conductance: "W/K",
  heatCapacity: "J/K",
  maxTemperature: "°C",
  low: "°C",
  high: "°C",
  setpoint: "°C",
  hysteresis: "K",
  threshold: "°C",
  resetMargin: "K",
  resolution: "°C",
  lag: "s",
  delay: "s",
  noise: "°C",
};
function NumberInput({
  c,
  field,
  disabled,
}: {
  c: Component;
  field: string;
  disabled: boolean;
}) {
  const value = prop(c, field),
    [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value, c.id]);
  return (
    <label className="property-row">
      <span>{labels[field] ?? field}</span>
      <span className="number-field">
        <input
          aria-label={labels[field] ?? field}
          type="number"
          disabled={disabled}
          step="any"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (draft.trim() && Number.isFinite(Number(draft))) {
              actions.property(c.id, field, Number(draft));
              setDraft(String(prop(c, field)));
            } else setDraft(String(value));
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
        <span>{fieldUnits[field]}</span>
      </span>
    </label>
  );
}
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
      </aside>
    );
  const d = definitions[c.kind],
    model = catalog(c),
    options = measurements(c),
    status = simulation.failed[c.id]
      ? "failedOpen"
      : (simulation.automation.status[c.id] ?? "healthy");
  const sensor = simulation.automation.sensors[c.id],
    temp = sensor?.valid ? Number(sensor.value) : simulation.temperatures[c.id],
    r = simulation.electrical.readings[c.id],
    v = simulation.automation.signals[c.id];
  const primary =
    isThermalMass(c) || sensor
      ? temp === undefined
        ? "—"
        : temp.toFixed(2)
      : v
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
                  {isThermalMass(c) || sensor ? "°C" : v ? "" : "V"}
                </small>
              </div>
              <div className="reading-caption">
                {sensor
                  ? "Measured temperature"
                  : isThermalMass(c)
                    ? "Thermal state"
                    : v
                      ? "Control output"
                      : "Terminal voltage"}
              </div>
              <div className="measurement-list">
                {options
                  .filter((x) => x !== "nodeVoltage")
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
                          {m === "current" ? "NO / branch current" : m}
                        </span>
                        <strong>
                          {value === null
                            ? "—"
                            : value.toFixed(
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
              {v && !v.valid && <p className="field-hint">{v.reason}</p>}
            </div>
            <div className="inspector-section">
              <div className="section-label">CATALOG MODEL</div>
              <select
                className="wide-select"
                aria-label="Component variant"
                value={c.variant ?? "standard"}
                disabled={simulation.time > 0 || s.busy}
                onChange={(e) => actions.variant(c.id, e.target.value)}
              >
                <option value="standard">Standard · €{d.cost}</option>
                {d.variants?.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.label} · €{x.cost}
                  </option>
                ))}
              </select>
              <p className="field-hint">
                {model.spec}. Ratings are purchased with the model. Reset before
                changing physical configuration.
              </p>
            </div>
            <div className="inspector-section">
              <div className="section-label">
                CONFIGURATION <ChevronDown size={13} />
              </div>
              {Object.entries(c.props).map(([field, value]) => {
                const editable =
                    liveProperties.has(field) ||
                    configurableProperties.has(field),
                  environmentLocked =
                    !!s.project.challenge &&
                    ((c.kind === "tank" &&
                      ["volume", "initialTemperature", "ambient"].includes(
                        field,
                      )) ||
                      (c.kind === "cooler" && field === "ambient") ||
                      (c.kind === "safety" && field === "failOnSensor")),
                  disabled =
                    s.busy ||
                    environmentLocked ||
                    !editable ||
                    !!propertyError(
                      s.project,
                      c,
                      field,
                      value,
                      simulation.time,
                    ) ||
                    (simulation.time > 0 && !liveProperties.has(field));
                if (field === "target")
                  return (
                    <label className="property-row" key={field}>
                      <span>Thermal target</span>
                      <select
                        aria-label="Thermal target"
                        disabled={disabled}
                        value={String(value)}
                        onChange={(e) =>
                          actions.property(c.id, field, e.target.value)
                        }
                      >
                        <option value="">Unassigned</option>
                        {s.project.components.filter(isThermalMass).map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name} · {definitions[x.kind].label}
                          </option>
                        ))}
                      </select>
                    </label>
                  );
                if (field === "mode")
                  return (
                    <label className="property-row" key={field}>
                      <span>Mode</span>
                      <select
                        aria-label="Controller mode"
                        disabled={disabled}
                        value={String(value)}
                        onChange={(e) =>
                          actions.property(c.id, field, e.target.value)
                        }
                      >
                        {(c.kind === "timer"
                          ? ["onDelay", "offDelay", "pulse"]
                          : ["lt", "lte", "gt", "gte"]
                        ).map((x) => (
                          <option key={x}>{x}</option>
                        ))}
                      </select>
                    </label>
                  );
                if (typeof value === "boolean")
                  return (
                    <label className="property-row" key={field}>
                      <span>{labels[field] ?? field}</span>
                      <button
                        disabled={disabled}
                        className={`switch-control ${value ? "on" : ""}`}
                        aria-label={
                          c.kind === "switch"
                            ? "Toggle switch"
                            : (labels[field] ?? field)
                        }
                        aria-pressed={value}
                        onClick={() => actions.property(c.id, field, !value)}
                      >
                        <i />
                        {value ? "On" : "Off"}
                      </button>
                    </label>
                  );
                if (typeof value === "number")
                  return (
                    <NumberInput
                      c={c}
                      field={field}
                      disabled={disabled}
                      key={field}
                    />
                  );
                return null;
              })}
            </div>
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
                      {x} [{units[x]}]
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
                Permanent failure. Reset to replace.
              </div>
            )}
          </>
        )}
      </div>
      <div className="inspector-footer">
        <span>Component cost</span>
        <strong>€{model.cost.toFixed(2)}</strong>
      </div>
    </aside>
  );
}
