/**
 * Regression tests for overflow, water viscosity and pump power definitions. Expected
 * values are published reference data or independent hand calculations, not outputs
 * of the implementation under test.
 */
import { describe, it, expect } from "vitest";
import { iapwsViscosity, waterViscosity, kellDensity } from "./water";
import { pipeLoss, pumpCurve, pumpRatingReadouts, mechanicalLossPower } from "./hydraulic";
import { hydraulicStarter, heatExchangerStarter } from "./hydraulic-projects";
import { Builder } from "./scaling-validation";
import { Simulation, DT } from "./engine";
import { readProbe } from "./measurements";
import { makeComponent, type Component, type Property } from "./model";

const run = (s: Simulation, seconds: number, dt = DT) => { for (let i = 0; i < Math.round(seconds / dt); i++) if (!s.step(dt)) break; return s; };
const probe = (s: Simulation, component: string, measurement: string) => readProbe({ id: "", name: "", component, measurement, color: "#ffffff", visible: true } as never, s);
const rel = (a: number, b: number) => Math.abs(a / b - 1);

describe("water viscosity (IAPWS 2008) and density (Kell 1975)", () => {
  it("reproduces the official IAPWS R12-08 check values (Table 4, μ̄₂ = 1)", () => {
    for (const [t, rho, mu] of [[298.15, 998, 889.7351], [298.15, 1200, 1437.649467], [373.15, 1000, 307.883622], [433.15, 1, 14.538324]])
      expect(rel(iapwsViscosity(t, rho) * 1e6, mu)).toBeLessThan(1e-7);
  });
  it("matches published 1 atm liquid viscosities within 0.1 %", () => {
    // NIST Chemistry WebBook / IAPWS-95 at 0.101325 MPa (mPa·s).
    for (const [t, mu] of [[10, 1.3059], [20, 1.0016], [40, 0.65272], [80, 0.35404]]) {
      const error = rel(waterViscosity(t) * 1e3, mu);
      expect(error, `${t} °C`).toBeLessThan(1e-3);
    }
    expect(rel(kellDensity(20), 998.2071)).toBeLessThan(1e-5);
    expect(rel(kellDensity(80), 971.80)).toBeLessThan(1e-4);
  });
  it("refuses to extrapolate outside the liquid range", () => {
    expect(() => waterViscosity(-0.5)).toThrow(/outside the liquid range/);
    expect(() => waterViscosity(100.5)).toThrow(/outside the liquid range/);
  });
});

describe("pipe friction with temperature-dependent viscosity", () => {
  const pipe = (props: Record<string, Property>) => { const c = makeComponent("pipe", 0, 0); c.props = { ...c.props, ...props }; return c; };
  it("laminar loss equals Hagen–Poiseuille with the published 80 °C viscosity", () => {
    const c = pipe({ diameter: 0.002, length: 20 }), q = 2e-7;
    const expected = 128 * 0.35404e-3 * 20 * q / (Math.PI * 0.002 ** 4);
    expect(rel(pipeLoss(c, q, [353.15]).dp, expected)).toBeLessThan(1e-3);
  });
  it("turbulent loss agrees with an independent Colebrook solution within 1.5 %", () => {
    const c = pipe({ diameter: 0.05, length: 10, roughness: 0.000045 });
    for (const [celsius, mu] of [[10, 1.3059e-3], [80, 0.35404e-3]]) {
      const q = 0.01, v = q / (Math.PI * 0.05 ** 2 / 4), re = 1000 * v * 0.05 / mu;
      let f = 0.02;
      for (let i = 0; i < 50; i++) f = (-2 * Math.log10(0.000045 / 0.05 / 3.7 + 2.51 / (re * Math.sqrt(f)))) ** -2;
      const expected = f * 10 / 0.05 * 1000 * v * v / 2;
      expect(rel(pipeLoss(c, q, [celsius + 273.15]).dp, expected), `${celsius} °C`).toBeLessThan(0.015);
    }
  });
  it("uses each inventory cell's own temperature", () => {
    const c = pipe({ diameter: 0.002, length: 20 }), q = 2e-7;
    const mixed = pipeLoss(c, q, [283.15, 353.15]).dp, expected = 128 * (1.3059e-3 + 0.35404e-3) / 2 * 20 * q / (Math.PI * 0.002 ** 4);
    expect(rel(mixed, expected)).toBeLessThan(1e-3);
  });
  it("otherwise identical laminar branches carry flow in the inverse ratio of viscosity", () => {
    const b = new Builder(), flows: Component[] = [];
    for (const temperature of [80, 10]) {
      const source = b.add("tank", { capacity: 100, volume: 50, surfaceArea: 1, elevation: 0.45, initialTemperature: temperature, loss: 0 });
      const sink = b.add("tank", { capacity: 100, volume: 0, surfaceArea: 1, initialTemperature: temperature, loss: 0 });
      const p = b.add("pipe", { diameter: 0.002, length: 20, inventory: false });
      b.wire(source, "fluid", p, "inlet"); b.wire(p, "outlet", sink, "fluid");
      flows.push(p);
    }
    const s = new Simulation(b.p);
    // Driving pressure ρ_ref·g·0.45 m + g·m/A, m = 50 L × published density (971.80 / 999.70 kg/m³);
    // laminar Q = Δp·πd⁴/(128 μ L).
    for (const [pipeC, mu, density] of [[flows[0], 0.35404e-3, 971.8], [flows[1], 1.3059e-3, 999.7]] as const) {
      const dp = 1000 * 9.80665 * 0.45 + 9.80665 * 0.05 * density;
      const expected = dp * Math.PI * 0.002 ** 4 / (128 * mu * 20);
      expect(s.multiphysics.hydraulic.readings[pipeC.id].reynolds).toBeLessThan(2300);
      expect(rel(s.multiphysics.hydraulic.readings[pipeC.id].flow, expected)).toBeLessThan(2e-3);
    }
  });
  it("the heat-exchanger lab's 80 °C stream now flows faster than the 10 °C stream", () => {
    const s = run(new Simulation(heatExchangerStarter()), 2);
    const [hot, cold] = s.project.components.filter((c) => c.kind === "pipe").map((c) => s.multiphysics.hydraulic.readings[c.id]);
    expect(hot.flow).toBeGreaterThan(cold.flow * 1.002);
    expect(hot.reynolds).toBeGreaterThan(cold.reynolds * 3);
  });
});

describe("explicit tank overflow", () => {
  const fillUntilFull = (s: Simulation, id: string) => { while (s.time < 600 && s.multiphysics.tanks[id].volume < 0.12 - 1e-12) s.advanceAdaptive(5); };
  it("a full receiver keeps receiving water and spills it; the pump is not stopped", { timeout: 60000 }, () => {
    const s = new Simulation(hydraulicStarter("transfer")), dest = s.project.components.find((c) => c.name === "Destination tank")!;
    const pump = s.project.components.find((c) => c.kind === "pump")!;
    fillUntilFull(s, dest.id);
    run(s, 30);
    const inflow = s.multiphysics.hydraulic.readings[pump.id].flow;
    expect(inflow).toBeGreaterThan(1e-5);
    // Quasi-steady weir: the surcharge h above the rim satisfies Q = ⅔·C_d·√(2g)·L·h^1.5
    // (C_d 0.62, L 0.3 m), computed here independently of the implementation.
    const h = (s.multiphysics.tanks[dest.id].volume - 0.12) / 0.1;
    const expectedH = (s.multiphysics.overflowRate[dest.id] / ((2 / 3) * 0.62 * Math.sqrt(2 * 9.80665) * 0.3)) ** (2 / 3);
    expect(h).toBeGreaterThan(0);
    expect(rel(h, expectedH)).toBeLessThan(2e-3);
    // With a slowly falling source level the spill tracks the inflow closely.
    expect(rel(s.multiphysics.overflowRate[dest.id], inflow)).toBeLessThan(0.02);
    expect(probe(s, dest.id, "overflow")).toBeCloseTo(s.multiphysics.overflowRate[dest.id] * 60000, 9);
    expect(s.events.some((e) => /overflowing/.test(e.message))).toBe(true);
    expect(Math.abs(s.multiphysics.massResidual)).toBeLessThan(1e-9);
    expect(Math.abs(s.energyResidual / s.suppliedEnergy)).toBeLessThan(1e-5);
  });
  it("closes mass and energy through onset and sustained overflow down to an empty source", { timeout: 60000 }, () => {
    const s = new Simulation(hydraulicStarter("transfer")), [source, dest] = ["Source reservoir", "Destination tank"].map((n) => s.project.components.find((c) => c.name === n)!);
    s.advanceAdaptive(400);
    const v = (id: string) => s.multiphysics.tanks[id].volume;
    expect(v(source.id)).toBeGreaterThanOrEqual(0);
    expect(v(source.id)).toBeLessThan(1e-9);
    // Mass closes exactly; volumes to the thermal expansion from viscous heating (~1e-6).
    // Exact up to double-precision accumulation over thousands of steps (~10⁻¹² relative); the source
    // keeps ±10⁻¹⁰ kg of round-off after its emptiness event.
    const closure = s.multiphysics.tanks[dest.id].mass + s.multiphysics.tanks[source.id].mass + s.multiphysics.removedMass - s.multiphysics.initialMass;
    expect(Math.abs(closure) / s.multiphysics.initialMass).toBeLessThan(1e-11);
    expect(Math.abs((v(dest.id) + s.multiphysics.overflowed[dest.id]) / 0.15 - 1)).toBeLessThan(1e-5);
    // After the inflow stops the surcharge drains back towards the rim.
    expect(v(dest.id) - 0.12).toBeLessThan(2e-4);
    expect(Math.abs(s.energyResidual / s.suppliedEnergy)).toBeLessThan(1e-5);
    expect(s.events.some((e) => /overflow stopped/.test(e.message))).toBe(true);
  });
  it("explicit level control prevents overflow (automatic supply starter)", { timeout: 60000 }, () => {
    const s = new Simulation(hydraulicStarter("supply"));
    s.advanceAdaptive(600);
    for (const t of s.project.components.filter((c) => c.kind === "tank")) expect(s.multiphysics.overflowed[t.id] ?? 0).toBe(0);
  });
  it("handles reverse flow into a full tank without oscillation or negative inventory", () => {
    const b = new Builder();
    const low = b.add("tank", { capacity: 50, volume: 49.5, surfaceArea: 0.05, elevation: 0, loss: 0 });
    const high = b.add("tank", { capacity: 200, volume: 150, surfaceArea: 0.1, elevation: 2, loss: 0 });
    const p = b.add("pipe", { diameter: 0.02, length: 5, inventory: false });
    b.wire(low, "fluid", p, "inlet"); b.wire(p, "outlet", high, "fluid");
    const s = new Simulation(b.p);
    // A weir rises smoothly to one peak and decays; oscillation would reverse the trend repeatedly.
    let previous = 0, trend = 0, reversals = 0;
    for (let i = 0; i < 60 * 30; i++) {
      s.step();
      const rate = s.multiphysics.overflowRate[low.id], change = rate - previous;
      if (Math.abs(change) > 1e-10) { const sign = Math.sign(change); if (trend && sign !== trend) reversals++; trend = sign; }
      previous = rate;
    }
    expect(s.multiphysics.hydraulic.readings[p.id].flow).toBeLessThan(0);
    expect(reversals).toBeLessThanOrEqual(1);
    expect(s.multiphysics.tanks[high.id].volume).toBeGreaterThanOrEqual(0);
    expect(s.multiphysics.tanks[low.id].mass + s.multiphysics.tanks[high.id].mass + s.multiphysics.removedMass).toBeCloseTo(s.multiphysics.initialMass, 9);
    expect(Math.abs((s.multiphysics.tanks[low.id].volume + s.multiphysics.tanks[high.id].volume + s.multiphysics.overflowed[low.id]) / 0.1995 - 1)).toBeLessThan(1e-5);
  });
  it("overflow volume is insensitive to the timestep and to adaptive stepping", () => {
    const results = [1 / 60, 0.05, 0.1].map((dt) => {
      const s = new Simulation(hydraulicStarter("transfer"));
      run(s, 240, dt);
      return s.multiphysics.overflowed[s.project.components.find((c) => c.name === "Destination tank")!.id];
    });
    const adaptive = new Simulation(hydraulicStarter("transfer"));
    adaptive.advanceAdaptive(240);
    results.push(adaptive.multiphysics.overflowed[adaptive.project.components.find((c) => c.name === "Destination tank")!.id]);
    for (const r of results) expect(rel(r, results[0])).toBeLessThan(5e-3);
  }, 300000);
});

describe("pump power and efficiency definitions", () => {
  const pump = () => makeComponent("pump", 0, 0);
  it("nominal rating includes mechanical loss and matches an independent hand calculation", () => {
    const rows = Object.fromEntries(pumpRatingReadouts(pump()).map((r) => [r.label, r.value]));
    // Hs 8 m, Qr 1 L/s, ω 300 rad/s, η 0.7, mechanical loss 2 % of shaft input, R_int 1e5 Pa·s/m³.
    const impeller = 1000 * 9.80665 * 4 * 0.001, mech = 0.02 / 0.98 * impeller / 0.7, shaft = impeller / 0.7 + mech, net = impeller - 1e5 * 0.001 ** 2;
    expect(mech / shaft).toBeCloseTo(0.02, 12);
    expect(rows["Impeller power at rating"]).toBeCloseTo(impeller, 9);
    expect(rows["Mechanical loss at rated speed"]).toBeCloseTo(mech, 9);
    expect(rows["Shaft power at rating"]).toBeCloseTo(shaft, 9);
    expect(rows["Net hydraulic power at rating"]).toBeCloseTo(net, 9);
    expect(rows["Overall efficiency at rating"]).toBeCloseTo(net / shaft * 100, 9);
  });
  it("live readings satisfy the power identities and agree across API, UI probes and export", { timeout: 60000 }, () => {
    const s = run(new Simulation(hydraulicStarter("transfer")), 60), c = s.project.components.find((c) => c.kind === "pump")!;
    const r = s.multiphysics.hydraulic.readings[c.id], omega = s.multiphysics.motors[s.project.components.find((c) => c.kind === "motor")!.id].omega;
    // Bearing/seal loss scales as (ω/ω_r)^1.6 from its rated share. Readings use the coupled step's
    // midpoint speed; ω here is the end-of-step speed.
    const rated = pumpRatingReadouts(c).find((x) => x.label === "Mechanical loss at rated speed")!.value;
    expect(rel(r.mechanicalLoss, rated * (omega / (c.props.ratedSpeed as number)) ** 1.6)).toBeLessThan(1e-5);
    expect(r.shaftPower).toBeCloseTo(r.impellerPower / r.hydraulicEfficiency! + r.mechanicalLoss, 6);
    // Net power from the solved pressures: (outlet − inlet) × flow.
    // Agreement to the hydraulic solver's pressure residual (~1e-6 relative).
    expect(rel(r.hydraulicPower, (r.pressure - r.inletPressure) * r.flow)).toBeLessThan(1e-5);
    expect(r.efficiency!).toBeCloseTo(r.hydraulicPower / r.shaftPower, 12);
    // UI/CSV probes (percent) report the same definitions as the API (fraction).
    expect(probe(s, c.id, "efficiency")).toBeCloseTo(r.efficiency! * 100, 9);
    expect(probe(s, c.id, "hydraulicEfficiency")).toBeCloseTo(r.hydraulicEfficiency! * 100, 9);
    expect(probe(s, c.id, "hydraulicPower")).toBe(r.hydraulicPower);
    expect(probe(s, c.id, "impellerPower")).toBe(r.impellerPower);
    expect(probe(s, c.id, "shaftPower")).toBe(r.shaftPower);
    // The motor delivers exactly the pump's shaft power (one transfer, counted once).
    expect(s.multiphysics.motors[s.project.components.find((c) => c.kind === "motor")!.id].shaftPower).toBeCloseTo(r.shaftPower, 3);
  });
  it("defines zero speed, deadhead and beyond-curve operation explicitly", () => {
    const c = pump();
    const stopped = pumpCurve(c, 0, 0);
    expect([stopped.shaftPower, stopped.efficiency, stopped.hydraulicEfficiency]).toEqual([0, null, null]);
    const deadhead = pumpCurve(c, 300, 0);
    expect(deadhead.shaftPower).toBeCloseTo(mechanicalLossPower(c, 300), 12); // bearing/seal loss only
    expect(deadhead.efficiency).toBe(0);
    expect(deadhead.hydraulicEfficiency).toBeNull();
    const restriction = pumpCurve(c, 300, 0.002);
    expect(restriction.impellerPower).toBe(0);
    expect(restriction.efficiency).toBeNull();
  });
});
