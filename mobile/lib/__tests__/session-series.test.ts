import type { Session } from "@zenflow/shared";
import { describe, expect, it } from "vitest";
import { getSeriesKind } from "@zenflow/core";

function task(
  overrides: Partial<
    Pick<Session, "seriesId" | "rrule" | "timetableGroupId">
  >,
) {
  return { seriesId: null, rrule: null, timetableGroupId: null, ...overrides };
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

  it("returns 'timetable' when there's no seriesId but there is a timetableGroupId (portal-ingested lecture)", () => {
    expect(
      getSeriesKind(task({ timetableGroupId: "section-1" })),
    ).toBe("timetable");
  });

  it("prefers 'recurring'/'task' over 'timetable' when both seriesId and timetableGroupId are set", () => {
    expect(
      getSeriesKind(
        task({ seriesId: "s1", rrule: null, timetableGroupId: "section-1" }),
      ),
    ).toBe("task");
  });
});
