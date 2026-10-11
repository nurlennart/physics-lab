/** Inherent valve characteristics (linear, equal percentage, quick opening) and their installed behaviour. */
import { describe, it, expect } from "vitest";
import { Builder } from "./scaling-validation";
import { Simulation, DT } from "./engine";
import { relativeFlowCoefficient, VALVE_REGULARIZATION } from "./hydraulic";
import { parseProject, serializeProject } from "./projects";
import { makeComponent, type Property } from "./model";
import { WATER_RHO as RHO } from "./units";

/** Two large tanks 10 m apart in elevation: practically constant Δp across the valve. */
function rig(props: Record<string, Property>, kind: "valve" | "actuatedValve" = "valve", pipeLength = 0) {
  const b = new Builder();
  const high = b.add("tank", { capacity: 1e6, volume: 9e5, surfaceArea: 1000, elevation: 10, loss: 0 }), low = b.add("tank", { capacity: 1e6, volume: 1e3, surfaceArea: 1000, loss: 0 });
  const valve = b.add(kind, { diameter: 0.025, lossCoefficient: 5, laminarK: 0, ...props });
  if (pipeLength > 0) {
    const pipe = b.add("pipe", { diameter: 0.025, length: pipeLength, inventory: false });
    b.wire(high, "fluid", pipe, "inlet"); b.wire(pipe, "outlet", valve, "inlet");
  } else b.wire(high, "fluid", valve, "inlet");
  b.wire(valve, "outlet", low, "fluid");
  const s = new Simulation(b.p);
  s.step();
  return { s, valve };
}
const flow = (props: Record<string, Property>, kind: "valve" | "actuatedValve" = "valve", pipeLength = 0) => {
  const { s, valve } = rig(props, kind, pipeLength);
  return s.multiphysics.hydraulic.readings[valve.id];
};

describe("inherent valve characteristics", () => {
  it("φ = Kv/Kvs follows the textbook forms and is monotone", () => {
    const valve = (characteristic: string) => ({ ...makeComponent("valve", 0, 0), props: { ...makeComponent("valve", 0, 0).props, characteristic, rangeability: 50 } });
    for (const x of [10, 25, 50, 75, 100]) {
      expect(relativeFlowCoefficient(valve("linear"), x)).toBeCloseTo(x / 100, 14);
      expect(relativeFlowCoefficient(valve("quickOpening"), x)).toBeCloseTo(Math.sqrt(x / 100), 14);
      expect(relativeFlowCoefficient(valve("equalPercentage"), x)).toBeCloseTo(50 ** (x / 100 - 1), 14);
    }
    // Equal percentage: each 10 % of travel multiplies Kv by the same factor R^0.1.
    const ep = valve("equalPercentage"), step = relativeFlowCoefficient(ep, 60) / relativeFlowCoefficient(ep, 50);
    expect(relativeFlowCoefficient(ep, 30) / relativeFlowCoefficient(ep, 20)).toBeCloseTo(step, 12);
    expect(step).toBeCloseTo(50 ** 0.1, 12);
    expect(relativeFlowCoefficient(ep, 0)).toBe(0); // seat: exact isolation
  });
  it("the hydraulic solve applies K/φ² exactly at every opening", () => {
    for (const characteristic of ["linear", "equalPercentage", "quickOpening"])
      for (const opening of [5, 30, 60, 100]) {
        const r = flow({ characteristic, opening });
        const phi = relativeFlowCoefficient({ ...makeComponent("valve", 0, 0), props: { ...makeComponent("valve", 0, 0).props, characteristic } }, opening);
        const area = Math.PI * 0.025 ** 2 / 4, quadratic = 5 / phi ** 2 * RHO / (2 * area ** 2);
        expect(r.flow).toBeGreaterThan(0);
        expect(Math.abs(VALVE_REGULARIZATION * r.flow + quadratic * r.flow ** 2 - r.differentialPressure) / r.differentialPressure).toBeLessThan(1e-9);
      }
  });
  it("at constant Δp the flow ratio is φ (turbulent, regularisation < 0.1 %)", () => {
    const full = flow({ opening: 100 }).flow;
    expect(flow({ characteristic: "equalPercentage", opening: 50 }).flow / full).toBeCloseTo(50 ** -0.5, 3);
    expect(flow({ characteristic: "quickOpening", opening: 25 }).flow / full).toBeCloseTo(0.5, 3);
    expect(flow({ characteristic: "linear", opening: 50 }).flow / full).toBeCloseTo(0.5, 3);
  });
  it("installed: a long supply pipe makes an equal-percentage valve closer to linear", () => {
    // 60 m of 25 mm pipe takes most of the head at full opening (low valve authority).
    const ratio = (characteristic: string, opening: number) => flow({ characteristic, opening }, "valve", 60).flow / flow({ characteristic, opening: 100 }, "valve", 60).flow;
    const inherent = 50 ** -0.5, installed = ratio("equalPercentage", 50);
    expect(installed).toBeGreaterThan(2 * inherent);
    expect(installed).toBeLessThan(0.75);
    // Linear trim under the same low authority behaves like quick opening.
    expect(ratio("linear", 25)).toBeGreaterThan(0.4);
  });
  it("the actuated control valve defaults to equal-percentage trim; files without a characteristic keep Kv ∝ opening", () => {
    expect(makeComponent("actuatedValve", 0, 0).props.characteristic).toBe("equalPercentage");
    expect(makeComponent("valve", 0, 0).props.characteristic).toBe("linear");
    const { s, valve } = rig({ opening: 50 }, "actuatedValve");
    const old = JSON.parse(serializeProject(s.project));
    for (const c of old.components) delete c.props.characteristic;
    const loaded = parseProject(old);
    expect(loaded.components.find((c) => c.id === valve.id)!.props.characteristic).toBe("linear");
    const bad = JSON.parse(serializeProject(s.project));
    bad.components.find((c: { id: string }) => c.id === valve.id).props.characteristic = "parabolic";
    expect(() => parseProject(bad)).toThrow(/Unknown inherent characteristic/);
  });
  it("mass and energy close while an actuated equal-percentage valve strokes", () => {
    const { s, valve } = rig({ opening: 0 }, "actuatedValve");
    const edit = structuredClone(s.project);
    edit.components.find((c) => c.id === valve.id)!.props.opening = 100;
    expect(s.refresh(edit)).toBe(true);
    let last = 0;
    for (let i = 0; i < Math.round(6 / DT); i++) {
      expect(s.step()).toBe(true);
      const q = s.multiphysics.hydraulic.readings[valve.id].flow;
      expect(q).toBeGreaterThanOrEqual(last * (1 - 1e-6)); // monotone with travel (the high tank drains slowly)
      last = q;
    }
    expect(Math.abs(s.multiphysics.massResidual)).toBeLessThan(1e-9);
    expect(Math.abs(s.energyResidual) / s.multiphysics.dissipation).toBeLessThan(1e-6);
  });
});
