import { heat, light } from './circuits';
import { runaway } from './runaway';
import { pressure, supply, transfer } from './hydraulic';
import { descent, lift, rotation } from './mechanical';
import { challengeIds, type ChallengeId } from './ids';
import type { ChallengeDefinition } from './types';

/**
 * Every scored mission. A new mission adds its id to `challengeIds` and its definition here;
 * the engine, integrity rules, editor, mission list, guidebook and score guard read it from this registry.
 */
export const challengeRegistry: Record<ChallengeId, ChallengeDefinition<any>> = { light, heat, runaway, transfer, pressure, supply, descent, lift, rotation };

export const challengeDefinition = (id: ChallengeId): ChallengeDefinition<any> => challengeRegistry[id];
/** Definitions in mission-number order. */
export const challengeList = () => challengeIds.map(challengeDefinition);
