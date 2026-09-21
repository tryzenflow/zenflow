import { adaptiveWeights } from "../core/adaptive-weights";
import {
  ARM_BANDS,
  armOfMinute,
  armOverlapRatesFromMinute,
  overlapRate,
} from "../core/arms";
import {
  pickLateSlot,
  pickMinConflictSlot,
  planDisplacement,
  type DisplacementInput,
} from "../core/displacement";
import {
  bestLinucbSlot,
  type BestLinucbSlotInput,
} from "../core/linucb-best-slot";
import {
  bestFreeSlot,
  slotPreferenceScore,
  stabilityScore,
} from "../core/slot-score";
import { findConflictingTaskIds } from "../core/sync-conflicts";
import { PREFERENCE_MATRIX_LENGTH } from "@zenflow/shared";

/**
 * Golden fixtures for the scheduler core (issue #62 / #60): a deterministic
 * set of `{ input, output }` cases per pure function, produced by the
 * TypeScript implementation and consumed by the Python port's test-suite
 * (`services/bandit`) so the two implementations cannot drift.
 *
 * Everything here is fully deterministic — fixed instants, fixed matrices, no
 * clock, no randomness. Regenerate with
 * `pnpm --filter backend golden:export`; `golden-fixtures.spec.ts` fails when
 * the committed JSON no longer matches the code (drift).
 *
 * Wire conventions: instants are epoch milliseconds; `Interval`s are
 * `{ start, end }`; absent results are `null`.
 */

export const GOLDEN_FIXTURES_VERSION = 1;

const ms = (iso: string) => Date.parse(iso);
const DAY = 86_400_000;

/** A deterministic, non-trivial 7x24 preference matrix (values in [-1, 1]). */
export function goldenPreferenceMatrix(): number[] {
  return Array.from({ length: PREFERENCE_MATRIX_LENGTH }, (_, i) => {
    const hour = i % 24;
    const wd = Math.floor(i / 24);
    const base =
      hour >= 8 && hour < 12 ? 0.8 : hour >= 20 || hour < 6 ? -0.6 : 0.1;
    return Math.round((base - wd * 0.03) * 1000) / 1000;
  });
}

const ZERO = new Array<number>(PREFERENCE_MATRIX_LENGTH).fill(0);

interface LinucbCase {
  name: string;
  input: BestLinucbSlotInput;
}

function utcDay(
  dayStr: string,
  over: Partial<BestLinucbSlotInput["days"][number]> = {},
) {
  const start = ms(`${dayStr}T00:00:00.000Z`);
  return {
    dayStr,
    dayStartMs: start,
    dayEndMs: start + DAY,
    occupied: [] as { start: number; end: number }[],
    vector: [0.5, -0.25],
    armScores: {} as Record<string, number>,
    ...over,
  };
}

function linucbCases(): LinucbCase[] {
  const pref = goldenPreferenceMatrix();
  const base = {
    durationMinutes: 60,
    timezone: "UTC",
    prefMatrix: ZERO,
    nextMs: ms("2026-06-15T00:00:00.000Z"),
    deadlineMs: ms("2026-06-16T00:00:00.000Z"),
  };
  return [
    {
      name: "cold start, flat matrix, all-zero arms (tie -> MORNING)",
      input: { ...base, days: [utcDay("2026-06-15")] },
    },
    {
      name: "cold start prefers preferred hours",
      input: {
        ...base,
        prefMatrix: pref,
        days: [utcDay("2026-06-15")],
        observationCount: 0,
      },
    },
    {
      name: "warm user follows the arm scores",
      input: {
        ...base,
        prefMatrix: pref,
        observationCount: 500,
        days: [
          utcDay("2026-06-15", { armScores: { EVENING: 2.5, MORNING: 0.5 } }),
        ],
      },
    },
    {
      name: "half-warm blend across two days",
      input: {
        ...base,
        prefMatrix: pref,
        observationCount: 20,
        deadlineMs: ms("2026-06-17T00:00:00.000Z"),
        days: [
          utcDay("2026-06-15", { armScores: { AFTERNOON: 1 } }),
          utcDay("2026-06-16", { armScores: { AFTERNOON: 1.4, NIGHT: 2 } }),
        ],
      },
    },
    {
      name: "midnight overhang is the only room",
      input: {
        ...base,
        deadlineMs: ms("2026-06-16T01:00:00.000Z"),
        days: [
          utcDay("2026-06-15", {
            occupied: [
              {
                start: ms("2026-06-15T00:00:00.000Z"),
                end: ms("2026-06-15T23:45:00.000Z"),
              },
            ],
          }),
        ],
      },
    },
    {
      name: "non-aligned deadline is a hard ceiling",
      input: {
        ...base,
        nextMs: ms("2026-06-15T09:00:00.000Z"),
        deadlineMs: ms("2026-06-15T10:10:00.000Z"),
        prefMatrix: pref,
        days: [utcDay("2026-06-15")],
      },
    },
    {
      name: "stability pulls toward the previous start",
      input: {
        ...base,
        prevStartMs: ms("2026-06-15T15:00:00.000Z"),
        days: [utcDay("2026-06-15")],
      },
    },
    {
      name: "fractional offset timezone (Asia/Kathmandu)",
      input: {
        ...base,
        timezone: "Asia/Kathmandu",
        prefMatrix: pref,
        nextMs: ms("2026-06-14T18:15:00.000Z"),
        deadlineMs: ms("2026-06-15T18:15:00.000Z"),
        days: [
          {
            ...utcDay("2026-06-15"),
            dayStartMs: ms("2026-06-14T18:15:00.000Z"),
            dayEndMs: ms("2026-06-15T18:15:00.000Z"),
          },
        ],
      },
    },
    {
      name: "DST fall-back day (America/New_York, 25h)",
      input: {
        ...base,
        timezone: "America/New_York",
        prefMatrix: pref,
        nextMs: ms("2026-11-01T04:00:00.000Z"),
        deadlineMs: ms("2026-11-02T05:00:00.000Z"),
        days: [
          {
            ...utcDay("2026-11-01"),
            dayStartMs: ms("2026-11-01T04:00:00.000Z"),
            dayEndMs: ms("2026-11-02T05:00:00.000Z"),
            armScores: { MORNING: 1 },
          },
        ],
      },
    },
    {
      name: "nothing feasible -> null",
      input: {
        ...base,
        days: [
          utcDay("2026-06-15", {
            occupied: [
              {
                start: ms("2026-06-15T00:00:00.000Z"),
                end: ms("2026-06-16T00:00:00.000Z"),
              },
            ],
          }),
        ],
      },
    },
  ];
}

function displacementCases(): { name: string; input: DisplacementInput }[] {
  const dayStart = ms("2026-06-15T00:00:00.000Z");
  const window = { startMs: dayStart, endMs: dayStart + DAY };
  const common = {
    nowMs: ms("2026-06-15T06:00:00.000Z"),
    windows: [window, { startMs: dayStart - DAY, endMs: dayStart + 2 * DAY }],
    prefMatrix: goldenPreferenceMatrix(),
    timezone: "UTC",
  };
  const fixed = [
    {
      start: ms("2026-06-15T06:00:00.000Z"),
      end: ms("2026-06-15T09:00:00.000Z"),
    },
    {
      start: ms("2026-06-15T10:00:00.000Z"),
      end: ms("2026-06-15T12:00:00.000Z"),
    },
  ];
  const flex = (
    id: string,
    startIso: string,
    hours: number,
    deadlineIso: string,
  ) => ({
    id,
    durationMinutes: hours * 60,
    deadlineMs: ms(deadlineIso),
    startMs: ms(startIso),
  });
  return [
    {
      name: "repack one flexible task out of the only hole",
      input: {
        ...common,
        task: {
          durationMinutes: 60,
          deadlineMs: ms("2026-06-15T12:00:00.000Z"),
        },
        fixed,
        flexible: [
          flex("f1", "2026-06-15T09:00:00.000Z", 1, "2026-06-15T23:00:00.000Z"),
        ],
      },
    },
    {
      name: "only fixed blocks -> infeasible",
      input: {
        ...common,
        task: {
          durationMinutes: 60,
          deadlineMs: ms("2026-06-15T12:00:00.000Z"),
        },
        fixed: [
          {
            start: ms("2026-06-15T06:00:00.000Z"),
            end: ms("2026-06-15T12:00:00.000Z"),
          },
        ],
        flexible: [],
      },
    },
    {
      name: "EDF cascade with two displaced tasks",
      input: {
        ...common,
        task: {
          durationMinutes: 120,
          deadlineMs: ms("2026-06-15T11:00:00.000Z"),
        },
        fixed: [
          {
            start: ms("2026-06-15T06:00:00.000Z"),
            end: ms("2026-06-15T09:00:00.000Z"),
          },
        ],
        flexible: [
          flex(
            "late",
            "2026-06-15T09:00:00.000Z",
            1,
            "2026-06-15T23:00:00.000Z",
          ),
          flex(
            "early",
            "2026-06-15T10:00:00.000Z",
            1,
            "2026-06-15T13:00:00.000Z",
          ),
        ],
      },
    },
    {
      name: "cascade cap of zero -> infeasible",
      input: {
        ...common,
        maxMoves: 0,
        task: {
          durationMinutes: 60,
          deadlineMs: ms("2026-06-15T10:00:00.000Z"),
        },
        fixed: [
          {
            start: ms("2026-06-15T06:00:00.000Z"),
            end: ms("2026-06-15T08:00:00.000Z"),
          },
        ],
        flexible: [
          flex("f1", "2026-06-15T08:00:00.000Z", 1, "2026-06-15T23:00:00.000Z"),
          flex("f2", "2026-06-15T09:00:00.000Z", 1, "2026-06-15T23:00:00.000Z"),
        ],
      },
    },
  ];
}

/** Builds the full, deterministic golden fixture document. */
export function buildGoldenFixtures() {
  const pref = goldenPreferenceMatrix();
  const rangeMs = {
    startMs: ms("2026-06-15T08:00:00.000Z"),
    endMs: ms("2026-06-15T10:00:00.000Z"),
  };

  const fallbackBase = {
    durationMinutes: 60,
    nowMs: ms("2026-06-15T06:00:00.000Z"),
    deadlineMs: ms("2026-06-15T12:00:00.000Z"),
    occupied: [
      {
        start: ms("2026-06-15T06:00:00.000Z"),
        end: ms("2026-06-15T12:00:00.000Z"),
      },
    ],
    prefMatrix: pref,
    timezone: "UTC",
  };

  return {
    version: GOLDEN_FIXTURES_VERSION,
    note: "Generated by backend/scripts/export-golden-fixtures.ts - do not edit by hand.",
    adaptiveWeights: [0, 1, 10, 20, 39, 40, 100, 5000].map((n) => ({
      input: { observationCount: n },
      output: adaptiveWeights(n),
    })),
    armOfMinute: [0, 359, 360, 659, 660, 1019, 1020, 1199, 1200, 1439].map(
      (m) => ({
        input: { minuteOfDay: m },
        output: armOfMinute(m),
      }),
    ),
    armOverlapRatesFromMinute: [
      [990, 60],
      [1425, 60],
      [0, 15],
      [1380, 180],
      [600, 240],
    ].map(([startMinute, durationMinutes]) => ({
      input: { startMinute, durationMinutes },
      output: ARM_BANDS.map((b, i) => ({
        arm: b.arm,
        rate: armOverlapRatesFromMinute(startMinute, durationMinutes)[i],
      })),
    })),
    overlapRate: [
      {
        s: "2026-06-15T16:30:00.000Z",
        e: "2026-06-15T17:30:00.000Z",
        tz: "UTC",
      },
      {
        s: "2026-06-15T23:00:00.000Z",
        e: "2026-06-16T01:00:00.000Z",
        tz: "UTC",
      },
      {
        s: "2026-06-14T18:15:00.000Z",
        e: "2026-06-14T19:15:00.000Z",
        tz: "Asia/Kathmandu",
      },
    ].flatMap((c) =>
      ARM_BANDS.map((b) => ({
        input: { startMs: ms(c.s), endMs: ms(c.e), arm: b.arm, timezone: c.tz },
        output: overlapRate(ms(c.s), ms(c.e), b.arm, c.tz),
      })),
    ),
    slotPreferenceScore: [
      { s: "2026-06-15T09:00:00.000Z", e: "2026-06-15T10:00:00.000Z" },
      { s: "2026-06-15T09:15:00.000Z", e: "2026-06-15T11:00:00.000Z" },
      { s: "2026-06-15T23:00:00.000Z", e: "2026-06-16T01:00:00.000Z" },
    ].map((c) => ({
      input: {
        prefMatrix: pref,
        startMs: ms(c.s),
        endMs: ms(c.e),
        timezone: "UTC",
      },
      output: slotPreferenceScore(pref, ms(c.s), ms(c.e), "UTC"),
    })),
    stabilityScore: [0, 15, 60, 240, 100000].map((mins) => ({
      input: {
        prevStartMs: ms("2026-06-15T09:00:00.000Z"),
        newStartMs: ms("2026-06-15T09:00:00.000Z") + mins * 60_000,
      },
      output: stabilityScore(
        ms("2026-06-15T09:00:00.000Z"),
        ms("2026-06-15T09:00:00.000Z") + mins * 60_000,
      ),
    })),
    bestFreeSlot: [
      { name: "highest preference wins", occupied: [], deadline: null },
      {
        name: "avoids an occupied interval",
        occupied: [
          {
            start: ms("2026-06-15T08:00:00.000Z"),
            end: ms("2026-06-15T12:00:00.000Z"),
          },
        ],
        deadline: null,
      },
      {
        name: "non-aligned deadline",
        occupied: [],
        deadline: ms("2026-06-15T10:10:00.000Z"),
      },
    ].map((c) => {
      const windowStart = rangeMs.startMs - 4 * 3_600_000;
      const windowEnd = c.deadline ?? ms("2026-06-16T00:00:00.000Z");
      const out = bestFreeSlot(
        60,
        c.occupied,
        new Date(windowStart),
        new Date(windowEnd),
        pref,
        "UTC",
        new Date(windowEnd),
      );
      return {
        name: c.name,
        input: {
          durationMinutes: 60,
          occupied: c.occupied,
          windowStartMs: windowStart,
          windowEndMs: windowEnd,
          fitWindowEndMs: windowEnd,
          prefMatrix: pref,
          timezone: "UTC",
        },
        output: out ? out.getTime() : null,
      };
    }),
    bestLinucbSlot: linucbCases().map((c) => ({
      name: c.name,
      input: c.input,
      output: bestLinucbSlot(c.input),
    })),
    planDisplacement: displacementCases().map((c) => ({
      name: c.name,
      input: c.input,
      output: planDisplacement(c.input),
    })),
    pickMinConflictSlot: [fallbackBase].map((input) => ({
      input,
      output: pickMinConflictSlot(input),
    })),
    pickLateSlot: [fallbackBase].map((input) => ({
      input,
      output: pickLateSlot(input),
    })),
    findConflictingTaskIds: [
      {
        fixed: [{ start: 1_000 * 60_000, end: 1_060 * 60_000 }],
        tasks: [
          { id: "b", startMs: 1_030 * 60_000, durationMinutes: 30 },
          { id: "a", startMs: 970 * 60_000, durationMinutes: 30 },
          { id: "c", startMs: 1_000 * 60_000, durationMinutes: 15 },
        ],
      },
    ].map((input) => ({
      input,
      output: findConflictingTaskIds(input.fixed, input.tasks),
    })),
  };
}
