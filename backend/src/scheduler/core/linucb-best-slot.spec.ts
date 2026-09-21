import {
  bestLinucbSlot,
  type BestLinucbSlotInput,
  type LinucbCandidateDay,
} from "./linucb-best-slot";
import { matrixIndex } from "./preference";
import { adaptiveWeights } from "./adaptive-weights";

const ms = (iso: string) => new Date(iso).getTime();
const iso = (n: number) => new Date(n).toISOString();
const ZERO = new Array<number>(168).fill(0);
const DAY = 86_400_000;

function day(
  dayStr = "2026-06-15",
  over: Partial<LinucbCandidateDay> = {},
): LinucbCandidateDay {
  const start = ms(`${dayStr}T00:00:00.000Z`);
  return {
    dayStr,
    dayStartMs: start,
    dayEndMs: start + DAY,
    occupied: [],
    vector: [1],
    armScores: {},
    ...over,
  };
}

function input(over: Partial<BestLinucbSlotInput> = {}): BestLinucbSlotInput {
  return {
    days: [day()],
    durationMinutes: 60,
    timezone: "UTC",
    prefMatrix: ZERO,
    nextMs: ms("2026-06-15T00:00:00.000Z"),
    deadlineMs: ms("2026-06-16T00:00:00.000Z"),
    ...over,
  };
}

/** Preference matrix that likes `hours` on every weekday. */
function likes(hours: number[]): number[] {
  const m = [...ZERO];
  for (let wd = 1; wd <= 7; wd++)
    for (const h of hours) m[matrixIndex(wd, h)] = 1;
  return m;
}

describe("adaptiveWeights", () => {
  it("is pref-heavy cold and shifts monotonically toward LinUCB", () => {
    expect(adaptiveWeights(0)).toEqual({ wL: 0.3, wP: 1 });
    let prev = adaptiveWeights(0);
    for (let n = 1; n <= 80; n++) {
      const w = adaptiveWeights(n);
      expect(w.wL).toBeGreaterThanOrEqual(prev.wL);
      expect(w.wP).toBeLessThanOrEqual(prev.wP);
      prev = w;
    }
    expect(adaptiveWeights(10_000)).toEqual({ wL: 1, wP: 0.1 });
  });

  it("treats negative / NaN counts as cold", () => {
    expect(adaptiveWeights(-5)).toEqual(adaptiveWeights(0));
    expect(adaptiveWeights(NaN)).toEqual(adaptiveWeights(0));
  });
});

describe("bestLinucbSlot", () => {
  it("cold start with a morning preference picks the morning, not 00:00", () => {
    const pick = bestLinucbSlot(
      input({ prefMatrix: likes([9, 10]), observationCount: 0 }),
    )!;
    expect(new Date(pick.startMs).getUTCHours()).toBe(9);
    expect(pick.arm).toBe("MORNING");
    expect(pick.weights).toEqual({ wL: 0.3, wP: 1 });
  });

  it("exact ties go to MORNING (never EARLY_MORNING), deterministically", () => {
    const a = bestLinucbSlot(input())!;
    const b = bestLinucbSlot(input())!;
    expect(a).toEqual(b);
    expect(a.arm).toBe("MORNING");
    expect(iso(a.startMs)).toBe("2026-06-15T06:00:00.000Z");
  });

  it("a warm user follows LinUCB's arm scores over a weak preference", () => {
    const pick = bestLinucbSlot(
      input({
        prefMatrix: likes([9]),
        observationCount: 1000,
        days: [day("2026-06-15", { armScores: { EVENING: 3 } })],
      }),
    )!;
    expect(pick.arm).toBe("EVENING");
  });

  it("ranks across days (best arm score wins on the later day)", () => {
    const pick = bestLinucbSlot(
      input({
        observationCount: 1000,
        days: [
          day("2026-06-15", { armScores: { AFTERNOON: 1 } }),
          day("2026-06-16", { armScores: { AFTERNOON: 2 } }),
        ],
        deadlineMs: ms("2026-06-17T00:00:00.000Z"),
      }),
    )!;
    expect(iso(pick.startMs).slice(0, 10)).toBe("2026-06-16");
  });

  it("overlap-weights arm scores across a band boundary", () => {
    // 16:30-17:30 = half AFTERNOON (score 2) + half EVENING (score 0) -> 1.
    const pick = bestLinucbSlot(
      input({
        observationCount: 1000,
        days: [day("2026-06-15", { armScores: { AFTERNOON: 2, EVENING: 0 } })],
        nextMs: ms("2026-06-15T16:30:00.000Z"),
        deadlineMs: ms("2026-06-15T17:30:00.000Z"),
      }),
    )!;
    expect(pick.score).toBeCloseTo(1);
  });

  it("considers a 23:45 start overhanging midnight when nothing else is free", () => {
    const d = day("2026-06-15", {
      occupied: [
        {
          start: ms("2026-06-15T00:00:00.000Z"),
          end: ms("2026-06-15T23:45:00.000Z"),
        },
      ],
    });
    const pick = bestLinucbSlot(
      input({
        days: [d],
        deadlineMs: ms("2026-06-16T01:00:00.000Z"),
      }),
    )!;
    expect(iso(pick.startMs)).toBe("2026-06-15T23:45:00.000Z");
  });

  it("scores a midnight-crossing slot on both sides (NIGHT + EARLY_MORNING)", () => {
    const pick = bestLinucbSlot(
      input({
        observationCount: 1000,
        durationMinutes: 120,
        nextMs: ms("2026-06-15T23:00:00.000Z"),
        deadlineMs: ms("2026-06-16T01:00:00.000Z"),
        days: [
          day("2026-06-15", { armScores: { NIGHT: 4, EARLY_MORNING: 2 } }),
        ],
      }),
    )!;
    expect(pick.score).toBeCloseTo(3);
  });

  it("deadline is a hard ceiling on the END and need not be slot-aligned", () => {
    const deadlineMs = ms("2026-06-15T10:10:00.000Z");
    const pick = bestLinucbSlot(
      input({ nextMs: ms("2026-06-15T09:00:00.000Z"), deadlineMs }),
    )!;
    expect(pick.startMs + 3_600_000).toBeLessThanOrEqual(deadlineMs);
    expect(iso(pick.startMs)).toBe("2026-06-15T09:00:00.000Z");
  });

  it("returns null for a full day with the deadline today", () => {
    const d = day("2026-06-15", {
      occupied: [
        {
          start: ms("2026-06-15T00:00:00.000Z"),
          end: ms("2026-06-16T00:00:00.000Z"),
        },
      ],
    });
    expect(
      bestLinucbSlot(
        input({
          days: [d],
          nextMs: ms("2026-06-15T08:00:00.000Z"),
          deadlineMs: ms("2026-06-15T20:00:00.000Z"),
        }),
      ),
    ).toBeNull();
  });

  it("returns null when now + duration > deadline", () => {
    expect(
      bestLinucbSlot(
        input({
          nextMs: ms("2026-06-15T09:00:00.000Z"),
          deadlineMs: ms("2026-06-15T09:30:00.000Z"),
        }),
      ),
    ).toBeNull();
  });

  it("stability pulls a near-tie toward the previous start", () => {
    const pick = bestLinucbSlot(
      input({ prevStartMs: ms("2026-06-15T15:00:00.000Z") }),
    )!;
    expect(iso(pick.startMs)).toBe("2026-06-15T15:00:00.000Z");
  });

  it("handles fractional-offset tz days (+05:45)", () => {
    const start = ms("2026-06-14T18:15:00.000Z"); // local midnight, Asia/Kathmandu
    const d: LinucbCandidateDay = {
      dayStr: "2026-06-15",
      dayStartMs: start,
      dayEndMs: start + DAY,
      occupied: [],
      vector: [],
      armScores: {},
    };
    const pick = bestLinucbSlot(
      input({
        days: [d],
        timezone: "Asia/Kathmandu",
        nextMs: start,
        deadlineMs: start + DAY,
      }),
    )!;
    // Tie -> earliest MORNING-start slot = 06:00 local = 00:15Z.
    expect(iso(pick.startMs)).toBe("2026-06-15T00:15:00.000Z");
  });

  it("stays exact on a DST fall-back day (25h)", () => {
    const start = ms("2026-11-01T04:00:00.000Z"); // local midnight EDT
    const end = ms("2026-11-02T05:00:00.000Z"); // next local midnight EST
    const d: LinucbCandidateDay = {
      dayStr: "2026-11-01",
      dayStartMs: start,
      dayEndMs: end,
      occupied: [],
      vector: [],
      armScores: {},
    };
    const pick = bestLinucbSlot(
      input({
        days: [d],
        timezone: "America/New_York",
        nextMs: start,
        deadlineMs: end,
      }),
    )!;
    // 06:00 local after the transition (EST) = 11:00Z.
    expect(pick.arm).toBe("MORNING");
    expect(iso(pick.startMs)).toBe("2026-11-01T11:00:00.000Z");
  });

  it("respects extraOccupied blocks", () => {
    const pick = bestLinucbSlot(
      input({
        extraOccupied: [
          {
            start: ms("2026-06-15T06:00:00.000Z"),
            end: ms("2026-06-15T12:00:00.000Z"),
          },
        ],
      }),
    )!;
    // Next tie-order arm after MORNING is AFTERNOON, earliest = 12:00.
    expect(iso(pick.startMs)).toBe("2026-06-15T12:00:00.000Z");
  });
});
