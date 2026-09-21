import { DisplacementService } from "./displacement.service";
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

  it("plan(): fixed rows never move; a standalone TASK on the deadline day is repacked", async () => {
    const deadline = new Date("2026-06-15T12:00:00.000Z");
    const rows = [
      // fixed block 06:00-09:00 and 10:00-12:00 leave one hole, held by a flexible task
      {
        id: "x1",
        type: "LECTURE",
        seriesId: null,
        scheduledStartTime: new Date("2026-06-15T06:00:00Z"),
        durationMinutes: 180,
        deadline: null,
      },
      {
        id: "x2",
        type: "EXAM",
        seriesId: null,
        scheduledStartTime: new Date("2026-06-15T10:00:00Z"),
        durationMinutes: 120,
        deadline: null,
      },
      {
        id: "f1",
        type: "TASK",
        seriesId: null,
        scheduledStartTime: new Date("2026-06-15T09:00:00Z"),
        durationMinutes: 60,
        deadline: new Date("2026-06-15T23:00:00Z"),
      },
    ];
    const { prisma } = makePrisma(rows);
    const svc = new DisplacementService(prisma as never);
    const plan = await svc.plan(
      user,
      { id: "new", durationMinutes: 60, deadline },
      new Date("2026-06-15T06:00:00Z"),
    );
    expect(plan.kind).toBe("placed");
    if (plan.kind === "placed") {
      expect(plan.startMs).toBe(ms("2026-06-15T09:00:00Z"));
      expect(plan.moves.map((m) => m.id)).toEqual(["f1"]);
    }
  });

  it("plan(): a series sitting is treated as fixed", async () => {
    const rows = [
      {
        id: "x1",
        type: "LECTURE",
        seriesId: null,
        scheduledStartTime: new Date("2026-06-15T06:00:00Z"),
        durationMinutes: 180,
        deadline: null,
      },
      {
        id: "s1",
        type: "TASK",
        seriesId: "series",
        scheduledStartTime: new Date("2026-06-15T09:00:00Z"),
        durationMinutes: 180,
        deadline: new Date("2026-06-15T23:00:00Z"),
      },
    ];
    const { prisma } = makePrisma(rows);
    const svc = new DisplacementService(prisma as never);
    const plan = await svc.plan(
      user,
      {
        id: "new",
        durationMinutes: 60,
        deadline: new Date("2026-06-15T12:00:00Z"),
      },
      new Date("2026-06-15T06:00:00Z"),
    );
    expect(plan.kind).toBe("infeasible");
  });

  it("fallbackStart: ACCEPT_LATE_DEADLINE returns a conflict-free start after the deadline", async () => {
    const rows = [
      {
        id: "x1",
        type: "LECTURE",
        seriesId: null,
        scheduledStartTime: new Date("2026-06-15T06:00:00Z"),
        durationMinutes: 360,
        deadline: null,
      },
    ];
    const { prisma } = makePrisma(rows);
    const svc = new DisplacementService(prisma as never);
    const start = await svc.fallbackStart(
      user,
      {
        id: "new",
        durationMinutes: 60,
        deadline: new Date("2026-06-15T12:00:00Z"),
      },
      new Date("2026-06-15T06:00:00Z"),
      "ACCEPT_LATE_DEADLINE",
    );
    expect(start!.toISOString()).toBe("2026-06-15T12:00:00.000Z");
  });

  it("fallbackStart: ACCEPT_CONFLICTS returns a slot ending by the deadline", async () => {
    const rows = [
      {
        id: "x1",
        type: "LECTURE",
        seriesId: null,
        scheduledStartTime: new Date("2026-06-15T06:00:00Z"),
        durationMinutes: 360,
        deadline: null,
      },
    ];
    const { prisma } = makePrisma(rows);
    const svc = new DisplacementService(prisma as never);
    const start = await svc.fallbackStart(
      user,
      {
        id: "new",
        durationMinutes: 60,
        deadline: new Date("2026-06-15T12:00:00Z"),
      },
      new Date("2026-06-15T06:00:00Z"),
      "ACCEPT_CONFLICTS",
    );
    expect(start!.getTime() + 3_600_000).toBeLessThanOrEqual(
      ms("2026-06-15T12:00:00Z"),
    );
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
