import { seriesDayWindows } from "./series-spread";

function assertPartition(
  windows: [number, number][],
  span: number,
  count: number,
) {
  expect(windows).toHaveLength(count);
  // Non-decreasing, non-overlapping, in-bounds, non-empty.
  let prevHi = -1;
  for (const [lo, hi] of windows) {
    expect(lo).toBeGreaterThanOrEqual(0);
    expect(hi).toBeLessThanOrEqual(span);
    expect(hi).toBeGreaterThanOrEqual(lo);
    expect(lo).toBeGreaterThan(prevHi);
    prevHi = hi;
  }
}

describe("seriesDayWindows — non-overlapping day buckets across [0, daySpan]", () => {
  it("count === 1 → the whole range", () => {
    expect(seriesDayWindows(10, 1)).toEqual([[0, 10]]);
  });

  it("count === totalDays (1/day, no freedom) → one day each, freedom 0", () => {
    // 9 days (span=8), 9 sessions.
    const windows = seriesDayWindows(8, 9);
    assertPartition(windows, 8, 9);
    expect(windows).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
      [5, 5],
      [6, 6],
      [7, 7],
      [8, 8],
    ]);
  });

  it("count === totalDays - 1 → all but the last bucket have freedom 0, the last has freedom 1", () => {
    // 9 days (span=8), 8 sessions: 7 buckets of size 1, last of size 2.
    const windows = seriesDayWindows(8, 8);
    assertPartition(windows, 8, 8);
    expect(windows.slice(0, 6)).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
      [5, 5],
    ]);
    expect(windows[6]).toEqual([6, 6]);
    expect(windows[7]).toEqual([7, 8]); // freedom 1
  });

  it("evenly divisible count → uniform bucket size (freedom = base - 1)", () => {
    // 9 days (span=8), 3 sessions → 3 buckets of 3 days each.
    const windows = seriesDayWindows(8, 3);
    assertPartition(windows, 8, 3);
    expect(windows).toEqual([
      [0, 2],
      [3, 5],
      [6, 8],
    ]);
  });

  it("~2/day: remainder buckets land at the END, not spread through the middle", () => {
    // 9 days (span=8), 4 sessions → base=2, remainder=1: [2,2,2,3].
    const windows = seriesDayWindows(8, 4);
    assertPartition(windows, 8, 4);
    expect(windows).toEqual([
      [0, 1],
      [2, 3],
      [4, 5],
      [6, 8], // the extra day goes to the LAST bucket
    ]);
  });

  it("~1/3 rate with a remainder → the last `remainder` buckets get the extra day", () => {
    // 11 days (span=10), 3 sessions → base=3, remainder=2: [3,4,4].
    const windows = seriesDayWindows(10, 3);
    assertPartition(windows, 10, 3);
    expect(windows).toEqual([
      [0, 2],
      [3, 6],
      [7, 10],
    ]);
  });

  it("stays a valid, in-bounds partition even when count exceeds the available days", () => {
    // 3 days (span=2), 5 sessions — more than one per day, unavoidably.
    const windows = seriesDayWindows(2, 5);
    expect(windows).toHaveLength(5);
    for (const [lo, hi] of windows) {
      expect(lo).toBeGreaterThanOrEqual(0);
      expect(hi).toBeLessThanOrEqual(2);
      expect(hi).toBeGreaterThanOrEqual(lo);
    }
    // Non-decreasing (may repeat, but never goes backwards).
    for (let i = 1; i < windows.length; i++) {
      expect(windows[i][0]).toBeGreaterThanOrEqual(windows[i - 1][0]);
    }
  });

  it("clamps a negative / fractional span to whole days from 0", () => {
    expect(seriesDayWindows(-4, 2)).toEqual([
      [0, 0],
      [0, 0],
    ]);
    expect(seriesDayWindows(4.9, 2)).toEqual([
      [0, 1],
      [2, 4],
    ]);
  });
});
