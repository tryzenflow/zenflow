import { describe, expect, it } from "vitest";
import {
  checkInActionOf,
  checkInSessionIds,
  dateToTime,
  isCheckInCategory,
  timeToDate,
} from "../daily-push";

describe("daily push times", () => {
  it("round-trips HH:mm through the picker's Date", () => {
    expect(dateToTime(timeToDate("07:05"))).toBe("07:05");
    expect(dateToTime(timeToDate("23:59"))).toBe("23:59");
  });

  it("zero-pads hours and minutes", () => {
    const d = new Date(2026, 9, 14, 3, 4);
    expect(dateToTime(d)).toBe("03:04");
  });
});

describe("check-in push payload", () => {
  it("reads the comma-separated session ids", () => {
    expect(
      checkInSessionIds("a1b2,c3d4::2026-10-14T01:00:00.000Z, e5 ,"),
    ).toEqual(["a1b2", "c3d4::2026-10-14T01:00:00.000Z", "e5"]);
  });

  it("drops duplicates and caps the list", () => {
    const many = Array.from({ length: 20 }, (_, i) => `s${i}`).join(",");
    const ids = checkInSessionIds(`s1,s1,${many}`);
    expect(ids).toHaveLength(12);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("returns nothing for a missing or non-string value", () => {
    expect(checkInSessionIds(undefined)).toEqual([]);
    expect(checkInSessionIds(42)).toEqual([]);
  });

  it("maps the button identifiers to actions", () => {
    expect(checkInActionOf("done")).toBe("done");
    expect(checkInActionOf("missed")).toBe("missed");
    expect(checkInActionOf("reschedule")).toBeNull();
    expect(checkInActionOf("expo.default")).toBeNull();
  });

  it("recognizes the check-in category only", () => {
    expect(isCheckInCategory("daily_checkin")).toBe(true);
    expect(isCheckInCategory("sync_conflict")).toBe(false);
    expect(isCheckInCategory(undefined)).toBe(false);
  });
});
