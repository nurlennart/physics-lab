import type { Project } from '../model';
import type { Simulation } from '../engine';
import { challengeDefinition } from './registry';
import type { ChallengeResult } from './types';

export { challengeIds, isChallengeId, type ChallengeId } from './ids';
export { challengeDefinition, challengeList, challengeRegistry } from './registry';
export type { ChallengeDefinition, ChallengeResult, ChallengeRules, StatusPart } from './types';
export { runawayScenario, runawayState, type RunawayState } from './runaway';
export { hydraulicState, type HydraulicState } from './hydraulic';
export { mechanicalState, type MechanicalState } from './mechanical';

/** Score and checks of the running assignment, or null outside one. */
export function evaluateChallenge(p: Project, s: Simulation): ChallengeResult | null {
  if (!p.challenge) return null;
  return challengeDefinition(p.challenge).evaluate(p, s, s.challengeState);
}
