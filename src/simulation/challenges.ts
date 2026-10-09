import { projectCost, prop, type Project } from "./model";
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
interface ChallengeDefinition {
  id: "light" | "heat";
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
export const challenges: Record<"light" | "heat", ChallengeDefinition> = {
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
  const d = challenges[p.challenge],
    cost = projectCost(p),
    safe = Object.keys(s.failed).length === 0 && s.violations.length === 0;
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
