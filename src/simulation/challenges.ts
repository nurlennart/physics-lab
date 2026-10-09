import { projectCost, prop, type Project } from "./model";
import { solveElectrical } from "./electrical";
import { challengeError } from "./integrity";
import type { Simulation } from "./engine";
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
  id: "light" | "heat" | "runaway";
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
              10 * Math.max(0, 1 - cost / 500) +
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
    ok: r.comparison === "min" ? metric(r) >= r.target : metric(r) <= r.target,
  }));
  const complete = checks.every((c) => c.ok);
  const efficiency =
    d.idealEnergy > 0 ? Math.min(1, d.idealEnergy / Math.max(1, s.energy)) : 1;
  const economy = Math.max(0, 1 - cost / d.budget),
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
  if (s.project.challenge) challenges[s.project.challenge]?.update?.(s, dt);
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
