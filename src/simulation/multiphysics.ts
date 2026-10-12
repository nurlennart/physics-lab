import { radiatorUA } from './devices';
import { prop, isMotor, type Component, type Project } from './model';
import { inductionCircuit, isStarter, peakOverInterval, solveElectrical, solveLinear, type ElectricalResult, type ElectricalReading } from './electrical';
import { advanceDrive, advanceStarter, driveCommand, driveLineVoltage, newDrive, newStarter, starterCommand, starterEvent, type DriveLimiter, type DriveState, type StarterState } from './converters';
import { machineParams, magneticEnergy, openStatorFlux, openStatorStep, currents, cabs, type Cx } from './induction';
import { solveHydraulic, boundaryTime, transport, emptyHydraulics, pipeCells, vaporPressure, npsh3At, type TankState } from './hydraulic';
import { unitsSI as U, WATER_CP as CP, WATER_RHO as RHO, GRAVITY as G } from './units';
import { kellDensity, inventoryVolume } from './water';
import type { Simulation } from './engine';
import { shaftBody } from './spatial-model';
/** `angle` is the accumulated rotor rotation (rad) since reset, used for drawing. */
export interface MotorState {
  omega: number; current: number; torque: number; load: number; shaftPower: number; copperPower: number; duty: number; acceleration: number; angle: number;
  /** Induction machines: stator/rotor flux linkages (Wb, RMS phasors in the supply frame), supply frequency, largest instantaneous phase current since energisation (A), flux change rate (1/s). */
  psiS?: Cx; psiR?: Cx; frequency?: number; inrushPeak?: number; energized?: boolean; fluxRate?: number;
  /** Speed-controlled DC drive: integral part of the armature current reference (A). */
  speedIntegral?: number;
}
/** Below this speed (rad/s) a rotor counts as at rest for the opposing load. */
const OMEGA_REST = 1e-9;
export class Multiphysics {
  tanks: Record<string, TankState> = {};
  motors: Record<string, MotorState> = {};
  positions: Record<string, number> = {};
  /** Water-cell temperatures (K) of pipes with inventory, inlet → outlet. */
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
  /** Discrete electrical configuration of the last accepted substep (switching detection). */
  private acceptedKey = '';
  private lastElectrical?: ElectricalResult;
  /** Last electromechanical Jacobian (chord Newton), valid for one substep length and motor count. */
  private chord?: { h: number; n: number; key: string; jac: number[][] };
  initialize(p: Project) {
    for (const c of p.components) {
      if (c.kind === 'tank') {
        // The configured initial volume is measured at the initial temperature (Kell density).
        const volume = U.litersToM3(prop(c, 'volume')), temperature = U.celsiusToK(prop(c, 'initialTemperature', 20));
        const mass = volume * kellDensity(prop(c, 'initialTemperature', 20));
        this.tanks[c.id] = { volume, mass, temperature, vessel: prop(c, 'vesselHeatCapacity') };
        this.initialMass += mass;
      }
      if (isMotor(c)) this.motors[c.id] = { omega: p.components.find(b => b.id === shaftBody(p, c.id))?.spatial?.omega ?? 0, current: 0, torque: 0, load: 0, shaftPower: 0, copperPower: 0, duty: 1, acceleration: 0, angle: 0, ...(c.kind === 'inductionMotor' ? { psiS: [0, 0] as Cx, psiR: [0, 0] as Cx, frequency: prop(c, 'ratedFrequency', 50), inrushPeak: 0, energized: false, fluxRate: 0 } : {}) };
      if (c.kind === 'actuatedValve') this.positions[c.id] = prop(c, 'opening');
      if (c.kind === 'pressureReducingValve') this.positions[c.id] = 100;
      if (pipeCells(c)) this.pipeCells[c.id] = Array(pipeCells(c)).fill(U.celsiusToK(prop(c, 'initialTemperature', 20)));
    }
    this.initialPotential = this.potential(p);
  }
  get massResidual() { return Object.values(this.tanks).reduce((s, t) => s + t.mass, 0) + this.removedMass - this.initialMass; }
  get kinetic() { return this.kineticEnergy(this.lastProject); }
  private lastProject?: Project;
  kineticEnergy(p?: Project) { return p ? p.components.filter(c => isMotor(c) && !shaftBody(p, c.id)).reduce((s, c) => s + 0.5 * prop(c, 'inertia') * (this.motors[c.id]?.omega ?? 0) ** 2, 0) : 0; }
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
   * Speed-controlled DC drive (cascade, as in thyristor/PWM armature drives): a PI speed controller sets the
   * armature current reference, limited to ±1.5·I_rated; the inner current loop is taken as ideal (much faster
   * than the mechanics), so the converter applies V = R·I* + kₑ·ω and duty = V/V_supply ∈ [0, 1]. Speed-loop
   * bandwidth ω_c = 20 rad/s on the rotor's own inertia (Kp = J·ω_c/kₜ), integral corner ω_c/4.
   */
  private dcSpeedGains(c: Component) {
    const bandwidth = 20;
    return { kp: prop(c, 'inertia') * bandwidth / prop(c, 'torqueConstant'), corner: bandwidth / 4, limit: 1.5 * prop(c, 'ratedCurrent') };
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
    const motors = s.project.components.filter(isMotor);
    const electrical = solveElectrical(s.project, s.failed, {
      ...s.devices.runtime(h),
      contacts: s.automation.contacts, faults: s.faults, disconnected: s.disconnected, temperatures: s.temperatures, filaments: s.filamentRatios(), open: s.openDevices(),
      motors: Object.fromEntries(motors.flatMap((c, i) => c.kind === 'motor' ? [[c.id, { enabled: controls[c.id].enabled, duty: this.dcDuty(c, controls[c.id].command, omega[i]), emf: prop(c, 'emfConstant') * omega[i] }]] : [])),
      inductionMotors: Object.fromEntries(motors.flatMap((c, i) => c.kind === 'inductionMotor' ? [[c.id, { omega: omega[i], enabled: controls[c.id].enabled, psiS: this.motors[c.id]?.psiS ?? [0, 0], psiR: this.motors[c.id]?.psiR ?? [0, 0], h }]] : [])),
      ...this.converterRuntime(s),
    });
    const speeds: Record<string, number> = {};
    const pairs: Record<string, string> = {};
    for (const w of s.project.connections.filter(w => w.domain === 'mechanical' && !s.disconnected.has(w.id))) {
      const motor = motors.find(c => c.id === w.from.component || c.id === w.to.component);
      if (motor) { const pump = motor.id === w.from.component ? w.to.component : w.from.component; if (s.project.components.find(c => c.id === pump)?.kind === 'pump') { pairs[motor.id] = pump; speeds[pump] = omega[motors.indexOf(motor)]; } }
    }
    const hydraulic = solveHydraulic(s.project, tanks, speeds, this.positions, s.faults, s.disconnected, this.hydraulic, this.pipeCells);
    const state = motors.map((c, i) => {
      const ctrl = { ...controls[c.id], duty: this.dcDuty(c, controls[c.id].command, omega[i]) }, r = electrical.readings[c.id];
      const running = ctrl.enabled && !s.failed[c.id];
      const machine = c.kind === 'inductionMotor' && running ? r?.machine : undefined;
      // DC: armature current from back EMF. Induction: line current and air-gap torque from the equivalent circuit.
      const current = c.kind === 'inductionMotor' ? (machine ? r.current : 0) : running ? (ctrl.duty * r.voltage - prop(c, 'emfConstant') * omega[i]) / prop(c, 'resistance') : 0;
      const pump = pairs[c.id] ? hydraulic.readings[pairs[c.id]] : undefined;
      const load = (pump?.torque ?? 0) + (loads?.[i] ?? prop(c, 'loadTorque'));
      const torque = c.kind === 'inductionMotor' ? machine?.torque ?? 0 : prop(c, 'torqueConstant') * current;
      // DC armature: the current's within-step variance (storage transients) adds to the copper loss; the supply-side
      // current is duty × the armature current.
      const copperPower = c.kind === 'inductionMotor' ? (machine ? machine.statorCopper + machine.rotorCopper : 0) : (current * current + (running && ctrl.duty > 0 ? (r?.currentVariance ?? 0) / ctrl.duty ** 2 : 0)) * prop(c, 'resistance');
      return { omega: omega[i], current, torque, load, shaftPower: shaftBody(s.project, c.id) ? (torque - prop(c, 'friction') * omega[i]) * omega[i] : load * omega[i], copperPower, duty: ctrl.duty, acceleration: shaftBody(s.project, c.id) ? this.motors[c.id]?.acceleration ?? 0 : (torque - load - prop(c, 'friction') * omega[i]) / prop(c, 'inertia'), angle: this.motors[c.id]?.angle ?? 0,
        ...(c.kind === 'inductionMotor' ? { psiS: this.motors[c.id]?.psiS, psiR: this.motors[c.id]?.psiR, frequency: this.motors[c.id]?.frequency, inrushPeak: this.motors[c.id]?.inrushPeak, energized: this.motors[c.id]?.energized, fluxRate: this.motors[c.id]?.fluxRate } : {}) };
    });
    return { electrical, hydraulic, state, speeds };
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
    for (const c of s.project.components.filter(c => c.kind === 'pump' && prop(c, 'npshRequired') > 0)) {
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
   * Opposing load: magnitude T_L resists the current direction of rotation and supplies no energy.
   * At rest it acts as static friction: it balances any net drive up to T_L (rotor held), and beyond
   * that resists the breakaway direction. Externally driven reverse rotation stays possible.
   */
  private opposingLoads(s: Simulation, old: number[], controls: ReturnType<Multiphysics['controls']>, linked: (string | undefined)[], h = 0) {
    const motors = s.project.components.filter(isMotor);
    const magnitude = motors.map(c => Math.max(0, prop(c, 'loadTorque')));
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
    return { loads, held };
  }
  /**
   * Advance an induction machine's flux linkages over an accepted step (midpoint values from the
   * electrical solve). Energised: ψ₁ = 2ψ_mid − ψ₀. Open stator (contactor open, supply lost): the
   * rotor flux decays; interrupting a winding current dumps the stator-side field energy at once
   * (contact arc, booked as heat in the motor). Returns the extra heat (J) of the open-stator path.
   */
  private advanceFlux(c: Component, reading: ElectricalReading | undefined, omega: number, h: number, window: [number, number]) {
    const state = this.motors[c.id], psiS0 = state.psiS ?? [0, 0], psiR0 = state.psiR ?? [0, 0];
    const mid = reading?.machine?.psiS && reading.machine.psiR ? { s: reading.machine.psiS, r: reading.machine.psiR } : undefined;
    const frequency = reading?.frequency ?? state.frequency ?? prop(c, 'ratedFrequency', 50), m = machineParams(c, frequency);
    let heat = 0, psiS: Cx, psiR: Cx, peak = state.inrushPeak ?? 0;
    if (mid) {
      psiS = [2 * mid.s[0] - psiS0[0], 2 * mid.s[1] - psiS0[1]];
      psiR = [2 * mid.r[0] - psiR0[0], 2 * mid.r[1] - psiR0[1]];
      // Line current: a star-connected winding carries i_line/a.
      const is = currents(m, mid.s, mid.r).is, a = reading?.machine?.lineRatio ?? 1;
      peak = Math.max(state.energized ? peak : 0, peakOverInterval([a * is[0], a * is[1]], 3, window[0], window[1]));
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
  refresh(s: Simulation) {
    this.lastProject = s.project;
    const ms = s.project.components.filter(isMotor);
    const speeds = () => ms.map(c => { const body = shaftBody(s.project, c.id); return body ? s.spatial.readings[body]?.omega ?? 0 : this.motors[c.id]?.omega ?? 0; });
    const controls = this.controls(s), { loads, held } = this.opposingLoads(s, speeds(), controls, ms.map(c => shaftBody(s.project, c.id)));
    let r = this.solve(s, speeds(), controls, this.tanks, loads);
    this.hydraulic = r.hydraulic;
    if (!Object.keys(r.hydraulic.nodeTemperatures).length && Object.keys(r.hydraulic.potentials).length) {
      // First solve: no transported temperatures yet. A zero-length transport mixes the current
      // inventories into node temperatures, then the network is re-solved with their viscosities.
      transport(s.project, this.tanks, r.hydraulic, 0, this.pipeCells, Object.fromEntries(s.project.components.filter(c => c.kind === "radiator").map(c => [c.id, radiatorUA(c, r.electrical)])));
      r = this.solve(s, speeds(), controls, this.tanks, loads);
      this.hydraulic = r.hydraulic;
    }
    // Re-solving hydraulics rebuilds readings. Resolve current fluid temperatures without
    // moving mass/heat so paused edits and fault recovery cannot erase valid measurements.
    transport(s.project, this.tanks, this.hydraulic, 0, this.pipeCells, Object.fromEntries(s.project.components.filter(c => c.kind === "radiator").map(c => [c.id, radiatorUA(c, r.electrical)])));
    this.updateNpsh(s, this.hydraulic);
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
  advance(s: Simulation, dt: number): { electrical: ElectricalResult; heatPower: Record<string, number>; ambient: number; thermalGain: number } {
    s.spatial.stepMs = 0;
    this.lastProject = s.project;
    const motors = s.project.components.filter(isMotor), controls = this.controls(s), heatEnergy: Record<string, number> = {}, commands = this.converterCommands(s);
    let remaining = dt, ambient = 0, thermalGain = 0, totalElectrical: ElectricalResult | undefined, intervals = 0;
    const adaptive = !s.spatial.hasMovingBodies && dt > 0.1 + 1e-12;
    const spilledThisStep: Record<string, number> = {};
    // Step readings: currents as RMS over the substeps, powers as averages (not the first substep's sample).
    const sums: Record<string, { current: number; contact: number; nc: number; reactive: number; apparent: number; sign: number; secondary?: { current: number; voltage: number }; coil?: { current: number; voltage: number; power: number; currentSign: number; voltageSign: number }; drive: { input: number; output: number; losses: number; braking: number; current: number } }> = {};
    // Midpoint shaft/electrical/hydraulic solve; 1/240 s bounds head/storage splitting error.
    while (remaining > 1e-12) {
      if (++intervals > 1024) throw Error('Too many coupled boundary events or mechanical substeps within one timestep.');
      // Adaptive macro steps (no rigid bodies) are already bounded by engine.adaptiveLimit; rigid bodies keep
      // their contact/gravity substep; other fixed steps are bounded by the storage time scales.
      this.applyCommands(s, commands);
      let h = Math.min(remaining, s.spatial.hasMovingBodies ? s.spatial.maxStep(s.project) : adaptive ? remaining : this.fixedStepLimit(s), this.electricalStepLimit(s, controls), this.converterEventLimit(s), s.devices.eventLimit(s.project));
      const old = motors.map(c => this.motors[c.id].omega);
      const linked = motors.map(c => shaftBody(s.project, c.id));
      const { loads, held } = this.opposingLoads(s, old, controls, linked, h);
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
          // The load catches the rotor: the overshoot's kinetic energy goes to the load (exported work).
          this.externalShaftWork += 0.5 * prop(c, 'inertia') * next * next;
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
        if (Math.abs(next) > prop(c, 'maxSpeed')) s.violation(`${c.name}: maximum supported rotor speed exceeded.`);
        if (Math.abs(m.torque) > prop(c, 'ratedTorque') * 1.001) s.automation.status[c.id] = 'overloaded';
      });
      for (const [id, reading] of Object.entries(r.hydraulic.readings)) {
        this.pumpWork += reading.shaftPower * h;
        this.hydraulicWork += reading.hydraulicPower * h;
        this.transferred[id] = (this.transferred[id] ?? 0) + Math.abs(reading.flow) * h;
        if (Math.abs(reading.flow) < 1e-14 && reading.shaftPower > 0) { this.dryLoss += reading.shaftPower * h; ambient += reading.shaftPower * h; }
      }
      this.dissipation += r.hydraulic.branches.reduce((sum, b) => sum + b.loss, 0) * h;
      const transported = transport(s.project, this.tanks, r.hydraulic, h, this.pipeCells, Object.fromEntries(s.project.components.filter(c => c.kind === "radiator").map(c => [c.id, radiatorUA(c, r.electrical)])));
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
      if (!totalElectrical) totalElectrical = { ...r.electrical, sourcePower: 0, dissipatedPower: 0, storedPower: 0, readings: Object.fromEntries(Object.entries(r.electrical.readings).map(([id, v]) => [id, { ...v, power: 0, ...(v.inputPower !== undefined ? { inputPower: 0 } : {}), ...(v.chemicalPower !== undefined ? { chemicalPower: 0 } : {}), ...(v.heatPower !== undefined ? { heatPower: 0 } : {}), ...(v.fanPower !== undefined ? { fanPower: 0 } : {}), ...(v.chargeCurrent !== undefined ? { chargeCurrent: 0 } : {}), ...(v.inductanceVoltage !== undefined ? { inductanceVoltage: 0 } : {}), ...(v.fieldPower !== undefined ? { fieldPower: 0 } : {}), peakCurrent: undefined }])) };
      totalElectrical.sourcePower += r.electrical.sourcePower * h / dt;
      totalElectrical.dissipatedPower += r.electrical.dissipatedPower * h / dt;
      totalElectrical.storedPower! += (r.electrical.storedPower ?? 0) * h / dt;
      for (const [id, v] of Object.entries(r.electrical.readings)) {
        const total = totalElectrical.readings[id];
        // A drive's braking resistor is external: its heat goes to ambient, not into the drive's heat sink.
        const braking = v.drive?.braking ?? 0;
        total.power += (v.power - braking) * h / dt;
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
        sum.reactive += (v.reactivePower ?? 0) * h; sum.apparent += (v.phases ?? 1) * Math.abs(v.voltage * v.current) * h;
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
      if (sum.secondary) { total.secondaryCurrent = Math.sqrt(sum.secondary.current / dt); total.secondaryVoltage = Math.sqrt(sum.secondary.voltage / dt); }
      if (sum.coil) { total.coilCurrent = sum.coil.currentSign * Math.sqrt(sum.coil.current / dt); total.coilVoltage = sum.coil.voltageSign * Math.sqrt(sum.coil.voltage / dt); total.coilPower = sum.coil.power / dt; }
    }
    for (const [id, t] of Object.entries(this.tanks)) s.temperatures[id] = U.kToCelsius(t.temperature);
    this.overflowRate = Object.fromEntries(Object.keys(this.tanks).map(id => [id, (spilledThisStep[id] ?? 0) / dt]));
    return { electrical: totalElectrical!, heatPower: Object.fromEntries(Object.entries(heatEnergy).map(([id, e]) => [id, e / dt])), ambient, thermalGain };
  }
}
