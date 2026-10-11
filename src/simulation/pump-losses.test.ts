/** Sourced pump losses: bearing/seal share of shaft input, ω^1.6 speed law, cavitation head drop at NPSH3. */
import { describe, it, expect } from "vitest";
import { Builder } from "./scaling-validation";
import { Simulation, DT } from "./engine";
import { cavitationFactor, mechanicalLossPower, pumpCurve } from "./hydraulic";
import { makeComponent } from "./model";

describe("mechanical (bearing and seal) loss", () => {
  it("is the configured share of shaft input at the rated point", () => {
    for (const [variant, share] of [["standard", 0.02], ["industrial", 0.019], ["highCapacity", 0.015]] as const) {
      const c = { ...makeComponent("pump", 0, 0), variant };
      const pump = { ...c, props: { ...c.props, ...(variant === "industrial" ? { ratedFlow: 0.006, shutoffHead: 35, efficiency: 0.78, mechanicalLoss: 1.9 } : variant === "highCapacity" ? { ratedSpeed: 154.5, ratedFlow: 0.05, shutoffHead: 30, efficiency: 0.82, mechanicalLoss: 1.5 } : {}) } };
      const props = pump.props as Record<string, number>, op = pumpCurve(pump, props.ratedSpeed, props.ratedFlow);
      expect(op.mechanicalLoss / op.shaftPower).toBeCloseTo(share, 12);
    }
  });
  it("scales with speed as (ω/ω_r)^1.6 and vanishes at rest", () => {
    const c = makeComponent("pump", 0, 0), wr = c.props.ratedSpeed as number;
    expect(mechanicalLossPower(c, wr / 2) / mechanicalLossPower(c, wr)).toBeCloseTo(0.5 ** 1.6, 12);
    expect(mechanicalLossPower(c, 0)).toBe(0);
  });
});

describe("cavitation head drop", () => {
  it("drops head by exactly 3 % at NPSH3 and breaks down below it", () => {
    expect(cavitationFactor(2, 2)).toBeCloseTo(0.97, 12);
    expect(cavitationFactor(4, 2)).toBeCloseTo(1 - 0.03 / 32, 12);
    expect(cavitationFactor(1, 2)).toBeCloseTo(1 - 0.03 * 32, 12);
    expect(cavitationFactor(0.5, 2)).toBe(0);
    expect(cavitationFactor(10, 0)).toBe(1);
  });
  function suctionLift(npsh3: number) {
    const b = new Builder(), src = b.add("source3"), motor = b.add("inductionMotor");
    const pump = b.add("pump", { ratedSpeed: 157, ratedFlow: 0.02, shutoffHead: 25, efficiency: 0.8, npshRequired: npsh3, elevation: 6 });
    const sump = b.add("tank", { capacity: 50000, volume: 40000, surfaceArea: 20, loss: 0, initialTemperature: 60 }), high = b.add("tank", { capacity: 50000, volume: 0, surfaceArea: 20, elevation: 10, loss: 0 });
    const suction = b.add("pipe", { diameter: 0.1, length: 8, inventory: false }), discharge = b.add("pipe", { diameter: 0.1, length: 20, inventory: false });
    b.series(src, motor); b.wire(motor, "shaft", pump, "shaft");
    b.wire(sump, "fluid", suction, "inlet"); b.wire(suction, "outlet", pump, "inlet"); b.wire(pump, "outlet", discharge, "inlet"); b.wire(discharge, "outlet", high, "fluid");
    const s = new Simulation(b.p);
    const flows: number[] = [];
    for (let i = 0; i < 8 / DT; i++) { expect(s.step()).toBe(true); flows.push(s.multiphysics.hydraulic.readings[pump.id].flow); }
    return { s, r: s.multiphysics.hydraulic.readings[pump.id], flows };
  }
  it("a suction lift below NPSH3 reduces head and flow, settles without oscillation and conserves energy", () => {
    const healthy = suctionLift(0.01), cavitating = suctionLift(4);
    expect(healthy.r.cavitation).toBeCloseTo(1, 6);
    expect(cavitating.r.npshAvailable!).toBeLessThan(4);
    expect(cavitating.r.cavitation!).toBeLessThan(0.97);
    expect(cavitating.r.flow).toBeLessThan(healthy.r.flow);
    const tail = cavitating.flows.slice(-60);
    expect((Math.max(...tail) - Math.min(...tail)) / cavitating.r.flow).toBeLessThan(1e-3);
    expect(Math.abs(cavitating.s.energyResidual / cavitating.s.suppliedEnergy)).toBeLessThan(1e-5);
    expect(cavitating.s.multiphysics.hydraulic.diagnostics.some((d) => /cavitating/.test(d))).toBe(true);
  });
});
