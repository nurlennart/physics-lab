/** New multi-circuit devices expand into ordinary MNA branches; state stays in the engine. */
import { definitions, prop, type Component, type Project } from './model';
import { solveElectricalCore, type ElectricalResult, type ElectricalRuntime } from './electrical-core';
import { batteryResistanceFactor, polarizationBranch } from './devices';

type Expansion = { project: Project; coils: Map<string, string> };
const cache = new WeakMap<Project, Expansion>();
const special = (c: Component) => ['battery', 'contactor', 'radiator'].includes(c.kind);
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
    return [c];
  });
  const map = (t: { component: string; port: string }) => t.port === 'ca' || t.port === 'cb' ? { component: coils.get(t.component)!, port: t.port === 'ca' ? 'a' : 'b' } : t;
  const expanded = { ...project, components, connections: project.connections.map(w => ({ ...w, from: map(w.from), to: map(w.to) })) };
  const expansion = { project: expanded, coils };
  cache.set(project, expansion);
  return expansion;
}
export function solveElectrical(project: Project, failed: Record<string, boolean> = {}, runtime: ElectricalRuntime = {}): ElectricalResult {
  if (!project.components.some(special)) return solveElectricalCore(project, failed, runtime);
  const expanded = expand(project);
  const failures = { ...failed }, models = { ...runtime.sourceModels };
  for (const c of project.components) {
    if (c.kind === 'battery') {
      const soc = runtime.devices?.batteries[c.id] ?? prop(c, 'initialSOC') / 100, h = runtime.devices?.h ?? 0, charge = 3600 * prop(c, 'capacityAh'), dv = prop(c, 'fullVoltage') - prop(c, 'emptyVoltage');
      const temperature = runtime.temperatures?.[c.id] ?? 20, branch = polarizationBranch(c, temperature, h), vp = runtime.devices?.polarization?.[c.id] ?? 0;
      models[c.id] = {
        voltage: prop(c, 'emptyVoltage') + dv * soc + (branch ? branch.emfWeight * vp : 0),
        resistance: prop(c, 'internalResistance') * batteryResistanceFactor(c, temperature) + dv * h / (2 * charge) + (branch?.seriesResistance ?? 0),
        lower: soc <= 1e-14 ? 0 : -Infinity, upper: soc >= 1 - 1e-14 ? 0 : Infinity,
      };
    }
    if (c.kind === 'contactor') {
      failures[expanded.coils.get(c.id)!] = !!failed[c.id] || runtime.faults?.[c.id] === "failedOpen";
      failures[c.id] = !!failed[c.id] || (runtime.faults?.[c.id] !== 'stuckClosed' && (runtime.faults?.[c.id] === 'stuckOpen' || !runtime.devices?.contactors[c.id]?.closed));
    }
    if (c.kind === 'radiator' && runtime.faults?.[c.id] === 'coolingFailed') failures[c.id] = true;
  }
  const result = solveElectricalCore(expanded.project, failures, { ...runtime, sourceModels: models });
  let chemical = 0;
  for (const c of project.components) {
    const r = result.readings[c.id];
    if (!r) continue;
    if (c.kind === 'battery') {
      // Ohmic R₀ heat plus the polarization branch's R₁ heat; the rest changes chemical and polarization energy.
      const temperature = runtime.temperatures?.[c.id] ?? 20, h = runtime.devices?.h ?? 0, branch = polarizationBranch(c, temperature, h);
      const polarizationHeat = branch && h > 0 ? branch.step(runtime.devices?.polarization?.[c.id] ?? 0, r.current).heat / h : 0;
      const heat = r.current ** 2 * prop(c, 'internalResistance') * batteryResistanceFactor(c, temperature) + polarizationHeat;
      r.heatPower = heat;
      r.chemicalPower = r.power - heat;
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
