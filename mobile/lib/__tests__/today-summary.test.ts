import type { Session } from "@zenflow/shared";
import { describe, expect, it } from "vitest";
import {
  checkStateOf,
  formatHours,
  greetingKey,
  summarizeToday,
} from "../today-summary";

const session = (overrides: Partial<Session> & { id: string }): Session =>
  ({
    title: overrides.id,
    durationMinutes: 60,
    scheduledStartTime: "2026-10-15T02:00:00.000Z",
    completedAt: null,
    skipped: false,
    ...overrides,
  }) as Session;

const NOW = new Date("2026-10-15T03:00:00.000Z");

describe("summarizeToday", () => {
  it("counts sessions that are not skipped and sums their planned time", () => {
    const sessions = [
      session({ id: "a", durationMinutes: 60 }),
      session({ id: "b", durationMinutes: 90, completedAt: "2026-10-15T02:30:00.000Z" }),
      session({ id: "c", durationMinutes: 45, skipped: true }),
    ];
    expect(summarizeToday(sessions, NOW)).toMatchObject({
      total: 2,
      done: 1,
      plannedMinutes: 150,
    });
  });

  it("points at the first open session that has not started yet", () => {
    const sessions = [
      session({ id: "past", scheduledStartTime: "2026-10-15T01:00:00.000Z" }),
      session({ id: "later", title: "Later", scheduledStartTime: "2026-10-15T06:00:00.000Z" }),
      session({ id: "soonest", title: "Soonest", scheduledStartTime: "2026-10-15T04:00:00.000Z" }),
    ];
    expect(summarizeToday(sessions, NOW).nextUp).toEqual({
      id: "soonest",
      title: "Soonest",
      startISO: "2026-10-15T04:00:00.000Z",
    });
  });

  it("has no next session once everything has started or is done", () => {
    const sessions = [
      session({ id: "a", scheduledStartTime: "2026-10-15T01:00:00.000Z" }),
      session({ id: "b", scheduledStartTime: "2026-10-15T05:00:00.000Z", completedAt: "2026-10-15T05:00:00.000Z" }),
    ];
    expect(summarizeToday(sessions, NOW).nextUp).toBeNull();
  });

  it("is empty for a day with no sessions", () => {
    expect(summarizeToday([], NOW)).toEqual({
      total: 0,
      done: 0,
      plannedMinutes: 0,
      nextUp: null,
    });
  });
});

describe("checkStateOf", () => {
  it("reads done before skipped, and open when neither is set", () => {
    expect(checkStateOf({ completedAt: "2026-10-15T00:00:00.000Z", skipped: false })).toBe("done");
    expect(checkStateOf({ completedAt: null, skipped: true })).toBe("skipped");
    expect(checkStateOf({ completedAt: null, skipped: false })).toBe("open");
  });
});

describe("greetingKey", () => {
  it("switches at noon and at 18:00", () => {
    expect(greetingKey(0)).toBe("morning");
    expect(greetingKey(11)).toBe("morning");
    expect(greetingKey(12)).toBe("afternoon");
    expect(greetingKey(17)).toBe("afternoon");
    expect(greetingKey(18)).toBe("evening");
  });
});

describe("formatHours", () => {
  it("rounds to one decimal and drops a trailing .0", () => {
    expect(formatHours(270)).toBe("4.5");
    expect(formatHours(120)).toBe("2");
    expect(formatHours(20)).toBe("0.3");
  });
});
