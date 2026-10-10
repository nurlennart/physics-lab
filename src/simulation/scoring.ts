import type { ChallengeId } from './model';

/** Catalog reference builds, rounded up to euros; fixtures count toward total cost. */
export const economyTargets: Record<ChallengeId, number> = {
  light: 68,
  heat: 158,
  runaway: 293,
  transfer: 458,
  pressure: 494,
  supply: 544,
  descent: 100,
  lift: 549,
  rotation: 482,
};

/** Full credit at or below the reference cost; linear decline to zero at the budget. */
export function economyFactor(id: ChallengeId, cost: number, budget: number): number {
  return Math.max(0, Math.min(1, (budget - cost) / (budget - economyTargets[id])));
}
