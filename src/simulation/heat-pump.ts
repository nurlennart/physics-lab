/**
 * Bosch Compress 6800i AW 7 OR-S air-to-water heat pump (R290, inverter compressor) with the indoor unit's electric
 * backup heater. Published data: heat-pump-data.ts. Model, fitting procedure and limits: docs/HEAT-PUMP.md.
 *
 * Quasi-steady vapour-compression cycle, evaluated once per coupled substep:
 *  - evaporator: T_e = T_air − (Q_e − R)/UA_e,eff; UA_e,eff = UA_e·f_fan/(1 + m_frost/m_ref) (R: heat released by a
 *    coil warmer than T_e after a defrost);
 *  - compressor: refrigerant mass flow ∝ speed × suction density, Q_e = s·K·p_sat(T_e)/T_e (ideal-gas suction vapour);
 *  - condenser: T_c = T_water + Q_c/UA_c;
 *  - P_comp = Q_e·(T_c − T_e)/(η·T_e): a fraction η(s, Π) = η₀·(1 − k_s(s − s₀)²)·g(ln(Π/Π₀)) of the reversed-Carnot
 *    cooling COP, Π = p_sat(T_c)/p_sat(T_e), g(x) = 1 − k_Π·x² inside the fitted range |x| ≤ 0.8, continued linearly;
 *  - all compressor and drive input reaches the refrigerant: Q_c = Q_e + P_comp.
 * No COP or capacity is prescribed: both follow from speed, air and water temperature, frost and the electrical limit.
 * Energy: terminal input P_el = P_comp + P_fan + P_controls + P_crankcase. The water receives Q_c, the outdoor air
 * (or a Thermal Space) supplies Q_e − R and receives fan, controls and crankcase heat; the coil stores C·T_coil.
 */
import { prop, textProp, type Component } from './model';
import { bosch } from './heat-pump-data';
import type { Simulation } from './engine';

// — R290 saturation and moist air ————————————————————————————————————————————————
/** R290 saturation pressure (bar) at T (K): Clausius–Clapeyron fit through 4.74 bar at 0 °C and 21.2 bar at 60 °C (NIST). */
export const r290Pressure = (T: number) => Math.exp(9.874 - 2272 / T);
/** R290 saturation temperature (K) at p (bar). */
export const r290Temperature = (p: number) => 2272 / (9.874 - Math.log(p));
/** Saturation vapour pressure over water / ice (Pa), Magnus form (WMO 2008), t in °C. */
export const vapourPressureWater = (t: number) => 611.2 * Math.exp(17.62 * t / (243.12 + t));
export const vapourPressureIce = (t: number) => 611.2 * Math.exp(22.46 * t / (272.62 + t));
const ATMOSPHERE = 101325, AIR_CP = 1006, LATENT_FUSION = 333.55e3, LATENT_EVAPORATION = 2.47e6;
const humidityRatio = (pv: number) => 0.622 * pv / (ATMOSPHERE - pv);

// — Fitted and assumed cycle constants ————————————————————————————————————————————
/**
 * Fitted to the `fit` points of `ratingPoints` (least squares on relative COP error, the published capacity imposed):
 * η₀, k_s, s₀, k_Π, Π₀ and the displacement K. Heat-exchanger conductances and fan power were fixed beforehand as
 * assumptions, so evaporating and condensing temperatures stay physical (they drive frost formation).
 */
export const cycle = {
  eta0: 0.509133, speedCurvature: 0.653893, bestSpeed: 0.740688, ratioCurvature: 0.647567, bestRatio: 2.66027,
  /** Q_e = s·K·p_sat(T_e)/T_e with p in bar (W·K/bar per unit s). */
  displacement: 204474,
  /** s at the A7/W35 maximum point: defines 100 % compressor speed. */
  speedScale: 1.52915,
  /** Assumed: plate condenser UA (W/K), finned-coil evaporator UA at full fan (W/K), fan power at full speed (W). */
  condenserUA: 2000, evaporatorUA: 750, fanPower: 40,
  /** Fan airflow follows the compressor: f_fan = 0.3 + 0.7·min(1, s) (assumption). */
  fanBase: 0.3,
  /** Lower bound of the Carnot fraction; reached only far outside the published envelope. */
  minEfficiency: 0.15,
};
/** Minimum compressor speed: Bosch modulation range at A2/W35 starts at 1.8 kW (fraction of 100 % speed). */
export const MIN_SPEED = 0.2657;
/** Maximum speed back-calculated from the A−10/W35 maximum output (95.15 %): the firmware limits speed below −7 °C. Held below −10 °C (assumption). */
export const maxSpeed = (air: number) => air >= -7 ? 1 : air <= -10 ? 0.9515 : 0.9515 + (air + 10) / 3 * (1 - 0.9515);
/** Electrical input limit (W) from the published maximum current at the terminal voltage, cos φ 0.99. */
export const electricalLimit = (c: Component, voltage: number) => prop(c, 'maxCurrent') * Math.max(0, voltage) * bosch.powerFactor;
/** Maximum flow temperature (°C) of the heating envelope at outdoor air `air` (°C), heat pump only; NaN outside. */
export function envelopeMaxFlow(air: number) {
  const e = bosch.envelope;
  if (air < e[0][0] || air > e[e.length - 1][0]) return NaN;
  for (let i = 1; i < e.length; i++) if (air <= e[i][0]) return e[i - 1][1] + (e[i][1] - e[i - 1][1]) * (air - e[i - 1][0]) / (e[i][0] - e[i - 1][0]);
  return e[e.length - 1][1];
}
/** High-pressure switch: assumed 31 bar for R290 (condensing ≈ 79.6 °C). Low-pressure cut-out: assumed 1.2 bar (≈ −36 °C). */
export const HIGH_PRESSURE = 31, LOW_PRESSURE = 1.2;
/** Low-evaporating-temperature protection: air more than 20 K above T_e (blocked coil, failed fan). Assumption. */
export const MAX_EVAPORATOR_APPROACH = 20;

const kelvin = (t: number) => t + 273.15;
/** Pressure-ratio factor: quadratic in ln(Π/Π₀) over the fitted range (|x| ≤ 0.8), tangent-linear beyond it. */
function ratioFactor(ratio: number) {
  const x = Math.abs(Math.log(ratio / cycle.bestRatio)), edge = 0.8;
  return 1 - cycle.ratioCurvature * (x <= edge ? x * x : edge * edge + 2 * edge * (x - edge));
}
function efficiency(s: number, ratio: number) {
  return Math.max(cycle.minEfficiency, cycle.eta0 * (1 - cycle.speedCurvature * (s - cycle.bestSpeed) ** 2) * ratioFactor(ratio));
}
/** Saturated suction capacity: T_e (K) at which `ua·(source − T_e) + extra = s·K·p_sat(T_e)/T_e` (bisection; f decreasing in T_e). */
function evaporating(s: number, sourceK: number, ua: number, extra: number) {
  let lo = 150, hi = sourceK + Math.max(0, extra) / ua;
  if (s <= 0) return hi;
  for (let k = 0; k < 64; k++) {
    const t = (lo + hi) / 2;
    if (ua * (sourceK - t) + extra - s * cycle.displacement * r290Pressure(t) / t > 0) lo = t; else hi = t;
  }
  return (lo + hi) / 2;
}
/** Condenser duty for evaporator duty qe at T_e (K) into a sink at sinkK; fixed point on T_c (contraction ~P/(UA_c·T_e)). */
function condense(s: number, qe: number, Te: number, sinkK: number, ua: number, minRatio = 1) {
  const floor = minRatio > 1 ? r290Temperature(minRatio * r290Pressure(Te)) : Te;
  let qc = qe * 1.3, Tc = sinkK;
  for (let k = 0; k < 60; k++) {
    Tc = Math.max(sinkK + qc / ua, floor, Te + 1e-6);
    const next = qe * (1 + (Tc - Te) / (efficiency(s, r290Pressure(Tc) / r290Pressure(Te)) * Te));
    if (Math.abs(next - qc) <= 1e-11 * Math.max(1, next)) { qc = next; break; }
    qc = next;
  }
  return { qc, Tc };
}

export interface CyclePoint {
  /** Compressor speed (fraction of 100 %), evaporating and condensing temperatures (°C), pressure ratio. */
  speed: number; evaporating: number; condensing: number; ratio: number;
  /** Refrigerant-side evaporator duty, condenser duty (W, into water), compressor electrical input, fan input (W). */
  evaporator: number; condenser: number; compressor: number; fan: number; fanFraction: number;
}
/**
 * Heating-mode operating point at compressor speed `speed`, outdoor air `air` and water `water` (°C).
 * `frostFactor` = UA_frosted/UA_clean; `release` = coil heat released to the refrigerant (W); `fanFactor` scales the
 * airflow (0 with a failed fan: natural convection only, 8 % of the conductance — assumption).
 */
export function heatingPoint(speed: number, air: number, water: number, frostFactor = 1, release = 0, fanFactor = 1): CyclePoint {
  if (!(speed > 0)) return { speed: 0, evaporating: air, condensing: water, ratio: 1, evaporator: 0, condenser: 0, compressor: 0, fan: 0, fanFraction: 0 };
  const s = speed * cycle.speedScale, fanFraction = (cycle.fanBase + (1 - cycle.fanBase) * Math.min(1, s)) * fanFactor;
  const ua = cycle.evaporatorUA * Math.max(0.08, fanFraction) * frostFactor;
  const Te = evaporating(s, kelvin(air), ua, release), qe = s * cycle.displacement * r290Pressure(Te) / Te;
  const { qc, Tc } = condense(s, qe, Te, kelvin(water), cycle.condenserUA);
  return { speed, evaporating: Te - 273.15, condensing: Tc - 273.15, ratio: r290Pressure(Tc) / r290Pressure(Te), evaporator: qe, condenser: qc, compressor: qc - qe, fan: cycle.fanPower * fanFraction ** 3, fanFraction };
}
/**
 * Reverse-cycle defrost at speed `speed`: refrigerant evaporates against the water (condenser plate heat exchanger,
 * UA_c) and condenses in the outdoor coil at `coil` (°C). The expansion valve holds a minimum pressure ratio of 1.8
 * (assumption) so the compressor keeps a lift even when the water is warmer than the coil.
 */
export function defrostPoint(speed: number, water: number, coil: number) {
  if (!(speed > 0)) return { water: 0, coil: 0, compressor: 0, evaporating: water, condensing: coil };
  const s = speed * cycle.speedScale, Te = evaporating(s, kelvin(water), cycle.condenserUA, 0), qe = s * cycle.displacement * r290Pressure(Te) / Te;
  const { qc, Tc } = condense(s, qe, Te, kelvin(coil), cycle.condenserUA, 1.8);
  return { water: qe, coil: qc, compressor: qc - qe, evaporating: Te - 273.15, condensing: Tc - 273.15 };
}
/** Speed (fraction) at which the heating condenser duty equals `output` W; NaN when out of [0, 1]. For calibration and tests. */
export function speedForOutput(output: number, air: number, water: number) {
  let lo = 0, hi = 1.2;
  if (heatingPoint(hi, air, water).condenser < output) return NaN;
  for (let k = 0; k < 80; k++) { const n = (lo + hi) / 2; if (heatingPoint(n, air, water).condenser < output) lo = n; else hi = n; }
  return (lo + hi) / 2;
}
/** EN 14511-style COP of a heating point: condenser output over compressor, fan and controls input. */
export const pointCOP = (p: CyclePoint, controls: number = bosch.standbyPower) => p.condenser / (p.compressor + p.fan + controls);

/** Share of the evaporator's thermal resistance on the refrigerant side (tube wall and boiling film; assumption). */
export const REFRIGERANT_SHARE = 0.35;
/** Fin/frost surface temperature (°C): between T_e and the air by the refrigerant-side resistance share. */
export const coilSurface = (air: number, evaporatingTemperature: number) => evaporatingTemperature + REFRIGERANT_SHARE * (air - evaporatingTemperature);
/**
 * Frost deposition rate (kg/s) on a coil surface below 0 °C from moist air (ε-NTU mass transfer, Lewis number 1):
 * ṁ = ṁ_air·ε·max(0, ω_air − ω_sat,ice(T_s)), ε = 1 − exp(−UA_air/(ṁ_air·c_p)), UA_air = UA/(1 − refrigerant share).
 */
export function frostRate(c: Component, air: number, evaporatingTemperature: number, fanFraction: number, ua: number) {
  const surface = coilSurface(air, evaporatingTemperature);
  if (surface >= 0 || fanFraction <= 0) return 0;
  const density = ATMOSPHERE / (287.05 * kelvin(air)), mass = density * bosch.airFlow / 3600 * fanFraction;
  const effectiveness = 1 - Math.exp(-ua / (1 - REFRIGERANT_SHARE) / (mass * AIR_CP));
  const humidity = Math.max(0, Math.min(100, prop(c, 'relativeHumidity'))) / 100;
  const ambient = humidityRatio(humidity * vapourPressureWater(air)), saturated = humidityRatio(vapourPressureIce(surface));
  return mass * effectiveness * Math.max(0, ambient - saturated);
}
/** Conductance factor of the coil frost (blocks air and adds conduction resistance). Refrozen base-pan ice lies below the
 * coil, out of the airflow: it costs defrost energy but does not block the coil. */
export const frostFactor = (c: Component, frost: number) => 1 / (1 + Math.max(0, frost) / prop(c, 'frostReference'));
/**
 * Defrost and crankcase constants (assumptions, see docs/HEAT-PUMP.md § Defrost calibration):
 * natural convection of the stopped finned coil (≈ 40 m² fins at 2.5 W/(m²·K)); compressor shell capacity and loss
 * conductance, with the thermostat margin chosen so that the 75 W heater's duty-cycled average equals the 32 W ErP
 * P_CK at the margin (3.2 W/K × 10 K); plate-exchanger freeze margin of the refrigerant during the reverse cycle.
 */
export const COIL_STILL_UA = 100, SHELL_CAPACITY = 6000, SHELL_UA = 3.2, CRANKCASE_MARGIN = 10, CRANKCASE_HYSTERESIS = 2, PLATE_FREEZE_MARGIN = 2;

// — Runtime state and controller ——————————————————————————————————————————————————
export type HeatPumpMode = 'off' | 'heating' | 'defrost' | 'drip';
export interface HeatPumpState {
  mode: HeatPumpMode;
  /** Compressor speed at the end of the last accepted substep (fraction of 100 %) and the controller's command. */
  speed: number; command: number; integral: number;
  /** Condenser plate/refrigerant/backup-heater node (K), lumped like the boiler element. */
  elementTemperature: number;
  /** Outdoor coil temperature (°C) and accumulated frost (kg). */
  coilTemperature: number; frost: number;
  /** Refrozen meltwater in the base pan below the coil (kg), cleared only by intensive defrosts; frost melted in the current defrost (kg). */
  residualIce: number; meltedThisDefrost: number;
  /** Meltwater retained on fins and base pan during a defrost (kg); what does not evaporate refreezes as residual ice. */
  film: number;
  /** Current defrost is an intensive (hot-gas) cycle; compressor shell temperature (°C) and crankcase heater state. */
  intensive: boolean; shellTemperature: number; crankcaseOn: boolean;
  /** Event times (s): last start, last stop, start history (last hour), defrost start/end, drip end, supply healthy since. */
  startedAt: number; stoppedAt: number; starts: number[]; defrostStart: number; lastDefrostEnd: number; dripUntil: number; restartAt: number;
  lowFlowSince: number; shortfallSince: number;
  /** Electric backup heater stages (×3 kW) and its latched overheat protection. */
  backupStages: number; backupFault: boolean;
  /** Latched compressor fault after repeated pressure trips; recent trip times. */
  fault: '' | 'high pressure' | 'low pressure'; trips: number[];
  ambientLock: boolean; demand: boolean; frostProtection: boolean;
  resetPrevious: boolean; defrostPrevious: boolean; manualDefrost: boolean;
  /** Effective compressor flow target (envelope and frost protection applied) and the requested target (°C). */
  target: number; requested: number; status: string;
  /** Cumulative energies (J) and counters. */
  heat: number; defrostHeat: number; electricity: number; backupHeat: number; environment: number; defrosts: number; startCount: number;
  /** Hot-water mode: charging the cylinder (VW1 to B), since when, blocked until (after a time-out), cylinder sensor (°C),
   *  charges started, and heat/electricity while charging (J). */
  dhw: boolean; dhwSince: number; dhwBlockedUntil: number; dhwTank: number; dhwCharges: number; dhwHeat: number; dhwElectricity: number;
}
export const newHeatPump = (c: Component, air: number): HeatPumpState => ({
  mode: 'off', speed: 0, command: 0, integral: 0, elementTemperature: kelvin(prop(c, 'initialTemperature')), coilTemperature: air, frost: 0, residualIce: 0, meltedThisDefrost: 0, film: 0, intensive: false, shellTemperature: air, crankcaseOn: false,
  startedAt: -Infinity, stoppedAt: -Infinity, starts: [], defrostStart: -Infinity, lastDefrostEnd: -Infinity, dripUntil: -Infinity, restartAt: prop(c, 'powerOnDelay'),
  lowFlowSince: Infinity, shortfallSince: Infinity, backupStages: 0, backupFault: false, fault: '', trips: [], ambientLock: false, demand: false, frostProtection: false,
  resetPrevious: false, defrostPrevious: false, manualDefrost: false, target: prop(c, 'setpoint'), requested: prop(c, 'setpoint'), status: 'Power-on check',
  heat: 0, defrostHeat: 0, electricity: 0, backupHeat: 0, environment: 0, defrosts: 0, startCount: 0,
  dhw: false, dhwSince: -Infinity, dhwBlockedUntil: -Infinity, dhwTank: NaN, dhwCharges: 0, dhwHeat: 0, dhwElectricity: 0,
});
/** Flow target (°C): fixed setpoint, or the linear heating curve through (20 °C, foot point) and (design outdoor, design flow). */
export function heatPumpTarget(c: Component, air: number, wired?: number) {
  if (wired !== undefined) return wired;
  if (textProp(c, 'targetMode', 'fixed') !== 'curve') return prop(c, 'setpoint');
  const foot = prop(c, 'curveFootFlow'), design = prop(c, 'curveDesignFlow'), outdoor = prop(c, 'curveDesignOutdoor');
  const x = Math.max(0, Math.min(1, (20 - air) / Math.max(1e-9, 20 - outdoor)));
  return foot + (design - foot) * x;
}
/** Measured inputs of one control evaluation. */
export interface HeatPumpInputs { water: number; air: number; flow: number; voltage: number; powered: boolean; backupVoltage: number; condensing: number; evaporating: number; fanFailed?: boolean }

/** Controller decisions at an accepted substep boundary `now`. Faults never release latched protections. */
export function controlHeatPump(s: Simulation, c: Component, st: HeatPumpState, now: number, x: HeatPumpInputs) {
  const wired = (port: string) => s.project.connections.some(w => w.domain === 'control' && w.to.component === c.id && w.to.port === port);
  const enable = s.automation.input(c, 'enable', s), set = s.automation.input(c, 'setpoint', s), reset = s.automation.input(c, 'reset', s), defrost = s.automation.input(c, 'defrost', s);
  const requested = wired('enable') ? enable.valid && enable.value === true : c.props.enabled === true;
  const validTarget = !wired('setpoint') || set.valid && typeof set.value === 'number';
  const fault = s.faults[c.id];
  const manualReset = reset.valid && reset.value === true;
  if (manualReset && !st.resetPrevious) resetHeatPump(s, c, st);
  st.resetPrevious = manualReset;
  const manualDefrost = defrost.valid && defrost.value === true;
  if (manualDefrost && !st.defrostPrevious && st.mode === 'heating' && x.air < 15) st.manualDefrost = true;
  st.defrostPrevious = manualDefrost;
  st.starts = st.starts.filter(t => now - t < 3600 - 1e-9);
  st.trips = st.trips.filter(t => now - t < 3600 - 1e-9);
  // Outdoor cut-out with restart hysteresis [IM §10.2].
  if (x.air <= bosch.cutout.low || x.air >= bosch.cutout.high) st.ambientLock = true;
  else if (st.ambientLock && x.air > bosch.cutout.lowRestart && x.air < bosch.cutout.highRestart) st.ambientLock = false;
  const envelope = envelopeMaxFlow(x.air);
  // Hot-water mode [OWN]: a charge starts when the cylinder sensor falls to the start temperature and ends at the stop
  // temperature; meanwhile VW1 diverts the flow to the cylinder and the flow target is the cylinder temperature plus the
  // charging differential (Ladedelta). Hot water has priority over heating; a charge longer than the maximum time ends
  // and blocks hot water for the same time so the house recovers (assumption).
  const tankInput = s.automation.input(c, 'dhwSensor', s);
  const tank = wired('dhwSensor') && tankInput.valid && typeof tankInput.value === 'number' ? tankInput.value : NaN;
  st.dhwTank = tank;
  const dhwAllowed = c.props.hotWater === true && Number.isFinite(tank) && fault !== 'controlLost' && !st.fault;
  if (st.dhw) {
    const timedOut = now - st.dhwSince >= prop(c, 'dhwMaxTime') - 1e-9;
    if (!dhwAllowed || tank >= prop(c, 'dhwStop') || timedOut) {
      st.dhw = false;
      if (timedOut && dhwAllowed && tank < prop(c, 'dhwStop')) { st.dhwBlockedUntil = now + prop(c, 'dhwMaxTime'); s.log(`${c.name}: hot-water charge ended at its ${(prop(c, 'dhwMaxTime') / 60).toFixed(0)} min limit (cylinder ${tank.toFixed(1)} °C) — heating has priority for the same time.`, 'warning'); }
      else s.log(`${c.name}: hot water ${Number.isFinite(tank) && tank >= prop(c, 'dhwStop') ? `charged to ${tank.toFixed(1)} °C` : 'charge cancelled'} — valve back to heating.`, 'info');
    }
  } else if (dhwAllowed && tank <= prop(c, 'dhwStart') && now >= st.dhwBlockedUntil - 1e-9 && st.mode !== 'defrost' && st.mode !== 'drip') {
    st.dhw = true; st.dhwSince = now; st.dhwCharges++;
    s.log(`${c.name}: hot-water demand (cylinder ${tank.toFixed(1)} °C ≤ ${prop(c, 'dhwStart')} °C) — valve to the cylinder.`, 'info');
  }
  const dhwTarget = Math.min(bosch.maxFlow, tank + prop(c, 'dhwDelta'));
  const requestedTarget = st.dhw ? dhwTarget : Math.max(10, Math.min(bosch.maxFlow, heatPumpTarget(c, x.air, wired('setpoint') && validTarget ? Number(set.value) : undefined)));
  st.requested = requestedTarget;
  // Frost protection of the water circuit (assumption: start below 5 °C, hold until 15 °C).
  if (x.water < 5) st.frostProtection = true; else if (x.water > 15) st.frostProtection = false;
  const target = st.frostProtection ? Math.max(requestedTarget, 15) : requestedTarget;
  const compressorTarget = Number.isFinite(envelope) ? Math.min(target, envelope) : target;
  st.target = compressorTarget;
  const running = st.mode === 'heating' || st.mode === 'defrost';
  const supply = x.powered && now >= st.restartAt && fault !== 'failedOpen';
  const enabled = (requested || st.frostProtection || st.dhw) && (validTarget || st.dhw) && fault !== 'controlLost';
  // Heating request with start/stop hysteresis; the stop also waits for minimum speed and the minimum run time.
  if (!running && st.mode !== 'drip') st.demand = x.water <= compressorTarget - prop(c, 'startDifference');
  else if (st.mode === 'heating' && x.water >= compressorTarget + prop(c, 'stopDifference') && st.command <= MIN_SPEED + 1e-9 && now - st.startedAt >= prop(c, 'minRunTime') - 1e-9) st.demand = false;
  const flowOK = x.flow >= prop(c, 'minFlow');
  st.lowFlowSince = running && !flowOK ? Math.min(st.lowFlowSince, now) : Infinity;
  const stop = (status: string) => {
    if (running) { st.stoppedAt = now; }
    st.mode = 'off'; st.speed = 0; st.command = 0; st.integral = 0; st.status = status; st.manualDefrost = false;
  };
  const block = !supply ? (!x.powered ? 'Undervoltage / no supply' : now < st.restartAt ? 'Power-on check (2 min)' : 'Supply failed') : !enabled ? (validTarget && fault !== 'controlLost' ? 'Disabled' : 'Control unavailable')
    : st.fault ? `Locked out: ${st.fault} (manual reset)` : st.ambientLock ? 'Outdoor temperature outside −23…45 °C' : !Number.isFinite(envelope) ? 'Outside operating envelope' : '';
  if (block) stop(block);
  else if (running && x.condensing >= r290Temperature(HIGH_PRESSURE) - 273.15) trip('high pressure');
  else if (running && st.mode === 'heating' && (x.evaporating <= r290Temperature(LOW_PRESSURE) - 273.15 || x.air - x.evaporating >= MAX_EVAPORATOR_APPROACH)) trip('low pressure');
  else if (running && !flowOK && now - st.lowFlowSince >= prop(c, 'flowDelay') - 1e-9) stop('Low flow — compressor stopped');
  else if (st.mode === 'drip') {
    if (now >= st.dripUntil - 1e-9) { st.mode = st.demand ? 'heating' : 'off'; st.speed = 0; st.status = st.demand ? 'Heating (after defrost)' : 'Standby'; if (!st.demand) st.stoppedAt = now; }
    else st.status = 'Defrost: drip time';
  } else if (st.mode === 'defrost') {
    // Normal defrost: frost melted and the coil at its end temperature. Intensive (hot-gas) defrost: frost and residual
    // ice melted, the coil at the higher end temperature and the firmware's minimum duration elapsed.
    const elapsed = now - st.defrostStart, intensive = st.intensive;
    const done = intensive
      ? st.frost <= 1e-9 && st.residualIce <= 1e-9 && st.coilTemperature >= prop(c, 'intensiveEndTemperature') - 1e-9 && elapsed >= prop(c, 'intensiveMinTime') - 1e-9
      : st.frost <= 1e-9 && st.coilTemperature >= prop(c, 'defrostEndTemperature') - 1e-9;
    const timeout = elapsed >= prop(c, intensive ? 'intensiveMaxTime' : 'maxDefrostTime') - 1e-9;
    // Freeze protection of the plate exchanger: the refrigerant evaporating against the water must stay above +2 °C, and the water above 5 °C.
    const cold = x.water < 5 || x.evaporating < PLATE_FREEZE_MARGIN, starved = x.flow < bosch.defrostMinFlow / 60000;
    if (done || timeout || cold || starved) {
      // Retained meltwater that did not evaporate refreezes in the base pan and lower coil rows.
      st.residualIce += st.film; st.film = 0;
      st.mode = 'drip'; st.speed = 0; st.lastDefrostEnd = now; st.dripUntil = now + prop(c, 'dripTime'); st.manualDefrost = false;
      const kind = intensive ? 'Intensive defrost' : 'Defrost';
      st.status = done ? `${kind} complete` : timeout ? `${kind} ended: time limit` : cold ? `${kind} aborted: plate exchanger freeze protection` : `${kind} aborted: flow below 14 l/min`;
      if (!done) s.log(`${c.name}: ${st.status.toLowerCase()} (${st.frost.toFixed(2)} kg frost, ${st.residualIce.toFixed(2)} kg residual ice left).`, 'warning');
    } else st.status = `${intensive ? 'Intensive defrost' : 'Defrost'}: ${st.frost > 1e-9 ? 'melting frost' : intensive && st.residualIce > 1e-9 ? 'melting base-pan ice' : intensive && st.coilTemperature >= prop(c, 'intensiveEndTemperature') - 1e-9 ? 'holding hot gas' : 'warming coil'}`;
  } else if (st.mode === 'heating') {
    const due = st.frost >= prop(c, 'frostTrigger') && now - st.lastDefrostEnd >= prop(c, 'minDefrostInterval') - 1e-9 && now - st.startedAt >= 120 - 1e-9;
    if ((due || st.manualDefrost) && x.flow >= bosch.defrostMinFlow / 60000) {
      st.defrosts++; st.intensive = Math.round(prop(c, 'intensiveEvery')) > 0 && st.defrosts % Math.round(prop(c, 'intensiveEvery')) === 0;
      st.mode = 'defrost'; st.defrostStart = now; st.meltedThisDefrost = 0; st.integral = 0;
      st.speed = Math.min(st.speed, prop(c, st.intensive ? 'intensiveSpeed' : 'defrostSpeed') / 100);
      st.status = st.intensive ? 'Intensive defrost: reversing cycle' : 'Defrost: reversing cycle';
    } else if (!st.demand) stop('At temperature');
    else if (st.frost >= 2 * prop(c, 'frostTrigger') && x.flow < bosch.defrostMinFlow / 60000) stop('Evaporator iced: defrost needs 14 l/min');
    else st.status = due ? 'Defrost postponed: flow below 14 l/min' : st.frost > 0.01 ? `Heating · frost ${(st.frost * 1000).toFixed(0)} g` : 'Heating';
  } else if (st.demand) {
    const sinceStop = now - st.stoppedAt, budget = st.starts.length < Math.round(prop(c, 'maxStarts'));
    if (!flowOK) st.status = 'Waiting for flow';
    else if (sinceStop < prop(c, 'minOffTime') - 1e-9) st.status = 'Restart inhibit (minimum off time)';
    else if (!budget) st.status = `Start limit: ${Math.round(prop(c, 'maxStarts'))} starts per hour`;
    else { st.mode = 'heating'; st.speed = 0; st.integral = 0; st.startedAt = now; st.starts.push(now); st.startCount++; st.status = 'Compressor start'; }
  } else st.status = 'Standby';
  // Crankcase heater: a thermostat holds the stopped compressor shell 10 ± 1 K above the outdoor air below
  // the enabling air temperature; the 75 W element's duty-cycled average is then the 32 W ErP P_CK.
  // The band is centred on the margin, so the duty-cycled average is SHELL_UA × margin; the power-on check does not block it.
  const stopped = st.mode === 'off' || st.mode === 'drip', heaterAllowed = stopped && x.powered && fault !== 'failedOpen' && x.air < prop(c, 'crankcaseBelow');
  if (!heaterAllowed || st.shellTemperature >= x.air + CRANKCASE_MARGIN + CRANKCASE_HYSTERESIS / 2) st.crankcaseOn = false;
  else if (st.shellTemperature <= x.air + CRANKCASE_MARGIN - CRANKCASE_HYSTERESIS / 2) st.crankcaseOn = true;
  // Inverter speed command: PI on the outlet temperature, limited to [minimum, maximum] speed.
  if (st.mode === 'heating') {
    const top = maxSpeed(x.air), error = compressorTarget - x.water;
    st.command = Math.max(MIN_SPEED, Math.min(top, MIN_SPEED + prop(c, 'proportionalGain') * error + st.integral));
  } else st.command = st.mode === 'defrost' ? prop(c, st.intensive ? 'intensiveSpeed' : 'defrostSpeed') / 100 : 0;
  // Electric backup heater [IDU]: sole heating while the compressor cannot run or cannot reach the target, bivalent
  // support after a delay at maximum speed, defrost assist on cold water and frost protection. Switched off at the
  // target; never above 74 °C or without flow (dry-firing).
  const stages = Math.round(prop(c, 'backupStages'));
  const backupAllowed = stages > 0 && !st.backupFault && enabled && flowOK && x.backupVoltage >= prop(c, 'minVoltage') && x.water < bosch.maxFlow - 1;
  const short = x.water < target - prop(c, 'startDifference');
  if (st.mode === 'heating' && st.command >= maxSpeed(x.air) - 1e-6 && (short || st.backupStages > 0 && x.water < target)) st.shortfallSince = Math.min(st.shortfallSince, now);
  else if (st.mode !== 'heating' || x.water >= target) st.shortfallSince = Infinity;
  const compressorUnavailable = enabled && supply && (!!st.fault || st.ambientLock || !Number.isFinite(envelope) || target > compressorTarget + 0.5);
  // Each reason has its own hysteresis: sole heating runs from target − start difference up to the target; bivalent
  // stages follow the shortfall timer (the compressor at maximum speed for the backup delay); defrost assist on water
  // below 20 °C; frost protection while it is active.
  let want = 0;
  if (compressorUnavailable && (short || st.backupStages > 0 && x.water < target)) want = stages;
  if (Number.isFinite(st.shortfallSince)) want = Math.max(want, now - st.shortfallSince >= 2 * prop(c, 'backupDelay') - 1e-9 ? stages : now - st.shortfallSince >= prop(c, 'backupDelay') - 1e-9 ? 1 : 0);
  // Bivalent stages already on stay on until the target is reached while the compressor is still at its limit.
  if (st.backupStages > 0 && st.mode === 'heating' && st.command >= maxSpeed(x.air) - 1e-6 && x.water < target) want = Math.max(want, st.backupStages);
  if (st.mode === 'defrost' && x.water < 20) want = Math.max(want, 1);
  if (st.frostProtection) want = Math.max(want, 1);
  st.backupStages = backupAllowed ? Math.min(stages, want) : 0;
  if (st.backupStages) st.status += ` · backup ${st.backupStages * 3} kW`;
  function trip(kind: 'high pressure' | 'low pressure') {
    st.trips.push(now);
    const latched = st.trips.length >= 3;
    if (latched) st.fault = kind;
    stop(latched ? `Locked out: ${kind} (manual reset)` : `${kind === 'high pressure' ? 'High' : 'Low'}-pressure trip — automatic restart`);
    s.log(`${c.name}: ${kind} switch opened${latched ? ' for the third time within an hour — locked out, manual reset required' : ''}.`, latched ? 'error' : 'warning');
  }
}
export function resetHeatPump(s: Simulation, c: Component, st: HeatPumpState): string | null {
  if (!st.fault && !st.backupFault) return 'Nothing to reset.';
  if (st.backupFault && st.elementTemperature - 273.15 >= prop(c, 'backupLimit') - 10) return `Let the backup heater cool below ${prop(c, 'backupLimit') - 10} °C before resetting its overheat protection.`;
  st.fault = ''; st.trips = []; st.backupFault = false;
  s.automation.status[c.id] = 'healthy';
  s.log(`${c.name}: protection manually reset.`, 'success');
  return null;
}

/** One substep's plan: average powers (W) over the substep from the speed ramp and the start-of-step temperatures. */
export interface HeatPumpPlan {
  mode: HeatPumpMode; speed0: number; speed1: number; point: CyclePoint;
  /** Electrical input of the outdoor unit (compressor, fan, controls, crankcase heater) and of the backup heater stages. */
  electrical: number; compressor: number; fan: number; controls: number; crankcase: number; backupStages: number;
  /** Heat into the water/condenser node (negative during defrost), from the coil to the refrigerant, from the outdoor air. */
  condenser: number; release: number; air: number;
  /** Defrost: heat delivered to the coil, coil loss to air (W). */
  coilHeat: number;
  frostRate: number; ua: number;
}
/** Plan the substep [t, t + h] from the state after `controlHeatPump`. h = 0: instantaneous point for paused readings. */
export function planHeatPump(c: Component, st: HeatPumpState, x: HeatPumpInputs, h: number): HeatPumpPlan {
  const rate = 1 / Math.max(1, prop(c, 'rampTime')), target = st.command;
  const speed0 = st.speed, speed1 = st.mode === 'heating' || st.mode === 'defrost' ? speed0 + Math.max(-rate * h, Math.min(rate * h, target - speed0)) : 0;
  let speed = (speed0 + speed1) / 2;
  const fanFactor = x.fanFailed ? 0 : 1;
  const controls = bosch.standbyPower, crankcase = (st.mode === 'off' || st.mode === 'drip') && st.crankcaseOn ? prop(c, 'crankcasePower') : 0;
  const frost = frostFactor(c, st.frost), limit = electricalLimit(c, x.voltage) - controls;
  const empty = (mode: HeatPumpMode): HeatPumpPlan => ({ mode, speed0, speed1, point: heatingPoint(0, x.air, x.water), electrical: controls + crankcase, compressor: 0, fan: 0, controls, crankcase, backupStages: st.backupStages, condenser: 0, release: 0, air: 0, coilHeat: 0, frostRate: 0, ua: 0 });
  if (st.mode === 'heating' && speed > 0) {
    // A coil warmer than T_e (after a defrost or a stop) releases its sensible heat to the refrigerant through
    // G = 0.2·UA_e (assumption): exact exponential average over the substep.
    const guess = heatingPoint(speed, x.air, x.water, frost, 0, fanFactor), g = 0.2 * cycle.evaporatorUA, C = prop(c, 'coilHeatCapacity');
    const excess = Math.max(0, st.coilTemperature - guess.evaporating);
    const release = h > 0 ? C * excess * -Math.expm1(-g * h / C) / h : g * excess;
    let point = heatingPoint(speed, x.air, x.water, frost, release, fanFactor), speedEnd = speed1;
    // Inverter input limit: 13.1 A at the terminal voltage [IM].
    if (point.compressor + point.fan > limit) {
      let lo = 0, hi = speed;
      for (let k = 0; k < 50; k++) { const n = (lo + hi) / 2, p = heatingPoint(n, x.air, x.water, frost, release, fanFactor); if (p.compressor + p.fan > limit) hi = n; else lo = n; }
      speed = lo; speedEnd = lo; point = heatingPoint(speed, x.air, x.water, frost, release, fanFactor);
    }
    const ua = cycle.evaporatorUA * Math.max(0.08, point.fanFraction) * frost;
    return { mode: 'heating', speed0, speed1: speedEnd, point, electrical: point.compressor + point.fan + controls, compressor: point.compressor, fan: point.fan, controls, crankcase: 0, backupStages: st.backupStages,
      condenser: point.condenser, release, air: point.evaporator - release, coilHeat: 0, frostRate: frostRate(c, x.air, point.evaporating, point.fanFraction, ua), ua };
  }
  if (st.mode === 'defrost' && speed > 0) {
    // Hot-gas guard: above the hold temperature + 15 K the compressor slows until the coil heat balances its convection.
    if (st.intensive && st.coilTemperature >= prop(c, 'intensiveEndTemperature') + 15) {
      const loss = Math.max(0, COIL_STILL_UA * (st.coilTemperature - x.air));
      let lo = 0, hi = speed;
      for (let k = 0; k < 40; k++) { const n = (lo + hi) / 2; if (defrostPoint(n, x.water, st.coilTemperature).coil > loss) hi = n; else lo = n; }
      speed = lo;
    }
    let d = defrostPoint(speed, x.water, st.coilTemperature);
    if (d.compressor > limit) { let lo = 0, hi = speed; for (let k = 0; k < 50; k++) { const n = (lo + hi) / 2; if (defrostPoint(n, x.water, st.coilTemperature).compressor > limit) hi = n; else lo = n; } speed = lo; d = defrostPoint(speed, x.water, st.coilTemperature); }
    const point: CyclePoint = { speed, evaporating: d.evaporating, condensing: d.condensing, ratio: r290Pressure(kelvin(d.condensing)) / r290Pressure(kelvin(d.evaporating)), evaporator: d.water, condenser: -d.water, compressor: d.compressor, fan: 0, fanFraction: 0 };
    return { mode: 'defrost', speed0, speed1, point, electrical: d.compressor + controls, compressor: d.compressor, fan: 0, controls, crankcase: 0, backupStages: st.backupStages, condenser: -d.water, release: 0, air: 0, coilHeat: d.coil, frostRate: 0, ua: 0 };
  }
  return empty(st.mode);
}
/**
 * Advance coil temperature, frost, PI integral, speed and counters over an accepted substep. Returns the energy (J)
 * released to the outdoor air or Thermal Space (negative: heat drawn from it) and the coil storage change (J).
 */
export function advanceHeatPump(c: Component, st: HeatPumpState, plan: HeatPumpPlan, x: HeatPumpInputs, h: number, electricalInput: number, backupInput: number) {
  const C = prop(c, 'coilHeatCapacity'), coilBefore = st.coilTemperature;
  let environment = (plan.fan + plan.controls + plan.crankcase) * h;
  if (plan.mode === 'heating') {
    // The released heat is already part of the evaporator duty; a coil colder than T_e is warmed by the air.
    if (plan.release > 0) st.coilTemperature -= plan.release * h / C;
    else { environment -= C * Math.max(0, plan.point.evaporating - st.coilTemperature); st.coilTemperature = Math.max(st.coilTemperature, plan.point.evaporating); }
    environment -= plan.air * h;
    st.frost += plan.frostRate * h;
  } else if (plan.mode === 'defrost') {
    let energy = plan.coilHeat * h;
    const loss = COIL_STILL_UA * (st.coilTemperature - x.air) * h;
    energy -= loss; environment += loss;
    // Sensible warming to 0 °C, melting at 0 °C (meltwater drains to the environment), then sensible warming.
    if (st.coilTemperature < 0) { const q = Math.min(energy, -st.coilTemperature * C); st.coilTemperature += q / C; energy -= q; }
    // Melting at 0 °C: coil frost first, then (intensive defrost only) the refrozen base-pan ice. Every melted kilogram
    // carries L_f to the environment, whether it drains or refreezes in the pan (refreezing releases L_f to the air).
    const retain = Math.max(0, Math.min(1, prop(c, 'residualIceShare')));
    if (energy > 0 && st.frost > 0) { const melt = Math.min(st.frost, energy / LATENT_FUSION); st.frost -= melt; st.meltedThisDefrost += melt; st.film += retain * melt; energy -= melt * LATENT_FUSION; environment += melt * LATENT_FUSION; }
    if (energy > 0 && st.intensive && st.residualIce > 0) { const melt = Math.min(st.residualIce, energy / LATENT_FUSION); st.residualIce -= melt; st.film += retain * melt; energy -= melt * LATENT_FUSION; environment += melt * LATENT_FUSION; }
    // A wet coil above 0 °C evaporates its film into the air (Lewis analogy with the convection conductance; vapour and
    // its latent heat leave to the environment). This dries the coil and bounds its temperature while wet.
    if (st.coilTemperature > 0 && st.film > 0) {
      const humidity = Math.max(0, Math.min(100, prop(c, 'relativeHumidity'))) / 100;
      const drive = Math.max(0, humidityRatio(vapourPressureWater(st.coilTemperature)) - humidityRatio(humidity * vapourPressureWater(x.air)));
      const evaporated = Math.min(st.film, COIL_STILL_UA / AIR_CP * drive * h);
      st.film -= evaporated; energy -= evaporated * LATENT_EVAPORATION; environment += evaporated * LATENT_EVAPORATION;
    }
    if (energy !== 0) st.coilTemperature += energy / C;
    st.defrostHeat += -plan.condenser * h;
  } else {
    // Stopped: the coil relaxes to the air (exact exponential); above 0 °C air melts frost with its own heat (net zero).
    const target = x.air, next = target + (st.coilTemperature - target) * Math.exp(-COIL_STILL_UA * h / C);
    environment -= C * (next - st.coilTemperature); st.coilTemperature = next;
    if (x.air > 0 && st.frost > 0) st.frost = Math.max(0, st.frost - COIL_STILL_UA * x.air * h / LATENT_FUSION);
    else if (x.air > 0 && st.residualIce > 0) st.residualIce = Math.max(0, st.residualIce - COIL_STILL_UA * x.air * h / LATENT_FUSION);
  }
  // Compressor shell (control state of the crankcase thermostat): running, it approaches the condensing temperature
  // (τ 10 min); stopped, it follows its heater and its loss to the air exactly. Its sensible heat is not a separate ledger
  // store: the heater's electrical input is booked to the air when drawn (timing shift of minutes, assumption).
  if (plan.mode === 'heating' || plan.mode === 'defrost') st.shellTemperature += (plan.point.condensing - st.shellTemperature) * -Math.expm1(-h / 600);
  else { const settled = x.air + plan.crankcase / SHELL_UA; st.shellTemperature = settled + (st.shellTemperature - settled) * Math.exp(-SHELL_UA * h / SHELL_CAPACITY); }
  // PI integral with anti-windup (the command already lies within its limits).
  if (plan.mode === 'heating') {
    const error = st.target - x.water, top = maxSpeed(x.air), gain = prop(c, 'proportionalGain');
    const integral = st.integral + gain * error * h / Math.max(1, prop(c, 'integralTime'));
    const unclamped = MIN_SPEED + gain * error + integral;
    if (unclamped <= top && unclamped >= MIN_SPEED || (unclamped > top && integral < st.integral) || (unclamped < MIN_SPEED && integral > st.integral)) st.integral = integral;
  }
  st.speed = plan.mode === 'heating' || plan.mode === 'defrost' ? plan.speed1 : 0;
  st.heat += Math.max(0, plan.condenser) * h; st.electricity += electricalInput * h; st.backupHeat += backupInput * h;
  if (st.dhw) { st.dhwHeat += plan.condenser * h; st.dhwElectricity += electricalInput * h; }
  st.environment += (plan.mode === 'heating' ? plan.air : 0) * h;
  return { environment, stored: C * (st.coilTemperature - coilBefore) };
}

export const heatPumpBasis = [
  { label: 'Manufacturer data (Bosch)', text: 'EN 14511 maximum and nominal outputs/COPs at A7, A2, A−7, A−10 with W35/W55; EN 14825 part-load COPd at Tj −10…+12 °C; modulation 1.8–7.1 kW at A2/W35; 13.1 A maximum current; 6 compressor starts per hour; operating envelope (flow ≤ 75 °C, outdoor −22…+45 °C, cut-out −23/+45 °C with restart −17/+42 °C); 15 W standby and 32 W average crankcase heater (ErP); 14 l/min minimum flow in defrost; backup heater 3/6 kW at 230 V with 88 °C overheat protection; 2-minute power-on check.' },
  { label: 'Fitted model', text: 'Quasi-steady R290 cycle: suction-density compressor capacity, Carnot fraction η(speed, pressure ratio) and heat-exchanger approach temperatures. Six coefficients least-squares fitted to nine published points (RMS COP error 2.0 %, largest 5.1 %). The three A2/+2 °C points include defrost in the Bosch tests and are withheld to check the frost and defrost model. Maximum speed below −7 °C back-calculated from the A−10/W35 maximum.' },
  { label: 'Field-calibrated defrost', text: 'A measured Bosch Compress 5800i (4 kW, same R290 outdoor-unit family; heatpumpmonitor.org #920, Zagreb, 10 s metered data) with the real weather: 2 kg frost trigger and 25 kJ/K defrost-heated capacity fitted jointly to the measured defrost interval (≈3.4 h) and heat per defrost (≈0.37 kWh); intensive hot-gas defrost every 5th cycle (Bosch firmware ≥ 9.10.0); crankcase heater 75 W measured. The model reproduces the 14 defrosts (2 intensive) of a measured 48 h window; intensive defrost energy is predicted, not fitted.' },
  { label: 'Assumptions', text: 'Condenser UA 2 kW/K, evaporator UA 750 W/K at full fan, fan 40 W, fan airflow following compressor speed; R290 saturation by a two-point Clausius–Clapeyron fit. Frost by ε-NTU mass transfer at Le = 1 on a fin surface 35 % of the way from T_e to the air; conductance halves at 5 kg of frost. Reverse-cycle speeds 40/60 %, minimum pressure ratio 1.8, 10 °C (normal) / 20 °C (intensive) end temperatures, 9 min intensive minimum, 100 W/K coil convection, 30 % retained meltwater evaporating by the Lewis analogy, drip time, crankcase shell thermostat (10 K, 3.2 W/K) are assumptions. Controller: PI on outlet temperature, start/stop hysteresis, minimum run/off times; heating curve linear. Pressure switches at 31 bar / 1.2 bar and a 20 K evaporator-approach protection (failed fan, blocked coil). Internal water volume, metal capacities and hydraulic resistance are assumed.' },
  { label: 'Not modelled', text: 'Bosch firmware (degree-minute logic, adaptive defrost, low-noise modes), refrigerant charge migration and oil return, drip-tray heater, domestic hot water, cooling mode, SG-Ready/EVU inputs, compressor and fan electrical harmonics, sound. Latent heat from condensation on a wet coil is not separated from the sensible duty.' },
];
