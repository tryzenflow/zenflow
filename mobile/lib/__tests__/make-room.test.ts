import type { PlacementPlan, Session } from "@zenflow/shared";
import { describe, expect, it } from "vitest";
import { getPlacementPlan, roomTimelines } from "../make-room";
import { makeSession } from "../../test/fixtures";

const plan: PlacementPlan = {
  id: "plan-1",
  sessionId: null,
  start: "2026-10-15T03:00:00.000Z",
  moves: [
    {
      id: "chosen",
      from: "2026-10-15T03:00:00.000Z",
      to: "2026-10-15T05:00:00.000Z",
      anchor: "CHOSEN",
      cost: 10,
    },
  ],
  expiresAt: "2026-10-15T04:00:00.000Z",
};

const sessions: Session[] = [
  makeSession({
    id: "chosen",
    title: "Lab report",
    durationMinutes: 45,
    scheduledStartTime: "2026-10-15T03:00:00.000Z",
    anchor: "CHOSEN",
  }),
];

describe("getPlacementPlan", () => {
  it("reads the plan from a 409 NEEDS_CONFIRMATION body", () => {
    const error = {
      isAxiosError: true,
      response: {
        status: 409,
        data: { code: "NEEDS_CONFIRMATION", data: { plan } },
      },
    };
    expect(getPlacementPlan(error)).toEqual(plan);
  });

  it("returns null for other errors", () => {
    expect(
      getPlacementPlan({
        isAxiosError: true,
        response: { status: 409, data: { code: "SCHEDULE_INFEASIBLE" } },
      }),
    ).toBeNull();
    expect(getPlacementPlan(new Error("network"))).toBeNull();
  });
});

describe("roomTimelines", () => {
  it("shows a moved session where it was before and where the plan puts it after", () => {
    const { before, after } = roomTimelines(plan, sessions, "Urgent essay", 60);
    expect(before).toEqual([
      {
        id: "chosen",
        title: "Lab report",
        start: "2026-10-15T03:00:00.000Z",
        durationMinutes: 45,
        moved: true,
      },
    ]);
    expect(after.map((row) => [row.title, row.moved])).toEqual([
      ["Urgent essay", false],
      ["Lab report", true],
    ]);
  });

  it("names the new session from the caller and gives it the plan start", () => {
    const { after } = roomTimelines(plan, sessions, "Urgent essay", 90);
    const placed = after.find((row) => !row.moved);
    expect(placed).toEqual({
      id: "new",
      title: "Urgent essay",
      start: "2026-10-15T03:00:00.000Z",
      durationMinutes: 90,
      moved: false,
    });
  });

  it("uses the session's own title and length when the plan places an existing one", () => {
    const movePlan: PlacementPlan = { ...plan, sessionId: "chosen" };
    const { before, after } = roomTimelines(movePlan, sessions, "unused", 60);
    expect(before.map((row) => row.id)).toEqual(["chosen", "chosen"]);
    const placed = after.find((row) => row.id === "chosen" && !row.moved);
    expect(placed?.title).toBe("Lab report");
    expect(placed?.durationMinutes).toBe(45);
  });
});
