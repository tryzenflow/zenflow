import type { DaySegment } from "@zenflow/shared";
import { describe, expect, it } from "vitest";
import { deriveDayStatus } from "../day-status";
import { type DluSyncHealth, dluSyncHealth } from "../dlu-sync-health";

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

const at = (h: number) => Date.parse(`2026-10-07T${String(h).padStart(2, "0")}:00:00Z`);
const iso = (h: number) => new Date(at(h)).toISOString();

describe("deriveDayStatus", () => {
  it("is none for an empty day or only do-not-disturb", () => {
    expect(deriveDayStatus([], at(9)).kind).toBe("none");
    expect(
      deriveDayStatus([seg("d", iso(8), iso(12), { type: "DND" })], at(9)).kind,
    ).toBe("none");
  });
  it("picks the earliest session that has not started", () => {
    const s = deriveDayStatus(
      [seg("b", iso(14), iso(15)), seg("a", iso(10), iso(11))],
      at(9),
    );
    expect(s).toMatchObject({ kind: "next", taskId: "a" });
  });
  it("is done once every block has ended, not while one is running", () => {
    const blocks = [seg("a", iso(8), iso(9)), seg("b", iso(10), iso(12))];
    expect(deriveDayStatus(blocks, at(13)).kind).toBe("done");
    expect(deriveDayStatus(blocks, at(11)).kind).toBe("none");
  });
});

describe("dluSyncHealth", () => {
  const base = {
    provider: "LMS",
    connected: true,
    lastVerifiedAt: null,
    lastSyncedAt: null,
    lastSyncStatus: "COMPLETED",
    lastSuccessAt: null,
    failing: false,
  } as const;
  const run = (i: object[], now = at(12)): DluSyncHealth =>
    dluSyncHealth(i as never, now);
  it("ignores disconnected providers", () => {
    expect(run([{ ...base, connected: false, failing: true }]).kind).toBe("none");
  });
  it("reports failing before stale, and stale after a day", () => {
    expect(run([{ ...base, failing: true }]).kind).toBe("failing");
    expect(
      run([{ ...base, lastSuccessAt: new Date(at(12) - 30 * 3600e3).toISOString() }]).kind,
    ).toBe("stale");
    expect(
      run([{ ...base, lastSuccessAt: new Date(at(12) - 3 * 3600e3).toISOString() }]).kind,
    ).toBe("ok");
  });
});
