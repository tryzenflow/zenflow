import { DisplacementService, isFlexible } from "./displacement.service";
import { ConflictRescheduleService } from "./conflict-reschedule.service";

const user = {
  id: "u1",
  timezone: "UTC",
  preferenceMatrix: [] as number[],
} as never;
const ms = (iso: string) => new Date(iso).getTime();

function makePrisma(rows: unknown[] = []) {
  const sessionUpdate = jest.fn((a: unknown) => a);
  const eventCreate = jest.fn((a: unknown) => a);
  return {
    sessionUpdate,
    eventCreate,
    prisma: {
      session: {
        findMany: jest.fn().mockResolvedValue(rows),
        update: sessionUpdate,
      },
      sessionSeries: { findMany: jest.fn().mockResolvedValue([]) },
      sessionEvent: { create: eventCreate },
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
    },
  };
}

describe("DisplacementService", () => {
  it("records scheduler moves as SYSTEM_MOVE with reward 0 - never MOVE", async () => {
    const { prisma, eventCreate, sessionUpdate } = makePrisma();
    const svc = new DisplacementService(prisma as never);
    const applied = await svc.applyMoves(
      "u1",
      [
        {
          id: "f1",
          fromMs: ms("2026-06-15T09:00:00Z"),
          toMs: ms("2026-06-15T13:00:00Z"),
        },
      ],
      () => 60,
    );
    expect(applied).toHaveLength(1);
    const data = (
      eventCreate.mock.calls[0][0] as { data: Record<string, unknown> }
    ).data;
    expect(data.eventType).toBe("SYSTEM_MOVE");
    expect(data.rewardScore).toBe(0);
    expect(data.dragDistanceMinutes).toBe(240);
    expect(sessionUpdate).toHaveBeenCalledTimes(1);
  });

  it("is a no-op for an empty plan (idempotent re-apply)", async () => {
    const { prisma } = makePrisma();
    const svc = new DisplacementService(prisma as never);
    expect(await svc.applyMoves("u1", [], () => 60)).toEqual([]);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("isFlexible", () => {
  const base = {
    recurring: false,
    type: "TASK" as const,
    seriesId: null,
    id: "x1",
    deadlineMs: 1,
  };

  it("true for a standalone, non-recurring TASK with a deadline", () => {
    expect(isFlexible(base as never)).toBe(true);
  });

  it("false when recurring, not a TASK, part of a series, or deadline-less", () => {
    expect(isFlexible({ ...base, recurring: true } as never)).toBe(false);
    expect(isFlexible({ ...base, type: "LECTURE" } as never)).toBe(false);
    expect(isFlexible({ ...base, seriesId: "s1" } as never)).toBe(false);
    expect(isFlexible({ ...base, deadlineMs: null } as never)).toBe(false);
  });
});

describe("ConflictRescheduleService", () => {
  const row = (id: string, deadline: string) => ({
    id,
    durationMinutes: 60,
    deadline: new Date(deadline),
    scheduledStartTime: new Date("2026-09-02T09:00:00Z"),
  });

  function make(placedTo: Date | null, conflicts: boolean) {
    const prisma = {
      session: {
        // 1st findMany: the tasks; later calls (wouldConflict's loadDayLoad): blockers
        findMany: jest
          .fn()
          .mockResolvedValueOnce([row("t1", "2026-09-05T00:00:00Z")])
          .mockResolvedValue(
            conflicts
              ? [
                  {
                    scheduledStartTime: new Date("2026-09-02T09:00:00Z"),
                    durationMinutes: 90,
                    type: "LECTURE",
                  },
                ]
              : [],
          ),
      },
      sessionSeries: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const placement = {
      placeOnDeadlineChange: jest
        .fn()
        .mockResolvedValue({ scheduledStartTime: placedTo }),
    };
    const displacement = { applyMoves: jest.fn().mockResolvedValue([]) };
    return {
      placement,
      displacement,
      svc: new ConflictRescheduleService(
        prisma as never,
        placement as never,
        displacement as never,
      ),
    };
  }

  it("re-places a still-conflicting task and records a SYSTEM_MOVE", async () => {
    const to = new Date("2026-09-02T15:00:00Z");
    const { svc, placement, displacement } = make(to, true);
    const res = await svc.rescheduleAll(
      user,
      ["t1"],
      new Date("2026-09-01T00:00:00Z"),
    );
    expect(res.rescheduled).toHaveLength(1);
    expect(placement.placeOnDeadlineChange).toHaveBeenCalledTimes(1);
    expect(displacement.applyMoves).toHaveBeenCalledTimes(1);
  });

  it("is idempotent: a task that no longer conflicts is left alone", async () => {
    const { svc, placement } = make(new Date("2026-09-02T15:00:00Z"), false);
    const res = await svc.rescheduleAll(user, ["t1"]);
    expect(res).toEqual({ rescheduled: [], failedSessionIds: [] });
    expect(placement.placeOnDeadlineChange).not.toHaveBeenCalled();
  });

  it("reports a task that cannot be moved as failed", async () => {
    const { svc, displacement } = make(null, true);
    const res = await svc.rescheduleAll(user, ["t1"]);
    expect(res.failedSessionIds).toEqual(["t1"]);
    expect(displacement.applyMoves).not.toHaveBeenCalled();
  });
});
