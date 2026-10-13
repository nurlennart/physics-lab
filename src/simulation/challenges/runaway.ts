import { economyFactor } from "../scoring";
import { projectCost, prop, type Component, type Project } from "../model";
import { solveElectrical, type ElectricalResult } from "../electrical";
import { challengeError } from "../integrity";
import { starter } from "../projects";
import type { Simulation } from "../engine";
import { allKindsExcept, controlledBy, fixturesOnly, lockedRules, standardLimits } from "./common";
import { starsFor, type ChallengeDefinition } from "./types";

export const runawayScenario = {
  bandLow: 78,
  bandHigh: 82,
  critical: 95,
  normalHold: 240,
  coolingReductionAt: 120,
  recoveryHold: 120,
  normalCycles: 2,
  recoveryCycles: 2,
  maxSwitches: 80,
  minStability: 0.97,
  isolationHold: 30,
  protectionTimeout: 1200,
  recoveryTimeout: 1800,
  deadline: 5400,
} as const;
const S = runawayScenario;

/**
 * warmup → regulating (band reached; cooling reduced at 120 s) → fault (welded relay, coolant lost)
 * → cooldown (an independent cutoff isolated the heater) → recovery (faults cleared, manual reset)
 * → complete.
 */
export interface RunawayState {
  phase: "warmup" | "regulating" | "fault" | "cooldown" | "recovery" | "complete";
  /** Regulation time and the part of it inside 78–82 °C (s). */
  normalTime: number;
  inBand: number;
  /** In-band time since the manual reset (s); restarts when the band is left. */
  recoveryTime: number;
  faultAt: number;
  cutoffAt: number;
  maxTemperature: number;
  /** Highest excess over the band during normal operation (K). */
  overshoot: number;
  /** All relay switchings, and those caused by measured vessel feedback that changed heater power. */
  switches: number;
  automaticSwitches: number;
  recoverySwitches: number;
  faultTargets: string[];
  /** The cutoff credited with isolating the heater. */
  safetyId: string;
  reduced: boolean;
}
const initialState = (): RunawayState => ({
  phase: "warmup", normalTime: 0, inBand: 0, recoveryTime: 0, faultAt: 0, cutoffAt: 0, maxTemperature: 20,
  switches: 0, automaticSwitches: 0, recoverySwitches: 0, faultTargets: [], safetyId: "", reduced: false, overshoot: 0,
});
/** Tracking state of a running Thermal Runaway assignment. */
export const runawayState = (s: Simulation) => s.challengeState as RunawayState;

const heaterPower = (p: Project, readings: ElectricalResult["readings"]) =>
  p.components.filter((c) => c.kind === "heater").reduce((total, c) => total + (readings[c.id]?.power ?? 0), 0);
/** Whether a temperature sensor or thermostat measuring a vessel drives the relay. */
const vesselFeedback = (p: Project, relay: string) =>
  controlledBy(p, relay, (c) => ["sensor", "thermostat"].includes(c.kind) && p.components.some((x) => x.kind === "tank" && x.id === c.props.target));

/** Count relay transitions that measured vessel feedback caused and that changed heater power. */
function recordFeedbackTransitions(s: Simulation, r: RunawayState, oldContacts: Record<string, boolean>, oldHeaterPower: number) {
  if (!["warmup", "regulating", "recovery"].includes(r.phase)) return;
  const changed = Math.abs(heaterPower(s.project, s.electrical.readings) - oldHeaterPower) > 1;
  if (changed && s.project.components.some((c) => c.kind === "relay" && oldContacts[c.id] !== s.automation.contacts[c.id] && !s.faults[c.id] && vesselFeedback(s.project, c.id))) {
    r.automaticSwitches++;
    if (r.phase === "recovery") r.recoverySwitches++;
  }
}

/**
 * A tripped safety cutoff that causally isolates the heater: with every tripped cutoff hypothetically
 * closed the heater would draw power, and opening this one alone removes it (redundant series contacts
 * included). Checked by hypothetical electrical solves without changing state.
 */
function isolatingCutoff(s: Simulation): Component | undefined {
  const candidates = s.project.components.filter((c) => c.kind === "safety" && s.automation.memory[c.id]?.tripped && !s.automation.contacts[c.id]);
  if (!candidates.length) return undefined;
  const contacts = { ...s.automation.contacts, ...Object.fromEntries(candidates.map((c) => [c.id, true])) };
  const trialPower = (commands: Record<string, boolean>) =>
    heaterPower(s.project, solveElectrical(s.project, s.failed, { contacts: commands, faults: s.faults, disconnected: s.disconnected }).readings);
  try {
    const allClosed = trialPower(contacts);
    if (allClosed > 1) return candidates.find((c) => allClosed - trialPower({ ...contacts, [c.id]: false }) > 1);
  } catch {
    /* An unsolvable hypothetical circuit earns no causal isolation credit. */
  }
  return undefined;
}

function updateRunaway(s: Simulation, r: RunawayState, dt: number) {
  const p = s.project, tank = p.components.find((c) => c.kind === "tank");
  if (!tank) return;
  const t = s.temperatures[tank.id], inBand = t >= S.bandLow && t <= S.bandHigh;
  r.maxTemperature = Math.max(r.maxTemperature, t);
  if (["warmup", "regulating"].includes(r.phase) || (r.phase === "recovery" && r.recoveryTime > 0)) r.overshoot = Math.max(r.overshoot, t - S.bandHigh, 0);
  r.switches = p.components.filter((c) => c.kind === "relay").reduce((n, c) => n + (s.automation.memory[c.id]?.switches ?? 0), 0);
  if (s.time > S.deadline && r.phase !== "complete") s.violation("Assignment exceeded the 5,400 s operating deadline.");

  if (r.phase === "warmup" && inBand) {
    r.phase = "regulating";
    s.log("Challenge: operating band reached. Begin 240 s regulation.", "success");
  }
  if (r.phase === "regulating") {
    r.normalTime += dt;
    if (inBand) r.inBand += dt;
    if (!r.reduced && r.normalTime >= S.coolingReductionAt) {
      for (const c of p.components.filter((c) => c.kind === "cooler")) s.injectFault(c.id, "coolingReduced", true);
      r.reduced = true;
    }
    if (r.normalTime >= S.normalHold && r.automaticSwitches >= S.normalCycles) {
      r.phase = "fault";
      r.faultAt = s.time;
      for (const c of p.components.filter((c) => c.kind === "relay" || c.kind === "cooler")) {
        s.injectFault(c.id, c.kind === "relay" ? "stuckClosed" : "coolingFailed", true);
        r.faultTargets.push(c.id);
      }
      s.log("Challenge fault: control relay contacts welded; coolant capacity lost. Independent protection required.", "warning");
    }
  }
  if (r.phase === "fault") {
    const isolated = heaterPower(p, s.electrical.readings) < 0.01, cutoff = isolated ? isolatingCutoff(s) : undefined;
    if (cutoff) {
      r.phase = "cooldown";
      r.cutoffAt = s.time;
      r.safetyId = cutoff.id;
      s.log("Challenge: independent cutoff interrupted heater power. Hold isolation 30 s.", "success");
    } else if (s.time - r.faultAt > S.protectionTimeout) s.violation("Independent protection did not interrupt heating within 1,200 s.");
  }
  if (r.phase === "cooldown" && s.time - r.cutoffAt >= S.isolationHold) {
    for (const id of r.faultTargets) s.injectFault(id, null, true);
    r.phase = "recovery";
    s.log("Challenge: relay repaired and coolant restored. Cool below reset margin, then manually reset the independent safety latch.", "info");
  }
  if (r.phase === "recovery") {
    r.recoveryTime = s.automation.memory[r.safetyId]?.manualResets && inBand ? r.recoveryTime + dt : 0;
    if (r.recoveryTime >= S.recoveryHold && r.recoverySwitches >= S.recoveryCycles) {
      r.phase = "complete";
      s.log("Challenge: 120 s stable recovery demonstrated.", "success");
    }
    if (s.time - r.cutoffAt > S.recoveryTimeout) s.violation("Recovery exceeded 1,800 s.");
  }
}

/** Progress bar: warm-up to 35 %, regulation to 65 %, fault 65 %, cooldown 75 %, recovery 80–100 %. */
function progress(p: Project, s: Simulation, r: RunawayState) {
  switch (r.phase) {
    case "warmup": {
      const temperature = s.temperatures[p.components.find((c) => c.kind === "tank")?.id ?? ""] ?? 20;
      return Math.min(0.35, Math.max(0, ((temperature - 20) / 60) * 0.35));
    }
    case "regulating": return 0.35 + 0.3 * Math.min(1, r.normalTime / S.normalHold);
    case "fault": return 0.65;
    case "cooldown": return 0.75;
    case "recovery": return 0.8 + 0.2 * Math.min(1, r.recoveryTime / S.recoveryHold);
    default: return 1;
  }
}

/**
 * Score 50 + stability 15 (reduced by overshoot over 13 K) + energy 10 + economy 10 + time 10
 * + relay wear 5.
 */
function evaluateRunaway(p: Project, s: Simulation, r: RunawayState) {
  const cost = projectCost(p),
    safe = !challengeError(p) && s.violations.length === 0 && Object.keys(s.failed).length === 0,
    stability = r.normalTime ? r.inBand / r.normalTime : 0;
  const checks = [
    { label: "240 s regulation; at least 97% inside 78–82°C", ok: r.normalTime >= S.normalHold && stability >= S.minStability },
    { label: "Measured feedback switches heater power (≥2); at most 80 transitions", ok: r.automaticSwitches >= S.normalCycles && r.switches <= S.maxSwitches },
    { label: "Independent cutoff interrupted fault power below 95°C", ok: !!r.safetyId && r.maxTemperature < S.critical },
    { label: "Manual reset followed by 120 s regulation", ok: r.phase === "complete" && r.recoverySwitches >= S.recoveryCycles },
    { label: "Safe ratings, 2 kW limit, and €500 budget", ok: safe && s.peakPower <= 2000.01 && cost <= runaway.budget },
  ];
  const complete = checks.every((c) => c.ok);
  // Stability is weighted as 15 × stability × overshoot factor, evaluated in that order.
  const overshoot = Math.max(0, 1 - r.overshoot / 13),
    energy = Math.min(1, 2508000 / Math.max(1, s.energy)),
    economy = economyFactor(runaway.economyTarget, cost, runaway.budget),
    time = Math.min(1, 1800 / Math.max(1800, s.time)),
    wear = Math.max(0, 1 - r.switches / S.maxSwitches);
  const score = complete ? Math.round(50 + 15 * stability * overshoot + 10 * energy + 10 * economy + 10 * time + 5 * wear) : 0;
  return {
    progress: progress(p, s, r),
    complete,
    failed: !safe || (r.normalTime >= S.normalHold && stability < S.minStability),
    stars: starsFor(complete, score),
    score,
    checks,
  };
}

export const runaway: ChallengeDefinition<RunawayState> = {
  id: "runaway", number: "003", title: "Thermal Runaway", difficulty: "ADVANCED", family: "thermal",
  description: "Regulate 10 L at 78–82°C for 240 s, survive welded control contacts and loss of coolant, then manually recover for at least 120 s. Full automatic cycles must be demonstrated.",
  objectives: [
    "Wire the plant and an automatic temperature controller",
    "Regulate for ≥240 s and a full automatic switching cycle",
    "Independent cutoff must interrupt welded-relay heating",
    "Manually reset and regulate ≥120 s with a full recovery cycle",
  ],
  budget: 500, economyTarget: 293,
  rules: lockedRules(240, allKindsExcept()),
  limits: standardLimits,
  vessels: { count: 1, countError: "This assignment requires exactly one 10 L process vessel.", matches: (c) => prop(c, "volume") === 10 },
  guide: { mission: 'Your reactor has a bad day coming. Build a controller that can survive it.', kit: 'The vessel is supplied. Consider a source, relay, safety cutoff, heater, temperature sensor, hysteresis controller and cooler.', hints: ['Select the vessel as the sensor and safety-cutoff target. Regulate around 78–82 °C.', 'Put relay and independent safety cutoff in series with the heater. Connect cooler and heater to the vessel.', 'Welded relay contacts defeat ordinary control. After isolation, reset the safety latch below its reset margin, then demonstrate recovery cycles.'] },
  scaffold: () => fixturesOnly(starter("runaway", true)),
  reference: () => starter("automated"),
  /** The operator resets the tripped cutoff once the vessel has cooled to 85 °C. */
  operateReference: (s) => {
    const r = runawayState(s);
    if (r.phase !== "recovery" || !r.safetyId || s.automation.memory[r.safetyId].manualResets) return;
    const cutoff = s.project.components.find((c) => c.id === r.safetyId)!;
    if (s.temperatures[String(cutoff.props.target)] <= 85) s.resetSafety(cutoff.id);
  },
  createState: initialState,
  afterSolve: recordFeedbackTransitions,
  update: updateRunaway,
  evaluate: evaluateRunaway,
  progressLabel: (state) => `${state.phase} · `,
  liveStatus: (state) => [
    "State: ", { strong: state.phase },
    ` · Regulation ${state.normalTime.toFixed(1)}/≥240 s · Recovery ${state.recoveryTime.toFixed(1)}/≥120 s. Feedback transitions: ${state.automaticSwitches}, recovery transitions: ${state.recoverySwitches}. After the fault, select ST-01 and manually reset its safety latch once the vessel is below its reset margin.`,
  ],
};
