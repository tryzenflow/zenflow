import { describe, expect, it } from "vitest";
import { deriveState } from "../task-card";

const NOW = new Date("2026-06-15T12:00:00.000Z");

describe("deriveState", () => {
  it("returns completed for DONE tasks regardless of other flags", () => {
    expect(
      deriveState(
        {
          status: "DONE",
          conflict: true,
          deadline: "2026-06-01T00:00:00.000Z",
          scheduledStartTime: null,
          durationMinutes: 30,
        },
        NOW,
      ),
    ).toBe("completed");
  });

  it("returns conflict for unresolved conflicts", () => {
    expect(
      deriveState(
        {
          status: "PENDING",
          conflict: true,
          deadline: null,
          scheduledStartTime: null,
          durationMinutes: 30,
        },
        NOW,
      ),
    ).toBe("conflict");
  });

  it("returns overdue once the deadline has passed", () => {
    expect(
      deriveState(
        {
          status: "PENDING",
          conflict: false,
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
          conflict: false,
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
          conflict: false,
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
          conflict: false,
          deadline: null,
          scheduledStartTime: "2026-06-16T08:00:00.000Z",
          durationMinutes: 30,
        },
        NOW,
      ),
    ).toBe("fluid");
  });
});
