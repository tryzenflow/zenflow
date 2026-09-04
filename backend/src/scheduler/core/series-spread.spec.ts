import { clampWindowForMember, seriesDayOffsets } from "./series-spread";

describe("seriesDayOffsets — even spread across [0, daySpan]", () => {
  it("count === 1 → a single session on day 0", () => {
    expect(seriesDayOffsets(10, 1)).toEqual([0]);
  });

  it("first session on day 0, last on the deadline day", () => {
    const offsets = seriesDayOffsets(9, 3);
    expect(offsets[0]).toBe(0);
    expect(offsets[offsets.length - 1]).toBe(9);
  });

  it("spreads evenly — 3 over 9 days → every 3 days", () => {
    expect(seriesDayOffsets(9, 3)).toEqual([0, 5, 9]);
  });

  it("is non-decreasing and stays within [0, daySpan] even when tight", () => {
    const offsets = seriesDayOffsets(2, 5);
    expect(offsets).toEqual([0, 1, 1, 2, 2]);
    expect(Math.min(...offsets)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...offsets)).toBeLessThanOrEqual(2);
    for (let i = 1; i < offsets.length; i++) {
      expect(offsets[i]).toBeGreaterThanOrEqual(offsets[i - 1]);
    }
  });

  it("clamps a negative / fractional span to whole days from 0", () => {
    expect(seriesDayOffsets(-4, 3)).toEqual([0, 0, 0]);
    expect(seriesDayOffsets(4.9, 3)).toEqual([0, 2, 4]);
  });
});

describe("clampWindowForMember — ± max(1, floor(daySpan / count)) around the target (D3)", () => {
  it("gives a wide window for a sparse series", () => {
    // 4 members over 40 days → clamp = floor(40/4) = 10.
    expect(clampWindowForMember(40, 4, 10)).toEqual([0, 20]);
    expect(clampWindowForMember(40, 4, 30)).toEqual([20, 40]);
  });

  it("collapses to ±1 for a dense series", () => {
    // 30 members over 10 days → floor(10/30) = 0 → clamp = max(1, 0) = 1.
    expect(clampWindowForMember(10, 30, 5)).toEqual([4, 6]);
  });

  it("clamps the window to [0, daySpan] at the ends", () => {
    expect(clampWindowForMember(9, 3, 0)).toEqual([0, 3]);
    expect(clampWindowForMember(9, 3, 9)).toEqual([6, 9]);
  });

  it("floors a fractional span and never returns a negative bound", () => {
    expect(clampWindowForMember(4.9, 2, 0)).toEqual([0, 2]);
  });
});
