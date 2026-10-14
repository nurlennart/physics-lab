/** Renewable devices expand into normal MNA branches. Iteration couples ports by measured electrical power. */
import { definitions, prop, type Component, type Project, type Terminal } from './model';
import type { ElectricalResult, ElectricalRuntime } from './electrical-core';
import { initialSolarState, inverterLoss, pvModel, solarKinds } from './solar';

type Solve = (p: Project, f: Record<string, boolean>, r: ElectricalRuntime) => ElectricalResult;
type Expansion = { project: Project; ids: Map<string, string[]>; map: (t: Terminal) => Terminal };
const cache = new WeakMap<Project, Expansion>();
function expand(p: Project): Expansion {
  const old = cache.get(p); if (old) return old;
  const ids = new Map<string, string[]>(), used = new Set(p.components.map(c => c.id));
  const components = p.components.flatMap((c): Component[] => {
    if (!solarKinds.includes(c.kind) || c.kind === 'lfpBattery') return [c.kind === 'lfpBattery' ? { ...c, kind: 'battery' } : c];
    const parts = Array.from({ length: c.kind === 'solarPanel' ? 1 : 2 }, (_, i) => {
      let id = `${c.id}#energy${i}`; while (used.has(id)) id += '#'; used.add(id); return id;
    }); ids.set(c.id, parts);
    return parts.map((id, i) => {
      const kind = c.kind === 'batteryProtection' ? i === 0 ? 'resistor' : 'junction' : c.kind === 'inverter' ? i === 0 ? 'resistor' : 'sourceAC' : 'source';
      return { ...c, id, kind, props: { ...definitions[kind].defaults, ...(kind === 'source' ? { mode: 'internal', voltage: 0, internalResistance: 0, enabled: true } : {}), ...(kind === 'sourceAC' ? { voltage: prop(c, 'voltage'), frequency: prop(c, 'frequency'), internalResistance: 0, enabled: true } : {}), ...(kind === 'resistor' ? { resistance: c.kind === 'batteryProtection' ? prop(c, 'resistance') : 1e9, tempCoefficient: 0, tolerance: 0 } : {}) } };
    });
  });
  const map = (t: Terminal): Terminal => {
    const parts = ids.get(t.component); if (!parts) return t;
    return { component: parts[t.port === 'oa' || t.port === 'ob' || t.port === 'reference' ? 1 : 0], port: t.port === 'oa' || t.port === 'reference' ? 'a' : t.port === 'ob' ? 'b' : t.port };
  };
  const e = { project: { ...p, components, connections: p.connections.filter(w => w.domain === 'electrical').map(w => ({ ...w, from: map(w.from), to: map(w.to) })) }, ids, map };
  cache.set(p, e); return e;
}
const modelCache = new WeakMap<Component, ReturnType<typeof pvModel>>();
export function panelModel(c: Component) { let m = modelCache.get(c); if (!m) { m = pvModel(c); modelCache.set(c, m); } return m; }
export function solveSolar(p: Project, failed: Record<string, boolean>, runtime: ElectricalRuntime, solve: Solve): ElectricalResult {
  const e = expand(p), units = p.components.filter(c => solarKinds.includes(c.kind));
  const chargingVoltage = (c: Component) => (states(c).absorption >= prop(c, 'absorptionTime') ? prop(c, 'floatVoltage') : prop(c, 'absorptionVoltage'));
  const states = (c: Component) => runtime.devices?.solar?.[c.id] ?? initialSolarState(c);
  const models = { ...runtime.sourceModels }, failures = { ...failed }, loads = { ...runtime.loadResistances };
  const targets: Record<string, number> = {};
  const volts: Record<string, number> = {}, demand: Record<string, number> = {}, inputLimits: Record<string, number> = {}, off = new Map<string, string>();
  const sense = (r: ElectricalResult, c: Component, a: string, b: string) => {
    const ka = e.map({ component: c.id, port: a }), kb = e.map({ component: c.id, port: b });
    const ak = `${ka.component}:${ka.port}`, bk = `${kb.component}:${kb.port}`;
    return r.nodeIslands?.[ak] === r.nodeIslands?.[bk] ? (r.nodes[ak] ?? 0) - (r.nodes[bk] ?? 0) : 0;
  };
  for (const c of units) {
    const parts = e.ids.get(c.id), st = states(c);
    if (c.kind === 'lfpBattery') continue;
    if (c.props.enabled === false || failed[c.id]) off.set(c.id, 'disabled');
    if ((runtime.temperatures?.[c.id] ?? 20) > prop(c, 'maxTemperature', Infinity)) off.set(c.id, 'overtemperature');
    if (c.kind === 'batteryProtection') {
      if (runtime.contacts?.[c.id] === false) off.set(c.id, 'remote disabled');
      // Overcurrent is latched until reset. Undervoltage recovers with hysteresis; the engine owns thermal failure latches.
      if (st.mode === 'overcurrent') off.set(c.id, 'overcurrent');
    }
    if (c.kind === 'solarPanel') volts[c.id] = panelModel(c).voc;
    if (c.kind === 'mpptController') { targets[c.id] = st.target; demand[c.id] = prop(c, 'maxCurrent'); inputLimits[c.id] = prop(c, 'maxInputCurrent'); }
    if (c.kind === 'inverter') { demand[c.id] = c.props.standby ? prop(c, 'standbyPower') : prop(c, 'idlePower'); if (st.mode === 'overload') off.set(c.id, 'overload'); }
    if (off.has(c.id)) parts?.forEach(id => failures[id] = true);
  }
  let boot = units.some(c => c.kind === 'mpptController' || c.kind === 'inverter');
  if (boot) for (const c of units.filter(c => c.kind === 'mpptController' || c.kind === 'inverter')) e.ids.get(c.id)!.forEach(id => failures[id] = true);
  let result: ElectricalResult | undefined, error = Infinity;
  for (let k = 0; k < 500; k++) {
    runtime.coupling?.prepare(result, models, failures);
    for (const c of units) {
      const parts = e.ids.get(c.id); if (!parts) continue;
      const st = states(c), [a, b] = parts;
      if (c.kind === 'solarPanel') {
        const m = panelModel(c), x = m.at(volts[c.id]), resistance = 1 / Math.max(1e-12, -x.slope);
        models[a] = { voltage: volts[c.id] + resistance * x.current, resistance, lower: -Infinity, upper: Infinity };
      }
      if (c.kind === 'mpptController') {
        models[a] = { voltage: Math.max(1, targets[c.id]), resistance: 0, lower: 0, upper: inputLimits[c.id] };
        const target = chargingVoltage(c);
        models[b] = { voltage: target, resistance: 0, lower: -demand[c.id], upper: 0 };
      }
      if (c.kind === 'inverter') {
        const v = result ? sense(result, c, 'a', 'b') : prop(c, 'restartVoltage');
        loads[a] = Math.max(1e-6, v * v / Math.max(1e-12, demand[c.id]));
        failures[b] = boot || off.has(c.id) || c.props.standby === true;
      }
    }
    try { result = solve(e.project, failures, { ...runtime, sourceModels: models, loadResistances: loads }); }
    catch (cause) { throw Error(`Solar iteration ${k}: ${(cause as Error).message}`); }
    for (const c of units.filter(c => c.kind === 'mpptController' || c.kind === 'inverter')) {
      const [a, b] = e.ids.get(c.id)!;
      if (result.readings[a]?.ac || (c.kind === 'mpptController' && result.readings[b]?.ac)) throw Error(`${c.name}: DC terminals cannot be connected to an AC network.`);
    }
    error = 0;
    const change = (record: Record<string, number>, key: string, next: number, scale = 1, damping = 0.5) => {
      error = Math.max(error, Math.abs(next - record[key]) / Math.max(scale, Math.abs(next)));
      record[key] += damping * (next - record[key]);
    };
    for (const c of units) {
      const parts = e.ids.get(c.id); if (!parts) continue;
      const [a, b] = parts, st = states(c), va = result.readings[a]?.voltage ?? 0;
      const turnOff = (mode: string) => { if (!off.has(c.id)) { off.set(c.id, mode); parts.forEach(id => failures[id] = true); error = 1; } };
      if (c.kind === 'solarPanel' && !off.has(c.id)) {
        const m = panelModel(c), real = m.at(va), current = result.readings[a].current;
        error = Math.max(error, Math.abs(current + real.current) / Math.max(1, m.isc));
        volts[c.id] += Math.max(-5, Math.min(5, va - volts[c.id]));
        if (result.readings[a].ac) throw Error(`${c.name}: PV requires a DC network.`);
      }
      if (c.kind === 'mpptController' && !boot && !off.has(c.id)) {
        const vb = sense(result, c, 'oa', 'ob'), pv = result.readings[a];
        if (va > prop(c, 'maxInputVoltage')) { turnOff('PV overvoltage'); continue; }
        if (vb < prop(c, 'minVoltage')) { turnOff('missing or low battery'); continue; }
        // Startup was checked at open circuit in preflight. Once enabled, charging raises
        // the bus voltage; the loaded converter uses its running headroom immediately.
        if (va < vb + prop(c, 'runningHeadroom')) { turnOff('insufficient PV voltage'); continue; }
        const eta = prop(c, 'conversionEfficiency') / 100;
        // Determine output demand with input curtailment released in the same tangent network.
        // Using curtailed input power here would lower both demand and input limit together,
        // turning a temporary Newton undershoot into a spurious lower-power solution.
        const released = pv.regulation === 'cc' ? solve(e.project, failures, { ...runtime, sourceModels: { ...models, [a]: { ...models[a], upper: prop(c, 'maxInputCurrent') } }, loadResistances: loads }) : result;
        const next = Math.min(prop(c, 'maxCurrent'), Math.max(0, released.readings[a].power * eta / vb));
        change(demand, c.id, next, 1);
        // Curtail input to actual regulated output when voltage or output current limits bind.
        const out = Math.max(0, -result.readings[b].power), cap = out / (eta * Math.max(1, va));
        const limitVoltage = chargingVoltage(c);
        const limited = vb >= limitVoltage - 1e-8 || result.readings[b].regulation === 'cv' || demand[c.id] > prop(c, 'maxCurrent') - 1e-8;
        const nextLimit = limited ? Math.min(prop(c, 'maxInputCurrent'), cap) : prop(c, 'maxInputCurrent');
        const current = inputLimits[c.id], residual = nextLimit - current;
        let updatedLimit = current + 0.5 * residual;
        // Near MPP, I = Pout/(η V(I)) has a derivative near one. The released-input
        // solve supplies the tangent network's dV/dI and dPout/dI, so a bounded Newton
        // step accelerates the same physical equation without relaxing its residual.
        const di = released.readings[a].current - pv.current;
        if (limited && pv.regulation === 'cc' && Math.abs(di) > 1e-12) {
          const dv = (released.readings[a].voltage - va) / di;
          const dp = (Math.max(0, -released.readings[b].power) - out) / di;
          const slope = (dp / va - out * dv / (va * va)) / eta - 1;
          const root = current - residual / slope;
          if (slope < -1e-6 && Number.isFinite(root) && root >= 0 && root <= prop(c, 'maxInputCurrent') && Math.abs(root - current) <= 0.1 * Math.max(1, current)) updatedLimit = current + 0.5 * (root - current);
        }
        // Convergence is still judged against the unaccelerated physical equation.
        error = Math.max(error, Math.abs(residual) / Math.max(1, Math.abs(nextLimit)));
        inputLimits[c.id] = updatedLimit;
      }
      if (c.kind === 'inverter' && !boot && !off.has(c.id)) {
        const v = sense(result, c, 'a', 'b');
        if (v < prop(c, st.running ? 'minVoltage' : 'restartVoltage') || v > prop(c, 'maxInputVoltage')) { turnOff('DC voltage lockout'); continue; }
        const out = Math.max(0, -result.readings[b].power), apparent = Math.hypot(out, result.readings[b].reactivePower ?? 0);
        if (out > prop(c, 'surgePower') || apparent > prop(c, 'surgePower') || (st.overload + 1e-10 >= prop(c, 'surgeTime') && (out > prop(c, 'ratedPower') || apparent > prop(c, 'ratedApparentPower')))) { turnOff('overload'); continue; }
        change(demand, c.id, c.props.standby ? prop(c, 'standbyPower') : out + inverterLoss(c, out, apparent), 1);
        error = Math.max(error, Math.abs(result.readings[a].power - demand[c.id]) / Math.max(1, demand[c.id]));
      }
      if (c.kind === 'batteryProtection' && !off.has(c.id)) {
        const v = sense(result, c, 'a', 'reference');
        if (v < prop(c, st.running ? 'disconnectVoltage' : 'restartVoltage')) turnOff('undervoltage');
        if (Math.abs(result.readings[a].current) > prop(c, 'ratedCurrent')) turnOff('overcurrent');
      }
    }
    if (error < 1e-10 && boot) {
      boot = false;
      for (const c of units.filter(c => c.kind === 'mpptController' || c.kind === 'inverter')) {
        const parts = e.ids.get(c.id)!, st = states(c), vin = sense(result, c, 'a', 'b'), vb = sense(result, c, 'oa', 'ob');
        if (c.kind === 'mpptController') {
          if (vb < prop(c, 'minVoltage')) off.set(c.id, 'missing or low battery');
          else if (vin > prop(c, 'maxInputVoltage')) off.set(c.id, 'PV overvoltage');
          else if (vin < vb + prop(c, st.running ? 'runningHeadroom' : 'startupHeadroom')) off.set(c.id, 'insufficient PV voltage');
          // An inhibited solve must not overwrite tracker memory with the dark/open-input voltage.
          // A restarting converter also needs startup headroom at its loaded target, not just at Voc.
          if (!off.has(c.id)) targets[c.id] = Math.min(vin, Math.max(vb + prop(c, st.running ? 'runningHeadroom' : 'startupHeadroom'), Math.min(st.target, vin * 0.98)));
        } else if (vin < prop(c, st.running ? 'minVoltage' : 'restartVoltage') || vin > prop(c, 'maxInputVoltage')) off.set(c.id, 'DC voltage lockout');
        parts.forEach(id => failures[id] = off.has(c.id));
      }
      continue;
    }
    if (runtime.coupling) {
      // Read-only measurement aliases for system-level controls in the shared iteration.
      // Energy accounting and final port remapping still happen once, after convergence.
      for (const c of units.filter(c => c.kind === 'mpptController')) {
        const [input, output] = e.ids.get(c.id)!;
        const island = result.nodeIslands?.[`${input}:a`];
        const mppPower = units.filter(pv => pv.kind === 'solarPanel' && result!.nodeIslands?.[`${e.ids.get(pv.id)![0]}:a`] === island).reduce((sum, pv) => sum + panelModel(pv).pmp, 0);
        result.readings[c.id] = { ...result.readings[input], solar: { inputPower: result.readings[input].power, outputPower: -result.readings[output].power, mode: 'iteration', running: !off.has(c.id), efficiency: prop(c, 'conversionEfficiency') / 100, mppPower, achievablePower: off.has(c.id) ? 0 : demand[c.id] * sense(result, c, 'oa', 'ob') } };
        for (const port of ['oa', 'ob']) if (result.nodeIds) result.nodeIds[`${c.id}:${port}`] = result.nodeIds[`${output}:${port === 'oa' ? 'a' : 'b'}`];
      }
      const tangent = (patch: Partial<ElectricalRuntime>) => solve(e.project, failures, { ...runtime, ...patch, coupling: undefined, sourceModels: { ...models, ...patch.sourceModels }, acInjections: { ...runtime.acInjections, ...patch.acInjections } });
      error = Math.max(error, runtime.coupling.residual(result, tangent));
    }
    if (error < 1e-10) break;
    if (k === 499) throw Error(`Solar electrical coupling did not converge (relative residual ${error}). Check converter settings and bus wiring.`);
  }
  const r = result!;
  const available = new Map<string, number>();
  for (const c of units.filter(c => c.kind === 'mpptController')) {
    const a = e.ids.get(c.id)![0], island = r.nodeIslands?.[`${a}:a`];
    available.set(c.id, units.filter(pv => pv.kind === 'solarPanel' && r.nodeIslands?.[`${e.ids.get(pv.id)![0]}:a`] === island).reduce((sum, pv) => sum + panelModel(pv).pmp, 0));
  }
  for (const c of units) {
    const parts = e.ids.get(c.id); if (!parts) continue;
    const [a, b] = parts, x = r.readings[a], y = b ? r.readings[b] : undefined, st = states(c);
    if (c.kind === 'solarPanel') {
      const m = panelModel(c), electrical = Math.max(0, -x.power), waste = m.irradiation + x.power;
      if (waste < -1e-6) throw Error(`${c.name}: electrical output exceeds incident sunlight; check panel area and ratings.`);
      r.sourcePower += m.irradiation + x.power;
      r.dissipatedPower += waste;
      // Optical rejection and module heat leave to the cell-temperature reservoir, an external boundary.
      x.solar = { inputPower: m.irradiation, outputPower: electrical, irradiation: m.irradiation, efficiency: m.irradiation > 0 ? electrical / m.irradiation : 0, mppPower: m.pmp, mppVoltage: m.vmp, mppCurrent: m.imp, mode: off.get(c.id) ?? (electrical > 0 ? 'generating' : 'open circuit'), running: electrical > 0 };
      x.heatPower = waste;
    } else if (c.kind === 'mpptController' || c.kind === 'inverter') {
      const input = Math.max(0, x.power), output = Math.max(0, -y!.power), heat = input - output;
      if (heat < -1e-6) throw Error(`${c.name}: converter output exceeds input.`);
      // Remove expanded artificial source delivery/load absorption; retain only physical conversion losses.
      if (c.kind === 'mpptController') r.sourcePower += x.power + y!.power;
      else { r.sourcePower += y!.power; r.dissipatedPower -= x.power; }
      r.dissipatedPower += heat;
      x.heatPower = heat; x.power = heat;
      x.solar = { inputPower: input, outputPower: output, efficiency: input > 1e-9 ? output / input : 0, mode: off.get(c.id) ?? (c.props.standby ? 'standby' : c.kind === 'inverter' ? 'inverting' : st.absorption >= prop(c, 'absorptionTime') ? 'float' : y!.voltage >= prop(c, 'absorptionVoltage') - 1e-8 ? 'absorption' : 'bulk'), running: !off.has(c.id) && !c.props.standby, apparentPower: y?.apparentPower ?? Math.hypot(output, y?.reactivePower ?? 0) };
      if (c.kind === 'mpptController') { x.solar.targetVoltage = targets[c.id]; x.solar.trackingActive = !off.has(c.id) && input > 1e-6 && Math.abs(x.voltage - targets[c.id]) < 1e-6 && Math.abs(y!.current) < prop(c, 'maxCurrent') - 1e-6 && y!.voltage < (chargingVoltage(c)) - 1e-6; x.solar.mppPower = available.get(c.id) ?? 0; x.solar.trackingEfficiency = x.solar.mppPower > 0 ? input / x.solar.mppPower : 0; }
      x.secondaryVoltage = y!.voltage; x.secondaryCurrent = Math.abs(y!.current);
    } else {
      x.heatPower = x.power;
      const inputPower = sense(r, c, 'a', 'reference') * x.current, outputPower = sense(r, c, 'b', 'reference') * x.current;
      x.solar = { inputPower, outputPower, efficiency: Math.max(Math.abs(inputPower), Math.abs(outputPower)) > 1e-9 ? Math.min(Math.abs(inputPower), Math.abs(outputPower)) / Math.max(Math.abs(inputPower), Math.abs(outputPower)) : 1, mode: off.get(c.id) ?? 'conducting', running: !off.has(c.id) };
    }
    r.readings[c.id] = x;
    for (const field of ['nodes', 'nodeIds', 'nodeIslands', 'phasors'] as const) {
      const values = r[field]; if (!values) continue;
      for (const port of definitions[c.kind].ports.filter(p => p.domain === 'electrical')) { const t = e.map({ component: c.id, port: port.id }); const key = `${t.component}:${t.port}`; if (key in values) (values as Record<string, unknown>)[`${c.id}:${port.id}`] = values[key]; }
      parts.forEach(id => { delete values[`${id}:a`]; delete values[`${id}:b`]; });
    }
    parts.forEach(id => delete r.readings[id]);
  }
  r.powerResidual = r.sourcePower - r.dissipatedPower - (r.storedPower ?? 0);
  return r;
}
