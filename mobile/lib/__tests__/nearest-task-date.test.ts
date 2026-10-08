import type { Session } from "@zenflow/shared";
import { describe, expect, it } from "vitest";
import { nearestDayWithTask } from "../nearest-day";

const session = (type: Session["type"], iso: string) =>
  ({ id: `${type}-${iso}`, type, scheduledStartTime: iso }) as Session;

const from = new Date(2026, 9, 8); // Oct 8

describe("nearestDayWithTask", () => {
  it("ignores lectures, assignments and exams", () => {
    const sessions = [
      session("LECTURE", "2026-10-08T03:00:00.000Z"),
      session("ASSIGNMENT", "2026-10-09T03:00:00.000Z"),
      session("EXAM", "2026-10-10T03:00:00.000Z"),
    ];
    expect(nearestDayWithTask(sessions, from, "UTC")).toBeNull();
  });

  it("finds the nearest task day past a timetable", () => {
    const sessions = [
      session("LECTURE", "2026-10-08T03:00:00.000Z"),
      session("TASK", "2026-10-12T03:00:00.000Z"),
      session("TASK", "2026-10-20T03:00:00.000Z"),
    ];
    const day = nearestDayWithTask(sessions, from, "UTC");
    expect(day?.getDate()).toBe(12);
  });

  it("prefers the future on a tie", () => {
    const sessions = [
      session("TASK", "2026-10-06T03:00:00.000Z"),
      session("TASK", "2026-10-10T03:00:00.000Z"),
    ];
    expect(nearestDayWithTask(sessions, from, "UTC")?.getDate()).toBe(10);
  });
});
