import { selectSeriesAlternatives } from "./series-alternatives";

const H = 3_600_000;
const D = 24 * H;
const sit = (applied: number, other: number | null, durationMinutes = 60) => ({
  durationMinutes,
  appliedStartMs: applied,
  otherStartMs: other,
});

describe("selectSeriesAlternatives", () => {
  it("keeps divergent sittings in index order, capped at max", () => {
    const sittings = Array.from({ length: 7 }, (_, i) => sit(i * D, i * D + H));
    expect(selectSeriesAlternatives(sittings, [], 5)).toEqual([0, 1, 2, 3, 4]);
  });

  it("skips sittings with no other pick or an identical one", () => {
    const sittings = [sit(0, null), sit(D, D), sit(2 * D, 2 * D + H)];
    expect(selectSeriesAlternatives(sittings, [], 5)).toEqual([2]);
  });

  it("drops an alternative overlapping another applied sitting (half-open)", () => {
    const sittings = [
      sit(0, D - 15 * 60_000), // runs 15 min into sitting 1
      sit(D, D + 2 * H),
      sit(3 * D, 2 * D - H), // ends exactly at 2d: touching is fine
    ];
    expect(selectSeriesAlternatives(sittings, [], 5)).toEqual([1, 2]);
  });

  it("ignores its own applied slot when checking overlap", () => {
    expect(selectSeriesAlternatives([sit(0, 30 * 60_000)], [], 5)).toEqual([0]);
  });

  it("drops an alternative overlapping fixedOccupied", () => {
    const sittings = [sit(0, 5 * H), sit(D, D + 5 * H)];
    const fixed = [{ start: 5 * H + 30 * 60_000, end: 6 * H }];
    expect(selectSeriesAlternatives(sittings, fixed, 5)).toEqual([1]);
  });

  it("the cap counts only kept sittings (a dropped one frees a slot)", () => {
    const sittings = [
      sit(0, D), // clashes with sitting 1
      ...Array.from({ length: 6 }, (_, k) => sit((k + 1) * D, (k + 1) * D + H)),
    ];
    expect(selectSeriesAlternatives(sittings, [], 5)).toEqual([1, 2, 3, 4, 5]);
  });
});
