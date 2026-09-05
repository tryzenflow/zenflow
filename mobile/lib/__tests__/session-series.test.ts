import type { Session } from "@zenflow/shared";
import { describe, expect, it } from "vitest";
import { getSeriesKind } from "../session-series";

function task(overrides: Partial<Pick<Session, "seriesId" | "rrule">>) {
  return { seriesId: null, rrule: null, ...overrides };
}

describe("getSeriesKind", () => {
  it("returns 'none' when there's no seriesId", () => {
    expect(getSeriesKind(task({}))).toBe("none");
  });

  it("returns 'recurring' when seriesId and rrule are both set", () => {
    expect(getSeriesKind(task({ seriesId: "s1", rrule: "FREQ=WEEKLY" }))).toBe(
      "recurring",
    );
  });

  it("returns 'task' when seriesId is set but rrule isn't (materialized TASK series)", () => {
    expect(getSeriesKind(task({ seriesId: "s1", rrule: null }))).toBe("task");
  });
});
