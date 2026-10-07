import { ConfigService } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { EnrollmentDiscoveryService } from "./enrollment-discovery.service";
import { ExamWatcherService } from "./exam-watcher.service";
import { IngestionScheduleService } from "./ingestion-schedule.service";
import { IngestionTickerService } from "./ingestion-ticker.service";
import { LmsWatcherService } from "./lms-watcher.service";
import { TimetableWatcherService } from "./timetable-watcher.service";
import { UpstreamUnavailableError } from "../common/outbound-breaker";
import { LMSService } from "../lms/lms.service";
import { PortalAPIService } from "../portal/portal-api.service";
import { TICK_INTERVAL_MS, type SyncKindName } from "./core/schedule-plan";
import type { ClaimedTarget } from "./ingestion-schedule.service";
import type { PassOutcome } from "./watcher-support";

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
  const outcomes: {
    scheduleId: string;
    ok: boolean;
    servedFromCache: boolean;
  }[] = [];
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
    recordOutcome: (
      scheduleId: string,
      outcome: PassOutcome & { now: Date },
    ) => {
      outcomes.push({
        scheduleId,
        ok: outcome.ok,
        servedFromCache: outcome.servedFromCache,
      });
      return Promise.resolve();
    },
  };

  return {
    service: service as unknown as IngestionScheduleService,
    claims,
    outcomes,
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

const OK: PassOutcome = { ok: true, servedFromCache: false };

async function makeTicker(
  opts: {
    env?: Record<string, string | number | boolean>;
    schedule?: ReturnType<typeof makeScheduleDouble>;
    timetable?: jest.Mock;
    exam?: jest.Mock;
    lms?: jest.Mock;
    syncPortal?: jest.Mock;
    syncLms?: jest.Mock;
    /** Per-upstream breaker wait in ms (`null` = closed). */
    breakers?: { LMS: number | null; PORTAL: number | null };
  } = {},
) {
  const env = { ...ENV, ...(opts.env ?? {}) };
  const schedule = opts.schedule ?? makeScheduleDouble();
  const timetable = opts.timetable ?? jest.fn().mockResolvedValue(OK);
  const exam = opts.exam ?? jest.fn().mockResolvedValue(OK);
  const lms = opts.lms ?? jest.fn().mockResolvedValue(OK);
  const syncPortal = opts.syncPortal ?? jest.fn().mockResolvedValue(OK);
  const syncLms = opts.syncLms ?? jest.fn().mockResolvedValue(OK);
  const breakers = opts.breakers ?? { LMS: null, PORTAL: null };
  // Order in which the watchers were called, so "discovery first" and "one kind
  // at a time" are assertable.
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      IngestionTickerService,
      {
        provide: ConfigService,
        useValue: { get: (n: string) => env[n] },
      },
      { provide: IngestionScheduleService, useValue: schedule.service },
      { provide: TimetableWatcherService, useValue: { syncOne: timetable } },
      { provide: ExamWatcherService, useValue: { syncOne: exam } },
      { provide: LmsWatcherService, useValue: { syncOne: lms } },
      {
        provide: EnrollmentDiscoveryService,
        useValue: { syncPortal, syncLms },
      },
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
    timetable,
    exam,
    lms,
    syncPortal,
    syncLms,
    breakers,
  };
}

describe("IngestionTickerService — the kill switch", () => {
  it("claims nothing and stamps nothing when ingestion is disabled", async () => {
    // Critically, this is checked BEFORE any claim: claiming and then skipping
    // would march every nextDueAt a full period forward while ingestion is off.
    const schedule = makeScheduleDouble({
      PORTAL_TIMETABLE: [target()],
    });
    const { ticker, timetable } = await makeTicker({
      env: { INGESTION_ENABLED: false },
      schedule,
    });

    const summary = await ticker.tick(NOW);

    expect(summary.claimed).toBe(0);
    expect(schedule.claims).toEqual([]);
    expect(schedule.outcomes).toEqual([]);
    expect(schedule.ensureAllRowsCalls).toBe(0);
    expect(timetable).not.toHaveBeenCalled();
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

describe("IngestionTickerService — ordering and dispatch", () => {
  it("backfills missing schedule rows before claiming anything", async () => {
    const schedule = makeScheduleDouble();
    const { ticker } = await makeTicker({ schedule });

    await ticker.tick(NOW);

    expect(schedule.ensureAllRowsCalls).toBe(1);
  });

  it("routes each kind to its own watcher", async () => {
    const schedule = makeScheduleDouble({
      PORTAL_TIMETABLE: [target({ scheduleId: "t" })],
      PORTAL_EXAM: [target({ scheduleId: "e" })],
      LMS_CALENDAR: [target({ scheduleId: "l" })],
    });
    const { ticker, timetable, exam, lms } = await makeTicker({ schedule });

    const summary = await ticker.tick(NOW);

    expect(timetable).toHaveBeenCalledTimes(1);
    expect(exam).toHaveBeenCalledTimes(1);
    expect(lms).toHaveBeenCalledTimes(1);
    expect(summary).toMatchObject({ claimed: 3, ok: 3, failed: 0 });
  });

  it("passes the claimed target and the tick's clock to the watcher", async () => {
    const schedule = makeScheduleDouble({
      PORTAL_TIMETABLE: [target({ scheduleId: "t", userId: "u9" })],
    });
    const { ticker, timetable } = await makeTicker({ schedule });

    await ticker.tick(NOW);

    expect(timetable).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u9", integrationId: "int1" }),
      NOW,
    );
  });

  it("routes the discovery kinds to EnrollmentDiscoveryService", async () => {
    const schedule = makeScheduleDouble({
      PORTAL_DISCOVERY: [target({ scheduleId: "pd" })],
      LMS_DISCOVERY: [target({ scheduleId: "ld" })],
    });
    const { ticker, syncPortal, syncLms } = await makeTicker({ schedule });

    const summary = await ticker.tick(NOW);

    expect(syncPortal).toHaveBeenCalledTimes(1);
    expect(syncLms).toHaveBeenCalledTimes(1);
    expect(summary).toMatchObject({ claimed: 2, ok: 2 });
  });

  it("claims discovery kinds before the walk kinds", async () => {
    // So a student's confirmed set is known before their walk on the same tick.
    const schedule = makeScheduleDouble({
      PORTAL_TIMETABLE: [target()],
      PORTAL_DISCOVERY: [target()],
      LMS_CALENDAR: [target()],
      LMS_DISCOVERY: [target()],
    });
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
    // The period is about a semester, so a term change must not wait it out.
    const schedule = makeScheduleDouble({ PORTAL_DISCOVERY: [target()] });
    const { ticker } = await makeTicker({ schedule });

    await ticker.tick(NOW);

    expect(schedule.pulledForward).toEqual([
      expect.objectContaining({ academicYear: "2026-2027", semester: "HK01" }),
    ]);
    expect(schedule.order.indexOf("pullForward")).toBeLessThan(
      schedule.order.indexOf("claim:PORTAL_DISCOVERY"),
    );
    // Only the portal discovery kind is term-pulled.
    expect(schedule.pulledForward).toHaveLength(1);
  });
});

describe("IngestionTickerService — batch sizing", () => {
  it("sizes a daily kind so the population spreads across the day", async () => {
    // 150 students / (24h / 60s) = 0.1 -> the minBatch floor of 1.
    const schedule = makeScheduleDouble({}, { PORTAL_TIMETABLE: 150 });
    const { ticker } = await makeTicker({ schedule });

    await ticker.tick(NOW);

    const claim = schedule.claims.find((c) => c.kind === "PORTAL_TIMETABLE");
    expect(claim?.batchSize).toBe(1);
  });

  it("never exceeds INGESTION_TICK_MAX_BATCH, however short the period", async () => {
    // The safety rail: "the load is spread" must be a property of the code, not
    // of whoever last edited the env file.
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
    // How the measurement harness replays the recorded baseline without
    // touching a @Cron: population-sized batches, one-minute periods.
    const schedule = makeScheduleDouble({}, { LMS_CALENDAR: 150 });
    const { ticker } = await makeTicker({
      schedule,
      env: { INGESTION_TICK_MAX_BATCH: 1000 },
    });
    // The LMS_CALENDAR plan in the double is hourly: 150 / 60 ticks = 3.
    await ticker.tick(NOW);

    const claim = schedule.claims.find((c) => c.kind === "LMS_CALENDAR");
    expect(claim?.batchSize).toBe(3);
  });

  it("claims nothing for a kind with no schedule rows at all", async () => {
    const schedule = makeScheduleDouble({}, { PORTAL_TIMETABLE: 0 });
    const { ticker, timetable } = await makeTicker({ schedule });

    await ticker.tick(NOW);

    expect(
      schedule.claims.find((c) => c.kind === "PORTAL_TIMETABLE")?.batchSize,
    ).toBe(0);
    expect(timetable).not.toHaveBeenCalled();
  });
});

describe("IngestionTickerService — failure isolation", () => {
  it("a throwing pass does not abort the tick", async () => {
    const schedule = makeScheduleDouble({
      PORTAL_TIMETABLE: [target({ scheduleId: "t" })],
      PORTAL_EXAM: [target({ scheduleId: "e" })],
    });
    const { ticker, exam } = await makeTicker({
      schedule,
      timetable: jest.fn().mockRejectedValue(new Error("DLU is unreachable")),
    });

    const summary = await ticker.tick(NOW);

    expect(exam).toHaveBeenCalledTimes(1);
    expect(summary).toMatchObject({ claimed: 2, ok: 1, failed: 1 });
  });

  it("records a throwing pass as failed, so lastSuccessAt does not move", async () => {
    const schedule = makeScheduleDouble({
      PORTAL_TIMETABLE: [target({ scheduleId: "t" })],
    });
    const { ticker } = await makeTicker({
      schedule,
      timetable: jest.fn().mockRejectedValue(new Error("boom")),
    });

    await ticker.tick(NOW);

    expect(schedule.outcomes).toEqual([
      { scheduleId: "t", ok: false, servedFromCache: false },
    ]);
  });

  it("records a pass that reported a failed fetch as failed", async () => {
    const schedule = makeScheduleDouble({
      PORTAL_TIMETABLE: [target({ scheduleId: "t" })],
    });
    const { ticker } = await makeTicker({
      schedule,
      timetable: jest
        .fn()
        .mockResolvedValue({ ok: false, servedFromCache: false }),
    });

    const summary = await ticker.tick(NOW);

    expect(summary.failed).toBe(1);
    expect(schedule.outcomes[0]).toMatchObject({ ok: false });
  });

  it("counts a cache-served pass", async () => {
    const schedule = makeScheduleDouble({
      PORTAL_TIMETABLE: [target({ scheduleId: "t" })],
    });
    const { ticker } = await makeTicker({
      schedule,
      timetable: jest
        .fn()
        .mockResolvedValue({ ok: true, servedFromCache: true }),
    });

    const summary = await ticker.tick(NOW);

    expect(summary.servedFromCache).toBe(1);
    expect(schedule.outcomes[0]).toMatchObject({ servedFromCache: true });
  });

  it("survives a failure to record the outcome", async () => {
    // The claim already moved nextDueAt, so nothing loops — losing the
    // bookkeeping is not worth failing a tick over.
    const schedule = makeScheduleDouble({
      PORTAL_TIMETABLE: [target({ scheduleId: "t" })],
    });
    schedule.service.recordOutcome = jest
      .fn()
      .mockRejectedValue(new Error("db gone"));
    const { ticker } = await makeTicker({ schedule });

    await expect(ticker.tick(NOW)).resolves.toMatchObject({ claimed: 1 });
  });
});

describe("IngestionTickerService — overlap and budget", () => {
  it("does not start a tick while the previous one is running", async () => {
    let release!: () => void;
    const blocked = new Promise<PassOutcome>((resolve) => {
      release = () => resolve(OK);
    });
    const schedule = makeScheduleDouble({
      PORTAL_TIMETABLE: [target({ scheduleId: "t" })],
    });
    const { ticker } = await makeTicker({
      schedule,
      timetable: jest.fn().mockReturnValue(blocked),
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
    const { ticker, exam, lms } = await makeTicker({
      schedule,
      env: { INGESTION_TICK_BUDGET_MS: 1 },
      // Burn the budget inside the first kind's pass.
      timetable: jest.fn().mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 15));
        return OK;
      }),
    });

    const summary = await ticker.tick(NOW);

    expect(summary.claimed).toBe(1);
    expect(exam).not.toHaveBeenCalled();
    expect(lms).not.toHaveBeenCalled();
    // An unclaimed target simply stays overdue and leads the next tick.
    expect(schedule.claims.map((c) => c.kind)).toEqual([
      "PORTAL_DISCOVERY",
      "LMS_DISCOVERY",
      "PORTAL_TIMETABLE",
    ]);
  });

  it("keeps the tick interval and the @Cron expression in step", () => {
    // If one is changed without the other, batch sizing is silently wrong.
    expect(TICK_INTERVAL_MS).toBe(60_000);
  });
});

describe("IngestionTickerService — upstream circuit breaker", () => {
  const down = () => new UpstreamUnavailableError("dlu-portal", 60_000);

  it("does not claim for an upstream whose breaker is open; the other keeps going", async () => {
    const schedule = makeScheduleDouble({
      PORTAL_TIMETABLE: [target({ scheduleId: "t" })],
      PORTAL_EXAM: [target({ scheduleId: "e" })],
      LMS_CALENDAR: [target({ scheduleId: "l" })],
    });
    const { ticker, timetable, exam, lms } = await makeTicker({
      schedule,
      breakers: { LMS: null, PORTAL: 30_000 },
    });

    const summary = await ticker.tick(NOW);

    expect(schedule.claims.map((c) => c.kind)).not.toContain(
      "PORTAL_TIMETABLE",
    );
    expect(schedule.claims.map((c) => c.kind)).not.toContain("PORTAL_EXAM");
    expect(schedule.claims.map((c) => c.kind)).toContain("LMS_CALENDAR");
    expect(timetable).not.toHaveBeenCalled();
    expect(exam).not.toHaveBeenCalled();
    expect(lms).toHaveBeenCalledTimes(1);
    expect(summary.pausedProviders).toEqual(["PORTAL"]);
  });

  it("an UpstreamUnavailableError stops the upstream for the tick, releases the claims and records no failure", async () => {
    const schedule = makeScheduleDouble(
      {
        PORTAL_TIMETABLE: [
          target({ scheduleId: "t1" }),
          target({ scheduleId: "t2" }),
        ],
        PORTAL_EXAM: [target({ scheduleId: "e1" })],
        LMS_CALENDAR: [target({ scheduleId: "l1" })],
      },
      { PORTAL_TIMETABLE: 5000 },
    );
    const timetable = jest.fn().mockRejectedValue(down());
    const { ticker, exam, lms } = await makeTicker({ schedule, timetable });

    const summary = await ticker.tick(NOW);

    expect(timetable).toHaveBeenCalledTimes(1);
    // t1 tripped, t2 never ran, e1 was never claimed at all.
    expect(schedule.released).toEqual(["t1", "t2"]);
    expect(schedule.claims.map((c) => c.kind)).not.toContain("PORTAL_EXAM");
    expect(exam).not.toHaveBeenCalled();
    // No consecutiveFailures bump for the paused upstream; LMS unaffected.
    expect(schedule.outcomes.map((o) => o.scheduleId)).toEqual(["l1"]);
    expect(lms).toHaveBeenCalledTimes(1);
    expect(summary).toMatchObject({ claimed: 1, failed: 0, released: 2 });
  });

  it("a partial walk cut short by the breaker is released, not recorded", async () => {
    const schedule = makeScheduleDouble({
      LMS_CALENDAR: [target({ scheduleId: "l1" })],
    });
    const lms = jest.fn().mockResolvedValue({
      ok: false,
      servedFromCache: false,
      upstreamDown: down(),
    });
    const { ticker } = await makeTicker({ schedule, lms });

    await ticker.tick(NOW);

    expect(schedule.released).toEqual(["l1"]);
    expect(schedule.outcomes).toEqual([]);
  });

  it("resumes automatically once the breaker closes", async () => {
    const schedule = makeScheduleDouble({
      PORTAL_EXAM: [target({ scheduleId: "e1" })],
    });
    const { ticker, exam, breakers } = await makeTicker({
      schedule,
      breakers: { LMS: null, PORTAL: 60_000 },
    });

    await ticker.tick(NOW);
    expect(exam).not.toHaveBeenCalled();

    breakers.PORTAL = null;
    await ticker.tick(NOW);
    expect(exam).toHaveBeenCalledTimes(1);
    expect(schedule.outcomes).toEqual([
      { scheduleId: "e1", ok: true, servedFromCache: false },
    ]);
  });
});
