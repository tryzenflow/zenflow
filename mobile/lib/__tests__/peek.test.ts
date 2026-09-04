import type { DaySegment } from "@zenflow/shared";
import { describe, expect, it } from "vitest";
import { DAY_MINUTES, peekBlocksFromSegments } from "../peek";

const TZ = "UTC";
const DAY = new Date("2026-08-13T00:00:00Z");

function seg(
  taskId: string,
  startISO: string,
  endISO: string,
  state: DaySegment["state"] = "fluid",
  extra?: Partial<DaySegment>,
): DaySegment {
  return {
    id: taskId,
    taskId,
    title: `Task ${taskId}`,
    start: startISO,
    end: endISO,
    type: "TASK",
    tags: [],
    state,
    segmentId: taskId,
    taskStart: startISO,
    taskEnd: endISO,
    ...extra,
  };
}

describe("peekBlocksFromSegments", () => {
  it("positions a mid-day task by its wall-clock time", () => {
    const blocks = peekBlocksFromSegments(
      [seg("t1", "2026-08-13T09:15:00Z", "2026-08-13T10:15:00Z")],
      DAY,
      TZ,
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ startMin: 555, durationMin: 60 });
  });

  it("maps an 08:00 task to 480 minutes in", () => {
    const blocks = peekBlocksFromSegments(
      [seg("t1", "2026-08-13T08:00:00Z", "2026-08-13T09:00:00Z")],
      DAY,
      TZ,
    );
    expect(blocks[0]).toMatchObject({ startMin: 480, durationMin: 60 });
  });

  it("clamps a cross-midnight tail to the day start", () => {
    const blocks = peekBlocksFromSegments(
      [
        seg("t1", "2026-08-12T23:45:00Z", "2026-08-13T00:15:00Z", "fluid", {
          segmentId: "t1::tail",
          continued: true,
        }),
      ],
      DAY,
      TZ,
    );
    expect(blocks[0]).toMatchObject({
      key: "t1::tail",
      startMin: 0,
      durationMin: 15,
    });
  });

  it("caps a continuing head to the rest of the day", () => {
    const blocks = peekBlocksFromSegments(
      [
        seg("t1", "2026-08-13T23:30:00Z", "2026-08-14T00:30:00Z", "fluid", {
          continues: true,
        }),
      ],
      DAY,
      TZ,
    );
    expect(blocks[0]).toMatchObject({ startMin: 1410, durationMin: 30 });
  });

  it("floors tiny slivers at 15 minutes so they stay visible", () => {
    const blocks = peekBlocksFromSegments(
      [seg("t1", "2026-08-13T09:00:00Z", "2026-08-13T09:05:00Z")],
      DAY,
      TZ,
    );
    expect(blocks[0].durationMin).toBe(15);
  });

  it("preserves the task state on every block", () => {
    const blocks = peekBlocksFromSegments(
      [
        seg("t1", "2026-08-13T09:00:00Z", "2026-08-13T10:00:00Z", "fluid"),
        seg("t2", "2026-08-13T11:00:00Z", "2026-08-13T12:00:00Z", "exam"),
        seg("t3", "2026-08-13T13:00:00Z", "2026-08-13T14:00:00Z", "conflict"),
        seg("t4", "2026-08-13T15:00:00Z", "2026-08-13T16:00:00Z", "dnd"),
      ],
      DAY,
      TZ,
    );
    expect(blocks.map((b) => b.state)).toEqual([
      "fluid",
      "exam",
      "conflict",
      "dnd",
    ]);
  });

  it("returns an empty array for an empty day", () => {
    expect(peekBlocksFromSegments([], DAY, TZ)).toEqual([]);
  });

  it("keeps every block within the 0-1440 minute grid", () => {
    const blocks = peekBlocksFromSegments(
      [seg("t1", "2026-08-13T00:00:00Z", "2026-08-14T00:00:00Z")],
      DAY,
      TZ,
    );
    expect(blocks[0].startMin).toBe(0);
    expect(blocks[0].durationMin).toBe(DAY_MINUTES);
  });
});
