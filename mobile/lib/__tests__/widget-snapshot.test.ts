import type { Session } from "@zenflow/shared";
import { describe, expect, it, vi } from "vitest";
import { format } from "date-fns";
import { loadWidgetHorizon, makeWidgetSnapshot, nextWidgetEvent } from "../widget-snapshot";

const session = (id: string, start: string, durationMinutes = 30) =>
  ({
    id,
    title: id,
    type: "TASK",
    scheduledStartTime: start,
    durationMinutes,
  }) as Session;

describe("widget snapshot", () => {
  it("loads both weeks covering the next seven days", async () => {
    const loader = vi.fn(async (monday: Date) => [
      session(format(monday, "yyyy-MM-dd"), monday.toISOString()),
    ]);
    const result = await loadWidgetHorizon(new Date(2026, 9, 14, 9), loader);
    expect(loader.mock.calls.map(([date]) => format(date, "yyyy-MM-dd"))).toEqual([
      "2026-10-12",
      "2026-10-19",
    ]);
    expect(result).toHaveLength(2);
  });

  it("keeps upcoming sessions in time order without duplicate cache entries", () => {
    const now = Date.parse("2026-10-14T08:00:00Z");
    const earlier = session("earlier", "2026-10-14T08:15:00Z");
    const later = session("later", "2026-10-14T09:00:00Z");
    const snapshot = makeWidgetSnapshot(
      [later, earlier, earlier, session("past", "2026-10-14T07:00:00Z")],
      "vi",
      "Asia/Ho_Chi_Minh",
      now,
    );
    expect(snapshot.generatedAt).toBe("2026-10-14T08:00:00.000Z");
    expect(snapshot.tz).toBe("Asia/Ho_Chi_Minh");
    expect(snapshot.events.map((item) => item.id)).toEqual(["earlier", "later"]);
    expect(snapshot.events[0].end).toBe("2026-10-14T08:45:00.000Z");
    expect(nextWidgetEvent(snapshot, now)?.id).toBe("earlier");
    expect(nextWidgetEvent(snapshot, Date.parse("2026-10-14T08:46:00Z"))?.id).toBe("later");
  });

  it("shows no next session once all saved sessions have ended", () => {
    const snapshot = makeWidgetSnapshot(
      [session("one", "2026-10-14T08:00:00Z")],
      "en",
      "UTC",
      Date.parse("2026-10-14T08:10:00Z"),
    );
    expect(nextWidgetEvent(snapshot, Date.parse("2026-10-14T08:30:00Z"))).toBeNull();
    expect(nextWidgetEvent(null)).toBeNull();
  });

  it("keeps the next seven days only", () => {
    const now = Date.parse("2026-10-14T08:00:00Z");
    const snapshot = makeWidgetSnapshot(
      [
        session("inside", "2026-10-21T07:59:00Z"),
        session("outside", "2026-10-21T08:00:00Z"),
      ],
      "en",
      "UTC",
      now,
    );
    expect(snapshot.events.map((event) => event.id)).toEqual(["inside"]);
  });
});
