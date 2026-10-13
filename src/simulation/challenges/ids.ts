/** Mission identifiers in mission-number order. A new mission adds its id here and its definition to the registry. */
export const challengeIds = ['light', 'heat', 'runaway', 'transfer', 'pressure', 'supply', 'descent', 'lift', 'rotation'] as const;
export type ChallengeId = (typeof challengeIds)[number];
export const isChallengeId = (value: unknown): value is ChallengeId => challengeIds.includes(value as ChallengeId);
