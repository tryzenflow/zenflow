import { describe, expect, it } from "vitest";
import { sittingMinutes, snapCount, splitCounts } from "../split-sittings";

describe("sittingMinutes", () => {
  it("splits evenly on the 15-minute grid", () => {
    expect(sittingMinutes(180, 2)).toEqual([90, 90]);
  });

  it("deals slots evenly, the first sittings taking the extra ones", () => {
    expect(sittingMinutes(120, 3)).toEqual([45, 45, 30]);
    expect(sittingMinutes(120, 6)).toEqual([30, 30, 15, 15, 15, 15]);
    expect(sittingMinutes(150, 4)).toEqual([45, 45, 30, 30]);
    expect(sittingMinutes(90, 4)).toEqual([30, 30, 15, 15]);
  });

  it("keeps every sitting within one slot of the others", () => {
    for (const total of [45, 90, 120, 240, 600, 3000]) {
      for (let count = 1; count <= 20; count++) {
        const parts = sittingMinutes(total, count);
        expect(Math.max(...parts) - Math.min(...parts)).toBeLessThanOrEqual(15);
      }
    }
  });

  it("always sums to the total and never drops below one slot", () => {
    for (const total of [15, 45, 90, 120, 240, 600]) {
      for (let count = 1; count <= 8; count++) {
        const parts = sittingMinutes(total, count);
        expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
        expect(Math.min(...parts)).toBeGreaterThanOrEqual(15);
      }
    }
  });

  it("returns a single sitting for a count of one", () => {
    expect(sittingMinutes(60, 1)).toEqual([60]);
  });

  it("caps the count at one sitting per slot", () => {
    expect(sittingMinutes(30, 5)).toEqual([15, 15]);
  });

  it("never returns an empty list", () => {
    expect(sittingMinutes(15, 0)).toEqual([15]);
  });
});

describe("splitCounts", () => {
  it("offers every count up to one sitting per slot", () => {
    expect(splitCounts(60, 16)).toEqual([1, 2, 3, 4]);
    expect(splitCounts(480, 4)).toEqual([1, 2, 3, 4]);
  });
});

describe("snapCount", () => {
  it("falls back to the largest valid count below the wish", () => {
    expect(snapCount([1, 2, 4], 3)).toBe(2);
    expect(snapCount([1, 2, 4], 9)).toBe(4);
    expect(snapCount([1, 2, 4], 1)).toBe(1);
  });
});
