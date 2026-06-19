import { SchedulerService } from "./scheduler.service";
import type { Task, User } from "../../generated/prisma";

/**
 * Coverage for conflict DETECTION in {@link SchedulerService.pin} and
 * {@link SchedulerService.resize}. Detection is now-INDEPENDENT: it is pure
 * pairwise time-overlap across all placed tasks, so a manual pin/resize onto an
 * already-elapsed or in-progress block surfaces a conflict, and a past overlap
 * self-heals once it is gone. PLACEMENT stays now-aware — these methods only
 * ever write the target task's slot; nothing else moves. A Prisma mock captures
 * every `task.update` so we can assert exactly which rows changed and to what.
 *
 * Because detection is now-independent, these tests no longer inject a clock:
 * the verdicts depend only on whether the placed intervals overlap. Fixtures use
 * a 12:00-relative layout (09:00 = elapsed, 11:00–13:00 = in-progress, the
 * afternoon = future) purely for readability.
 */

const user: User = {
  id: "user-1",
  name: "Tester",
  email: "tester@example.com",
  timezone: "UTC",
  workStart: 540,
  workEnd: 1020,
  workDays: [1, 2, 3, 4, 5],
  preferenceMatrix: [],
  roleArchetypeId: null,
  onboardingComplete: true,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

function task(overrides: Partial<Task> & { id: string }): Task {
  return {
    title: "Task",
    note: null,
    durationMinutes: 60,
    deadline: null,
    fixed: false,
    manuallyMoved: false,
    schedulingAnchor: null,
    view: null,
    startTime: 0,
    status: "PENDING",
    conflict: false,
    scheduledStartTime: null,
    userId: user.id,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

interface UpdateCall {
  id: string;
  data: {
    scheduledStartTime?: Date | null;
    conflict?: boolean;
    fixed?: boolean;
    startTime?: number;
  };
}

/**
 * Build a SchedulerService backed by an in-memory task table. Returns the
 * service plus the list of captured `task.update` calls.
 */
function makeService(rows: Task[]): {
  service: SchedulerService;
  updates: UpdateCall[];
  tx: PrismaTxMock;
} {
  const updates: UpdateCall[] = [];
  const byId = new Map(rows.map((r) => [r.id, r]));

  const tx = {
    task: {
      findMany: jest.fn().mockResolvedValue(rows),
      update: jest.fn(
        (args: { where: { id: string }; data: UpdateCall["data"] }) => {
          const { where, data } = args;
          updates.push({ id: where.id, data });
          const merged = { ...byId.get(where.id)!, ...data };
          byId.set(where.id, merged);
          return Promise.resolve(merged);
        },
      ),
    },
    taskEvent: { create: jest.fn().mockResolvedValue({}) },
    user: { update: jest.fn().mockResolvedValue({}) },
    tag: { findMany: jest.fn().mockResolvedValue([]) },
  };

  const prisma = {
    $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
  };

  return {
    service: new SchedulerService(prisma as never),
    updates,
    tx,
  };
}

type PrismaTxMock = {
  task: {
    findMany: jest.Mock;
    update: jest.Mock;
  };
  taskEvent: { create: jest.Mock };
  user: { update: jest.Mock };
  tag: { findMany: jest.Mock };
};

describe("SchedulerService.pin — now-independent conflict detection", () => {
  it("self-heals a past task's stale conflict (now recomputed, was frozen)", async () => {
    // Inverted from the old "never recomputes a past task's conflict": a past
    // task carrying a stale conflict:true that now overlaps nothing has its
    // verdict recomputed to false and IS written. Its slot is never moved.
    const past = task({
      id: "past",
      conflict: true,
      scheduledStartTime: new Date("2026-06-08T09:00:00Z"),
    });
    const live = task({
      id: "live",
      scheduledStartTime: new Date("2026-06-08T13:00:00Z"),
    });
    const { service, updates } = makeService([past, live]);

    await service.pin(user, "live", new Date("2026-06-08T14:00:00Z"));

    const pastUpdate = updates.find((u) => u.id === "past");
    expect(pastUpdate?.data.conflict).toBe(false);
    // Placement is untouched — the past block keeps its stored 09:00 slot.
    expect(pastUpdate?.data.scheduledStartTime?.getTime()).toBe(
      Date.parse("2026-06-08T09:00:00Z"),
    );
  });

  it("flags the pinned live task when it lands on an already-elapsed block", async () => {
    // Inverted from "a past block never flags the pinned task". Pin the live
    // task directly onto the elapsed 09:00–10:00 block — detection is
    // now-independent, so it overlaps and BOTH are flagged conflict:true.
    const past = task({
      id: "past",
      scheduledStartTime: new Date("2026-06-08T09:00:00Z"),
    });
    const live = task({
      id: "live",
      scheduledStartTime: new Date("2026-06-08T13:00:00Z"),
    });
    const { service, updates } = makeService([past, live]);

    const { task: updated } = await service.pin(
      user,
      "live",
      new Date("2026-06-08T09:00:00Z"),
    );

    expect(updated.conflict).toBe(true);
    const pastUpdate = updates.find((u) => u.id === "past");
    expect(pastUpdate?.data.conflict).toBe(true);
    // The past block's slot is never moved — it keeps its stored 09:00 slot.
    expect(pastUpdate?.data.scheduledStartTime?.getTime()).toBe(
      Date.parse("2026-06-08T09:00:00Z"),
    );
  });

  it("still flags a live-vs-live overlap as a conflict", async () => {
    // Sanity: the freeze must not suppress real conflicts between live tasks.
    const a = task({
      id: "a",
      scheduledStartTime: new Date("2026-06-08T13:00:00Z"),
    });
    const b = task({
      id: "b",
      scheduledStartTime: new Date("2026-06-08T15:00:00Z"),
    });
    const { service } = makeService([a, b]);

    const { task: updated } = await service.pin(
      user,
      "b",
      new Date("2026-06-08T13:00:00Z"),
    );

    expect(updated.conflict).toBe(true);
  });
});

describe("SchedulerService.pin — in-progress tasks still block conflicts", () => {
  it("flags BOTH the pinned live task and the in-progress block it overlaps", async () => {
    // In-progress block 11:00–13:00 straddles now (noon). Pinning the live task
    // onto 12:30 (which overlaps the in-progress tail) surfaces a conflict on
    // both sides. The in-progress block's conflict IS recomputed (detection is
    // now-independent) and written — but its slot is never moved.
    const inprogress = task({
      id: "inprogress",
      scheduledStartTime: new Date("2026-06-08T11:00:00Z"),
      durationMinutes: 120,
    });
    const live = task({
      id: "live",
      scheduledStartTime: new Date("2026-06-08T15:00:00Z"),
    });
    const { service, updates } = makeService([inprogress, live]);

    const { task: updated } = await service.pin(
      user,
      "live",
      new Date("2026-06-08T12:30:00Z"),
    );

    expect(updated.conflict).toBe(true);
    const inProgressUpdate = updates.find((u) => u.id === "inprogress");
    expect(inProgressUpdate?.data.conflict).toBe(true);
    // The in-progress block keeps its stored 11:00 slot (never moved).
    expect(inProgressUpdate?.data.scheduledStartTime?.getTime()).toBe(
      Date.parse("2026-06-08T11:00:00Z"),
    );
  });

  it("flags the pinned task against a fully-elapsed block (now-independent)", async () => {
    // Inverted from the old "elapsed block never flags". Elapsed block
    // 09:00–10:00 (ends before noon) is still part of the window, so pinning the
    // live task onto it raises a conflict on both.
    const elapsed = task({
      id: "elapsed",
      scheduledStartTime: new Date("2026-06-08T09:00:00Z"),
    });
    const live = task({
      id: "live",
      scheduledStartTime: new Date("2026-06-08T13:00:00Z"),
    });
    const { service, updates } = makeService([elapsed, live]);

    const { task: updated } = await service.pin(
      user,
      "live",
      new Date("2026-06-08T09:00:00Z"),
    );

    expect(updated.conflict).toBe(true);
    expect(updates.find((u) => u.id === "elapsed")?.data.conflict).toBe(true);
  });
});

/** Extract the preferenceMatrix written by the first `tx.user.update` call. */
function writtenMatrix(tx: PrismaTxMock): number[] {
  const call = tx.user.update.mock.calls[0] as [
    { data: { preferenceMatrix: number[] } },
  ];
  return call[0].data.preferenceMatrix;
}

describe("SchedulerService.pin — signed preference matrix", () => {
  it("decrements the vacated slot and increments the destination slot", async () => {
    // Move a placed task from Mon 09:00 (idx 36) to Mon 11:00 (idx 44). The
    // vacated cell gets -1, the destination cell +1.
    const placed = task({
      id: "p",
      scheduledStartTime: new Date("2026-06-08T09:00:00Z"), // Mon 09:00
    });
    const { service, tx } = makeService([placed]);

    await service.pin(user, "p", new Date("2026-06-08T11:00:00Z")); // Mon 11:00

    expect(tx.user.update).toHaveBeenCalledTimes(1);
    const matrix = writtenMatrix(tx);
    expect(matrix).toHaveLength(672);
    expect(matrix[36]).toBe(-1); // Mon 09:00 vacated → dislike
    expect(matrix[44]).toBe(+1); // Mon 11:00 destination → move-toward
  });

  it("only records the move-toward (+1) when the task had no prior slot", async () => {
    const unplaced = task({ id: "u", scheduledStartTime: null });
    const { service, tx } = makeService([unplaced]);

    await service.pin(user, "u", new Date("2026-06-08T11:00:00Z")); // Mon 11:00

    const matrix = writtenMatrix(tx);
    expect(matrix[44]).toBe(+1);
    // No vacated cell was decremented.
    expect(matrix.filter((v) => v < 0)).toEqual([]);
  });

  it("does not write a negative when the task is pinned to the same slot", async () => {
    const placed = task({
      id: "p",
      scheduledStartTime: new Date("2026-06-08T09:00:00Z"),
    });
    const { service, tx } = makeService([placed]);

    await service.pin(user, "p", new Date("2026-06-08T09:00:00Z")); // same slot

    const matrix = writtenMatrix(tx);
    expect(matrix[36]).toBe(+1); // only the move-toward signal
    expect(matrix.filter((v) => v < 0)).toEqual([]);
  });
});

describe("SchedulerService.computeOverflowOptions", () => {
  // Mon 06-08 09:00; deadline 09:45 leaves only a 45-min window before it.
  const NOW = new Date("2026-06-08T09:00:00Z");

  it("offers an off-hours slot at now and the next-day in-hours slot", async () => {
    const unplaced = task({
      id: "u",
      durationMinutes: 60,
      deadline: new Date("2026-06-08T09:45:00Z"),
      conflict: true,
      scheduledStartTime: null,
    });
    const { service, tx } = makeService([unplaced]);

    const overflow = await service.computeOverflowOptions(
      user,
      unplaced,
      "day",
      tx as never,
      NOW,
    );

    // Off-hours: 60 min before the 09:45 deadline doesn't fit, so null.
    expect(overflow.outsideHours).toBeNull();
    // Next available (day): next working day Tue 06-09 09:00, deadline ignored.
    expect(overflow.nextAvailable).toEqual({
      scheduledStartTime: "2026-06-09T09:00:00.000Z",
      granularity: "day",
    });
  });

  it("offers an off-hours slot when there is room before the deadline", async () => {
    const unplaced = task({
      id: "u",
      durationMinutes: 60,
      deadline: new Date("2026-06-08T11:00:00Z"),
      conflict: true,
      scheduledStartTime: null,
    });
    const { service, tx } = makeService([unplaced]);

    const overflow = await service.computeOverflowOptions(
      user,
      unplaced,
      "week",
      tx as never,
      NOW,
    );

    expect(overflow.outsideHours).toEqual({
      scheduledStartTime: "2026-06-08T09:00:00.000Z",
    });
    expect(overflow.nextAvailable?.granularity).toBe("week");
    expect(overflow.nextAvailable?.scheduledStartTime).toBe(
      "2026-06-15T09:00:00.000Z",
    );
  });

  it("11pm-Tue repro: a no-deadline task overflows its viewed day", async () => {
    // It is 23:00 Tue, day view, a flexible no-deadline task anchored on Tue.
    // The off-hours option lands ~23:00 Tue (inside the day) and next-available
    // is Wed 09:00 — both relative to the task's ANCHOR period, not `now`.
    const TUE_11PM = new Date("2026-06-09T23:00:00Z");
    const unplaced = task({
      id: "u",
      durationMinutes: 30,
      deadline: null,
      schedulingAnchor: new Date("2026-06-09T00:00:00Z"),
      view: "day",
      conflict: true,
      scheduledStartTime: null,
    });
    const { service, tx } = makeService([unplaced]);

    const overflow = await service.computeOverflowOptions(
      user,
      unplaced,
      "day",
      tx as never,
      TUE_11PM,
    );

    expect(overflow.outsideHours).toEqual({
      scheduledStartTime: "2026-06-09T23:00:00.000Z",
    });
    expect(overflow.nextAvailable).toEqual({
      scheduledStartTime: "2026-06-10T09:00:00.000Z",
      granularity: "day",
    });
  });

  it("returns a null off-hours option when the anchor period has ended", async () => {
    // 23:45 Tue, 30-min task: no off-hours slot fits before Wed 00:00, so the
    // outside-hours option is null while next-available (Wed) is still offered.
    const TUE_LATE = new Date("2026-06-09T23:45:00Z");
    const unplaced = task({
      id: "u",
      durationMinutes: 30,
      deadline: null,
      schedulingAnchor: new Date("2026-06-09T00:00:00Z"),
      view: "day",
      conflict: true,
      scheduledStartTime: null,
    });
    const { service, tx } = makeService([unplaced]);

    const overflow = await service.computeOverflowOptions(
      user,
      unplaced,
      "day",
      tx as never,
      TUE_LATE,
    );

    expect(overflow.outsideHours).toBeNull();
    expect(overflow.nextAvailable?.scheduledStartTime).toBe(
      "2026-06-10T09:00:00.000Z",
    );
  });

  it("avoids another pending task's occupied interval for the off-hours slot", async () => {
    const blocker = task({
      id: "blocker",
      durationMinutes: 60,
      scheduledStartTime: new Date("2026-06-08T09:00:00Z"),
    });
    const unplaced = task({
      id: "u",
      durationMinutes: 60,
      deadline: new Date("2026-06-08T12:00:00Z"),
      conflict: true,
      scheduledStartTime: null,
    });
    const { service, tx } = makeService([blocker, unplaced]);

    const overflow = await service.computeOverflowOptions(
      user,
      unplaced,
      "day",
      tx as never,
      NOW,
    );

    // 09:00–10:00 is taken by the blocker, so the off-hours slot is 10:00.
    expect(overflow.outsideHours).toEqual({
      scheduledStartTime: "2026-06-08T10:00:00.000Z",
    });
  });
});

describe("SchedulerService.applyOverflowOption", () => {
  const NOW = new Date("2026-06-08T09:00:00Z");

  it("pins the task as a fixed anchor at the recomputed off-hours slot", async () => {
    const unplaced = task({
      id: "u",
      durationMinutes: 60,
      deadline: new Date("2026-06-08T12:00:00Z"),
      conflict: true,
      scheduledStartTime: null,
    });
    const { service, updates } = makeService([unplaced]);

    const { task: updated, displaced } = await service.applyOverflowOption(
      user,
      "u",
      "outsideHours",
      "day",
      NOW,
    );

    expect(displaced).toEqual([]);
    expect(updated.scheduledStartTime?.toISOString()).toBe(
      "2026-06-08T09:00:00.000Z",
    );
    const call = updates.find((u) => u.id === "u");
    expect(call?.data.fixed).toBe(true);
    // 09:00 UTC = 540 minutes from midnight.
    expect(call?.data.startTime).toBe(540);
    expect(call?.data.conflict).toBe(false);
  });

  it("pins the next-available slot and ignores the deadline", async () => {
    const unplaced = task({
      id: "u",
      durationMinutes: 60,
      deadline: new Date("2026-06-08T09:45:00Z"),
      conflict: true,
      scheduledStartTime: null,
    });
    const { service, updates } = makeService([unplaced]);

    const { task: updated } = await service.applyOverflowOption(
      user,
      "u",
      "nextAvailable",
      "day",
      NOW,
    );

    expect(updated.scheduledStartTime?.toISOString()).toBe(
      "2026-06-09T09:00:00.000Z",
    );
    expect(updates.find((u) => u.id === "u")?.data.fixed).toBe(true);
  });

  it("throws when no off-hours slot fits before the deadline", async () => {
    const unplaced = task({
      id: "u",
      durationMinutes: 60,
      deadline: new Date("2026-06-08T09:30:00Z"),
      conflict: true,
      scheduledStartTime: null,
    });
    const { service } = makeService([unplaced]);

    await expect(
      service.applyOverflowOption(user, "u", "outsideHours", "day", NOW),
    ).rejects.toThrow();
  });

  it("throws for an unknown task id", async () => {
    const { service } = makeService([]);
    await expect(
      service.applyOverflowOption(user, "missing", "outsideHours", "day", NOW),
    ).rejects.toThrow();
  });
});

describe("SchedulerService.resize — now-independent conflict detection", () => {
  it("self-heals a past task's stale conflict on resize (now recomputed)", async () => {
    // Inverted from "never recomputes a past task's conflict on resize": the
    // past task's stale conflict:true no longer overlaps anything (the live task
    // is resized within the afternoon), so it is recomputed to false and IS
    // written — but only the conflict flag, never the slot.
    const past = task({
      id: "past",
      conflict: true,
      scheduledStartTime: new Date("2026-06-08T09:00:00Z"),
    });
    const live = task({
      id: "live",
      scheduledStartTime: new Date("2026-06-08T13:00:00Z"),
    });
    const { service, updates } = makeService([past, live]);

    await service.resize(user, "live", new Date("2026-06-08T13:00:00Z"), 120);

    const pastUpdate = updates.find((u) => u.id === "past");
    expect(pastUpdate?.data.conflict).toBe(false);
    expect(pastUpdate?.data.scheduledStartTime).toBeUndefined();
  });

  it("flags a resized live task that overlaps a past block (now-independent)", async () => {
    // Inverted from "a past block never flags a resized live task". Resize the
    // live task back onto the past block's window (09:30–10:30 overlaps
    // 09:00–10:00) — detection is now-independent, so a conflict IS raised.
    const past = task({
      id: "past",
      scheduledStartTime: new Date("2026-06-08T09:00:00Z"),
    });
    const live = task({
      id: "live",
      scheduledStartTime: new Date("2026-06-08T13:00:00Z"),
    });
    const { service } = makeService([past, live]);

    const { task: updated } = await service.resize(
      user,
      "live",
      new Date("2026-06-08T09:30:00Z"),
      60,
    );

    expect(updated.conflict).toBe(true);
  });
});

describe("SchedulerService.cascadeReschedule — wrapping (night-owl) window", () => {
  // 22:00 → 06:00, Mon–Fri (the day the shift starts). This is where the
  // end-to-end derivation of the period ceiling (toEdf → endOfPeriod) must
  // extend past midnight so a single cross-day block can be placed.
  const owl: User = {
    ...user,
    workStart: 1320, // 22:00
    workEnd: 360, // 06:00
  };
  // Start-of-day Mon 06-08 (the shift's start day) — also the create anchor.
  const MON_ANCHOR = new Date("2026-06-08T00:00:00Z");

  it("places a 4h day-view no-deadline task at 22:00 crossing midnight (one block)", async () => {
    const owlTask = task({
      id: "owl",
      durationMinutes: 240, // 22:00 → 02:00 next day
      deadline: null,
      view: "day",
      schedulingAnchor: MON_ANCHOR,
      scheduledStartTime: null,
      conflict: true,
    });
    const { service, updates, tx } = makeService([owlTask]);

    await service.cascadeReschedule(owl, tx as never, MON_ANCHOR);

    const upd = updates.find((u) => u.id === "owl");
    // ONE row, one start, duration untouched — the block simply spans midnight.
    expect(upd?.data.scheduledStartTime).toEqual(
      new Date("2026-06-08T22:00:00.000Z"),
    );
    expect(upd?.data.conflict).toBe(false);
    expect(updates).toHaveLength(1);
  });

  it("a non-wrapping (09:00–17:00) user is unaffected: a 4h task fits in-hours", async () => {
    // Regression guard: the same 4h day-view task for a day-shift user is placed
    // at 09:00 within hours, never spilling past the bare-00:00 day ceiling.
    const dayTask = task({
      id: "day",
      durationMinutes: 240, // 09:00 → 13:00
      deadline: null,
      view: "day",
      schedulingAnchor: MON_ANCHOR,
      scheduledStartTime: null,
      conflict: true,
    });
    const { service, updates, tx } = makeService([dayTask]);

    await service.cascadeReschedule(user, tx as never, MON_ANCHOR);

    const upd = updates.find((u) => u.id === "day");
    expect(upd?.data.scheduledStartTime).toEqual(
      new Date("2026-06-08T09:00:00.000Z"),
    );
    expect(upd?.data.conflict).toBe(false);
  });
});
