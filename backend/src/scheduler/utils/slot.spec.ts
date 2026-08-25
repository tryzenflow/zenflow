import { overlapsAny } from "./slot";

describe("overlapsAny — half-open interval overlap", () => {
  const occ = [
    { start: 100, end: 200 },
    { start: 300, end: 400 },
  ];

  it("is true when the candidate overlaps one interval", () => {
    expect(overlapsAny(occ, 150, 250)).toBe(true);
  });

  it("is false in a gap between intervals", () => {
    expect(overlapsAny(occ, 200, 300)).toBe(false);
  });

  it("treats touching boundaries as non-overlapping (half-open)", () => {
    // ends exactly at an interval's start, and starts exactly at an end.
    expect(overlapsAny(occ, 50, 100)).toBe(false);
    expect(overlapsAny(occ, 400, 500)).toBe(false);
  });

  it("is true when the candidate fully contains an interval", () => {
    expect(overlapsAny(occ, 0, 1000)).toBe(true);
  });

  it("is false against an empty occupied set", () => {
    expect(overlapsAny([], 100, 200)).toBe(false);
  });
});
