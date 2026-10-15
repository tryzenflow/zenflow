import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SessionBlock } from "@/components/calendar/task-block";
import { buildDayGrid } from "@/lib/day-grid";
import type { DaySegment } from "@zenflow/shared";
import { renderScreen } from "@/test/utils/render";

// Tz is UTC so the wall clock in the fixtures reads the same as the ISO string.
const TZ = "UTC";
const GRID = buildDayGrid(56, []);

function segment(overrides: Partial<DaySegment> & { minutes: number }): DaySegment {
  const { minutes, ...rest } = overrides;
  const start = "2026-10-15T09:00:00.000Z";
  const end = new Date(new Date(start).getTime() + minutes * 60_000).toISOString();
  return {
    id: "s1",
    segmentId: "s1",
    taskId: "s1",
    title: "Calculus lecture",
    start,
    end,
    taskStart: start,
    taskEnd: end,
    type: "TASK",
    tags: [],
    state: "fluid",
    location: null,
    ...rest,
  } as DaySegment;
}

function renderBlock(seg: DaySegment, deadline?: string) {
  return renderScreen(
    <SessionBlock
      segment={seg}
      layout={{ column: 0, columns: 1, conflict: false }}
      tz={TZ}
      grid={GRID}
      leftOffset={0}
      blockWidth={300}
      deadline={deadline}
    />,
  );
}

describe("SessionBlock content tiers", () => {
  it("shows only the title for a 15 minute block", () => {
    renderBlock(segment({ minutes: 15 }));
    expect(screen.getByText("Calculus lecture")).toBeTruthy();
    expect(screen.queryByText(/9:00/)).toBeNull();
  });

  it("adds the start time under 44px", () => {
    renderBlock(segment({ minutes: 30, location: "Room 4" }));
    expect(screen.getByText("Calculus lecture")).toBeTruthy();
    expect(screen.getByText(/9:00/)).toBeTruthy();
    expect(screen.queryByText("Room 4")).toBeNull();
  });

  it("adds the location from 44px", () => {
    renderBlock(segment({ minutes: 60, location: "Room 4" }));
    expect(screen.getByText("Calculus lecture")).toBeTruthy();
    expect(screen.getByText(/9:00/)).toBeTruthy();
    expect(screen.getByText("Room 4")).toBeTruthy();
  });

  it("shows Online for a meeting link", () => {
    renderBlock(segment({ minutes: 60, location: "https://meet.example.com/abc" }));
    expect(screen.getByText("Online")).toBeTruthy();
  });

  it("carries no badges or due chips, even when overdue", () => {
    renderBlock(segment({ minutes: 60 }), "2026-10-15T08:00:00.000Z");
    expect(screen.queryByText(/^Due/)).toBeNull();
    expect(screen.queryByText("Overdue")).toBeNull();
  });
});
