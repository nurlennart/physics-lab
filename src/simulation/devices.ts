import { prop, type Component, type Project } from './model';
import type { ElectricalResult, ElectricalRuntime } from './electrical';

/** Charge and contact mechanics advance only after an accepted physical interval. */
export class Devices {
  active = false;
  batteries: Record<string, number> = {};
  contactors: Record<string, { closed: boolean; elapsed: number; requested: boolean }> = {};
  chemicalChange = 0;
  initialize(project: Project) {
    this.active = project.components.some(c => c.kind === "battery" || c.kind === "contactor");
    for (const c of project.components) {
      if (c.kind === 'battery') this.batteries[c.id] = prop(c, 'initialSOC') / 100;
      if (c.kind === 'contactor') this.contactors[c.id] = { closed: false, elapsed: 0, requested: false };
    }
  }
  runtime(h = 0): Pick<ElectricalRuntime, 'devices'> { return { devices: { batteries: this.batteries, contactors: this.contactors, h } }; }
  boundaryTime(project: Project, electrical: ElectricalResult, h: number) {
    if (!this.active) return h;
    let limit = h;
    for (const c of project.components.filter(c => c.kind === 'battery')) {
      const soc = this.batteries[c.id], rate = (electrical.readings[c.id]?.current ?? 0) / (3600 * prop(c, 'capacityAh'));
      const next = soc + rate * h;
      if (next < -1e-14) limit = Math.min(limit, -soc / rate);
      if (next > 1 + 1e-14) limit = Math.min(limit, (1 - soc) / rate);
    }
    return limit;
  }
  /** Substep limit so a running pickup/dropout timer ends exactly on a substep boundary. */
  eventLimit(project: Project) {
    if (!this.active) return Infinity;
    let limit = Infinity;
    for (const c of project.components) {
      const state = c.kind === 'contactor' ? this.contactors[c.id] : undefined;
      if (!state || state.requested === state.closed) continue;
      const remaining = prop(c, state.requested ? 'pickupTime' : 'dropoutTime') - state.elapsed;
      if (remaining > 1e-12) limit = Math.min(limit, remaining);
    }
    return limit;
  }
  advance(project: Project, electrical: ElectricalResult, h: number) {
    if (!this.active) return;
    for (const c of project.components) {
      const r = electrical.readings[c.id];
      if (c.kind === 'battery' && r) {
        const before = this.batteries[c.id], next = before + r.current * h / (3600 * prop(c, 'capacityAh'));
        if (next < -1e-9 || next > 1 + 1e-9) throw Error(`${c.name}: battery charge left its physical bounds.`);
        this.batteries[c.id] = Math.max(0, Math.min(1, next));
        this.chemicalChange += batteryEnergy(c, this.batteries[c.id]) - batteryEnergy(c, before);
      }
      if (c.kind === 'contactor') {
        const state = this.contactors[c.id], voltage = Math.abs(r?.coilVoltage ?? 0), rated = prop(c, 'coilVoltage');
        const requested = state.closed ? voltage > rated * prop(c, 'dropoutRatio') : voltage >= rated * prop(c, 'pickupRatio');
        if (requested === state.closed) { state.elapsed = 0; state.requested = requested; continue; }
        if (requested !== state.requested) state.elapsed = 0;
        state.requested = requested;
        state.elapsed += h;
        if (state.elapsed + 1e-12 >= prop(c, requested ? 'pickupTime' : 'dropoutTime')) { state.closed = requested; state.elapsed = 0; }
      }
    }
  }
}
/** Integral of the declared linear OCV(SOC), referenced to an empty battery. */
export function batteryEnergy(c: Component, soc: number) {
  return 3600 * prop(c, 'capacityAh') * (prop(c, 'emptyVoltage') * soc + 0.5 * (prop(c, 'fullVoltage') - prop(c, 'emptyVoltage')) * soc * soc);
}
export function radiatorUA(c: Component, electrical: ElectricalResult) {
  const voltage = Math.abs(electrical.readings[c.id]?.voltage ?? 0), powered = (electrical.readings[c.id]?.fanPower ?? 0) > 0;
  return prop(c, 'naturalUA') + (powered ? prop(c, 'forcedUA') * Math.min(1, voltage / prop(c, 'ratedVoltage')) ** 0.8 : 0);
}
