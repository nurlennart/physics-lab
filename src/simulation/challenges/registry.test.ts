import { describe, expect, it } from 'vitest';
import { challengeIds, challengeList, challengeRegistry } from '.';

const fsName = 'node:fs', fs = await import(/* @vite-ignore */ fsName) as { readFileSync(p: URL, e: string): string };

describe('challenge registry', () => {
  it('registers every id once, under its own id, in mission-number order', () => {
    expect(Object.keys(challengeRegistry).sort()).toEqual([...challengeIds].sort());
    for (const [key, d] of Object.entries(challengeRegistry)) expect(d.id).toBe(key);
    const numbers = challengeList().map(d => d.number);
    expect(new Set(numbers).size).toBe(numbers.length);
    expect([...numbers].sort()).toEqual(numbers);
  });
  it('keeps each economy target below its budget and three hints per guidebook', () => {
    for (const d of challengeList()) {
      expect(d.economyTarget).toBeLessThan(d.budget);
      expect(d.guide.hints).toHaveLength(3);
    }
  });
  it('has a recorded reference result for every mission (scripts/check-scores.mjs)', () => {
    const recorded = JSON.parse(fs.readFileSync(new URL('../../../validation/reference-scores.json', import.meta.url), 'utf8')).results;
    expect(Object.keys(recorded).sort()).toEqual([...challengeIds].sort());
  });
});
