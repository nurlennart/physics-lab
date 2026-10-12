import { describe, it, expect } from "vitest";
import { Builder } from "./scaling-validation";
import { Simulation, DT } from "./engine";
import { hydraulicStarter } from "./hydraulic-projects";
import { parseProject } from "./projects";
import type { Component } from "./model";

const run = (s: Simulation, seconds: number) => { for (let i = 0; i < Math.round(seconds / DT); i++) if (!s.step()) break; return s; };
const rel = (a: number, b: number) => Math.abs(a / b - 1);

describe("two-K valve loss with water viscosity", () => {
  it("at low Reynolds number a valve passes flow in the inverse ratio of viscosity (published μ)", () => {
    // Laminar-dominated: tiny head, K∞ ≈ 0, large K₁. Δp = K₁·μ/(2dA)·Q.
    const b = new Builder(), valves: Component[] = [];
    for (const temperature of [80, 10]) {
      const source = b.add("tank", { capacity: 100, volume: 50, surfaceArea: 10, elevation: 0.01, initialTemperature: temperature, loss: 0 });
      const sink = b.add("tank", { capacity: 100, volume: 0, surfaceArea: 10, initialTemperature: temperature, loss: 0 });
      const v = b.add("valve", { diameter: 0.004, lossCoefficient: 0.01, laminarK: 1e6 });
      b.wire(source, "fluid", v, "inlet"); b.wire(v, "outlet", sink, "fluid");
      valves.push(v);
    }
    const s = new Simulation(b.p), area = Math.PI * 0.004 ** 2 / 4;
    // Driving pressure: ρ_ref·g·z + g·m/A with m = 50 L × published density (971.80 / 999.70 kg/m³).
    for (const [v, mu, density] of [[valves[0], 0.35404e-3, 971.8], [valves[1], 1.3059e-3, 999.7]] as const) {
      const head = 1000 * 9.80665 * 0.01 + 9.80665 * 0.05 * density / 10;
      const linear = 1e6 * mu / (2 * 0.004 * area), expected = head / linear; // K∞ term negligible here
      expect(rel(s.multiphysics.hydraulic.readings[v.id].flow, expected)).toBeLessThan(5e-3);
      expect(s.multiphysics.hydraulic.readings[v.id].reynolds).toBeLessThan(100);
    }
  });
});
describe("weir overflow routed into a drain network", () => {
  it("routes the spill through the overflow port into a drain tank without losing water", () => {
    const b = new Builder();
    const feed = b.add("tank", { capacity: 2000, volume: 1500, surfaceArea: 2, elevation: 3, loss: 0 });
    const tank = b.add("tank", { capacity: 50, volume: 45, surfaceArea: 0.1, weirLength: 0.2, loss: 0 });
    const drain = b.add("tank", { capacity: 2000, volume: 0, surfaceArea: 2, elevation: -2, loss: 0 });
    const inlet = b.add("pipe", { diameter: 0.02, length: 5, inventory: false }), overflowLine = b.add("pipe", { diameter: 0.05, length: 3, inventory: false });
    b.wire(feed, "fluid", inlet, "inlet"); b.wire(inlet, "outlet", tank, "fluid");
    b.wire(tank, "overflow", overflowLine, "inlet"); b.wire(overflowLine, "outlet", drain, "fluid");
    const s = run(new Simulation(b.p), 60);
    const w = s.multiphysics.hydraulic.weir[tank.id];
    expect(w.routed).toBe(true);
    expect(s.multiphysics.overflowed[tank.id]).toBeGreaterThan(0.001);
    // Volumes agree to the expansion from viscous heating (~1e-6); mass closes exactly.
    expect(Math.abs(s.multiphysics.tanks[drain.id].volume / s.multiphysics.overflowed[tank.id] - 1)).toBeLessThan(1e-5);
    expect(s.multiphysics.removedMass).toBe(0);
    expect(Math.abs(s.multiphysics.massResidual)).toBeLessThan(1e-9);
    expect(Math.abs(s.energyResidual)).toBeLessThan(0.5);
    expect(s.multiphysics.hydraulic.diagnostics.some((d) => /backs up/.test(d))).toBe(false);
  });
});
describe("superseded pump drag coefficient", () => {
  it("files with mechanicalDrag load with the catalog mechanical loss of their pump model", () => {
    for (const [variant, share] of [["standard", 2], ["industrial", 1.9]] as const) {
      const p = hydraulicStarter("transfer"), pump = p.components.find((c) => c.kind === "pump")!;
      pump.variant = variant;
      delete pump.props.mechanicalLoss; pump.props.mechanicalDrag = 0.000003;
      const loaded = parseProject(JSON.parse(JSON.stringify(p))).components.find((c) => c.kind === "pump")!;
      expect("mechanicalDrag" in loaded.props).toBe(false);
      expect(loaded.props.mechanicalLoss).toBe(share);
    }
  });
});

describe("thermal expansion of tank inventories", () => {
  it("heating 1,000 L from 20 to 80 °C expands it by the published density ratio at constant mass", () => {
    const b = new Builder();
    const src = b.add("source", { voltage: 400, ratedVoltage: 400, maxCurrent: 1e4, maxPower: 1e9 });
    const heater = b.add("heater", { ratedVoltage: 400, ratedPower: 100000, heatCapacity: 15000, conductance: 9000, loss: 0 });
    const tank = b.add("tank", { capacity: 1100, volume: 1000, surfaceArea: 1, loss: 0 });
    b.series(src, heater);
    b.wire(heater, "heat", tank, "heat");
    const s = new Simulation(b.p), mass = s.multiphysics.tanks[tank.id].mass;
    while (s.temperatures[tank.id] < 80 && !s.error) s.advanceAdaptive(30);
    const t = s.temperatures[tank.id];
    // Published densities: 998.207 kg/m³ at 20 °C; at the final temperature from Kell (≈971.8 at 80 °C).
    expect(Math.abs(mass / (1 * 998.207) - 1)).toBeLessThan(5e-6);
    expect(s.multiphysics.tanks[tank.id].mass).toBe(mass);
    expect(Math.abs(s.multiphysics.tanks[tank.id].volume / (mass / (971.8 - 0.61 * (t - 80))) - 1)).toBeLessThan(2e-4);
    expect(Math.abs(s.suppliedEnergy - s.storedEnergy - s.ambientEnergy)).toBeLessThan(1e-6 * s.suppliedEnergy);
  });
  it("a nearly full tank that is heated overflows by expansion and closes its mass balance", () => {
    const b = new Builder();
    const src = b.add("source", { voltage: 400, ratedVoltage: 400, maxCurrent: 1e4, maxPower: 1e9 });
    const heater = b.add("heater", { ratedVoltage: 400, ratedPower: 30000, heatCapacity: 4500, conductance: 2700, loss: 0 });
    const tank = b.add("tank", { capacity: 100, volume: 99.5, surfaceArea: 0.1, loss: 0 });
    b.series(src, heater);
    b.wire(heater, "heat", tank, "heat");
    const s = new Simulation(b.p);
    while (s.temperatures[tank.id] < 80 && !s.error) s.advanceAdaptive(10);
    s.advanceAdaptive(600);
    expect(s.multiphysics.overflowed[tank.id]).toBeGreaterThan(0.002);
    expect(s.multiphysics.tanks[tank.id].mass + s.multiphysics.removedMass).toBeCloseTo(s.multiphysics.initialMass, 9);
    expect(s.events.some((e) => /overflowing/.test(e.message))).toBe(true);
  });
});
