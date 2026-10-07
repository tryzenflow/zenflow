import type { DaySegment } from "@zenflow/shared";
import { describe, expect, it } from "vitest";
import { deriveDayStatus } from "../day-status";

const seg = (
  id: string,
  start: string,
  end: string,
  extra: Partial<DaySegment> = {},
) =>
  ({
    segmentId: id,
    taskId: id,
    title: `T${id}`,
    type: "TASK",
    start,
    end,
    continued: false,
    ...extra,
  }) as DaySegment;

const at = (h: number) =>
  Date.parse(`2026-10-07T${String(h).padStart(2, "0")}:00:00Z`);
const iso = (h: number) => new Date(at(h)).toISOString();

describe("deriveDayStatus", () => {
  it("is none for an empty day or only do-not-disturb", () => {
    expect(deriveDayStatus([], at(9)).kind).toBe("none");
    expect(
      deriveDayStatus([seg("d", iso(10), iso(12), { type: "DND" })], at(9)).kind,
    ).toBe("none");
  });
  it("picks the earliest session that has not started", () => {
    const s = deriveDayStatus(
      [seg("b", iso(14), iso(15)), seg("a", iso(10), iso(11))],
      at(9),
    );
    expect(s).toMatchObject({ kind: "next", taskId: "a" });
  });
  it("is none when everything has started or ended", () => {
    expect(deriveDayStatus([seg("a", iso(8), iso(9))], at(13)).kind).toBe("none");
    expect(
      deriveDayStatus([seg("a", iso(8), iso(12))], at(10)).kind,
    ).toBe("none");
  });
  it("ignores the continued half of a split block", () => {
    expect(
      deriveDayStatus([seg("a", iso(10), iso(11), { continued: true })], at(9))
        .kind,
    ).toBe("none");
  });
});
