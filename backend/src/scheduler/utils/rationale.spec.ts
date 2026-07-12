import { PREFERENCE_MATRIX_LENGTH } from "@zenflow/shared";
import { buildRationale } from "./rationale";

const TZ = "UTC";

function zeroMatrix(): number[] {
  return new Array<number>(PREFERENCE_MATRIX_LENGTH).fill(0);
}

// 2026-06-08 is a Monday (day index 0), 2026-06-09 is Tuesday (day index 1).
const MON_10 = new Date("2026-06-08T10:00:00.000Z");
const TUE_10 = new Date("2026-06-09T10:00:00.000Z");

describe("buildRationale — cold start", () => {
  it("returns null for an all-zero matrix", () => {
    expect(buildRationale(MON_10, zeroMatrix(), TZ)).toBeNull();
  });

  it("returns null for an empty matrix", () => {
    expect(buildRationale(MON_10, [], TZ)).toBeNull();
  });

  it("returns null for a wrong-length matrix", () => {
    expect(buildRationale(MON_10, [1, 2, 3], TZ)).toBeNull();
  });

  it("returns null when the matrix has signal elsewhere but nothing liked on this weekday", () => {
    const m = zeroMatrix();
    m[1 * 24 + 10] = 5; // Tuesday 10:00 liked, but chosenStart is Monday
    expect(buildRationale(MON_10, m, TZ)).toBeNull();
  });
});

describe("buildRationale — dominant-cell summary", () => {
  it("summarizes the top-scoring cell on the chosen weekday", () => {
    const m = zeroMatrix();
    m[0 * 24 + 9] = 5; // Monday 09:00 strongly liked
    const rationale = buildRationale(MON_10, m, TZ)!;
    expect(rationale).not.toBeNull();
    expect(rationale.preferredWindow).toEqual({ startMin: 540, endMin: 600 });
    expect(rationale.summary).toContain("Monday");
    expect(rationale.summary).toContain("09:00");
  });

  it("picks the highest-scoring cell when several are positive (tie-breaking by score)", () => {
    const m = zeroMatrix();
    m[0 * 24 + 9] = 2;
    m[0 * 24 + 14] = 6; // the dominant one
    const rationale = buildRationale(MON_10, m, TZ)!;
    expect(rationale.preferredWindow).toEqual({ startMin: 840, endMin: 900 });
  });

  it("only considers the weekday chosenStart falls in", () => {
    const m = zeroMatrix();
    m[0 * 24 + 9] = 1; // Monday
    m[1 * 24 + 15] = 10; // Tuesday — much higher, but wrong day
    const rationale = buildRationale(TUE_10, m, TZ)!;
    expect(rationale.preferredWindow).toEqual({ startMin: 900, endMin: 960 });
  });

  it("returns up to 3 top cells sorted descending by score", () => {
    const m = zeroMatrix();
    m[0 * 24 + 8] = 1;
    m[0 * 24 + 9] = 4;
    m[0 * 24 + 10] = 2;
    m[0 * 24 + 11] = 3;
    const rationale = buildRationale(MON_10, m, TZ)!;
    expect(rationale.topCells).toHaveLength(3);
    expect(rationale.topCells!.map((c) => c.score)).toEqual([4, 3, 2]);
  });

  it("ignores negative (disliked) cells when picking the dominant window", () => {
    const m = zeroMatrix();
    m[0 * 24 + 9] = -5; // disliked
    m[0 * 24 + 14] = 1; // mildly liked — the only positive cell
    const rationale = buildRationale(MON_10, m, TZ)!;
    expect(rationale.preferredWindow).toEqual({ startMin: 840, endMin: 900 });
  });

  it("honours the wall-clock weekday for a non-UTC timezone", () => {
    // 2026-06-08T23:00:00Z is already Tuesday in a UTC+4 zone.
    const m = zeroMatrix();
    m[1 * 24 + 3] = 5; // Tuesday 03:00 local
    const instant = new Date("2026-06-08T23:00:00.000Z");
    const rationale = buildRationale(instant, m, "Asia/Dubai")!;
    expect(rationale.preferredWindow).toEqual({ startMin: 180, endMin: 240 });
  });
});
