import { occurrenceDays } from "./recurrence";
import { viewDayRange } from "../../scheduler/horizon";
import { isoWeekday } from "../../scheduler/slot";

const TZ = "UTC";
const WORK_START = 540; // 09:00
const WORKDAYS = [1, 2, 3, 4, 5]; // Mon–Fri

describe("occurrenceDays", () => {
  // A mid-week anchor (Wed); the series must still span the whole window.
  const anchor = "2026-06-03";
  const { startStr } = viewDayRange("week", anchor); // Mon 2026-06-01

  it("materializes one occurrence per working day for a daily rule across the week", () => {
    const days = occurrenceDays(
      "RRULE:FREQ=DAILY;INTERVAL=1",
      "week",
      anchor,
      TZ,
      WORK_START,
      WORKDAYS,
    );
    // The weekend is skipped — only the five working days remain.
    expect(days).toHaveLength(5);
    expect(days[0]).toBe(startStr); // anchored to the week's first day
    expect(days.every((d) => WORKDAYS.includes(isoWeekday(d)))).toBe(true);
  });

  it("steps 'every X days' over working days only", () => {
    const days = occurrenceDays(
      "RRULE:FREQ=DAILY;INTERVAL=2",
      "week",
      anchor,
      TZ,
      WORK_START,
      WORKDAYS,
    );
    // Mon, Wed, Fri, (Sun→dropped) → three working days.
    expect(days.map((d) => isoWeekday(d))).toEqual([1, 3, 5]);
  });

  it("expands a weekly BYDAY rule to just the chosen weekdays", () => {
    const days = occurrenceDays(
      "RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR",
      "week",
      anchor,
      TZ,
      WORK_START,
      WORKDAYS,
    );
    expect(days).toHaveLength(3);
    // Mon(1) Wed(3) Fri(5)
    expect(days.map((d) => isoWeekday(d))).toEqual([1, 3, 5]);
  });

  it("collapses a non-recurring task to its single anchor day", () => {
    expect(
      occurrenceDays("", "week", anchor, TZ, WORK_START, WORKDAYS),
    ).toEqual([anchor]);
  });

  it("never recurs in day view", () => {
    expect(
      occurrenceDays(
        "RRULE:FREQ=DAILY;INTERVAL=1",
        "day",
        anchor,
        TZ,
        WORK_START,
        WORKDAYS,
      ),
    ).toEqual([anchor]);
  });

  it("stays inside the active month and skips non-working days for a daily rule", () => {
    const monthAnchor = "2026-06-15";
    const days = occurrenceDays(
      "RRULE:FREQ=DAILY;INTERVAL=1",
      "month",
      monthAnchor,
      TZ,
      WORK_START,
      WORKDAYS,
    );
    expect(days).toHaveLength(22); // June 2026 has 22 working days
    expect(days[0]).toBe("2026-06-01");
    expect(days[days.length - 1]).toBe("2026-06-30");
    expect(days.every((d) => WORKDAYS.includes(isoWeekday(d)))).toBe(true);
  });

  it("starts recurrence from the floor day (now), not the window start", () => {
    // Created Wednesday: Mon/Tue have passed, so the week series begins Wed.
    const days = occurrenceDays(
      "RRULE:FREQ=DAILY;INTERVAL=1",
      "week",
      anchor,
      TZ,
      WORK_START,
      WORKDAYS,
      undefined,
      "2026-06-03", // floor = Wed
    );
    expect(days).toEqual(["2026-06-03", "2026-06-04", "2026-06-05"]);
  });

  it("floors month recurrence at now and skips the already-passed weeks", () => {
    const days = occurrenceDays(
      "RRULE:FREQ=DAILY;INTERVAL=1",
      "month",
      "2026-06-15",
      TZ,
      WORK_START,
      WORKDAYS,
      undefined,
      "2026-06-15", // created mid-month
    );
    expect(days[0]).toBe("2026-06-15");
    expect(days[days.length - 1]).toBe("2026-06-30");
    expect(days.every((d) => d >= "2026-06-15")).toBe(true);
  });

  it("never materializes occurrences past the deadline", () => {
    // Daily across the week, but the task is due Wednesday 2026-06-03.
    const days = occurrenceDays(
      "RRULE:FREQ=DAILY;INTERVAL=1",
      "week",
      anchor,
      TZ,
      WORK_START,
      WORKDAYS,
      "2026-06-03",
    );
    expect(days).toEqual(["2026-06-01", "2026-06-02", "2026-06-03"]);
  });

  it("bounds month 'specific weeks' by the deadline too", () => {
    const days = occurrenceDays(
      "RRULE:FREQ=MONTHLY;BYDAY=1MO,3MO",
      "month",
      "2026-06-15",
      TZ,
      WORK_START,
      WORKDAYS,
      "2026-06-03", // due before week 3 — only week 1 days up to the 3rd survive
    );
    expect(days).toEqual(["2026-06-01", "2026-06-02", "2026-06-03"]);
  });

  it("expands month 'specific weeks' to every working day of each chosen week", () => {
    // BYDAY=1MO,3MO encodes weeks 1 and 3 of June 2026.
    const days = occurrenceDays(
      "RRULE:FREQ=MONTHLY;BYDAY=1MO,3MO",
      "month",
      "2026-06-15",
      TZ,
      WORK_START,
      WORKDAYS,
    );
    expect(days).toEqual([
      // Week 1 (Mon 06-01 …) — working days within June.
      "2026-06-01",
      "2026-06-02",
      "2026-06-03",
      "2026-06-04",
      "2026-06-05",
      // Week 3 (Mon 06-15 …).
      "2026-06-15",
      "2026-06-16",
      "2026-06-17",
      "2026-06-18",
      "2026-06-19",
    ]);
  });
});
