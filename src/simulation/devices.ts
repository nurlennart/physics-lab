import { advanceSolar, initialSolarState, solarKinds, type SolarState } from './solar';
import { prop, type Component, type Project } from './model';
import type { ElectricalResult, ElectricalRuntime } from './electrical';

/** A paused solve previews the average over the next fixed step (the engine's DT), as every step reading is an average. */
const PREVIEW_STEP = 1 / 60;
/**
 * A decaying stored voltage or current below 1e-30 (V or A, far below thermal noise) settles to zero. Left alone it
 * would decay into subnormal numbers, whose lost precision the circuit solver rightly rejects.
 */
const settle = (value: number) => (Math.abs(value) < 1e-30 ? 0 : value);
/** Charge, polarization and contact mechanics advance only after an accepted physical interval. */
export class Devices {
  active = false;
  solar: Record<string, SolarState> = {};
  /** Battery state of charge (0–1) and polarization voltage (V); capacitor dielectric voltage (V); inductor current (A). */
  batteries: Record<string, number> = {};
  polarization: Record<string, number> = {};
  capacitors: Record<string, number> = {};
  inductors: Record<string, number> = {};
  contactors: Record<string, { closed: boolean; elapsed: number; requested: boolean }> = {};
  /** Energy change of electrochemical and electrostatic storage since reset (J). */
  storedChange = 0;
  initialize(project: Project) {
    this.active = project.components.some(c => ["battery", "lfpBattery", "solarPanel", "mpptController", "inverter", "batteryProtection", "contactor", "capacitor", "inductor"].includes(c.kind));
    for (const c of project.components) {
      if (solarKinds.includes(c.kind)) this.solar[c.id] = initialSolarState(c);
      if ((c.kind === 'battery' || c.kind === 'lfpBattery')) { this.batteries[c.id] = prop(c, 'initialSOC') / 100; this.polarization[c.id] = 0; }
      if (c.kind === 'capacitor') this.capacitors[c.id] = prop(c, 'chargeVoltage');
      if (c.kind === 'inductor') this.inductors[c.id] = 0;
      if (c.kind === 'contactor') this.contactors[c.id] = { closed: false, elapsed: 0, requested: false };
    }
  }
  runtime(h = 0): Pick<ElectricalRuntime, 'devices'> {
    return { devices: { solar: this.solar, batteries: this.batteries, polarization: this.polarization, capacitors: this.capacitors, inductors: this.inductors, contactors: this.contactors, h: h > 0 ? h : PREVIEW_STEP } };
  }
  checkpoint() {
    return structuredClone({ solar: this.solar, batteries: this.batteries, polarization: this.polarization, capacitors: this.capacitors, inductors: this.inductors, contactors: this.contactors, storedChange: this.storedChange });
  }
  boundaryTime(project: Project, electrical: ElectricalResult, h: number) {
    if (!this.active) return h;
    let limit = h;
    for (const c of project.components.filter(c => (c.kind === 'battery' || c.kind === 'lfpBattery'))) {
      const soc = this.batteries[c.id], rate = batteryChargeStep(c, soc, electrical.readings[c.id]?.current ?? 0, 1) - soc;
      const next = soc + rate * h;
      if (c.kind === 'lfpBattery' && Math.abs(rate) > 1e-15) {
        // A small custom pack can traverse an OCV knee inside a fixed step. Resolve the chemical
        // timescale in fixed as well as adaptive runs, and split at every slope discontinuity.
        limit = Math.min(limit, 0.002 / Math.abs(rate));
        for (const boundary of ocvCurve(c)[0]) {
          if (rate > 0 && soc < boundary - 1e-12 && next > boundary + 1e-14 || rate < 0 && soc > boundary + 1e-12 && next < boundary - 1e-14) limit = Math.min(limit, (boundary - soc) / rate);
        }
      }
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
    for (const c of project.components) {
      if (c.kind === 'mpptController') limit = Math.min(limit, Math.max(1e-8, prop(c, 'trackingInterval') - this.solar[c.id].elapsed));
      if (c.kind === 'inverter' && this.solar[c.id].overload > 0 && this.solar[c.id].overload < prop(c, 'surgeTime')) limit = Math.min(limit, prop(c, 'surgeTime') - this.solar[c.id].overload);
    }
    return limit;
  }
  advance(project: Project, electrical: ElectricalResult, h: number, temperatures: Record<string, number> = {}) {
    if (!this.active) return;
    advanceSolar(project, this.solar, electrical, h);
    for (const c of project.components) {
      const r = electrical.readings[c.id];
      if ((c.kind === 'battery' || c.kind === 'lfpBattery') && r) {
        const before = this.batteries[c.id], next = batteryChargeStep(c, before, r.current, h);
        if (next < -1e-9 || next > 1 + 1e-9) throw Error(`${c.name}: battery charge left its physical bounds.`);
        this.batteries[c.id] = Math.max(0, Math.min(1, next));
        this.storedChange += batteryEnergy(c, this.batteries[c.id]) - batteryEnergy(c, before);
        const branch = polarizationBranch(c, temperatures[c.id] ?? 20, h);
        if (branch) {
          const step = branch.step(this.polarization[c.id] ?? 0, r.current);
          this.storedChange += step.energy;
          this.polarization[c.id] = settle(step.voltage);
        }
      }
      // Outside a solved DC network (an AC island) a capacitor holds its charge and an inductor its current; a failed
      // inductor's interrupted current is dumped at the failure.
      if (c.kind === 'capacitor' && r?.chargeCurrent !== undefined) {
        const before = this.capacitors[c.id], capacitance = prop(c, 'capacitance'), next = settle(before + r.chargeCurrent * h / capacitance);
        this.capacitors[c.id] = next;
        this.storedChange += 0.5 * capacitance * (next * next - before * before);
      }
      if (c.kind === 'inductor' && r?.inductanceVoltage !== undefined) {
        const before = this.inductors[c.id], inductance = prop(c, 'inductance'), next = settle(before + r.inductanceVoltage * h / inductance);
        this.inductors[c.id] = next;
        this.storedChange += 0.5 * inductance * (next * next - before * before);
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
/**
 * Normalized open-circuit curves f(s), E(s) = E_empty + (E_full − E_empty)·f(s), linear between the tabulated states of
 * charge. NMC/graphite (3.0–4.2 V per cell) rises steeply from empty, then gently; LFP (2.5–3.65 V) is a flat plateau
 * with steep ends. Typical cell data, not a specific manufacturer's.
 */
const OCV_CURVES: Record<string, [number[], number[]]> = {
  linear: [[0, 1], [0, 1]],
  nmc: [[0, 0.05, 0.1, 0.2, 0.4, 0.6, 0.8, 1], [0, 0.375, 0.458, 0.517, 0.6, 0.708, 0.833, 1]],
  lfp: [[0, 0.05, 0.1, 0.2, 0.5, 0.8, 0.95, 1], [0, 0.545, 0.636, 0.682, 0.718, 0.745, 0.773, 1]],
};
const ocvCurve = (c: Component) => OCV_CURVES[String(c.props.chemistry ?? 'linear')] ?? OCV_CURVES.linear;
/** Open-circuit voltage at a state of charge and its slope dE/ds there (the segment above s; at full, the last one). */
export function batteryOCV(c: Component, soc: number) {
  const [s, f] = ocvCurve(c), span = prop(c, 'fullVoltage') - prop(c, 'emptyVoltage'), x = Math.max(0, Math.min(1, soc));
  const k = Math.min(s.length - 2, s.findIndex((_, i) => i === s.length - 1 || x + (c.props.cells ? 1e-12 : 0) < s[i + 1]));
  const slope = (f[k + 1] - f[k]) / (s[k + 1] - s[k]);
  return { voltage: prop(c, 'emptyVoltage') + span * (f[k] + slope * (x - s[k])), slope: span * slope };
}
/** Chemical energy Q·∫₀ˢ E ds (exact for the piecewise-linear curve), referenced to an empty battery. */
export function batteryEnergy(c: Component, soc: number) {
  const [s, f] = ocvCurve(c), x = Math.max(0, Math.min(1, soc));
  let area = 0;
  for (let i = 0; i + 1 < s.length && s[i] < x; i++) {
    const end = Math.min(x, s[i + 1]), fEnd = f[i] + (f[i + 1] - f[i]) * (end - s[i]) / (s[i + 1] - s[i]);
    area += 0.5 * (f[i] + fEnd) * (end - s[i]);
  }
  return 3600 * prop(c, 'capacityAh') * (prop(c, 'emptyVoltage') * x + (prop(c, 'fullVoltage') - prop(c, 'emptyVoltage')) * area);
}
/**
 * State of charge after h with the mean terminal current I (into +): on charge only the coulombic efficiency η of the
 * charge is stored (the rest drives side reactions), and a charged battery self-discharges at its monthly rate.
 */
export function batteryChargeStep(c: Component, soc: number, current: number, h: number) {
  const stored = current > 0 ? current * prop(c, 'coulombicEfficiency') / 100 : current;
  return soc + (stored - (soc > 0 ? selfDischargeCurrent(c) : 0)) * h / (3600 * prop(c, 'capacityAh'));
}
/** Internal self-discharge current of a charged battery (A). */
export function selfDischargeCurrent(c: Component) {
  return 3600 * prop(c, 'capacityAh') * prop(c, 'selfDischarge') / 100 / (30 * 86400);
}
export function radiatorUA(c: Component, electrical: ElectricalResult) {
  const voltage = Math.abs(electrical.readings[c.id]?.voltage ?? 0), powered = (electrical.readings[c.id]?.fanPower ?? 0) > 0;
  return prop(c, 'naturalUA') + (powered ? prop(c, 'forcedUA') * Math.min(1, voltage / prop(c, 'ratedVoltage')) ** 0.8 : 0);
}
