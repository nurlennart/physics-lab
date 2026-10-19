import type { Simulation } from './engine';
import { isMotor, isThermalMass, perPoleKinds, portConductance, prop, type Component } from './model';
import { bindSpaceTemperatures, effectiveAmbient, resolveAmbient } from './environment';
import { elementKinds, transport, transportCopy, STAGNANT_FLOW, type HydraulicResult } from './hydraulic';
import { panelExchange } from './panel-radiator';
import { belowBoundary, belowKey, roomCoupled } from './underfloor-heating';
import type { ElectricalResult } from './electrical';
import { solveLinear } from './linear-algebra';
import { WATER_CP, WATER_RHO } from './units';
import { inventoryVolume } from './water';
import { filamentEnergy, filamentInitial, filamentStep } from './filament';
import { GROUND } from './ground';
import { elementU, exteriorTemperature, opaqueArea, outdoorTemperature, roomMatrix, spaceCapacity, ventilationConductance, type SpaceReading } from './thermal-spaces';

/**
 * Schur assembly around the EXISTING conservative hydraulic transport. With panel
 * conductance frozen at the start state its response to each zone temperature is
 * affine. Unit response evaluations eliminate mixer/cell unknowns exactly (no
 * timestep iteration, no committed trial state). Body and room rows solve together.
 */
export function advanceSpaceThermal(s: Simulation, hydraulic: HydraulicResult, electrical: ElectricalResult, h: number, motorPower: Record<string, number>, radiatorUA: Record<string, number>, directHeat: Record<string, number> = {}) {
  const p = s.project, spaces = p.thermalSpaces!, oldRoom = { ...s.spaceTemperatures }, m = spaces.length;
  const assigned = (c: Component) => c.thermalSpaceId && resolveAmbient(p, c).source === 'space' ? spaces.findIndex(r => r.id === c.thermalSpaceId) : -1;
  // Underfloor loops lose heat down into the room under their floor element (when that is a Thermal Space).
  const below = new Map(p.components.filter(c => c.kind === 'underfloorHeating' && roomCoupled(p, c)).flatMap(c => {
    const space = belowBoundary(p, c).space, j = space ? spaces.findIndex(r => r.id === space) : -1;
    return j >= 0 ? [[c.id, j] as const] : [];
  }));
  const fixedPanel: Record<string, ReturnType<typeof panelExchange>> = {};
  for (const c of p.components.filter(c => c.kind === 'panelRadiator')) {
    const branch = hydraulic.branches.find(b => b.component === c.id && Math.abs(b.flow) > STAGNANT_FLOW);
    const state = s.multiphysics.pipeCells[c.id];
    const flow = branch ? Math.abs(branch.flow) * WATER_RHO * WATER_CP : 0;
    const from = branch && (branch.flow > 0 ? branch.from : branch.to);
    fixedPanel[c.id] = panelExchange(c, branch && branch.flow < 0 ? [...state].reverse() : state, from ? hydraulic.nodeTemperatures[from] : undefined, effectiveAmbient(p, c) + 273.15, flow);
  }
  const power = s.multiphysics.elementPower(s, electrical);
  const evaluate = (temperatures: Record<string, number>) => {
    bindSpaceTemperatures(p, temperatures);
    // Trial copies of everything the transport writes (cell arrays are replaced, tank and element states mutated).
    const copy = <T extends object>(r: Record<string, T>) => Object.fromEntries(Object.entries(r).map(([id, v]) => [id, { ...v }])) as Record<string, T>;
    const tanks = copy(s.multiphysics.tanks), cells = { ...s.multiphysics.pipeCells }, result = transportCopy(hydraulic);
    const boilers = copy(s.multiphysics.boilers), heatPumps = copy(s.multiphysics.heatPumps), vessels = copy(s.multiphysics.vessels);
    const exchange = transport(p, tanks, result, h, cells, radiatorUA, { ...boilers, ...heatPumps }, power, fixedPanel, vessels);
    return { tanks, cells, boilers, heatPumps, vessels, result, exchange };
  };
  let base: ReturnType<typeof evaluate>, responses: ReturnType<typeof evaluate>[];
  try {
    base = evaluate(oldRoom);
    responses = spaces.map((r, i) => p.components.some(c => (assigned(c) === i && (['pipe', 'panelRadiator', 'radiator', 'storageTank', 'underfloorHeating'].includes(c.kind) || elementKinds.has(c.kind))) || below.get(c.id) === i)
      ? evaluate({ ...oldRoom, [r.id]: oldRoom[r.id] + 1 }) : base);
  } finally { bindSpaceTemperatures(p, s.spaceTemperatures); }
  const bodies = p.components.filter(c => isThermalMass(c) && (c.kind !== 'tank' || (base.tanks[c.id]?.mass ?? 0) > 1e-10 || prop(c, 'vesselHeatCapacity') > 0));
  const bodyIndex = new Map(bodies.map((c, i) => [c.id, m + i]));
  const { a: roomA, b: roomB } = roomMatrix(p, oldRoom, h), n = m + bodies.length;
  const a = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => roomA[i]?.[j] ?? 0));
  const b = Array.from({ length: n }, (_, i) => roomB[i] ?? 0);
  const poles = (c: Component) => electrical.readings[c.id]?.conductors ?? (perPoleKinds.has(c.kind) && electrical.readings[c.id]?.phases === 3 ? 3 : 1);
  const caps = bodies.map(c => c.kind === 'tank' ? (base.tanks[c.id]?.mass ?? prop(c, 'volume')) * WATER_CP + prop(c, 'vesselHeatCapacity') : prop(c, 'heatCapacity', 20) * poles(c));
  const oldBody = bodies.map(c => c.kind === 'tank' && base.tanks[c.id] ? base.tanks[c.id].temperature - 273.15 : s.temperatures[c.id]);
  const losses: { body: number; owner: Component; ua: number }[] = bodies.map((c, i) => ({ body: m + i, owner: c, ua: prop(c, 'loss', 0) * poles(c) }));
  for (const c of p.components.filter(c => c.kind === 'cooler')) {
    const input = s.automation.input(c, 'in', s), wired = p.connections.some(w => w.domain === 'control' && w.to.component === c.id);
    if (!(wired ? input.valid && input.value === true : c.props.enabled) || s.faults[c.id] === 'coolingFailed') continue;
    const link = p.connections.find(w => w.domain === 'thermal' && !s.disconnected.has(w.id) && (w.from.component === c.id || w.to.component === c.id));
    const target = link && bodyIndex.get(link.from.component === c.id ? link.to.component : link.from.component);
    if (target !== undefined) losses.push({ body: target, owner: c, ua: prop(c, 'conductance') * (s.faults[c.id] === 'coolingReduced' ? 0.5 : 1) });
  }
  const filaments = Object.fromEntries(p.components.filter(c => c.kind === 'lamp').map(c => [c.id, filamentStep(c, s.filaments[c.id] ?? filamentInitial(effectiveAmbient(p, c)), s.failed[c.id] ? 0 : electrical.readings[c.id]?.power ?? 0, h, effectiveAmbient(p, c))]));
  bodies.forEach((c, k) => {
    const i = m + k, C = caps[k] / h;
    a[i][i] = C;
    const r = electrical.readings[c.id];
    b[i] = C * oldBody[k] + (isMotor(c) ? motorPower[c.id] ?? 0 : filaments[c.id]?.heat ?? r?.heatPower ?? ((r?.power ?? 0) - (r?.drive?.braking ?? 0)));
    // Transported tank enthalpy also has an affine response to zone boundaries.
    if (c.kind === 'tank' && base.tanks[c.id]) for (let j = 0; j < m; j++) {
      const d = responses[j].tanks[c.id].temperature - base.tanks[c.id].temperature;
      a[i][j] -= C * d; b[i] -= C * d * oldRoom[spaces[j].id];
    }
  });
  const link = (i: number, j: number, g: number) => { a[i][i] += g; a[j][j] += g; a[i][j] -= g; a[j][i] -= g; };
  for (const l of losses) {
    const room = assigned(l.owner);
    if (room >= 0) link(l.body, room, l.ua);
    else { a[l.body][l.body] += l.ua; b[l.body] += l.ua * effectiveAmbient(p, l.owner); }
  }
  for (const w of p.connections.filter(w => w.domain === 'thermal' && !s.disconnected.has(w.id))) {
    const i = bodyIndex.get(w.from.component), j = bodyIndex.get(w.to.component);
    if (i === undefined || j === undefined) continue;
    const ci = bodies[i - m], cj = bodies[j - m];
    link(i, j, 1 / (1 / (portConductance(ci) * poles(ci)) + 1 / (portConductance(cj) * poles(cj))));
  }
  const hydraulicRoom = (ev: ReturnType<typeof evaluate>, room: number) => p.components.reduce((sum, c) => sum + (assigned(c) === room ? ev.exchange.environmentExchange[c.id] ?? 0 : 0)
    + (below.get(c.id) === room ? ev.exchange.environmentExchange[belowKey(c.id)] ?? 0 : 0), 0);
  const direct: Record<string, number> = {};
  for (const c of p.components) {
    const r = electrical.readings[c.id], hr = hydraulic.readings[c.id];
    direct[c.id] = (directHeat[c.id] ?? 0) + (c.kind === 'electricBoiler' ? r?.auxiliaryPower ?? 0 : c.kind === 'radiator' ? r?.fanPower ?? 0 : c.kind === 'solarPanel' ? r?.heatPower ?? 0 : 0) + (r?.drive?.braking ?? 0);
    if (hr && Math.abs(hr.flow) <= STAGNANT_FLOW) direct[c.id] += Math.max(0, hr.shaftPower + (hr.motorLoss ?? 0));
  }
  spaces.forEach((r, i) => {
    const q = hydraulicRoom(base, i) / h;
    b[i] += q + p.components.reduce((sum, c) => sum + (assigned(c) === i ? direct[c.id] : 0), 0);
    for (let j = 0; j < m; j++) { const d = (hydraulicRoom(responses[j], i) / h - q); a[i][j] -= d; b[i] -= d * oldRoom[spaces[j].id]; }
  });
  const temperature = solveLinear(a, b);
  const nextRoom = Object.fromEntries(spaces.map((r, i) => [r.id, temperature[i]]));
  let accepted: ReturnType<typeof evaluate>;
  try { accepted = evaluate(nextRoom); } finally { bindSpaceTemperatures(p, s.spaceTemperatures); }
  // Commit only after the complete system and conservative transport have succeeded.
  Object.assign(s.multiphysics, { tanks: accepted.tanks, pipeCells: accepted.cells, boilers: accepted.boilers, heatPumps: accepted.heatPumps, vessels: accepted.vessels });
  Object.assign(hydraulic, accepted.result);
  Object.assign(s.spaceTemperatures, nextRoom);
  const device: Record<string, Record<string, number>> = Object.fromEntries(spaces.map(r => [r.id, {}]));
  let internalHydraulic = 0, internalDirect = 0, bodyAmbient = 0;
  for (const c of p.components) {
    const i = assigned(c);
    if (i < 0) continue;
    const energy = accepted.exchange.environmentExchange[c.id] ?? 0;
    device[spaces[i].id][c.id] = energy / h + direct[c.id]; internalHydraulic += energy; internalDirect += direct[c.id] * h;
  }
  for (const [id, j] of below) {
    const energy = accepted.exchange.environmentExchange[belowKey(id)] ?? 0;
    device[spaces[j].id][id] = (device[spaces[j].id][id] ?? 0) + energy / h; internalHydraulic += energy;
  }
  for (const l of losses) {
    const i = assigned(l.owner), ambient = i >= 0 ? temperature[i] : effectiveAmbient(p, l.owner);
    const q = l.ua * (temperature[l.body] - ambient);
    if (i >= 0) device[spaces[i].id][l.owner.id] = (device[spaces[i].id][l.owner.id] ?? 0) + q;
    else bodyAmbient += q * h;
  }
  bodies.forEach((c, k) => {
    // Use the accepted transported tank temperature as the storage-change datum.
    const before = c.kind === 'tank' && accepted.tanks[c.id] ? accepted.tanks[c.id].temperature - 273.15 : oldBody[k];
    const t = temperature[m + k], gain = caps[k] * (t - before);
    s.temperatures[c.id] = t; s.storedEnergy += gain;
    if (c.kind === 'heater') s.heaterStored += gain;
    if (c.kind === 'tank') { s.waterStored += gain; const tank = accepted.tanks[c.id]; tank.temperature = t + 273.15; tank.volume = inventoryVolume(tank.mass, tank.temperature); }
    s.thermalRate = Math.max(s.thermalRate, Math.abs(t - before) / h);
  });
  for (const [id, f] of Object.entries(filaments)) {
    const c = p.components.find(c => c.id === id)!;
    s.storedEnergy += filamentEnergy(c, f.u) - filamentEnergy(c, s.filaments[id] ?? filamentInitial(effectiveAmbient(p, c)));
    s.filaments[id] = f.u;
  }
  let exterior = 0;
  spaces.forEach((r, i) => {
    const t = temperature[i], capacity = spaceCapacity(p, r), outdoor = outdoorTemperature(p, r);
    const reading: SpaceReading = { temperature: t, outdoor, capacity, deviceHeat: Object.values(device[r.id]).reduce((a, b) => a + b, 0), internalHeat: r.internalGain, adjacentHeat: 0, envelopeLoss: 0, groundLoss: 0, ventilationLoss: ventilationConductance(r) * (t - outdoor), netHeat: 0, rate: (t - oldRoom[r.id]) / h, storedEnergy: capacity * (t - r.initialTemperature), elementFlows: {}, deviceFlows: device[r.id] };
    for (const e of p.thermalElements ?? []) {
      if (e.from !== r.id && e.to !== r.id) continue;
      const other = e.from === r.id ? e.to : e.from, q = elementU(p, e) * opaqueArea(p, e) * (t - (nextRoom[other] ?? exteriorTemperature(p, r, other)));
      reading.elementFlows[e.id] = q;
      if (other === GROUND) reading.groundLoss += q; else if (other === 'outdoors') reading.envelopeLoss += q; else reading.adjacentHeat -= q;
    }
    reading.netHeat = reading.deviceHeat + reading.internalHeat + reading.adjacentHeat - reading.envelopeLoss - reading.groundLoss - reading.ventilationLoss;
    const gain = capacity * (t - oldRoom[r.id]);
    s.spaceReadings[r.id] = reading; s.roomStored += gain; s.storedEnergy += gain; s.suppliedEnergy += r.internalGain * h;
    s.thermalRate = Math.max(s.thermalRate, Math.abs(reading.rate));
    exterior += (reading.envelopeLoss + reading.groundLoss + reading.ventilationLoss) * h;
  });
  // Hydraulic/direct internal transfers must disappear from the external ledger.
  const fan = p.components.filter(c => c.kind === 'radiator').reduce((sum, c) => sum + (electrical.readings[c.id]?.fanPower ?? 0) * h, 0);
  s.ambientEnergy += bodyAmbient + exterior + fan - internalHydraulic - internalDirect;
  return accepted.exchange;
}
