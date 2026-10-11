import { prop, isMotor, type Component, type Project } from './model';
import { peakOverInterval, solveElectrical, solveLinear, type ElectricalResult, type ElectricalReading } from './electrical';
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
      // Induction machines run direct-on-line (no drive); the DC motor's ideal PWM drive follows the speed command.
      const duty = c.kind === 'inductionMotor' || command === null ? 1 : Math.max(0.001, Math.min(1, prop(c, 'emfConstant') * command / prop(c, 'ratedVoltage') + 0.02 * (command - (this.motors[c.id]?.omega ?? 0))));
      return [c.id, { enabled: enabled && (command === null || command > 0), duty }];
    }));
  }
  /**
   * `loads`: signed external shaft load per motor (N·m, positive opposes positive rotation). The
   * "External shaft load" property is a magnitude that always resists motion (advance() chooses the
   * sign from the direction of rotation, or holds the rotor at rest); default: +magnitude.
   */
  solve(s: Simulation, omega: number[], controls: ReturnType<Multiphysics['controls']>, tanks: Record<string, TankState> = this.tanks, loads?: number[], h = 0) {
    const motors = s.project.components.filter(isMotor);
    const electrical = solveElectrical(s.project, s.failed, {
      contacts: s.automation.contacts, faults: s.faults, disconnected: s.disconnected, temperatures: s.temperatures, open: s.openDevices(),
      motors: Object.fromEntries(motors.flatMap((c, i) => c.kind === 'motor' ? [[c.id, { ...controls[c.id], emf: prop(c, 'emfConstant') * omega[i] }]] : [])),
      inductionMotors: Object.fromEntries(motors.flatMap((c, i) => c.kind === 'inductionMotor' ? [[c.id, { omega: omega[i], enabled: controls[c.id].enabled, psiS: this.motors[c.id]?.psiS ?? [0, 0], psiR: this.motors[c.id]?.psiR ?? [0, 0], h }]] : [])),
    });
    const speeds: Record<string, number> = {};
    const pairs: Record<string, string> = {};
    for (const w of s.project.connections.filter(w => w.domain === 'mechanical' && !s.disconnected.has(w.id))) {
      const motor = motors.find(c => c.id === w.from.component || c.id === w.to.component);
      if (motor) { const pump = motor.id === w.from.component ? w.to.component : w.from.component; if (s.project.components.find(c => c.id === pump)?.kind === 'pump') { pairs[motor.id] = pump; speeds[pump] = omega[motors.indexOf(motor)]; } }
    }
    const hydraulic = solveHydraulic(s.project, tanks, speeds, this.positions, s.faults, s.disconnected, this.hydraulic, this.pipeCells);
    const state = motors.map((c, i) => {
      const ctrl = controls[c.id], r = electrical.readings[c.id];
      const running = ctrl.enabled && !s.failed[c.id];
      const machine = c.kind === 'inductionMotor' && running ? r?.machine : undefined;
      // DC: armature current from back EMF. Induction: line current and air-gap torque from the equivalent circuit.
      const current = c.kind === 'inductionMotor' ? (machine ? r.current : 0) : running ? (ctrl.duty * r.voltage - prop(c, 'emfConstant') * omega[i]) / prop(c, 'resistance') : 0;
      const pump = pairs[c.id] ? hydraulic.readings[pairs[c.id]] : undefined;
      const load = (pump?.torque ?? 0) + (loads?.[i] ?? prop(c, 'loadTorque'));
      const torque = c.kind === 'inductionMotor' ? machine?.torque ?? 0 : prop(c, 'torqueConstant') * current;
      const copperPower = c.kind === 'inductionMotor' ? (machine ? machine.statorCopper + machine.rotorCopper : 0) : current * current * prop(c, 'resistance');
      return { omega: omega[i], current, torque, load, shaftPower: shaftBody(s.project, c.id) ? (torque - prop(c, 'friction') * omega[i]) * omega[i] : load * omega[i], copperPower, duty: ctrl.duty, acceleration: shaftBody(s.project, c.id) ? this.motors[c.id]?.acceleration ?? 0 : (torque - load - prop(c, 'friction') * omega[i]) / prop(c, 'inertia'), angle: this.motors[c.id]?.angle ?? 0,
        ...(c.kind === 'inductionMotor' ? { psiS: this.motors[c.id]?.psiS, psiR: this.motors[c.id]?.psiR, frequency: this.motors[c.id]?.frequency, inrushPeak: this.motors[c.id]?.inrushPeak, energized: this.motors[c.id]?.energized, fluxRate: this.motors[c.id]?.fluxRate } : {}) };
    });
    return { electrical, hydraulic, state, speeds };
  }
  private midpointTanks(s: Simulation, h: number): Record<string, TankState> {
    return Object.fromEntries(Object.entries(this.tanks).map(([id, t]) => {
      const c = s.project.components.find((c) => c.id === id);
      // Tanks may surcharge above their rim (weir overflow), so only emptiness bounds the estimate.
      void c;
      const mass = Math.max(0, t.mass + 0.5 * h * (this.hydraulic.readings[id]?.flow ?? 0) * RHO);
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
  private advanceFlux(c: Component, reading: ElectricalReading | undefined, omega: number, h: number, time: number) {
    const state = this.motors[c.id], psiS0 = state.psiS ?? [0, 0], psiR0 = state.psiR ?? [0, 0];
    const mid = reading?.machine?.psiS && reading.machine.psiR ? { s: reading.machine.psiS, r: reading.machine.psiR } : undefined;
    const frequency = reading?.frequency ?? state.frequency ?? prop(c, 'ratedFrequency', 50), m = machineParams(c, frequency);
    let heat = 0, psiS: Cx, psiR: Cx, peak = state.inrushPeak ?? 0;
    if (mid) {
      psiS = [2 * mid.s[0] - psiS0[0], 2 * mid.s[1] - psiS0[1]];
      psiR = [2 * mid.r[0] - psiR0[0], 2 * mid.r[1] - psiR0[1]];
      peak = Math.max(state.energized ? peak : 0, peakOverInterval(currents(m, mid.s, mid.r).is, 3, m.ws * (time - h / 2), m.ws * (time + h / 2)));
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
    for (const c of s.project.components) {
      if (c.kind !== 'inductionMotor') continue;
      const state = this.motors[c.id];
      if (!state) continue;
      const switching = controls[c.id]?.enabled !== state.energized, fluxing = (state.fluxRate ?? 0) > 1;
      if (switching || fluxing) limit = Math.min(limit, 1 / (40 * (state.frequency ?? prop(c, 'ratedFrequency', 50))));
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
      transport(s.project, this.tanks, r.hydraulic, 0, this.pipeCells);
      r = this.solve(s, speeds(), controls, this.tanks, loads);
      this.hydraulic = r.hydraulic;
    }
    // Re-solving hydraulics rebuilds readings. Resolve current fluid temperatures without
    // moving mass/heat so paused edits and fault recovery cannot erase valid measurements.
    transport(s.project, this.tanks, this.hydraulic, 0, this.pipeCells);
    this.updateNpsh(s, this.hydraulic);
    ms.forEach((c, i) => {
      const m = r.state[i];
      if (shaftBody(s.project, c.id)) {
        // Shaft output excludes acceleration of the motor's own rotor inertia.
        const load = m.torque - prop(c, 'friction') * m.omega - prop(c, 'inertia') * m.acceleration;
        this.motors[c.id] = { ...m, load, shaftPower: load * m.omega };
      } else this.motors[c.id] = held[i] ? { ...m, acceleration: 0 } : m;
    });
    return r.electrical;
  }
  advance(s: Simulation, dt: number): { electrical: ElectricalResult; heatPower: Record<string, number>; ambient: number; thermalGain: number } {
    s.spatial.stepMs = 0;
    this.lastProject = s.project;
    const motors = s.project.components.filter(isMotor), controls = this.controls(s), heatEnergy: Record<string, number> = {};
    let remaining = dt, ambient = 0, thermalGain = 0, totalElectrical: ElectricalResult | undefined, intervals = 0;
    const adaptive = !s.spatial.count && dt > 0.1 + 1e-12;
    const spilledThisStep: Record<string, number> = {};
    // Midpoint shaft/electrical/hydraulic solve; 1/240 s bounds head/storage splitting error.
    while (remaining > 1e-12) {
      if (++intervals > 1024) throw Error('Too many coupled boundary events or mechanical substeps within one timestep.');
      // Adaptive macro steps (no rigid bodies) are already bounded by engine.adaptiveLimit;
      // fixed steps keep the 1/240 s head/storage splitting bound.
      let h = Math.min(remaining, s.spatial.count || dt <= 0.1 + 1e-12 ? s.spatial.maxStep(s.project) : remaining, this.electricalStepLimit(s, controls));
      const old = motors.map(c => this.motors[c.id].omega);
      const linked = motors.map(c => shaftBody(s.project, c.id));
      const { loads, held } = this.opposingLoads(s, old, controls, linked, h);
      const discrete = motors.map((c, i) => `${controls[c.id].enabled ? 1 : 0}${Math.sign(loads[i])}${held[i] ? 'h' : ''}`).join('|');
      const snapshot = linked.some(Boolean) ? s.spatial.checkpoint() : undefined;
      let accepted: ReturnType<Multiphysics['solve']> | undefined;
      let acceptedTrial: ReturnType<typeof s.spatial.trial> | undefined;
      const torqueMap = (r: ReturnType<Multiphysics['solve']>, x: number[]) => Object.fromEntries(motors.flatMap((c, i) => linked[i] ? [[linked[i]!, r.state[i].torque - r.state[i].load - prop(c, 'friction') * x[i]]] : []));
      let midpoint = [...old];
      for (let event = 0; event < 12; event++) {
        // Predictor: start the midpoint speed from the last acceleration (exact for steady acceleration).
        midpoint = old.map((w, i) => w + 0.5 * h * (this.motors[motors[i].id]?.acceleration ?? 0));
        // Adaptive macro steps solve the network at predicted mid-step tank levels (second order in
        // the head/storage coupling); fixed steps keep start-of-step levels.
        const levels = adaptive ? this.midpointTanks(s, h) : this.tanks;
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
        for (let k = 0; k < 32 && motors.length; k++) {
          const { r, f, trial } = residualAt(midpoint); this.couplingIterations = k + 1;
          const norm = Math.max(...f.map(Math.abs));
          if (norm < 1e-8) { accepted = r; acceptedTrial = trial; converged = true; break; }
          if (!jac || norm > 0.25 * lastNorm) {
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
          midpoint = midpoint.map((v, i) => v + d[i]);
        }
        if (!converged) throw Error('Electromechanical midpoint coupling failed to converge.');
        accepted = accepted ?? this.solve(s, midpoint, controls, levels, loads, h);
        const safe = boundaryTime(s.project, this.tanks, accepted.hydraulic, h);
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
        this.motors[c.id] = { ...m, omega: next, load, shaftPower: load * midpoint[i], acceleration, angle: (previous?.angle ?? 0) + midpoint[i] * h,
          ...(c.kind === 'inductionMotor' ? { psiS: previous?.psiS, psiR: previous?.psiR, frequency: previous?.frequency, inrushPeak: previous?.inrushPeak, energized: previous?.energized, fluxRate: previous?.fluxRate } : {}) };
        this.copperEnergy += m.copperPower * h;
        const friction = prop(c, 'friction') * midpoint[i] ** 2;
        this.frictionEnergy += friction * h;
        heatEnergy[c.id] = (heatEnergy[c.id] ?? 0) + (m.copperPower + friction) * h;
        if (c.kind === 'inductionMotor') heatEnergy[c.id] += this.advanceFlux(c, r.electrical.readings[c.id], midpoint[i], h, s.time + (dt - remaining) + h / 2);
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
      const transported = transport(s.project, this.tanks, r.hydraulic, h, this.pipeCells);
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
      if (!totalElectrical) totalElectrical = { ...r.electrical, sourcePower: 0, dissipatedPower: 0, readings: Object.fromEntries(Object.entries(r.electrical.readings).map(([id, v]) => [id, { ...v, power: 0 }])) };
      totalElectrical.sourcePower += r.electrical.sourcePower * h / dt;
      totalElectrical.dissipatedPower += r.electrical.dissipatedPower * h / dt;
      const start = s.time + (dt - remaining), turn = (f: number) => 2 * Math.PI * f;
      for (const [id, v] of Object.entries(r.electrical.readings)) {
        const total = totalElectrical.readings[id];
        total.power += v.power * h / dt;
        // Magnetic releases act on the instantaneous current: track its largest value across the substeps.
        if (v.currentPhasor && v.frequency) total.peakCurrent = Math.max(total.peakCurrent ?? 0, peakOverInterval(v.currentPhasor, v.phases ?? 1, turn(v.frequency) * start, turn(v.frequency) * (start + h)));
      }
      remaining -= h;
    }
    for (const [id, t] of Object.entries(this.tanks)) s.temperatures[id] = U.kToCelsius(t.temperature);
    this.overflowRate = Object.fromEntries(Object.keys(this.tanks).map(id => [id, (spilledThisStep[id] ?? 0) / dt]));
    return { electrical: totalElectrical!, heatPower: Object.fromEntries(Object.entries(heatEnergy).map(([id, e]) => [id, e / dt])), ambient, thermalGain };
  }
}
