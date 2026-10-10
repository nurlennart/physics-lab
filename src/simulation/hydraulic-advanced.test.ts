import { describe, it, expect } from "vitest";
import { Builder } from "./scaling-validation";
import { Simulation, DT } from "./engine";
import { effectiveness, pumpHead, parsePumpPoints } from "./hydraulic";
import { componentError } from "./integrity";
import { makeComponent, type Component, type Property } from "./model";
import { WATER_CP, unitsSI as U } from "./units";

const run = (s: Simulation, seconds: number) => { for (let i = 0; i < Math.round(seconds / DT); i++) if (!s.step()) break; return s; };
/** Gravity stream: elevated source tank → pipe/device → lower sink tank. */
function stream(b: Builder, temperature: number, elevation = 5, device?: Component, port: [string, string] = ["inlet", "outlet"], pipeProps: Record<string, Property> = {}) {
  const source = b.add("tank", { capacity: 2000, volume: 1500, surfaceArea: 1, elevation, initialTemperature: temperature, loss: 0 });
  const sink = b.add("tank", { capacity: 5000, volume: 0, surfaceArea: 1, initialTemperature: 20, loss: 0 });
  const pipe = b.add("pipe", { diameter: 0.05, length: 10, inventory: false, ...pipeProps });
  b.wire(source, "fluid", pipe, "inlet");
  if (device) { b.wire(pipe, "outlet", device, port[0]); b.wire(device, port[1], sink, "fluid"); }
  else b.wire(pipe, "outlet", sink, "fluid");
  return { source, sink, pipe };
}
describe("heat exchanger (ε-NTU)", () => {
  it("matches the counterflow effectiveness relation and conserves energy", () => {
    expect(effectiveness(2, 1, "counterflow")).toBeCloseTo(2 / 3, 12);
    expect(effectiveness(1, 0, "parallel")).toBeCloseTo(1 - Math.exp(-1), 12);
    const b = new Builder(), hx = b.add("heatExchanger", { ua: 5000, lossCoefficient: 2, diameter: 0.05 });
    stream(b, 80, 5, hx, ["hotIn", "hotOut"]);
    stream(b, 10, 5, hx, ["coldIn", "coldOut"]);
    const s = run(new Simulation(b.p), 5);
    const hot = s.multiphysics.hydraulic.readings[`${hx.id}#hot`], cold = s.multiphysics.hydraulic.readings[`${hx.id}#cold`];
    expect(hot.flow).toBeGreaterThan(1e-3);
    const ch = hot.flow * 1000 * WATER_CP, cc = cold.flow * 1000 * WATER_CP, cmin = Math.min(ch, cc);
    const eps = effectiveness(5000 / cmin, cmin / Math.max(ch, cc), "counterflow");
    const q = eps * cmin * 70;
    expect(hot.duty).toBeCloseTo(q, -1);
    expect(U.kToCelsius(hot.temperature)).toBeCloseTo(80 - q / ch, 1);
    expect(U.kToCelsius(cold.temperature)).toBeCloseTo(10 + q / cc, 1);
    expect(Math.abs(s.energyResidual)).toBeLessThan(Math.max(0.5, 1e-6 * Math.abs(s.suppliedEnergy)));
    expect(Math.abs(s.multiphysics.massResidual)).toBeLessThan(1e-6);
  });
});
describe("pipe water inventory", () => {
  it("delays a thermal front by roughly the pipe residence time and stores its heat", { timeout: 600000 }, () => {
    const b = new Builder(), { pipe } = stream(b, 70, 5, undefined, undefined, { inventory: true, segments: 20, length: 60, diameter: 0.05 });
    const s = new Simulation(b.p);
    run(s, 1);
    const flow = s.multiphysics.hydraulic.readings[pipe.id].flow, volume = Math.PI * 0.05 ** 2 / 4 * 60, residence = volume / flow;
    expect(U.kToCelsius(s.multiphysics.hydraulic.readings[pipe.id].temperature)).toBeLessThan(25);
    run(s, residence * 1.8);
    expect(U.kToCelsius(s.multiphysics.hydraulic.readings[pipe.id].temperature)).toBeGreaterThan(65);
    expect(Math.abs(s.energyResidual)).toBeLessThan(1);
  });
});
describe("pressure-reducing valve", () => {
  it("regulates the outlet to its setpoint from a high-head supply", () => {
    const b = new Builder(), prv = b.add("pressureReducingValve", { pressureSetpoint: 150000, diameter: 0.05 });
    const source = b.add("tank", { capacity: 50000, volume: 40000, surfaceArea: 1000, elevation: 50, loss: 0 });
    const sink = b.add("tank", { capacity: 50000, volume: 0, surfaceArea: 10, loss: 0 });
    const feed = b.add("pipe", { diameter: 0.05, length: 5, inventory: false }), consumer = b.add("valve", { diameter: 0.02, opening: 40 });
    b.wire(source, "fluid", feed, "inlet"); b.wire(feed, "outlet", prv, "inlet"); b.wire(prv, "outlet", consumer, "inlet"); b.wire(consumer, "outlet", sink, "fluid");
    const s = run(new Simulation(b.p), 60);
    expect(s.error).toBeNull();
    expect(s.multiphysics.hydraulic.readings[prv.id].inletPressure).toBeGreaterThan(400000);
    expect(s.multiphysics.hydraulic.readings[prv.id].pressure).toBeCloseTo(150000, -3);
    expect(s.multiphysics.positions[prv.id]).toBeLessThan(100);
  });
});
describe("pump data curves and NPSH", () => {
  it("a data-point curve sampled from the quadratic model reproduces its head and affinity scaling", () => {
    const quadratic = makeComponent("pump", 0, 0), points = makeComponent("pump", 0, 0);
    const pts = Array.from({ length: 9 }, (_, i) => { const q = i * 0.0015 / 8; return `${q * 60000}:${8 * (1 - 0.5 * (q / 0.001) ** 2)}`; }).join("; ");
    points.props.curvePoints = pts;
    expect(componentError(points)).toBeNull();
    for (const [omega, q] of [[300, 0.0005], [300, 0.001], [150, 0.0004]])
      expect(pumpHead(points, omega, q)).toBeCloseTo(pumpHead(quadratic, omega, q), 1);
    expect(parsePumpPoints("0:8; 30:9")).toMatch(/rise/);
    expect(componentError({ ...points, props: { ...points.props, curvePoints: "5:3" } })).toMatch(/two/);
  });
  it("warns about cavitation when suction pressure is too low for hot water", () => {
    const b = new Builder();
    const source = b.add("source", { voltage: 24, maxCurrent: 100 }), motor = b.add("motor"), pump = b.add("pump", { npshRequired: 6 });
    const low = b.add("tank", { capacity: 200, volume: 150, surfaceArea: 0.1, elevation: -4, initialTemperature: 90, loss: 0 });
    const high = b.add("tank", { capacity: 200, volume: 0, surfaceArea: 0.1, elevation: 1, loss: 0 });
    const suction = b.add("pipe", { length: 5, diameter: 0.02, inventory: false }), discharge = b.add("pipe", { length: 2, inventory: false });
    b.series(source, motor); b.wire(motor, "shaft", pump, "shaft");
    b.wire(low, "fluid", suction, "inlet"); b.wire(suction, "outlet", pump, "inlet"); b.wire(pump, "outlet", discharge, "inlet"); b.wire(discharge, "outlet", high, "fluid");
    const s = run(new Simulation(b.p), 10);
    const r = s.multiphysics.hydraulic.readings[pump.id];
    expect([s.error, r.flow > 1e-5, r.npshAvailable! < 6 * (r.flow / 0.001) ** 2]).toEqual([null, true, true]);
    expect(s.events.some((e) => /cavitation risk/.test(e.message))).toBe(true);
  });
});
