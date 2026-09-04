import { describe, expect, it } from "vitest";
import { combineToUtc, shiftHhmm, splitZoned } from "../session-time";

// UTC+7, no DST — the tz the plan's manual-QA matrix pins to.
const TZ = "Asia/Saigon";

describe("combineToUtc / splitZoned round-trip", () => {
  it("splitZoned(combineToUtc(x)) is the identity for Asia/Saigon", () => {
    const cases = [
      { date: "2026-03-02", startTime: "09:00" },
      { date: "2026-03-02", startTime: "18:30" },
      { date: "2026-01-01", startTime: "00:00" },
      { date: "2026-12-31", startTime: "23:45" },
    ];
    for (const c of cases) {
      expect(splitZoned(combineToUtc(c.date, c.startTime, TZ), TZ)).toEqual(c);
    }
  });

  it("emits a true UTC instant 7h behind the Saigon wall clock", () => {
    // 09:00 in UTC+7 is 02:00Z the same calendar day.
    expect(combineToUtc("2026-03-02", "09:00", TZ)).toBe(
      "2026-03-02T02:00:00.000Z",
    );
    // An evening press stays on the same calendar day (no +1d rollover).
    expect(splitZoned(combineToUtc("2026-03-02", "18:00", TZ), TZ)).toEqual({
      date: "2026-03-02",
      startTime: "18:00",
    });
  });

  it("keeps every start on the 15-minute grid across a round-trip", () => {
    for (let m = 0; m <= 23 * 60 + 45; m += 15) {
      const startTime = `${String(Math.floor(m / 60)).padStart(
        2,
        "0",
      )}:${String(m % 60).padStart(2, "0")}`;
      const back = splitZoned(combineToUtc("2026-06-15", startTime, TZ), TZ);
      expect(back.startTime).toBe(startTime);
      expect(Number(back.startTime.split(":")[1]) % 15).toBe(0);
    }
  });
});

describe("shiftHhmm", () => {
  it("adds minutes on the grid", () => {
    expect(shiftHhmm("09:00", 60)).toBe("10:00");
    expect(shiftHhmm("09:15", 45)).toBe("10:00");
  });

  it("clamps to the latest 15-min start", () => {
    expect(shiftHhmm("23:15", 60)).toBe("23:45");
    expect(shiftHhmm("23:45", 60)).toBe("23:45");
  });
});
