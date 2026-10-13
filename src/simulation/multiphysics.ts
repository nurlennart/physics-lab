import { controlBoiler, newBoiler, type BoilerState } from './boiler';
import { radiatorUA } from './devices';
import { prop, isMotor, type Component, type Project } from './model';
import { inductionCircuit, isStarter, peakOverInterval, solveElectrical, solveLinear, type ElectricalResult, type ElectricalReading } from './electrical';
import { advanceDrive, advanceStarter, driveCommand, driveLineVoltage, newDrive, newStarter, starterCommand, starterEvent, type DriveLimiter, type DriveState, type StarterState } from './converters';
import { machineParams, magneticEnergy, noRotorFlux, openStatorFlux, openStatorStep, cabs, type Cx } from './induction';
import { solveHydraulic, boundaryTime, transport, emptyHydraulics, pipeCells, vaporPressure, npsh3At, isPump, type TankState } from './hydraulic';
import { circulatorInput, circulatorKinetic, circulatorTarget, rampedSpeed, RESTART_MARGIN, type CirculatorPlan, type CirculatorState } from './circulator';
import { unitsSI as U, WATER_CP as CP, WATER_RHO as RHO, GRAVITY as G } from './units';
import { kellDensity, inventoryVolume } from './water';
import type { Simulation } from './engine';
import { shaftBody } from './spatial-model';
import { dynamometerTorque, holdsAtStandstill, reflectedFlywheel, shaftInertia, shaftTrain, trainAcceleration, trainKineticEnergy } from './drivetrain';
/** `angle` is the accumulated rotor rotation (rad) since reset, used for drawing. */
export interface MotorState {
  omega: number; current: number; torque: number; load: number; shaftPower: number; copperPower: number; duty: number; acceleration: number; angle: number;
  /** Induction machines: stator/rotor flux linkages (Wb, RMS phasors in the supply frame), supply frequency, largest instantaneous phase current since energisation (A), flux change rate (1/s). */
  psiS?: Cx; psiR?: Cx[]; frequency?: number; inrushPeak?: number; energized?: boolean; fluxRate?: number;
  /** Speed-controlled DC drive: integral part of the armature current reference (A). */
  speedIntegral?: number;
  /** Shaft train: dynamometer torque absorbed at the midpoint speed (N·m, opposing), flywheel transmitted torque and gear factor. */
  dynamometerTorque?: number; transmitted?: number; gear?: number;
}
/** Below this speed (rad/s) a rotor counts as at rest for the opposing load. */
const OMEGA_REST = 1e-9;
/** A circulator's electronics stay off for this long after an undervoltage lockout before they may restart (s). */
export const CIRCULATOR_RESTART_DELAY = 1;
/** Circulator operating figures of the last solve (W, rad/s), for readings and the Inspector. */
export interface CirculatorView { omega: number; target: number; powered: boolean; running: boolean; lockedOut: boolean; inputPower: number; motorLoss: number }
export class Multiphysics {
  boilers: Record<string, BoilerState> = {};
  tanks: Record<string, TankState> = {};
  motors: Record<string, MotorState> = {};
  positions: Record<string, number> = {};
  /** Water-cell temperatures (K): pipes inlet → outlet; a boiler has one fully mixed cell. */
  pipeCells: Record<string, number[]> = {};
  hydraulic = emptyHydraulics();
  initialMass = 0;
  initialPotential = 0;
  transferred: Record<string, number> = {};
  copperEnergy = 0;
  frictionEnergy = 0;
  pumpWork = 0;
  hydraulicWork = 0;
  dissipation = 0;
  externalShaftWork = 0;
  /** Field energy dumped when an induction machine's winding current is interrupted (J). */
  switchingLoss = 0;
  dryLoss = 0;
  removedMass = 0;
  removedEnergy = 0;
  /** Cumulative volume spilled over each tank rim (m³) and the rate over the last step (m³/s). */
  overflowed: Record<string, number> = {};
  overflowRate: Record<string, number> = {};
  residual = 0;
  couplingIterations = 0;
  /** Motor starters and drives: contactor modes, soft-starter ratio, drive frequency and output angle. */
  starters: Record<string, StarterState> = {};
  drives: Record<string, DriveState> = {};
  /** Electric circulators: rotor speed and undervoltage lockout; `circulatorView` holds the last solve's figures. */
  circulators: Record<string, CirculatorState> = {};
  circulatorView: Record<string, CirculatorView> = {};
  /** Run and speed commands of the circulators, read once per outer step from the control graph. */
  private circulatorCommands: Record<string, { run: boolean; command: number | null }> = {};
  /** Discrete electrical configuration of the last accepted substep (switching detection). */
  private acceptedKey = '';
  private lastElectrical?: ElectricalResult;
  /** Last electromechanical Jacobian (chord Newton), valid for one substep length and motor count. */
  private chord?: { h: number; n: number; key: string; jac: number[][] };
  /** Dynamic state only. Immutable project/circuit references and Newton caches are retained by reference. */
  checkpoint() {
    return {
      boilers: structuredClone(this.boilers),
      tanks: Object.fromEntries(Object.entries(this.tanks).map(([id, t]) => [id, { ...t }])),
      motors: { ...this.motors }, circulators: { ...this.circulators }, circulatorView: { ...this.circulatorView }, positions: { ...this.positions },
      pipeCells: Object.fromEntries(Object.entries(this.pipeCells).map(([id, t]) => [id, [...t]])),
      overflowed: { ...this.overflowed }, overflowRate: { ...this.overflowRate }, removedMass: this.removedMass, removedEnergy: this.removedEnergy,
      hydraulic: this.hydraulic, transferred: { ...this.transferred }, copperEnergy: this.copperEnergy, frictionEnergy: this.frictionEnergy,
      pumpWork: this.pumpWork, hydraulicWork: this.hydraulicWork, dissipation: this.dissipation, externalShaftWork: this.externalShaftWork, dryLoss: this.dryLoss,
      starters: structuredClone(this.starters), drives: structuredClone(this.drives), shaftElements: structuredClone(this.shaftElements),
      drivetrainLoss: this.drivetrainLoss, switchingLoss: this.switchingLoss, residual: this.residual, couplingIterations: this.couplingIterations,
      acceptedKey: this.acceptedKey, lastElectrical: this.lastElectrical, chord: this.chord, lastProject: this.lastProject,
      circulatorCommands: this.circulatorCommands,
    };
  }
  initialize(p: Project) {
    for (const c of p.components) {
      if (c.kind === 'electricBoiler') this.boilers[c.id] = newBoiler(c);
      if (c.kind === 'tank') {
        // The configured initial volume is measured at the initial temperature (Kell density).
        const volume = U.litersToM3(prop(c, 'volume')), temperature = U.celsiusToK(prop(c, 'initialTemperature', 20));
        const mass = volume * kellDensity(prop(c, 'initialTemperature', 20));
        this.tanks[c.id] = { volume, mass, temperature, vessel: prop(c, 'vesselHeatCapacity') };
        this.initialMass += mass;
      }
      if (isMotor(c)) this.motors[c.id] = { omega: p.components.find(b => b.id === shaftBody(p, c.id))?.spatial?.omega ?? 0, current: 0, torque: 0, load: 0, shaftPower: 0, copperPower: 0, duty: 1, acceleration: 0, angle: 0, ...(c.kind === 'inductionMotor' ? { psiS: [0, 0] as Cx, psiR: noRotorFlux(machineParams(c, prop(c, 'ratedFrequency', 50))), frequency: prop(c, 'ratedFrequency', 50), inrushPeak: 0, energized: false, fluxRate: 0 } : {}) };
      if (c.kind === 'actuatedValve') this.positions[c.id] = prop(c, 'opening');
      if (c.kind === 'circulator') this.circulators[c.id] = { omega: 0, lockedOut: false, restartIn: 0, angle: 0 };
      if (c.kind === 'pressureReducingValve') this.positions[c.id] = 100;
      if (pipeCells(c)) this.pipeCells[c.id] = Array(pipeCells(c)).fill(U.celsiusToK(prop(c, 'initialTemperature', 20)));
    }
    this.initialPotential = this.potential(p);
  }
  get massResidual() { return Object.values(this.tanks).reduce((s, t) => s + t.mass, 0) + this.removedMass - this.initialMass; }
  get kinetic() { return this.kineticEnergy(this.lastProject); }
  private lastProject?: Project;
  kineticEnergy(p?: Project) {
    return p ? p.components.filter(c => isMotor(c) && !shaftBody(p, c.id)).reduce((s, c) => {
      const omega = this.motors[c.id]?.omega ?? 0;
      return s + 0.5 * prop(c, 'inertia') * omega ** 2 + trainKineticEnergy(shaftTrain(p, c.id), omega);
    }, 0) + p.components.filter(c => c.kind === 'circulator').reduce((s, c) => s + circulatorKinetic(c, this.circulators[c.id]?.omega ?? 0), 0) : 0;
  }
  /** Flywheels and dynamometers: speed, torque and power over the last step, absorbed energy (J). */
  shaftElements: Record<string, { omega: number; torque: number; power: number; energy: number; kinetic?: number }> = {};
  /** Bearing drag and gear mesh losses of flywheels (J), released to ambient. */
  drivetrainLoss = 0;
  /** Set torque of a dynamometer: its wired numeric torque command, else its set-torque parameter (N·m). */
  private dynamometerSet(s: Simulation, c: Component) {
    if (!s.project.connections.some(w => w.domain === 'control' && w.to.component === c.id && w.to.port === 'torque')) return prop(c, 'torqueSetpoint');
    const command = s.automation.input(c, 'torque', s);
    return command.valid && typeof command.value === 'number' ? Math.max(0, command.value) : 0;
  }
  /** Tank gravitational energy Φ = g(z·m + m²/(2ρ_ref·A)), consistent with the network flow work (Boussinesq). */
  potential(p: Project) { return p.components.filter(c => c.kind === 'tank').reduce((s, c) => { const v = (this.tanks[c.id]?.mass ?? 0) / RHO; return s + RHO * G * (prop(c, 'elevation') * v + v * v / (2 * prop(c, 'surfaceArea'))); }, 0); }
  private controls(s: Simulation) {
    return Object.fromEntries(s.project.components.filter(isMotor).map(c => {
      const has = (port: string) => s.project.connections.some(w => w.domain === 'control' && w.to.component === c.id && w.to.port === port);
      const enable = s.automation.input(c, 'enable', s), speed = s.automation.input(c, 'speed', s);
      const enabled = !s.failed[c.id] && !['failedOpen', 'powerLoss', 'motorFailure', 'controlLost'].includes(s.faults[c.id]) && (has('enable') ? enable.valid && enable.value === true : Boolean(c.props.enabled));
      const command = has('speed') ? (speed.valid && typeof speed.value === 'number' ? Math.max(0, U.rpmToRad(speed.value)) : 0) : c.props.speedControl ? U.rpmToRad(prop(c, 'speedCommand')) : null;
      // Induction machines run direct-on-line (no drive); the DC motor's PWM drive follows the speed command
      // (duty from the speed controller at the solved speed, see dcDuty).
      return [c.id, { enabled: enabled && (command === null || command > 0), duty: 1, command: c.kind === 'motor' ? command : null }];
    }));
  }
  /**
   * Circulator commands: the run flag (wired enable input, else the Run property) and a wired speed command in percent
   * of the maximum speed (null = the internal control mode). A command below 1 % stops the pump, as the PWM input of
   * heating circulators does. A motor failure (blocked rotor) stops it; a control-signal loss runs it at maximum speed.
   */
  private circulatorControls(s: Simulation) {
    return Object.fromEntries(s.project.components.filter(c => c.kind === 'circulator').map(c => {
      const has = (port: string) => s.project.connections.some(w => w.domain === 'control' && w.to.component === c.id && w.to.port === port);
      const enable = s.automation.input(c, 'enable', s), speed = s.automation.input(c, 'speed', s);
      // Lost control signals: heating circulators fall back to their maximum curve (PWM profile for heating).
      if (s.faults[c.id] === 'controlLost') return [c.id, { run: true, command: 100 }];
      const command = has('speed') ? (speed.valid && typeof speed.value === 'number' ? speed.value : 0) : null;
      const run = s.faults[c.id] !== 'motorFailure' && (has('enable') ? enable.valid && enable.value === true : Boolean(c.props.enabled)) && (command === null || command >= 1);
      return [c.id, { run, command }];
    }));
  }
  /**
   * Circulator speeds over a substep of length h. The controller target comes from the last accepted flow (sampled
   * control); the rotor follows it on the soft-start ramp. Without supply (lockout, failure, or `unpowered` after an
   * undervoltage in this substep) or without a run command the motor is not driven: the light rotor stops within the
   * substep (its coast-down time is far below one step) and its kinetic energy heats the water.
   */
  private planCirculators(s: Simulation, h: number, unpowered: Set<string>) {
    return Object.fromEntries(s.project.components.filter(c => c.kind === 'circulator').map((c): [string, CirculatorPlan] => {
      const state = this.circulators[c.id] ?? { omega: 0, lockedOut: false, restartIn: 0, angle: 0 }, command = this.circulatorCommands[c.id] ?? { run: false, command: null };
      const powered = !state.lockedOut && !unpowered.has(c.id) && !s.failed[c.id], running = powered && command.run;
      if (!running) return [c.id, { powered, running, omega0: state.omega, omega1: h > 0 ? 0 : state.omega, mid: h > 0 ? 0 : state.omega, target: 0 }];
      const target = circulatorTarget(c, this.hydraulic.readings[c.id]?.flow ?? 0, command.command), omega1 = h > 0 ? rampedSpeed(c, state.omega, target, h) : state.omega;
      return [c.id, { powered, running, omega0: state.omega, omega1, mid: (state.omega + omega1) / 2, target }];
    }));
  }
  /** Rotor mechanical power over the substep: pump shaft power plus the rate of change of the rotor's kinetic energy (W). */
  private circulatorMechanical(c: Component, plan: CirculatorPlan, shaftPower: number, h: number) {
    return shaftPower + (h > 0 ? (circulatorKinetic(c, plan.omega1) - circulatorKinetic(c, plan.omega0)) / h : 0);
  }
  /**
   * Speed-controlled DC drive (cascade, as in thyristor/PWM armature drives): a PI speed controller sets the
   * armature current reference, limited to ±1.5·I_rated; the inner current loop is taken as ideal (much faster
   * than the mechanics), so the converter applies V = R·I* + kₑ·ω and duty = V/V_supply ∈ [0, 1]. Speed-loop
   * bandwidth ω_c = 20 rad/s on the rotor's own inertia (Kp = J·ω_c/kₜ), integral corner ω_c/4.
   */
  private dcSpeedGains(c: Component) {
    const bandwidth = 20;
    // The whole shaft's inertia (flywheel, dynamometer rotor) sets the loop gain for the same bandwidth.
    const inertia = this.lastProject ? shaftInertia(c, shaftTrain(this.lastProject, c.id)) : prop(c, 'inertia');
    return { kp: inertia * bandwidth / prop(c, 'torqueConstant'), corner: bandwidth / 4, limit: 1.5 * prop(c, 'ratedCurrent') };
  }
  private dcCurrentReference(c: Component, command: number, omega: number) {
    const g = this.dcSpeedGains(c);
    return Math.max(-g.limit, Math.min(g.limit, g.kp * (command - omega) + (this.motors[c.id]?.speedIntegral ?? 0)));
  }
  private dcDuty(c: Component, command: number | null, omega: number) {
    if (command === null) return 1;
    const supply = Math.abs(this.lastElectrical?.readings[c.id]?.voltage ?? 0) > 1e-9 ? Math.abs(this.lastElectrical!.readings[c.id].voltage) : prop(c, 'ratedVoltage');
    const voltage = prop(c, 'resistance') * this.dcCurrentReference(c, command, omega) + prop(c, 'emfConstant') * omega;
    return Math.max(0.001, Math.min(1, voltage / supply));
  }
  /**
   * PI integral after an accepted step, from the step's midpoint speed and armature current (backward Euler on
   * the integral mode). Conditional integration against windup: the integral is held while the converter does
   * not deliver the reference in the error's direction — current limit, full or minimum duty, or a supply that
   * cannot source the current (e.g. a CV/CC supply in current limit).
   */
  private advanceSpeedIntegral(c: Component, command: number | null, enabled: boolean, omega: number, current: number, h: number) {
    const state = this.motors[c.id];
    if (!state || c.kind !== 'motor') return;
    if (command === null || !enabled) { this.motors[c.id] = { ...state, speedIntegral: 0 }; return; }
    const g = this.dcSpeedGains(c), error = command - omega, integral = state.speedIntegral ?? 0;
    const reference = this.dcCurrentReference(c, command, omega), unclamped = g.kp * error + integral, tolerance = 0.01 * g.limit;
    const short = unclamped > g.limit || current < reference - tolerance, excess = unclamped < -g.limit || current > reference + tolerance;
    if ((error > 0 && short) || (error < 0 && excess)) return;
    this.motors[c.id] = { ...state, speedIntegral: Math.max(-g.limit, Math.min(g.limit, integral + g.corner * h * g.kp * error / (1 + g.corner * h))) };
  }
  /** Start/run commands (wired inputs override the property) and drive frequency setpoints. */
  private converterCommands(s: Simulation) {
    const has = (c: Component, port: string) => s.project.connections.some(w => w.domain === 'control' && w.to.component === c.id && w.to.port === port);
    const run = (c: Component, port: string) => {
      if (s.failed[c.id]) return false;
      const input = s.automation.input(c, port, s);
      return has(c, port) ? input.valid && input.value === true : Boolean(c.props.enabled);
    };
    return Object.fromEntries(s.project.components.filter(c => isStarter(c) || c.kind === 'vfd').map(c => {
      if (c.kind !== 'vfd') return [c.id, { run: run(c, 'start'), setpoint: 0 }];
      const input = s.automation.input(c, 'frequency', s);
      const setpoint = has(c, 'frequency') ? (input.valid && typeof input.value === 'number' ? input.value : 0) : prop(c, 'frequencySetpoint');
      return [c.id, { run: run(c, 'run'), setpoint: Math.max(0, Math.min(prop(c, 'maxFrequency'), setpoint)) }];
    }));
  }
  /** Command edges at the start of a substep (start, stop, coast; a drive needs an energised input). */
  private applyCommands(s: Simulation, commands: ReturnType<Multiphysics['converterCommands']>) {
    for (const c of s.project.components) {
      const command = commands[c.id];
      if (!command) continue;
      if (isStarter(c)) this.starters[c.id] = starterCommand(c, this.starters[c.id] ?? newStarter(), command.run);
      else this.drives[c.id] = driveCommand(c, this.drives[c.id] ?? newDrive(), command.run, command.setpoint, this.lastElectrical?.readings[c.id]?.drive?.energized === true && !s.failed[c.id]);
    }
  }
  /** Timers, ramps, drive frequency and protection after an accepted substep. */
  private advanceConverters(s: Simulation, h: number, electrical: ElectricalResult, commands: ReturnType<Multiphysics['converterCommands']>) {
    for (const c of s.project.components) {
      const command = commands[c.id];
      if (!command || s.failed[c.id]) continue;
      const result = isStarter(c)
        ? advanceStarter(c, this.starters[c.id] ?? newStarter(), h, electrical.readings[c.id])
        : advanceDrive(c, this.drives[c.id] ?? newDrive(), h, electrical.readings[c.id], command.run, command.setpoint, this.driveLimiter(s, c, electrical));
      if (isStarter(c)) this.starters[c.id] = result.state as StarterState; else this.drives[c.id] = result.state as DriveState;
      if (result.trip) { s.tripped[c.id] = result.trip; s.fail(c.id, result.trip); }
    }
  }
  /** Steady-state output current of the motors on a drive's output network at their present speeds. */
  private driveLimiter(s: Simulation, c: Component, electrical: ElectricalResult): DriveLimiter | undefined {
    const fed = s.project.components.filter(m => m.kind === 'inductionMotor' && electrical.readings[m.id]?.supply === c.id);
    if (!fed.length) return undefined;
    const pairs = prop(fed[0], 'poles', 4) / 2;
    return {
      rotorFrequency: Math.max(0, pairs * (this.motors[fed[0].id]?.omega ?? 0) / (2 * Math.PI)),
      currentAt: (f: number) => {
        const v = driveLineVoltage(c, f) / Math.sqrt(3);
        const total = fed.reduce<[number, number]>((sum, m) => {
          const z = inductionCircuit(m, f, this.motors[m.id]?.omega ?? 0).impedance, d = z[0] ** 2 + z[1] ** 2;
          return [sum[0] + v * z[0] / d, sum[1] - v * z[1] / d];
        }, [0, 0]);
        return Math.hypot(total[0], total[1]);
      },
    };
  }
  /** Substep limit so starter timers (star time, transition, ramp end) fall on substep boundaries. */
  private converterEventLimit(s: Simulation) {
    let limit = Infinity;
    for (const c of s.project.components.filter(isStarter)) {
      const t = starterEvent(c, this.starters[c.id] ?? newStarter());
      if (t > 1e-12) limit = Math.min(limit, t);
    }
    return limit;
  }
  private converterRuntime(s: Simulation) {
    return {
      starters: Object.fromEntries(s.project.components.filter(isStarter).map(c => [c.id, { mode: this.starters[c.id]?.mode ?? 'off', ratio: this.starters[c.id]?.ratio }])),
      drives: Object.fromEntries(s.project.components.filter(c => c.kind === 'vfd').map(c => {
        const d = this.drives[c.id] ?? newDrive();
        return [c.id, { running: d.running, frequency: d.frequency, voltage: driveLineVoltage(c, d.frequency) / Math.sqrt(3) }];
      })),
    };
  }
  /** Contactors, protection, starter modes and drive run states: a change is a switching event. */
  private discreteKey(s: Simulation, controls: ReturnType<Multiphysics['controls']>) {
    return JSON.stringify([Object.values(controls).map(c => c.enabled), Object.values(this.starters).map(st => st.mode), Object.values(this.drives).map(d => d.running), [...s.openDevices()], s.failed, s.automation.contacts, s.devices.contactors]);
  }
  /**
   * `loads`: signed external shaft load per motor (N·m, positive opposes positive rotation). The
   * "External shaft load" property is a magnitude that always resists motion (advance() chooses the
   * sign from the direction of rotation, or holds the rotor at rest); default: +magnitude.
   */
  solve(s: Simulation, omega: number[], controls: ReturnType<Multiphysics['controls']>, tanks: Record<string, TankState> = this.tanks, loads?: number[], h = 0) {
    const motors = s.project.components.filter(isMotor), circulators = s.project.components.filter(c => c.kind === 'circulator');
    const speeds: Record<string, number> = {};
    const pairs: Record<string, string> = {};
    for (const w of s.project.connections.filter(w => w.domain === 'mechanical' && !s.disconnected.has(w.id))) {
      const motor = motors.find(c => c.id === w.from.component || c.id === w.to.component);
      if (motor) { const pump = motor.id === w.from.component ? w.to.component : w.from.component; if (s.project.components.find(c => c.id === pump)?.kind === 'pump') { pairs[motor.id] = pump; speeds[pump] = omega[motors.indexOf(motor)]; } }
    }
    // The hydraulic network depends on the shaft and circulator speeds only, so it is solved first; circulators then
    // draw their input power for the solved operating point. A circulator whose supply cannot carry that demand above
    // its undervoltage lockout is re-planned unpowered and the substep solved again.
    const unpowered = new Set<string>(), boilerOff = new Set<string>();
    let plan: Record<string, CirculatorPlan>, hydraulic: ReturnType<typeof solveHydraulic>, electrical: ElectricalResult;
    for (;;) {
      plan = this.planCirculators(s, h, unpowered);
      for (const c of circulators) speeds[c.id] = plan[c.id].mid;
      hydraulic = solveHydraulic(s.project, tanks, speeds, this.positions, s.faults, s.disconnected, this.hydraulic, this.pipeCells);
      const demand = Object.fromEntries(circulators.filter(c => plan[c.id].powered).map(c => [c.id, plan[c.id].running ? circulatorInput(c, this.circulatorMechanical(c, plan[c.id], hydraulic.readings[c.id]?.shaftPower ?? 0, h)) : prop(c, 'standbyPower')]));
      electrical = solveElectrical(s.project, s.failed, {
        ...s.devices.runtime(h),
        contacts: s.automation.contacts, faults: s.faults, disconnected: s.disconnected, temperatures: s.temperatures, filaments: s.filamentRatios(), open: s.openDevices(),
        motors: Object.fromEntries(motors.flatMap((c, i) => c.kind === 'motor' ? [[c.id, { enabled: controls[c.id].enabled, duty: this.dcDuty(c, controls[c.id].command, omega[i]), emf: prop(c, 'emfConstant') * omega[i] }]] : [])),
        inductionMotors: Object.fromEntries(motors.flatMap((c, i) => c.kind === 'inductionMotor' ? [[c.id, { omega: omega[i], enabled: controls[c.id].enabled, psiS: this.motors[c.id]?.psiS ?? [0, 0], psiR: this.motors[c.id]?.psiR ?? noRotorFlux(machineParams(c, prop(c, 'ratedFrequency', 50))), h }]] : [])),
        ...this.converterRuntime(s),
        circulators: demand,
        boilers: Object.fromEntries(Object.entries(this.boilers).map(([id, b]) => [id, boilerOff.has(id) ? 0 : b.stages])),
        boilerTrips: new Set(Object.entries(this.boilers).filter(([, b]) => b.fault).map(([id]) => id)),
      });
      const dropped = circulators.filter(c => plan[c.id].powered && electrical.readings[c.id]?.undervoltage);
      const droppedBoilers = s.project.components.filter(c => c.kind === 'electricBoiler' && this.boilers[c.id].stages > 0 && !boilerOff.has(c.id) && electrical.readings[c.id]?.stageVoltages?.some(v => v < prop(c, 'minVoltage')));
      droppedBoilers.forEach(c => boilerOff.add(c.id));
      if (!dropped.length && !droppedBoilers.length) break;
      for (const c of dropped) unpowered.add(c.id);
    }
    // The final solve has these units switched off; keep the cause on their readings for the lockout.
    for (const id of [...unpowered, ...boilerOff]) if (electrical.readings[id]) electrical.readings[id].undervoltage = true;
    // Wet rotor: motor and electronics losses are what the electrical input leaves after the rotor's mechanical
    // power, P1 − P_shaft − dE_kin/dt ≥ 0; they heat the pumped water (enthalpy transport) or, without flow, ambient.
    for (const c of circulators) {
      const reading = hydraulic.readings[c.id];
      if (!reading) continue;
      const input = Math.max(0, electrical.readings[c.id]?.power ?? 0);
      reading.motorLoss = input - this.circulatorMechanical(c, plan[c.id], reading.shaftPower, h);
    }
    const state = motors.map((c, i) => {
      const ctrl = { ...controls[c.id], duty: this.dcDuty(c, controls[c.id].command, omega[i]) }, r = electrical.readings[c.id];
      const running = ctrl.enabled && !s.failed[c.id];
      const machine = c.kind === 'inductionMotor' && running ? r?.machine : undefined;
      // DC: armature current from back EMF. Induction: line current and air-gap torque from the equivalent circuit.
      const current = c.kind === 'inductionMotor' ? (machine ? r.current : 0) : running ? (ctrl.duty * r.voltage - prop(c, 'emfConstant') * omega[i]) / prop(c, 'resistance') : 0;
      const pump = pairs[c.id] ? hydraulic.readings[pairs[c.id]] : undefined, train = shaftTrain(s.project, c.id, s.disconnected), dyno = train.dynamometer;
      // Speed-dependent absorbers act at the midpoint speed (implicit, stable for a stiff brake); an electric
      // dynamometer's constant torque is an opposing load with hold-at-rest (opposingLoads).
      const dynamometer = dyno && !holdsAtStandstill(dyno) ? Math.sign(omega[i]) * dynamometerTorque(dyno, omega[i], this.dynamometerSet(s, dyno)) : 0;
      const load = (pump?.torque ?? 0) + (loads?.[i] ?? prop(c, 'loadTorque')) + dynamometer;
      const torque = c.kind === 'inductionMotor' ? machine?.torque ?? 0 : prop(c, 'torqueConstant') * current;
      const linkedBody = shaftBody(s.project, c.id), coupled = linkedBody ? undefined : trainAcceleration(prop(c, 'inertia'), train, torque - load - prop(c, 'friction') * omega[i], omega[i]);
      // DC armature: the current's within-step variance (storage transients) adds to the copper loss; the supply-side
      // current is duty × the armature current.
      const copperPower = c.kind === 'inductionMotor' ? (machine ? machine.statorCopper + machine.rotorCopper + machine.coreLoss : 0) : (current * current + (running && ctrl.duty > 0 ? (r?.currentVariance ?? 0) / ctrl.duty ** 2 : 0)) * prop(c, 'resistance');
      return { omega: omega[i], current, torque, load, shaftPower: linkedBody ? (torque - prop(c, 'friction') * omega[i]) * omega[i] : (load + coupled!.gear * coupled!.transmitted) * omega[i], copperPower, duty: ctrl.duty, acceleration: linkedBody ? this.motors[c.id]?.acceleration ?? 0 : coupled!.acceleration, angle: this.motors[c.id]?.angle ?? 0,
        dynamometerTorque: dynamometer, transmitted: coupled?.transmitted ?? 0, gear: coupled?.gear ?? 1,
        ...(c.kind === 'inductionMotor' ? { psiS: this.motors[c.id]?.psiS, psiR: this.motors[c.id]?.psiR, frequency: this.motors[c.id]?.frequency, inrushPeak: this.motors[c.id]?.inrushPeak, energized: this.motors[c.id]?.energized, fluxRate: this.motors[c.id]?.fluxRate } : {}) };
    });
    return { electrical, hydraulic, state, speeds, circulators: plan };
  }
  /**
   * Tank inventories predicted at mid-step from the last flows (second-order head/storage coupling). A tank
   * that the step would drain by more than half keeps its start-of-step inventory: the emptying instant is
   * then resolved by the boundary split (boundaryTime), which needs the flow of the still-wet tank.
   */
  private midpointTanks(s: Simulation, h: number): Record<string, TankState> {
    void s;
    return Object.fromEntries(Object.entries(this.tanks).map(([id, t]) => {
      // Tanks may surcharge above their rim (weir overflow), so only emptiness bounds the estimate.
      const mass = t.mass + 0.5 * h * (this.hydraulic.readings[id]?.flow ?? 0) * RHO;
      if (mass < 0.5 * t.mass) return [id, t];
      return [id, { ...t, mass, volume: inventoryVolume(mass, t.temperature) }];
    }));
  }
  private updateNpsh(s: Simulation, hydraulic: ReturnType<typeof emptyHydraulics>) {
    for (const c of s.project.components.filter(c => isPump(c) && prop(c, 'npshRequired') > 0)) {
      const reading = hydraulic.readings[c.id];
      if (!reading?.temperatureValid) continue;
      const available = (101325 + reading.inletPressure - vaporPressure(U.kToCelsius(reading.temperature))) / (RHO * G);
      const required = npsh3At(c, reading.flow);
      reading.npshAvailable = available;
      // Head reduction itself is applied in the hydraulic solve (cavitationFactor); report it here.
      if (reading.flow > 1e-9 && available < required) hydraulic.diagnostics.push(`${c.name}: cavitating — NPSH available ${available.toFixed(2)} m < NPSH3 ${required.toFixed(2)} m; head reduced by ${((1 - (reading.cavitation ?? 1)) * 100).toFixed(1)} %.`);
    }
  }
  /**
   * Shaft-train accounting over an accepted substep. Dynamometer: absorbed torque (its share of the opposing
   * load for an electric absorber, else its speed-dependent torque) × midpoint speed leaves as exported work.
   * Flywheel: bearing drag and the gear mesh loss (k − 1)·T_t·ω go to ambient; its kinetic energy is in the
   * shaft's kinetic energy. Returns the heat released to ambient (J).
   */
  private advanceTrain(s: Simulation, c: Component, m: MotorState, opposing: number, electricShare: number, start: number, omega: number, next: number, h: number) {
    const train = shaftTrain(s.project, c.id, s.disconnected), dyno = train.dynamometer, flywheel = train.flywheel;
    let heat = 0;
    if (dyno) {
      const speedTorque = m.dynamometerTorque ?? 0, torque = opposing * electricShare + speedTorque;
      this.externalShaftWork += speedTorque * omega * h;
      const previous = this.shaftElements[dyno.id]?.energy ?? 0;
      this.shaftElements[dyno.id] = { omega: next, torque: Math.abs(torque), power: torque * omega, energy: previous + torque * omega * h };
      if (Math.abs(next) > prop(dyno, 'maxSpeed')) s.violation(`${dyno.name}: maximum speed exceeded.`);
      if (torque * omega > prop(dyno, 'ratedPower') * 1.001) s.violation(`${dyno.name}: absorbed power above its rating.`);
    }
    if (flywheel) {
      const f = reflectedFlywheel(flywheel), acceleration = (next - start) / h;
      const transmitted = f.inertia * acceleration + f.drag * omega, loss = f.drag * omega * omega + ((m.gear ?? 1) - 1) * transmitted * omega;
      this.drivetrainLoss += loss * h;
      heat += loss * h;
      const previous = this.shaftElements[flywheel.id]?.energy ?? 0, speed = next / f.ratio;
      // The flywheel shaft carries i·T_t; the gear loss stays on the motor side of the mesh.
      this.shaftElements[flywheel.id] = { omega: speed, torque: Math.abs(transmitted * f.ratio), power: transmitted * omega, energy: previous + transmitted * omega * h, kinetic: 0.5 * prop(flywheel, 'inertia') * speed * speed };
      if (Math.abs(speed) > prop(flywheel, 'maxSpeed')) s.violation(`${flywheel.name}: maximum safe speed exceeded.`);
    }
    return heat;
  }
  /**
   * Opposing load: magnitude T_L resists the current direction of rotation and supplies no energy.
   * At rest it acts as static friction: it balances any net drive up to T_L (rotor held), and beyond
   * that resists the breakaway direction. Externally driven reverse rotation stays possible.
   */
  private opposingLoads(s: Simulation, old: number[], controls: ReturnType<Multiphysics['controls']>, linked: (string | undefined)[], h = 0) {
    const motors = s.project.components.filter(isMotor);
    // Opposing magnitude: the external load plus an electric dynamometer's set torque (both hold a stalled shaft).
    const electric = motors.map((c, i) => { const d = shaftTrain(s.project, c.id, s.disconnected).dynamometer; return d && holdsAtStandstill(d) ? dynamometerTorque(d, old[i], this.dynamometerSet(s, d)) : 0; });
    const magnitude = motors.map((c, i) => Math.max(0, prop(c, 'loadTorque')) + electric[i]);
    const loads = motors.map((c, i) => Math.abs(old[i]) > OMEGA_REST ? Math.sign(old[i]) * magnitude[i] : 0);
    const held = motors.map(() => false);
    if (motors.some((c, i) => Math.abs(old[i]) <= OMEGA_REST)) {
      const atRest = this.solve(s, old, controls, this.tanks, loads, h);
      motors.forEach((c, i) => {
        if (Math.abs(old[i]) > OMEGA_REST) return;
        const drive = atRest.state[i].torque - atRest.state[i].load; // load here is the pump torque only
        if (Math.abs(drive) <= magnitude[i]) { loads[i] = drive; held[i] = !linked[i]; }
        else loads[i] = Math.sign(drive) * magnitude[i];
      });
    }
    return { loads, held, electric, magnitude };
  }
  /**
   * Advance an induction machine's flux linkages over an accepted step (midpoint values from the
   * electrical solve). Energised: ψ₁ = 2ψ_mid − ψ₀. Open stator (contactor open, supply lost): the
   * rotor flux decays; interrupting a winding current dumps the stator-side field energy at once
   * (contact arc, booked as heat in the motor). Returns the extra heat (J) of the open-stator path.
   */
  private advanceFlux(c: Component, reading: ElectricalReading | undefined, omega: number, h: number, window: [number, number]) {
    const frequency = reading?.frequency ?? this.motors[c.id].frequency ?? prop(c, 'ratedFrequency', 50), m = machineParams(c, frequency);
    const state = this.motors[c.id], psiS0 = state.psiS ?? [0, 0], psiR0 = state.psiR ?? noRotorFlux(m);
    const mid = reading?.machine?.psiS && reading.machine.psiR ? { s: reading.machine.psiS, r: reading.machine.psiR } : undefined;
    let heat = 0, psiS: Cx, psiR: Cx[], peak = state.inrushPeak ?? 0;
    if (mid) {
      psiS = [2 * mid.s[0] - psiS0[0], 2 * mid.s[1] - psiS0[1]];
      psiR = mid.r.map((r, k) => [2 * r[0] - psiR0[k][0], 2 * r[1] - psiR0[k][1]]);
      // Largest instantaneous line current (winding plus iron-loss current) over the substep.
      peak = Math.max(state.energized ? peak : 0, peakOverInterval(reading!.currentPhasor ?? [0, 0], 3, window[0], window[1]));
    } else {
      const interrupted = magneticEnergy(m, psiS0, psiR0) - magneticEnergy(m, openStatorFlux(m, psiR0), psiR0);
      const step = openStatorStep(m, psiR0, h, omega);
      psiR = step.psiR; psiS = openStatorFlux(m, psiR);
      heat = Math.max(0, interrupted) + step.rotorCopper * h;
      this.copperEnergy += step.rotorCopper * h;
      this.switchingLoss += Math.max(0, interrupted);
    }
    const reference = 0.01 * prop(c, 'ratedVoltage') / Math.sqrt(3) / m.ws;
    const fluxRate = Math.hypot(psiS[0] - psiS0[0], psiS[1] - psiS0[1]) / (h * Math.max(cabs(psiS), reference));
    this.motors[c.id] = { ...this.motors[c.id], psiS, psiR, frequency, inrushPeak: peak, energized: !!mid, fluxRate };
    return heat;
  }
  /**
   * Coupled substep limit while an induction machine's electromagnetic state is changing (switch-on,
   * run-up, interruption, reconnection): 1/40 of a supply period resolves the stator flux transient
   * (decaying DC offset, rotating at the supply frequency in this frame). Steady operation: no limit.
   */
  electricalStepLimit(s: Simulation, controls = this.controls(s)) {
    let limit = Infinity;
    // A change of contactors, protection, starter mode or drive run state since the last accepted substep.
    const switching = this.discreteKey(s, controls) !== this.acceptedKey;
    for (const c of s.project.components) {
      if (c.kind !== 'inductionMotor') continue;
      const state = this.motors[c.id];
      if (!state) continue;
      const fluxing = (state.fluxRate ?? 0) > 1;
      // Drive-fed machines at low frequency: at most 1/40 of a 1 Hz period.
      if (switching || fluxing) limit = Math.min(limit, 1 / (40 * Math.max(1, state.frequency ?? prop(c, 'ratedFrequency', 50))));
    }
    return limit;
  }
  /**
   * Fixed-step substep bound without moving rigid bodies. Storage (as engine.adaptiveLimit): at most 1 % of a
   * tank's height (≥ 5 mm) per substep, and a surcharged weir's explicit level update well inside its time
   * constant A/(dQ/dh), dQ/dh = 1.5·Q/h. Induction machines: 1/240 s. Their decaying stator-flux offset rotates
   * at the supply frequency in the phasor frame, and the implicit midpoint rule damps that mode at only
   * σ/(1 + (ωh/2)²) of its true rate (σ/1.4 at 1/240 s, σ/7.8 at 1/60 s).
   */
  private fixedStepLimit(s: Simulation) {
    let limit = s.project.components.some(c => c.kind === 'inductionMotor') ? 1 / 240 : Infinity;
    for (const c of s.project.components) {
      if (c.kind !== 'tank') continue;
      const reading = this.hydraulic.readings[c.id], area = prop(c, 'surfaceArea'), q = Math.abs(reading?.flow ?? 0);
      if (q > 1e-12) limit = Math.min(limit, Math.max(0.005, 0.01 * prop(c, 'capacity') / 1000 / area) * area / q);
      if ((reading?.surcharge ?? 0) > 1e-9 && (reading?.overflow ?? 0) > 0) limit = Math.min(limit, 0.3 * area / (1.5 * reading!.overflow! / reading!.surcharge!));
    }
    return limit;
  }
  /** Magnetic energy stored in induction machines (J). */
  magneticEnergy(p?: Project) {
    return (p ?? this.lastProject)?.components.filter(c => c.kind === 'inductionMotor').reduce((sum, c) => {
      const state = this.motors[c.id];
      return state?.psiS && state.psiR ? sum + magneticEnergy(machineParams(c, state.frequency ?? 50), state.psiS, state.psiR) : sum;
    }, 0) ?? 0;
  }
  /** Readings of a circulator's operating state from a solve (the state itself advances only on accepted substeps). */
  private viewCirculators(s: Simulation, r: ReturnType<Multiphysics['solve']>) {
    for (const c of s.project.components.filter(c => c.kind === 'circulator')) {
      const plan = r.circulators[c.id];
      this.circulatorView[c.id] = { omega: plan.omega1, target: plan.target, powered: plan.powered, running: plan.running, lockedOut: this.circulators[c.id]?.lockedOut ?? false,
        inputPower: Math.max(0, r.electrical.readings[c.id]?.power ?? 0), motorLoss: r.hydraulic.readings[c.id]?.motorLoss ?? 0 };
    }
  }
  /**
   * Accepted substep: the rotor speed advances to the plan's end speed. An undervoltage switches the electronics off
   * (lockout); they restart after the restart delay once the supply is back above 105 % of the lockout voltage.
   */
  private advanceCirculator(s: Simulation, c: Component, r: ReturnType<Multiphysics['solve']>, h: number) {
    const plan = r.circulators[c.id], reading = r.electrical.readings[c.id], state = this.circulators[c.id] ?? { omega: 0, lockedOut: false, restartIn: 0, angle: 0 };
    const lockout = prop(c, 'minVoltage');
    let { lockedOut, restartIn } = state;
    if (!lockedOut && reading?.undervoltage) {
      lockedOut = true; restartIn = CIRCULATOR_RESTART_DELAY;
      s.log(`${c.name}: supply voltage below its ${lockout} V undervoltage lockout — the electronics switched off and the pump stopped.`, 'warning');
    } else if (lockedOut) {
      restartIn = Math.max(0, restartIn - h);
      if (restartIn <= 1e-12 && reading?.voltageValid !== false && Math.abs(reading?.voltage ?? 0) >= RESTART_MARGIN * lockout) {
        lockedOut = false;
        s.log(`${c.name}: supply recovered — the electronics restart.`, 'info');
      }
    }
    this.circulators[c.id] = { omega: plan.omega1, lockedOut, restartIn, angle: state.angle + plan.mid * h };
  }
  refresh(s: Simulation) {
    this.lastProject = s.project;
    this.circulatorCommands = this.circulatorControls(s);
    const ms = s.project.components.filter(isMotor);
    const speeds = () => ms.map(c => { const body = shaftBody(s.project, c.id); return body ? s.spatial.readings[body]?.omega ?? 0 : this.motors[c.id]?.omega ?? 0; });
    const controls = this.controls(s), { loads, held } = this.opposingLoads(s, speeds(), controls, ms.map(c => shaftBody(s.project, c.id)));
    let r = this.solve(s, speeds(), controls, this.tanks, loads);
    this.hydraulic = r.hydraulic;
    if (!Object.keys(r.hydraulic.nodeTemperatures).length && Object.keys(r.hydraulic.potentials).length) {
      // First solve: no transported temperatures yet. A zero-length transport mixes the current
      // inventories into node temperatures, then the network is re-solved with their viscosities.
      transport(s.project, this.tanks, r.hydraulic, 0, this.pipeCells, Object.fromEntries(s.project.components.filter(c => c.kind === "radiator").map(c => [c.id, radiatorUA(c, r.electrical)])), this.boilers, Object.fromEntries(s.project.components.filter(c => c.kind === 'electricBoiler').map(c => [c.id, r.electrical.readings[c.id]?.heatingPower ?? 0])));
      r = this.solve(s, speeds(), controls, this.tanks, loads);
      this.hydraulic = r.hydraulic;
    }
    // Re-solving hydraulics rebuilds readings. Resolve current fluid temperatures without
    // moving mass/heat so paused edits and fault recovery cannot erase valid measurements.
    transport(s.project, this.tanks, this.hydraulic, 0, this.pipeCells, Object.fromEntries(s.project.components.filter(c => c.kind === "radiator").map(c => [c.id, radiatorUA(c, r.electrical)])), this.boilers, Object.fromEntries(s.project.components.filter(c => c.kind === 'electricBoiler').map(c => [c.id, r.electrical.readings[c.id]?.heatingPower ?? 0])));
    this.updateNpsh(s, this.hydraulic);
    this.viewCirculators(s, r);
    for (const [id, b] of Object.entries(this.boilers)) if (b.fault) s.automation.status[id] = 'tripped';
    this.lastElectrical = r.electrical;
    ms.forEach((c, i) => {
      const m = r.state[i];
      if (shaftBody(s.project, c.id)) {
        // Shaft output excludes acceleration of the motor's own rotor inertia.
        const load = m.torque - prop(c, 'friction') * m.omega - prop(c, 'inertia') * m.acceleration;
        this.motors[c.id] = { ...m, load, shaftPower: load * m.omega, speedIntegral: this.motors[c.id]?.speedIntegral };
      } else this.motors[c.id] = { ...m, ...(held[i] ? { acceleration: 0 } : {}), speedIntegral: this.motors[c.id]?.speedIntegral };
    });
    return r.electrical;
  }
  advance(s: Simulation, dt: number): { electrical: ElectricalResult; heatPower: Record<string, number>; ambient: number; thermalGain: number; boilerElementGain: number } {
    s.spatial.stepMs = 0;
    this.lastProject = s.project;
    const motors = s.project.components.filter(isMotor), controls = this.controls(s), heatEnergy: Record<string, number> = {}, commands = this.converterCommands(s);
    this.circulatorCommands = this.circulatorControls(s);
    const elementBefore = Object.fromEntries(Object.entries(this.boilers).map(([id, b]) => [id, b.elementTemperature]));
    let remaining = dt, ambient = 0, thermalGain = 0, totalElectrical: ElectricalResult | undefined, intervals = 0;
    const adaptive = !s.spatial.hasMovingBodies && dt > 0.1 + 1e-12;
    const spilledThisStep: Record<string, number> = {};
    // Step readings: currents as RMS over the substeps, powers as averages (not the first substep's sample).
    const sums: Record<string, { current: number; contact: number; nc: number; reactive: number; apparent: number; sign: number; stages?: { current: number[]; voltage: number[] }; secondary?: { current: number; voltage: number }; coil?: { current: number; voltage: number; power: number; currentSign: number; voltageSign: number }; drive: { input: number; output: number; losses: number; braking: number; current: number } }> = {};
    // Midpoint shaft/electrical/hydraulic solve; 1/240 s bounds head/storage splitting error.
    while (remaining > 1e-12) {
      if (++intervals > 1024) throw Error('Too many coupled boundary events or mechanical substeps within one timestep.');
      // Adaptive macro steps (no rigid bodies) are already bounded by engine.adaptiveLimit; rigid bodies keep
      // their contact/gravity substep; other fixed steps are bounded by the storage time scales.
      for (const c of s.project.components.filter(c => c.kind === 'electricBoiler')) controlBoiler(s, c, this.boilers[c.id], s.time + dt - remaining);
      this.applyCommands(s, commands);
      let h = Math.min(remaining, s.spatial.hasMovingBodies ? s.spatial.maxStep(s.project) : adaptive ? remaining : this.fixedStepLimit(s), this.electricalStepLimit(s, controls), this.converterEventLimit(s), s.devices.eventLimit(s.project));
      if (Object.keys(this.boilers).length) {
        h = Math.min(h, 0.1);
        for (const c of s.project.components.filter(c => c.kind === 'electricBoiler')) {
          const b = this.boilers[c.id], now = s.time + dt - remaining;
          for (const event of [b.switchedAt + prop(c, 'stageDelay'), b.offAt + prop(c, 'antiCycleTime'), b.restartAt]) if (event > now + 1e-9) h = Math.min(h, event - now);
        }
      }
      const old = motors.map(c => this.motors[c.id].omega);
      const linked = motors.map(c => shaftBody(s.project, c.id));
      const { loads, held, electric, magnitude } = this.opposingLoads(s, old, controls, linked, h);
      const discrete = motors.map((c, i) => `${controls[c.id].enabled ? 1 : 0}${Math.sign(loads[i])}${held[i] ? 'h' : ''}`).join('|') + JSON.stringify([Object.values(this.starters).map(st => st.mode), Object.values(this.drives).map(d => d.running)]);
      const snapshot = linked.some(Boolean) ? s.spatial.checkpoint() : undefined;
      let accepted: ReturnType<Multiphysics['solve']> | undefined;
      let acceptedTrial: ReturnType<typeof s.spatial.trial> | undefined;
      const torqueMap = (r: ReturnType<Multiphysics['solve']>, x: number[]) => Object.fromEntries(motors.flatMap((c, i) => linked[i] ? [[linked[i]!, r.state[i].torque - r.state[i].load - prop(c, 'friction') * x[i]]] : []));
      let midpoint = [...old];
      for (let event = 0; event < 32; event++) {
        // Predictor: start the midpoint speed from the last acceleration (exact for steady acceleration).
        midpoint = old.map((w, i) => w + 0.5 * h * (this.motors[motors[i].id]?.acceleration ?? 0));
        // The network is solved at predicted mid-step tank levels: second order in the head/storage
        // coupling (start-of-step levels were first order and needed 1/240 s substeps).
        const levels = this.midpointTanks(s, h);
        const residualAt = (x: number[]) => {
          const r = this.solve(s, x, controls, levels, loads, h);
          const trial = snapshot ? s.spatial.trial(s, h, torqueMap(r, x), snapshot) : undefined;
          return { r, trial, f: x.map((v, i) => linked[i] ? 2 * v - old[i] - trial!.bodies[linked[i]!].getAngularVelocity() : held[i] ? 2 * (v - old[i]) : 2 * (v - old[i]) - h * r.state[i].acceleration) };
        };
        let converged = !motors.length;
        // Chord Newton: the finite-difference Jacobian (one extra coupled solve per motor) is reused
        // across iterations and substeps while it still contracts the residual by 4×, and rebuilt
        // when the step size changes or convergence slows. Same 1e-8 convergence criterion.
        // The Jacobian is only reused while the discrete state (contactor, load direction, hold) is unchanged:
        // a stale Jacobian from a running motor contracts slowly after the contactor opens (measured: 8 coupled
        // solves per step instead of ~1.2).
        let jac = this.chord && this.chord.h === h && this.chord.n === motors.length && this.chord.key === discrete ? this.chord.jac : undefined, lastNorm = Infinity;
        let candidate: ReturnType<typeof residualAt> | undefined;
        for (let k = 0; k < 32 && motors.length; k++) {
          const { r, f, trial } = candidate ?? residualAt(midpoint); this.couplingIterations = k + 1;
          const norm = Math.max(...f.map(Math.abs));
          if (norm < 1e-8) { accepted = r; acceptedTrial = trial; converged = true; break; }
          let fresh = false;
          if (!jac || norm > 0.25 * lastNorm) {
            fresh = true;
            jac = motors.map(() => motors.map(() => 0));
            for (let j = 0; j < motors.length; j++) {
              const probe = [...midpoint], eps = Math.max(1e-5, Math.abs(midpoint[j]) * 1e-5); probe[j] += eps;
              const g = residualAt(probe).f;
              for (let i = 0; i < motors.length; i++) jac[i][j] = (g[i] - f[i]) / eps;
            }
            this.chord = { h, n: motors.length, key: discrete, jac };
          }
          lastNorm = norm;
          const d = solveLinear(jac, f.map(v => -v));
          const base = midpoint;
          // Current limiting and pump check valves make the residual piecewise smooth.
          // A full Newton step can jump across a CV/CC boundary and cycle between
          // active sets. Backtrack until the actual coupled residual decreases.
          // Retain the trial for the next iteration: ordinary full steps cost no
          // additional electrical/hydraulic or spatial solve.
          let scale = 1, decreased = false;
          for (let backtrack = 0; backtrack < 16; backtrack++) {
            midpoint = base.map((v, i) => v + scale * d[i]);
            candidate = residualAt(midpoint);
            const nextNorm = Math.max(...candidate.f.map(Math.abs));
            if (nextNorm < norm || nextNorm < 1e-8) { decreased = true; break; }
            scale *= 0.5;
          }
          if (!decreased) {
            // A fresh local Jacobian that cannot reduce the residual would only repeat the same step.
            if (fresh) break;
            // A reused chord can point away from the root after regulation changes.
            // Retry from the accepted iterate with a fresh local Jacobian.
            midpoint = base; candidate = undefined; jac = undefined;
          }
        }
        if (!converged) throw Error('Electromechanical midpoint coupling failed to converge.');
        accepted = accepted ?? this.solve(s, midpoint, controls, levels, loads, h);
        const safe = Math.min(boundaryTime(s.project, this.tanks, accepted.hydraulic, h), s.devices.boundaryTime(s.project, accepted.electrical, h));
        if (safe < h * (1 - 1e-9)) { h = Math.max(1e-10, safe); accepted = undefined; acceptedTrial = undefined; continue; }
        // A loaded rotor that would pass through zero speed stops within this step: split the step at
        // the stopping instant (linear in ω) so the load never drives it backwards.
        const stop = Math.min(1, ...motors.map((c, i) => {
          if (linked[i] || held[i] || loads[i] === 0 || Math.abs(old[i]) <= OMEGA_REST) return 1;
          const next = 2 * midpoint[i] - old[i];
          return Math.sign(next) === -Math.sign(old[i]) && Math.abs(next) > 1e-9 * Math.max(1, Math.abs(old[i])) ? old[i] / (old[i] - next) : 1;
        }));
        // A stopping instant within 1 µs is treated as arrival at rest (the end speed is clamped to zero
        // below); oscillating transient torque near standstill would otherwise split the step indefinitely.
        if (stop < 1 - 1e-9 && h * stop >= 1e-6) { h = Math.max(1e-10, h * stop); accepted = undefined; acceptedTrial = undefined; continue; }
        break;
      }
      if (!accepted) throw Error('Tank boundary event failed to converge.');
      const r = accepted;
      // Supply angle over the substep: mains θ = ωt; a drive-fed network uses the drive's output angle.
      const start = s.time + (dt - remaining);
      const angleWindow = (v?: ElectricalReading): [number, number] => {
        const w = 2 * Math.PI * (v?.frequency ?? 50), drive = v?.supply ? this.drives[v.supply] : undefined;
        return drive ? [drive.angle, drive.angle + w * h] : [w * start, w * (start + h)];
      };
      if (s.spatial.hasMovingBodies) {
        const torques = torqueMap(r, midpoint);
        s.spatial.accept(acceptedTrial ?? s.spatial.trial(s, h, torques), s, torques);
      }
      this.hydraulic = r.hydraulic;
      motors.forEach((c, i) => {
        const m = r.state[i];
        let next = linked[i] ? s.spatial.readings[linked[i]!].omega : held[i] ? 0 : 2 * midpoint[i] - old[i];
        // Arrival at rest after a split stopping step: remove the round-off remainder.
        if (!linked[i] && loads[i] !== 0 && Math.abs(old[i]) > OMEGA_REST && (Math.sign(next) === -Math.sign(old[i]) || Math.abs(next) <= 1e-9 * Math.max(1, Math.abs(old[i])))) {
          // The load catches the rotor: the overshoot's kinetic energy (whole shaft train) goes to the load (exported work).
          this.externalShaftWork += 0.5 * shaftInertia(c, shaftTrain(s.project, c.id, s.disconnected)) * next * next;
          next = 0;
        }
        const acceleration = (next - old[i]) / h;
        const load = linked[i] ? m.torque - prop(c, 'friction') * midpoint[i] - prop(c, 'inertia') * acceleration : m.load;
        const previous = this.motors[c.id];
        this.motors[c.id] = { ...m, omega: next, load, shaftPower: load * midpoint[i], acceleration, angle: (previous?.angle ?? 0) + midpoint[i] * h, speedIntegral: previous?.speedIntegral,
          ...(c.kind === 'inductionMotor' ? { psiS: previous?.psiS, psiR: previous?.psiR, frequency: previous?.frequency, inrushPeak: previous?.inrushPeak, energized: previous?.energized, fluxRate: previous?.fluxRate } : {}) };
        this.advanceSpeedIntegral(c, controls[c.id].command, controls[c.id].enabled && !s.failed[c.id], midpoint[i], m.current, h);
        this.copperEnergy += m.copperPower * h;
        const friction = prop(c, 'friction') * midpoint[i] ** 2;
        this.frictionEnergy += friction * h;
        // Rectifier harmonic currents in the windings (drives on the same supply) heat the motor too.
        heatEnergy[c.id] = (heatEnergy[c.id] ?? 0) + (m.copperPower + friction + (r.electrical.readings[c.id]?.harmonicLoss ?? 0)) * h;
        if (c.kind === 'inductionMotor') heatEnergy[c.id] += this.advanceFlux(c, r.electrical.readings[c.id], midpoint[i], h, angleWindow(r.electrical.readings[c.id]));
        // Work exported by the opposing load: loads[i]·ω ≥ 0 while moving, zero while held at rest.
        this.externalShaftWork += loads[i] * midpoint[i] * h;
        ambient += this.advanceTrain(s, c, m, loads[i], magnitude[i] > 0 ? electric[i] / magnitude[i] : 0, old[i], midpoint[i], next, h);
        if (Math.abs(next) > prop(c, 'maxSpeed')) s.violation(`${c.name}: maximum supported rotor speed exceeded.`);
        if (Math.abs(m.torque) > prop(c, 'ratedTorque') * 1.001) s.automation.status[c.id] = 'overloaded';
      });
      for (const c of s.project.components.filter(c => c.kind === 'circulator')) this.advanceCirculator(s, c, r, h);
      this.viewCirculators(s, r);
      for (const [id, reading] of Object.entries(r.hydraulic.readings)) {
        this.pumpWork += reading.shaftPower * h;
        this.hydraulicWork += reading.hydraulicPower * h;
        this.transferred[id] = (this.transferred[id] ?? 0) + Math.abs(reading.flow) * h;
        // Without flow, shaft power (and a circulator's motor loss) leaves as heat to ambient.
        const dry = reading.shaftPower + (reading.motorLoss ?? 0);
        if (Math.abs(reading.flow) < 1e-14 && dry > 0) { this.dryLoss += dry * h; ambient += dry * h; }
      }
      this.dissipation += r.hydraulic.branches.reduce((sum, b) => sum + b.loss, 0) * h;
      const transported = transport(s.project, this.tanks, r.hydraulic, h, this.pipeCells, Object.fromEntries(s.project.components.filter(c => c.kind === "radiator").map(c => [c.id, radiatorUA(c, r.electrical)])), this.boilers, Object.fromEntries(s.project.components.filter(c => c.kind === 'electricBoiler').map(c => [c.id, r.electrical.readings[c.id]?.heatingPower ?? 0])));
      for (const c of s.project.components.filter(c => c.kind === 'electricBoiler')) {
        const b = this.boilers[c.id], reading = r.electrical.readings[c.id];
        ambient += (reading?.auxiliaryPower ?? 0) * h;
        if (reading?.undervoltage) { b.stages = 0; b.demand = false; b.status = 'Undervoltage / phase missing'; b.restartAt = s.time + dt - remaining + h + prop(c, 'restartDelay'); b.offAt = s.time + dt - remaining + h; }
        const low = Math.abs(r.hydraulic.readings[c.id]?.flow ?? 0) < prop(c, 'minFlow');
        b.lowFlowTime = b.demand && low ? b.lowFlowTime + h : 0;
        const temperature = this.pipeCells[c.id][0] - 273.15;
        if (temperature >= prop(c, 'tripTemperature') && !b.fault) {
          b.fault = 'overtemperature'; s.automation.status[c.id] = 'tripped'; b.stages = 0; b.status = 'Tripped: overtemperature'; b.offAt = s.time + dt - remaining + h;
          s.log(`${c.name}: overtemperature safety trip — manual reset required.`, 'error');
        }
      }
      s.electrical = r.electrical;
      this.updateNpsh(s, r.hydraulic);
      ambient += transported.ambient;
      thermalGain += transported.heat - transported.ambient;
      for (const [id, spill] of Object.entries(transported.spills)) {
        // Spilled water leaves the system boundary: mass, enthalpy and rim potential energy are exported.
        this.removedMass += spill.mass;
        this.removedEnergy += spill.enthalpy + spill.potential;
        thermalGain -= spill.enthalpy;
      }
      // Overflow volume counts routed and spilled water alike; only spilled water leaves the system.
      // Reported as actual water volume at the tank temperature (network flows are reference volumes).
      for (const [id, w] of Object.entries(r.hydraulic.weir)) if (w.flow > 0) {
        const t = this.tanks[id], actual = w.flow * h * RHO / kellDensity(Math.min(100, Math.max(0, U.kToCelsius(t?.temperature ?? 293.15))));
        this.overflowed[id] = (this.overflowed[id] ?? 0) + actual;
        spilledThisStep[id] = (spilledThisStep[id] ?? 0) + actual;
      }
      for (const c of s.project.components.filter(c => c.kind === 'pressureReducingValve')) {
        // Pilot-operated regulator: integral action on outlet gauge pressure, stroke-rate limited.
        if (['stuckClosed', 'stuckOpen'].includes(s.faults[c.id])) continue;
        const outlet = r.hydraulic.readings[c.id]?.pressure ?? 0;
        const demand = Math.max(-1, Math.min(1, (prop(c, 'pressureSetpoint') - outlet) / prop(c, 'proportionalBand')));
        this.positions[c.id] = Math.max(0, Math.min(100, this.positions[c.id] + demand * 100 * h / prop(c, 'responseTime')));
      }
      for (const c of s.project.components.filter(c => c.kind === 'actuatedValve')) {
        let target = prop(c, 'opening');
        const wired = s.project.connections.some(w => w.domain === 'control' && w.to.component === c.id);
        const input = s.automation.input(c, 'position', s);
        if (wired) target = input.valid && typeof input.value === 'number' ? input.value : (c.props.failOpen ? 100 : 0);
        if (s.faults[c.id] === 'stuckClosed') target = 0;
        if (s.faults[c.id] === 'stuckOpen') target = 100;
        const change = Math.max(-100 * h / prop(c, 'responseTime'), Math.min(100 * h / prop(c, 'responseTime'), Math.max(0, Math.min(100, target)) - this.positions[c.id]));
        if (!['stuckClosed', 'stuckOpen'].includes(s.faults[c.id])) this.positions[c.id] += change;
      }
      if (!totalElectrical) totalElectrical = { ...r.electrical, sourcePower: 0, dissipatedPower: 0, storedPower: 0, readings: Object.fromEntries(Object.entries(r.electrical.readings).map(([id, v]) => [id, { ...v, power: 0, ...(v.heatingPower !== undefined ? { heatingPower: 0, auxiliaryPower: 0 } : {}), ...(v.inputPower !== undefined ? { inputPower: 0 } : {}), ...(v.chemicalPower !== undefined ? { chemicalPower: 0 } : {}), ...(v.heatPower !== undefined ? { heatPower: 0 } : {}), ...(v.fanPower !== undefined ? { fanPower: 0 } : {}), ...(v.chargeCurrent !== undefined ? { chargeCurrent: 0 } : {}), ...(v.inductanceVoltage !== undefined ? { inductanceVoltage: 0 } : {}), ...(v.fieldPower !== undefined ? { fieldPower: 0 } : {}), peakCurrent: undefined }])) };
      totalElectrical.sourcePower += r.electrical.sourcePower * h / dt;
      totalElectrical.dissipatedPower += r.electrical.dissipatedPower * h / dt;
      totalElectrical.storedPower! += (r.electrical.storedPower ?? 0) * h / dt;
      for (const [id, v] of Object.entries(r.electrical.readings)) {
        const total = totalElectrical.readings[id];
        // A drive's braking resistor is external: its heat goes to ambient, not into the drive's heat sink.
        const braking = v.drive?.braking ?? 0;
        total.power += (v.power - braking) * h / dt;
        if (v.heatingPower !== undefined) { total.heatingPower = (total.heatingPower ?? 0) + v.heatingPower * h / dt; total.auxiliaryPower = (total.auxiliaryPower ?? 0) + (v.auxiliaryPower ?? 0) * h / dt; }
        if (v.inputPower !== undefined) total.inputPower = (total.inputPower ?? 0) + v.inputPower * h / dt;
        if (v.chemicalPower !== undefined) total.chemicalPower = (total.chemicalPower ?? 0) + v.chemicalPower * h / dt;
        if (v.heatPower !== undefined) total.heatPower = (total.heatPower ?? 0) + v.heatPower * h / dt;
        if (v.fanPower !== undefined) total.fanPower = (total.fanPower ?? 0) + v.fanPower * h / dt;
        if (v.chargeCurrent !== undefined) total.chargeCurrent = (total.chargeCurrent ?? 0) + v.chargeCurrent * h / dt;
        if (v.inductanceVoltage !== undefined) total.inductanceVoltage = (total.inductanceVoltage ?? 0) + v.inductanceVoltage * h / dt;
        if (v.fieldPower !== undefined) total.fieldPower = (total.fieldPower ?? 0) + v.fieldPower * h / dt;
        ambient += braking * h;
        const sum = (sums[id] ??= { current: 0, contact: 0, nc: 0, reactive: 0, apparent: 0, sign: 1, drive: { input: 0, output: 0, losses: 0, braking: 0, current: 0 } });
        // A DC storage transient within the substep adds the current's variance to its mean square.
        const variance = v.currentVariance ?? 0, nc = (v.currentNC ?? 0) !== 0;
        sum.current += (v.current ** 2 + (nc ? 0 : variance)) * h; sum.contact += ((v.contactCurrent ?? v.current) ** 2 + variance) * h; sum.nc += ((v.currentNC ?? 0) ** 2 + (nc ? variance : 0)) * h;
        if (v.stageCurrents && v.stageVoltages) {
          const stages = sum.stages ??= { current: [0, 0, 0], voltage: [0, 0, 0] };
          for (let i = 0; i < 3; i++) { stages.current[i] += v.stageCurrents[i] ** 2 * h; stages.voltage[i] += v.stageVoltages[i] ** 2 * h; }
        }
        if (v.secondaryCurrent !== undefined) {
          const secondary = sum.secondary ??= { current: 0, voltage: 0 };
          secondary.current += v.secondaryCurrent ** 2 * h; secondary.voltage += (v.secondaryVoltage ?? 0) ** 2 * h;
        }
        if (v.coilCurrent !== undefined) {
          const coil = sum.coil ??= { current: 0, voltage: 0, power: 0, currentSign: 1, voltageSign: 1 };
          coil.current += v.coilCurrent ** 2 * h; coil.voltage += (v.coilVoltage ?? 0) ** 2 * h; coil.power += (v.coilPower ?? 0) * h;
          if (v.coilCurrent) coil.currentSign = Math.sign(v.coilCurrent);
          if (v.coilVoltage) coil.voltageSign = Math.sign(v.coilVoltage);
        }
        sum.reactive += (v.reactivePower ?? 0) * h; sum.apparent += (v.apparentPower ?? (v.phases ?? 1) * Math.abs(v.voltage * v.current)) * h;
        if (v.current !== 0) sum.sign = Math.sign(v.current);
        if (v.drive) { sum.drive.input += v.drive.inputPower * h; sum.drive.output += v.drive.outputPower * h; sum.drive.losses += v.drive.losses * h; sum.drive.braking += braking * h; sum.drive.current += v.drive.outputCurrent ** 2 * h; }
        // Magnetic releases act on the instantaneous current: track its largest value across the substeps.
        if (v.currentPhasor && v.frequency) total.peakCurrent = Math.max(total.peakCurrent ?? 0, peakOverInterval(v.currentPhasor, v.phases ?? 1, ...angleWindow(v)));
        else if (!v.ac && v.peakCurrent !== undefined) total.peakCurrent = Math.max(total.peakCurrent ?? 0, v.peakCurrent);
      }
      // The configuration this substep ran with; a timer transition below is a switching event for the next one.
      this.acceptedKey = this.discreteKey(s, controls);
      // Drive and starter states advance last: the angle window above used the substep's start angle.
      this.advanceConverters(s, h, r.electrical, commands);
      s.devices.advance(s.project, r.electrical, h, s.temperatures);
      this.lastElectrical = r.electrical;
      remaining -= h;
    }
    for (const [id, sum] of Object.entries(sums)) {
      const total = totalElectrical!.readings[id];
      total.current = sum.sign * Math.sqrt(sum.current / dt);
      total.contactCurrent = Math.sqrt(sum.contact / dt);
      total.currentNC = Math.sqrt(sum.nc / dt);
      if (total.ac) {
        total.reactivePower = sum.reactive / dt;
        // Power factor of the step: average real power over average apparent power (includes distortion).
        // (A drive's own reading: its input power, not its net absorbed losses.)
        const real = total.drive ? sum.drive.input / dt : total.inputPower ?? total.power;
        total.powerFactor = sum.apparent > 1e-12 ? Math.min(1, Math.abs(real) / (sum.apparent / dt)) : null;
      }
      if (total.drive) total.drive = { ...total.drive, inputPower: sum.drive.input / dt, outputPower: sum.drive.output / dt, losses: sum.drive.losses / dt, braking: sum.drive.braking / dt, outputCurrent: Math.sqrt(sum.drive.current / dt) };
      if (sum.stages) { total.stageCurrents = sum.stages.current.map(i2 => Math.sqrt(i2 / dt)); total.stageVoltages = sum.stages.voltage.map(v2 => Math.sqrt(v2 / dt)); total.apparentPower = sum.apparent / dt; }
      if (sum.secondary) { total.secondaryCurrent = Math.sqrt(sum.secondary.current / dt); total.secondaryVoltage = Math.sqrt(sum.secondary.voltage / dt); }
      if (sum.coil) { total.coilCurrent = sum.coil.currentSign * Math.sqrt(sum.coil.current / dt); total.coilVoltage = sum.coil.voltageSign * Math.sqrt(sum.coil.voltage / dt); total.coilPower = sum.coil.power / dt; }
    }
    for (const [id, t] of Object.entries(this.tanks)) s.temperatures[id] = U.kToCelsius(t.temperature);
    this.overflowRate = Object.fromEntries(Object.keys(this.tanks).map(id => [id, (spilledThisStep[id] ?? 0) / dt]));
    return { electrical: totalElectrical!, heatPower: Object.fromEntries(Object.entries(heatEnergy).map(([id, e]) => [id, e / dt])), ambient, thermalGain, boilerElementGain: s.project.components.filter(c => c.kind === 'electricBoiler').reduce((sum, c) => sum + prop(c, 'heatCapacity') * (this.boilers[c.id].elementTemperature - elementBefore[c.id]), 0) };
  }
}
