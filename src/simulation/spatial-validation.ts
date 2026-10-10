import { Simulation } from './engine';
import { makeComponent, uid, type Project } from './model';
import { defaultWorld, makeSpatial } from './spatial-model';
import { mechanicalStarter } from './spatial-projects';
import type { ValidationRow } from './validation';

/** Analytical references and measured timestep differences, including the shared electrical shaft. */
export function runSpatialValidation(): ValidationRow[] {
  const rows: ValidationRow[] = [];
  const add = (name: string, measured: number, expected: number, tolerance: number, assumptions: string) => rows.push({ name, domain: 'mechanical', measured, expected, tolerance, assumptions, absoluteError: Math.abs(measured - expected), relativeError: expected ? Math.abs((measured - expected) / expected) : null, pass: Number.isFinite(measured) && Math.abs(measured - expected) <= tolerance });
  const run = (p: Project, dt: number, seconds: number) => { const s = new Simulation(p); for (let i = 0; i < Math.round(seconds / dt); i++) if (!s.step(dt)) throw Error(s.error!); return s; };
  const c = makeComponent('rigidBody', 0, 0, []); c.spatial = { ...makeSpatial('circle', 0, 10), width: 0.4, height: 0.4, mass: 2, collision: false };
  const p: Project = { version: 4, id: uid(), name: 'SI reference', components: [c], connections: [], world: defaultWorld() };
  const steps = [1 / 60, 1 / 240, 1 / 480, 1 / 960];
  const falls = steps.map(dt => run(p, dt, 1));
  falls.forEach((s, i) => {
    add(`Free-fall velocity dt=${steps[i]}`, s.spatial.readings[c.id].vy, -9.80665, 1e-8, 'Gravity only; no air drag, no impact; exact constant acceleration velocity');
    add(`Free-fall position dt=${steps[i]}`, s.spatial.readings[c.id].y, 10 - 9.80665 / 2, 0.011, 'Planck semi-implicit Euler; internal h≤1/480 s; position error O(h)');
  });
  const positionErrors = falls.map(s => Math.abs(s.spatial.readings[c.id].y - (10 - 9.80665 / 2)));
  add('Free-fall halving internal timestep error ratio', positionErrors[2] / positionErrors[3], 2, 1e-7, 'h=1/480 versus 1/960 s; analytical reference; O(h) position integration');
  p.world!.gravity.y = 0; c.props.appliedTorque = 0.5;
  const torque = run(p, 1 / 60, 1), b = torque.spatial.readings[c.id];
  add('Rigid disk inertia', b.inertia, 0.5 * 2 * 0.2 ** 2, 1e-10, 'Solid disk with explicit 2 kg mass; radius 0.2 m');
  add('Constant torque angular acceleration', b.omega, 0.5 / b.inertia, 1e-8, 'No other torques; omega=tau t/I');
  add('Constant torque work balance', torque.energyResidual, 0, 1e-8, 'Integrated torque times midpoint angular velocity equals kinetic-energy change');
  const rotor = mechanicalStarter('rotor');
  const motor = rotor.components.find(c => c.kind === 'motor')!, wheel = rotor.components.find(c => c.name === 'Driven rotor')!;
  // Fixed duty isolates the shaft integration order from the 60 Hz speed controller.
  motor.props.speedControl = false;
  const motors = steps.map(dt => run(rotor, dt, 2)), fine = motors[3];
  motors.forEach((s, i) => {
    add(`Electrical-spatial shaft energy balance dt=${steps[i]}`, s.energyResidual, 0, 0.001, 'Implicit motor midpoint coupled to Planck mass matrix; copper/friction/brake losses explicit');
    add(`Authoritative motor/body shaft speed dt=${steps[i]}`, s.multiphysics.motors[motor.id].omega - s.spatial.readings[wheel.id].omega, 0, 0, 'One angular velocity; rotor inertia added to rigid-body inertia exactly once');
    if (i < 3) {
      add(`Electrical-spatial speed convergence dt=${steps[i]}`, s.multiphysics.motors[motor.id].omega, fine.multiphysics.motors[motor.id].omega, 0.005, '2 s against dt=1/960 s reference; fixed duty and viscous shaft brake');
      add(`Electrical-spatial current convergence dt=${steps[i]}`, s.multiphysics.motors[motor.id].current, fine.multiphysics.motors[motor.id].current, 0.01, 'MNA back EMF; latest midpoint current has O(h) reporting offset; tolerance 10 mA');
    }
  });
  add('Finer shaft step reduces speed error', Number(Math.abs(motors[2].multiphysics.motors[motor.id].omega - fine.multiphysics.motors[motor.id].omega) < 0.001), 1, 0, 'h=1/480 against h=1/960 s reference; speed difference below 1 mrad/s');
  return rows;
}
