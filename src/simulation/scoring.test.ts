import { describe, expect, it } from 'vitest';
import { economyFactor } from './scoring';
import { challengeList, evaluateChallenge } from './challenges';
import { starter } from './projects';
import { Simulation } from './engine';
import { makeComponent, projectCost } from './model';

function completeLight(extraSwitches = 0) {
  const p = starter('light'); p.challenge = 'light';
  for (let i = 0; i < extraSwitches; i++) p.components.push(makeComponent('switch', 0, 0, p.components));
  const s = new Simulation(p);
  // 3 s of lamp operation within its rating, counted once the filament surge has decayed (≈ 0.12 s).
  for (let i = 0; i < 200 && !evaluateChallenge(p, s)?.complete; i++) expect(s.step()).toBe(true);
  return { p, s, result: evaluateChallenge(p, s)! };
}

describe('attainable challenge economy scores', () => {
  for (const d of challengeList()) it(`${d.id} benchmarks a purchasable reference build and rewards savings`, () => {
    const cost = projectCost(d.reference());
    const target = d.economyTarget, budget = d.budget;
    expect(target).toBe(Math.ceil(cost));
    expect(target).toBeLessThan(budget);
    expect(economyFactor(target, cost, budget)).toBe(1);
    expect(economyFactor(target, 0, budget)).toBe(1);
    expect(economyFactor(target, (target + budget) / 2, budget)).toBeCloseTo(0.5);
    expect(economyFactor(target, budget, budget)).toBe(0);
    expect(economyFactor(target, budget + 10, budget)).toBe(0);
  });
  it('awards 100/100 and three stars to the standard €68 circuit after three seconds of rated operation', () => {
    const { p, s, result } = completeLight();
    expect(projectCost(p)).toBe(68);
    expect(s.time).toBeCloseTo(3.117, 3); // 3 s plus the cold-filament surge (7 steps)
    expect(result.complete).toBe(true);
    expect(result.score).toBe(100);
    expect(result.stars).toBe(3);
  });
  it('deducts economy points for unnecessary purchases and still respects the budget', () => {
    expect(completeLight(2).result.score).toBe(95);
    expect(completeLight(4).result.score).toBe(90);
    expect(() => completeLight(5)).toThrow(/budget/i);
  });
  it('does not award a score for a disconnected or failed circuit', () => {
    const open = starter('light', true), s = new Simulation(open);
    for (let i = 0; i < 180; i++) s.step();
    expect(evaluateChallenge(open, s)).toMatchObject({ complete: false, score: 0, stars: 0 });
    const valid = completeLight();
    valid.s.failed[valid.p.components.find(c => c.kind === 'lamp')!.id] = true;
    expect(evaluateChallenge(valid.p, valid.s)).toMatchObject({ complete: false, score: 0, stars: 0 });
  });
  it('keeps efficiency and time relevant after the economy target is met', () => {
    const { p, s } = completeLight();
    s.time = 6;
    expect(evaluateChallenge(p, s)!.score).toBe(95);
  });
});
