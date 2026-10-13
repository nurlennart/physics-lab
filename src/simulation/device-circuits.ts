/** New multi-circuit devices expand into ordinary MNA branches; state stays in the engine. */
import { definitions, prop, type Component, type Project } from './model';
import { solveElectricalCore, type ElectricalResult, type ElectricalRuntime } from './electrical-core';
import { batteryChargeStep, batteryEnergy, batteryOCV, batteryResistanceFactor, polarizationBranch, selfDischargeCurrent } from './devices';

type Expansion = { project: Project; coils: Map<string, string> };
const cache = new WeakMap<Project, Expansion>();
const special = (c: Component) => ['battery', 'contactor', 'radiator', 'circulator'].includes(c.kind);
function expand(project: Project): Expansion {
  const cached = cache.get(project);
  if (cached) return cached;
  const ids = new Set(project.components.map(c => c.id)), coils = new Map<string, string>();
  for (const c of project.components.filter(c => c.kind === "contactor")) {
    let id = `${c.id}#coil`;
    while (ids.has(id)) id += "#";
    ids.add(id); coils.set(c.id, id);
  }
  const components = project.components.flatMap((c): Component[] => {
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
  const map = (t: { component: string; port: string }) => t.port === 'ca' || t.port === 'cb' ? { component: coils.get(t.component)!, port: t.port === 'ca' ? 'a' : 'b' } : t;
  const expanded = { ...project, components, connections: project.connections.map(w => ({ ...w, from: map(w.from), to: map(w.to) })) };
  const expansion = { project: expanded, coils };
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
  const loads: Record<string, number> = {}, undervoltage = new Set<string>();
  for (const c of units) if (!failures[c.id]) loads[c.id] = prop(c, 'ratedVoltage') ** 2 / demand(c);
  const off = (c: Component) => { undervoltage.add(c.id); failures[c.id] = true; delete loads[c.id]; };
  let result = solveElectricalCore(expanded, failures, { ...runtime, loadResistances: loads });
  for (let k = 0; Object.keys(loads).length; k++) {
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
export function solveElectrical(project: Project, failed: Record<string, boolean> = {}, runtime: ElectricalRuntime = {}): ElectricalResult {
  if (!project.components.some(special)) return solveElectricalCore(project, failed, runtime);
  const expanded = expand(project);
  const failures = { ...failed }, models = { ...runtime.sourceModels };
  for (const c of project.components) {
    if (c.kind === 'battery') {
      // Midpoint OCV over the step: E(s₀) behind (dE/ds)·h/(2Q); the polarization branch as its exact step average.
      const soc = runtime.devices?.batteries[c.id] ?? prop(c, 'initialSOC') / 100, h = runtime.devices?.h ?? 0, charge = 3600 * prop(c, 'capacityAh'), ocv = batteryOCV(c, soc);
      const temperature = runtime.temperatures?.[c.id] ?? 20, branch = polarizationBranch(c, temperature, h), vp = runtime.devices?.polarization?.[c.id] ?? 0;
      models[c.id] = {
        voltage: ocv.voltage + (branch ? branch.emfWeight * vp : 0),
        resistance: prop(c, 'internalResistance') * batteryResistanceFactor(c, temperature) + ocv.slope * h / (2 * charge) + (branch?.seriesResistance ?? 0),
        // A full battery accepts only the trickle that offsets its self-discharge (an ideal charge termination).
        lower: soc <= 1e-14 ? 0 : -Infinity, upper: soc >= 1 - 1e-14 ? selfDischargeCurrent(c) * 100 / prop(c, 'coulombicEfficiency') : Infinity,
      };
    }
    if (c.kind === 'contactor') {
      failures[expanded.coils.get(c.id)!] = !!failed[c.id] || runtime.faults?.[c.id] === "failedOpen";
      failures[c.id] = !!failed[c.id] || (runtime.faults?.[c.id] !== 'stuckClosed' && (runtime.faults?.[c.id] === 'stuckOpen' || !runtime.devices?.contactors[c.id]?.closed));
    }
    if (c.kind === 'radiator' && runtime.faults?.[c.id] === 'coolingFailed') failures[c.id] = true;
  }
  const result = solveConstantPower(project, expanded.project, failures, { ...runtime, sourceModels: models });
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
        ? (batteryEnergy(c, next) - batteryEnergy(c, soc)) / h + (branch ? branch.step(runtime.devices?.polarization?.[c.id] ?? 0, r.current).energy / h : 0)
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
