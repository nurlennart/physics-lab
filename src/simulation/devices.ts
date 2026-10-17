import { advanceHybrid, hybridEventLimit, hybridKinds, initialHybridState, type HybridState } from './hybrid';
import { advanceSolar, initialSolarState, solarKinds, type SolarState } from './solar';
import { cloneState, prop, type Component, type Project } from './model';
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
  hybrid: Record<string, HybridState> = {};
  solar: Record<string, SolarState> = {};
  /** Battery state of charge (0–1) and polarization voltage (V); capacitor dielectric voltage (V); inductor current (A). */
  batteries: Record<string, number> = {};
  batteryHeat: Record<string, number> = {};
  polarization: Record<string, number> = {};
  capacitors: Record<string, number> = {};
  inductors: Record<string, number> = {};
  contactors: Record<string, { closed: boolean; elapsed: number; requested: boolean }> = {};
  /** Energy change of electrochemical and electrostatic storage since reset (J). */
  storedChange = 0;
  initialize(project: Project) {
    this.active = project.components.some(c => [...hybridKinds,"battery", "lfpBattery", "solarPanel", "mpptController", "inverter", "batteryProtection", "contactor", "capacitor", "inductor"].includes(c.kind));
    for (const c of project.components) {
      if (hybridKinds.includes(c.kind)) this.hybrid[c.id] = initialHybridState(c);
      if (solarKinds.includes(c.kind)) this.solar[c.id] = initialSolarState(c);
      if ((c.kind === 'battery' || c.kind === 'lfpBattery')) { this.batteryHeat[c.id] = 0; this.batteries[c.id] = prop(c, 'initialSOC') / 100; this.polarization[c.id] = 0; }
      if (c.kind === 'capacitor') this.capacitors[c.id] = prop(c, 'chargeVoltage');
      if (c.kind === 'inductor') this.inductors[c.id] = 0;
      if (c.kind === 'contactor') this.contactors[c.id] = { closed: false, elapsed: 0, requested: false };
    }
  }
  runtime(h = 0): Pick<ElectricalRuntime, 'devices'> {
    return { devices: { hybrid: this.hybrid, solar: this.solar, batteries: this.batteries, polarization: this.polarization, capacitors: this.capacitors, inductors: this.inductors, contactors: this.contactors, h: h > 0 ? h : PREVIEW_STEP } };
  }
  checkpoint() {
    return cloneState({ hybrid: this.hybrid, solar: this.solar, batteries: this.batteries, batteryHeat: this.batteryHeat, polarization: this.polarization, capacitors: this.capacitors, inductors: this.inductors, contactors: this.contactors, storedChange: this.storedChange });
  }
  boundaryTime(project: Project, electrical: ElectricalResult, h: number) {
    if (!this.active) return h;
    let limit = h;
    for (const c of project.components.filter(c => c.kind === 'hybridInverter' || c.kind === 'gridInverter')) {
      const s = this.hybrid[c.id], r = electrical.readings[c.id]?.hybrid;
      if (!s || !r) continue;
      const remaining = !r.connected && !r.backupAvailable ? prop(c, 'transferTime') - (s.connected ? 0 : s.outageElapsed) : r.gridValid && !r.connected ? prop(c, 'reconnectDelay') - (s.gridValid ? s.gridStable : 0) : Infinity;
      if (remaining > 1e-9) limit = Math.min(limit, remaining);
    }
    for (const c of project.components.filter(c => (c.kind === 'battery' || c.kind === 'lfpBattery'))) {
      const soc = this.batteries[c.id], rate = batteryChargeStep(c, soc, electrical.readings[c.id]?.current ?? 0, 1) - soc;
      const next = soc + rate * h;
      if (c.kind === 'lfpBattery' && Math.abs(rate) > 1e-15) {
        // Resolve a small pack's chemical timescale in fixed as well as adaptive runs.
        // The exact mean-OCV model integrates slope changes without artificial knee events.
        limit = Math.min(limit, 0.002 / Math.abs(rate));

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
    return Math.min(limit, hybridEventLimit(project, this.hybrid));
  }
  advance(project: Project, electrical: ElectricalResult, h: number, temperatures: Record<string, number> = {}) {
    if (!this.active) return;
    advanceSolar(project, this.solar, electrical, h);
    advanceHybrid(project, this.hybrid, electrical, h);
    for (const c of project.components) {
      const r = electrical.readings[c.id];
      if ((c.kind === 'battery' || c.kind === 'lfpBattery') && r) {
        this.batteryHeat[c.id] = (this.batteryHeat[c.id] ?? 0) + (r.heatPower ?? 0) * h;
        const before = this.batteries[c.id], next = batteryChargeStep(c, before, r.current, h);
        if (next < -1e-9 || next > 1 + 1e-9) throw Error(`${c.name}: battery charge left its physical bounds.`);
        this.batteries[c.id] = Math.max(0, Math.min(1, next));
        this.storedChange += batteryEnergyChange(c, before, this.batteries[c.id]);
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
 * charge. NMC/graphite (3.0–4.2 V per cell) rises steeply from empty, then gently. LFP is a rested open-circuit table,
 * 2.5–3.40 V per cell: steep below 20 %, a flat plateau, and a top knee from 3.35 V at 99 % to 3.40 V at 100 %. The
 * 3.65 V charge cut-off is not an open-circuit voltage; it belongs to charger settings and terminal polarization.
 * Typical cell data, not a specific manufacturer's.
 */
// Rested 4-cell (12.8 V nominal) LFP table, 10.0–13.6 V, normalized to the empty–full span.
const LFP_REST_12V: [number, number][] = [[0, 10], [0.09, 12], [0.14, 12.5], [0.17, 12.8], [0.2, 12.9], [0.3, 13], [0.4, 13.1], [0.7, 13.2], [0.9, 13.3], [0.99, 13.4], [1, 13.6]];
const OCV_CURVES: Record<string, [number[], number[]]> = {
  linear: [[0, 1], [0, 1]],
  nmc: [[0, 0.05, 0.1, 0.2, 0.4, 0.6, 0.8, 1], [0, 0.375, 0.458, 0.517, 0.6, 0.708, 0.833, 1]],
  lfp: [LFP_REST_12V.map(([s]) => s), LFP_REST_12V.map(([, v]) => (v - 10) / 3.6)],
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
/** Stable exact integral over the actual SOC interval; avoids subtracting two large stored energies. */
export function batteryEnergyChange(c: Component, from: number, to: number) {
  const [s, f] = ocvCurve(c), lo = Math.max(0, Math.min(1, Math.min(from, to))), hi = Math.max(0, Math.min(1, Math.max(from, to)));
  const span = prop(c, 'fullVoltage') - prop(c, 'emptyVoltage'); let area = 0;
  for (let k = 0; k + 1 < s.length; k++) {
    const a = Math.max(lo, s[k]), b = Math.min(hi, s[k + 1]); if (b <= a) continue;
    const slope = (f[k + 1] - f[k]) / (s[k + 1] - s[k]);
    const va = prop(c, 'emptyVoltage') + span * (f[k] + slope * (a - s[k]));
    const vb = prop(c, 'emptyVoltage') + span * (f[k] + slope * (b - s[k]));
    area += (va + vb) * .5 * (b - a);
  }
  return Math.sign(to - from) * 3600 * prop(c, 'capacityAh') * area;
}
/** Exact mean OCV and its tangent versus accepted mean current, including OCV knees. */
export function batteryAverageOCV(c: Component, soc: number, current: number, h: number) {
  const q = 3600 * prop(c, 'capacityAh'), unconstrained = batteryChargeStep(c, soc, current, h), next = Math.max(0, Math.min(1, unconstrained)), ds = next - soc;
  const midpoint = batteryOCV(c, (soc + next) * .5);
  const mean = ds !== 0 ? batteryEnergyChange(c, soc, next) / (q * ds) : midpoint.voltage;
  const derivative = Math.abs(ds) > 1e-8 ? (batteryOCV(c, next).voltage - mean) / ds : midpoint.slope * .5;
  const retention = current >= 0 ? prop(c, 'coulombicEfficiency') / 100 : 1;
  return { voltage: mean, resistance: unconstrained > 1 || unconstrained < 0 ? 0 : derivative * retention * h / q };
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
