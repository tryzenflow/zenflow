import { Test } from "@nestjs/testing";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService } from "../prisma/prisma.service";
import { IngestionScheduleService } from "./ingestion-schedule.service";
import { SyncRunService } from "./sync-run.service";

const NOW = new Date("2026-10-26T03:00:00.000Z");

/** Tiny in-memory stand-in for the two run tables. */
function makeDb(units: string[]) {
  const self: { current: unknown } = { current: null };
  const lock = { held: false };
  const unitRows = new Map(
    units.map((u) => [
      u,
      { status: "PENDING", fetched: false, created: 0, changed: 0 },
    ]),
  );
  const run = {
    id: "run1",
    kind: "PORTAL_TIMETABLE",
    integrationId: "int1",
    scheduleId: "sch1",
    claimedAt: NOW,
    dueAt: NOW,
    cacheHitStreak: 0,
    finishedAt: null as Date | null,
    notifiedAt: null as Date | null,
  };
  const prisma = {
    syncRunUnit: {
      updateMany: jest.fn(
        ({
          where,
          data,
        }: {
          where: { unit?: string; status: string };
          data: {
            status: string;
            fetched?: boolean;
            created?: number;
            changed?: number;
          };
        }) => {
          let count = 0;
          for (const [name, row] of unitRows) {
            if (where.unit && where.unit !== name) continue;
            if (row.status !== where.status) continue;
            row.status = data.status;
            if (data.fetched !== undefined) row.fetched = data.fetched;
            row.created = data.created ?? 0;
            row.changed = data.changed ?? 0;
            count += 1;
          }
          return Promise.resolve({ count });
        },
      ),
      aggregate: jest.fn(() =>
        Promise.resolve({
          _sum: {
            created: [...unitRows.values()].reduce((n, r) => n + r.created, 0),
            changed: [...unitRows.values()].reduce((n, r) => n + r.changed, 0),
          },
        }),
      ),
      count: jest.fn(
        ({ where }: { where: { status?: string; fetched?: boolean } }) =>
          Promise.resolve(
            [...unitRows.values()].filter(
              (r) =>
                (where.status === undefined || r.status === where.status) &&
                (where.fetched === undefined || r.fetched === where.fetched),
            ).length,
          ),
      ),
    },
    syncRun: {
      updateMany: jest.fn(
        ({
          where,
          data,
        }: {
          where: { finishedAt?: null; notifiedAt?: null };
          data: Partial<typeof run>;
        }) => {
          if (where.finishedAt === null && run.finishedAt)
            return Promise.resolve({ count: 0 });
          if (where.notifiedAt === null && run.notifiedAt)
            return Promise.resolve({ count: 0 });
          Object.assign(run, data);
          return Promise.resolve({ count: 1 });
        },
      ),
      findUnique: jest.fn(() => Promise.resolve(run)),
      update: jest.fn(() => Promise.resolve(run)),
    },
    notification: { findFirst: jest.fn().mockResolvedValue(null) },
    integration: {
      findUnique: jest.fn().mockResolvedValue({ userId: "u1" }),
    },
    // Advisory try-lock: `lock.held` simulates another job holding it.
    $queryRaw: jest.fn(() => Promise.resolve([{ locked: !lock.held }])),
    $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(self.current)),
  };
  self.current = prisma;
  return { prisma, run, lock };
}

async function make(units: string[]) {
  const db = makeDb(units);
  const schedule = {
    recordOutcome: jest.fn().mockResolvedValue(undefined),
    releaseClaim: jest.fn().mockResolvedValue(undefined),
  };
  const notifications = {
    create: jest.fn().mockResolvedValue({ id: "n1" }),
    notify: jest.fn(),
  };
  const module = await Test.createTestingModule({
    providers: [
      SyncRunService,
      { provide: PrismaService, useValue: db.prisma },
      { provide: IngestionScheduleService, useValue: schedule },
      { provide: NotificationsService, useValue: notifications },
    ],
  }).compile();
  return { service: module.get(SyncRunService), schedule, notifications, db };
}

describe("SyncRunService", () => {
  it("settles the schedule once, after the last unit reports, whatever the order", async () => {
    const { service, schedule } = await make(["w1", "w2", "w3"]);

    await service.report("run1", "w3", { ok: true, fetched: true }, NOW);
    await service.report("run1", "w1", { ok: true, fetched: false }, NOW);
    expect(schedule.recordOutcome).not.toHaveBeenCalled();

    await service.report("run1", "w2", { ok: true, fetched: false }, NOW);
    expect(schedule.recordOutcome).toHaveBeenCalledTimes(1);
    expect(schedule.recordOutcome).toHaveBeenCalledWith("sch1", {
      ok: true,
      servedFromCache: false,
      now: NOW,
    });
    expect(schedule.releaseClaim).not.toHaveBeenCalled();
  });

  it("counts a pass with no live request as served from cache", async () => {
    const { service, schedule } = await make(["w1"]);
    await service.report("run1", "w1", { ok: true, fetched: false }, NOW);
    expect(schedule.recordOutcome).toHaveBeenCalledWith(
      "sch1",
      expect.objectContaining({ ok: true, servedFromCache: true }),
    );
  });

  it("records a failure and hands the claim back when any unit failed", async () => {
    const { service, schedule } = await make(["w1", "w2"]);
    await service.report("run1", "w1", { ok: false, fetched: false }, NOW);
    await service.report("run1", "w2", { ok: true, fetched: true }, NOW);
    expect(schedule.recordOutcome).toHaveBeenCalledWith(
      "sch1",
      expect.objectContaining({ ok: false }),
    );
    expect(schedule.releaseClaim).toHaveBeenCalledTimes(1);
  });

  it("ignores a repeated report for a unit that already finished", async () => {
    const { service, schedule } = await make(["w1"]);
    await service.report("run1", "w1", { ok: true, fetched: true }, NOW);
    await service.report("run1", "w1", { ok: false, fetched: false }, NOW);
    expect(schedule.recordOutcome).toHaveBeenCalledTimes(1);
  });

  it("notifies once per run, however many weeks report a change", async () => {
    const { service, notifications } = await make(["w1", "w2"]);
    const note = {
      event: "timetable.ready" as const,
      title: "Sem 1 timetable is live",
      since: NOW,
    };

    expect(await service.notifyOnce("run1", "u1", note, NOW)).toBe(true);
    expect(await service.notifyOnce("run1", "u1", note, NOW)).toBe(false);
    expect(notifications.create).toHaveBeenCalledTimes(1);
    expect(notifications.create).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({
        title: note.title,
        content: "Still syncing, check back soon.",
        eventName: "timetable.ready",
      }),
      expect.anything(),
    );
  });

  it("announces availability once per term even across runs", async () => {
    const { service, notifications, db } = await make(["w1"]);
    db.prisma.notification.findFirst.mockResolvedValueOnce({ id: "old" });
    const sent = await service.notifyOnce(
      null,
      "u1",
      {
        event: "timetable.ready",
        title: "Sem 1 timetable is live",
        since: NOW,
      },
      NOW,
    );
    expect(sent).toBe(false);
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it("raises one 'N new lectures' notice with the run's total when it settles", async () => {
    const { service, notifications } = await make(["w1", "w2", "w3"]);
    await service.report(
      "run1",
      "w1",
      { ok: true, fetched: true, created: 2 },
      NOW,
    );
    await service.report(
      "run1",
      "w2",
      { ok: true, fetched: true, changed: 4 },
      NOW,
    );
    expect(notifications.create).not.toHaveBeenCalled();

    await service.report(
      "run1",
      "w3",
      { ok: true, fetched: true, created: 1 },
      NOW,
    );
    expect(notifications.create).toHaveBeenCalledTimes(1);
    expect(notifications.create).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({
        title: "3 new lectures",
        content: "Check your timetable.",
        eventName: "timetable.changed",
      }),
      expect.anything(),
    );
  });

  it("words a single new lecture in the singular", async () => {
    const { service, notifications } = await make(["w1"]);
    await service.report(
      "run1",
      "w1",
      { ok: true, fetched: true, created: 1 },
      NOW,
    );
    expect(notifications.create).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ title: "A new lecture" }),
      expect.anything(),
    );
  });

  it("falls back to 'changed' when nothing was added", async () => {
    const { service, notifications } = await make(["w1"]);
    await service.report(
      "run1",
      "w1",
      { ok: true, fetched: true, changed: 2 },
      NOW,
    );
    expect(notifications.create).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({
        title: "Your timetable changed",
        content: "See what changed.",
      }),
      expect.anything(),
    );
  });

  it("stays silent at settle when the run already raised its notice", async () => {
    const { service, notifications } = await make(["w1", "w2"]);
    await service.notifyOnce(
      "run1",
      "u1",
      {
        event: "timetable.ready",
        title: "Sem 1 timetable is live",
        since: NOW,
      },
      NOW,
    );
    notifications.create.mockClear();
    await service.report(
      "run1",
      "w1",
      { ok: true, fetched: true, created: 2 },
      NOW,
    );
    await service.report(
      "run1",
      "w2",
      { ok: true, fetched: true, created: 1 },
      NOW,
    );
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it("skips when another job holds the notice lock instead of waiting", async () => {
    const { service, notifications, db } = await make(["w1"]);
    db.lock.held = true;
    const sent = await service.notifyOnce(
      null,
      "u1",
      {
        event: "timetable.ready",
        title: "Sem 1 timetable is live",
        since: NOW,
      },
      NOW,
    );
    expect(sent).toBe(false);
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it("closes a stale run by failing its pending units", async () => {
    const { service, schedule } = await make(["w1", "w2"]);
    (
      service as unknown as { prisma: { syncRun: { findMany: jest.Mock } } }
    ).prisma.syncRun.findMany = jest.fn().mockResolvedValue([{ id: "run1" }]);
    await service.report("run1", "w1", { ok: true, fetched: true }, NOW);

    expect(await service.sweepStale(NOW)).toBe(1);
    expect(schedule.recordOutcome).toHaveBeenCalledWith(
      "sch1",
      expect.objectContaining({ ok: false }),
    );
  });
});
