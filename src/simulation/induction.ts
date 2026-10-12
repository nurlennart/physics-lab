/**
 * Dynamic three-phase induction machine: dq model of the stator and one or two rotor cages (flux linkages plus
 * the shared shaft speed) in the synchronous reference frame of the network phasors.
 *
 * Per phase, RMS complex quantities rotating with the supply (motor convention, current into the machine):
 *   v  = Rs·is + dψs/dt + jωs·ψs
 *   0  = Rk·ik + dψk/dt + j(ωs − ωr)·ψk           each rotor cage k, ωr = (p/2)·ω_mech
 *   ψs = Ls·is + Lm·Σi,   ψk = Lm·(is + Σi) + Lσk·ik   (L = X/ω_rated at the rated frequency)
 *   Te = 3·(p/2)·Im(conj(ψs)·is)
 * The cages share only the magnetizing flux. A double cage is the classic deep-bar model: at standstill the
 * starting cage (high resistance, low leakage) carries the current, near synchronous speed the running cage
 * (low resistance) does, giving high starting torque with low rated slip. In steady state the model reduces
 * exactly to the per-phase equivalent circuit Rs + jX1 + jXm ∥ (R2/s + jX2) ∥ (R2s/s + jX2s).
 *
 * Iron (core) loss is a resistance across the winding voltage (outside the dq model): P_fe = 3·|v|²/Rc with
 * Rc ∝ √(f/f_rated), so at constant flux (V/f) the loss grows as f^1.5, between hysteresis (∝ f) and
 * eddy-current loss (∝ f²).
 *
 * Integration: implicit midpoint over each coupled step h (same scheme as the shaft). With midpoint
 * currents, P_in·h = (P_cu1 + P_cu2 + Te·ω)·h + ΔW exactly, W = (3/2)·Re(Σ ψ·i*).
 * The surrounding network stays quasi-static (algebraic phasors); only the machine is dynamic.
 */
import { prop, type Component } from "./model";
import { solveComplex, solveLinear } from "./linear-algebra";

export type Cx = [number, number];
const add = (a: Cx, b: Cx): Cx => [a[0] + b[0], a[1] + b[1]];
const sub = (a: Cx, b: Cx): Cx => [a[0] - b[0], a[1] - b[1]];
const mul = (a: Cx, b: Cx): Cx => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const scale = (a: Cx, k: number): Cx => [a[0] * k, a[1] * k];
const div = (a: Cx, b: Cx): Cx => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
const conj = (a: Cx): Cx => [a[0], -a[1]];
export const cabs = (a: Cx) => Math.hypot(a[0], a[1]);

export interface MachineParams {
  Rs: number; Ls: number; Lm: number;
  /** Rotor cages: resistance and self-inductance Lm + Lσ (one cage, or running and starting cage). */
  cages: { R: number; L: number }[];
  /** Core-loss resistance per phase across the winding voltage at this frequency (Ω). */
  Rc: number;
  ws: number; pairs: number;
}
/** Machine constants at supply frequency `frequency` (Hz); inductances from the reactances at rated frequency. */
export function machineParams(c: Component, frequency: number): MachineParams {
  const wRated = 2 * Math.PI * prop(c, "ratedFrequency", 50), Lm = prop(c, "magnetizingReactance") / wRated;
  const cages = [{ R: prop(c, "rotorResistance"), L: prop(c, "rotorReactance") / wRated + Lm }];
  if (prop(c, "rotorResistance2") > 0) cages.push({ R: prop(c, "rotorResistance2"), L: prop(c, "rotorReactance2") / wRated + Lm });
  return {
    Rs: prop(c, "statorResistance"), Ls: prop(c, "statorReactance") / wRated + Lm, Lm, cages,
    Rc: prop(c, "coreResistance", Infinity) * Math.sqrt(Math.max(frequency, 1e-6) / prop(c, "ratedFrequency", 50)),
    ws: 2 * Math.PI * frequency, pairs: prop(c, "poles", 4) / 2,
  };
}
/** Zero flux linkages of the rotor cages. */
export const noRotorFlux = (m: MachineParams): Cx[] => m.cages.map(() => [0, 0]);
/** Inductance matrix of the windings [stator, cage 1, (cage 2)]. */
function inductance(m: MachineParams) {
  const n = 1 + m.cages.length;
  return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => i === j ? (i === 0 ? m.Ls : m.cages[i - 1].L) : m.Lm));
}
/** Real matrix applied to complex vectors. */
const apply = (a: number[][], x: Cx[]) => a.map((row) => row.reduce<Cx>((sum, v, j) => add(sum, scale(x[j], v)), [0, 0]));
function solveReal(a: number[][], b: Cx[]): Cx[] {
  const re = solveLinear(a, b.map((v) => v[0]), true, true), im = solveLinear(a, b.map((v) => v[1]), true, true);
  return re.map((v, i) => [v, im[i]]);
}
/** Winding currents from flux linkages (inverse inductance matrix). */
export function currents(m: MachineParams, psiS: Cx, psiR: Cx[]) {
  const [is, ...ir] = solveReal(inductance(m), [psiS, ...psiR]);
  return { is, ir };
}
/** Magnetic energy of the three phases (J). */
export function magneticEnergy(m: MachineParams, psiS: Cx, psiR: Cx[]) {
  const { is, ir } = currents(m, psiS, psiR);
  return 1.5 * (mul(psiS, conj(is))[0] + psiR.reduce((sum, psi, k) => sum + mul(psi, conj(ir[k]))[0], 0));
}
export const airGapTorque = (m: MachineParams, psiS: Cx, is: Cx) => 3 * m.pairs * mul(conj(psiS), is)[1];
/** Rotor copper loss of the three phases (W). */
export const rotorCopper = (m: MachineParams, ir: Cx[]) => 3 * m.cages.reduce((sum, cage, k) => sum + cage.R * (ir[k][0] ** 2 + ir[k][1] ** 2), 0);
/** Stator flux with an open stator (is = 0): ψs = Lm·Σi with the cage currents of the rotor flux alone. */
export function openStatorFlux(m: MachineParams, psiR: Cx[]): Cx {
  const rotor = inductance(m).slice(1).map((row) => row.slice(1));
  return scale(solveReal(rotor, psiR).reduce(add, [0, 0]), m.Lm);
}
/**
 * Midpoint step over h at rotor speed ω (mechanical rad/s): with dψ/dt = (2/h)(ψ − ψ₀) every winding gives
 * (R + (2/h + jΩ)·L)·i = [v, 0, …] + (2/h)·ψ₀, Ω = ωs for the stator and ωs − ωr for the cages. The stator current
 * is affine in v: is = x·v + y, i.e. the Thevenin equivalent v = z·is + e with z = 1/x, e = −y/x.
 */
function midpointSystem(m: MachineParams, psiS0: Cx, psiR0: Cx[], h: number, omega: number) {
  const k = 2 / h, L = inductance(m), slip = m.ws - m.pairs * omega, n = L.length;
  const matrix = L.map((row, i) => row.map((l, j): Cx => [l * k + (i === j ? (i === 0 ? m.Rs : m.cages[i - 1].R) : 0), l * (i === 0 ? m.ws : slip)]));
  const unit = solveComplex(matrix, Array.from({ length: n }, (_, i): Cx => (i === 0 ? [1, 0] : [0, 0])));
  const free = solveComplex(matrix, [psiS0, ...psiR0].map((psi) => scale(psi, k)));
  return { L, unit, free };
}
export function midpointThevenin(m: MachineParams, psiS0: Cx, psiR0: Cx[], h: number, omega: number) {
  const { unit, free } = midpointSystem(m, psiS0, psiR0, h, omega), z = div([1, 0], unit[0]);
  return { z, e: scale(mul(free[0], z), -1) };
}
/** Midpoint currents and flux linkages for the solved winding voltage v. */
export function midpointState(m: MachineParams, psiS0: Cx, psiR0: Cx[], h: number, omega: number, v: Cx) {
  const { L, unit, free } = midpointSystem(m, psiS0, psiR0, h, omega);
  const [is, ...ir] = unit.map((u, i) => add(mul(u, v), free[i]));
  const [psiS, ...psiR] = apply(L, [is, ...ir]);
  return { is, ir, psiS, psiR };
}
/**
 * Open stator (contactor open, supply lost): is = 0, the cages decay as Rk·ik + dψk/dt + j(ωs − ωr)·ψk = 0.
 * Midpoint step; returns the end fluxes and the midpoint rotor copper loss.
 */
export function openStatorStep(m: MachineParams, psiR0: Cx[], h: number, omega: number) {
  const k = 2 / h, slip = m.ws - m.pairs * omega, L = inductance(m).slice(1).map((row) => row.slice(1));
  const matrix = L.map((row, i) => row.map((l, j): Cx => [l * k + (i === j ? m.cages[i].R : 0), l * slip]));
  const ir = solveComplex(matrix, psiR0.map((psi) => scale(psi, k))), mid = apply(L, ir);
  return { psiR: mid.map((psi, i) => sub(scale(psi, 2), psiR0[i])), rotorCopper: rotorCopper(m, ir) };
}
/**
 * Steady per-phase equivalent circuit at the winding voltage v (slip from ω): the impedance including the core-loss
 * branch, and the split of the winding current into stator and cage currents, losses and air-gap torque.
 */
export function steadyCircuit(m: MachineParams, omega: number) {
  const syncSpeed = m.ws / m.pairs, slip = m.ws > 0 ? (m.ws - m.pairs * omega) / m.ws : 1;
  const z1: Cx = [m.Rs, m.ws * (m.Ls - m.Lm)], xm: Cx = [0, m.ws * m.Lm];
  const cages = m.cages.map((cage): Cx | null => Math.abs(slip) > 1e-9 ? [cage.R / slip, m.ws * (cage.L - m.Lm)] : null);
  const rotorAdmittance = cages.reduce<Cx>((sum, z) => (z ? add(sum, div([1, 0], z)) : sum), [0, 0]);
  const airGap = div([1, 0], add(div([1, 0], xm), rotorAdmittance)), machine = add(z1, airGap);
  const impedance = Number.isFinite(m.Rc) ? div(mul(machine, [m.Rc, 0]), add(machine, [m.Rc, 0])) : machine;
  const split = (v: Cx) => {
    const is = div(v, machine), e = mul(is, airGap), ir = cages.map((z): Cx => (z ? div(e, z) : [0, 0]));
    const rotorLoss = rotorCopper(m, ir), coreLoss = Number.isFinite(m.Rc) ? 3 * (v[0] ** 2 + v[1] ** 2) / m.Rc : 0;
    return { is, ir, torque: syncSpeed > 0 && Math.abs(slip) > 1e-9 ? rotorLoss / slip / syncSpeed : 0, statorCopper: 3 * m.Rs * (is[0] ** 2 + is[1] ** 2), rotorCopper: rotorLoss, coreLoss };
  };
  return { impedance, slip, syncSpeed, split };
}
