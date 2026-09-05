import { MAX_TASK_SESSION_COUNT } from "@zenflow/core";
import { describe, expect, it } from "vitest";
import {
  daysUntilDeadline,
  maxFeasibleSessionCount,
  sessionCadenceLabel,
} from "../session-count";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function isoIn(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

describe("maxFeasibleSessionCount", () => {
  it("returns MAX_TASK_SESSION_COUNT when the deadline isn't set yet", () => {
    expect(maxFeasibleSessionCount(undefined, 60)).toBe(MAX_TASK_SESSION_COUNT);
  });

  it("returns MAX_TASK_SESSION_COUNT when duration isn't set yet", () => {
    expect(maxFeasibleSessionCount(isoIn(DAY), undefined)).toBe(
      MAX_TASK_SESSION_COUNT,
    );
  });

  it("floors to how many durations fit in the window", () => {
    // 4h window, 60min sessions -> 4 fit exactly.
    expect(maxFeasibleSessionCount(isoIn(4 * HOUR), 60)).toBe(4);
  });

  it("caps at MAX_TASK_SESSION_COUNT for a huge window", () => {
    expect(maxFeasibleSessionCount(isoIn(365 * DAY), 15)).toBe(
      MAX_TASK_SESSION_COUNT,
    );
  });

  it("returns 0 when the deadline has already passed", () => {
    expect(maxFeasibleSessionCount(isoIn(-HOUR), 60)).toBe(0);
  });
});

describe("daysUntilDeadline", () => {
  it("defaults to 1 when the deadline isn't set yet", () => {
    expect(daysUntilDeadline(undefined)).toBe(1);
  });

  it("rounds up a partial day", () => {
    expect(daysUntilDeadline(isoIn(25 * HOUR))).toBe(2);
  });

  it("returns 1 for a deadline later today", () => {
    expect(daysUntilDeadline(isoIn(3 * HOUR))).toBe(1);
  });

  it("returns 1 (never 0 or negative) for a passed deadline", () => {
    expect(daysUntilDeadline(isoIn(-DAY))).toBe(1);
  });
});

describe("sessionCadenceLabel", () => {
  it("reports no cadence for a single session", () => {
    expect(sessionCadenceLabel(1, 10)).toBe("One session before the deadline.");
  });

  it("reports 'every day' when one session lands per day", () => {
    expect(sessionCadenceLabel(5, 5)).toBe(
      "One session every day until the deadline.",
    );
  });

  it("reports 'every day' when there are more sessions than days", () => {
    expect(sessionCadenceLabel(8, 5)).toBe(
      "One session every day until the deadline.",
    );
  });

  it("reports the rounded bucket width for a coarser spread", () => {
    // 10 days / 5 sessions -> a 2-day window per session.
    expect(sessionCadenceLabel(5, 10)).toBe(
      "About every 2 days until the deadline.",
    );
  });

  it("rounds to the nearest day", () => {
    // 7 days / 2 sessions -> 3.5, rounds up to 4.
    expect(sessionCadenceLabel(2, 7)).toBe(
      "About every 4 days until the deadline.",
    );
  });

  it("guards against a non-positive day span", () => {
    expect(sessionCadenceLabel(5, 0)).toBe(
      "One session every day until the deadline.",
    );
  });
});
