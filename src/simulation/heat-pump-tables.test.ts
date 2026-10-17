import { describe, it, expect } from 'vitest';
import { makeComponent } from './model';
import { ratingPoints } from './heat-pump-data';
import { heatingPoint, pointCOP, speedForOutput } from './heat-pump';
import { characteristicFlow, characteristicTable, referenceTable } from './heat-pump-tables';

describe('heat pump Inspector tables', () => {
  it('computes the Bosch reference table once and matches the model', () => {
    const first = referenceTable();
    expect(referenceTable()).toBe(first);
    expect(first).toHaveLength(ratingPoints.length);
    for (const [i, r] of ratingPoints.entries())
      expect(first[i].model).toBe(pointCOP(heatingPoint(speedForOutput(r.output, r.air, r.flow), r.air, r.flow)));
  });
  it('caches the characteristic by flow, rated voltage and maximum current only', () => {
    const c = makeComponent('heatPump', 0, 0, []);
    // Telemetry-scale target changes within one displayed degree reuse the same table.
    expect(characteristicFlow(31.2)).toBe(characteristicFlow(30.6));
    const table = characteristicTable(c, characteristicFlow(31.2));
    expect(characteristicTable(c, characteristicFlow(30.6))).toBe(table);
    expect(characteristicTable({ ...c, props: { ...c.props, frostTrigger: 2, relativeHumidity: 40 } }, 31)).toBe(table);
    expect(characteristicTable(c, 45)).not.toBe(table);
    expect(characteristicTable({ ...c, props: { ...c.props, maxCurrent: 10 } }, 31)).not.toBe(table);
    expect(characteristicTable({ ...c, props: { ...c.props, ratedVoltage: 220 } }, 31)).not.toBe(table);
    expect(table.find(r => r.air === 7)!.range!.max).toBeCloseTo(heatingPoint(1, 7, 31).condenser, 6);
  });
});
