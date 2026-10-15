import { effectiveAmbient } from "../simulation/environment";
import { trvSetpoint } from "../simulation/thermostatic-valve";
import { compatibleTarget, temperatureLabel } from "../simulation/capabilities";
import { useEffect, useState } from "react";
import { Lock, RotateCcw, Save, Info, Gauge } from "lucide-react";
import { actions, simulation, useLab } from "../editor/store";
import { catalog, componentCost, definitions, isMotor, projectAmbient, prop, type Component, type Kind, type Project, type Property } from "../simulation/model";
import { editPolicy } from "../simulation/integrity";
import { derivedReadouts, paramSpec, type ParamGroup, type ParamSpec } from "../simulation/parameters";
import { builtinPresets } from "../simulation/presets";
import { sourceLimit, sourceMode } from "../simulation/electrical";
import { pumpRatingReadouts } from "../simulation/hydraulic";
import { circulatorRatingReadouts, circulatorReferences } from "../simulation/circulator";
import { formatEngineering, parseEngineering } from "../editor/engineering";

const groupTitles: Record<ParamGroup, string> = {
  operating: "Operating controls",
  configuration: "Configuration",
  ratings: "Ratings & protection",
  thermal: "Thermal properties",
  initial: "Initial state",
  advanced: "Advanced model",
};
const groupOrder: ParamGroup[] = ["operating", "configuration", "ratings", "thermal", "initial", "advanced"];
const challengeEnvironment = (c: Component, field: string) =>
  (c.kind === "tank" && ["volume", "capacity", "elevation", "surfaceArea", "initialTemperature", "ambient"].includes(field)) ||
  (c.kind === "cooler" && field === "ambient") ||
  (c.kind === "safety" && field === "failOnSensor");
/** Why a field cannot be edited right now, or null. */
export function lockReason(c: Component, field: string, project: Project, busy: boolean): string | null {
  const spec = paramSpec(c.kind, field), policy = editPolicy(c, field, project.challenge);
  if (busy) return "Simulation is advancing.";
  if (policy === "derived") return `Calculated from ${(spec?.derivedFrom ?? []).map((k) => paramSpec(c.kind, k)?.label ?? k).join(", ")}.`;
  if (policy === "fixed") return spec?.limitReason ?? spec?.description ?? "Constant of the implemented model.";
  if (policy === "catalog") return "Scored challenge: defined by the purchased catalog model. Choose a catalog variant instead.";
  if (project.challenge && (["ambient", "ambientMode"].includes(field) || challengeEnvironment(c, field))) return "Locked by the assignment.";
  if (simulation.time > 0 && policy === "reset") return "Defines stored energy, mass or the initial state — reset the experiment to edit.";
  // Full project validation runs when a value is committed; rendering only needs the policy.
  return null;
}
function displayed(spec: ParamSpec | undefined, value: number) {
  return spec?.display ? value * spec.display.scale : value;
}
export function EngineeringInput({ c, field, disabled, spec }: { c: Component; field: string; disabled: boolean; spec?: ParamSpec }) {
  const value = prop(c, field), shown = displayed(spec, value);
  const [draft, setDraft] = useState(formatEngineering(shown));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setDraft(formatEngineering(shown)); setError(null); }, [shown, c.id]);
  const commit = () => {
    const parsed = parseEngineering(draft);
    if (parsed === null) { setError("Enter a number, e.g. 30k, 4.7M, 2.5e-3."); setDraft(formatEngineering(shown)); return; }
    const stored = spec?.display ? parsed / spec.display.scale : parsed;
    if (Math.abs(stored - value) <= 1e-12 * Math.max(1, Math.abs(value))) return;
    actions.property(c.id, field, stored);
  };
  return (
    <span className={`number-field engineering ${error ? "has-error" : ""}`} title={error ?? undefined}>
      <input
        aria-label={spec?.label ?? field}
        inputMode="decimal"
        disabled={disabled}
        value={draft}
        onChange={(e) => { setDraft(e.target.value); setError(null); }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") { setDraft(formatEngineering(shown)); e.currentTarget.blur(); }
        }}
      />
      <span>{spec?.display?.unit ?? spec?.unit ?? ""}</span>
    </span>
  );
}
function TextInput({ c, field, value, label, disabled }: { c: Component; field: string; value: string; label: string; disabled: boolean }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value, c.id]);
  return (
    <input
      className="text-parameter"
      aria-label={label}
      disabled={disabled}
      value={draft}
      placeholder="empty = model default"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && actions.property(c.id, field, draft.trim())}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />
  );
}
function tooltip(c: Component, spec: ParamSpec | undefined, policy: string) {
  if (!spec) return undefined;
  const d = spec.domain;
  const policyText = policy === "live" ? "Editable while running." : policy === "reset" ? "Editable before the run (defines stored energy or initial state)." : policy === "derived" ? "Calculated." : policy === "catalog" ? "Catalog-defined in this challenge." : "Model constant.";
  return [
    spec.description,
    d ? `Valid domain: ${spec.positive ? ">" : "≥"} ${formatEngineering(displayed(spec, d[0]))} … ${formatEngineering(displayed(spec, d[1]))} ${spec.display?.unit ?? spec.unit ?? ""}.` : "",
    spec.typical ? `Typical: ${formatEngineering(displayed(spec, spec.typical[0]))} … ${formatEngineering(displayed(spec, spec.typical[1]))}.` : "",
    spec.simulated === false ? "Informational only — not used by the solver." : "",
    policyText,
    `Default (${catalog(c).label}): ${String(catalog(c).props[spec.key])}`,
  ].filter(Boolean).join("\n");
}
function Field({ c, field, value, s }: { c: Component; field: string; value: Property; s: ReturnType<typeof useLab> }) {
  const spec = paramSpec(c.kind, field), policy = editPolicy(c, field, s.project.challenge);
  const reason = lockReason(c, field, s.project, s.busy), disabled = !!reason;
  const label = spec?.label ?? field;
  const typical = typeof value === "number" && spec?.typical && (value < spec.typical[0] || value > spec.typical[1]);
  let control;
  if (field === 'batteryTarget' || field === 'gridMeterTarget') {
    control = <select aria-label={label} disabled={disabled} value={String(value)} onChange={e => actions.property(c.id, field, e.target.value)}><option value="">Unassigned</option>{s.project.components.filter(x => field === 'batteryTarget' ? x.kind === 'battery' || x.kind === 'lfpBattery' : x.kind === 'gridMeter').map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select>;
  } else if (field === "target") {
    const physical = ["pressureSensor", "flowSensor", "levelSensor", "positionSensor", "speedSensor", "forceActuator"].includes(c.kind);
    control = (
      <select aria-label={physical ? "Physical target" : "Thermal target"} disabled={disabled} value={String(value)} onChange={(e) => actions.property(c.id, field, e.target.value)}>
        <option value="">Unassigned</option>
        {["sensor", "thermostat", "safety"].includes(c.kind) && c.props.quantity !== "fluidTemperature" && (s.project.thermalSpaces ?? []).map(r => <option key={r.id} value={r.id}>{r.name} · room air temperature</option>)}
        {s.project.components.filter((x) => compatibleTarget(c, x)).map((x) => (
          <option key={x.id} value={x.id}>{x.name} · {definitions[x.kind].label}{["sensor", "thermostat", "safety"].includes(c.kind) ? ` · ${c.props.quantity === "fluidTemperature" ? "fluid temperature" : temperatureLabel(x)}` : ""}</option>
        ))}
      </select>
    );
  } else if (field === "axis")
    control = <select aria-label="Physical axis" disabled={disabled} value={String(value)} onChange={(e) => actions.property(c.id, field, e.target.value)}>{(c.kind === "forceActuator" ? ["x", "y", "torque"] : ["x", "y"]).map((axis) => <option key={axis} value={axis}>{axis}</option>)}</select>;
  else if (typeof value === "string" && !spec?.options)
    control = <TextInput c={c} field={field} value={value} label={label} disabled={disabled} />;
  else if (typeof value === "string")
    control = (
      <select aria-label={field === "mode" && c.kind !== "source" ? "Controller mode" : label} disabled={disabled} value={value} onChange={(e) => actions.property(c.id, field, e.target.value)}>
        {(spec?.options ?? [{ value, label: value }]).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  else if (typeof value === "boolean")
    control = (
      <button disabled={disabled} className={`switch-control ${value ? "on" : ""}`} aria-label={c.kind === "switch" && field === "closed" ? "Toggle switch" : label} aria-pressed={value} onClick={() => actions.property(c.id, field, !value)}>
        <i />{value ? "On" : "Off"}
      </button>
    );
  else control = <EngineeringInput c={c} field={field} disabled={disabled} spec={spec} />;
  return (
    <div className={`property-row ${policy === "derived" ? "derived" : ""}`}>
      <span className="property-label" title={tooltip(c, spec, policy)}>
        {label}
        {policy === "derived" && <em className="param-badge">calc</em>}
        {spec?.simulated === false && <em className="param-badge info">info</em>}
        {reason && policy !== "derived" && <Lock size={10} aria-label={reason} />}
      </span>
      {control}
      {field === "target" && <span className="field-hint">Only targets with a modeled quantity are selectable. Unassigned targets and unavailable states produce invalid signals. Pumps and valves expose fluid temperature; their body temperature is not modeled.</span>}
      {reason && policy !== "derived" && policy !== "fixed" && !s.busy && <span className="lock-reason">{reason}</span>}
      {typical && !reason && <span className="lock-reason hint">Outside the typical {formatEngineering(displayed(spec, spec!.typical![0]))}–{formatEngineering(displayed(spec, spec!.typical![1]))} {spec!.display?.unit ?? spec!.unit} range — allowed.</span>}
    </div>
  );
}
export function ParameterSections({ c }: { c: Component }) {
  const s = useLab();
  const fields = Object.entries(c.props).filter(([k]) => k !== "ambient" || c.props.ambientMode === "override");
  const grouped = groupOrder.map((g) => [g, fields.filter(([k]) => (paramSpec(c.kind, k)?.group ?? "advanced") === g)] as const).filter(([, list]) => list.length);
  return (
    <>
      {c.kind === 'thermostaticValve' && <p className="field-hint">Dial {prop(c, 'dial') === 0 ? '❄' : prop(c, 'dial')} ≈ {trvSetpoint(c)} °C · closes at {trvSetpoint(c) + 2} °C. Sensed air: {(simulation.multiphysics.trvSensors[c.id] ?? effectiveAmbient(s.project, c)).toFixed(2)} °C. Effective opening reports Kv/Kvs, not stem travel. Retain a bypass or another open circuit for circulation.</p>}
      {grouped.map(([group, list]) => (
        <details className="inspector-section param-group" key={group} open={group !== "advanced"}>
          <summary className="section-label">{groupTitles[group]}</summary>
          {list.map(([field, value]) => <Field key={field} c={c} field={field} value={value} s={s} />)}
          {group === "thermal" && "ambientMode" in c.props && <p className="field-hint">Effective ambient: {formatEngineering(effectiveAmbient(s.project, c))} °C · {c.props.ambientMode === "override" ? "local override" : c.thermalSpaceId ? "assigned Thermal Space" : "experiment environment"}. Initial temperatures and temperature setpoints are separate parameters.</p>}
        </details>
      ))}
    </>
  );
}
export function DerivedValues({ c }: { c: Component }) {
  const rows = [...derivedReadouts(c), ...(c.kind === "pump" ? pumpRatingReadouts(c) : []), ...(c.kind === "circulator" ? circulatorRatingReadouts(c) : [])];
  if (!rows.length) return null;
  return (
    <div className="inspector-section">
      <div className="section-label"><span>Calculated from configuration</span><Info size={12} /></div>
      <div className="measurement-list derived-list">
        {rows.map((r) => (
          <div key={r.label} title={r.note}>
            <span>{r.label}</span>
            <strong>{formatEngineering(r.value, 4)} <small>{r.unit}</small></strong>
          </div>
        ))}
      </div>
      {c.kind === "heater" && prop(c, "ratedPower") / prop(c, "conductance") + 20 > prop(c, "maxTemperature") && (
        <p className="field-hint warn">At nominal power the element runs {formatEngineering(prop(c, "ratedPower") / prop(c, "conductance"), 3)} K above the water and would exceed its {prop(c, "maxTemperature")} °C limit (burn-out). Increase the immersion conductance and element mass with the rating, or apply a matching preset.</p>
      )}
      {c.kind === "circulator" && (
        <p className="field-hint" data-testid="eei-note">The EEI (Reg. (EC) 641/2009) is a regulatory index: the input power averaged over a fixed load profile (100/75/50/25 % flow for 6/15/35/44 % of the time, on a reference control curve) relative to a reference power for the pump's size. It is not an efficiency, and a low EEI does not mean a high efficiency at every operating point; the wire-to-water efficiency above applies to the best point only. Here it is calculated from this model's curves{circulatorReferences[c.variant ?? "standard"]?.data.includes("EEI") ? "; compare the reference pump's declared value in the model basis above" : ""}.</p>
      )}
      <p className="field-hint">Nominal design values. Live measurements above show actual operation in the solved circuit.</p>
    </div>
  );
}
function Bar({ label, actual, rated, unit }: { label: string; actual: number; rated: number; unit: string }) {
  if (!Number.isFinite(rated) || rated <= 0) return null;
  const ratio = Math.abs(actual) / rated;
  return (
    <div className={`rating-bar ${ratio > 1.001 ? "over" : ratio > 0.9 ? "near" : ""}`}>
      <div><span>{label}</span><strong>{formatEngineering(Math.abs(actual), 4)} / {formatEngineering(rated, 4)} {unit}</strong></div>
      <i><b style={{ width: `${Math.min(100, ratio * 100)}%` }} /></i>
    </div>
  );
}
/** Actual operation relative to ratings. Ratings are limits, not controls. */
export function RatingIndicators({ c }: { c: Component }) {
  useLab();
  // Before the first Run there is no operation to compare with ratings; temperatures and pressures still are.
  const original = simulation.time > 0 ? simulation.electrical.readings[c.id] : undefined, r = c.kind === "electricBoiler" && original ? { ...original, current: Math.max(0, ...(original.stageCurrents ?? [])) } : original, h = simulation.multiphysics.hydraulic.readings[c.id], t = c.kind === "electricBoiler" ? simulation.fluidTemperatureMeasurement(c.id) : simulation.temperatures[c.id];
  const bars = [];
  if ((c.kind === "source3" || c.kind === "sourceAC") && r) {
    bars.push(<Bar key="i" label="Line current" actual={r.current} rated={prop(c, "maxCurrent")} unit="A" />);
    bars.push(<Bar key="p" label="Apparent power" actual={Math.hypot(r.power, r.reactivePower ?? 0)} rated={prop(c, "maxPower", Infinity)} unit="VA" />);
  } else if (c.kind === "source" && r) {
    bars.push(<Bar key="i" label="Output current" actual={r.current} rated={sourceMode(c) === "cc" ? prop(c, "current") : prop(c, "maxCurrent")} unit="A" />);
    bars.push(<Bar key="p" label="Output power" actual={r.power} rated={prop(c, "maxPower", Infinity)} unit="W" />);
  } else if (c.kind === "vfd" && r) {
    const d = r.drive;
    bars.push(<Bar key="i" label="Output current" actual={d?.outputCurrent ?? 0} rated={prop(c, "ratedOutputCurrent")} unit="A" />);
    bars.push(<Bar key="p" label="Output power" actual={Math.max(0, d?.outputPower ?? 0)} rated={prop(c, "ratedPower")} unit="W" />);
    bars.push(<Bar key="v" label="Input line voltage RMS" actual={r.voltage * Math.sqrt(3)} rated={prop(c, "ratedVoltage")} unit="V" />);
  } else if (r) {
    if ("ratedPower" in c.props) bars.push(<Bar key="p" label={isMotor(c) ? "Shaft power" : c.kind === "heater" ? "Power vs nominal" : "Power"} actual={isMotor(c) ? simulation.multiphysics.motors[c.id]?.shaftPower ?? 0 : r.power} rated={prop(c, "ratedPower")} unit="W" />);
    if ("ratedCurrent" in c.props) bars.push(<Bar key="i" label="Current" actual={r.contactCurrent ?? r.current} rated={prop(c, "ratedCurrent")} unit="A" />);
    if ("ratedVoltage" in c.props && c.kind !== "heater" && c.kind !== "motor") bars.push(<Bar key="v" label={c.kind === "inductionMotor" ? "Line voltage RMS" : c.kind === "starDeltaStarter" || c.kind === "softStarter" ? "Voltage across a pole" : "Voltage"} actual={c.kind === "inductionMotor" && r.phases === 3 ? r.voltage * Math.sqrt(3) : r.voltage} rated={prop(c, "ratedVoltage")} unit="V" />);
  }
  if (t !== undefined && "maxTemperature" in c.props)
    bars.push(<Bar key="t" label="Temperature rise" actual={t - effectiveAmbient(simulation.project, c)} rated={prop(c, "maxTemperature") - effectiveAmbient(simulation.project, c)} unit="K" />);
  if (h && "maxPressure" in c.props) bars.push(<Bar key="pr" label="Pressure" actual={Math.max(h.pressure, h.inletPressure) / 1e5} rated={prop(c, "maxPressure") / 1e5} unit="bar" />);
  if (!bars.some(Boolean)) return null;
  return (
    <div className="inspector-section">
      <div className="section-label">
        <span><Gauge size={11} /> Operation vs ratings</span>
        {c.kind === "source" && r && sourceLimit(c) < Infinity && <span className={r.regulation === "cc" ? "invalid-badge" : "live-badge"}>{r.regulation === "cc" ? "CC · CURRENT LIMIT" : "CV · VOLTAGE REGULATION"}</span>}
      </div>
      {bars}
      {r?.phases === 3 && <p className="field-hint">Three-phase island (balanced per-phase model): voltage {formatEngineering(Math.abs(r.voltage), 4)} V is phase-to-neutral ({formatEngineering(Math.abs(r.voltage) * Math.sqrt(3), 4)} V line), current is the line current, power is the three-phase total.</p>}
      {c.kind === "heater" && r && <p className="field-hint">Actual power = V²/R of the solved circuit ({formatEngineering(r.resistance ?? prop(c, "resistance"), 4)} Ω). Nominal power is reached only at the nominal voltage.</p>}
      {simulation.tripped[c.id] && <p className="field-hint warn">{simulation.tripped[c.id]}</p>}
    </div>
  );
}
export function ModelAndPresets({ c }: { c: Component }) {
  const s = useLab(), d = definitions[c.kind], model = catalog(c), cost = componentCost(c);
  const [name, setName] = useState(""), [renaming, setRenaming] = useState(false);
  const presets = [...builtinPresets, ...s.presets].filter((p) => p.kind === c.kind);
  const userPreset = s.presets.find((p) => p.kind === c.kind && p.name === c.preset);
  const families = [...new Set(presets.map((p) => p.family))];
  const locked = simulation.time > 0 || s.busy;
  return (
    <div className="inspector-section">
      <div className="section-label"><span>Model & presets</span>{cost.estimated && <span className="invalid-badge">Custom</span>}</div>
      <select className="wide-select" aria-label="Component variant" value={c.variant ?? "standard"} disabled={locked} onChange={(e) => actions.variant(c.id, e.target.value)}>
        <option value="standard">Standard · €{d.cost}</option>
        {d.variants?.map((x) => <option key={x.id} value={x.id}>{x.label} · €{x.cost}</option>)}
      </select>
      {presets.length > 0 && (
        <select className="wide-select preset-select" aria-label="Apply component preset" value="" disabled={locked} onChange={(e) => e.target.value && actions.applyPreset(c.id, e.target.value)}>
          <option value="">{c.preset ? `Preset: ${c.preset}` : "Apply engineering preset…"}</option>
          {families.map((f) => (
            <optgroup key={f} label={f}>
              {presets.filter((p) => p.family === f).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </optgroup>
          ))}
        </select>
      )}
      <p className="field-hint">
        {model.spec}. {s.project.challenge ? "Scored challenge: ratings come from the purchased catalog model; custom presets are rejected." : "Sandbox: every implemented parameter is configurable. Catalog models and presets are starting points, not restrictions."}
      </p>
      {!s.project.challenge && (
        <div className="preset-actions">
          <form onSubmit={(e) => { e.preventDefault(); if (renaming && userPreset) actions.renamePreset(userPreset.id, name); else actions.savePreset(c.id, name); setName(""); setRenaming(false); }}>
            <input aria-label="Preset name" placeholder={renaming ? "New preset name" : "Preset name"} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
            <button disabled={!name.trim()} title={renaming ? "Rename preset" : "Save the current configuration as a reusable preset"}><Save size={12} />{renaming ? "Rename" : "Save as preset"}</button>
          </form>
          <div>
            <button disabled={locked} onClick={() => actions.resetDefaults(c.id)} title="Restore the catalog values of all configuration parameters"><RotateCcw size={12} />Reset to defaults</button>
            {userPreset && <button onClick={() => { setRenaming(!renaming); setName(userPreset.name); }}>Rename preset</button>}
            {userPreset && <button onClick={() => actions.deletePreset(userPreset.id)}>Delete preset</button>}
          </div>
        </div>
      )}
    </div>
  );
}
export function EnvironmentPanel() {
  const s = useLab(), ambient = projectAmbient(s.project);
  const [draft, setDraft] = useState(String(ambient));
  useEffect(() => setDraft(String(ambient)), [ambient]);
  return (
    <div className="inspector-section environment-panel">
      <div className="section-label"><span>Experiment environment</span><span className="live-badge">{s.project.challenge ? "CHALLENGE" : "SANDBOX"}</span></div>
      <div className="property-row">
        <span className="property-label" title="Ambient boundary inherited by every component unless a local override is selected. Bodies without an initial-temperature parameter start at their resolved ambient; explicit initial temperatures and setpoints are independent.">Laboratory ambient</span>
        <span className="number-field">
          <input aria-label="Laboratory ambient temperature" inputMode="decimal" disabled={!!s.project.challenge || s.busy} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => { const v = parseEngineering(draft); if (v === null || v === ambient) setDraft(String(ambient)); else actions.environment(v); }} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
          <span>°C</span>
        </span>
      </div>
      <p className="field-hint">
        {s.project.challenge
          ? "Assignment conditions are fixed by the challenge."
          : "Free Sandbox: constraints come from the implemented physics and numerical validity domains, not from budgets. Out-of-rating operation is allowed and reported."}
      </p>
    </div>
  );
}
export const kindHasParameters = (kind: Kind) => Object.keys(definitions[kind].defaults).length > 0;
