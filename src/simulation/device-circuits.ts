import { solveHybrid } from './hybrid-circuits';
import { hybridKinds } from './hybrid';
/** New multi-circuit devices expand into ordinary MNA branches; state stays in the engine. */
import { solveSolar } from './solar-circuits';
import { solarKinds } from './solar';
import { definitions, prop, type Component, type Project } from './model';
import { solveElectricalCore, type ElectricalResult, type ElectricalRuntime } from './electrical-core';
import { batteryAverageOCV, batteryChargeStep, batteryEnergy, batteryEnergyChange, batteryOCV, batteryResistanceFactor, polarizationBranch, selfDischargeCurrent } from './devices';

type Expansion = { project: Project; coils: Map<string, string>; boilers: Map<string, string[]> };
const cache = new WeakMap<Project, Expansion>();
const special = (c: Component) => ['battery', 'contactor', 'radiator', 'circulator', 'electricBoiler'].includes(c.kind);
function expand(project: Project): Expansion {
  const cached = cache.get(project);
  if (cached) return cached;
  const ids = new Set(project.components.map(c => c.id)), coils = new Map<string, string>();
  for (const c of project.components.filter(c => c.kind === "contactor")) {
    let id = `${c.id}#coil`;
    while (ids.has(id)) id += "#";
    ids.add(id); coils.set(c.id, id);
  }
  const boilers = new Map<string, string[]>();
  for (const c of project.components.filter(c => c.kind === 'electricBoiler')) {
    boilers.set(c.id, Array.from({ length: 5 }, (_, i) => {
      let id = `${c.id}#boiler${i}`;
      while (ids.has(id)) id += '#';
      ids.add(id); return id;
    }));
  }
  const components = project.components.flatMap((c): Component[] => {
    if (c.kind === 'electricBoiler') return boilers.get(c.id)!.map((id, i) => i === 4
      ? { ...c, id, kind: 'junction', props: {} }
      : { ...c, id, kind: 'resistor', props: { ...definitions.resistor.defaults, resistance: prop(c, 'ratedVoltage') ** 2 / (i === 3 ? prop(c, 'standbyPower') : prop(c, 'ratedPower') / 3), tempCoefficient: 0, tolerance: 0 } });
    if (c.kind === 'battery') return [{ ...c, kind: 'source', props: { ...definitions.source.defaults, mode: 'internal', voltage: prop(c, 'emptyVoltage') + (prop(c, 'fullVoltage') - prop(c, 'emptyVoltage')) * prop(c, 'initialSOC') / 100, internalResistance: prop(c, 'internalResistance'), enabled: c.props.enabled } }];
    if (c.kind === 'contactor') return [
      { ...c, kind: 'switch', props: { ...definitions.switch.defaults, closed: true, resistance: prop(c, 'resistance') } },
      { ...c, id: coils.get(c.id)!, kind: 'resistor', props: { ...definitions.resistor.defaults, resistance: prop(c, 'coilResistance') } },
    ];
    if (c.kind === 'radiator') return [{ ...c, kind: 'resistor', props: { ...definitions.resistor.defaults, resistance: prop(c, 'ratedVoltage') ** 2 / prop(c, 'fanRatedPower') } }];
    // A circulator's electronics are a constant-power load: its resistance is set per solve (loadResistances).
    if (c.kind === 'circulator') return [{ ...c, kind: 'resistor', props: { ...definitions.resistor.defaults, resistance: prop(c, 'ratedVoltage') ** 2 / prop(c, 'ratedPower'), tempCoefficient: 0, tolerance: 0 } }];
    return [c];
  });
  const map = (t: { component: string; port: string }) => boilers.has(t.component) && ['L1', 'L2', 'L3', 'N', 'PE'].includes(t.port) ? { component: boilers.get(t.component)![t.port === 'PE' ? 4 : t.port === 'N' ? 0 : Number(t.port.slice(1)) - 1], port: t.port === 'N' ? 'b' : 'a' } : t.port === 'ca' || t.port === 'cb' ? { component: coils.get(t.component)!, port: t.port === 'ca' ? 'a' : 'b' } : t;
  const expanded = { ...project, components, connections: project.connections.map(w => ({ ...w, from: map(w.from), to: map(w.to) })) };
  for (const ids of boilers.values()) for (const i of [1, 2, 3]) expanded.connections.push({ id: `${ids[i]}#neutral`, domain: 'electrical', from: { component: ids[0], port: 'b' }, to: { component: ids[i], port: 'b' } });
  for (const ids of boilers.values()) expanded.connections.push({ id: `${ids[3]}#live`, domain: 'electrical', from: { component: ids[0], port: 'a' }, to: { component: ids[3], port: 'a' } });
  const expansion = { project: expanded, coils, boilers };
  cache.set(project, expansion);
  return expansion;
}
/**
 * Electric circulators draw a regulated input power P from their terminals: the electronics behave as a constant-power
 * load, solved as a resistance R = V²/P iterated to a fixed point (in phase with the voltage on AC). The iteration
 * contracts with factor 2·R_s/(R + R_s) for a source resistance R_s, i.e. whenever the terminal voltage stays above half
 * the open-circuit voltage; the undervoltage lockout lies well above that. A unit whose terminal voltage settles below its
 * lockout, collapses, or does not converge cannot be supplied: its electronics switch off (open) and the reading is
 * flagged `undervoltage`, so the engine plans the substep with the pump unpowered.
 */
function solveConstantPower(project: Project, expanded: Project, failures: Record<string, boolean>, runtime: ElectricalRuntime): ElectricalResult {
  const units = project.components.filter(c => c.kind === 'circulator');
  const demand = (c: Component) => runtime.circulators?.[c.id] ?? 0;
  for (const c of units) if (!(demand(c) > 0)) failures[c.id] = true;
  const loads: Record<string, number> = { ...runtime.loadResistances }, undervoltage = new Set<string>();
  for (const c of units) if (!failures[c.id]) loads[c.id] = prop(c, 'ratedVoltage') ** 2 / demand(c);
  const off = (c: Component) => { undervoltage.add(c.id); failures[c.id] = true; delete loads[c.id]; };
  let result = solveElectricalCore(expanded, failures, { ...runtime, loadResistances: loads });
  for (let k = 0; units.some(c => loads[c.id] !== undefined); k++) {
    let change = 0, dropped = false;
    for (const c of units.filter(c => loads[c.id] !== undefined)) {
      const r = result.readings[c.id], v = Math.abs(r?.voltage ?? 0);
      if (r?.phases === 3) throw Error(`${c.name}: a single-phase circulator cannot sit in a balanced three-phase network; supply it from a single-phase AC or DC source.`);
      // Collapse below half the lockout cannot recover; the lockout itself is checked on the converged voltage.
      if (r?.voltageValid === false || v < 0.5 * prop(c, 'minVoltage') || !(v > 0)) { off(c); dropped = true; continue; }
      const next = v * v / demand(c);
      change = Math.max(change, Math.abs(next - loads[c.id]) / loads[c.id]);
      loads[c.id] = next;
    }
    if (!dropped && change < 1e-12) {
      const low = units.filter(c => loads[c.id] !== undefined && Math.abs(result.readings[c.id].voltage) < prop(c, 'minVoltage'));
      if (!low.length) break;
      low.forEach(off);
    } else if (k >= 200) units.filter(c => loads[c.id] !== undefined).forEach(off);
    result = solveElectricalCore(expanded, failures, { ...runtime, loadResistances: loads });
  }
  for (const id of undervoltage) if (result.readings[id]) result.readings[id].undervoltage = true;
  return result;
}
function solveDevices(project: Project, failed: Record<string, boolean> = {}, runtime: ElectricalRuntime = {}): ElectricalResult {
  if (!project.components.some(special)) return solveElectricalCore(project, failed, runtime);
  const expanded = expand(project);
  const failures = { ...failed }, models = { ...runtime.sourceModels };
  for (const c of project.components) {
    if (c.kind === 'battery') {
      if (c.props.cells && runtime.devices?.solar?.[c.id]?.mode === 'overcurrent') failures[c.id] = true;
      // Midpoint OCV over the step: E(s₀) behind (dE/ds)·h/(2Q); the polarization branch as its exact step average.
      const soc = runtime.devices?.batteries[c.id] ?? prop(c, 'initialSOC') / 100, h = runtime.devices?.h ?? 0, charge = 3600 * prop(c, 'capacityAh'), ocv = batteryOCV(c, soc);
      const temperature = runtime.temperatures?.[c.id] ?? 20, branch = polarizationBranch(c, temperature, h), vp = runtime.devices?.polarization?.[c.id] ?? 0;
      const average = c.props.cells ? batteryAverageOCV(c, soc, 0, h) : null;
      models[c.id] = {
        voltage: (average?.voltage ?? ocv.voltage) + (branch ? branch.emfWeight * vp : 0),
        resistance: prop(c, 'internalResistance') * batteryResistanceFactor(c, temperature) + (average?.resistance ?? ocv.slope * h / (2 * charge)) + (branch?.seriesResistance ?? 0),
        // A full battery accepts only the trickle that offsets its self-discharge (an ideal charge termination).
        lower: soc <= 1e-14 || (c.props.cells && (temperature < prop(c, 'minDischargeTemperature') || temperature > prop(c, 'maxTemperature') || ocv.voltage <= prop(c, 'bmsLowVoltage'))) ? 0 : c.props.cells ? -prop(c, 'dischargeCurrentLimit') : -Infinity,
        upper: soc >= 1 - 1e-14 ? selfDischargeCurrent(c) * 100 / prop(c, 'coulombicEfficiency') : c.props.cells ? temperature < prop(c, 'minChargeTemperature') || temperature > prop(c, 'maxTemperature') || ocv.voltage >= prop(c, 'bmsHighVoltage') ? 0 : prop(c, 'chargeCurrentLimit') : Infinity,
      };
    }
    if (c.kind === 'contactor') {
      failures[expanded.coils.get(c.id)!] = !!failed[c.id] || runtime.faults?.[c.id] === "failedOpen";
      failures[c.id] = !!failed[c.id] || (runtime.faults?.[c.id] !== 'stuckClosed' && (runtime.faults?.[c.id] === 'stuckOpen' || !runtime.devices?.contactors[c.id]?.closed));
    }
    if (c.kind === 'radiator' && runtime.faults?.[c.id] === 'coolingFailed') failures[c.id] = true;
  }
  for (const c of project.components.filter(c => c.kind === 'electricBoiler')) {
    const ids = expanded.boilers.get(c.id)!;
    for (let i = 0; i < 4; i++) failures[ids[i]] = !!failed[c.id] || runtime.boilerTrips?.has(c.id) || runtime.faults?.[c.id] === 'failedOpen' || (i < 3 && i >= (runtime.boilers?.[c.id] ?? 0));
  }
  const solveBatteryNetwork = () => {
    let r = solveConstantPower(project, expanded.project, failures, { ...runtime, sourceModels: models });
    const packs = project.components.filter(c => c.kind === 'battery' && c.props.cells);
    for (let iteration = 0; packs.length && iteration < 24; iteration++) {
      let residual = 0;
      for (const c of packs) {
        const x = r.readings[c.id]; if (!x || failures[c.id] || x.voltageValid === false || models[c.id].lower === 0 && models[c.id].upper === 0 || x.regulation === 'cc') continue;
        const soc = runtime.devices?.batteries[c.id] ?? prop(c, 'initialSOC') / 100, h = runtime.devices?.h ?? 0;
        const avg = batteryAverageOCV(c, soc, x.current, h), temperature = runtime.temperatures?.[c.id] ?? 20;
        const branch = polarizationBranch(c, temperature, h), vp = runtime.devices?.polarization?.[c.id] ?? 0;
        const resistance = prop(c, 'internalResistance') * batteryResistanceFactor(c, temperature) + (branch?.seriesResistance ?? 0);
        const voltage = avg.voltage + (branch?.emfWeight ?? 0) * vp;
        residual = Math.max(residual, Math.abs(x.voltage - voltage - resistance * x.current) / Math.max(1, Math.abs(voltage)));
        models[c.id] = { ...models[c.id], voltage: voltage - avg.resistance * x.current, resistance: resistance + avg.resistance };
      }
      if (residual < 1e-10) return r;
      r = solveConstantPower(project, expanded.project, failures, { ...runtime, sourceModels: models });
    }
    if (packs.length) throw Error('Battery mean-OCV coupling did not converge.');
    return r;
  };
  let result = solveBatteryNetwork();
  const overcurrentCandidates = new Set<string>();
  const bmsVoltage = new Map<string, string>();
  for (const c of project.components.filter(c => c.kind === 'battery' && c.props.cells)) {
    const r = result.readings[c.id]; if (!r) continue;
    if (r.current <= -prop(c, 'dischargeCurrentLimit') * (1 - 1e-10) || r.current >= prop(c, 'chargeCurrentLimit') * (1 - 1e-10) || Math.abs(r.power) > prop(c, 'maxPower') * (1 + 1e-10)) overcurrentCandidates.add(c.id);
    if (r.current < -1e-9 && r.voltage < prop(c, 'bmsLowVoltage')) { models[c.id].lower = 0; bmsVoltage.set(c.id, 'BMS low voltage'); }
    if (r.current > 1e-9 && r.voltage > prop(c, 'bmsHighVoltage')) { models[c.id].upper = 0; bmsVoltage.set(c.id, 'BMS high voltage'); }
  }
  if (bmsVoltage.size) result = solveBatteryNetwork();
  const bmsTrips = new Set(overcurrentCandidates);
  for (const c of project.components.filter(c => c.kind === 'battery' && c.props.cells)) {
    const r = result.readings[c.id];
    if (r && (r.current <= -prop(c, 'dischargeCurrentLimit') * (1 - 1e-10) || r.current >= prop(c, 'chargeCurrentLimit') * (1 - 1e-10))) { failures[c.id] = true; bmsTrips.add(c.id); }
  }
  for (const id of bmsTrips) failures[id] = true;
  if (bmsTrips.size) result = solveBatteryNetwork();
  for (const c of project.components.filter(c => c.kind === 'battery' && c.props.cells)) {
    const r = result.readings[c.id]; if (!r) continue;
    // 1 µA status deadband: nanoampere currents are coupled-iteration residuals, not charge transfer.
    const mode = bmsTrips.has(c.id) || runtime.devices?.solar?.[c.id]?.mode === 'overcurrent' ? 'overcurrent' : bmsVoltage.get(c.id) ?? (r.current > 1e-6 ? 'charging' : r.current < -1e-6 ? 'discharging' : 'idle / BMS limited');
    r.solar = { inputPower: Math.max(0, r.power), outputPower: Math.max(0, -r.power), efficiency: 0, mode, running: mode === 'charging' || mode === 'discharging' };
  }
  for (const c of project.components.filter(c => c.kind === 'electricBoiler')) {
    const ids = expanded.boilers.get(c.id)!, stages = ids.slice(0, 3).map(id => result.readings[id]), aux = result.readings[ids[3]];
    if (stages.some(r => r?.phases === 3)) throw Error(`${c.name}: use three explicit 230 V AC sources at 0/−120/+120° with a shared neutral; the balanced source cannot represent individual heating stages.`);
    if (stages.some(r => r && !r.ac && Math.abs(r.voltage) > 1)) throw Error(`${c.name}: this boiler requires 50 Hz AC mains.`);
    const heatingPower = stages.reduce((sum, r) => sum + (r?.power ?? 0), 0), auxiliaryPower = aux?.power ?? 0;
    // Sum currents on bridged live nodes (single-phase); distinct phases retain their own line currents.
    const lines = new Map<string | number, number>();
    stages.forEach((r, i) => { const key = result.nodeIds?.[`${ids[i]}:a`] ?? i; lines.set(key, (lines.get(key) ?? 0) + Math.abs(r?.current ?? 0) + (i === 0 ? Math.abs(aux?.current ?? 0) : 0)); });
    result.readings[c.id] = { ...stages[0], voltage: stages[0]?.voltage ?? 0, current: Math.max(0, ...lines.values()), power: heatingPower + auxiliaryPower, apparentPower: heatingPower + auxiliaryPower, currentPhasor: undefined, peakCurrent: undefined, powerFactor: heatingPower + auxiliaryPower > 1e-12 ? 1 : null, reactivePower: 0, heatingPower, auxiliaryPower, stageVoltages: stages.map(r => r?.voltageValid === false ? 0 : Math.abs(r?.voltage ?? 0)), stageCurrents: stages.map(r => Math.abs(r?.current ?? 0)) };
    for (const field of ['nodes', 'nodeIds', 'nodeIslands', 'phasors'] as const) {
      const values = result[field]; if (!values) continue;
      for (const [i, port, original] of [[0, 'a', 'L1'], [1, 'a', 'L2'], [2, 'a', 'L3'], [0, 'b', 'N'], [4, 'a', 'PE']] as const) {
        const key = `${ids[i]}:${port}`; if (key in values) (values as Record<string, unknown>)[`${c.id}:${original}`] = values[key];
      }
      for (const id of ids) for (const port of ['a', 'b']) delete values[`${id}:${port}`];
    }
    ids.forEach(id => delete result.readings[id]);
  }
  let chemical = 0;
  for (const c of project.components) {
    const r = result.readings[c.id];
    if (!r) continue;
    if (c.kind === 'battery') {
      // Storage changes exactly as the engine will advance them (chemical energy from the state of charge, the
      // polarization branch's field); the rest of the terminal energy heats the pack: ohmic and polarization loss,
      // charge-acceptance and self-discharge loss.
      const temperature = runtime.temperatures?.[c.id] ?? 20, h = runtime.devices?.h ?? 0, branch = polarizationBranch(c, temperature, h);
      const soc = runtime.devices?.batteries[c.id] ?? prop(c, 'initialSOC') / 100, next = Math.max(0, Math.min(1, batteryChargeStep(c, soc, r.current, h)));
      const storage = h > 0
        ? batteryEnergyChange(c, soc, next) / h + (branch ? branch.step(runtime.devices?.polarization?.[c.id] ?? 0, r.current).energy / h : 0)
        : batteryOCV(c, soc).voltage * r.current;
      const heat = r.power - storage;
      r.heatPower = heat;
      r.chemicalPower = storage;
      chemical += r.chemicalPower;
      result.sourcePower += r.power; // Battery energy is internal storage, rather than an external supply.
      result.dissipatedPower += heat;
    }
    if (c.kind === 'contactor') {
      const coil = result.readings[expanded.coils.get(c.id)!];
      if (coil?.ac) throw Error(`${c.name}: this contactor requires a DC coil supply; AC coils are not modelled.`);
      r.coilVoltage = coil?.voltage ?? 0;
      r.coilCurrent = coil?.current ?? 0;
      r.coilPower = coil?.power ?? 0;
      r.power += r.coilPower;
      delete result.readings[expanded.coils.get(c.id)!];
      for (const field of ['nodes', 'nodeIds', 'nodeIslands', 'phasors'] as const) {
        const values = result[field];
        if (!values) continue;
        for (const [a, b] of [['a', 'ca'], ['b', 'cb']]) {
          const old = `${expanded.coils.get(c.id)!}:${a}`, key = `${c.id}:${b}`;
          // All maps share the same key mapping; their value types differ.
          if (old in values) { (values as Record<string, unknown>)[key] = values[old]; delete values[old]; }
        }
      }
    }
    if (c.kind === 'radiator') {
      if (r.ac) throw Error(`${c.name}: the radiator fan requires DC; AC fan drives are not modelled.`);
      r.fanPower = r.power;
    }
  }
  result.storedPower = (result.storedPower ?? 0) + chemical;
  result.powerResidual = result.sourcePower - result.dissipatedPower - result.storedPower;
  return result;
}

export function solveElectrical(project: Project, failed: Record<string, boolean> = {}, runtime: ElectricalRuntime = {}): ElectricalResult {
  const base = (p: Project, f: Record<string, boolean>, r: ElectricalRuntime) => p.components.some(c => solarKinds.includes(c.kind)) ? solveSolar(p, f, r, solveDevices) : solveDevices(p, f, r);
  return project.components.some(c => hybridKinds.includes(c.kind)) ? solveHybrid(project, failed, runtime, base) : base(project, failed, runtime);
}
