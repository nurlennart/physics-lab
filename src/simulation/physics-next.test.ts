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
    // Laminar-dominated: tiny head, K∞ ≈ 0, large K₁. Δp = (R + K₁·μ/(2dA))·Q with R = 1e5 Pa·s/m³.
    const b = new Builder(), valves: Component[] = [];
    for (const temperature of [80, 10]) {
      const source = b.add("tank", { capacity: 100, volume: 50, surfaceArea: 10, elevation: 0.01, initialTemperature: temperature, loss: 0 });
      const sink = b.add("tank", { capacity: 100, volume: 0, surfaceArea: 10, initialTemperature: temperature, loss: 0 });
      const v = b.add("valve", { diameter: 0.004, lossCoefficient: 0.01, laminarK: 1e6 });
      b.wire(source, "fluid", v, "inlet"); b.wire(v, "outlet", sink, "fluid");
      valves.push(v);
    }
    const s = new Simulation(b.p), head = 1000 * 9.80665 * (0.01 + 0.005), area = Math.PI * 0.004 ** 2 / 4;
    for (const [v, mu] of [[valves[0], 0.35404e-3], [valves[1], 1.3059e-3]] as const) {
      const linear = 1e5 + 1e6 * mu / (2 * 0.004 * area), expected = head / linear; // K∞ term negligible here
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
    expect(s.multiphysics.tanks[drain.id].volume).toBeCloseTo(s.multiphysics.overflowed[tank.id], 9);
    expect(s.multiphysics.removedMass).toBe(0);
    expect(Math.abs(s.multiphysics.massResidual)).toBeLessThan(1e-9);
    expect(Math.abs(s.energyResidual)).toBeLessThan(0.5);
    expect(s.multiphysics.hydraulic.diagnostics.some((d) => /backs up/.test(d))).toBe(false);
  });
});
describe("revised pump catalog drag", () => {
  it("maps legacy challenge files to the current catalog and keeps sandbox values", () => {
    const challenge = hydraulicStarter("transfer", true), sandbox = hydraulicStarter("transfer");
    for (const p of [challenge, sandbox]) p.components.find((c) => c.kind === "pump")!.props.mechanicalDrag = 0.000003;
    expect(parseProject(challenge).components.find((c) => c.kind === "pump")!.props.mechanicalDrag).toBe(0.0000001);
    expect(parseProject(sandbox).components.find((c) => c.kind === "pump")!.props.mechanicalDrag).toBe(0.000003);
  });
});
