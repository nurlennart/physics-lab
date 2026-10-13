/** Full credit at or below the reference cost `target`; linear decline to zero at the budget. */
export function economyFactor(target: number, cost: number, budget: number): number {
  return Math.max(0, Math.min(1, (budget - cost) / (budget - target)));
}
