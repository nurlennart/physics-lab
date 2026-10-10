import { Simulation } from './engine';
import { hydraulicStarter } from './hydraulic-projects';
import type { ValidationRow } from './validation';
/** Quantitative coupled convergence; report raw differences instead of stability-only claims. */
export function runHydraulicValidation(): ValidationRow[] {
  const rows: ValidationRow[] = [], p = hydraulicStarter('transfer');
  const motor = p.components.find(c => c.kind === 'motor')!, pump = p.components.find(c => c.kind === 'pump')!, destination = p.components.find(c => c.name === 'Destination tank')!;
  const add = (name: string, measured: number, expected: number, tolerance: number, assumptions: string) => rows.push({ name, domain: 'multiphysics', measured, expected, tolerance, assumptions, absoluteError: Math.abs(measured - expected), relativeError: expected ? Math.abs((measured - expected) / expected) : null, pass: Number.isFinite(measured) && Math.abs(measured - expected) <= tolerance });
  const sims = [1 / 60, 1 / 120, 1 / 240, 1 / 480, 1 / 960].map(dt => {
    const s = new Simulation(p);
    for (let i = 0; i < Math.round(2 / dt); i++) if (!s.step(dt)) throw Error(s.error!);
    add(`Coupled mass balance at dt=${dt}`, s.multiphysics.massResidual, 0, 1e-7, 'Finite tanks; nonlinear continuity tolerance 1e-12 m³/s; no post-integration volume clamp');
    add(`Coupled energy balance at dt=${dt}`, s.energyResidual, 0, 0.1, 'Electrical supply = thermal + rotor + hydrostatic storage + ambient + shaft export; explicit storage-head splitting');
    return s;
  });
  const fine = sims[4];
  for (let i = 0; i < 4; i++) {
    add(`Destination-volume convergence dt=${[1 / 60, 1 / 120, 1 / 240, 1 / 480][i]}`, sims[i].multiphysics.tanks[destination.id].volume, fine.multiphysics.tanks[destination.id].volume, 2e-6, '2 s startup against dt=1/960 s reference; tolerance 2 mL');
    add(`Motor-current convergence dt=${[1 / 60, 1 / 120, 1 / 240, 1 / 480][i]}`, sims[i].multiphysics.motors[motor.id].current, fine.multiphysics.motors[motor.id].current, 0.03, '2 s startup; midpoint electrical/mechanical coupling; current tolerance 30 mA');
    add(`Motor-speed convergence dt=${[1 / 60, 1 / 120, 1 / 240, 1 / 480][i]}`, sims[i].multiphysics.motors[motor.id].omega, fine.multiphysics.motors[motor.id].omega, 0.01, '2 s startup; speed tolerance 0.01 rad/s');
    add(`Fluid-temperature convergence dt=${[1 / 60, 1 / 120, 1 / 240, 1 / 480][i]}`, sims[i].multiphysics.tanks[destination.id].temperature, fine.multiphysics.tanks[destination.id].temperature, 0.001, 'Conservative zero-volume enthalpy transport plus backward-Euler tank loss; tolerance 1 mK');
  }
  const volumeErrors = sims.map(s => Math.abs(s.multiphysics.tanks[destination.id].volume - fine.multiphysics.tanks[destination.id].volume));
  add('Halved internal timestep reduces volume error', volumeErrors[2] / volumeErrors[3], 3, 0.5, 'dt=1/240 and 1/480 against dt=1/960 reference: first-order storage-head splitting predicts finite-reference error ratio 3');
  const reading = sims[0].multiphysics.hydraulic.readings[pump.id];
  add('Pump shaft input bounds hydraulic output', Number(reading.shaftPower >= reading.hydraulicPower && reading.hydraulicPower >= 0), 1, 0, 'Affinity head curve; hydraulic efficiency ≤1; explicit mechanical drag');
  return rows;
}
