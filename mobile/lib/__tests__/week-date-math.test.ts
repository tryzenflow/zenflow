import { describe, expect, it } from "vitest";
import {
  WEEK_STARTS_ON,
  centeredDays,
  dateKey,
  dayIndexInWeek,
  shiftDays,
  shiftWeek,
  weekDays,
  weekHeaderBlocks,
  weekStart,
} from "../week-date-math";

const DAY_MS = 24 * 60 * 60 * 1000;

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
      expect(days[i].getTime() - days[i - 1].getTime()).toBe(
        24 * 60 * 60 * 1000,
      );
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

describe("centeredDays", () => {
  it("returns the day with its two neighbors, focused in the middle", () => {
    const wed = new Date(2026, 7, 12);
    const days = centeredDays(wed);
    expect(days).toHaveLength(3);
    expect(days[0]).toEqual(new Date(2026, 7, 11));
    expect(days[1]).toEqual(wed);
    expect(days[2]).toEqual(new Date(2026, 7, 13));
    for (let i = 1; i < days.length; i++) {
      expect(days[i].getTime() - days[i - 1].getTime()).toBe(
        24 * 60 * 60 * 1000,
      );
    }
  });

  it("wraps across month boundaries", () => {
    // Mon Aug 31 2026 → Aug 30 … Sep 1.
    const days = centeredDays(new Date(2026, 7, 31));
    expect(days[0]).toEqual(new Date(2026, 7, 30));
    expect(days[2]).toEqual(new Date(2026, 8, 1));
  });

  it("wraps across year boundaries", () => {
    const days = centeredDays(new Date(2026, 0, 1));
    expect(days[0]).toEqual(new Date(2025, 11, 31));
    expect(days[2]).toEqual(new Date(2026, 0, 2));
  });
});

describe("weekHeaderBlocks", () => {
  it("returns 3 blocks of 7 Monday-first consecutive days", () => {
    const blocks = weekHeaderBlocks(new Date(2026, 7, 13));
    expect(blocks).toHaveLength(3);
    for (const block of blocks) {
      expect(block).toHaveLength(7);
      expect(dayIndexInWeek(block[0])).toBe(0);
      for (let i = 1; i < block.length; i++) {
        expect(block[i].getTime() - block[i - 1].getTime()).toBe(DAY_MS);
      }
    }
  });

  it("puts the anchored week in the middle block", () => {
    const anchor = new Date(2026, 7, 13);
    expect(weekHeaderBlocks(anchor)[1]).toEqual(weekDays(anchor));
  });

  it("starts the neighbours exactly one week before / after the middle", () => {
    const blocks = weekHeaderBlocks(new Date(2026, 7, 13));
    expect(blocks[1][0].getTime() - blocks[0][0].getTime()).toBe(7 * DAY_MS);
    expect(blocks[2][0].getTime() - blocks[1][0].getTime()).toBe(7 * DAY_MS);
  });

  it("wraps across month boundaries", () => {
    // Mon Aug 31 2026 → prev week starts Aug 24, next week starts Sep 7.
    const blocks = weekHeaderBlocks(new Date(2026, 7, 31));
    expect(blocks[0][0]).toEqual(new Date(2026, 7, 24));
    expect(blocks[1][0]).toEqual(new Date(2026, 7, 31));
    expect(blocks[2][0]).toEqual(new Date(2026, 8, 7));
  });

  it("wraps across year boundaries", () => {
    // Thu Jan 1 2026 sits in the week starting Mon Dec 29 2025.
    const blocks = weekHeaderBlocks(new Date(2026, 0, 1));
    expect(blocks[0][0]).toEqual(new Date(2025, 11, 22));
    expect(blocks[1][0]).toEqual(new Date(2025, 11, 29));
    expect(blocks[2][0]).toEqual(new Date(2026, 0, 5));
  });

  it("zeroes the time component of every day", () => {
    for (const block of weekHeaderBlocks(new Date(2026, 7, 13, 14, 30))) {
      for (const day of block) {
        expect(day.getHours()).toBe(0);
        expect(day.getMinutes()).toBe(0);
        expect(day.getSeconds()).toBe(0);
        expect(day.getMilliseconds()).toBe(0);
      }
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
