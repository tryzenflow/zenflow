import { describe, expect, it } from "vitest";
import { isPastDeadlineDrop, isSessionPastDeadline } from "../overdue";

describe("isPastDeadlineDrop", () => {
  it("is false when there is no deadline", () => {
    expect(isPastDeadlineDrop("2026-03-02T09:00:00Z", null)).toBe(false);
    expect(isPastDeadlineDrop("2026-03-02T09:00:00Z", undefined)).toBe(false);
  });

  it("is true when the new start is after the deadline", () => {
    expect(
      isPastDeadlineDrop("2026-03-02T10:00:00Z", "2026-03-02T09:00:00Z"),
    ).toBe(true);
  });

  it("is false when the new start is at or before the deadline", () => {
    expect(
      isPastDeadlineDrop("2026-03-02T09:00:00Z", "2026-03-02T09:00:00Z"),
    ).toBe(false);
    expect(
      isPastDeadlineDrop("2026-03-01T09:00:00Z", "2026-03-02T09:00:00Z"),
    ).toBe(false);
  });
});

describe("isSessionPastDeadline", () => {
  it("is false without both a start and a deadline", () => {
    expect(isSessionPastDeadline({})).toBe(false);
    expect(
      isSessionPastDeadline({ scheduledStartTime: "2026-03-02T10:00:00Z" }),
    ).toBe(false);
    expect(isSessionPastDeadline({ deadline: "2026-03-02T09:00:00Z" })).toBe(
      false,
    );
  });

  it("is true only when the scheduled start runs past the deadline", () => {
    expect(
      isSessionPastDeadline({
        scheduledStartTime: "2026-03-02T10:00:00Z",
        deadline: "2026-03-02T09:00:00Z",
      }),
    ).toBe(true);
    expect(
      isSessionPastDeadline({
        scheduledStartTime: "2026-03-02T08:00:00Z",
        deadline: "2026-03-02T09:00:00Z",
      }),
    ).toBe(false);
  });
});
