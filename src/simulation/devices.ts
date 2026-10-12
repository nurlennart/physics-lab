import { prop, type Component, type Project } from './model';
import type { ElectricalResult, ElectricalRuntime } from './electrical';

/** A paused solve previews the average over the next fixed step (the engine's DT), as every step reading is an average. */
const PREVIEW_STEP = 1 / 60;
/** Charge, polarization and contact mechanics advance only after an accepted physical interval. */
export class Devices {
  active = false;
  /** Battery state of charge (0–1) and polarization voltage (V); capacitor dielectric voltage (V). */
  batteries: Record<string, number> = {};
  polarization: Record<string, number> = {};
  capacitors: Record<string, number> = {};
  contactors: Record<string, { closed: boolean; elapsed: number; requested: boolean }> = {};
  /** Energy change of electrochemical and electrostatic storage since reset (J). */
  storedChange = 0;
  initialize(project: Project) {
    this.active = project.components.some(c => c.kind === "battery" || c.kind === "contactor" || c.kind === "capacitor");
    for (const c of project.components) {
      if (c.kind === 'battery') { this.batteries[c.id] = prop(c, 'initialSOC') / 100; this.polarization[c.id] = 0; }
      if (c.kind === 'capacitor') this.capacitors[c.id] = prop(c, 'chargeVoltage');
      if (c.kind === 'contactor') this.contactors[c.id] = { closed: false, elapsed: 0, requested: false };
    }
  }
  runtime(h = 0): Pick<ElectricalRuntime, 'devices'> {
    return { devices: { batteries: this.batteries, polarization: this.polarization, capacitors: this.capacitors, contactors: this.contactors, h: h > 0 ? h : PREVIEW_STEP } };
  }
  checkpoint() {
    return structuredClone({ batteries: this.batteries, polarization: this.polarization, capacitors: this.capacitors, contactors: this.contactors, storedChange: this.storedChange });
  }
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
  advance(project: Project, electrical: ElectricalResult, h: number, temperatures: Record<string, number> = {}) {
    if (!this.active) return;
    for (const c of project.components) {
      const r = electrical.readings[c.id];
      if (c.kind === 'battery' && r) {
        const before = this.batteries[c.id], next = before + r.current * h / (3600 * prop(c, 'capacityAh'));
        if (next < -1e-9 || next > 1 + 1e-9) throw Error(`${c.name}: battery charge left its physical bounds.`);
        this.batteries[c.id] = Math.max(0, Math.min(1, next));
        this.storedChange += batteryEnergy(c, this.batteries[c.id]) - batteryEnergy(c, before);
        const branch = polarizationBranch(c, temperatures[c.id] ?? 20, h);
        if (branch) {
          const step = branch.step(this.polarization[c.id] ?? 0, r.current);
          this.storedChange += step.energy;
          this.polarization[c.id] = step.voltage;
        }
      }
      // A capacitor outside a solved DC network (an AC island, a failed element) holds its charge.
      if (c.kind === 'capacitor' && r?.chargeCurrent !== undefined) {
        const before = this.capacitors[c.id], capacitance = prop(c, 'capacitance'), next = before + r.chargeCurrent * h / capacitance;
        this.capacitors[c.id] = next;
        this.storedChange += 0.5 * capacitance * (next * next - before * before);
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
/** Arrhenius factor of the battery resistances at temperature T (°C), referenced to 20 °C. */
export function batteryResistanceFactor(c: Component, temperature: number) {
  const activation = prop(c, 'resistanceActivation');
  return activation ? Math.exp(activation * (1 / (temperature + 273.15) - 1 / 293.15)) : 1;
}
/**
 * Battery polarization branch R₁ ∥ C₁ in series with R₀, driven by the battery current I held over the interval h:
 * C₁·dv/dt = I − v/R₁. C₁ = τ₁/R₁(20 °C) is fixed, R₁ follows the Arrhenius factor. Exact over the interval:
 * v(h) = I·R₁ + (v₀ − I·R₁)·e^(−y), mean v̄ = φ·v₀ + (1 − φ)·I·R₁ with y = h/(R₁C₁), φ = (1 − e^(−y))/y.
 * The stamp is therefore φ·v₀ behind (1 − φ)·R₁; heat I·v̄·h − ΔE, with field energy E = ½·C₁·v².
 */
export function polarizationBranch(c: Component, temperature: number, h: number) {
  const r20 = prop(c, 'polarizationResistance');
  if (!(r20 > 0)) return null;
  const resistance = r20 * batteryResistanceFactor(c, temperature), capacitance = prop(c, 'polarizationTimeConstant') / r20, y = h / (resistance * capacitance);
  const phi = y > 0 ? -Math.expm1(-y) / y : 1, decay = Math.exp(-y);
  return {
    emfWeight: phi, seriesResistance: (1 - phi) * resistance,
    step(v0: number, current: number) {
      const voltage = decay * v0 + (1 - decay) * resistance * current, mean = phi * v0 + (1 - phi) * resistance * current;
      const energy = 0.5 * capacitance * (voltage * voltage - v0 * v0);
      return { voltage, energy, heat: current * mean * h - energy };
    },
  };
}
/** Integral of the declared linear OCV(SOC), referenced to an empty battery. */
export function batteryEnergy(c: Component, soc: number) {
  return 3600 * prop(c, 'capacityAh') * (prop(c, 'emptyVoltage') * soc + 0.5 * (prop(c, 'fullVoltage') - prop(c, 'emptyVoltage')) * soc * soc);
}
export function radiatorUA(c: Component, electrical: ElectricalResult) {
  const voltage = Math.abs(electrical.readings[c.id]?.voltage ?? 0), powered = (electrical.readings[c.id]?.fanPower ?? 0) > 0;
  return prop(c, 'naturalUA') + (powered ? prop(c, 'forcedUA') * Math.min(1, voltage / prop(c, 'ratedVoltage')) ** 0.8 : 0);
}
