import {
  bestLinucbSlot,
  bestMinuteInArm,
  rankArmsByScore,
  type LinucbCandidateDay,
} from "./linucb-best-slot";
import { matrixIndex } from "./preference";

const TZ = "UTC";
const ZERO = new Array<number>(168).fill(0);
const ms = (iso: string) => new Date(iso).getTime();

function day(over: Partial<LinucbCandidateDay> = {}): LinucbCandidateDay {
  return {
    dayStr: "2026-06-15",
    dayStartMs: ms("2026-06-15T00:00:00.000Z"),
    dayEndMs: ms("2026-06-16T00:00:00.000Z"),
    occupied: [],
    vector: [],
    armScores: {},
    ...over,
  };
}

describe("rankArmsByScore", () => {
  it("ranks arms by the max per-arm score over any candidate day, highest first", () => {
    const days = [
      day({ armScores: { MORNING: 1, EVENING: 5 } }),
      day({ dayStr: "2026-06-16", armScores: { MORNING: 9, AFTERNOON: 3 } }),
    ];
    const ranked = rankArmsByScore(days);
    // MORNING's best (9, day 2) > EVENING's best (5) > AFTERNOON's best (3)
    // > the two unscored arms (0 each, ARM_BANDS order breaks the tie).
    expect(ranked.slice(0, 3)).toEqual(["MORNING", "EVENING", "AFTERNOON"]);
  });

  it("breaks exact ties by ARM_BANDS' declared order (EARLY_MORNING → NIGHT)", () => {
    const ranked = rankArmsByScore([day({ armScores: {} })]); // every arm scores 0
    expect(ranked).toEqual([
      "EARLY_MORNING",
      "MORNING",
      "AFTERNOON",
      "EVENING",
      "NIGHT",
    ]);
  });
});

describe("bestMinuteInArm", () => {
  it("only considers starts whose local minute-of-day falls in the arm's own band", () => {
    const pick = bestMinuteInArm(
      "MORNING",
      [day()],
      60,
      TZ,
      ZERO,
      ms("2026-06-15T00:00:00.000Z"),
      ms("2026-06-16T00:00:00.000Z"),
      [],
    );
    expect(pick).not.toBeNull();
    const startHour = new Date(pick!.startMs).getUTCHours();
    expect(startHour).toBeGreaterThanOrEqual(6); // MORNING = [360, 660) → 06:00–11:00
    expect(startHour).toBeLessThan(11);
  });

  it("returns null when the arm has zero feasible slots anywhere in the horizon", () => {
    // NIGHT = [1200, 1440) → 20:00–24:00, fully occupied on the only day.
    const pick = bestMinuteInArm(
      "NIGHT",
      [
        day({
          occupied: [
            {
              start: ms("2026-06-15T20:00:00.000Z"),
              end: ms("2026-06-16T00:00:00.000Z"),
            },
          ],
        }),
      ],
      60,
      TZ,
      ZERO,
      ms("2026-06-15T00:00:00.000Z"),
      ms("2026-06-16T00:00:00.000Z"),
      [],
    );
    expect(pick).toBeNull();
  });

  it("scores candidates by the duration-normalized preference nudge + stability only", () => {
    const pref = [...ZERO];
    pref[matrixIndex(1, 9)] = 5; // Monday 09:00 strongly preferred
    const pick = bestMinuteInArm(
      "MORNING",
      [day()],
      60,
      TZ,
      pref,
      ms("2026-06-15T00:00:00.000Z"),
      ms("2026-06-16T00:00:00.000Z"),
      [],
    );
    expect(new Date(pick!.startMs).toISOString()).toBe(
      "2026-06-15T09:00:00.000Z",
    );
  });

  it("earliest start breaks a score tie", () => {
    const pick = bestMinuteInArm(
      "EARLY_MORNING",
      [day()],
      60,
      TZ,
      ZERO,
      ms("2026-06-15T00:00:00.000Z"),
      ms("2026-06-16T00:00:00.000Z"),
      [],
    );
    expect(new Date(pick!.startMs).toISOString()).toBe(
      "2026-06-15T00:00:00.000Z",
    );
  });
});

describe("bestLinucbSlot", () => {
  it("picks the top-ranked arm's band, earliest feasible day/minute first (no per-day preference to break the tie)", () => {
    const days = [
      day({ vector: [1] }),
      day({
        dayStr: "2026-06-16",
        dayStartMs: ms("2026-06-16T00:00:00.000Z"),
        dayEndMs: ms("2026-06-17T00:00:00.000Z"),
        vector: [2],
        armScores: { AFTERNOON: 10 },
      }),
    ];
    const best = bestLinucbSlot({
      days,
      durationMinutes: 60,
      timezone: TZ,
      prefMatrix: ZERO,
      nextMs: ms("2026-06-15T00:00:00.000Z"),
      deadlineMs: ms("2026-06-17T00:00:00.000Z"),
    });
    // AFTERNOON is the only scored (hence top-ranked) arm; step 2 has no
    // preference/stability signal to prefer day 2 over day 1's own AFTERNOON
    // band, so the earliest feasible start (day 1, 11:00) wins.
    expect(best?.arm).toBe("AFTERNOON");
    expect(best?.vector).toEqual([1]);
    expect(new Date(best!.startMs).toISOString()).toBe(
      "2026-06-15T11:00:00.000Z", // AFTERNOON starts at 11:00
    );
  });

  it("never returns a slot that overlaps `occupied` or `extraOccupied`", () => {
    const best = bestLinucbSlot({
      days: [
        day({
          armScores: { NIGHT: 100 }, // 20:00-24:00, strongly preferred
          occupied: [
            {
              start: ms("2026-06-15T20:00:00.000Z"),
              end: ms("2026-06-15T21:00:00.000Z"),
            },
          ],
        }),
      ],
      durationMinutes: 60,
      timezone: TZ,
      prefMatrix: ZERO,
      nextMs: ms("2026-06-15T20:00:00.000Z"),
      deadlineMs: ms("2026-06-16T00:00:00.000Z"),
      extraOccupied: [
        {
          start: ms("2026-06-15T21:00:00.000Z"),
          end: ms("2026-06-15T23:00:00.000Z"),
        },
      ],
    });
    expect(best?.arm).toBe("NIGHT");
    expect(new Date(best!.startMs).toISOString()).toBe(
      "2026-06-15T23:00:00.000Z",
    );
  });

  it("lets a slot start before midnight and run past it, bounded by deadlineMs (D5)", () => {
    const best = bestLinucbSlot({
      days: [day({ armScores: { NIGHT: 100 } })],
      durationMinutes: 60,
      timezone: TZ,
      prefMatrix: ZERO,
      nextMs: ms("2026-06-15T23:45:00.000Z"),
      deadlineMs: ms("2026-06-16T01:00:00.000Z"),
    });
    expect(new Date(best!.startMs).toISOString()).toBe(
      "2026-06-15T23:45:00.000Z",
    );
    expect(new Date(best!.startMs + 60 * 60_000).toISOString()).toBe(
      "2026-06-16T00:45:00.000Z",
    );
  });

  it("feasibility fallback: falls through to the second-ranked arm when the top arm is fully booked, and attributes the reward to that arm", () => {
    // EVENING [1020,1200) = 17:00-20:00 scores highest but is fully booked;
    // MORNING [360,660) = 06:00-11:00 scores second and is free.
    const best = bestLinucbSlot({
      days: [
        day({
          armScores: { EVENING: 100, MORNING: 50 },
          occupied: [
            {
              start: ms("2026-06-15T17:00:00.000Z"),
              end: ms("2026-06-15T20:00:00.000Z"),
            },
          ],
        }),
      ],
      durationMinutes: 60,
      timezone: TZ,
      prefMatrix: ZERO,
      nextMs: ms("2026-06-15T00:00:00.000Z"),
      deadlineMs: ms("2026-06-16T00:00:00.000Z"),
    });
    expect(best).not.toBeNull();
    // The picked arm is the one actually used — MORNING, not the fully-booked
    // top-ranked EVENING — so reward attribution (`SlotProposal.selectedArm`)
    // points at whichever arm really hosted the session.
    expect(best?.arm).toBe("MORNING");
    const startHour = new Date(best!.startMs).getUTCHours();
    expect(startHour).toBeGreaterThanOrEqual(6);
    expect(startHour).toBeLessThan(11);
  });

  it("falls all the way through to a cold (unscored) arm when every scored arm is fully booked", () => {
    const fullDayBlock = {
      start: ms("2026-06-15T00:00:00.000Z"),
      end: ms("2026-06-15T20:00:00.000Z"), // blocks every arm except NIGHT
    };
    const best = bestLinucbSlot({
      days: [
        day({
          armScores: { MORNING: 100, AFTERNOON: 50 },
          occupied: [fullDayBlock],
        }),
      ],
      durationMinutes: 60,
      timezone: TZ,
      prefMatrix: ZERO,
      nextMs: ms("2026-06-15T00:00:00.000Z"),
      deadlineMs: ms("2026-06-16T00:00:00.000Z"),
    });
    expect(best?.arm).toBe("NIGHT");
    expect(new Date(best!.startMs).toISOString()).toBe(
      "2026-06-15T20:00:00.000Z",
    );
  });

  it("returns null when every arm is exhausted (nothing free fits before the deadline)", () => {
    const best = bestLinucbSlot({
      days: [day()],
      durationMinutes: 60,
      timezone: TZ,
      prefMatrix: ZERO,
      nextMs: ms("2026-06-15T23:30:00.000Z"),
      deadlineMs: ms("2026-06-15T23:45:00.000Z"),
    });
    expect(best).toBeNull();
  });
});
