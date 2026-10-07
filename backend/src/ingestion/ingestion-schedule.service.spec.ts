import { ConfigService } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { PrismaService } from "../prisma/prisma.service";
import { IngestionScheduleService } from "./ingestion-schedule.service";
import type { SyncKindName } from "./core/schedule-plan";

// ── in-memory Prisma double ────────────────────────────────────────────────
// Same idiom as the watcher specs: a real object graph rather than assertions
// on call arguments, so "this row was claimed once" is checked against what is
// actually stored.

interface ScheduleRow {
  id: string;
  kind: string;
  nextDueAt: Date;
  lastClaimedAt: Date | null;
  lastRunAt: Date | null;
  lastSuccessAt: Date | null;
  lastSuccessTerm: string;
  consecutiveFailures: number;
  cacheHitStreak: number;
  integrationId: string;
}

interface IntegrationRow {
  id: string;
  userId: string;
  provider: "LMS" | "PORTAL";
}

function makePrismaDouble(
  integrations: IntegrationRow[] = [],
  schedules: ScheduleRow[] = [],
) {
  let seq = schedules.length;

  const client = {
    integration: {
      findMany: (args: {
        where: {
          provider: "LMS" | "PORTAL";
          schedules?: { none: { kind: string } };
        };
      }) =>
        Promise.resolve(
          integrations
            .filter((i) => i.provider === args.where.provider)
            .filter((i) => {
              const kind = args.where.schedules?.none.kind;
              if (!kind) return true;
              return !schedules.some(
                (s) => s.integrationId === i.id && s.kind === kind,
              );
            })
            .map((i) => ({ id: i.id })),
        ),
    },
    ingestionSchedule: {
      createMany: (args: {
        data: { integrationId: string; kind: string; nextDueAt: Date }[];
        skipDuplicates?: boolean;
      }) => {
        let count = 0;
        for (const d of args.data) {
          const clash = schedules.some(
            (s) => s.integrationId === d.integrationId && s.kind === d.kind,
          );
          // The [integrationId, kind] unique index, which is what makes
          // ensureRows safe to call repeatedly.
          if (clash && args.skipDuplicates) continue;
          if (clash) return Promise.reject(new Error("unique violation"));
          schedules.push({
            id: `sch${++seq}`,
            kind: d.kind,
            nextDueAt: d.nextDueAt,
            lastClaimedAt: null,
            lastRunAt: null,
            lastSuccessAt: null,
            lastSuccessTerm: "",
            consecutiveFailures: 0,
            cacheHitStreak: 0,
            integrationId: d.integrationId,
          });
          count += 1;
        }
        return Promise.resolve({ count });
      },
      aggregate: (args: {
        where: { integrationId: string; kind: { in: string[] } };
      }) => {
        const runs = schedules
          .filter(
            (s) =>
              s.integrationId === args.where.integrationId &&
              args.where.kind.in.includes(s.kind) &&
              s.lastRunAt,
          )
          .map((s) => (s.lastRunAt as Date).getTime());
        return Promise.resolve({
          _max: { lastRunAt: runs.length ? new Date(Math.max(...runs)) : null },
        });
      },
      findMany: (args: {
        where: { kind: string; nextDueAt: { lte: Date } };
        take: number;
      }) => {
        const rows = schedules
          .filter(
            (s) =>
              s.kind === args.where.kind &&
              s.nextDueAt.getTime() <= args.where.nextDueAt.lte.getTime(),
          )
          .sort(
            (a, b) =>
              a.nextDueAt.getTime() - b.nextDueAt.getTime() ||
              a.id.localeCompare(b.id),
          )
          .slice(0, args.take);
        return Promise.resolve(
          rows.map((s) => ({
            id: s.id,
            nextDueAt: s.nextDueAt,
            cacheHitStreak: s.cacheHitStreak,
            integrationId: s.integrationId,
            integration: {
              userId:
                integrations.find((i) => i.id === s.integrationId)?.userId ??
                "unknown",
            },
          })),
        );
      },
      updateMany: (args: {
        where: {
          id?: string;
          nextDueAt?: Date | { gt: Date };
          integrationId?: string;
          kind?: string | { in: string[] };
          lastSuccessTerm?: { not: string };
          OR?: { lastClaimedAt: null | { lt: Date } }[];
          lastClaimedAt?: Date;
        };
        data: Record<string, unknown>;
      }) => {
        const matches = schedules.filter((s) => {
          if (args.where.id !== undefined && s.id !== args.where.id)
            return false;
          if (
            args.where.integrationId !== undefined &&
            s.integrationId !== args.where.integrationId
          )
            return false;
          const kindFilter = args.where.kind;
          if (typeof kindFilter === "string" && s.kind !== kindFilter)
            return false;
          if (typeof kindFilter === "object" && !kindFilter.in.includes(s.kind))
            return false;
          if (
            args.where.lastClaimedAt instanceof Date &&
            s.lastClaimedAt?.getTime() !== args.where.lastClaimedAt.getTime()
          )
            return false;
          // The compare-and-set: the row must still hold the value the caller
          // read, or this matches nothing.
          const due = args.where.nextDueAt;
          if (due instanceof Date && s.nextDueAt.getTime() !== due.getTime())
            return false;
          if (
            due &&
            !(due instanceof Date) &&
            !(s.nextDueAt.getTime() > due.gt.getTime())
          )
            return false;
          if (
            args.where.lastSuccessTerm &&
            s.lastSuccessTerm === args.where.lastSuccessTerm.not
          )
            return false;
          if (
            args.where.OR &&
            !args.where.OR.some((c) =>
              c.lastClaimedAt === null
                ? s.lastClaimedAt === null
                : s.lastClaimedAt !== null &&
                  s.lastClaimedAt.getTime() < c.lastClaimedAt.lt.getTime(),
            )
          )
            return false;
          return true;
        });
        for (const row of matches) {
          for (const [k, v] of Object.entries(args.data)) {
            // Prisma's { increment: n } atomic operator.
            if (v && typeof v === "object" && "increment" in v) {
              (row as unknown as Record<string, number>)[k] += (
                v as { increment: number }
              ).increment;
            } else {
              (row as unknown as Record<string, unknown>)[k] = v;
            }
          }
        }
        return Promise.resolve({ count: matches.length });
      },
      update: (args: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        const row = schedules.find((s) => s.id === args.where.id);
        if (!row) throw new Error(`no schedule ${args.where.id}`);
        for (const [k, v] of Object.entries(args.data)) {
          // Prisma's { increment: n } atomic operator.
          if (v && typeof v === "object" && "increment" in v) {
            (row as unknown as Record<string, number>)[k] += (
              v as { increment: number }
            ).increment;
          } else {
            (row as unknown as Record<string, unknown>)[k] = v;
          }
        }
        return Promise.resolve(row);
      },
      findUnique: (args: {
        where: { integrationId_kind: { integrationId: string; kind: string } };
      }) => {
        const { integrationId, kind } = args.where.integrationId_kind;
        const row = schedules.find(
          (s) => s.integrationId === integrationId && s.kind === kind,
        );
        return Promise.resolve(
          row
            ? {
                lastSuccessAt: row.lastSuccessAt,
                lastSuccessTerm: row.lastSuccessTerm,
              }
            : null,
        );
      },
      count: (args: { where: { kind: string } }) =>
        Promise.resolve(
          schedules.filter((s) => s.kind === args.where.kind).length,
        ),
    },
  };

  return { client, schedules, integrations };
}

// ── fixtures (deliberately fictional) ──────────────────────────────────────
const NOW = new Date("2026-10-26T03:00:00.000Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const ENV: Record<string, string | number> = {};

async function makeService(
  integrations: IntegrationRow[] = [],
  schedules: ScheduleRow[] = [],
  env: Record<string, string | number> = ENV,
) {
  const db = makePrismaDouble(integrations, schedules);
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      IngestionScheduleService,
      {
        provide: PrismaService,
        useValue: db.client,
      },
      {
        provide: ConfigService,
        useValue: { get: (name: string) => env[name] },
      },
    ],
  }).compile();
  return { db, service: module.get(IngestionScheduleService) };
}

function schedule(over: Partial<ScheduleRow> & { id: string }): ScheduleRow {
  return {
    kind: "PORTAL_TIMETABLE",
    nextDueAt: NOW,
    lastClaimedAt: null,
    lastRunAt: null,
    lastSuccessAt: null,
    lastSuccessTerm: "",
    consecutiveFailures: 0,
    cacheHitStreak: 0,
    integrationId: "int1",
    ...over,
  };
}

const PORTAL_INTEGRATIONS: IntegrationRow[] = [
  { id: "int1", userId: "u1", provider: "PORTAL" },
  { id: "int2", userId: "u2", provider: "PORTAL" },
];

describe("IngestionScheduleService — plans", () => {
  it("covers all five kinds, discovery ordered first", async () => {
    const { service } = await makeService();
    const plans = service.allPlans();

    expect(plans.map((p) => p.kind).sort()).toEqual([
      "LMS_CALENDAR",
      "LMS_DISCOVERY",
      "PORTAL_DISCOVERY",
      "PORTAL_EXAM",
      "PORTAL_TIMETABLE",
    ]);
    const discovery = plans.filter((p) => p.discovery);
    const walks = plans.filter((p) => !p.discovery);
    expect(discovery).toHaveLength(2);
    expect(Math.max(...discovery.map((p) => p.order))).toBeLessThan(
      Math.min(...walks.map((p) => p.order)),
    );
  });

  it("defaults the LMS calendar to hourly, portal discovery to a semester and the rest to daily", async () => {
    const { service } = await makeService();
    expect(service.planFor("LMS_CALENDAR").targetPeriodMs).toBe(HOUR);
    expect(service.planFor("PORTAL_TIMETABLE").targetPeriodMs).toBe(DAY);
    expect(service.planFor("PORTAL_EXAM").targetPeriodMs).toBe(DAY);
    expect(service.planFor("LMS_DISCOVERY").targetPeriodMs).toBe(DAY);
    expect(service.planFor("PORTAL_DISCOVERY").targetPeriodMs).toBe(120 * DAY);
  });

  it("takes target periods from config, tolerating a string from a .env file", async () => {
    const { service } = await makeService([], [], {
      ...ENV,
      INGESTION_TIMETABLE_PERIOD_MS: "60000",
    });
    expect(service.planFor("PORTAL_TIMETABLE").targetPeriodMs).toBe(MINUTE);
  });

  it("ignores a nonsensical period rather than scheduling every instant", async () => {
    const { service } = await makeService([], [], {
      ...ENV,
      INGESTION_TIMETABLE_PERIOD_MS: "not-a-number",
      INGESTION_EXAM_PERIOD_MS: "0",
    });
    expect(service.planFor("PORTAL_TIMETABLE").targetPeriodMs).toBe(DAY);
    expect(service.planFor("PORTAL_EXAM").targetPeriodMs).toBe(DAY);
  });
});

describe("IngestionScheduleService — seeding rows", () => {
  it("creates one row per kind for the provider, and nothing for the other", async () => {
    const { db, service } = await makeService(PORTAL_INTEGRATIONS);

    const created = await service.ensureRows("int1", "PORTAL", NOW);

    expect(created).toBe(3);
    expect(db.schedules.map((s) => s.kind).sort()).toEqual([
      "PORTAL_DISCOVERY",
      "PORTAL_EXAM",
      "PORTAL_TIMETABLE",
    ]);
  });

  it("seeds every kind due now; the timetable gates itself on discovery", async () => {
    const { db, service } = await makeService(PORTAL_INTEGRATIONS);
    await service.ensureRows("int1", "PORTAL", NOW);

    for (const row of db.schedules) expect(row.nextDueAt).toEqual(NOW);
  });

  it("is idempotent, so reconnecting does not duplicate or reset a schedule", async () => {
    const { db, service } = await makeService(PORTAL_INTEGRATIONS);
    await service.ensureRows("int1", "PORTAL", NOW);
    const before = db.schedules.map((s) => ({ ...s }));

    const created = await service.ensureRows(
      "int1",
      "PORTAL",
      new Date(NOW.getTime() + DAY),
    );

    expect(created).toBe(0);
    expect(db.schedules).toEqual(before);
  });

  it("seeds only the LMS kinds for an LMS integration", async () => {
    const { db, service } = await makeService([
      { id: "int3", userId: "u3", provider: "LMS" },
    ]);
    await service.ensureRows("int3", "LMS", NOW);
    expect(db.schedules.map((s) => s.kind).sort()).toEqual([
      "LMS_CALENDAR",
      "LMS_DISCOVERY",
    ]);
  });

  it("ensureAllRows backfills integrations that predate the feature", async () => {
    const { db, service } = await makeService([
      ...PORTAL_INTEGRATIONS,
      { id: "int3", userId: "u3", provider: "LMS" },
    ]);

    const created = await service.ensureAllRows(NOW);

    // 2 portal integrations x 3 kinds + 1 LMS integration x 2 kinds.
    expect(created).toBe(8);
    expect(db.schedules).toHaveLength(8);
  });

  it("ensureAllRows is a no-op once every row exists", async () => {
    const { db, service } = await makeService(PORTAL_INTEGRATIONS);
    await service.ensureAllRows(NOW);
    const count = db.schedules.length;

    expect(await service.ensureAllRows(NOW)).toBe(0);
    expect(db.schedules).toHaveLength(count);
  });

  it("ensureAllRows heals a single hand-deleted row without touching the others", async () => {
    const { db, service } = await makeService(PORTAL_INTEGRATIONS);
    await service.ensureAllRows(NOW);
    const victim = db.schedules.findIndex(
      (s) => s.integrationId === "int1" && s.kind === "PORTAL_EXAM",
    );
    db.schedules.splice(victim, 1);

    expect(await service.ensureAllRows(NOW)).toBe(1);
    expect(
      db.schedules.filter(
        (s) => s.integrationId === "int1" && s.kind === "PORTAL_EXAM",
      ),
    ).toHaveLength(1);
  });
});

describe("IngestionScheduleService — claimDue", () => {
  const kind: SyncKindName = "PORTAL_TIMETABLE";

  it("returns only rows that are actually due", async () => {
    const { service } = await makeService(PORTAL_INTEGRATIONS, [
      schedule({ id: "a", nextDueAt: new Date(NOW.getTime() - MINUTE) }),
      schedule({
        id: "b",
        integrationId: "int2",
        nextDueAt: new Date(NOW.getTime() + MINUTE),
      }),
    ]);

    const claimed = await service.claimDue(kind, NOW, 10);

    expect(claimed.map((c) => c.scheduleId)).toEqual(["a"]);
  });

  it("returns the most overdue first and caps at batchSize", async () => {
    const { service } = await makeService(PORTAL_INTEGRATIONS, [
      schedule({ id: "new", nextDueAt: new Date(NOW.getTime() - MINUTE) }),
      schedule({ id: "old", nextDueAt: new Date(NOW.getTime() - HOUR) }),
      schedule({ id: "mid", nextDueAt: new Date(NOW.getTime() - 30 * MINUTE) }),
    ]);

    const claimed = await service.claimDue(kind, NOW, 2);

    expect(claimed.map((c) => c.scheduleId)).toEqual(["old", "mid"]);
  });

  it("stamps the next due time from the claim instant, not the old due time", async () => {
    // The de-bursting mechanism: see nextDueAfterRun's comment.
    const { db, service } = await makeService(PORTAL_INTEGRATIONS, [
      schedule({ id: "a", nextDueAt: new Date(NOW.getTime() - 5 * HOUR) }),
    ]);

    await service.claimDue(kind, NOW, 10);

    expect(db.schedules[0].nextDueAt).toEqual(new Date(NOW.getTime() + DAY));
    expect(db.schedules[0].lastClaimedAt).toEqual(NOW);
  });

  it("carries the userId and cache streak the pass needs", async () => {
    const { service } = await makeService(PORTAL_INTEGRATIONS, [
      schedule({ id: "a", integrationId: "int2", cacheHitStreak: 4 }),
    ]);

    const [claimed] = await service.claimDue(kind, NOW, 10);

    expect(claimed).toEqual({
      scheduleId: "a",
      integrationId: "int2",
      userId: "u2",
      cacheHitStreak: 4,
      dueAt: NOW,
      claimedAt: NOW,
    });
  });

  it("releaseClaim restores the pre-claim due time and touches no failure counter", async () => {
    const { db, service } = await makeService(PORTAL_INTEGRATIONS, [
      schedule({ id: "a", consecutiveFailures: 2 }),
    ]);
    const [claimed] = await service.claimDue(kind, NOW, 10);
    expect(db.schedules[0].nextDueAt.getTime()).toBeGreaterThan(NOW.getTime());

    await service.releaseClaim(claimed);

    expect(db.schedules[0].nextDueAt).toEqual(NOW);
    expect(db.schedules[0].consecutiveFailures).toBe(2);
  });

  it("claims nothing for a zero or negative batch size", async () => {
    const { db, service } = await makeService(PORTAL_INTEGRATIONS, [
      schedule({ id: "a" }),
    ]);

    expect(await service.claimDue(kind, NOW, 0)).toEqual([]);
    expect(await service.claimDue(kind, NOW, -1)).toEqual([]);
    // Crucially, nothing was stamped either — an empty population must not
    // march the schedule forward.
    expect(db.schedules[0].nextDueAt).toEqual(NOW);
    expect(db.schedules[0].lastClaimedAt).toBeNull();
  });

  it("never hands one target to two overlapping ticks", async () => {
    // The compare-and-set in action. Both ticks read the same due rows; the
    // second finds nextDueAt already moved and skips every one of them.
    const { db, service } = await makeService(PORTAL_INTEGRATIONS, [
      schedule({ id: "a", nextDueAt: new Date(NOW.getTime() - HOUR) }),
      schedule({
        id: "b",
        integrationId: "int2",
        nextDueAt: new Date(NOW.getTime() - HOUR),
      }),
    ]);

    const first = await service.claimDue(kind, NOW, 10);
    const second = await service.claimDue(kind, NOW, 10);

    expect(first.map((c) => c.scheduleId).sort()).toEqual(["a", "b"]);
    expect(second).toEqual([]);
    expect(db.schedules.every((s) => s.lastClaimedAt !== null)).toBe(true);
  });

  it("skips only the row it lost, not the whole batch", async () => {
    const { db, service } = await makeService(PORTAL_INTEGRATIONS, [
      schedule({ id: "a", nextDueAt: new Date(NOW.getTime() - HOUR) }),
      schedule({
        id: "b",
        integrationId: "int2",
        nextDueAt: new Date(NOW.getTime() - HOUR),
      }),
    ]);
    // A competing tick takes "a" in between this tick's read and its claim.
    const realUpdateMany = db.client.ingestionSchedule.updateMany;
    let first = true;
    db.client.ingestionSchedule.updateMany = (
      args: Parameters<typeof realUpdateMany>[0],
    ) => {
      if (first && args.where.id === "a") {
        first = false;
        return Promise.resolve({ count: 0 });
      }
      return realUpdateMany(args);
    };

    const claimed = await service.claimDue(kind, NOW, 10);

    expect(claimed.map((c) => c.scheduleId)).toEqual(["b"]);
  });
});

describe("IngestionScheduleService — recordOutcome", () => {
  it("advances lastSuccessAt and clears the failure count on a clean pass", async () => {
    const { db, service } = await makeService(PORTAL_INTEGRATIONS, [
      schedule({ id: "a", consecutiveFailures: 3 }),
    ]);

    await service.recordOutcome("a", {
      now: NOW,
      ok: true,
      servedFromCache: false,
    });

    expect(db.schedules[0]).toMatchObject({
      lastRunAt: NOW,
      lastSuccessAt: NOW,
      consecutiveFailures: 0,
    });
  });

  it("leaves lastSuccessAt untouched on a failed pass", async () => {
    // What makes "discovery is down" degrade into a full walk instead of a skip.
    const previous = new Date(NOW.getTime() - DAY);
    const { db, service } = await makeService(PORTAL_INTEGRATIONS, [
      schedule({ id: "a", lastSuccessAt: previous }),
    ]);

    await service.recordOutcome("a", {
      now: NOW,
      ok: false,
      servedFromCache: false,
    });

    expect(db.schedules[0].lastSuccessAt).toEqual(previous);
    expect(db.schedules[0].lastRunAt).toEqual(NOW);
    expect(db.schedules[0].consecutiveFailures).toBe(1);
  });

  it("counts consecutive cache-served passes and resets on a live walk", async () => {
    const { db, service } = await makeService(PORTAL_INTEGRATIONS, [
      schedule({ id: "a" }),
    ]);

    await service.recordOutcome("a", {
      now: NOW,
      ok: true,
      servedFromCache: true,
    });
    await service.recordOutcome("a", {
      now: NOW,
      ok: true,
      servedFromCache: true,
    });
    expect(db.schedules[0].cacheHitStreak).toBe(2);

    await service.recordOutcome("a", {
      now: NOW,
      ok: true,
      servedFromCache: false,
    });
    expect(db.schedules[0].cacheHitStreak).toBe(0);
  });

  it("does not credit a failed pass to the cache streak", async () => {
    const { db, service } = await makeService(PORTAL_INTEGRATIONS, [
      schedule({ id: "a", cacheHitStreak: 5 }),
    ]);

    await service.recordOutcome("a", {
      now: NOW,
      ok: false,
      servedFromCache: true,
    });

    expect(db.schedules[0].cacheHitStreak).toBe(0);
  });
});

describe("IngestionScheduleService — reads", () => {
  it("lastSuccessAt reports null for a kind that has never succeeded", async () => {
    const { service } = await makeService(PORTAL_INTEGRATIONS, [
      schedule({ id: "a", kind: "PORTAL_DISCOVERY" }),
    ]);
    expect(await service.lastSuccessAt("int1", "PORTAL_DISCOVERY")).toBeNull();
  });

  it("lastSuccessAt reports null when the row does not exist at all", async () => {
    const { service } = await makeService(PORTAL_INTEGRATIONS);
    expect(await service.lastSuccessAt("int1", "PORTAL_DISCOVERY")).toBeNull();
  });

  it("countFor counts only the given kind", async () => {
    const { service } = await makeService(PORTAL_INTEGRATIONS, [
      schedule({ id: "a", kind: "PORTAL_TIMETABLE" }),
      schedule({ id: "b", kind: "PORTAL_TIMETABLE", integrationId: "int2" }),
      schedule({ id: "c", kind: "PORTAL_EXAM" }),
    ]);

    expect(await service.countFor("PORTAL_TIMETABLE")).toBe(2);
    expect(await service.countFor("PORTAL_EXAM")).toBe(1);
    expect(await service.countFor("LMS_CALENDAR")).toBe(0);
  });
});

describe("IngestionScheduleService — deferAfterManualSync", () => {
  it("pushes the given kinds out by their own period, and nothing else", async () => {
    // A student who just pressed "sync now" must not be re-walked minutes later.
    const { db, service } = await makeService(PORTAL_INTEGRATIONS, [
      schedule({ id: "a", kind: "PORTAL_TIMETABLE" }),
      schedule({ id: "b", kind: "PORTAL_EXAM" }),
      schedule({ id: "c", kind: "LMS_CALENDAR", integrationId: "int2" }),
    ]);

    await service.deferAfterManualSync("int1", ["PORTAL_TIMETABLE"], NOW);

    expect(db.schedules[0].nextDueAt).toEqual(new Date(NOW.getTime() + DAY));
    // A kind that was not reported clean stays due for the ticker.
    expect(db.schedules[1].nextDueAt).toEqual(NOW);
    // A different integration's row is untouched.
    expect(db.schedules[2].nextDueAt).toEqual(NOW);
  });
});

describe("IngestionScheduleService — markManualFailure", () => {
  it("counts a failure against the data kinds that did not come back clean", async () => {
    const { db, service } = await makeService(PORTAL_INTEGRATIONS, [
      schedule({ id: "a", kind: "PORTAL_TIMETABLE" }),
      schedule({ id: "b", kind: "PORTAL_EXAM" }),
      schedule({ id: "c", kind: "PORTAL_DISCOVERY" }),
    ]);

    await service.markManualFailure("int1", "PORTAL", ["PORTAL_EXAM"]);

    expect(db.schedules[0].consecutiveFailures).toBe(1);
    expect(db.schedules[1].consecutiveFailures).toBe(0);
    // Discovery is a means, not a data kind.
    expect(db.schedules[2].consecutiveFailures).toBe(0);
  });
});

describe("IngestionScheduleService — lastRunAt", () => {
  it("is the newest run across the provider's kinds, null if none ran", async () => {
    const earlier = new Date(NOW.getTime() - 60_000);
    const { service } = await makeService(PORTAL_INTEGRATIONS, [
      schedule({ id: "a", kind: "PORTAL_TIMETABLE", lastRunAt: earlier }),
      schedule({ id: "b", kind: "PORTAL_EXAM", lastRunAt: NOW }),
      schedule({
        id: "c",
        kind: "LMS_CALENDAR",
        integrationId: "int2",
        lastRunAt: NOW,
      }),
    ]);

    expect(await service.lastRunAt("int1", "PORTAL")).toEqual(NOW);
    // Another provider's rows never count, and a never-run integration is null.
    expect(await service.lastRunAt("int1", "LMS")).toBeNull();
  });
});

describe("IngestionScheduleService — discovery per term", () => {
  const TERM = { academicYear: "2026-2027", semester: "HK01" };
  const NEXT_TERM = { academicYear: "2026-2027", semester: "HK02" };

  it("isDiscovered is false until a clean pass has covered the term", async () => {
    const { service } = await makeService(PORTAL_INTEGRATIONS, [
      schedule({ id: "a", kind: "PORTAL_DISCOVERY" }),
    ]);
    expect(await service.isDiscovered("int1", TERM)).toBe(false);

    await service.markDiscovered("int1", TERM, NOW);

    expect(await service.isDiscovered("int1", TERM)).toBe(true);
    // A new term is not covered by the last one's pass.
    expect(await service.isDiscovered("int1", NEXT_TERM)).toBe(false);
  });

  it("markDiscovered parks the row until the next term's window opens", async () => {
    const { db, service } = await makeService(PORTAL_INTEGRATIONS, [
      schedule({ id: "a", kind: "PORTAL_DISCOVERY" }),
    ]);
    const reopensAt = new Date(NOW.getTime() + 90 * DAY);

    await service.markDiscovered("int1", TERM, NOW, reopensAt);

    expect(db.schedules[0].nextDueAt).toEqual(reopensAt);
  });

  it("markDiscovered also advances lastSuccessAt", async () => {
    const { service } = await makeService(PORTAL_INTEGRATIONS, [
      schedule({ id: "a", kind: "PORTAL_DISCOVERY" }),
    ]);
    await service.markDiscovered("int1", TERM, NOW);
    expect(await service.lastSuccessAt("int1", "PORTAL_DISCOVERY")).toEqual(
      NOW,
    );
  });

  it("isDiscovered is false when the integration has no schedule row", async () => {
    const { service } = await makeService(PORTAL_INTEGRATIONS);
    expect(await service.isDiscovered("int1", TERM)).toBe(false);
  });

  it("pulls a row that has not covered the term forward to now", async () => {
    const later = new Date(NOW.getTime() + 100 * DAY);
    const { db, service } = await makeService(PORTAL_INTEGRATIONS, [
      schedule({
        id: "a",
        kind: "PORTAL_DISCOVERY",
        nextDueAt: later,
        lastSuccessTerm: "2026-2027/HK01",
      }),
      schedule({
        id: "b",
        kind: "PORTAL_DISCOVERY",
        integrationId: "int2",
        nextDueAt: later,
        lastSuccessTerm: "2026-2027/HK02",
      }),
    ]);

    const count = await service.pullForwardStaleDiscovery(NEXT_TERM, NOW);

    expect(count).toBe(1);
    expect(db.schedules[0].nextDueAt).toEqual(NOW);
    // Already covered the term: left on its own period.
    expect(db.schedules[1].nextDueAt).toEqual(later);
  });

  it("leaves a row alone that was claimed within the retry window", async () => {
    // A student whose discovery keeps failing must not be re-claimed every tick.
    const later = new Date(NOW.getTime() + 100 * DAY);
    const { db, service } = await makeService(PORTAL_INTEGRATIONS, [
      schedule({
        id: "a",
        kind: "PORTAL_DISCOVERY",
        nextDueAt: later,
        lastClaimedAt: new Date(NOW.getTime() - 10 * MINUTE),
      }),
    ]);

    expect(await service.pullForwardStaleDiscovery(TERM, NOW)).toBe(0);
    expect(db.schedules[0].nextDueAt).toEqual(later);

    // …and retries it once the window has passed.
    const afterWindow = new Date(NOW.getTime() + 2 * HOUR);
    expect(await service.pullForwardStaleDiscovery(TERM, afterWindow)).toBe(1);
  });

  it("only touches PORTAL_DISCOVERY rows", async () => {
    const later = new Date(NOW.getTime() + 100 * DAY);
    const { db, service } = await makeService(PORTAL_INTEGRATIONS, [
      schedule({ id: "a", kind: "PORTAL_TIMETABLE", nextDueAt: later }),
    ]);
    expect(await service.pullForwardStaleDiscovery(TERM, NOW)).toBe(0);
    expect(db.schedules[0].nextDueAt).toEqual(later);
  });
});
