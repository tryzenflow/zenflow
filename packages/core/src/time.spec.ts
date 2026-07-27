import { describe, it, expect } from "@jest/globals";
import { minutesToHour, minutesToTime } from "./time";

describe("minutesToHour", () => {
  it("returns 12 AM for midnight", () => {
    expect(minutesToHour(0)).toBe("12 AM");
  });

  it("returns hour with AM for morning hours", () => {
    expect(minutesToHour(60)).toBe("1 AM");
    expect(minutesToHour(120)).toBe("2 AM");
    expect(minutesToHour(660)).toBe("11 AM");
  });

  it("returns 12 PM for noon", () => {
    expect(minutesToHour(720)).toBe("12 PM");
  });

  it("returns hour with PM for afternoon/evening hours", () => {
    expect(minutesToHour(780)).toBe("1 PM");
    expect(minutesToHour(1320)).toBe("10 PM");
  });

  it("returns 11:59 PM for DAILY_HORIZON (edge case guard)", () => {
    expect(minutesToHour(1440)).toBe("11:59 PM");
  });
});

describe("minutesToTime backward compatibility", () => {
  it("still returns full time with minutes", () => {
    expect(minutesToTime(60)).toBe("1:00 AM");
    expect(minutesToTime(720)).toBe("12:00 PM");
  });
});