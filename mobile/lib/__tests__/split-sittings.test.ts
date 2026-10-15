import { describe, expect, it } from "vitest";
import { sittingLength, sittingMinutes, snapCount, splitCounts, variedSittings } from "../split-sittings";

describe("sittingMinutes", () => {
  it("splits evenly on the 15-minute grid", () => {
    expect(sittingMinutes(180, 2)).toEqual([90, 90]);
  });

  it("keeps the total exact, giving the extra slots to the first sittings", () => {
    const parts = sittingMinutes(120, 3);
    expect(parts).toEqual([45, 45, 30]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(120);
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

describe("variedSittings", () => {
  it("varies the sittings but keeps the total", () => {
    const parts = variedSittings(480, 4);
    expect(parts).toEqual([135, 105, 135, 105]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(480);
  });

  it("is a plain split for one sitting or tiny sittings", () => {
    expect(variedSittings(60, 1)).toEqual([60]);
    expect(variedSittings(30, 2)).toEqual([15, 15]);
  });

  it("never drops below one slot and always sums to the total", () => {
    for (const [total, count] of [[90, 4], [240, 3], [600, 7], [45, 3]]) {
      const parts = variedSittings(total, count);
      expect(Math.min(...parts)).toBeGreaterThanOrEqual(15);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
    }
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

describe("sittingLength", () => {
  it("divides the total", () => {
    expect(sittingLength(480, 4)).toBe(120);
  });
});
