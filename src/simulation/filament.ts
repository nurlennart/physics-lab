/**
 * Tungsten filament of a lamp: lumped thermal state u = T/T_op (T_op ≈ 2,700 K, the temperature at rated power).
 *
 *   R(u)    = R_hot · u^n,  n = ln(0.1)/ln(u_a)          cold resistance ≈ 10 % of the hot (rated) resistance
 *   P_loss  = P_r · [0.9·(u⁴ − u_a⁴)/(1 − u_a⁴) + 0.1·(u − u_a)/(1 − u_a)]   radiation + gas/lead conduction
 *   C·du/dt = P_el − P_loss,  C = τ·dP_loss/du(1)       τ = 0.08 s linearized at the operating point
 *
 * At rated power the filament settles at u = 1, i.e. the configured resistance: the previous constant-resistance
 * behaviour is the operating-temperature limit. Switch-on from cold draws ≈ 10 × the hot current, which decays
 * to within 10 % in ≈ 0.12 s at rated voltage.
 *
 * Integration per accepted step: the electrical power of the step (solved with the start-of-step resistance) is
 * held; the losses are implicit (backward Euler, Newton). Energy is exact by construction:
 * P_el·dt = ΔE_filament + (heat passed to the lamp body)·dt. The explicit resistance coupling is stable for any
 * step: the amplification of a perturbation tends to −n/(dP_loss/du) ≈ −0.28.
 */
import { prop, type Component } from "./model";

export const FILAMENT_OPERATING_K = 2700;
// Fixed 20 °C calibration reference, not the runtime environment.
const REFERENCE = 293.15 / FILAMENT_OPERATING_K, COLD_RATIO = 0.1, CONDUCTION_SHARE = 0.1, TIME_CONSTANT = 0.08;
const EXPONENT = Math.log(COLD_RATIO) / Math.log(REFERENCE);
const lossShape = (u: number, bath: number) => (1 - CONDUCTION_SHARE) * (u ** 4 - bath ** 4) / (1 - REFERENCE ** 4) + CONDUCTION_SHARE * (u - bath) / (1 - REFERENCE);
const lossSlope = (u: number) => (1 - CONDUCTION_SHARE) * 4 * u ** 3 / (1 - REFERENCE ** 4) + CONDUCTION_SHARE / (1 - REFERENCE);
const capacity = (c: Component) => TIME_CONSTANT * lossSlope(1) * prop(c, "ratedPower");

/** Cold filament state at the 20 °C calibration reference. */
export const FILAMENT_COLD = REFERENCE;
export const filamentInitial = (ambient: number) => (ambient + 273.15) / FILAMENT_OPERATING_K;
/** Resistance relative to the configured (hot) resistance. */
export const filamentRatio = (u: number) => Math.max(1 / FILAMENT_OPERATING_K, u) ** EXPONENT;
/** Stored filament energy relative to the fixed 20 °C reference (J); ledger uses changes. */
export const filamentEnergy = (c: Component, u: number) => capacity(c) * (u - REFERENCE);
/** Filament temperature (°C). */
export const filamentCelsius = (u: number) => u * FILAMENT_OPERATING_K - 273.15;
/** Advance over dt with the electrical power held; returns the new state and the heat passed to the lamp body (W, step average). */
export function filamentStep(c: Component, u0: number, power: number, dt: number, ambient = 20) {
  const bath = filamentInitial(ambient);
  const C = capacity(c), rated = prop(c, "ratedPower"), p = Math.max(0, power);
  let u = u0;
  for (let i = 0; i < 50; i++) {
    const f = C * (u - u0) - dt * (p - rated * lossShape(u, bath)), df = C + dt * rated * lossSlope(u);
    const next = Math.max(1 / FILAMENT_OPERATING_K, u - f / df);
    if (Math.abs(next - u) < 1e-13) { u = next; break; }
    u = next;
  }
  return { u, heat: p - C * (u - u0) / dt };
}
