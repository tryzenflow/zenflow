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

  it("materializes one occurrence per day for a daily rule across the week", () => {
    const days = occurrenceDays(
      "RRULE:FREQ=DAILY;INTERVAL=1",
      "week",
      anchor,
      TZ,
      WORK_START,
      WORKDAYS,
    );
    // Every day of the week — the weekend is no longer skipped.
    expect(days).toHaveLength(7);
    expect(days[0]).toBe(startStr); // anchored to the week's first day
    expect(days[days.length - 1]).toBe("2026-06-07"); // Sunday
  });

  it("steps 'every X days' across the window, incl. non-working days", () => {
    const days = occurrenceDays(
      "RRULE:FREQ=DAILY;INTERVAL=2",
      "week",
      anchor,
      TZ,
      WORK_START,
      WORKDAYS,
    );
    // Mon, Wed, Fri, Sun — the Sunday is no longer dropped.
    expect(days.map((d) => isoWeekday(d))).toEqual([1, 3, 5, 7]);
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

  it("keeps a chosen non-working day in a weekly BYDAY rule", () => {
    // BYDAY=MO,SA with Mon–Fri workdays: Saturday was chosen on purpose, so
    // both the Monday and the Saturday of the week must materialize.
    const days = occurrenceDays(
      "RRULE:FREQ=WEEKLY;BYDAY=MO,SA",
      "week",
      anchor,
      TZ,
      WORK_START,
      WORKDAYS,
    );
    // Mon 2026-06-01, Sat 2026-06-06 — the Saturday is NOT dropped.
    expect(days).toEqual(["2026-06-01", "2026-06-06"]);
    expect(days.map((d) => isoWeekday(d))).toEqual([1, 6]);
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

  it("stays inside the active month for a daily rule (every day, incl. weekends)", () => {
    const monthAnchor = "2026-06-15";
    const days = occurrenceDays(
      "RRULE:FREQ=DAILY;INTERVAL=1",
      "month",
      monthAnchor,
      TZ,
      WORK_START,
      WORKDAYS,
    );
    // Every calendar day of June 2026 — non-working days are no longer dropped.
    expect(days).toHaveLength(30);
    expect(days[0]).toBe("2026-06-01");
    expect(days[days.length - 1]).toBe("2026-06-30");
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
    expect(days).toEqual([
      "2026-06-03",
      "2026-06-04",
      "2026-06-05",
      "2026-06-06",
      "2026-06-07",
    ]);
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

  it("expands a month weekly BYDAY rule to every chosen weekday of the month", () => {
    // June 2026 Mondays: 06-01, 06-08, 06-15, 06-22, 06-29.
    //          Wednesdays: 06-03, 06-10, 06-17, 06-24.
    const days = occurrenceDays(
      "RRULE:FREQ=WEEKLY;BYDAY=MO,WE",
      "month",
      "2026-06-15",
      TZ,
      WORK_START,
      WORKDAYS,
    );
    expect(days).toEqual([
      "2026-06-01",
      "2026-06-03",
      "2026-06-08",
      "2026-06-10",
      "2026-06-15",
      "2026-06-17",
      "2026-06-22",
      "2026-06-24",
      "2026-06-29",
    ]);
    expect(days[0]).toBe("2026-06-01");
    expect(days.every((d) => WORKDAYS.includes(isoWeekday(d)))).toBe(true);
  });

  it("bounds a month weekly BYDAY rule by the deadline", () => {
    const days = occurrenceDays(
      "RRULE:FREQ=WEEKLY;BYDAY=MO,WE",
      "month",
      "2026-06-15",
      TZ,
      WORK_START,
      WORKDAYS,
      "2026-06-10", // only Mon/Wed on or before the 10th survive
    );
    expect(days).toEqual([
      "2026-06-01",
      "2026-06-03",
      "2026-06-08",
      "2026-06-10",
    ]);
  });

  it("floors a month weekly BYDAY rule at now and drops earlier weekdays", () => {
    const days = occurrenceDays(
      "RRULE:FREQ=WEEKLY;BYDAY=MO,WE",
      "month",
      "2026-06-15",
      TZ,
      WORK_START,
      WORKDAYS,
      undefined,
      "2026-06-15", // created mid-month — nothing before the 15th
    );
    expect(days).toEqual([
      "2026-06-15",
      "2026-06-17",
      "2026-06-22",
      "2026-06-24",
      "2026-06-29",
    ]);
  });

  it("keeps non-workday weekdays in a month weekly BYDAY rule", () => {
    // BYDAY=MO,SA — Saturday was chosen on purpose, so every Monday AND every
    // Saturday of June 2026 materializes (Saturdays are no longer dropped).
    const days = occurrenceDays(
      "RRULE:FREQ=WEEKLY;BYDAY=MO,SA",
      "month",
      "2026-06-15",
      TZ,
      WORK_START,
      WORKDAYS,
    );
    expect(days).toEqual([
      "2026-06-01", // Mon
      "2026-06-06", // Sat
      "2026-06-08", // Mon
      "2026-06-13", // Sat
      "2026-06-15", // Mon
      "2026-06-20", // Sat
      "2026-06-22", // Mon
      "2026-06-27", // Sat
      "2026-06-29", // Mon
    ]);
  });

  it("expands month 'weeks × weekdays' to the chosen weekday(s) of each chosen week", () => {
    // June 2026: June 1 is a Monday, so calendar-row 1 Monday = 06-01,
    // Wed = 06-03; row 3 Monday = 06-15, Wed = 06-17.
    const days = occurrenceDays(
      "RRULE:FREQ=MONTHLY;BYDAY=1MO,1WE,3MO,3WE",
      "month",
      "2026-06-15",
      TZ,
      WORK_START,
      WORKDAYS,
    );
    expect(days).toEqual([
      "2026-06-01", // row 1 Mon
      "2026-06-03", // row 1 Wed
      "2026-06-15", // row 3 Mon
      "2026-06-17", // row 3 Wed
    ]);
  });

  it("keeps a chosen non-working weekday in a month 'weeks × weekdays' rule", () => {
    // 1SA selects Saturday of calendar-row 1 (06-06) — a non-working day that
    // is kept because the user chose that weekday on purpose.
    const days = occurrenceDays(
      "RRULE:FREQ=MONTHLY;BYDAY=1MO,1SA",
      "month",
      "2026-06-15",
      TZ,
      WORK_START,
      WORKDAYS,
    );
    expect(days).toEqual(["2026-06-01", "2026-06-06"]);
    expect(days.map((d) => isoWeekday(d))).toEqual([1, 6]);
  });

  it("drops month 'weeks × weekdays' days that fall outside the month", () => {
    // Calendar-row 5 of June 2026 = week of Mon 06-29; its Wed (07-01) is in
    // July and must be dropped, while Mon 06-29 survives.
    const days = occurrenceDays(
      "RRULE:FREQ=MONTHLY;BYDAY=5MO,5WE",
      "month",
      "2026-06-15",
      TZ,
      WORK_START,
      WORKDAYS,
    );
    expect(days).toEqual(["2026-06-29"]);
  });

  it("bounds month 'weeks × weekdays' by the deadline too", () => {
    const days = occurrenceDays(
      "RRULE:FREQ=MONTHLY;BYDAY=1MO,1WE,3MO,3WE",
      "month",
      "2026-06-15",
      TZ,
      WORK_START,
      WORKDAYS,
      "2026-06-03", // due in week 1 — only the week-1 days up to the 3rd survive
    );
    expect(days).toEqual(["2026-06-01", "2026-06-03"]);
  });

  it("floors month 'weeks × weekdays' at now and drops the already-passed week", () => {
    const days = occurrenceDays(
      "RRULE:FREQ=MONTHLY;BYDAY=1MO,1WE,3MO,3WE",
      "month",
      "2026-06-15",
      TZ,
      WORK_START,
      WORKDAYS,
      undefined,
      "2026-06-15", // created mid-month — week 1 has already passed
    );
    expect(days).toEqual(["2026-06-15", "2026-06-17"]);
  });
});
