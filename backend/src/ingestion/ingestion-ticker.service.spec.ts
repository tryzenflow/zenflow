import { KillSwitchService } from "../common/killswitch/killswitch.service";
import { ConfigService } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { IngestionScheduleService } from "./ingestion-schedule.service";
import { IngestionTickerService } from "./ingestion-ticker.service";
import { QueueService } from "../queue/queue.service";
import {
  LMS_FETCH_QUEUE,
  PORTAL_FETCH_QUEUE,
  type FetchJobData,
} from "../queue/queues";
import { LMSService } from "../lms/lms.service";
import { PortalAPIService } from "../portal/portal-api.service";
import { TICK_INTERVAL_MS, type SyncKindName } from "./core/schedule-plan";
import type { ClaimedTarget } from "./ingestion-schedule.service";

const NOW = new Date("2026-10-26T03:00:00.000Z");
const DAY = 24 * 60 * 60_000;
const HOUR = 60 * 60_000;

const ENV: Record<string, string | number | boolean> = {
  INGESTION_ENABLED: true,
};

/**
 * A fake IngestionScheduleService that keeps the real plan shape but lets a
 * test decide who is due. The real class is covered by its own spec; here the
 * seam under test is the ticker's ordering, batching and error handling.
 */
function makeScheduleDouble(
  due: Partial<Record<SyncKindName, ClaimedTarget[]>> = {},
  populations: Partial<Record<SyncKindName, number>> = {},
) {
  const plans = [
    {
      kind: "PORTAL_DISCOVERY" as SyncKindName,
      provider: "PORTAL" as const,
      targetPeriodMs: DAY,
      order: 1,
      discovery: true,
    },
    {
      kind: "LMS_DISCOVERY" as SyncKindName,
      provider: "LMS" as const,
      targetPeriodMs: DAY,
      order: 2,
      discovery: true,
    },
    {
      kind: "PORTAL_TIMETABLE" as SyncKindName,
      provider: "PORTAL" as const,
      targetPeriodMs: DAY,
      order: 10,
      discovery: false,
    },
    {
      kind: "PORTAL_EXAM" as SyncKindName,
      provider: "PORTAL" as const,
      targetPeriodMs: DAY,
      order: 11,
      discovery: false,
    },
    {
      kind: "LMS_CALENDAR" as SyncKindName,
      provider: "LMS" as const,
      targetPeriodMs: HOUR,
      order: 12,
      discovery: false,
    },
  ];

  const claims: { kind: SyncKindName; batchSize: number }[] = [];
  const order: string[] = [];
  const released: string[] = [];
  const pulledForward: { academicYear: string; semester: string }[] = [];
  let ensureAllRowsCalls = 0;

  const service = {
    allPlans: () => plans,
    planFor: (kind: SyncKindName) => plans.find((p) => p.kind === kind)!,
    ensureAllRows: () => {
      ensureAllRowsCalls += 1;
      return Promise.resolve(0);
    },
    countFor: (kind: SyncKindName) =>
      Promise.resolve(populations[kind] ?? due[kind]?.length ?? 0),
    pullForwardStaleDiscovery: (term: {
      academicYear: string;
      semester: string;
    }) => {
      order.push("pullForward");
      pulledForward.push(term);
      return Promise.resolve(0);
    },
    claimDue: (kind: SyncKindName, _now: Date, batchSize: number) => {
      order.push(`claim:${kind}`);
      claims.push({ kind, batchSize });
      return Promise.resolve((due[kind] ?? []).slice(0, batchSize));
    },
    releaseClaim: (t: ClaimedTarget) => {
      released.push(t.scheduleId);
      return Promise.resolve();
    },
  };

  return {
    service: service as unknown as IngestionScheduleService,
    claims,
    released,
    order,
    pulledForward,
    get ensureAllRowsCalls() {
      return ensureAllRowsCalls;
    },
  };
}

function target(over: Partial<ClaimedTarget> = {}): ClaimedTarget {
  return {
    scheduleId: "sch1",
    integrationId: "int1",
    userId: "u1",
    cacheHitStreak: 0,
    dueAt: new Date("2026-10-26T02:00:00.000Z"),
    claimedAt: NOW,
    ...over,
  };
}

type EnqueueMock = jest.Mock<
  Promise<unknown>,
  [unknown, FetchJobData, { jobId: string }]
>;

async function makeTicker(
  opts: {
    env?: Record<string, string | number | boolean>;
    schedule?: ReturnType<typeof makeScheduleDouble>;
    enqueue?: EnqueueMock;
    counts?: jest.Mock;
    /** Per-upstream breaker wait in ms (`null` = closed). */
    breakers?: { LMS: number | null; PORTAL: number | null };
  } = {},
) {
  const env = { ...ENV, ...(opts.env ?? {}) };
  const schedule = opts.schedule ?? makeScheduleDouble();
  const enqueue: EnqueueMock =
    opts.enqueue ?? (jest.fn().mockResolvedValue({}) as EnqueueMock);
  const counts =
    opts.counts ??
    jest.fn().mockResolvedValue({ waiting: 0, delayed: 0, active: 0 });
  const breakers = opts.breakers ?? { LMS: null, PORTAL: null };
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      {
        provide: KillSwitchService,
        useValue: { isEnabled: jest.fn().mockResolvedValue(true) },
      },
      IngestionTickerService,
      {
        provide: ConfigService,
        useValue: { get: (n: string) => env[n] },
      },
      { provide: IngestionScheduleService, useValue: schedule.service },
      { provide: QueueService, useValue: { enqueue, counts } },
      { provide: LMSService, useValue: { unavailableFor: () => breakers.LMS } },
      {
        provide: PortalAPIService,
        useValue: { unavailableFor: () => breakers.PORTAL },
      },
    ],
  }).compile();

  return {
    ticker: module.get(IngestionTickerService),
    schedule,
    enqueue,
    counts,
  };
}

describe("IngestionTickerService - the kill switch", () => {
  it("claims and enqueues nothing when ingestion is disabled", async () => {
    // Checked BEFORE any claim: claiming and then skipping would march every
    // nextDueAt a full period forward while ingestion is off.
    const schedule = makeScheduleDouble({ PORTAL_TIMETABLE: [target()] });
    const { ticker, enqueue } = await makeTicker({
      env: { INGESTION_ENABLED: false },
      schedule,
    });

    const summary = await ticker.tick(NOW);

    expect(summary.claimed).toBe(0);
    expect(schedule.claims).toEqual([]);
    expect(schedule.ensureAllRowsCalls).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('accepts the string "false" a .env file hands back', async () => {
    const schedule = makeScheduleDouble({ PORTAL_TIMETABLE: [target()] });
    const { ticker } = await makeTicker({
      env: { INGESTION_ENABLED: "false" },
      schedule,
    });

    expect((await ticker.tick(NOW)).claimed).toBe(0);
    expect(schedule.claims).toEqual([]);
  });
});

describe("IngestionTickerService - enqueueing", () => {
  it("backfills missing schedule rows before claiming anything", async () => {
    const schedule = makeScheduleDouble();
    const { ticker } = await makeTicker({ schedule });

    await ticker.tick(NOW);

    expect(schedule.ensureAllRowsCalls).toBe(1);
  });

  it("routes portal kinds to portal-fetch and LMS kinds to lms-fetch", async () => {
    const schedule = makeScheduleDouble({
      PORTAL_DISCOVERY: [target({ scheduleId: "pd" })],
      PORTAL_TIMETABLE: [target({ scheduleId: "t" })],
      PORTAL_EXAM: [target({ scheduleId: "e" })],
      LMS_DISCOVERY: [target({ scheduleId: "ld" })],
      LMS_CALENDAR: [target({ scheduleId: "l" })],
    });
    const { ticker, enqueue } = await makeTicker({ schedule });

    const summary = await ticker.tick(NOW);

    const queueOf = (id: string) =>
      enqueue.mock.calls.find((c) => c[1].scheduleId === id)![0];
    for (const id of ["pd", "t", "e"])
      expect(queueOf(id)).toBe(PORTAL_FETCH_QUEUE);
    for (const id of ["ld", "l"]) expect(queueOf(id)).toBe(LMS_FETCH_QUEUE);
    expect(summary.claimed).toBe(5);
  });

  it("enqueues the claim with a job id stable per schedule slot", async () => {
    const schedule = makeScheduleDouble({
      PORTAL_TIMETABLE: [target({ scheduleId: "t" })],
    });
    const { ticker, enqueue } = await makeTicker({ schedule });

    await ticker.tick(NOW);

    expect(enqueue).toHaveBeenCalledWith(
      PORTAL_FETCH_QUEUE,
      {
        scheduleId: "t",
        userId: "u1",
        integrationId: "int1",
        kind: "PORTAL_TIMETABLE",
        dueAt: "2026-10-26T02:00:00.000Z",
        claimedAt: NOW.toISOString(),
        cacheHitStreak: 0,
      },
      { jobId: "t_2026-10-26T02-00-00.000Z" },
    );
  });

  it("derives the same job id for the same slot on a later tick", async () => {
    const mk = () =>
      makeScheduleDouble({
        PORTAL_TIMETABLE: [target({ scheduleId: "t", claimedAt: new Date() })],
      });
    const a = await makeTicker({ schedule: mk() });
    const b = await makeTicker({ schedule: mk() });

    await a.ticker.tick(NOW);
    await b.ticker.tick(new Date(NOW.getTime() + 60_000));

    expect(a.enqueue.mock.calls[0][2]).toEqual(b.enqueue.mock.calls[0][2]);
  });

  it("claims discovery kinds before the walk kinds", async () => {
    const schedule = makeScheduleDouble();
    const { ticker } = await makeTicker({ schedule });

    await ticker.tick(NOW);

    expect(schedule.claims.map((c) => c.kind)).toEqual([
      "PORTAL_DISCOVERY",
      "LMS_DISCOVERY",
      "PORTAL_TIMETABLE",
      "PORTAL_EXAM",
      "LMS_CALENDAR",
    ]);
  });

  it("makes discovery due for a new term before claiming it", async () => {
    const schedule = makeScheduleDouble();
    const { ticker } = await makeTicker({ schedule });

    await ticker.tick(NOW);

    expect(schedule.pulledForward).toHaveLength(1);
    expect(schedule.order.indexOf("pullForward")).toBeLessThan(
      schedule.order.indexOf("claim:PORTAL_DISCOVERY"),
    );
  });

  it("hands the claim back when the queue refuses the job, and stops the tick", async () => {
    const schedule = makeScheduleDouble({
      PORTAL_TIMETABLE: [target({ scheduleId: "t" })],
      LMS_CALENDAR: [target({ scheduleId: "l" })],
    });
    const enqueue = jest
      .fn()
      .mockRejectedValueOnce(new Error("redis down"))
      .mockResolvedValue({});
    const { ticker } = await makeTicker({ schedule, enqueue });

    const summary = await ticker.tick(NOW);

    expect(schedule.released).toEqual(["t"]);
    expect(summary).toMatchObject({ claimed: 0, released: 1 });
  });
});

describe("IngestionTickerService - queue outage and backpressure", () => {
  it("releases every claim and stops the tick after one failed enqueue", async () => {
    const schedule = makeScheduleDouble(
      {
        PORTAL_TIMETABLE: [
          target({ scheduleId: "a" }),
          target({ scheduleId: "b" }),
        ],
        LMS_CALENDAR: [target({ scheduleId: "l" })],
      },
      { PORTAL_TIMETABLE: 100_000 },
    );
    const enqueue = jest.fn().mockRejectedValue(new Error("redis down"));
    const { ticker } = await makeTicker({ schedule, enqueue });

    const summary = await ticker.tick(NOW);

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(schedule.released).toEqual(["a", "b"]);
    expect(schedule.claims.map((c) => c.kind)).not.toContain("LMS_CALENDAR");
    expect(summary).toMatchObject({ claimed: 0, queueUnavailable: true });
  });

  it("treats a timed-out enqueue as unavailable and still resets running", async () => {
    const schedule = makeScheduleDouble({
      PORTAL_TIMETABLE: [target({ scheduleId: "a" })],
    });
    const enqueue = jest
      .fn()
      .mockRejectedValue(new Error("enqueue timed out after 2000ms"));
    const { ticker } = await makeTicker({ schedule, enqueue });

    const summary = await ticker.tick(NOW);
    expect(summary.queueUnavailable).toBe(true);
    expect(schedule.released).toEqual(["a"]);

    // A later tick runs (the in-process guard was cleared).
    await ticker.tick(NOW);
    expect(schedule.ensureAllRowsCalls).toBe(2);
  });

  it("claims nothing when the queue counts cannot be read", async () => {
    const schedule = makeScheduleDouble({
      PORTAL_TIMETABLE: [target({ scheduleId: "a" })],
    });
    const counts = jest.fn().mockRejectedValue(new Error("redis down"));
    const { ticker, enqueue } = await makeTicker({ schedule, counts });

    const summary = await ticker.tick(NOW);

    expect(summary.queueUnavailable).toBe(true);
    expect(schedule.claims).toEqual([]);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("skips claiming a kind whose queue backlog is at the threshold", async () => {
    const schedule = makeScheduleDouble({
      PORTAL_TIMETABLE: [target({ scheduleId: "a" })],
      LMS_CALENDAR: [target({ scheduleId: "l" })],
    });
    const counts = jest.fn((def: { name: string }) =>
      Promise.resolve(
        def.name === "portal-fetch"
          ? { waiting: 8, delayed: 2 }
          : { waiting: 0, delayed: 0 },
      ),
    );
    const { ticker, enqueue } = await makeTicker({
      schedule,
      counts,
      env: { INGESTION_QUEUE_MAX_BACKLOG: 10 },
    });

    const summary = await ticker.tick(NOW);

    const claimed = schedule.claims.map((c) => c.kind);
    expect(claimed).toContain("LMS_CALENDAR");
    expect(claimed).not.toContain("PORTAL_TIMETABLE");
    expect(summary.backpressured).toContain("PORTAL_TIMETABLE");
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it("trims the batch to the queue's headroom", async () => {
    const schedule = makeScheduleDouble({}, { LMS_CALENDAR: 100_000 });
    const counts = jest.fn().mockResolvedValue({ waiting: 8, delayed: 0 });
    const { ticker } = await makeTicker({
      schedule,
      counts,
      env: { INGESTION_QUEUE_MAX_BACKLOG: 10, INGESTION_TICK_MAX_BATCH: 50 },
    });

    await ticker.tick(NOW);

    expect(
      schedule.claims.find((c) => c.kind === "LMS_CALENDAR")?.batchSize,
    ).toBe(2);
  });
});

describe("IngestionTickerService - batch sizing", () => {
  it("sizes a daily kind so the population spreads across the day", async () => {
    // 150 students / (24h / 60s) = 0.1 -> the minBatch floor of 1.
    const schedule = makeScheduleDouble({}, { PORTAL_TIMETABLE: 150 });
    const { ticker } = await makeTicker({ schedule });

    await ticker.tick(NOW);

    const claim = schedule.claims.find((c) => c.kind === "PORTAL_TIMETABLE");
    expect(claim?.batchSize).toBe(1);
  });

  it("never exceeds INGESTION_TICK_MAX_BATCH, however short the period", async () => {
    const schedule = makeScheduleDouble({}, { LMS_CALENDAR: 100_000 });
    const { ticker } = await makeTicker({
      schedule,
      env: { INGESTION_TICK_MAX_BATCH: 4 },
    });

    await ticker.tick(NOW);

    for (const claim of schedule.claims) {
      expect(claim.batchSize).toBeLessThanOrEqual(4);
    }
  });

  it("lets a deliberately huge ceiling reproduce the pre-#56 burst", async () => {
    // The LMS_CALENDAR plan in the double is hourly: 150 / 60 ticks = 3.
    const schedule = makeScheduleDouble({}, { LMS_CALENDAR: 150 });
    const { ticker } = await makeTicker({
      schedule,
      env: { INGESTION_TICK_MAX_BATCH: 1000 },
    });

    await ticker.tick(NOW);

    const claim = schedule.claims.find((c) => c.kind === "LMS_CALENDAR");
    expect(claim?.batchSize).toBe(3);
  });

  it("enqueues nothing for a kind with no schedule rows at all", async () => {
    const schedule = makeScheduleDouble({}, { PORTAL_TIMETABLE: 0 });
    const { ticker, enqueue } = await makeTicker({ schedule });

    await ticker.tick(NOW);

    expect(
      schedule.claims.find((c) => c.kind === "PORTAL_TIMETABLE")?.batchSize,
    ).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe("IngestionTickerService - overlap and budget", () => {
  it("does not start a tick while the previous one is running", async () => {
    let release!: () => void;
    const blocked = new Promise<object>((resolve) => {
      release = () => resolve({});
    });
    const schedule = makeScheduleDouble({
      PORTAL_TIMETABLE: [target({ scheduleId: "t" })],
    });
    const { ticker } = await makeTicker({
      schedule,
      enqueue: jest.fn().mockReturnValue(blocked),
    });

    const first = ticker.tick(NOW);
    const second = await ticker.tick(NOW);
    expect(second.claimed).toBe(0);

    release();
    await expect(first).resolves.toMatchObject({ claimed: 1 });
  });

  it("stops claiming further kinds once the tick budget is spent", async () => {
    const schedule = makeScheduleDouble({
      PORTAL_TIMETABLE: [target({ scheduleId: "t" })],
      PORTAL_EXAM: [target({ scheduleId: "e" })],
      LMS_CALENDAR: [target({ scheduleId: "l" })],
    });
    const { ticker, enqueue } = await makeTicker({
      schedule,
      env: { INGESTION_TICK_BUDGET_MS: 1 },
      // Burn the budget inside the first kind's enqueue.
      enqueue: jest.fn().mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 15));
        return {};
      }),
    });

    const summary = await ticker.tick(NOW);

    expect(summary.claimed).toBe(1);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(schedule.claims.map((c) => c.kind)).toEqual([
      "PORTAL_DISCOVERY",
      "LMS_DISCOVERY",
      "PORTAL_TIMETABLE",
    ]);
  });

  it("keeps the tick interval and the @Cron expression in step", () => {
    expect(TICK_INTERVAL_MS).toBe(60_000);
  });
});

describe("IngestionTickerService - upstream circuit breaker", () => {
  it("does not claim for an upstream whose breaker is open; the other keeps going", async () => {
    const schedule = makeScheduleDouble({
      PORTAL_TIMETABLE: [target({ scheduleId: "t" })],
      PORTAL_EXAM: [target({ scheduleId: "e" })],
      LMS_CALENDAR: [target({ scheduleId: "l" })],
    });
    const { ticker, enqueue } = await makeTicker({
      schedule,
      breakers: { LMS: null, PORTAL: 30_000 },
    });

    const summary = await ticker.tick(NOW);

    expect(summary.pausedProviders).toEqual(["PORTAL"]);
    expect(schedule.claims.map((c) => c.kind)).toEqual([
      "LMS_DISCOVERY",
      "LMS_CALENDAR",
    ]);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0][0]).toBe(LMS_FETCH_QUEUE);
  });

  it("resumes automatically once the breaker closes", async () => {
    const schedule = makeScheduleDouble({
      PORTAL_TIMETABLE: [target({ scheduleId: "t" })],
    });
    const breakers = { LMS: null, PORTAL: 30_000 as number | null };
    const { ticker, enqueue } = await makeTicker({ schedule, breakers });

    await ticker.tick(NOW);
    expect(enqueue).not.toHaveBeenCalled();

    breakers.PORTAL = null;
    await ticker.tick(NOW);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });
});
