import { describe, it, expect } from "vitest";
import { niceRange, formatTick } from "./chart-axis";

describe("chart axis", () => {
  it("uses round steps that contain the data without forcing zero", () => {
    expect(niceRange([20, 21.3])).toEqual({ lo: 20, hi: 22 });
    expect(niceRange([0, 1998.6])).toEqual({ lo: 0, hi: 2000 });
    const r = niceRange([-160, 2160]);
    expect(r.lo).toBeLessThanOrEqual(-160); expect(r.hi).toBeGreaterThanOrEqual(2160);
    expect([1, 2, 2.5, 5].some((f) => Math.abs(((r.hi - r.lo) / 2) / f - 10 ** Math.round(Math.log10(((r.hi - r.lo) / 2) / f))) < 1e-9)).toBe(true);
  });
  it("handles empty and constant series", () => {
    expect(niceRange([])).toEqual({ lo: 0, hi: 1 });
    const c = niceRange([5, 5]); expect(c.lo).toBeLessThan(5); expect(c.hi).toBeGreaterThan(5);
  });
  it("labels ticks compactly", () => {
    expect(formatTick(2000, 1000)).toBe("2000");
    expect(formatTick(21.5, 0.5)).toBe("21.5");
    expect(formatTick(25000, 5000)).toBe("25k");
    expect(formatTick(0.0015, 0.0005)).toBe("0.0015");
  });
});
