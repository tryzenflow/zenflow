import type { DaySegment } from "@zenflow/shared";
import { describe, expect, it } from "vitest";
import { COLUMN_GUTTER, columnBlockFrame, weekColumnWidth, weekSpans } from "../week-grid-math";

function segment(start: string, end: string, continues = false): DaySegment {
  return {
    id: start,
    segmentId: start,
    taskId: start,
    title: "Block",
    start,
    end,
    taskStart: start,
    taskEnd: end,
    type: "TASK",
    tags: [],
    state: "fluid",
    location: null,
    continues,
    continued: false,
  } as unknown as DaySegment;
}

describe("columnBlockFrame", () => {
  it("gives a lone block the full column less the gutters", () => {
    expect(columnBlockFrame({ column: 0, columns: 1 }, 50)).toEqual({
      left: COLUMN_GUTTER,
      width: 50 - COLUMN_GUTTER * 2,
    });
  });

  it("splits overlapping blocks evenly, side by side", () => {
    const usable = 60 - COLUMN_GUTTER * 2;
    const a = columnBlockFrame({ column: 0, columns: 2 }, 60);
    const b = columnBlockFrame({ column: 1, columns: 2 }, 60);
    expect(a.width).toBe(usable / 2);
    expect(b.width).toBe(usable / 2);
    expect(b.left).toBe(a.left + a.width);
  });

  it("never divides by zero", () => {
    expect(columnBlockFrame({ column: 0, columns: 0 }, 40).width).toBe(40 - COLUMN_GUTTER * 2);
  });
});

describe("weekColumnWidth", () => {
  it("splits the width after the time gutter into seven columns", () => {
    expect(weekColumnWidth(390, 76)).toBe((390 - 76) / 7);
  });

  it("is never negative", () => {
    expect(weekColumnWidth(10, 76)).toBe(0);
  });
});

describe("weekSpans", () => {
  it("collects the minute span of every block in the week", () => {
    const spans = weekSpans(
      [
        [segment("2026-10-12T09:00:00.000Z", "2026-10-12T10:30:00.000Z")],
        [],
        [segment("2026-10-14T22:00:00.000Z", "2026-10-14T23:00:00.000Z")],
      ],
      "UTC",
    );
    expect(spans).toEqual([
      { startMin: 9 * 60, endMin: 10 * 60 + 30 },
      { startMin: 22 * 60, endMin: 23 * 60 },
    ]);
  });
});
