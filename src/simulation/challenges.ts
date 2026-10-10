import { economyFactor } from "./scoring";
import { projectCost, prop, type Project, type ChallengeId } from "./model";
import { solveElectrical } from "./electrical";
import { challengeError } from "./integrity";
import type { Simulation } from "./engine";
import { evaluateMechanical, updateMechanicalChallenge, mechanicalIds } from './spatial-challenges';
type Rule = {
  metric:
    | "lampHold"
    | "peakVoltage"
    | "peakPower"
    | "tankTemperature"
    | "safetyBudget";
  label: string;
  target: number;
  comparison: "min" | "max";
  volume?: number;
  initialTemperature?: number;
};
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
interface ChallengeDefinition {
  update?: (simulation: Simulation, dt: number) => void;
  id: ChallengeId;
  number: string;
  title: string;
  difficulty: string;
  description: string;
  budget: number;
  objectives: string[];
  target: number;
  rules: Rule[];
  idealEnergy: number;
  idealTime: number;
  progressMetric: "lampHold" | "tankTemperature";
  progressStart: number;
}
export const challenges: Record<string, ChallengeDefinition> = {
  descent: { id: 'descent', number: '007', title: 'Controlled Descent', difficulty: 'FOUNDATION', budget: 250, description: 'Lower a 10 kg guided load from 5 m to the 1 m landing using a passive brake. Set the brake damping before running; impact speed must stay below 0.6 m/s.', objectives: ['Land at 1.00 ±0.08 m and rest for 3 s', 'Impact ≤0.6 m/s; braking heat ≤500 J', 'Complete within 120 s and €250'], target: 1, rules: [], idealEnergy: 400, idealTime: 15, progressMetric: 'lampHold', progressStart: 0 },
  lift: { id: 'lift', number: '008', title: 'Motorized Lift', difficulty: 'INTERMEDIATE', budget: 900, description: 'Wire a 48 V motor and position feedback to raise a 10 kg load by 2 m through a real rack transmission. Tune the PI controller to hold the target safely.', objectives: ['Wire source, shared rotor shaft and position feedback', 'Lift to 3.00 ±0.08 m and hold for 3 s', 'Respect 48 V, 2 kW, €900 and 120 s limits'], target: 3, rules: [], idealEnergy: 500, idealTime: 15, progressMetric: 'lampHold', progressStart: 0 },
  rotation: { id: 'rotation', number: '009', title: 'Rotational Control', difficulty: 'ADVANCED', budget: 750, description: 'Wire closed-loop speed control for 1,200 RPM while a physical shaft load alternates between 0.4 and 1.2 N·m every 15 s.', objectives: ['Use motor, spatial rotor, speed sensor and controller', 'After 10 s startup, regulate for 60 s: ≥95% within ±60 RPM', 'RMS ≤60 RPM; 48 V, 2 kW, €750 limits'], target: 1200, rules: [], idealEnergy: 8000, idealTime: 70, progressMetric: 'lampHold', progressStart: 0 },
  transfer: {
    id: "transfer", number: "004", title: "Water Transfer", difficulty: "INTERMEDIATE", budget: 650,
    description: "Transfer 100 L from the finite 150 L source into a tank elevated by 2 m. Build and power the shaft-driven hydraulic circuit within 300 s.",
    objectives: ["Deliver ≥100 L through a real hydraulic network", "Stay below 500 W, 24 V and 2 bar", "Finish in 300 s without overflow or dry run"],
    target: 100, rules: [], idealEnergy: 12000, idealTime: 180, progressMetric: "lampHold", progressStart: 0,
  },
  pressure: {
    id: "pressure", number: "005", title: "Pressure Control", difficulty: "ADVANCED", budget: 750,
    description: "Maintain 0.35 bar at the delivery pipe outlet for 180 s after 15 s startup. Consumer valve demand alternates between 40% and 80% every 60 s.",
    objectives: ["Wire pressure feedback and numeric speed control", "Stay within ±10% for ≥90% of the scored interval", "RMS error ≤3.5 kPa; no overshoot above 0.6 bar", "500 W, 24 V, 2 bar and €750 limits"],
    target: 180, rules: [], idealEnergy: 15000, idealTime: 195, progressMetric: "lampHold", progressStart: 0,
  },
  supply: {
    id: "supply", number: "006", title: "Automated Water Supply", difficulty: "ADVANCED", budget: 850,
    description: "Autonomously maintain a destination between 30% and 90% for 600 s after 120 s commissioning. Protect both inventories and survive a primary level-sensor fault at 300 s.",
    objectives: ["Use 30/90% hysteresis, source interlock and independent high-level guard", "≥95% in band after commissioning; ≤12 motor starts/stops", "Handle primary level-sensor failure without operator input", "Respect 500 W, 24 V, 2 bar and €850 limits"],
    target: 600, rules: [], idealEnergy: 25000, idealTime: 720, progressMetric: "lampHold", progressStart: 0,
  },
  runaway: {
    update: updateRunaway,
    id: "runaway",
    number: "003",
    title: "Thermal Runaway",
    difficulty: "ADVANCED",
    description:
      "Regulate 10 L at 78–82°C for 240 s, survive welded control contacts and loss of coolant, then manually recover for at least 120 s. Full automatic cycles must be demonstrated.",
    budget: 500,
    objectives: [
      "Wire the plant and an automatic temperature controller",
      "Regulate for ≥240 s and a full automatic switching cycle",
      "Independent cutoff must interrupt welded-relay heating",
      "Manually reset and regulate ≥120 s with a full recovery cycle",
    ],
    target: 80,
    rules: [],
    idealEnergy: 2508000,
    idealTime: 1800,
    progressMetric: "tankTemperature",
    progressStart: 20,
  },
  light: {
    id: "light",
    number: "001",
    title: "First Light",
    difficulty: "FOUNDATION",
    description:
      "Build a closed circuit and power a lamp safely for 3 seconds.",
    budget: 100,
    objectives: [
      "Power a lamp continuously for 3 s",
      "Supply voltage at most 12 V",
      "Stay within the lamp rating and €100 budget",
    ],
    target: 3,
    rules: [
      {
        metric: "lampHold",
        label: "Power a lamp continuously for 3 s",
        target: 3,
        comparison: "min",
      },
      {
        metric: "peakVoltage",
        label: "Supply voltage at most 12 V",
        target: 12,
        comparison: "max",
      },
      {
        metric: "safetyBudget",
        label: "Safe components; cost at most €100",
        target: 1,
        comparison: "min",
      },
    ],
    idealEnergy: 0,
    idealTime: 3,
    progressMetric: "lampHold",
    progressStart: 0,
  },
  heat: {
    id: "heat",
    number: "002",
    title: "Heating Challenge",
    difficulty: "INTERMEDIATE",
    description:
      "Heat 10 liters of water from 20°C to 80°C with no more than 2 kW.",
    budget: 180,
    objectives: [
      "Heat a 10 L water tank to 80°C",
      "Electrical input at most 2,000 W",
      "No failures; total budget at most €180",
    ],
    target: 80,
    rules: [
      {
        metric: "tankTemperature",
        label: "Heat 10 L from 20°C to 80°C",
        target: 80,
        comparison: "min",
        volume: 10,
        initialTemperature: 20,
      },
      {
        metric: "peakPower",
        label: "Electrical input at most 2,000 W",
        target: 2000.01,
        comparison: "max",
      },
      {
        metric: "safetyBudget",
        label: "Safe components; cost at most €180",
        target: 1,
        comparison: "min",
      },
    ],
    idealEnergy: 2508000,
    idealTime: 1254,
    progressMetric: "tankTemperature",
    progressStart: 20,
  },
};
export interface ChallengeResult {
  progress: number;
  complete: boolean;
  failed: boolean;
  stars: number;
  checks: { label: string; ok: boolean }[];
  score: number;
}
export function evaluateChallenge(
  p: Project,
  s: Simulation,
): ChallengeResult | null {
  if (!p.challenge) return null;
  if (mechanicalIds.includes(p.challenge as typeof mechanicalIds[number])) return evaluateMechanical(p, s);
  if (["transfer", "pressure", "supply"].includes(p.challenge)) return evaluateHydraulic(p, s);
  if (p.challenge === "runaway") {
    const r = s.runaway,
      cost = projectCost(p),
      safe =
        !challengeError(p) &&
        s.violations.length === 0 &&
        Object.keys(s.failed).length === 0,
      stability = r.normalTime ? r.inBand / r.normalTime : 0;
    const checks = [
      {
        label: "240 s regulation; at least 97% inside 78–82°C",
        ok:
          r.normalTime >= runawayScenario.normalHold &&
          stability >= runawayScenario.minStability,
      },
      {
        label:
          "Measured feedback switches heater power (≥2); at most 80 transitions",
        ok:
          r.automaticSwitches >= runawayScenario.normalCycles &&
          r.switches <= runawayScenario.maxSwitches,
      },
      {
        label: "Independent cutoff interrupted fault power below 95°C",
        ok: !!r.safetyId && r.maxTemperature < runawayScenario.critical,
      },
      {
        label: "Manual reset followed by 120 s regulation",
        ok:
          r.phase === "complete" &&
          r.recoverySwitches >= runawayScenario.recoveryCycles,
      },
      {
        label: "Safe ratings, 2 kW limit, and €500 budget",
        ok: safe && s.peakPower <= 2000.01 && cost <= 500,
      },
    ];
    const complete = checks.every((c) => c.ok),
      score = complete
        ? Math.round(
            50 +
              15 * stability * Math.max(0, 1 - r.overshoot / 13) +
              10 * Math.min(1, 2508000 / Math.max(1, s.energy)) +
              10 * economyFactor("runaway", cost, 500) +
              10 * Math.min(1, 1800 / Math.max(1800, s.time)) +
              5 * Math.max(0, 1 - r.switches / runawayScenario.maxSwitches),
          )
        : 0;
    return {
      progress:
        r.phase === "warmup"
          ? Math.min(
              0.35,
              Math.max(
                0,
                (((s.temperatures[
                  p.components.find((c) => c.kind === "tank")?.id ?? ""
                ] ?? 20) -
                  20) /
                  60) *
                  0.35,
              ),
            )
          : r.phase === "regulating"
            ? 0.35 +
              0.3 * Math.min(1, r.normalTime / runawayScenario.normalHold)
            : r.phase === "fault"
              ? 0.65
              : r.phase === "cooldown"
                ? 0.75
                : r.phase === "recovery"
                  ? 0.8 +
                    0.2 *
                      Math.min(1, r.recoveryTime / runawayScenario.recoveryHold)
                  : 1,
      complete,
      failed:
        !safe ||
        (r.normalTime >= runawayScenario.normalHold &&
          stability < runawayScenario.minStability),
      stars: complete ? (score >= 90 ? 3 : score >= 80 ? 2 : 1) : 0,
      score,
      checks,
    };
  }
  const d = challenges[p.challenge],
    cost = projectCost(p),
    safe =
      !challengeError(p) &&
      Object.keys(s.failed).length === 0 &&
      s.violations.length === 0;
  const metric = (r: Rule): number => {
    switch (r.metric) {
      case "lampHold":
        return s.lightHold;
      case "peakVoltage":
        return Math.max(
          s.peakVoltage,
          ...p.components
            .filter((c) => c.kind === "source")
            .map((c) => prop(c, "voltage")),
          0,
        );
      case "peakPower":
        return s.peakPower;
      case "tankTemperature":
        return Math.max(
          0,
          ...p.components
            .filter(
              (c) =>
                c.kind === "tank" &&
                (r.volume === undefined ||
                  Math.abs(prop(c, "volume") - r.volume) < 1e-6) &&
                (r.initialTemperature === undefined ||
                  prop(c, "initialTemperature") === r.initialTemperature),
            )
            .map((c) => s.temperatures[c.id] ?? 0),
        );
      case "safetyBudget":
        return safe && cost <= d.budget ? 1 : 0;
    }
  };
  const checks = d.rules.map((r) => ({
    label: r.label,
    ok: r.comparison === "min" ? metric(r) >= r.target - 1e-9 : metric(r) <= r.target,
  }));
  const complete = checks.every((c) => c.ok);
  const efficiency =
    d.idealEnergy > 0 ? Math.min(1, d.idealEnergy / Math.max(1, s.energy)) : 1;
  const economy = economyFactor(p.challenge, cost, d.budget),
    time = Math.min(1, d.idealTime / Math.max(d.idealTime, s.time));
  const score = complete
    ? Math.round(60 + 20 * efficiency + 10 * economy + 10 * time)
    : 0;
  const progressRule = d.rules.find((r) => r.metric === d.progressMetric)!;
  const progress = Math.max(
    0,
    Math.min(
      1,
      (metric(progressRule) - d.progressStart) / (d.target - d.progressStart),
    ),
  );
  return {
    progress,
    complete,
    failed: !safe,
    stars: complete ? (score >= 90 ? 3 : score >= 80 ? 2 : 1) : 0,
    checks,
    score,
  };
}

export function updateScenario(s: Simulation, dt: number) {
  if (s.project.challenge && mechanicalIds.includes(s.project.challenge as typeof mechanicalIds[number])) { updateMechanicalChallenge(s, dt); return; }
  if (s.project.challenge && ["transfer", "pressure", "supply"].includes(s.project.challenge)) updateHydraulic(s, dt);
  else if (s.project.challenge) challenges[s.project.challenge]?.update?.(s, dt);
}
export function recordFeedbackTransitions(
  s: Simulation,
  oldContacts: Record<string, boolean>,
  oldHeaterPower: number,
) {
  if (
    s.project.challenge === "runaway" &&
    ["warmup", "regulating", "recovery"].includes(s.runaway.phase)
  ) {
    const heaterPower = s.project.components
      .filter((c) => c.kind === "heater")
      .reduce((n, c) => n + (s.electrical.readings[c.id]?.power ?? 0), 0);
    const feedback = (id: string, seen = new Set<string>()): boolean => {
      if (seen.has(id)) return false;
      seen.add(id);
      const c = s.project.components.find((c) => c.id === id);
      if (!c) return false;
      if (
        ["sensor", "thermostat"].includes(c.kind) &&
        s.project.components.some(
          (x) => x.kind === "tank" && x.id === c.props.target,
        )
      )
        return true;
      return s.project.connections
        .filter((w) => w.domain === "control" && w.to.component === id)
        .some((w) => feedback(w.from.component, seen));
    };
    if (
      Math.abs(heaterPower - oldHeaterPower) > 1 &&
      s.project.components.some(
        (c) =>
          c.kind === "relay" &&
          oldContacts[c.id] !== s.automation.contacts[c.id] &&
          !s.faults[c.id] &&
          feedback(c.id),
      )
    ) {
      s.runaway.automaticSwitches++;
      if (s.runaway.phase === "recovery") s.runaway.recoverySwitches++;
    }
  }
}
function updateRunaway(s: Simulation, dt: number) {
  const r = s.runaway,
    tank = s.project.components.find((c) => c.kind === "tank");
  if (!tank) return;
  const t = s.temperatures[tank.id],
    inBand = t >= runawayScenario.bandLow && t <= runawayScenario.bandHigh;
  r.maxTemperature = Math.max(r.maxTemperature, t);
  if (
    ["warmup", "regulating"].includes(r.phase) ||
    (r.phase === "recovery" && r.recoveryTime > 0)
  )
    r.overshoot = Math.max(r.overshoot, t - runawayScenario.bandHigh, 0);
  r.switches = s.project.components
    .filter((c) => c.kind === "relay")
    .reduce((n, c) => n + (s.automation.memory[c.id]?.switches ?? 0), 0);
  if (s.time > runawayScenario.deadline && r.phase !== "complete")
    s.violation("Assignment exceeded the 5,400 s operating deadline.");
  if (r.phase === "warmup" && inBand) {
    r.phase = "regulating";
    s.log(
      "Challenge: operating band reached. Begin 240 s regulation.",
      "success",
    );
  }
  if (r.phase === "regulating") {
    r.normalTime += dt;
    if (inBand) r.inBand += dt;
    if (!r.reduced && r.normalTime >= runawayScenario.coolingReductionAt) {
      for (const c of s.project.components.filter((c) => c.kind === "cooler"))
        s.injectFault(c.id, "coolingReduced", true);
      r.reduced = true;
    }
    if (
      r.normalTime >= runawayScenario.normalHold &&
      r.automaticSwitches >= runawayScenario.normalCycles
    ) {
      r.phase = "fault";
      r.faultAt = s.time;
      for (const c of s.project.components.filter(
        (c) => c.kind === "relay" || c.kind === "cooler",
      )) {
        s.injectFault(
          c.id,
          c.kind === "relay" ? "stuckClosed" : "coolingFailed",
          true,
        );
        r.faultTargets.push(c.id);
      }
      s.log(
        "Challenge fault: control relay contacts welded; coolant capacity lost. Independent protection required.",
        "warning",
      );
    }
  }
  if (r.phase === "fault") {
    const heaterPower = s.project.components
      .filter((c) => c.kind === "heater")
      .reduce(
        (total, c) => total + (s.electrical.readings[c.id]?.power ?? 0),
        0,
      );
    // Check causal electrical isolation, including redundant tripped contacts in series.
    const candidates = s.project.components.filter(
      (c) =>
        c.kind === "safety" &&
        s.automation.memory[c.id]?.tripped &&
        !s.automation.contacts[c.id],
    );
    let cutoff: (typeof candidates)[number] | undefined;
    if (heaterPower < 0.01 && candidates.length) {
      const contacts = {
        ...s.automation.contacts,
        ...Object.fromEntries(candidates.map((c) => [c.id, true])),
      };
      const trialPower = (commands: Record<string, boolean>) => {
        const result = solveElectrical(s.project, s.failed, {
          contacts: commands,
          faults: s.faults,
          disconnected: s.disconnected,
        });
        return s.project.components
          .filter((c) => c.kind === "heater")
          .reduce((total, c) => total + (result.readings[c.id]?.power ?? 0), 0);
      };
      try {
        const allClosed = trialPower(contacts);
        if (allClosed > 1)
          cutoff = candidates.find(
            (c) => allClosed - trialPower({ ...contacts, [c.id]: false }) > 1,
          );
      } catch {
        /* An unsolvable hypothetical circuit earns no causal isolation credit. */
      }
    }
    if (cutoff && heaterPower < 0.01) {
      r.phase = "cooldown";
      r.cutoffAt = s.time;
      r.safetyId = cutoff.id;
      s.log(
        "Challenge: independent cutoff interrupted heater power. Hold isolation 30 s.",
        "success",
      );
    } else if (s.time - r.faultAt > runawayScenario.protectionTimeout)
      s.violation(
        "Independent protection did not interrupt heating within 1,200 s.",
      );
  }
  if (
    r.phase === "cooldown" &&
    s.time - r.cutoffAt >= runawayScenario.isolationHold
  ) {
    for (const id of r.faultTargets) s.injectFault(id, null, true);
    r.phase = "recovery";
    s.log(
      "Challenge: relay repaired and coolant restored. Cool below reset margin, then manually reset the independent safety latch.",
      "info",
    );
  }
  if (r.phase === "recovery") {
    if (s.automation.memory[r.safetyId]?.manualResets && inBand)
      r.recoveryTime += dt;
    else r.recoveryTime = 0;
    if (
      r.recoveryTime >= runawayScenario.recoveryHold &&
      r.recoverySwitches >= runawayScenario.recoveryCycles
    ) {
      r.phase = "complete";
      s.log("Challenge: 120 s stable recovery demonstrated.", "success");
    }
    if (s.time - r.cutoffAt > runawayScenario.recoveryTimeout)
      s.violation("Recovery exceeded 1,800 s.");
  }
}

function hydraulicFeedback(p: Project, actuator: string, kinds: string[], target: string, seen = new Set<string>()): boolean {
  if (seen.has(actuator)) return false;
  seen.add(actuator);
  const c = p.components.find(c => c.id === actuator);
  if (c && kinds.includes(c.kind) && c.props.target === target) return true;
  return p.connections.filter(w => w.domain === "control" && w.to.component === actuator).some(w => hydraulicFeedback(p, w.from.component, kinds, target, seen));
}
function updateHydraulic(s: Simulation, dt: number) {
  const p = s.project, state = s.hydraulicChallenge, destination = p.components.find(c => c.kind === "tank" && c.name === "Destination tank"), source = p.components.find(c => c.name === "Source reservoir");
  if (!destination || !source) return;
  const level = s.hydraulicMeasurement(destination.id, "level") ?? 0;
  const motor = p.components.find(c => c.kind === "motor"), on = !!motor && Math.abs(s.multiphysics.motors[motor.id]?.current ?? 0) > 0.1;
  if (on !== state.previousOn) { state.switches++; state.previousOn = on; }
  for (const r of Object.values(s.multiphysics.hydraulic.readings)) if (Math.max(r.pressure, r.inletPressure) > 200000) s.violation("Assignment pressure limit exceeded: 2 bar.");
  if (s.peakPower > 500.001) s.violation("Assignment electrical input exceeds 500 W.");
  if (p.challenge === "transfer" && s.time > 300) s.violation("Water transfer exceeded 300 s deadline.");
  // Full tanks now spill over their rim instead of silently blocking inflow; any spill is lost water.
  for (const tank of p.components.filter(c => c.kind === "tank"))
    if ((s.multiphysics.overflowed[tank.id] ?? 0) > 0) s.violation(`${tank.name} overflowed: water was lost over the rim. Add level control or protection.`);
  if (p.challenge === "pressure" && s.time >= 15) {
    const demand = p.components.find(c => c.name === "Consumer demand")!, nodes = s.multiphysics.hydraulic.terminalNodes;
    const sensor = p.components.find(c => c.kind === "pressureSensor" && (nodes[`${c.props.target}:outlet`] ?? nodes[`${c.props.target}:fluid`]) === nodes[`${demand.id}:inlet`]), measured = sensor ? s.automation.sensors[sensor.id] : undefined;
    const pressure = measured?.valid ? Number(measured.value) : 0, error = pressure - 35000;
    state.evaluated += dt; state.squaredError += error * error * dt;
    const demandFlow = Math.abs(s.multiphysics.hydraulic.readings[demand.id]?.flow ?? 0);
    if (Math.floor((s.time - dt) / 60) % 2) { state.highDemandFlow += demandFlow * dt; state.highDemandTime += dt; }
    else { state.lowDemandFlow += demandFlow * dt; state.lowDemandTime += dt; }
    state.maxOvershoot = Math.max(state.maxOvershoot, pressure - 35000);
    if (Math.abs(error) <= 3500) state.inBand += dt;
    const phaseTime = s.time % 60;
    if (phaseTime < dt * 1.5) state.settledAt = 0;
    if (Math.abs(error) <= 3500 && !state.settledAt) { state.settledAt = s.time; state.responseTime = Math.max(state.responseTime, phaseTime); }
  }
  if (p.challenge === "supply") {
    if (s.time >= 120) { state.evaluated += dt; if (level >= 30 && level <= 90.1) state.inBand += dt; }
    if (!state.faultInjected && s.time >= 300) {
      // Identify the primary sensor by its role in the learner's circuit, not a starter-only name.
      const upstream = (id: string, seen = new Set<string>()): typeof p.components[number] | undefined => {
        if (seen.has(id)) return;
        seen.add(id);
        const c = p.components.find(c => c.id === id);
        if (c?.kind === 'levelSensor' && c.props.target === destination.id) return c;
        for (const w of p.connections.filter(w => w.domain === 'control' && w.to.component === id)) {
          const sensor = upstream(w.from.component, seen);
          if (sensor) return sensor;
        }
      };
      const primary = p.components.filter(c => c.kind === 'hysteresis').map(c => upstream(c.id)).find(Boolean);
      if (primary) { s.injectFault(primary.id, "sensorFault", true); state.faultInjected = true; }
    }
    if (level > 95.001) s.violation("Independent high-level safeguard failed (95%).");
    if ((s.hydraulicMeasurement(source.id, "level") ?? 0) < 4.9) s.violation("Source low-level protection failed (5%).");
    if (state.switches > 12) s.violation("Excessive pump cycling: more than 12 transitions.");
  }
}
function evaluateHydraulic(p: Project, s: Simulation): ChallengeResult {
  const kind = p.challenge!, d = challenges[kind], r = s.hydraulicChallenge;
  const destination = p.components.find(c => c.kind === "tank" && c.name === "Destination tank"), source = p.components.find(c => c.name === "Source reservoir");
  const delivered = destination ? (s.multiphysics.tanks[destination.id]?.volume ?? 0) * 1000 : 0;
  const safe = !challengeError(p) && !s.error && !s.violations.length && !Object.keys(s.failed).length && Math.abs(s.multiphysics.massResidual) < 1e-6;
  const motors = p.components.filter(c => c.kind === "motor");
  const working = motors.some(c => s.componentEnergy[c.id] > 1) && s.multiphysics.pumpWork > 1 && delivered > 0;
  const feedback = kind === "pressure" ? motors.some(c => p.components.some(sensor => sensor.kind === "pressureSensor" && hydraulicFeedback(p, c.id, ["pressureSensor"], String(sensor.props.target)) && (() => {
      const nodes = s.multiphysics.hydraulic.terminalNodes, demand = p.components.find(c => c.name === "Consumer demand");
      return demand && (nodes[`${sensor.props.target}:outlet`] ?? nodes[`${sensor.props.target}:fluid`]) === nodes[`${demand.id}:inlet`];
    })())) : kind === "supply" && destination && source ? motors.some(c => hydraulicFeedback(p, c.id, ["levelSensor"], destination.id) && hydraulicFeedback(p, c.id, ["levelSensor"], source.id)) : true;
  const band = r.evaluated ? r.inBand / r.evaluated : 0;
  const rms = r.evaluated ? Math.sqrt(r.squaredError / r.evaluated) : Infinity;
  const checks = [
    { label: "Powered motor, shared pump shaft and physically transferred water", ok: working },
    { label: "Valid configuration; safe inventory, pressure, power and budget", ok: safe },
    ...(kind === "transfer" ? [{ label: "At least 100 L delivered within 300 s", ok: delivered >= 100 - 1e-6 && s.time <= 300 }] : kind === "pressure" ? [
      { label: "Pressure sensor actually feeds motor speed control", ok: !!feedback },
      { label: "Both consumer demand phases produced distinct real flow", ok: r.lowDemandTime > 30 && r.highDemandTime > 30 && Math.abs(r.highDemandFlow / Math.max(1, r.highDemandTime) - r.lowDemandFlow / Math.max(1, r.lowDemandTime)) > 1e-5 },
      { label: "180 s scored; ≥90% in band; RMS ≤3.5 kPa; overshoot ≤25 kPa", ok: r.evaluated >= 180 - 1e-6 && band >= 0.9 && rms <= 3500 && r.maxOvershoot <= 25000 },
    ] : [
      { label: "Destination feedback and source-level interlock drive motor", ok: !!feedback },
      { label: "Independent high-level sensing and fault exercised", ok: r.faultInjected && p.components.filter(c => c.kind === "levelSensor" && c.props.target === destination?.id && motors.some(m => (() => {
        const visit = (id: string, seen = new Set<string>()): boolean => { if (id === c.id) return true; if (seen.has(id)) return false; seen.add(id); return p.connections.filter(w => w.domain === "control" && w.to.component === id).some(w => visit(w.from.component, seen)); };
        return visit(m.id);
      })())).length >= 2 },
      { label: "600 s scored; ≥95% in band; 2–12 switching transitions", ok: r.evaluated >= 600 - 1e-6 && band >= 0.95 && r.switches >= 2 && r.switches <= 12 },
    ]),
  ];
  const complete = checks.every(c => c.ok), cost = projectCost(p);
  const score = complete ? Math.round(55 + 15 * Math.min(1, d.idealEnergy / Math.max(1, s.suppliedEnergy)) + 10 * economyFactor(p.challenge!, cost, d.budget) + 10 * Math.min(1, d.idealTime / Math.max(d.idealTime, s.time)) + 10 * (kind === "transfer" ? 1 : band) - (kind === "pressure" ? Math.min(5, r.responseTime / 10 + r.maxOvershoot / 25000) : 0)) : 0;
  return { checks, complete, failed: !safe, score, stars: complete ? score >= 90 ? 3 : score >= 80 ? 2 : 1 : 0, progress: Math.min(1, kind === "transfer" ? delivered / 100 : r.evaluated / (kind === "pressure" ? 180 : 600)) };
}
