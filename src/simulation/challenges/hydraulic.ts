import { economyFactor } from '../scoring';
import { projectCost, prop, type Component, type Project } from '../model';
import { challengeError } from '../integrity';
import { hydraulicStarter } from '../hydraulic-projects';
import type { Simulation } from '../engine';
import { allKindsExcept, controlledBy, findUpstream, fixturesOnly, lockedRules, standardLimits } from './common';
import { starsFor, type ChallengeDefinition } from './types';
import type { ChallengeId } from './ids';

export interface HydraulicState {
  /** Scored time (s) and the part of it inside the band. */
  evaluated: number; inBand: number;
  /** Pressure control: ∫error² dt, peak overshoot (Pa), slowest recovery after a demand change (s). */
  squaredError: number; maxOvershoot: number; responseTime: number; settledAt: number;
  /** Consumer flow integrated per demand phase. */
  lowDemandFlow: number; highDemandFlow: number; lowDemandTime: number; highDemandTime: number;
  /** Motor on/off transitions. */
  switches: number; previousOn: boolean;
  faultInjected: boolean;
}
const initialState = (): HydraulicState => ({ inBand: 0, evaluated: 0, squaredError: 0, maxOvershoot: 0, faultInjected: false, switches: 0, previousOn: false, responseTime: 0, settledAt: 0, lowDemandFlow: 0, highDemandFlow: 0, lowDemandTime: 0, highDemandTime: 0 });
/** Tracking state of a running hydraulic assignment. */
export const hydraulicState = (s: Simulation) => s.challengeState as HydraulicState;

const PRESSURE_TARGET = 35000, PRESSURE_BAND = 3500;

/** What a mission's tracking and checks see. Vessels are absent only in an invalid build. */
interface Context {
  p: Project; s: Simulation; state: HydraulicState;
  source?: Component; destination?: Component; motors: Component[];
  /** Destination inventory (L). */
  delivered: number;
  /** Fraction of scored time in band, and RMS pressure error (Pa). */
  band: number; rms: number;
}
interface HydraulicMission {
  id: ChallengeId;
  /** Working build of this plant; with `challenge`, its scored assignment variant. */
  starter(challenge?: boolean): Project;
  number: string; title: string; difficulty: string; description: string; objectives: string[];
  budget: number; economyTarget: number; guide: ChallengeDefinition['guide'];
  idealEnergy: number; idealTime: number;
  /** Destination tank elevation (m). */
  destinationElevation: number;
  /** Operating deadline (s) and its violation. */
  deadline?: { seconds: number; message: string };
  /** Locked consumer-demand valve. */
  demand?: { diameter: number; opening: number };
  beforeStep?(s: Simulation): void;
  /** Mission tracking after the shared limits; `level` is the destination level (%). */
  track?(s: Simulation, state: HydraulicState, dt: number, vessels: { source: Component; destination: Component }, level: number): void;
  /** Mission checks after the shared working and safety checks. */
  checks(ctx: Context): { label: string; ok: boolean }[];
  /** Score credit (0–1) for time in band. */
  bandCredit(band: number): number;
  /** Points deducted for response and overshoot. */
  penalty?(state: HydraulicState): number;
  progress(ctx: Context): number;
}

const vessels = (p: Project) => ({ destination: p.components.find(c => c.kind === "tank" && c.name === "Destination tank"), source: p.components.find(c => c.name === "Source reservoir") });
/** Whether a sensor of `kind` targeting `target` feeds the motor's control. */
const sensedBy = (p: Project, motor: Component, kind: string, target: string) => controlledBy(p, motor.id, c => c.kind === kind && c.props.target === target);
/** Whether a pressure sensor measures at the consumer valve's inlet node. */
const atConsumerInlet = (s: Simulation, sensor: Component, demand?: Component) => {
  const nodes = s.multiphysics.hydraulic.terminalNodes;
  return !!demand && (nodes[`${sensor.props.target}:outlet`] ?? nodes[`${sensor.props.target}:fluid`]) === nodes[`${demand.id}:inlet`];
};

function updateHydraulic(m: HydraulicMission, s: Simulation, state: HydraulicState, dt: number) {
  const p = s.project, { destination, source } = vessels(p);
  if (!destination || !source) return;
  const level = s.hydraulicMeasurement(destination.id, "level") ?? 0;
  const motor = p.components.find(c => c.kind === "motor"), on = !!motor && Math.abs(s.multiphysics.motors[motor.id]?.current ?? 0) > 0.1;
  if (on !== state.previousOn) { state.switches++; state.previousOn = on; }
  for (const r of Object.values(s.multiphysics.hydraulic.readings)) if (Math.max(r.pressure, r.inletPressure) > 200000) s.violation("Assignment pressure limit exceeded: 2 bar.");
  if (s.peakPower > 500.001) s.violation("Assignment electrical input exceeds 500 W.");
  if (m.deadline && s.time > m.deadline.seconds) s.violation(m.deadline.message);
  // Full tanks spill over their rim instead of silently blocking inflow; any spill is lost water.
  for (const tank of p.components.filter(c => c.kind === "tank"))
    if ((s.multiphysics.overflowed[tank.id] ?? 0) > 0) s.violation(`${tank.name} overflowed: water was lost over the rim. Add level control or protection.`);
  m.track?.(s, state, dt, { destination, source }, level);
}
function evaluateHydraulic(m: HydraulicMission, p: Project, s: Simulation, state: HydraulicState) {
  const { destination, source } = vessels(p), motors = p.components.filter(c => c.kind === "motor");
  const delivered = destination ? (s.multiphysics.tanks[destination.id]?.volume ?? 0) * 1000 : 0;
  const safe = !challengeError(p) && !s.error && !s.violations.length && !Object.keys(s.failed).length && Math.abs(s.multiphysics.massResidual) < 1e-6;
  const working = motors.some(c => s.componentEnergy[c.id] > 1) && s.multiphysics.pumpWork > 1 && delivered > 0;
  const band = state.evaluated ? state.inBand / state.evaluated : 0;
  const rms = state.evaluated ? Math.sqrt(state.squaredError / state.evaluated) : Infinity;
  const ctx: Context = { p, s, state, source, destination, motors, delivered, band, rms };
  const checks = [
    { label: "Powered motor, shared pump shaft and physically transferred water", ok: working },
    { label: "Valid configuration; safe inventory, pressure, power and budget", ok: safe },
    ...m.checks(ctx),
  ];
  const complete = checks.every(c => c.ok);
  const energy = Math.min(1, m.idealEnergy / Math.max(1, s.suppliedEnergy)),
    economy = economyFactor(m.economyTarget, projectCost(p), m.budget),
    time = Math.min(1, m.idealTime / Math.max(m.idealTime, s.time)),
    penalty = m.penalty ? m.penalty(state) : 0;
  const score = complete ? Math.round(55 + 15 * energy + 10 * economy + 10 * time + 10 * m.bandCredit(band) - penalty) : 0;
  return { checks, complete, failed: !safe, score, stars: starsFor(complete, score), progress: Math.min(1, m.progress(ctx)) };
}

/**
 * Hydraulic assignment: a finite 150 L source reservoir and a 120 L destination; 24 V, 500 W and 2 bar.
 * Score 55 + 15 × energy + 10 × economy + 10 × time + 10 × time in band − penalty.
 */
function hydraulicMission(m: HydraulicMission): ChallengeDefinition<HydraulicState> {
  return {
    id: m.id, number: m.number, title: m.title, difficulty: m.difficulty, description: m.description, objectives: m.objectives, family: 'hydraulic',
    budget: m.budget, economyTarget: m.economyTarget, guide: m.guide,
    rules: lockedRules(24, allKindsExcept('heater', 'cooler')),
    limits: standardLimits,
    validate: (p) => {
      for (const name of ["Source reservoir", "Destination tank"]) {
        const matches = p.components.filter(c => c.name === name);
        if (matches.length !== 1 || matches[0].kind !== "tank") return "Hydraulic assignments require unique locked source/destination vessels.";
      }
      if (m.demand) {
        const demand = p.components.filter(c => c.name === "Consumer demand");
        if (demand.length !== 1 || demand[0].kind !== "valve" || prop(demand[0], "diameter") !== m.demand.diameter || prop(demand[0], "opening") !== m.demand.opening) return "The challenge consumer-demand valve is locked.";
      }
      return null;
    },
    vessels: {
      count: 2, countError: "Hydraulic assignments require the two locked source/destination vessels.",
      matches: (c) => {
        const source = c.name === "Source reservoir";
        return prop(c, "volume") === (source ? 150 : 0) && prop(c, "capacity") === (source ? 150 : 120) && prop(c, "surfaceArea") === 0.1 && prop(c, "elevation") === (source ? 0 : m.destinationElevation);
      },
    },
    scaffold: () => fixturesOnly(m.starter(true)),
    reference: () => m.starter(),
    createState: initialState,
    beforeStep: m.beforeStep && ((s) => m.beforeStep!(s)),
    update: (s, state, dt) => updateHydraulic(m, s, state, dt),
    evaluate: (p, s, state) => evaluateHydraulic(m, p, s, state),
  };
}

export const transfer = hydraulicMission({
  id: "transfer", starter: (challenge) => hydraulicStarter("transfer", challenge),
  number: "004", title: "Water Transfer", difficulty: "INTERMEDIATE", budget: 650, economyTarget: 458,
  description: "Transfer 100 L from the finite 150 L source into a tank elevated by 2 m. Build and power the shaft-driven hydraulic circuit within 300 s.",
  objectives: ["Deliver ≥100 L through a real hydraulic network", "Stay below 500 W, 24 V and 2 bar", "Finish in 300 s without overflow or dry run"],
  guide: { mission: 'The hilltop outpost is thirsty. Deliver 100 L before the clock runs out.', kit: 'Two fixed vessels are supplied. Choose a 24 V source, motor, pump, pipe and valve.', hints: ['Build three paths: electrical power, motor-to-pump shaft, and water delivery.', 'Source reservoir → pump inlet; pump outlet → pipe → valve → destination. Close the motor electrical loop.', 'Keep the pump wet. Watch flow and destination inventory while testing against the 300 s deadline.'] },
  idealEnergy: 12000, idealTime: 180, destinationElevation: 2,
  deadline: { seconds: 300, message: "Water transfer exceeded 300 s deadline." },
  checks: ({ s, delivered }) => [{ label: "At least 100 L delivered within 300 s", ok: delivered >= 100 - 1e-6 && s.time <= 300 }],
  bandCredit: () => 1,
  progress: ({ delivered }) => delivered / 100,
});

export const pressure = hydraulicMission({
  id: "pressure", starter: (challenge) => hydraulicStarter("pressure", challenge),
  number: "005", title: "Pressure Control", difficulty: "ADVANCED", budget: 750, economyTarget: 494,
  description: "Maintain 0.35 bar at the delivery pipe outlet for 180 s after 15 s startup. Consumer valve demand alternates between 40% and 80% every 60 s.",
  objectives: ["Wire pressure feedback and numeric speed control", "Stay within ±10% for ≥90% of the scored interval", "RMS error ≤3.5 kPa; no overshoot above 0.6 bar", "500 W, 24 V, 2 bar and €750 limits"],
  guide: { mission: 'Demand keeps changing. Give the outpost a steady water pressure anyway.', kit: 'Vessels and consumer valve are supplied. Add a powered pump, delivery pipe, return pipe, pressure sensor and PI controller.', hints: ['Target the delivery pipe with the pressure sensor. Numeric controller output goes to motor speed.', 'Start with reference 35000 Pa (0.35 bar), Kp 0.06, Ki 0.08 and output limit 3500 RPM.', 'Complete the return from destination to source. Demand changes every 60 s; inspect the recovery after each change.'] },
  idealEnergy: 15000, idealTime: 195, destinationElevation: 0, demand: { diameter: 0.018, opening: 40 },
  // Consumer demand alternates between 40 % and 80 % opening every 60 s.
  beforeStep: (s) => {
    const demand = s.project.components.find(c => c.name === "Consumer demand");
    if (demand) s.multiphysics.positions[demand.id] = Math.floor(s.time / 60) % 2 ? 80 : 40;
  },
  // Scored after 15 s startup: band, RMS, overshoot and recovery time at the consumer inlet, and flow per demand phase.
  track: (s, state, dt) => {
    if (s.time < 15) return;
    const demand = s.project.components.find(c => c.name === "Consumer demand")!;
    const sensor = s.project.components.find(c => c.kind === "pressureSensor" && atConsumerInlet(s, c, demand)), measured = sensor ? s.automation.sensors[sensor.id] : undefined;
    const pressure = measured?.valid ? Number(measured.value) : 0, error = pressure - PRESSURE_TARGET;
    state.evaluated += dt; state.squaredError += error * error * dt;
    const demandFlow = Math.abs(s.multiphysics.hydraulic.readings[demand.id]?.flow ?? 0);
    if (Math.floor((s.time - dt) / 60) % 2) { state.highDemandFlow += demandFlow * dt; state.highDemandTime += dt; }
    else { state.lowDemandFlow += demandFlow * dt; state.lowDemandTime += dt; }
    state.maxOvershoot = Math.max(state.maxOvershoot, pressure - PRESSURE_TARGET);
    if (Math.abs(error) <= PRESSURE_BAND) state.inBand += dt;
    const phaseTime = s.time % 60;
    if (phaseTime < dt * 1.5) state.settledAt = 0;
    if (Math.abs(error) <= PRESSURE_BAND && !state.settledAt) { state.settledAt = s.time; state.responseTime = Math.max(state.responseTime, phaseTime); }
  },
  checks: ({ p, s, state: r, motors, band, rms }) => {
    const demand = p.components.find(c => c.name === "Consumer demand");
    const feedback = motors.some(motor => p.components.some(sensor => sensor.kind === "pressureSensor" && sensedBy(p, motor, "pressureSensor", String(sensor.props.target)) && atConsumerInlet(s, sensor, demand)));
    const meanFlow = (flow: number, time: number) => flow / Math.max(1, time);
    return [
      { label: "Pressure sensor actually feeds motor speed control", ok: feedback },
      { label: "Both consumer demand phases produced distinct real flow", ok: r.lowDemandTime > 30 && r.highDemandTime > 30 && Math.abs(meanFlow(r.highDemandFlow, r.highDemandTime) - meanFlow(r.lowDemandFlow, r.lowDemandTime)) > 1e-5 },
      { label: "180 s scored; ≥90% in band; RMS ≤3.5 kPa; overshoot ≤25 kPa", ok: r.evaluated >= 180 - 1e-6 && band >= 0.9 && rms <= 3500 && r.maxOvershoot <= 25000 },
    ];
  },
  bandCredit: (band) => band,
  penalty: (r) => Math.min(5, r.responseTime / 10 + r.maxOvershoot / 25000),
  progress: ({ state }) => state.evaluated / 180,
});

export const supply = hydraulicMission({
  id: "supply", starter: (challenge) => hydraulicStarter("supply", challenge),
  number: "006", title: "Automated Water Supply", difficulty: "ADVANCED", budget: 850, economyTarget: 544,
  description: "Autonomously maintain a destination between 30% and 90% for 600 s after 120 s commissioning. Protect both inventories and survive a primary level-sensor fault at 300 s.",
  objectives: ["Use 30/90% hysteresis, source interlock and independent high-level guard", "≥95% in band after commissioning; ≤12 motor starts/stops", "Handle primary level-sensor failure without operator input", "Respect 500 W, 24 V, 2 bar and €850 limits"],
  guide: { mission: 'Keep the water flowing while a sensor goes rogue. No operator rescue allowed.', kit: 'Vessels and consumer valve are supplied. Add a powered pump, delivery line, three level sensors, hysteresis, comparators and AND gates.', hints: ['Use destination hysteresis at 30/90%. Independently check source >5% and destination <95%.', 'AND the demand and both guards into motor enable. The destination sensor feeding hysteresis is the primary sensor tested by the fault.', 'Return consumer flow to the source. Test 120 s commissioning, then 600 s of autonomous operation; the main sensor fails at 300 s.'] },
  idealEnergy: 25000, idealTime: 720, destinationElevation: 2, demand: { diameter: 0.012, opening: 35 },
  track: (s, state, dt, { destination, source }, level) => {
    const p = s.project;
    if (s.time >= 120) { state.evaluated += dt; if (level >= 30 && level <= 90.1) state.inBand += dt; }
    if (!state.faultInjected && s.time >= 300) {
      // The primary sensor is identified by its role in the learner's circuit (the destination level
      // sensor feeding a hysteresis controller), not by a starter-only name.
      const primary = p.components.filter(c => c.kind === 'hysteresis').map(c => findUpstream(p, c.id, x => x.kind === 'levelSensor' && x.props.target === destination.id)).find(Boolean);
      if (primary) { s.injectFault(primary.id, "sensorFault", true); state.faultInjected = true; }
    }
    if (level > 95.001) s.violation("Independent high-level safeguard failed (95%).");
    if ((s.hydraulicMeasurement(source.id, "level") ?? 0) < 4.9) s.violation("Source low-level protection failed (5%).");
    if (state.switches > 12) s.violation("Excessive pump cycling: more than 12 transitions.");
  },
  checks: ({ p, state: r, destination, source, motors, band }) => {
    const feedback = destination && source ? motors.some(c => sensedBy(p, c, "levelSensor", destination.id) && sensedBy(p, c, "levelSensor", source.id)) : true;
    // At least two destination level sensors, each feeding the motor's control.
    const destinationSensing = p.components.filter(c => c.kind === "levelSensor" && c.props.target === destination?.id && motors.some(m => controlledBy(p, m.id, x => x.id === c.id))).length;
    return [
      { label: "Destination feedback and source-level interlock drive motor", ok: feedback },
      { label: "Independent high-level sensing and fault exercised", ok: r.faultInjected && destinationSensing >= 2 },
      { label: "600 s scored; ≥95% in band; 2–12 switching transitions", ok: r.evaluated >= 600 - 1e-6 && band >= 0.95 && r.switches >= 2 && r.switches <= 12 },
    ];
  },
  bandCredit: (band) => band,
  progress: ({ state }) => state.evaluated / 600,
});
