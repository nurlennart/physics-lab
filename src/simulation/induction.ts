/**
 * Dynamic three-phase induction machine: 5th-order dq model (stator and rotor flux linkages plus the
 * shared shaft speed) in the synchronous reference frame of the network phasors.
 *
 * Per phase, RMS complex quantities rotating with the supply (motor convention, current into the machine):
 *   v  = Rs·is + dψs/dt + jωs·ψs
 *   0  = Rr·ir + dψr/dt + j(ωs − ωr)·ψr        ωr = (p/2)·ω_mech (rotor electrical speed)
 *   ψs = Ls·is + Lm·ir,   ψr = Lm·is + Lr·ir   (L = X/ω_rated at the rated frequency)
 *   Te = 3·(p/2)·Im(conj(ψs)·is)
 * In steady state the model reduces exactly to the per-phase equivalent circuit
 * Rs + jX1 + jXm ∥ (R2/s + jX2).
 *
 * Integration: implicit midpoint over each coupled step h (same scheme as the shaft). With midpoint
 * currents, P_in·h = (P_cu1 + P_cu2 + Te·ω)·h + ΔW exactly, W = (3/2)·Re(ψs·is* + ψr·ir*).
 * The surrounding network stays quasi-static (algebraic phasors); only the machine is dynamic.
 */
import { prop, type Component } from "./model";

export type Cx = [number, number];
const add = (a: Cx, b: Cx): Cx => [a[0] + b[0], a[1] + b[1]];
const sub = (a: Cx, b: Cx): Cx => [a[0] - b[0], a[1] - b[1]];
const mul = (a: Cx, b: Cx): Cx => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const scale = (a: Cx, k: number): Cx => [a[0] * k, a[1] * k];
const div = (a: Cx, b: Cx): Cx => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
const conj = (a: Cx): Cx => [a[0], -a[1]];
export const cabs = (a: Cx) => Math.hypot(a[0], a[1]);

export interface MachineParams { Rs: number; Rr: number; Ls: number; Lr: number; Lm: number; ws: number; pairs: number }
/** Machine constants at supply frequency `frequency` (Hz); inductances from the reactances at rated frequency. */
export function machineParams(c: Component, frequency: number): MachineParams {
  const wRated = 2 * Math.PI * prop(c, "ratedFrequency", 50), Lm = prop(c, "magnetizingReactance") / wRated;
  return {
    Rs: prop(c, "statorResistance"), Rr: prop(c, "rotorResistance"), Lm,
    Ls: prop(c, "statorReactance") / wRated + Lm, Lr: prop(c, "rotorReactance") / wRated + Lm,
    ws: 2 * Math.PI * frequency, pairs: prop(c, "poles", 4) / 2,
  };
}
/** Winding currents from flux linkages (inverse inductance matrix). */
export function currents(m: MachineParams, psiS: Cx, psiR: Cx) {
  const det = m.Ls * m.Lr - m.Lm * m.Lm;
  return { is: scale(sub(scale(psiS, m.Lr), scale(psiR, m.Lm)), 1 / det), ir: scale(sub(scale(psiR, m.Ls), scale(psiS, m.Lm)), 1 / det) };
}
/** Magnetic energy of the three phases (J). */
export function magneticEnergy(m: MachineParams, psiS: Cx, psiR: Cx) {
  const { is, ir } = currents(m, psiS, psiR);
  return 1.5 * (mul(psiS, conj(is))[0] + mul(psiR, conj(ir))[0]);
}
export const airGapTorque = (m: MachineParams, psiS: Cx, is: Cx) => 3 * m.pairs * mul(conj(psiS), is)[1];
/** Stator flux with an open stator (is = 0): ψs = (Lm/Lr)·ψr. */
export const openStatorFlux = (m: MachineParams, psiR: Cx) => scale(psiR, m.Lm / m.Lr);

/**
 * Midpoint Thevenin equivalent over a step h at midpoint rotor speed ω (mechanical rad/s):
 * v_mid = z·is_mid + e. Rotor: ir = ((2/h)ψr0 − b·Lm·is)/(Rr + b·Lr); stator: v = Rs·is + a·ψs − (2/h)ψs0,
 * with a = 2/h + jωs and b = 2/h + j(ωs − ωr).
 */
export function midpointThevenin(m: MachineParams, psiS0: Cx, psiR0: Cx, h: number, omega: number) {
  const k = 2 / h, a: Cx = [k, m.ws], b: Cx = [k, m.ws - m.pairs * omega], rotor = add([m.Rr, 0], scale(b, m.Lr));
  const z = sub(add([m.Rs, 0], scale(a, m.Ls)), div(scale(mul(a, b), m.Lm * m.Lm), rotor));
  const e = sub(div(scale(mul(a, psiR0), m.Lm * k), rotor), scale(psiS0, k));
  return { z, e, b, rotor };
}
/** Midpoint currents and flux linkages for the solved terminal voltage v. */
export function midpointState(m: MachineParams, psiS0: Cx, psiR0: Cx, h: number, omega: number, v: Cx) {
  const { z, e, b, rotor } = midpointThevenin(m, psiS0, psiR0, h, omega);
  const is = div(sub(v, e), z);
  const ir = div(sub(scale(psiR0, 2 / h), scale(mul(b, is), m.Lm)), rotor);
  const psiS = add(scale(is, m.Ls), scale(ir, m.Lm)), psiR = add(scale(is, m.Lm), scale(ir, m.Lr));
  return { is, ir, psiS, psiR };
}
/**
 * Open stator (contactor open, supply lost): is = 0, the rotor flux decays as
 * dψr/dt = −(Rr/Lr + j(ωs − ωr))·ψr. Midpoint step; returns the end flux and the midpoint rotor copper loss.
 */
export function openStatorStep(m: MachineParams, psiR0: Cx, h: number, omega: number) {
  const lambda: Cx = [m.Rr / m.Lr, m.ws - m.pairs * omega];
  const psiR1 = mul(psiR0, div(sub([1, 0], scale(lambda, h / 2)), add([1, 0], scale(lambda, h / 2))));
  const mid = scale(add(psiR0, psiR1), 0.5), ir = scale(mid, 1 / m.Lr);
  return { psiR: psiR1, rotorCopper: 3 * m.Rr * (ir[0] ** 2 + ir[1] ** 2) };
}
