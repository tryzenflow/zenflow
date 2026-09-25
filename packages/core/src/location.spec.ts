import { describe, expect, it } from "@jest/globals";
import { displayLocation, isOnlineLocation } from "./location";

describe("isOnlineLocation", () => {
  it.each([
    "https://meet.google.com/abc-defg-hij",
    "http://example.com",
    "www.zoom.us/j/123",
    "meet.google.com/abc-defg-hij",
    "zoom.us/j/123456789",
  ])("treats %s as online", (s) => {
    expect(isOnlineLocation(s)).toBe(true);
  });

  it.each(["A2.301", "Phòng 204, nhà A9", "Library", "B.12"])(
    "treats %s as a room",
    (s) => {
      expect(isOnlineLocation(s)).toBe(false);
    },
  );

  it("labels a link Online and leaves a room as-is", () => {
    expect(displayLocation("https://meet.google.com/x")).toBe("Online");
    expect(displayLocation("A2.301")).toBe("A2.301");
  });
});
