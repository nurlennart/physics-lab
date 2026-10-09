import { useState, useEffect } from "react";
import {
  SlidersHorizontal,
  ChevronDown,
  Link2,
  Info,
  Flame,
  Trash2,
  AlertTriangle,
  MousePointer2,
} from "lucide-react";
import { actions, simulation, useLab } from "../editor/store";
import { definitions, prop, type Component } from "../simulation/model";
import { ComponentIcon } from "./Icons";
function NumberInput({
  c,
  field,
  label,
  unit,
  step = 1,
}: {
  c: Component;
  field: string;
  label: string;
  unit: string;
  step?: number;
}) {
  const value = prop(c, field);
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value, c.id]);
  return (
    <label className="property-row">
      <span>{label}</span>
      <span className="number-field">
        <input
          aria-label={label}
          type="number"
          step={step}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (draft.trim() === "" || !Number.isFinite(Number(draft)))
              setDraft(String(value));
            else actions.property(c.id, field, Number(draft));
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
        <span>{unit}</span>
      </span>
    </label>
  );
}
export default function Inspector() {
  const s = useLab(),
    c = s.project.components.find((c) => c.id === s.selected[0]);
  const r = c && simulation.electrical.readings[c.id],
    temp = c ? (simulation.temperatures[c.id] ?? 20) : 20;
  const [tab, setTab] = useState("properties");
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
              ? "Press Delete to remove this connection."
              : "Select a component to edit its properties and inspect calculated measurements."}
          </p>
        </div>
      </aside>
    );
  const d = definitions[c.kind],
    isTank = c.kind === "tank";
  const thermalConnected = s.project.connections.some(
    (w) =>
      w.domain === "thermal" &&
      (w.from.component === c.id || w.to.component === c.id),
  );
  return (
    <aside className="inspector">
      <div className="panel-heading">
        <h2>Inspector</h2>
        <SlidersHorizontal size={15} />
      </div>
      <div
        className={`inspector-component ${isTank || c.kind === "heater" ? "thermal" : ""}`}
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
              {isTank
                ? "The tank is a single, well-mixed thermal volume. Water density is 1 kg/L and specific heat is 4,180 J/(kg·K). Wall heat capacity and internal temperature gradients are omitted."
                : c.kind === "heater"
                  ? "A constant resistance dissipates I²R into the element thermal mass. A thermal connection transfers heat into one tank using Q̇ = UA(Th − Tw). The coupled energy balances use backward Euler."
                  : "Circuit voltages and currents are solved by modified nodal analysis. Wires are ideal conductors. Every disconnected circuit receives its own local 0 V reference unless connected to ground."}
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
                    simulation.error
                      ? "invalid-badge"
                      : s.running
                        ? "live-badge"
                        : "paused-badge"
                  }
                >
                  {simulation.error
                    ? "LAST VALID STATE"
                    : s.running
                      ? "LIVE"
                      : "PAUSED"}
                </span>
              </div>
              <div
                className={`primary-reading ${isTank || c.kind === "heater" ? "thermal-text" : "electrical-text"}`}
              >
                <span>
                  {isTank || c.kind === "heater"
                    ? temp.toFixed(2)
                    : (r?.voltage ?? 0).toFixed(2)}
                </span>
                <small>{isTank || c.kind === "heater" ? "°C" : "V"}</small>
              </div>
              <div className="reading-caption">
                {isTank
                  ? "Water temperature"
                  : c.kind === "heater"
                    ? "Element temperature"
                    : "Terminal voltage"}
              </div>
              <div className="measurement-list">
                {isTank ? (
                  <>
                    <div>
                      <span>Fluid mass</span>
                      <strong>
                        {prop(c, "volume").toFixed(2)} <small>kg</small>
                      </strong>
                    </div>
                    <div>
                      <span>Heat capacity</span>
                      <strong>
                        {((prop(c, "volume") * 4180) / 1000).toFixed(2)}{" "}
                        <small>kJ/K</small>
                      </strong>
                    </div>
                    <div>
                      <span>Heat loss</span>
                      <strong>
                        {(
                          prop(c, "loss") *
                          (temp - prop(c, "ambient", 20))
                        ).toFixed(2)}{" "}
                        <small>W</small>
                      </strong>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <span>Current</span>
                      <strong>
                        {simulation.error
                          ? "—"
                          : Math.abs(r?.current ?? 0).toFixed(3)}{" "}
                        <small>A</small>
                      </strong>
                    </div>
                    <div>
                      <span>
                        {c.kind === "source"
                          ? "Supplied power"
                          : "Dissipated power"}
                      </span>
                      <strong>
                        {simulation.error
                          ? "—"
                          : Math.abs(r?.power ?? 0).toFixed(2)}{" "}
                        <small>W</small>
                      </strong>
                    </div>
                    {c.kind !== "source" && (
                      <div>
                        <span>Temperature</span>
                        <strong>
                          {temp.toFixed(2)} <small>°C</small>
                        </strong>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
            <div className="inspector-section">
              <div className="section-label">
                CONFIGURATION <ChevronDown size={13} />
              </div>
              {isTank ? (
                <>
                  <NumberInput
                    c={c}
                    field="volume"
                    label="Water volume"
                    unit="L"
                    step={0.1}
                  />
                  <NumberInput
                    c={c}
                    field="capacity"
                    label="Tank capacity"
                    unit="L"
                  />
                  <NumberInput
                    c={c}
                    field="initialTemperature"
                    label="Initial temperature"
                    unit="°C"
                  />
                  <NumberInput
                    c={c}
                    field="ambient"
                    label="Ambient temperature"
                    unit="°C"
                  />
                  <NumberInput
                    c={c}
                    field="loss"
                    label="Ambient loss (UA)"
                    unit="W/K"
                    step={0.1}
                  />
                  <p className="field-hint">
                    Initial temperature applies on Reset.
                  </p>
                </>
              ) : c.kind === "source" ? (
                <>
                  <NumberInput
                    c={c}
                    field="voltage"
                    label="Supply voltage"
                    unit="V"
                    step={1}
                  />
                  <NumberInput
                    c={c}
                    field="maxCurrent"
                    label="Current limit"
                    unit="A"
                    step={0.1}
                  />
                </>
              ) : c.kind === "ground" ? (
                <p className="field-hint">
                  This terminal defines a 0 V reference.
                </p>
              ) : (
                <>
                  {c.kind === "switch" && (
                    <div className="property-row">
                      <span>Switch state</span>
                      <button
                        className={`switch-control ${c.props.closed ? "on" : ""}`}
                        aria-label="Toggle switch"
                        aria-pressed={Boolean(c.props.closed)}
                        onClick={() => actions.toggle(c.id)}
                      >
                        <i />
                        {c.props.closed ? "Closed" : "Open"}
                      </button>
                    </div>
                  )}
                  <NumberInput
                    c={c}
                    field="resistance"
                    label="Resistance"
                    unit="Ω"
                    step={0.1}
                  />
                  {c.kind === "fuse" && (
                    <NumberInput
                      c={c}
                      field="ratedCurrent"
                      label="Rated current"
                      unit="A"
                    />
                  )}
                  <NumberInput
                    c={c}
                    field="ratedPower"
                    label="Power rating"
                    unit="W"
                  />
                  {c.kind === "heater" && (
                    <>
                      <NumberInput
                        c={c}
                        field="conductance"
                        label="Immersion (UA)"
                        unit="W/K"
                      />
                      <NumberInput
                        c={c}
                        field="heatCapacity"
                        label="Thermal capacity"
                        unit="J/K"
                      />
                      <NumberInput
                        c={c}
                        field="maxTemperature"
                        label="Temperature limit"
                        unit="°C"
                      />
                    </>
                  )}
                </>
              )}
            </div>
            {(isTank || c.kind === "heater") && (
              <div className="inspector-section">
                <div className="section-label">THERMAL INTERFACE</div>
                <div
                  className={`interface-status ${thermalConnected ? "connected" : ""}`}
                >
                  <Link2 size={15} />
                  <span>
                    {thermalConnected
                      ? "Immersion interface connected"
                      : "No thermal connection"}
                  </span>
                </div>
                <p className="field-hint">
                  {thermalConnected
                    ? "Heat transfers through the orange thermal connection."
                    : "Connect the orange ports of a heater and a tank."}
                </p>
              </div>
            )}
            {simulation.failed[c.id] && (
              <div className="component-warning">
                <AlertTriangle size={15} />
                Component failed open. Reset to replace it.
              </div>
            )}
          </>
        )}
      </div>
      <div className="inspector-footer">
        <span>Component cost</span>
        <strong>€{d.cost.toFixed(2)}</strong>
      </div>
    </aside>
  );
}
