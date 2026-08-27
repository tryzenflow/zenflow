import { describe, expect, it } from "vitest";
import { deriveState, withOverlap } from "../task-card";

const NOW = new Date("2026-06-15T12:00:00.000Z");

describe("deriveState", () => {
  it("returns completed for DONE tasks regardless of other flags", () => {
    expect(
      deriveState(
        {
          status: "DONE",
          deadline: "2026-06-01T00:00:00.000Z",
          scheduledStartTime: null,
          durationMinutes: 30,
        },
        NOW,
      ),
    ).toBe("completed");
  });

  it("returns overdue once the deadline has passed", () => {
    expect(
      deriveState(
        {
          status: "PENDING",
          deadline: "2026-06-14T00:00:00.000Z",
          scheduledStartTime: "2026-06-13T09:00:00.000Z",
          durationMinutes: 30,
        },
        NOW,
      ),
    ).toBe("overdue");
  });

  it("returns overdue when the scheduled slot itself ends past the deadline", () => {
    expect(
      deriveState(
        {
          status: "PENDING",
          deadline: "2026-06-20T09:00:00.000Z",
          scheduledStartTime: "2026-06-20T08:45:00.000Z",
          durationMinutes: 30,
        },
        NOW,
      ),
    ).toBe("overdue");
  });

  it("returns fluid for a normal, on-time placement", () => {
    expect(
      deriveState(
        {
          status: "PENDING",
          deadline: "2026-06-20T09:00:00.000Z",
          scheduledStartTime: "2026-06-16T08:00:00.000Z",
          durationMinutes: 30,
        },
        NOW,
      ),
    ).toBe("fluid");
  });

  it("returns fluid when there's no deadline at all", () => {
    expect(
      deriveState(
        {
          status: "PENDING",
          deadline: null,
          scheduledStartTime: "2026-06-16T08:00:00.000Z",
          durationMinutes: 30,
        },
        NOW,
      ),
    ).toBe("fluid");
  });
});

describe("withOverlap", () => {
  it("folds an overlap into conflict for a fluid card", () => {
    expect(withOverlap("fluid", true)).toBe("conflict");
  });

  it("folds an overlap into conflict for an overdue card", () => {
    expect(withOverlap("overdue", true)).toBe("conflict");
  });

  it("leaves a non-overlapping card's state alone", () => {
    expect(withOverlap("fluid", false)).toBe("fluid");
  });

  it("never flags a completed card as conflicting, even if it overlaps", () => {
    expect(withOverlap("completed", true)).toBe("completed");
  });
});
