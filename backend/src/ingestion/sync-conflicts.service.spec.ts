import { SyncConflictsService } from "./sync-conflicts.service";
import {
  conflictCountLabel,
  findConflictingTaskIds,
} from "../scheduler/core/sync-conflicts";

const NOW = new Date("2026-09-01T00:00:00.000Z");
const at = (iso: string) => new Date(iso);

function make(opts: {
  fixed?: { scheduledStartTime: Date; durationMinutes: number }[];
  tasks?: { id: string; scheduledStartTime: Date; durationMinutes: number }[];
  open?: { conflictSessionIds: string[] }[];
}) {
  const findMany = jest.fn((args: { where: { type: string } }) =>
    Promise.resolve(
      args.where.type === "TASK" ? (opts.tasks ?? []) : (opts.fixed ?? []),
    ),
  );
  const prisma = {
    session: { findMany },
    notification: {
      findMany: jest.fn().mockResolvedValue(opts.open ?? []),
    },
  };
  const notifications = {
    raiseConflict: jest.fn((_u: string, dto: unknown) =>
      Promise.resolve({ id: "n1", ...(dto as object) }),
    ),
    notify: jest.fn(),
  };
  const svc = new SyncConflictsService(prisma as never, notifications as never);
  return { svc, notifications, prisma };
}

const run = (
  svc: SyncConflictsService,
  type: "LECTURE" | "EXAM" | "ASSIGNMENT",
) =>
  svc.detectAndNotify({
    userId: "u1",
    source: "PORTAL",
    type,
    since: at("2026-09-01T00:00:00.000Z"),
    now: NOW,
  });

describe("findConflictingTaskIds / conflictCountLabel", () => {
  it("returns sorted ids of tasks overlapping any fixed block", () => {
    const fixed = [{ start: 1000 * 60_000, end: 1060 * 60_000 }];
    const ids = findConflictingTaskIds(fixed, [
      { id: "b", startMs: 1030 * 60_000, durationMinutes: 30 },
      { id: "a", startMs: 970 * 60_000, durationMinutes: 30 }, // ends exactly at start: no overlap
      { id: "c", startMs: 1000 * 60_000, durationMinutes: 15 },
    ]);
    expect(ids).toEqual(["b", "c"]);
  });
  it("pluralizes", () => {
    expect(conflictCountLabel(1)).toBe("1 conflict");
    expect(conflictCountLabel(3)).toBe("3 conflicts");
  });
});

describe("SyncConflictsService.detectAndNotify", () => {
  const lecture = {
    scheduledStartTime: at("2026-09-02T09:00:00.000Z"),
    durationMinutes: 90,
  };
  const clash = {
    id: "t1",
    scheduledStartTime: at("2026-09-02T09:30:00.000Z"),
    durationMinutes: 60,
  };

  it("raises a per-source notification with the count and 'Reschedule them all?'", async () => {
    const { svc, notifications } = make({ fixed: [lecture], tasks: [clash] });
    expect(await run(svc, "LECTURE")).toBe(1);
    const dto = notifications.raiseConflict.mock.calls[0][1] as {
      eventName: string;
      content: string;
      conflictSessionIds: string[];
    };
    expect(dto.eventName).toBe("sync_conflict.lecture");
    expect(dto.content).toContain("1 conflict with your own tasks");
    expect(dto.content).toContain("Reschedule them all?");
    expect(dto.conflictSessionIds).toEqual(["t1"]);
    expect(notifications.notify).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["EXAM", "sync_conflict.exam"],
    ["ASSIGNMENT", "sync_conflict.assignment"],
  ] as const)("uses the %s eventName", async (type, eventName) => {
    const { svc, notifications } = make({ fixed: [lecture], tasks: [clash] });
    await run(svc, type);
    expect(
      (
        notifications.raiseConflict.mock.calls[0][1] as {
          eventName: string;
        }
      ).eventName,
    ).toBe(eventName);
  });

  it("is a no-op when nothing conflicts", async () => {
    const { svc, notifications } = make({
      fixed: [lecture],
      tasks: [{ ...clash, scheduledStartTime: at("2026-09-02T12:00:00.000Z") }],
    });
    expect(await run(svc, "LECTURE")).toBe(0);
    expect(notifications.raiseConflict).not.toHaveBeenCalled();
  });

  it("is a no-op when the sync wrote nothing new", async () => {
    const { svc, notifications } = make({ fixed: [], tasks: [clash] });
    expect(await run(svc, "LECTURE")).toBe(0);
    expect(notifications.raiseConflict).not.toHaveBeenCalled();
  });

  it("dedupes against an identical still-open notification", async () => {
    const { svc, notifications } = make({
      fixed: [lecture],
      tasks: [clash],
      open: [{ conflictSessionIds: ["t1"] }],
    });
    expect(await run(svc, "LECTURE")).toBe(0);
    expect(notifications.raiseConflict).not.toHaveBeenCalled();
  });

  it("raises again when the conflict set changed", async () => {
    const { svc, notifications } = make({
      fixed: [lecture],
      tasks: [clash, { ...clash, id: "t2" }],
      open: [{ conflictSessionIds: ["t1"] }],
    });
    expect(await run(svc, "LECTURE")).toBe(2);
    expect(notifications.raiseConflict).toHaveBeenCalledTimes(1);
  });
});
