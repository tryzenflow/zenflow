import { bestFreeSlot, slotPreferenceScore } from "./slot-score";
import { matrixIndex } from "./preference";
import { Interval } from "./slot";

const TZ = "UTC";
// 2026-06-15T00:00:00Z is a Monday (isoWeekday 1); 2026-06-16 is the Tuesday.
const MONDAY = "2026-06-15";
const TUESDAY = "2026-06-16";
const ZERO_MATRIX = new Array<number>(168).fill(0);

/** All-zero matrix except one flagged cell, so preference is unambiguous. */
function matrixWithPeak(
  isoWeekdayNum: number,
  hour: number,
  value = 1,
): number[] {
  const matrix = new Array<number>(168).fill(0);
  matrix[matrixIndex(isoWeekdayNum, hour)] = value;
  return matrix;
}

const at = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00.000Z`);

describe("bestFreeSlot — best-fit-by-preference search", () => {
  it("picks the highest-preference free slot", () => {
    const start = bestFreeSlot(
      60,
      [],
      at(MONDAY, "08:00"),
      at(MONDAY, "12:00"),
      matrixWithPeak(1, 9, 1),
      TZ,
    );
    expect(start?.toISOString()).toBe(`${MONDAY}T09:00:00.000Z`);
  });

  it("avoids an occupied interval and falls back to the earliest free slot", () => {
    const occupied: Interval[] = [
      {
        start: at(MONDAY, "09:00").getTime(),
        end: at(MONDAY, "10:00").getTime(),
      },
    ];
    const start = bestFreeSlot(
      60,
      occupied,
      at(MONDAY, "08:00"),
      at(MONDAY, "11:00"),
      matrixWithPeak(1, 9, 1),
      TZ,
    );
    // The preferred 09:00 slot is occupied; earliest zero-score slot wins.
    expect(start?.toISOString()).toBe(`${MONDAY}T08:00:00.000Z`);
  });

  it("returns null when nothing free fits before the window end", () => {
    const start = bestFreeSlot(
      60,
      [],
      at(MONDAY, "08:00"),
      at(MONDAY, "08:30"),
      ZERO_MATRIX,
      TZ,
    );
    expect(start).toBeNull();
  });

  it("earliest start wins when preference scores tie", () => {
    const start = bestFreeSlot(
      30,
      [],
      at(MONDAY, "08:00"),
      at(MONDAY, "10:00"),
      ZERO_MATRIX,
      TZ,
    );
    expect(start?.toISOString()).toBe(`${MONDAY}T08:00:00.000Z`);
  });
});

describe("regression — hour-bucket double-scoring bug (bestFreeSlot loop bound)", () => {
  it("an hour-aligned 60-minute session is scored only on its own start-hour bucket, not the following hour", () => {
    // 09:00 bucket strongly preferred; 10:00 bucket strongly disfavored. A
    // 09:00-10:00 candidate must be scored using ONLY the 09:00 bucket — if
    // the buggy `<=` loop bound leaked the 10:00 bucket's score in, the
    // negative 10:00 score would drag 09:00 below a neutral candidate.
    const matrix = new Array<number>(168).fill(0);
    matrix[matrixIndex(1, 9)] = 10; // Monday 09:00 — highly preferred
    matrix[matrixIndex(1, 10)] = -10; // Monday 10:00 — highly disfavored
    matrix[matrixIndex(1, 12)] = 1; // Monday 12:00 — mildly preferred

    const start = bestFreeSlot(
      60,
      [],
      at(MONDAY, "09:00"),
      at(MONDAY, "13:00"),
      matrix,
      TZ,
    );
    // 09:00 scores 10 (its own bucket only); 12:00 scores 1. 09:00 must win.
    expect(start?.toISOString()).toBe(`${MONDAY}T09:00:00.000Z`);
  });
});

describe("bestFreeSlot — cross-midnight fit window", () => {
  const midnight = at(TUESDAY, "00:00");
  const start20 = at(MONDAY, "20:00");

  it("lets a task start before midnight and finish after it when fitWindowEnd is later", () => {
    const start = bestFreeSlot(
      90,
      [],
      at(MONDAY, "23:00"),
      midnight, // latest legal START = this day's 24:00
      ZERO_MATRIX,
      TZ,
      at(TUESDAY, "06:00"), // latest legal END
    );
    expect(start?.toISOString()).toBe(`${MONDAY}T23:00:00.000Z`);
  });

  it("without a wider fitWindowEnd, a straddling start is rejected", () => {
    const start = bestFreeSlot(
      90,
      [],
      at(MONDAY, "23:00"),
      midnight,
      ZERO_MATRIX,
      TZ,
    );
    expect(start).toBeNull();
  });

  it("the end is still bounded by fitWindowEnd (the deadline)", () => {
    const args = (fitEnd: Date) =>
      bestFreeSlot(
        90,
        [],
        at(MONDAY, "23:30"),
        midnight,
        ZERO_MATRIX,
        TZ,
        fitEnd,
      );
    // 23:30 + 90m = 01:00 Tue — past a 00:45 ceiling, nothing fits.
    expect(args(at(TUESDAY, "00:45"))).toBeNull();
    // Widen the ceiling to exactly 01:00 and the same slot is placeable.
    expect(args(at(TUESDAY, "01:00"))?.toISOString()).toBe(
      `${MONDAY}T23:30:00.000Z`,
    );
  });

  it("avoids a block sitting in the post-midnight tail, falling back to an earlier in-day slot", () => {
    const matrix = new Array<number>(168).fill(0);
    matrix[matrixIndex(1, 23)] = 5; // Monday 23:00 — strongly preferred
    matrix[matrixIndex(2, 0)] = 5; // Tuesday 00:00 — strongly preferred

    const clear = bestFreeSlot(
      90,
      [],
      start20,
      midnight,
      matrix,
      TZ,
      at(TUESDAY, "06:00"),
    );
    expect(clear?.toISOString()).toBe(`${MONDAY}T23:00:00.000Z`);

    const blocked = bestFreeSlot(
      90,
      [
        {
          start: at(TUESDAY, "00:00").getTime(),
          end: at(TUESDAY, "02:00").getTime(),
        },
      ],
      start20,
      midnight,
      matrix,
      TZ,
      at(TUESDAY, "06:00"),
    );
    // A 00:00–02:00 Tuesday block makes every start that reaches into hour 0
    // collide. The best remaining free slot is the latest one that still packs
    // its whole tail into the preferred 23:00 hour: 22:30–00:00 (half-open, so
    // it only touches the block boundary), scoring a full 1.0·5.
    expect(blocked?.toISOString()).toBe(`${MONDAY}T22:30:00.000Z`);
  });
});

describe("regression — non-slot-aligned deadline must never be overshot", () => {
  it("never places a session so that start + duration exceeds the exact deadline instant", () => {
    // Deadline is 47 minutes past the hour — not 15-minute-aligned. The 10:00
    // hour bucket is strongly preferred; only its LAST aligned slot
    // (10:45-11:00) is free, but its end (11:00) is after the real 10:47
    // deadline, so it must be rejected. `floorToSlot` on the ceiling is the
    // fix — `ceilToSlot` (the old bug) would wrongly accept it.
    const deadline = at(MONDAY, "10:47");
    const matrix = matrixWithPeak(1, 10, 5);
    const occupied: Interval[] = [
      {
        start: at(MONDAY, "10:00").getTime(),
        end: at(MONDAY, "10:45").getTime(),
      },
    ];
    const start = bestFreeSlot(
      15,
      occupied,
      at(MONDAY, "09:00"),
      deadline,
      matrix,
      TZ,
    );
    expect(start).not.toBeNull();
    const end = start!.getTime() + 15 * 60_000;
    expect(end).toBeLessThanOrEqual(deadline.getTime());
    expect(start!.toISOString()).not.toBe(`${MONDAY}T10:45:00.000Z`);
    expect(start!.toISOString()).toBe(`${MONDAY}T09:00:00.000Z`);
  });

  it("returns null when nothing can fit before a non-aligned deadline", () => {
    const start = bestFreeSlot(
      15,
      [],
      at(MONDAY, "10:30"),
      at(MONDAY, "10:44"),
      ZERO_MATRIX,
      TZ,
    );
    expect(start).toBeNull();
  });
});

describe("slotPreferenceScore — overlap-weighted hour-bucket sum (D2)", () => {
  const matrix = () => {
    const m = new Array<number>(168).fill(0);
    m[matrixIndex(1, 9)] = 1; // Monday 09:00 hour
    m[matrixIndex(1, 10)] = 2; // Monday 10:00 hour
    return m;
  };
  const score = (start: string, end: string, m = matrix()) =>
    slotPreferenceScore(
      m,
      at(MONDAY, start).getTime(),
      at(MONDAY, end).getTime(),
      TZ,
    );

  it("weights whole hours at full weight", () => {
    // 09:00–11:00 covers hour 9 (1.0·1) + hour 10 (1.0·2).
    expect(score("09:00", "11:00")).toBeCloseTo(3);
  });

  it("weights a partially-covered hour by the covered fraction", () => {
    // 09:15–11:00 → 0.75·pref[9] + 1.0·pref[10] = 0.75·1 + 2 = 2.75.
    expect(score("09:15", "11:00")).toBeCloseTo(2.75);
  });

  it("scores a 90-minute aligned slot as 1.0·hour + 0.5·hour", () => {
    // 09:00–10:30 → 1.0·pref[9] + 0.5·pref[10] = 1 + 1 = 2.
    expect(score("09:00", "10:30")).toBeCloseTo(2);
  });

  it("does not score the hour block starting exactly at the end instant", () => {
    const m = new Array<number>(168).fill(0);
    m[matrixIndex(1, 9)] = 1;
    m[matrixIndex(1, 10)] = 5;
    // 09:00–10:00 is entirely inside hour 9; hour 10 is never touched.
    expect(score("09:00", "10:00", m)).toBeCloseTo(1);
  });

  it("splits a midnight-spanning slot across both local days' hour rows", () => {
    const m = new Array<number>(168).fill(0);
    m[matrixIndex(1, 23)] = 4; // Monday 23:00 hour
    m[matrixIndex(2, 0)] = 6; // Tuesday 00:00 hour
    const s = slotPreferenceScore(
      m,
      at(MONDAY, "23:30").getTime(),
      at(TUESDAY, "00:30").getTime(),
      TZ,
    );
    // 30 min in Mon 23 (0.5·4) + 30 min in Tue 00 (0.5·6) = 2 + 3 = 5.
    expect(s).toBeCloseTo(5);
  });
});
