import { describe, expect, it } from "vitest";
import {
  type PlanBlock,
  anchorMark,
  dropOnDay,
  dropPreview,
  isImmovable,
} from "../anchor";
import { makeSession } from "../../test/fixtures";

const block = (
  id: string,
  startMin: number,
  durationMin: number,
  immovable = false,
): PlanBlock => ({ id, startMin, durationMin, immovable });

const dragged = { id: "d", durationMin: 60 };

describe("anchorMark", () => {
  it("marks a chosen time with a hand and a pin with a lock", () => {
    expect(anchorMark("CHOSEN")).toBe("hand");
    expect(anchorMark("PINNED")).toBe("lock");
  });

  it("marks nothing for an auto or unknown anchor", () => {
    expect(anchorMark("AUTO")).toBeNull();
    expect(anchorMark(undefined)).toBeNull();
  });
});

describe("isImmovable", () => {
  it("is true for fixed types, pinned and completed sessions", () => {
    expect(isImmovable({ type: "LECTURE" })).toBe(true);
    expect(isImmovable({ type: "EXAM" })).toBe(true);
    expect(isImmovable({ type: "TASK", anchor: "PINNED" })).toBe(true);
    expect(isImmovable({ type: "TASK", completedAt: "2026-10-15T01:00:00Z" })).toBe(true);
  });

  it("is false for an auto or chosen task", () => {
    expect(isImmovable({ type: "TASK", anchor: "AUTO" })).toBe(false);
    expect(isImmovable({ type: "TASK", anchor: "CHOSEN" })).toBe(false);
  });
});

describe("dropPreview", () => {
  it("shows no ghosts on a clear slot", () => {
    expect(dropPreview(dragged, 600, [block("x", 900, 60)])).toEqual({
      blocked: false,
      ghosts: [],
    });
  });

  it("bounces a drop onto a pinned block", () => {
    const pinned = block("p", 600, 60, true);
    expect(dropPreview(dragged, 630, [pinned])).toEqual({
      blocked: true,
      by: "p",
      ghosts: [],
    });
  });

  it("bounces a drop onto a fixed block that only touches an edge", () => {
    const fixed = block("f", 660, 60, true);
    // 600 to 660 ends exactly where the fixed block starts: no overlap.
    expect(dropPreview(dragged, 600, [fixed]).blocked).toBe(false);
    expect(dropPreview(dragged, 615, [fixed]).blocked).toBe(true);
  });

  it("pushes a movable block the drop runs into to the end of the dropped block", () => {
    const result = dropPreview(dragged, 600, [block("a", 630, 45)]);
    expect(result).toEqual({
      blocked: false,
      ghosts: [{ id: "a", fromMin: 630, toMin: 660, durationMin: 45 }],
    });
  });

  it("cascades a chain of movable blocks in start order", () => {
    const result = dropPreview(dragged, 600, [
      block("b", 690, 30),
      block("a", 650, 60),
    ]);
    expect(result.blocked).toBe(false);
    if (result.blocked) return;
    expect(result.ghosts).toEqual([
      { id: "a", fromMin: 650, toMin: 660, durationMin: 60 },
      { id: "b", fromMin: 690, toMin: 720, durationMin: 30 },
    ]);
  });

  it("stops the cascade at a gap wide enough to hold the pushed blocks", () => {
    const result = dropPreview(dragged, 600, [block("a", 650, 30), block("z", 900, 30)]);
    if (result.blocked) throw new Error("unexpected block");
    expect(result.ghosts.map((g) => g.id)).toEqual(["a"]);
  });

  it("blocks when a pushed block would land on a pinned block", () => {
    const result = dropPreview(dragged, 600, [
      block("a", 630, 60),
      block("p", 680, 30, true),
    ]);
    expect(result).toEqual({ blocked: true, by: "p", ghosts: [] });
  });

  it("blocks when a pushed block would run past the end of the day", () => {
    const result = dropPreview(dragged, 1380, [block("a", 1400, 30)], 1440);
    expect(result).toEqual({ blocked: true, by: "a", ghosts: [] });
  });

  it("ignores the dragged block itself and blocks that end before the drop", () => {
    const result = dropPreview(dragged, 600, [
      block("d", 600, 60),
      block("early", 480, 60),
    ]);
    expect(result).toEqual({ blocked: false, ghosts: [] });
  });
});

describe("dropOnDay", () => {
  // Asia/Ho_Chi_Minh is UTC+7: 03:00Z is 10:00, 07:00Z is 14:00 on the 15th.
  const TZ = "Asia/Ho_Chi_Minh";
  const dragged = makeSession({
    id: "drag",
    type: "TASK",
    anchor: "AUTO",
    durationMinutes: 60,
    scheduledStartTime: "2026-10-15T07:00:00.000Z",
  });
  const pinned = makeSession({
    id: "pinned",
    type: "TASK",
    anchor: "PINNED",
    durationMinutes: 60,
    scheduledStartTime: "2026-10-15T03:00:00.000Z",
  });

  it("bounces a drop onto a pinned session on the same local day", () => {
    const result = dropOnDay(dragged, "2026-10-15T03:30:00.000Z", [dragged, pinned], TZ);
    expect(result).toEqual({ blocked: true, by: "pinned", ghosts: [] });
  });

  it("ignores a pinned session on another local day", () => {
    const nextDay = { ...pinned, scheduledStartTime: "2026-10-16T03:00:00.000Z" };
    const result = dropOnDay(dragged, "2026-10-15T03:30:00.000Z", [dragged, nextDay], TZ);
    expect(result.blocked).toBe(false);
  });

  it("uses the user's timezone for the day, not UTC", () => {
    // 17:00Z on the 15th is 00:00 on the 16th in Ho Chi Minh, so it is not the dropped day
    // (in UTC it would be the same day and block).
    const late = { ...pinned, scheduledStartTime: "2026-10-15T17:00:00.000Z" };
    const result = dropOnDay(dragged, "2026-10-15T03:30:00.000Z", [dragged, late], TZ);
    expect(result.blocked).toBe(false);
  });
});
