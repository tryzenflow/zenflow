import { describe, it, expect } from "@jest/globals";
import {
  daysUntilDeadline,
  effectiveNowForSessionCountEdit,
  maxFeasibleSessionCount,
} from "./session-count";
import { MAX_TASK_SESSION_COUNT } from "./tasks";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function isoIn(ms: number, from = Date.now()): string {
  return new Date(from + ms).toISOString();
}

describe("maxFeasibleSessionCount", () => {
  it("returns MAX_TASK_SESSION_COUNT when the deadline isn't set yet", () => {
    expect(maxFeasibleSessionCount(undefined, 60)).toBe(MAX_TASK_SESSION_COUNT);
  });

  it("floors to how many durations fit in the window off `now` by default", () => {
    // 4h window, 60min sessions -> 4 fit exactly.
    expect(maxFeasibleSessionCount(isoIn(4 * HOUR), 60)).toBe(4);
  });

  it("returns 0 when the deadline has already passed relative to `now`", () => {
    expect(maxFeasibleSessionCount(isoIn(-HOUR), 60)).toBe(0);
  });

  it("accepts an explicit `from` to move the window's start", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    const deadline = new Date(from.getTime() + 4 * HOUR).toISOString();
    // Same 4h window, but anchored on `from` instead of `Date.now()`.
    expect(maxFeasibleSessionCount(deadline, 60, from)).toBe(4);
  });

  it("returns 0 when `from` is already past the deadline", () => {
    const from = new Date("2026-01-02T00:00:00.000Z");
    const deadline = new Date("2026-01-01T00:00:00.000Z").toISOString();
    expect(maxFeasibleSessionCount(deadline, 60, from)).toBe(0);
  });
});

describe("daysUntilDeadline", () => {
  it("defaults to 1 when the deadline isn't set yet", () => {
    expect(daysUntilDeadline(undefined)).toBe(1);
  });

  it("rounds up a partial day off `now` by default", () => {
    expect(daysUntilDeadline(isoIn(25 * HOUR))).toBe(2);
  });

  it("accepts an explicit `from` to move the window's start", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    const deadline = new Date(from.getTime() + 25 * HOUR).toISOString();
    expect(daysUntilDeadline(deadline, from)).toBe(2);
  });

  it("returns 1 (never 0 or negative) for a deadline before `from`", () => {
    const from = new Date("2026-01-02T00:00:00.000Z");
    const deadline = new Date("2026-01-01T00:00:00.000Z").toISOString();
    expect(daysUntilDeadline(deadline, from)).toBe(1);
  });
});

describe("effectiveNowForSessionCountEdit", () => {
  const now = new Date("2026-01-05T12:00:00.000Z");

  it("returns `now` unchanged when the instance has no scheduledStartTime", () => {
    const result = effectiveNowForSessionCountEdit(
      { scheduledStartTime: null, durationMinutes: 60 },
      now,
    );
    expect(result.getTime()).toBe(now.getTime());
  });

  it("returns `now` unchanged when the instance's start is in the future", () => {
    const future = new Date(now.getTime() + HOUR).toISOString();
    const result = effectiveNowForSessionCountEdit(
      { scheduledStartTime: future, durationMinutes: 60 },
      now,
    );
    expect(result.getTime()).toBe(now.getTime());
  });

  it("shifts `now` forward by a day when the instance's start is in the past", () => {
    const past = new Date(now.getTime() - HOUR).toISOString();
    const result = effectiveNowForSessionCountEdit(
      { scheduledStartTime: past, durationMinutes: 60 },
      now,
    );
    expect(result.getTime()).toBe(now.getTime() + DAY);
  });

  it("treats an in-progress instance (start already elapsed) the same as a past one", () => {
    // Started 30 minutes ago, 60-minute session -> still in progress, but its
    // own start time is in the past, so it's treated the same as elapsed.
    const start = new Date(now.getTime() - 30 * 60_000).toISOString();
    const result = effectiveNowForSessionCountEdit(
      { scheduledStartTime: start, durationMinutes: 60 },
      now,
    );
    expect(result.getTime()).toBe(now.getTime() + DAY);
  });

  it("defaults `now` to the current time when omitted", () => {
    const before = Date.now();
    const result = effectiveNowForSessionCountEdit({
      scheduledStartTime: null,
      durationMinutes: 60,
    });
    const after = Date.now();
    expect(result.getTime()).toBeGreaterThanOrEqual(before);
    expect(result.getTime()).toBeLessThanOrEqual(after);
  });
});
