import { describe, it, expect } from 'vitest';
import { Builder } from './scaling-validation';
import { Simulation, DT } from './engine';
import { dynamometerTorque, trainAcceleration, shaftTrain } from './drivetrain';
import { inductionCircuit } from './electrical';
import { readProbe } from './measurements';
import { connect, makeComponent, type Component, type Measurement, type Project } from './model';

const run = (s: Simulation, seconds: number) => { for (let i = 0; i < Math.round(seconds / DT); i++) expect(s.step(), s.error ?? '').toBe(true); };
const rel = (a: number, b: number) => Math.abs(a / b - 1);
const probe = (s: Simulation, c: Component, measurement: Measurement) => readProbe({ id: 'p', name: 'p', component: c.id, measurement, color: '#ffffff', visible: true }, s)!;
const toggle = (s: Simulation, id: string, enabled: boolean) => s.refresh({ ...s.project, components: s.project.components.map(c => c.id === id ? { ...c, props: { ...c.props, enabled } } : c) } as Project);
/** 24 V laboratory DC motor (R 1.2 Ω, k 0.08, J 0.006 kg·m², b 0.0005 N·m·s) on an ideal supply. */
function dcRig(flywheel?: Record<string, number>, dynamometer?: Record<string, number | string>) {
  const b = new Builder(), source = b.add('source', { voltage: 24, maxCurrent: 100 }), motor = b.add('motor', { heatCapacity: 1e6 });
  b.series(source, motor);
  const fw = flywheel ? b.add('flywheel', flywheel) : undefined, dy = dynamometer ? b.add('dynamometer', dynamometer) : undefined;
  if (fw) b.wire(motor, 'shaft', fw, 'shaft');
  if (dy) b.wire(motor, 'shaft', dy, 'shaft');
  return { s: new Simulation(b.p), b, motor, fw, dy };
}

describe('flywheel / driven inertia', () => {
  it('slows a DC motor run-up by its reflected inertia J/i², along the exact first-order response', () => {
    const { s, motor, fw } = dcRig({ inertia: 0.1, gearRatio: 4, gearEfficiency: 100, friction: 0 });
    // J·dω/dt = k(V − kω)/R − bω with J = 0.006 + 0.1/16: ω∞ = (kV/R)/(k²/R + b), τ = J/(k²/R + b) ≈ 2.3 s.
    const k = 0.08, R = 1.2, b = 0.0005, J = 0.006 + 0.1 / 16, damping = k * k / R + b, final = (k * 24 / R) / damping, tau = J / damping;
    run(s, 2);
    expect(rel(s.multiphysics.motors[motor.id].omega, final * -Math.expm1(-s.time / tau))).toBeLessThan(1e-4);
    // The flywheel turns at motor speed / 4 and stores ½·J·ω_f².
    expect(rel(probe(s, fw!, 'rpm'), probe(s, motor, 'rpm') / 4)).toBeLessThan(1e-12);
    expect(rel(probe(s, fw!, 'kineticEnergy'), 0.5 * 0.1 * (s.multiphysics.motors[motor.id].omega / 4) ** 2)).toBeLessThan(1e-12);
    expect(Math.abs(s.energyResidual / s.suppliedEnergy)).toBeLessThan(1e-9);
  });

  it('costs T/η to accelerate and returns only η·T when it drives back; the mesh loss is heat in both directions', () => {
    const { s, motor } = dcRig({ inertia: 0.4, gearRatio: 5, gearEfficiency: 90, friction: 0.01 });
    run(s, 3);
    const accelerating = s.multiphysics.drivetrainLoss;
    expect(s.multiphysics.motors[motor.id].gear).toBeCloseTo(1 / 0.9, 12);
    expect(accelerating).toBeGreaterThan(0);
    // Power off: the flywheel drives the motor rotor and its friction through the gear (k = η).
    expect(toggle(s, motor.id, false)).toBe(true);
    run(s, 1);
    expect(s.multiphysics.motors[motor.id].gear).toBeCloseTo(0.9, 12);
    expect(s.multiphysics.drivetrainLoss).toBeGreaterThan(accelerating);
    expect(Math.abs(s.energyResidual / s.suppliedEnergy)).toBeLessThan(1e-9);
  });

  it('chooses the gear factor from the direction of the transmitted power', () => {
    const train = { flywheel: { ...makeComponent('flywheel', 0, 0), props: { ...makeComponent('flywheel', 0, 0).props, inertia: 1, gearRatio: 2, gearEfficiency: 80, friction: 0 } } };
    const forward = trainAcceleration(0.01, train, 10, 50), back = trainAcceleration(0.01, train, -10, 50);
    expect(forward.gear).toBe(1.25); // accelerating: J/(i²·η) seen by the motor
    expect(forward.acceleration).toBeCloseTo(10 / (0.01 + 1.25 * 0.25), 12);
    expect(back.gear).toBe(0.8); // braking the flywheel through the motor: η·J/i²
    expect(back.acceleration).toBeCloseTo(-10 / (0.01 + 0.8 * 0.25), 12);
  });

  it('reports an overspeed above its safe speed', () => {
    const { s, fw } = dcRig({ inertia: 0.001, gearRatio: 0.5, maxSpeed: 200 }); // speed-up gear: flywheel at 2 × motor speed
    run(s, 5);
    expect(probe(s, fw!, 'rpm')).toBeGreaterThan(200 * 30 / Math.PI);
    expect(s.violations.some(v => /maximum safe speed/.test(v))).toBe(true);
  });
});

describe('dynamometer', () => {
  it('absorber characteristics: electric constant, eddy-current rising to its rated speed, water brake ∝ speed²', () => {
    const dyno = (absorber: string) => ({ ...makeComponent('dynamometer', 0, 0), props: { ...makeComponent('dynamometer', 0, 0).props, absorber } });
    const ratedSpeed = 250.3, rated = 140, power = 35000;
    expect(dynamometerTorque(dyno('electric'), 0, 100)).toBe(100);
    expect(dynamometerTorque(dyno('electric'), 2 * ratedSpeed, 200)).toBeCloseTo(power / (2 * ratedSpeed), 9);
    expect(dynamometerTorque(dyno('eddyCurrent'), 0, 100)).toBe(0);
    expect(dynamometerTorque(dyno('eddyCurrent'), 0.5 * ratedSpeed, 200)).toBeCloseTo(rated * 0.8, 9); // 2x/(1+x²) at x = 0.5
    expect(dynamometerTorque(dyno('eddyCurrent'), ratedSpeed, 200)).toBeCloseTo(Math.min(rated, power / ratedSpeed), 9); // peak, power-limited
    expect(dynamometerTorque(dyno('eddyCurrent'), 0.5 * ratedSpeed, 50)).toBe(50); // within the envelope: the set torque
    expect(dynamometerTorque(dyno('waterBrake'), 0.5 * ratedSpeed, 100)).toBeCloseTo(25, 9);
  });

  it('measures an induction motor at the equivalent-circuit operating point: torque, speed, absorbed power, efficiency', () => {
    const b = new Builder(), src = b.add('source3', { lineVoltage: 400, maxCurrent: 1000, maxPower: 1e8 }), motor = b.add('inductionMotor', { heatCapacity: 1e9 });
    const dyno = b.add('dynamometer', { absorber: 'electric', torqueSetpoint: 40 });
    b.series(src, motor); b.wire(motor, 'shaft', dyno, 'shaft');
    const s = new Simulation(b.p);
    run(s, 5);
    const omega = s.multiphysics.motors[motor.id].omega, steady = inductionCircuit(motor, 50, omega).split([400 / Math.sqrt(3), 0]);
    // Steady state: electromagnetic torque = set torque + bearing friction.
    expect(rel(steady.torque, 40 + 0.002 * omega)).toBeLessThan(1e-6);
    expect(probe(s, dyno, 'torque')).toBeCloseTo(40, 9);
    expect(rel(probe(s, dyno, 'shaftPower'), 40 * omega)).toBeLessThan(1e-6);
    expect(rel(probe(s, motor, 'torque'), steady.torque)).toBeLessThan(1e-6);
    expect(probe(s, motor, 'efficiency')).toBeGreaterThan(90);
    expect(Math.abs(s.energyResidual / s.suppliedEnergy)).toBeLessThan(1e-6);
  });

  it('an electric dynamometer holds a motor whose stall torque is below the set torque; an eddy-current brake cannot', () => {
    const held = dcRig(undefined, { absorber: 'electric', torqueSetpoint: 5, ratedTorque: 10, inertia: 0.001 });
    run(held.s, 1);
    expect(held.s.multiphysics.motors[held.motor.id].omega).toBe(0); // stall torque k·V/R = 1.6 N·m < 5 N·m
    expect(probe(held.s, held.dy!, 'torque')).toBeCloseTo(1.6, 9);
    const eddy = dcRig(undefined, { absorber: 'eddyCurrent', torqueSetpoint: 5, ratedTorque: 10, ratedSpeed: 400, inertia: 0.001 });
    run(eddy.s, 2);
    // No torque at standstill: the motor runs up until the eddy torque 10·2x/(1+x²) meets its falling torque.
    expect(eddy.s.multiphysics.motors[eddy.motor.id].omega).toBeGreaterThan(5);
    expect(Math.abs(eddy.s.energyResidual / eddy.s.suppliedEnergy)).toBeLessThan(1e-6);
  });

  it('follows a numeric torque command', () => {
    const { b, motor, dy } = dcRig(undefined, { absorber: 'electric', torqueSetpoint: 0, ratedTorque: 5, inertia: 0.001 });
    const command = b.add('constant', { value: 0.4 });
    b.p = connect(b.p, { component: command.id, port: 'out' }, { component: dy!.id, port: 'torque' });
    const s = new Simulation(b.p);
    run(s, 15); // τ ≈ 1.2 s
    expect(probe(s, dy!, 'torque')).toBeCloseTo(0.4, 6);
    // k(V − kω)/R = 0.4 + bω at steady state.
    expect(rel(s.multiphysics.motors[motor.id].omega, (0.08 * 24 / 1.2 - 0.4) / (0.08 * 0.08 / 1.2 + 0.0005))).toBeLessThan(1e-4);
  });

  it('shares a shaft with a pump and a flywheel, but not with a spatial rotor', () => {
    const b = new Builder(), motor = b.add('motor'), fw = b.add('flywheel'), dy = b.add('dynamometer'), pump = b.add('pump');
    for (const load of [fw, dy, pump]) b.wire(motor, 'shaft', load, 'shaft');
    expect(shaftTrain(b.p, motor.id)).toEqual({ flywheel: fw, dynamometer: dy, pump });
    const body = { ...makeComponent('rigidBody', 0, 0, b.p.components), spatial: { type: 'dynamic', fixedRotation: false } } as unknown as Component;
    b.p.components.push(body);
    expect(() => connect(b.p, { component: motor.id, port: 'shaft' }, { component: body.id, port: 'shaft' })).toThrow(/spatial rotor/);
  });
});
