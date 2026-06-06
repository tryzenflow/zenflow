import { occurrenceDays } from "./recurrence";
import { viewDayRange } from "../../scheduler/horizon";
import { isoWeekday } from "../../scheduler/slot";

const TZ = "UTC";
const WORK_START = 540; // 09:00

describe("occurrenceDays", () => {
  // A mid-week anchor; the series must still span the whole window.
  const anchor = "2026-06-03";
  const { startStr, endStr } = viewDayRange("week", anchor);

  it("materializes one occurrence per day for a daily rule across the week (7)", () => {
    const days = occurrenceDays(
      "RRULE:FREQ=DAILY;INTERVAL=1",
      "week",
      anchor,
      TZ,
      WORK_START,
    );
    expect(days).toHaveLength(7);
    expect(days[0]).toBe(startStr); // anchored to the week's first day, not the click
    expect(days[days.length - 1]).toBe(endStr);
    expect(new Set(days).size).toBe(7); // distinct days
  });

  it("expands a weekly BYDAY rule to just the chosen weekdays", () => {
    const days = occurrenceDays(
      "RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR",
      "week",
      anchor,
      TZ,
      WORK_START,
    );
    expect(days).toHaveLength(3);
    // Mon(1) Wed(3) Fri(5)
    expect(days.map((d) => isoWeekday(d))).toEqual([1, 3, 5]);
  });

  it("collapses a non-recurring task to its single anchor day", () => {
    expect(occurrenceDays("", "week", anchor, TZ, WORK_START)).toEqual([anchor]);
  });

  it("never recurs in day view", () => {
    expect(
      occurrenceDays("RRULE:FREQ=DAILY;INTERVAL=1", "day", anchor, TZ, WORK_START),
    ).toEqual([anchor]);
  });

  it("stays inside the active month for a daily rule", () => {
    const monthAnchor = "2026-06-15";
    const days = occurrenceDays(
      "RRULE:FREQ=DAILY;INTERVAL=1",
      "month",
      monthAnchor,
      TZ,
      WORK_START,
    );
    expect(days).toHaveLength(30); // June has 30 days
    expect(days[0]).toBe("2026-06-01");
    expect(days[days.length - 1]).toBe("2026-06-30");
  });
});
