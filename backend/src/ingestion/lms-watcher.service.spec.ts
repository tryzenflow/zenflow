import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { IntegrationsService } from "../integrations/integrations.service";
import { LMSService } from "../lms/lms.service";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService } from "../prisma/prisma.service";
import type { MoodleMonthlyView } from "./core/parse-lms";
import { EnrollmentDiscoveryService } from "./enrollment-discovery.service";
import { IngestionJobsService } from "./ingestion-jobs.service";
import { IngestionScheduleService } from "./ingestion-schedule.service";
import { LmsWatcherService } from "./lms-watcher.service";
import { MaterializerService } from "./materializer.service";
import { OccurrenceCacheService } from "./occurrence-cache.service";
import { OccurrenceFanoutService } from "./occurrence-fanout.service";

// ── in-memory Prisma double ────────────────────────────────────────────────

interface JobRow {
  id: string;
  integrationId: string;
  status: string;
}
interface ItemRow {
  id: string;
  jobId: string;
  url: string;
  status: string;
  attempt: number;
  statusCode: number | null;
  responseBody: string | null;
}

function makePrismaDouble(
  integrations: { id: string; userId: string; timezone: string }[],
) {
  const jobs: JobRow[] = [];
  const items: ItemRow[] = [];
  /** Every status a job passed through, in order — the lifecycle assertion. */
  const jobStatusLog: string[] = [];
  const courses: Record<string, unknown>[] = [];

  const client = {
    integration: {
      findMany: (args: {
        where: { provider: string; userId?: string };
        take: number;
        cursor?: { id: string };
        skip?: number;
      }) => {
        let rows = integrations.filter(() => args.where.provider === "LMS");
        if (args.where.userId) {
          rows = rows.filter((r) => r.userId === args.where.userId);
        }
        rows = [...rows].sort((a, b) => a.id.localeCompare(b.id));
        if (args.cursor) {
          const at = rows.findIndex((r) => r.id === args.cursor!.id);
          rows = rows.slice(at + 1);
        }
        return Promise.resolve(
          rows.slice(0, args.take).map((r) => ({
            id: r.id,
            userId: r.userId,
            user: { timezone: r.timezone },
          })),
        );
      },
    },
    lmsSyncJob: {
      create: (args: { data: { integrationId: string } }) => {
        const row: JobRow = {
          id: `j${jobs.length + 1}`,
          integrationId: args.data.integrationId,
          status: "PENDING",
        };
        jobs.push(row);
        jobStatusLog.push("PENDING");
        return Promise.resolve({ id: row.id });
      },
      update: (args: { where: { id: string }; data: { status: string } }) => {
        const row = jobs.find((j) => j.id === args.where.id)!;
        row.status = args.data.status;
        jobStatusLog.push(args.data.status);
        return Promise.resolve(row);
      },
    },
    lmsSyncJobItem: {
      create: (args: {
        data: {
          lmsSyncJobId: string;
          url: string;
          attempt: number;
          status: string;
        };
      }) => {
        const row: ItemRow = {
          id: `i${items.length + 1}`,
          jobId: args.data.lmsSyncJobId,
          url: args.data.url,
          status: args.data.status,
          attempt: args.data.attempt,
          statusCode: null,
          responseBody: null,
        };
        items.push(row);
        return Promise.resolve({ id: row.id });
      },
      update: (args: {
        where: { id: string };
        data: {
          status: string;
          statusCode: number | null;
          responseBody: string | null;
        };
      }) => {
        const row = items.find((i) => i.id === args.where.id)!;
        Object.assign(row, args.data);
        return Promise.resolve(row);
      },
    },
    lmsCourse: {
      upsert: (args: { create: Record<string, unknown> }) => {
        courses.push(args.create);
        return Promise.resolve(args.create);
      },
    },
  };

  return { client, jobs, items, jobStatusLog, courses };
}

// ── fixtures (deliberately fictional — never real DLU data) ────────────────

const NOW = new Date("2026-09-06T04:00:00.000Z"); // 11:00 in Vietnam

/** One assignment due later in September, on the fictional sample course. */
const MONTHLY_VIEW: MoodleMonthlyView = {
  weeks: [
    {
      days: [
        {
          events: [
            {
              id: 950001,
              name: "Môn học Mẫu Một — bài tập 1",
              modulename: "assign",
              eventtype: "due",
              instance: 800001,
              timestart: Math.floor(
                new Date("2026-09-20T16:00:00.000Z").getTime() / 1000,
              ),
              url: "https://lms.dlu.edu.vn/mod/assign/view.php?id=800001",
              course: {
                id: 90001,
                fullname: "Môn học Mẫu Một",
                shortname: "MHM1",
              },
            },
            {
              // Explicitly excluded by the parser: roll-call noise.
              id: 950002,
              name: "Điểm danh",
              modulename: "attendance",
              instance: 800002,
              timestart: Math.floor(
                new Date("2026-09-21T01:00:00.000Z").getTime() / 1000,
              ),
              url: "https://lms.dlu.edu.vn/mod/attendance/view.php?id=800002",
              course: { id: 90001, fullname: "Môn học Mẫu Một" },
            },
          ],
        },
      ],
    },
  ],
};

const ENV: Record<string, unknown> = {
  LMS_URL: "https://lms.example.test",
  DLU_TZ: "Asia/Ho_Chi_Minh",
  INGESTION_ENABLED: true,
  INGESTION_REQUEST_DELAY_MS: 0,
};

async function makeWatcher(
  opts: {
    integrations?: { id: string; userId: string; timezone: string }[];
    env?: Record<string, unknown>;
    login?: jest.Mock;
    fetchMonthlyView?: jest.Mock;
    // Issue #56's cache seams; the defaults keep the flag-off behaviour.
    confirmedCourses?: jest.Mock;
    lastSuccessAt?: jest.Mock;
    lmsFreshness?: jest.Mock;
    lmsBlocks?: jest.Mock;
    recordLmsItems?: jest.Mock;
    fanOutLms?: jest.Mock;
  } = {},
) {
  const db = makePrismaDouble(
    opts.integrations ?? [
      { id: "int-1", userId: "u1", timezone: "Asia/Ho_Chi_Minh" },
    ],
  );
  const env = { ...ENV, ...(opts.env ?? {}) };

  const login =
    opts.login ??
    jest.fn().mockResolvedValue({
      ok: true,
      session: { cookie: "MoodleSession=x", sesskey: "TESTSESSKEY" },
    });
  const fetchMonthlyView =
    opts.fetchMonthlyView ?? jest.fn().mockResolvedValue(MONTHLY_VIEW);
  const materialize = jest
    .fn()
    .mockResolvedValue({ created: 1, updated: 0, unchanged: 0, guarded: 0 });
  const reconcileDeleted = jest
    .fn()
    .mockResolvedValue({ deleted: 0, keptWithWarning: 0 });
  const flushDigest = jest.fn().mockResolvedValue(undefined);
  const revealCredentials = jest
    .fn()
    .mockResolvedValue({ username: "sv0001", password: "pw" });
  const confirmedCourses =
    opts.confirmedCourses ?? jest.fn().mockResolvedValue([]);
  const lastSuccessAt = opts.lastSuccessAt ?? jest.fn().mockResolvedValue(null);
  const lmsFreshness =
    opts.lmsFreshness ?? jest.fn().mockResolvedValue({ fresh: [], stale: [] });
  const lmsBlocks = opts.lmsBlocks ?? jest.fn().mockResolvedValue([]);
  const recordLmsItems =
    opts.recordLmsItems ??
    jest.fn().mockResolvedValue({
      created: 0,
      changed: 0,
      unchanged: 0,
      canceledKeys: [],
      touchedIds: [],
      transitions: [],
    });
  const fanOutLms = opts.fanOutLms ?? jest.fn().mockResolvedValue(undefined);

  const prisma = db.client as unknown as PrismaService;

  // IngestionJobsService is the real class, wired via DI over the fake
  // prisma double — everything else that touches the network/DLU is mocked.
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      LmsWatcherService,
      IngestionJobsService,
      { provide: PrismaService, useValue: prisma },
      {
        provide: ConfigService,
        useValue: { get: (name: string) => env[name] },
      },
      { provide: LMSService, useValue: { login, fetchMonthlyView } },
      {
        provide: MaterializerService,
        useValue: { materialize, reconcileDeleted, flushDigest },
      },
      {
        provide: NotificationsService,
        useValue: { notify: jest.fn(), create: jest.fn() },
      },
      { provide: IntegrationsService, useValue: { revealCredentials } },
      { provide: EnrollmentDiscoveryService, useValue: { confirmedCourses } },
      {
        provide: OccurrenceCacheService,
        useValue: { lmsFreshness, lmsBlocks, recordLmsItems },
      },
      { provide: OccurrenceFanoutService, useValue: { fanOutLms } },
      {
        provide: IngestionScheduleService,
        useValue: { lastSuccessAt },
      },
    ],
  }).compile();
  const service = module.get<LmsWatcherService>(LmsWatcherService);

  return {
    db,
    service,
    login,
    fetchMonthlyView,
    materialize,
    reconcileDeleted,
    flushDigest,
    revealCredentials,
    confirmedCourses,
    lastSuccessAt,
    lmsFreshness,
    lmsBlocks,
    recordLmsItems,
    fanOutLms,
  };
}

describe("LmsWatcherService", () => {
  describe("the INGESTION_ENABLED gate", () => {
    it("does nothing at all when the kill switch is off", async () => {
      const w = await makeWatcher({ env: { INGESTION_ENABLED: false } });

      await expect(w.service.run(NOW)).resolves.toBe(0);

      expect(w.revealCredentials).not.toHaveBeenCalled();
      expect(w.login).not.toHaveBeenCalled();
      expect(w.db.jobs).toHaveLength(0);
    });

    it("honours the string form the raw env hands back", async () => {
      const w = await makeWatcher({ env: { INGESTION_ENABLED: "false" } });

      await expect(w.service.run(NOW)).resolves.toBe(0);
      expect(w.db.jobs).toHaveLength(0);
    });
  });

  describe("a healthy run", () => {
    it("logs in once and fetches the current month and the next", async () => {
      const w = await makeWatcher();

      await expect(w.service.run(NOW)).resolves.toBe(1);

      expect(w.login).toHaveBeenCalledTimes(1);
      expect(w.fetchMonthlyView).toHaveBeenCalledTimes(2);
      const months = (
        w.fetchMonthlyView.mock.calls as [unknown, number, number][]
      ).map(([, year, month]) => [year, month]);
      expect(months).toEqual([
        [2026, 9],
        [2026, 10],
      ]);
    });

    it("walks the job through PENDING, PROCESSING and COMPLETED", async () => {
      const w = await makeWatcher();

      await w.service.run(NOW);

      expect(w.db.jobStatusLog).toEqual(["PENDING", "PROCESSING", "COMPLETED"]);
      expect(w.db.jobs[0]).toMatchObject({
        integrationId: "int-1",
        status: "COMPLETED",
      });
    });

    it("records one item per request, with its url and raw body", async () => {
      const w = await makeWatcher();

      await w.service.run(NOW);

      expect(w.db.items).toHaveLength(2);
      expect(w.db.items[0]).toMatchObject({
        jobId: "j1",
        status: "COMPLETED",
        attempt: 1,
        statusCode: 200,
      });
      expect(w.db.items[0].url).toContain("year=2026&month=9");
      const body = JSON.parse(w.db.items[0].responseBody!) as {
        body: MoodleMonthlyView;
        skipped: unknown[];
      };
      expect(body.body).toEqual(MONTHLY_VIEW);
      expect(body.skipped).toEqual([]);
    });

    it("hands the parsed blocks to the materializer as LMS-sourced", async () => {
      const w = await makeWatcher();

      await w.service.run(NOW);

      expect(w.materialize).toHaveBeenCalledTimes(2);
      const [userId, blocks, source] = w.materialize.mock.calls[0] as [
        string,
        { externalKey: string; type: string }[],
        string,
      ];
      expect(userId).toBe("u1");
      expect(source).toBe("LMS");
      // The attendance event is dropped by the parser, the assignment is not.
      expect(blocks).toHaveLength(1);
      expect(blocks[0]).toMatchObject({
        externalKey: "lms:assign:800001",
        type: "ASSIGNMENT",
      });
    });

    it("upserts the courses the calendar mentioned", async () => {
      const w = await makeWatcher();

      await w.service.run(NOW);

      expect(w.db.courses[0]).toMatchObject({
        lmsCourseId: 90001,
        fullName: "Môn học Mẫu Một",
        shortName: "MHM1",
      });
    });
  });

  describe("failures", () => {
    it("keeps going after a failed month, and still completes the job", async () => {
      const fetchMonthlyView = jest
        .fn()
        .mockResolvedValueOnce(MONTHLY_VIEW)
        .mockRejectedValueOnce(
          new Error("LMS calendar request failed (status 503)"),
        );
      const w = await makeWatcher({ fetchMonthlyView });

      await w.service.run(NOW);

      expect(w.db.items.map((i) => i.status)).toEqual(["COMPLETED", "FAILED"]);
      // The status code is recovered from the client's message.
      expect(w.db.items[1].statusCode).toBe(503);
      expect(
        (JSON.parse(w.db.items[1].responseBody!) as { error: string }).error,
      ).toContain("status 503");
      // The month that did come back was still written.
      expect(w.materialize).toHaveBeenCalledTimes(1);
      expect(w.db.jobs[0].status).toBe("COMPLETED");
    });

    it("fails the job — not an item — when the stored password is rejected", async () => {
      const login = jest
        .fn()
        .mockResolvedValue({ ok: false, reason: "INVALID_CREDENTIALS" });
      const w = await makeWatcher({ login });

      await w.service.run(NOW);

      expect(w.db.jobStatusLog).toEqual(["PENDING", "PROCESSING", "FAILED"]);
      expect(w.db.items).toHaveLength(0);
      expect(w.fetchMonthlyView).not.toHaveBeenCalled();
    });

    it("fails the job when DLU is unreachable at login", async () => {
      const login = jest
        .fn()
        .mockRejectedValue(new Error("LMS is unreachable"));
      const w = await makeWatcher({ login });

      await w.service.run(NOW);

      expect(w.db.jobs[0].status).toBe("FAILED");
      expect(w.db.items).toHaveLength(0);
    });

    it("does not let one student's failure stop the sweep", async () => {
      const login = jest
        .fn()
        .mockResolvedValueOnce({ ok: false, reason: "INVALID_CREDENTIALS" })
        .mockResolvedValue({
          ok: true,
          session: { cookie: "MoodleSession=x", sesskey: "TESTSESSKEY" },
        });
      const w = await makeWatcher({
        login,
        integrations: [
          { id: "int-1", userId: "u1", timezone: "Asia/Ho_Chi_Minh" },
          { id: "int-2", userId: "u2", timezone: "Asia/Ho_Chi_Minh" },
        ],
      });

      await expect(w.service.run(NOW)).resolves.toBe(2);

      expect(w.db.jobs.map((j) => j.status)).toEqual(["FAILED", "COMPLETED"]);
    });
  });

  describe("the manual trigger", () => {
    it("narrows the sweep to one student", async () => {
      const w = await makeWatcher({
        integrations: [
          { id: "int-1", userId: "u1", timezone: "Asia/Ho_Chi_Minh" },
          { id: "int-2", userId: "u2", timezone: "Asia/Ho_Chi_Minh" },
        ],
      });

      await expect(w.service.run(NOW, "u2")).resolves.toBe(1);

      expect(w.db.jobs).toHaveLength(1);
      expect(w.db.jobs[0].integrationId).toBe("int-2");
    });
  });
});

describe("LmsWatcherService — the occurrence cache (issue #56)", () => {
  const COURSE = 90001;
  /** Everything `decide()` needs in order to reach "cache". */
  const CACHEABLE = {
    confirmedCourses: jest.fn().mockResolvedValue([COURSE]),
    lastSuccessAt: jest
      .fn()
      .mockResolvedValue(new Date(NOW.getTime() - 3600_000)),
    lmsFreshness: jest.fn().mockResolvedValue({ fresh: [COURSE], stale: [] }),
    lmsBlocks: jest.fn().mockResolvedValue([
      {
        externalKey: "lms:assign:800001",
        title: "Môn học Mẫu Một — bài tập 1",
        type: "ASSIGNMENT" as const,
        scheduledStartTime: new Date("2026-09-20T15:45:00.000Z"),
        durationMinutes: 15,
        location: null,
        note: null,
        lmsCourse: {
          lmsCourseId: COURSE,
          fullName: "Môn học Mẫu Một",
          shortName: "MHM1",
        },
      },
    ]),
  };

  const cacheOn = (over: Record<string, unknown> = {}) => ({
    env: { INGESTION_OCCURRENCE_CACHE_ENABLED: true },
    ...CACHEABLE,
    ...over,
  });

  type RecordCall = [unknown[], Record<string, unknown>];

  beforeEach(() => jest.clearAllMocks());

  it("makes ZERO upstream requests — not even the login — when served", async () => {
    // Issue #56 acceptance criterion 8(a), calendar side.
    const w = await makeWatcher(cacheOn());

    await w.service.run(NOW);

    expect(w.login).not.toHaveBeenCalled();
    expect(w.fetchMonthlyView).not.toHaveBeenCalled();
    expect(w.materialize).toHaveBeenCalledTimes(1);
  });

  it("asks whether the cache still holds THIS student's own view of the window", async () => {
    const w = await makeWatcher(cacheOn());

    await w.service.run(NOW);

    expect(w.lmsFreshness).toHaveBeenCalledWith("u1", [COURSE], {
      now: NOW,
      window: {
        from: new Date("2026-08-31T17:00:00.000Z"),
        to: new Date("2026-10-31T16:59:59.999Z"),
        scope: "lms:2026-09,2026-10",
      },
    });
  });

  it("reconciles from the cached view over the rest of the window", async () => {
    const w = await makeWatcher(cacheOn());

    await w.service.run(NOW);

    expect(w.lmsBlocks).toHaveBeenCalledWith([COURSE], {
      from: NOW,
      to: new Date("2026-10-31T16:59:59.999Z"),
    });
    expect(w.reconcileDeleted).toHaveBeenCalledWith(
      "u1",
      "LMS",
      ["ASSIGNMENT", "EXAM"],
      new Set(["lms:assign:800001"]),
      NOW,
      expect.anything(),
    );
  });

  it("still writes a job row, and reports the pass as cache-served", async () => {
    const w = await makeWatcher(cacheOn());
    await expect(
      w.service.syncOne({ integrationId: "int-1", userId: "u1" }, NOW),
    ).resolves.toEqual({ ok: true, servedFromCache: true });
    expect(w.db.items).toHaveLength(1);
  });

  it("walks when the flag is off, however fresh the cache looks", async () => {
    const w = await makeWatcher({ ...CACHEABLE });
    await w.service.run(NOW);
    expect(w.fetchMonthlyView).toHaveBeenCalledTimes(2);
    expect(w.lmsBlocks).not.toHaveBeenCalled();
  });

  it("walks when LMS discovery has never succeeded", async () => {
    const w = await makeWatcher(
      cacheOn({ lastSuccessAt: jest.fn().mockResolvedValue(null) }),
    );
    await w.service.run(NOW);
    expect(w.fetchMonthlyView).toHaveBeenCalled();
    expect(w.lastSuccessAt).toHaveBeenCalledWith("int-1", "LMS_DISCOVERY");
  });

  it("walks when the student has no confirmed courses yet", async () => {
    // Moodle enrolment lags the timetable: empty means "not yet known".
    const w = await makeWatcher(
      cacheOn({ confirmedCourses: jest.fn().mockResolvedValue([]) }),
    );
    await w.service.run(NOW);
    expect(w.fetchMonthlyView).toHaveBeenCalled();
  });

  it("walks when a course is stale or a classmate sees it differently", async () => {
    // e.g. someone else holds an extension: the rows no longer match this
    // student's own view, so they fetch rather than inherit it.
    const w = await makeWatcher(
      cacheOn({
        lmsFreshness: jest
          .fn()
          .mockResolvedValue({ fresh: [], stale: [COURSE] }),
      }),
    );
    await w.service.run(NOW);
    expect(w.fetchMonthlyView).toHaveBeenCalledTimes(2);
    expect(w.lmsBlocks).not.toHaveBeenCalled();
  });

  it("walks on the periodic audit, however fresh everything is", async () => {
    const w = await makeWatcher(cacheOn());
    await w.service.syncOne(
      { integrationId: "int-1", userId: "u1", cacheHitStreak: 7 },
      NOW,
    );
    expect(w.fetchMonthlyView).toHaveBeenCalled();
  });

  it("records the student's view after a walk even with the flag off", async () => {
    const w = await makeWatcher({
      confirmedCourses: jest.fn().mockResolvedValue([COURSE, 90002]),
      lastSuccessAt: jest
        .fn()
        .mockResolvedValue(new Date(NOW.getTime() - 3600_000)),
    });

    await w.service.run(NOW);

    expect(w.recordLmsItems).toHaveBeenCalledTimes(1);
    const [occurrences, opts] = w.recordLmsItems.mock.calls[0] as RecordCall;
    // The same assignment in both months' responses is ONE occurrence.
    expect(occurrences).toHaveLength(1);
    expect(opts).toMatchObject({
      userId: "u1",
      complete: true,
      cacheable: true,
      courseIds: [COURSE, 90002],
    });
    expect(w.fanOutLms).not.toHaveBeenCalled();
  });

  it("records an incomplete read as incomplete, so nothing is retired", async () => {
    const w = await makeWatcher({
      fetchMonthlyView: jest
        .fn()
        .mockResolvedValueOnce(MONTHLY_VIEW)
        .mockRejectedValue(new Error("status 503")),
    });
    await w.service.run(NOW);
    const [, opts] = w.recordLmsItems.mock.calls[0] as RecordCall;
    expect(opts.complete).toBe(false);
  });

  it("fans out only corroborated transitions, and only with the flag on", async () => {
    const transitions = [{ unitId: COURSE, before: "lms#old" }];
    const recordLmsItems = jest.fn().mockResolvedValue({
      created: 0,
      changed: 1,
      unchanged: 0,
      canceledKeys: [],
      touchedIds: [String(COURSE)],
      transitions,
    });

    const on = await makeWatcher({
      env: { INGESTION_OCCURRENCE_CACHE_ENABLED: true },
      recordLmsItems,
    });
    await on.service.run(NOW);
    expect(on.fanOutLms).toHaveBeenCalledWith(transitions, {
      excludeUserId: "u1",
      window: { from: NOW, to: new Date("2026-10-31T16:59:59.999Z") },
      now: NOW,
    });

    const off = await makeWatcher({ recordLmsItems });
    await off.service.run(NOW);
    expect(off.fanOutLms).not.toHaveBeenCalled();
  });

  it("does not fan out a lone student's change (an extension, say)", async () => {
    const w = await makeWatcher({
      env: { INGESTION_OCCURRENCE_CACHE_ENABLED: true },
      recordLmsItems: jest.fn().mockResolvedValue({
        created: 0,
        changed: 1,
        unchanged: 0,
        canceledKeys: [],
        touchedIds: [String(COURSE)],
        transitions: [],
      }),
    });
    await w.service.run(NOW);
    expect(w.fanOutLms).not.toHaveBeenCalled();
  });

  it("reports a failed cache read as a failed pass, so the next one walks", async () => {
    const w = await makeWatcher(
      cacheOn({ lmsBlocks: jest.fn().mockRejectedValue(new Error("db gone")) }),
    );
    await expect(
      w.service.syncOne({ integrationId: "int-1", userId: "u1" }, NOW),
    ).resolves.toEqual({ ok: false, servedFromCache: false });
  });

  it("a failure to record the cache does not fail the student's own pass", async () => {
    const w = await makeWatcher({
      recordLmsItems: jest.fn().mockRejectedValue(new Error("db gone")),
    });
    await expect(
      w.service.syncOne({ integrationId: "int-1", userId: "u1" }, NOW),
    ).resolves.toMatchObject({ ok: true });
  });
});
