/** Speed-controlled DC drive: PI speed loop, armature current limit, zero steady-state error, anti-windup. */
import { describe, it, expect } from "vitest";
import { Builder } from "./scaling-validation";
import { Simulation, DT } from "./engine";
import type { Project, Property } from "./model";

const industrial = { resistance: 0.1, torqueConstant: 2.3, emfConstant: 2.3, inertia: 1.2, friction: 0.02, ratedVoltage: 440, ratedCurrent: 190, ratedTorque: 437, ratedPower: 84000, maxSpeed: 230 };
function rig(props: Record<string, Property>) {
  const b = new Builder(), source = b.add("source", { voltage: 440, ratedVoltage: 600, maxCurrent: 1e4, maxPower: 1e7 }), motor = b.add("motor", { ...industrial, speedControl: true, ...props });
  b.series(source, motor);
  return { s: new Simulation(b.p), id: motor.id };
}
const rpm = (s: Simulation, id: string) => s.multiphysics.motors[id].omega * 30 / Math.PI;
const set = (s: Simulation, id: string, key: string, value: Property) =>
  s.refresh({ ...s.project, components: s.project.components.map((c) => c.id === id ? { ...c, props: { ...c.props, [key]: value } } : c) } as Project);
function run(s: Simulation, seconds: number, each?: () => void) { for (let i = 0; i < Math.round(seconds / DT); i++) { expect(s.step()).toBe(true); each?.(); } }

describe("speed-controlled DC drive", () => {
  it("starts at the 150 % armature current limit, then holds the command with zero steady-state error", () => {
    const { s, id } = rig({ speedCommand: 1500, loadTorque: 400 });
    let peak = 0;
    run(s, 4, () => { peak = Math.max(peak, Math.abs(s.multiphysics.motors[id].current)); });
    // Without a current limit the 0.1 Ω armature would draw 440/0.1 = 4,400 A at standstill.
    expect(peak).toBeLessThanOrEqual(1.5 * 190 * (1 + 1e-9));
    expect(peak).toBeGreaterThan(1.5 * 190 * 0.99);
    expect(Math.abs(rpm(s, id) - 1500)).toBeLessThan(0.01);
    // Steady state: armature current carries the load and friction torque, I = (T_L + b·ω)/k_t.
    const omega = s.multiphysics.motors[id].omega;
    expect(s.multiphysics.motors[id].current).toBeCloseTo((400 + 0.02 * omega) / 2.3, 3);
  });
  it("a load step is rejected by integral action: the speed dips and returns to the command", () => {
    const { s, id } = rig({ speedCommand: 1500, loadTorque: 100 });
    run(s, 4);
    set(s, id, "loadTorque", 400);
    let lowest = Infinity;
    run(s, 3, () => { lowest = Math.min(lowest, rpm(s, id)); });
    expect(lowest).toBeLessThan(1499);
    expect(Math.abs(rpm(s, id) - 1500)).toBeLessThan(0.01);
  });
  it("an unreachable command saturates the duty without integral windup", () => {
    // 2,000 RPM needs kₑ·ω ≈ 482 V > 440 V supply: full duty, the speed settles below the command.
    // The integral is held while saturated (conditional integration, as in industrial speed controllers), so the
    // response to a reachable command does not depend on how long the drive was saturated.
    const response = (saturated: number) => {
      const { s, id } = rig({ speedCommand: 2000, loadTorque: 100 });
      run(s, saturated);
      expect(s.multiphysics.motors[id].duty).toBe(1);
      expect(rpm(s, id)).toBeLessThan(2000);
      set(s, id, "speedCommand", 1500);
      let lowest = Infinity;
      run(s, 4, () => { lowest = Math.min(lowest, rpm(s, id)); });
      expect(Math.abs(rpm(s, id) - 1500)).toBeLessThan(0.01);
      return lowest;
    };
    expect(response(30)).toBeCloseTo(response(6), 6);
  });
});
