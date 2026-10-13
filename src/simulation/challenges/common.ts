import { definitions, type Component, type Project } from '../model';
import type { ChallengeRules } from './types';

/** Keep the assignment environment of a working build, but let the learner choose and place equipment. */
export function fixturesOnly(p: Project): Project {
  p.components = p.components.filter(c => c.kind === 'tank' || c.kind === 'rigidBody' || c.name === 'Consumer demand' || c.name === 'Variable shaft load');
  p.connections = [];
  const ids = new Set(p.components.map(c => c.id));
  p.probes = p.probes?.filter(probe => ids.has(probe.component));
  return p;
}

/** Ambient and initial temperature locked at 20 °C. */
export const lockedRules = (maxVoltage: number, allowed: readonly string[]): ChallengeRules => ({ ambient: 20, initial: 20, maxVoltage, allowed });
/** Every catalog kind except the listed ones. */
export const allKindsExcept = (...excluded: string[]) => Object.keys(definitions).filter(k => !excluded.includes(k));
/** Standard 2 kW engine limit (with 0.01 W tolerance). */
export const standardLimits = { power: 2000.01 };

/**
 * Depth-first search from `start` upstream along control wires (signal sources of each input, in wiring
 * order) for the first component, `start` included, that satisfies `match`.
 */
export function findUpstream(p: Project, start: string, match: (c: Component) => boolean, seen = new Set<string>()): Component | undefined {
  if (seen.has(start)) return undefined;
  seen.add(start);
  const c = p.components.find(c => c.id === start);
  if (c && match(c)) return c;
  for (const w of p.connections.filter(w => w.domain === 'control' && w.to.component === start)) {
    const found = findUpstream(p, w.from.component, match, seen);
    if (found) return found;
  }
  return undefined;
}
/** Whether a component satisfying `match` feeds `start` through control wiring (or is `start`). */
export const controlledBy = (p: Project, start: string, match: (c: Component) => boolean) => !!findUpstream(p, start, match);
