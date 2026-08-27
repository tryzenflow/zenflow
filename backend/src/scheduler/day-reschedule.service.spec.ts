import { DayRescheduleService } from "./day-reschedule.service";
import type { Session } from "../../generated/prisma";

/**
 * Coverage for the I/O wrapper around the PURE `optimize()` (`heuristic.ts`).
 * We assert the orchestration — candidate/occupied loading scoped to a single
 * calendar day, diffing against the prior `scheduledStartTime`, and the
 * `SessionEvent` telemetry written (no `batchId` — that field doesn't exist
 * on the current model). The placement MATH itself is `heuristic.spec.ts`'s
 * job.
 */

const TZ = "UTC";
// 2026-06-15T00:00:00Z is a Monday.
const MONDAY = "2026-06-15";
const DAY_START = new Date(`${MONDAY}T00:00:00.000Z`);
const DAY_END = new Date(`${MONDAY}T23:59:00.000Z`);
// Default preference matrix (empty -> cold-start fallback): morning 8-11AM
// is the peak bucket.
const EMPTY_MATRIX: number[] = [];

function session(overrides: Partial<Session> & { id: string }): Session {
  return {
    title: "Session",
    note: null,
    durationMinutes: 60,
    deadline: DAY_END,
    startTime: 0,
    status: "PENDING",
    type: "MANUAL",
    source: "USER",
    conflict: false,
    scheduledStartTime: null,
    userId: "user-1",
    seriesId: null,
    sessionIndex: null,
    sessionTotal: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

interface EventCall {
  sessionId: string;
  userId: string;
  eventType: string;
  oldSnapshot: unknown;
  newSnapshot: unknown;
}

interface UpdateCall {
  where: { id: string };
  data: { scheduledStartTime: Date };
}

function makeService(candidates: Session[], others: Session[] = []) {
  const events: EventCall[] = [];
  const updates: UpdateCall[] = [];

  const findMany = jest
    .fn()
    // 1st call: candidates in the day window.
    .mockResolvedValueOnce(candidates)
    // 2nd call: fixed/other sessions occupying the day window.
    .mockResolvedValueOnce(
      others.map((o) => ({
        scheduledStartTime: o.scheduledStartTime,
        durationMinutes: o.durationMinutes,
      })),
    );

  const tx = {
    session: {
      update: jest.fn((args: UpdateCall) => {
        updates.push(args);
        return Promise.resolve({});
      }),
    },
    sessionEvent: {
      create: jest.fn((args: { data: EventCall }) => {
        events.push(args.data);
        return Promise.resolve({});
      }),
    },
  };

  const prisma = {
    session: { findMany },
    $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
  };

  return {
    service: new DayRescheduleService(prisma as never),
    findMany,
    events,
    updates,
  };
}

describe("DayRescheduleService.rescheduleDay", () => {
  it("returns empty diffs and never opens a transaction when there are no candidates", async () => {
    const { service, findMany, events, updates } = makeService([]);

    const result = await service.rescheduleDay(
      "user-1",
      MONDAY,
      TZ,
      EMPTY_MATRIX,
      DAY_START,
    );

    expect(result).toEqual({ date: MONDAY, diffs: [] });
    // Only the candidates query ran — no need to load "others" either.
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it("places a freshly-created session (no scheduledStartTime yet) into its best free slot", async () => {
    const candidate = session({
      id: "new-session",
      title: "Write report",
      durationMinutes: 60,
      deadline: DAY_END,
      scheduledStartTime: null,
    });
    const now = new Date(`${MONDAY}T05:00:00.000Z`); // before the 8AM peak
    const { service, events, updates } = makeService([candidate]);

    const result = await service.rescheduleDay(
      "user-1",
      MONDAY,
      TZ,
      EMPTY_MATRIX,
      now,
    );

    expect(result.diffs).toHaveLength(1);
    expect(result.diffs[0]).toEqual({
      id: "new-session",
      title: "Write report",
      oldScheduledStartTime: null,
      newScheduledStartTime: `${MONDAY}T08:00:00.000Z`,
    });

    expect(updates).toHaveLength(1);
    expect(updates[0]).toEqual({
      where: { id: "new-session" },
      data: { scheduledStartTime: new Date(`${MONDAY}T08:00:00.000Z`) },
    });

    expect(events).toHaveLength(1);
    const ev = events[0];
    expect(ev.sessionId).toBe("new-session");
    expect(ev.userId).toBe("user-1");
    expect(ev.eventType).toBe("RESCHEDULED");
    expect(ev.oldSnapshot).toEqual({ scheduledStartTime: null });
    expect(ev.newSnapshot).toEqual({
      scheduledStartTime: `${MONDAY}T08:00:00.000Z`,
    });
    // No `batchId` — that field doesn't exist on the current SessionEvent model.
    expect(ev).not.toHaveProperty("batchId");
  });

  it("writes nothing when the best placement matches where the session already sits", async () => {
    const alreadyOptimal = session({
      id: "already-optimal",
      durationMinutes: 60,
      deadline: DAY_END,
      scheduledStartTime: new Date(`${MONDAY}T08:00:00.000Z`),
    });
    const now = new Date(`${MONDAY}T05:00:00.000Z`);
    const { service, events, updates } = makeService([alreadyOptimal]);

    const result = await service.rescheduleDay(
      "user-1",
      MONDAY,
      TZ,
      EMPTY_MATRIX,
      now,
    );

    expect(result.diffs).toHaveLength(0);
    expect(updates).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  it("clamps the placement window's start to now, never placing a session in the past", async () => {
    // now is well after the 8-11AM peak, so the candidate must land at/after
    // now even though the preference matrix favors an earlier hour.
    const now = new Date(`${MONDAY}T10:00:00.000Z`);
    const candidate = session({
      id: "clamped",
      durationMinutes: 30,
      deadline: DAY_END,
      scheduledStartTime: null,
    });
    const { service, updates } = makeService([candidate]);

    const result = await service.rescheduleDay(
      "user-1",
      MONDAY,
      TZ,
      EMPTY_MATRIX,
      now,
    );

    expect(result.diffs).toHaveLength(1);
    const placedAt = updates[0].data.scheduledStartTime;
    expect(placedAt.getTime()).toBeGreaterThanOrEqual(now.getTime());
  });

  it("places a session whose deadline is the exclusive midnight ceiling of the NEXT day — not skipped as a zero-width window", async () => {
    // Mirrors `deadlineOptions`' "Tomorrow"/"No rush"/etc. shape: a deadline
    // that is itself exactly the start of the day AFTER the one being
    // repacked. Before the `dayEnd`/`deadlineDayStr` fix, this candidate was
    // silently skipped forever (`bestFreeSlot` saw a `[dayStart, dayStart)`
    // window and returned null) with no error surfaced anywhere.
    const nextDayMidnight = new Date(`2026-06-16T00:00:00.000Z`);
    const candidate = session({
      id: "boundary-deadline",
      durationMinutes: 60,
      deadline: nextDayMidnight,
      scheduledStartTime: null,
    });
    const now = new Date(`${MONDAY}T05:00:00.000Z`);
    const { service, updates } = makeService([candidate]);

    const result = await service.rescheduleDay(
      "user-1",
      MONDAY,
      TZ,
      EMPTY_MATRIX,
      now,
    );

    expect(result.diffs).toHaveLength(1);
    expect(updates).toHaveLength(1);
    // Placed within Monday, at the preference-matrix peak (8AM).
    expect(updates[0].data.scheduledStartTime.toISOString()).toBe(
      `${MONDAY}T08:00:00.000Z`,
    );
  });

  it("treats non-candidate sessions with a scheduledStartTime in the window as fixed/occupied", async () => {
    // A fixed LMS lecture sits on the peak 8AM slot; the movable candidate
    // (also preferring 8AM) must be placed elsewhere.
    const fixed = session({
      id: "fixed-lecture",
      source: "LMS",
      durationMinutes: 60,
      scheduledStartTime: new Date(`${MONDAY}T08:00:00.000Z`),
    });
    const candidate = session({
      id: "movable",
      durationMinutes: 60,
      deadline: DAY_END,
      scheduledStartTime: null,
    });
    const now = new Date(`${MONDAY}T05:00:00.000Z`);
    const { service, updates } = makeService([candidate], [fixed]);

    const result = await service.rescheduleDay(
      "user-1",
      MONDAY,
      TZ,
      EMPTY_MATRIX,
      now,
    );

    expect(result.diffs).toHaveLength(1);
    expect(updates[0].data.scheduledStartTime.toISOString()).not.toBe(
      `${MONDAY}T08:00:00.000Z`,
    );
  });
});
