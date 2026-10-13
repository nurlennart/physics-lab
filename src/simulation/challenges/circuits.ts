import { economyFactor } from '../scoring';
import { projectCost, prop, type Project } from '../model';
import { challengeError } from '../integrity';
import { starter } from '../projects';
import type { Simulation } from '../engine';
import { fixturesOnly, lockedRules, standardLimits } from './common';
import { starsFor, type ChallengeDefinition } from './types';

type Requirement = {
  metric: 'lampHold' | 'peakVoltage' | 'peakPower' | 'tankTemperature' | 'safetyBudget';
  label: string;
  target: number;
  comparison: 'min' | 'max';
  volume?: number;
  initialTemperature?: number;
};
interface RequirementScoring {
  requirements: Requirement[];
  /** Progress runs from progressStart to target of the requirement with progressMetric. */
  target: number;
  progressMetric: Requirement['metric'];
  progressStart: number;
  idealEnergy: number;
  idealTime: number;
}
type RequirementMission = Omit<ChallengeDefinition, 'createState' | 'evaluate'> & RequirementScoring;

/**
 * Requirement-checked electrical and thermal assignments: every requirement must hold;
 * score 60 + 20 × energy efficiency + 10 × economy + 10 × time.
 */
function evaluateRequirements(d: RequirementMission, p: Project, s: Simulation) {
  const cost = projectCost(p),
    safe = !challengeError(p) && Object.keys(s.failed).length === 0 && s.violations.length === 0;
  const metric = (r: Requirement): number => {
    switch (r.metric) {
      case 'lampHold':
        return s.lightHold;
      case 'peakVoltage':
        return Math.max(s.peakVoltage, ...p.components.filter((c) => c.kind === 'source').map((c) => prop(c, 'voltage')), 0);
      case 'peakPower':
        return s.peakPower;
      case 'tankTemperature':
        return Math.max(0, ...p.components
          .filter((c) => c.kind === 'tank' &&
            (r.volume === undefined || Math.abs(prop(c, 'volume') - r.volume) < 1e-6) &&
            (r.initialTemperature === undefined || prop(c, 'initialTemperature') === r.initialTemperature))
          .map((c) => s.temperatures[c.id] ?? 0));
      case 'safetyBudget':
        return safe && cost <= d.budget ? 1 : 0;
    }
  };
  const checks = d.requirements.map((r) => ({ label: r.label, ok: r.comparison === 'min' ? metric(r) >= r.target - 1e-9 : metric(r) <= r.target }));
  const complete = checks.every((c) => c.ok);
  const efficiency = d.idealEnergy > 0 ? Math.min(1, d.idealEnergy / Math.max(1, s.energy)) : 1;
  const economy = economyFactor(d.economyTarget, cost, d.budget),
    time = Math.min(1, d.idealTime / Math.max(d.idealTime, s.time));
  const score = complete ? Math.round(60 + 20 * efficiency + 10 * economy + 10 * time) : 0;
  const progressRequirement = d.requirements.find((r) => r.metric === d.progressMetric)!;
  const progress = Math.max(0, Math.min(1, (metric(progressRequirement) - d.progressStart) / (d.target - d.progressStart)));
  return { progress, complete, failed: !safe, stars: starsFor(complete, score), checks, score };
}
const requirementMission = (d: RequirementMission): ChallengeDefinition => ({ ...d, createState: () => undefined, evaluate: (p, s) => evaluateRequirements(d, p, s) });

export const light = requirementMission({
  id: 'light', number: '001', title: 'First Light', difficulty: 'FOUNDATION', family: 'electrical',
  description: 'Build a closed circuit and power a lamp safely for 3 seconds.',
  objectives: ['Power a lamp continuously for 3 s', 'Supply voltage at most 12 V', 'Stay within the lamp rating and €100 budget'],
  budget: 100, economyTarget: 68,
  rules: lockedRules(12, ['source', 'resistor', 'switch', 'lamp', 'ground', 'junction', 'fuse', 'meter']),
  limits: { power: Infinity, voltage: 12 },
  guide: { mission: 'The lights are out. Build a tiny power system and bring the lamp back to life.', kit: 'Try a DC source, switch and lamp.', hints: ['A circuit needs a complete return path to its source.', 'Set the source to 12 V. Wire source → switch → lamp → source.', 'Run for at least 3 s. Spend less to improve your star rating.'] },
  scaffold: () => fixturesOnly(starter('light', true)),
  reference: () => starter('light'),
  onAdd: (c) => { if (c.kind === 'source') c.props.voltage = 12; },
  requirements: [
    { metric: 'lampHold', label: 'Power a lamp continuously for 3 s', target: 3, comparison: 'min' },
    { metric: 'peakVoltage', label: 'Supply voltage at most 12 V', target: 12, comparison: 'max' },
    { metric: 'safetyBudget', label: 'Safe components; cost at most €100', target: 1, comparison: 'min' },
  ],
  target: 3, progressMetric: 'lampHold', progressStart: 0, idealEnergy: 0, idealTime: 3,
});

export const heat = requirementMission({
  id: 'heat', number: '002', title: 'Heating Challenge', difficulty: 'INTERMEDIATE', family: 'thermal',
  description: 'Heat 10 liters of water from 20°C to 80°C with no more than 2 kW.',
  objectives: ['Heat a 10 L water tank to 80°C', 'Electrical input at most 2,000 W', 'No failures; total budget at most €180'],
  budget: 180, economyTarget: 158,
  rules: lockedRules(240, ['source', 'resistor', 'switch', 'heater', 'tank', 'ground', 'junction', 'fuse', 'meter']),
  limits: standardLimits,
  vessels: { count: 1, countError: 'This assignment requires exactly one 10 L process vessel.', matches: (c) => prop(c, 'volume') === 10 },
  guide: { mission: 'Your field kitchen needs hot water. Make every watt count.', kit: 'The 10 L vessel is supplied. Choose a source, switch and heater.', hints: ['The electrical loop powers the heater; a separate thermal link heats the water.', 'Use 240 V for the standard heater. Connect its heat port to the vessel heat port.', 'Use Advance 60 s to test quickly. The ideal heat requirement is about 2.51 MJ.'] },
  scaffold: () => fixturesOnly(starter('heat', true)),
  reference: () => starter('heat'),
  requirements: [
    { metric: 'tankTemperature', label: 'Heat 10 L from 20°C to 80°C', target: 80, comparison: 'min', volume: 10, initialTemperature: 20 },
    { metric: 'peakPower', label: 'Electrical input at most 2,000 W', target: 2000.01, comparison: 'max' },
    { metric: 'safetyBudget', label: 'Safe components; cost at most €180', target: 1, comparison: 'min' },
  ],
  target: 80, progressMetric: 'tankTemperature', progressStart: 20, idealEnergy: 2508000, idealTime: 1254,
});
