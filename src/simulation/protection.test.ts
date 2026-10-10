import { describe, it, expect } from "vitest";
import { Builder } from "./scaling-validation";
import { Simulation, DT } from "./engine";
import { thermalTau } from "./parameters";
import type { Property } from "./model";

/** Constant-current source through a breaker into a 1 Ω load. */
function rig(kind: "breaker" | "motorProtector", current: number, props: Record<string, Property> = {}, variant = "standard") {
  const b = new Builder();
  const source = b.add("source", { mode: "cc", current, voltage: 1e4, ratedVoltage: 1e4, maxCurrent: 1e6, maxPower: 1e12 });
  const device = b.add(kind, props, variant), load = b.add("resistor", { resistance: 1, ratedPower: 1e9, heatCapacity: 1e12, maxTemperature: 1e4 });
  b.series(source, device, load);
  return { s: new Simulation(b.p), device, load };
}
const runUntilTrip = (s: Simulation, id: string, limit: number) => {
  while (s.time < limit && !s.breakers[id]?.tripped) s.step();
  return s.time;
};
describe("thermal-magnetic protection", () => {
  it("trips thermally at the analytic I²t time and not below the conventional current", () => {
    const { s, device } = rig("breaker", 32);
    const tau = thermalTau(device), expected = tau * Math.log(4 / (4 - 1.69));
    expect(runUntilTrip(s, device.id, 200)).toBeCloseTo(expected, 1);
    expect(s.electrical.readings[device.id].current).toBe(0);
    expect(s.automation.signals[device.id].value).toBe(false);
    const hold = rig("breaker", 16 * 1.25);
    hold.s.advanceAdaptive(3 * 3600);
    expect(hold.s.breakers[hold.device.id].tripped).toBe(false);
  });
  it("trips magnetically within one step and reports breaking-capacity violations", () => {
    const { s, device } = rig("breaker", 400);
    s.step();
    expect(s.breakers[device.id].tripped).toBe(true);
    expect(s.time).toBeCloseTo(DT, 12);
    const fault = rig("breaker", 20000);
    fault.s.step();
    expect(fault.s.violations.some((v) => /breaking capacity/.test(v))).toBe(true);
  });
  it("re-closes only after the thermal memory cools; a magnetic trip leaves it cold", () => {
    const { s, device } = rig("breaker", 32);
    runUntilTrip(s, device.id, 200);
    expect(s.resetSafety(device.id)).toMatch(/Cannot re-close/);
    s.advanceAdaptive(120);
    expect(s.breakers[device.id].theta).toBeLessThan(1);
    const short = rig("breaker", 400);
    short.s.step();
    expect(short.s.resetSafety(short.device.id)).toBeNull();
    expect(s.resetSafety(device.id)).toBeNull();
    expect(s.breakers[device.id].tripped).toBe(false);
    s.step();
    expect(Math.abs(s.electrical.readings[device.id].current)).toBeCloseTo(32, 6);
  });
  it("motor protector trips class 10 at 7.2 × setting in about 10 s from cold", () => {
    const { s, device } = rig("motorProtector", 20 * 7.2, { magneticTrip: 13 });
    expect(runUntilTrip(s, device.id, 30)).toBeCloseTo(10, 1);
  });
  it("a welded (stuck-closed) breaker does not interrupt the fault", () => {
    const { s, device } = rig("breaker", 400);
    expect(s.injectFault(device.id, "stuckClosed")).toBeNull();
    for (let i = 0; i < 10; i++) s.step();
    expect(Math.abs(s.electrical.readings[device.id].current)).toBeCloseTo(400, 6);
  });
});
