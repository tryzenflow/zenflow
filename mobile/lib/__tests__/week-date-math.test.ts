import { describe, expect, it } from "vitest";
import {
  WEEK_STARTS_ON,
  dateKey,
  dayIndexInWeek,
  shiftDays,
  shiftWeek,
  weekDays,
  weekStart,
} from "../week-date-math";

describe("weekStart", () => {
  it("returns the preceding Monday for a mid-week day", () => {
    // Thu Aug 13 2026 → Mon Aug 10 2026.
    expect(weekStart(new Date(2026, 7, 13))).toEqual(new Date(2026, 7, 10));
  });

  it("returns the day itself when it is a Monday", () => {
    expect(weekStart(new Date(2026, 7, 10))).toEqual(new Date(2026, 7, 10));
  });

  it("wraps backwards for a Sunday", () => {
    // Sun Aug 16 2026 → Mon Aug 10 2026.
    expect(weekStart(new Date(2026, 7, 16))).toEqual(new Date(2026, 7, 10));
  });
});

describe("weekDays", () => {
  it("returns 7 consecutive days, Monday first, ending on Sunday", () => {
    const days = weekDays(new Date(2026, 7, 13));
    expect(days).toHaveLength(7);
    expect(days[0]).toEqual(new Date(2026, 7, 10));
    expect(days[6]).toEqual(new Date(2026, 7, 16));
    for (let i = 1; i < days.length; i++) {
      expect(days[i].getTime() - days[i - 1].getTime()).toBe(24 * 60 * 60 * 1000);
    }
  });

  it("zeroes the time component of every day", () => {
    for (const day of weekDays(new Date(2026, 7, 13, 14, 30))) {
      expect(day.getHours()).toBe(0);
      expect(day.getMinutes()).toBe(0);
      expect(day.getSeconds()).toBe(0);
      expect(day.getMilliseconds()).toBe(0);
    }
  });
});

describe("dayIndexInWeek", () => {
  it("maps Monday to 0 and Sunday to 6", () => {
    // Aug 10 2026 is a Monday, Aug 16 a Sunday.
    expect(dayIndexInWeek(new Date(2026, 7, 10))).toBe(0);
    expect(dayIndexInWeek(new Date(2026, 7, 11))).toBe(1);
    expect(dayIndexInWeek(new Date(2026, 7, 16))).toBe(6);
  });
});

describe("shiftWeek", () => {
  it("shifts by whole weeks preserving the weekday", () => {
    const tue = new Date(2026, 7, 11);
    expect(shiftWeek(tue, 1)).toEqual(new Date(2026, 7, 18));
    expect(shiftWeek(tue, -1)).toEqual(new Date(2026, 7, 4));
    expect(shiftWeek(tue, 0)).toEqual(tue);
  });
});

describe("shiftDays", () => {
  it("shifts by days across week boundaries", () => {
    const sun = new Date(2026, 7, 16);
    expect(shiftDays(sun, 1)).toEqual(new Date(2026, 7, 17));
    expect(shiftDays(sun, -1)).toEqual(new Date(2026, 7, 15));
  });
});

describe("dateKey", () => {
  it("formats with zero-padded month and day", () => {
    expect(dateKey(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(dateKey(new Date(2026, 10, 23))).toBe("2026-11-23");
  });
});

describe("WEEK_STARTS_ON", () => {
  it("is Monday-first", () => {
    expect(WEEK_STARTS_ON).toBe(1);
  });
});
