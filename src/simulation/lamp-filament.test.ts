/** Filament lamp: cold resistance, switch-on surge and its decay, hot-resistance steady state, energy, protection. */
import { describe, it, expect } from "vitest";
import { Builder } from "./scaling-validation";
import { Simulation, DT } from "./engine";
import { filamentEnergy, filamentRatio, FILAMENT_COLD } from "./filament";
import type { Component, Project, Property } from "./model";

const RATED_V = Math.sqrt(30 * 6); // default lamp: 6 Ω hot, 30 W → 13.42 V
/** `voltage` is the lamp's steady terminal voltage: the supply adds the hot-state drop of the 0.01 Ω switch and 0.01 Ω protection. */
function rig(voltage = RATED_V, protection?: { kind: "fuse" | "breaker"; props: Record<string, Property> }) {
  const series = 0.01 + (protection ? 0.01 : 0);
  const b = new Builder(), source = b.add("source", { voltage: voltage * (6 + series) / 6, ratedVoltage: 400, maxCurrent: 1e4, maxPower: 1e6 });
  const sw = b.add("switch", { resistance: 0.01, ratedPower: 1e6 });
  const device = protection ? b.add(protection.kind, { resistance: 0.01, ...protection.props }) : undefined;
  const lamp = b.add("lamp", { loss: 0.5 });
  b.series(source, ...[sw, device, lamp].filter((c): c is Component => !!c));
  return { s: new Simulation(b.p), lamp, sw, device };
}
const toggle = (s: Simulation, id: string, closed: boolean) =>
  expect(s.refresh({ ...s.project, components: s.project.components.map((c) => c.id === id ? { ...c, props: { ...c.props, closed } } : c) } as Project)).toBe(true);
const current = (s: Simulation, lamp: Component) => s.electrical.readings[lamp.id].current;

describe("filament lamp", () => {
  it("switches on at ≈ 10 × the hot current and settles to the configured hot resistance at rated voltage", () => {
    const { s, lamp } = rig();
    const hot = RATED_V / 6;
    expect(filamentRatio(FILAMENT_COLD)).toBeCloseTo(0.1, 12);
    expect(current(s, lamp) / hot).toBeCloseTo(6.01 / 0.61, 6); // cold filament at t = 0: 0.6 Ω + 0.01 Ω switch
    let settled = Infinity;
    for (let i = 0; i < 2 / DT; i++) {
      expect(s.step()).toBe(true);
      if (settled === Infinity && current(s, lamp) < 1.1 * hot) settled = s.time;
    }
    // Decays to within 10 % of the hot current in about 0.1 s (fixed-step resolution 1/60 s).
    expect(settled).toBeGreaterThan(0.05);
    expect(settled).toBeLessThan(0.2);
    // Steady state at rated voltage: exactly the configured 6 Ω and 30 W (the former constant-resistance model).
    expect(s.electrical.readings[lamp.id].power).toBeCloseTo(30, 6);
    expect(s.filaments[lamp.id]).toBeCloseTo(1, 6);
  });
  it("is non-ohmic below rated voltage: cooler filament, lower resistance (P ∝ V^1.6)", () => {
    const { s, lamp } = rig(12);
    for (let i = 0; i < 2 / DT; i++) expect(s.step()).toBe(true);
    const power = s.electrical.readings[lamp.id].power;
    expect(power).toBeGreaterThan(144 / 6); // more than the hot-resistance V²/R = 24 W
    expect(power / 30).toBeCloseTo((12 / RATED_V) ** 1.59, 2);
    expect(s.violations).toEqual([]); // the switch-on surge is not a rating violation
  });
  it("stores filament energy and closes the energy ledger through switch-on, operation and switch-off", () => {
    const { s, lamp, sw } = rig();
    for (let i = 0; i < 1 / DT; i++) expect(s.step()).toBe(true);
    expect(s.storedEnergy).toBeGreaterThan(filamentEnergy(lamp, s.filaments[lamp.id]) * 0.999);
    expect(Math.abs(s.energyResidual)).toBeLessThan(1e-9 * s.suppliedEnergy);
    toggle(s, sw.id, false);
    for (let i = 0; i < 3 / DT; i++) expect(s.step()).toBe(true);
    expect(s.filaments[lamp.id]).toBeLessThan(0.3); // cooled by radiation and conduction within seconds
    expect(Math.abs(s.energyResidual)).toBeLessThan(1e-9 * s.suppliedEnergy);
  });
  it("a warm filament re-lights with a smaller surge than a cold one", () => {
    const { s, lamp, sw } = rig();
    for (let i = 0; i < 1 / DT; i++) s.step();
    toggle(s, sw.id, false);
    for (let i = 0; i < 0.1 / DT; i++) s.step();
    toggle(s, sw.id, true);
    expect(current(s, lamp)).toBeLessThan(0.5 * 9.85 * RATED_V / 6);
    expect(current(s, lamp)).toBeGreaterThan(RATED_V / 6);
  });
  it("protection: a gG fuse and a C-curve breaker carry the surge; a B-curve breaker sized at the hot current trips", () => {
    const hot = RATED_V / 6; // 2.24 A; surge 22.4 A
    const fuse = rig(RATED_V, { kind: "fuse", props: { ratedCurrent: 4 } });
    for (let i = 0; i < 5 / DT; i++) expect(fuse.s.step()).toBe(true);
    expect(fuse.s.failed[fuse.device!.id]).toBeUndefined();
    const c = rig(RATED_V, { kind: "breaker", props: { ratedCurrent: 3, magneticTrip: 10 } });
    for (let i = 0; i < 5 / DT; i++) expect(c.s.step()).toBe(true);
    expect(c.s.breakers[c.device!.id]?.tripped ?? false).toBe(false);
    expect(current(c.s, c.lamp)).toBeCloseTo(hot, 6);
    const b = rig(RATED_V, { kind: "breaker", props: { ratedCurrent: 3, magneticTrip: 5 } });
    expect(b.s.step()).toBe(true);
    expect(b.s.breakers[b.device!.id].tripped).toBe(true); // 22 A surge > 5 × 3 A instantaneous release
  });
});
