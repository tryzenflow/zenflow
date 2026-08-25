import { AbandonedSessionsService } from "./abandoned-sessions.service";
import { ABANDON_GRACE_MS } from "../common/constants";
import type { Session } from "../../generated/prisma";

/**
 * Coverage for the abandoned-session sweep. A session is ABANDONED only when it is
 * PENDING and its (always-present — `deadline` is NOT NULL) deadline passed by more
 * than the grace window. Within-grace overdue sessions are never swept, and the
 * update flips status away from PENDING so a second run is a no-op (idempotency).
 *
 * The Prisma mock is an in-memory session table that honors the
 * `status: PENDING` + `deadline: { lt: cutoff }` filter so the idempotency test
 * exercises the same query the next real run would. Every `sessionEvent.create` is
 * captured to assert exactly which events were emitted.
 */

const NOW = new Date("2026-06-18T12:00:00.000Z");

function session(overrides: Partial<Session> & { id: string }): Session {
  return {
    title: "Session",
    note: null,
    durationMinutes: 60,
    // `Session.deadline` is NOT NULL — every fixture needs a real Date.
    deadline: new Date("2026-06-20T12:00:00.000Z"),
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
  rewardScore: number;
}

type FindManyArgs = {
  where: { status: string; deadline?: { lt: Date } };
  take: number;
};

function makeService(rows: Session[]): {
  service: AbandonedSessionsService;
  events: EventCall[];
  byId: Map<string, Session>;
  findManyCalls: number;
} {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const events: EventCall[] = [];
  let findManyCalls = 0;

  const sessionTable = {
    findMany: jest.fn((args: FindManyArgs) => {
      findManyCalls += 1;
      const lt = args.where.deadline?.lt;
      const matches = [...byId.values()]
        .filter(
          (t) =>
            t.status === args.where.status &&
            (lt === undefined || t.deadline.getTime() < lt.getTime()),
        )
        .slice(0, args.take)
        .map((t) => ({
          id: t.id,
          userId: t.userId,
          scheduledStartTime: t.scheduledStartTime,
          durationMinutes: t.durationMinutes,
          // The real query selects related Tag names; the base fixture has none.
          tags: (t as Session & { tags?: { name: string }[] }).tags ?? [],
        }));
      return Promise.resolve(matches);
    }),
    update: jest.fn(
      (args: { where: { id: string }; data: Partial<Session> }) => {
        const merged = { ...byId.get(args.where.id)!, ...args.data };
        byId.set(args.where.id, merged);
        return Promise.resolve(merged);
      },
    ),
  };

  const tx = {
    session: sessionTable,
    sessionEvent: {
      create: jest.fn((args: { data: EventCall }) => {
        events.push(args.data);
        return Promise.resolve({});
      }),
    },
  };

  const prisma = {
    session: sessionTable,
    $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
  };

  return {
    service: new AbandonedSessionsService(prisma as never),
    events,
    byId,
    get findManyCalls() {
      return findManyCalls;
    },
  };
}

describe("AbandonedSessionsService.sweep", () => {
  it("abandons a PENDING session overdue beyond the grace window", async () => {
    const overdue = session({
      id: "overdue",
      // 3 hours past, well beyond the 1h grace.
      deadline: new Date(NOW.getTime() - 3 * 60 * 60 * 1000),
      scheduledStartTime: new Date("2026-06-18T08:00:00.000Z"),
      durationMinutes: 45,
    });
    const { service, events, byId } = makeService([overdue]);

    const count = await service.sweep(NOW);

    expect(count).toBe(1);
    expect(byId.get("overdue")?.status).toBe("ABANDONED");
    expect(events).toHaveLength(1);
    const ev = events[0];
    expect(ev.eventType).toBe("ABANDON");
    expect(ev.sessionId).toBe("overdue");
    expect(ev.userId).toBe("user-1");
    expect(ev.rewardScore).toBe(-1.0);
    // Snapshot = the slot it died in, plus the session's tag names at event time.
    expect(ev.newSnapshot).toEqual({
      scheduledStartTime: "2026-06-18T08:00:00.000Z",
      durationMinutes: 45,
      tags: [],
    });
  });

  it("ignores an overdue session still within the grace window", async () => {
    const justLate = session({
      id: "just-late",
      // Passed, but only by half the grace window.
      deadline: new Date(NOW.getTime() - ABANDON_GRACE_MS / 2),
    });
    const { service, events, byId } = makeService([justLate]);

    const count = await service.sweep(NOW);

    expect(count).toBe(0);
    expect(byId.get("just-late")?.status).toBe("PENDING");
    expect(events).toHaveLength(0);
  });

  it("ignores DONE and already-ABANDONED sessions even when overdue", async () => {
    const deep = new Date(NOW.getTime() - 5 * 60 * 60 * 1000);
    const done = session({ id: "done", status: "DONE", deadline: deep });
    const already = session({
      id: "already",
      status: "ABANDONED",
      deadline: deep,
    });
    const { service, events, byId } = makeService([done, already]);

    const count = await service.sweep(NOW);

    expect(count).toBe(0);
    expect(byId.get("done")?.status).toBe("DONE");
    expect(byId.get("already")?.status).toBe("ABANDONED");
    expect(events).toHaveLength(0);
  });

  it("is idempotent: a second run does not re-emit for an abandoned session", async () => {
    const overdue = session({
      id: "overdue",
      deadline: new Date(NOW.getTime() - 3 * 60 * 60 * 1000),
    });
    const { service, events } = makeService([overdue]);

    const first = await service.sweep(NOW);
    const second = await service.sweep(NOW);

    expect(first).toBe(1);
    expect(second).toBe(0);
    // Exactly one ABANDON event across both runs.
    expect(events).toHaveLength(1);
  });
});
