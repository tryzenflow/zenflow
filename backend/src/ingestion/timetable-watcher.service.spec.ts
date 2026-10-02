import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { IntegrationsService } from "../integrations/integrations.service";
import { PortalAPIService } from "../portal/portal-api.service";
import { PrismaService } from "../prisma/prisma.service";
import type { PortalTimetableRow } from "./core/parse-portal";
import { EnrollmentDiscoveryService } from "./enrollment-discovery.service";
import { IngestionJobsService } from "./ingestion-jobs.service";
import { IngestionScheduleService } from "./ingestion-schedule.service";
import { OccurrenceCacheService } from "./occurrence-cache.service";
import { OccurrenceFanoutService } from "./occurrence-fanout.service";
import { SyncDigest } from "./core/sync-digest";
import { MaterializerService } from "./materializer.service";
import { TimetableWatcherService } from "./timetable-watcher.service";

// ── in-memory Prisma double (PortalAPIJob side) ────────────────────────────

interface JobRow {
  id: string;
  integrationId: string;
  status: string;
}
interface ItemRow {
  id: string;
  url: string;
  status: string;
  statusCode: number | null;
  responseBody: string | null;
}

function makePrismaDouble(
  integrations: { id: string; userId: string; timezone: string }[],
) {
  const jobs: JobRow[] = [];
  const items: ItemRow[] = [];
  const jobStatusLog: string[] = [];
  const sections: Record<string, unknown>[] = [];
  let legacySessionCount = 0;

  const client = {
    integration: {
      findMany: (args: {
        where: { provider: string; userId?: string };
        take: number;
        cursor?: { id: string };
      }) => {
        let rows = [...integrations].sort((a, b) => a.id.localeCompare(b.id));
        if (args.where.userId) {
          rows = rows.filter((r) => r.userId === args.where.userId);
        }
        if (args.cursor) {
          rows = rows.slice(
            rows.findIndex((r) => r.id === args.cursor!.id) + 1,
          );
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
    portalAPIJob: {
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
    portalAPIJobItem: {
      create: (args: { data: { url: string; status: string } }) => {
        const row: ItemRow = {
          id: `i${items.length + 1}`,
          url: args.data.url,
          status: args.data.status,
          statusCode: null,
          responseBody: null,
        };
        items.push(row);
        return Promise.resolve({ id: row.id });
      },
      update: (args: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        const row = items.find((i) => i.id === args.where.id)!;
        Object.assign(row, args.data);
        return Promise.resolve(row);
      },
    },
    portalSection: {
      upsert: (args: { create: Record<string, unknown> }) => {
        sections.push(args.create);
        return Promise.resolve(args.create);
      },
    },
    // Issue #56: `decide()` counts a student's remaining pre-re-key lecture
    // rows. `legacySessionCount` is what a test dials to simulate them.
    session: {
      count: () => Promise.resolve(legacySessionCount),
    },
  };

  return {
    client,
    jobs,
    items,
    jobStatusLog,
    sections,
    setLegacySessionCount: (n: number) => {
      legacySessionCount = n;
    },
  };
}

// ── fixtures (deliberately fictional — never real DLU data) ────────────────

/** Monday 17 Aug 2026, 11:00 in Vietnam — ISO week 34, inside HK01 2026-2027. */
const NOW = new Date("2026-08-17T04:00:00.000Z");

/**
 * The weeks a run at {@link NOW} has to cover: everything left of HK01, which
 * closes on Sun 27 Dec 2026 (the last week of December opens HK02) — so weeks
 * 34 through 52.
 */
const REMAINING_WEEKS = Array.from({ length: 19 }, (_, i) => 34 + i);

const TIMETABLE_ROWS: PortalTimetableRow[] = [
  {
    WeekScheduleID: 600001,
    ScheduleStudyUnitID: "99910AB100101",
    CurriculumName: "Môn học Mẫu Một",
    PeriodID: 1,
    NumberOfPeriods: 4,
    Ngay: "17/08/2026",
    RoomID: "X01.01",
    BuildingName: "X01",
    CampusName: "CSMAU",
    FullName: "Nguyễn Văn A",
    YearStudy: "2026-2027",
    TermID: "HK01",
    TKHHienThi:
      "<span>Môn học Mẫu Một (10AB1001)</span><br/><span>- Nhóm: 01</span>",
  },
  {
    // Periods 5–6 are undocumented, so this one is skipped with a reason.
    WeekScheduleID: 600002,
    ScheduleStudyUnitID: "99910AB100101",
    CurriculumName: "Môn học Mẫu Một",
    PeriodID: 5,
    NumberOfPeriods: 2,
    Ngay: "18/08/2026",
    YearStudy: "2026-2027",
    TermID: "HK01",
  },
];

const ENV: Record<string, unknown> = {
  PORTAL_API_URL: "https://portal.example.test",
  DLU_TZ: "Asia/Ho_Chi_Minh",
  INGESTION_ENABLED: true,
  INGESTION_REQUEST_DELAY_MS: 0,
};

async function makeWatcher(
  opts: {
    env?: Record<string, unknown>;
    authenticate?: jest.Mock;
    fetchTimetable?: jest.Mock;
    integrations?: { id: string; userId: string; timezone: string }[];
    // Issue #56's cache seams. Defaults keep the pre-#56 behaviour: the flag is
    // off, so `decide()` short-circuits to "walk" before touching any of them.
    confirmedSections?: jest.Mock;
    // The discovery gate. Default: already discovered for this term.
    isDiscovered?: jest.Mock;
    syncPortal?: jest.Mock;
    timetableFreshness?: jest.Mock;
    timetableBlocks?: jest.Mock;
    recordTimetableWeek?: jest.Mock;
    fanOutTimetable?: jest.Mock;
  } = {},
) {
  const db = makePrismaDouble(
    opts.integrations ?? [
      { id: "int-1", userId: "u1", timezone: "Asia/Ho_Chi_Minh" },
    ],
  );
  const env = { ...ENV, ...(opts.env ?? {}) };
  const authenticate =
    opts.authenticate ??
    jest.fn().mockResolvedValue({ ok: true, token: "test-token" });
  const fetchTimetable =
    opts.fetchTimetable ?? jest.fn().mockResolvedValue(TIMETABLE_ROWS);
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
  const confirmedSections =
    opts.confirmedSections ?? jest.fn().mockResolvedValue([]);
  const isDiscovered = opts.isDiscovered ?? jest.fn().mockResolvedValue(true);
  const syncPortal =
    opts.syncPortal ??
    jest.fn().mockResolvedValue({ ok: true, servedFromCache: false });
  const timetableFreshness =
    opts.timetableFreshness ??
    jest.fn().mockResolvedValue({ fresh: [], stale: [] });
  const timetableBlocks =
    opts.timetableBlocks ?? jest.fn().mockResolvedValue([]);
  const recordTimetableWeek =
    opts.recordTimetableWeek ??
    jest.fn().mockResolvedValue({
      created: 0,
      changed: 0,
      unchanged: 0,
      canceledKeys: [],
      touchedIds: [],
    });
  const fanOutTimetable =
    opts.fanOutTimetable ?? jest.fn().mockResolvedValue(undefined);

  const prisma = db.client as unknown as PrismaService;

  // IngestionJobsService is the real class, wired via DI over the fake
  // prisma double — everything else that touches the network/DLU is mocked.
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      TimetableWatcherService,
      IngestionJobsService,
      { provide: PrismaService, useValue: prisma },
      {
        provide: ConfigService,
        useValue: { get: (name: string) => env[name] },
      },
      { provide: PortalAPIService, useValue: { authenticate, fetchTimetable } },
      {
        provide: MaterializerService,
        useValue: { materialize, reconcileDeleted, flushDigest },
      },
      { provide: IntegrationsService, useValue: { revealCredentials } },
      {
        provide: EnrollmentDiscoveryService,
        useValue: { confirmedSections, syncPortal },
      },
      {
        provide: OccurrenceCacheService,
        useValue: { timetableFreshness, timetableBlocks, recordTimetableWeek },
      },
      { provide: OccurrenceFanoutService, useValue: { fanOutTimetable } },
      {
        provide: IngestionScheduleService,
        useValue: { isDiscovered },
      },
    ],
  }).compile();
  const service = module.get<TimetableWatcherService>(TimetableWatcherService);

  return {
    db,
    service,
    authenticate,
    fetchTimetable,
    materialize,
    reconcileDeleted,
    flushDigest,
    confirmedSections,
    isDiscovered,
    syncPortal,
    timetableFreshness,
    timetableBlocks,
    recordTimetableWeek,
    fanOutTimetable,
  };
}

describe("TimetableWatcherService", () => {
  it("does nothing when INGESTION_ENABLED is off", async () => {
    const w = await makeWatcher({ env: { INGESTION_ENABLED: false } });

    await expect(w.service.run(NOW)).resolves.toBe(0);
    expect(w.authenticate).not.toHaveBeenCalled();
    expect(w.db.jobs).toHaveLength(0);
  });

  it("resolves the term and asks for every week left in it", async () => {
    const w = await makeWatcher();

    await expect(w.service.run(NOW)).resolves.toBe(1);

    // One sign-in for the whole sweep, not one per week.
    expect(w.authenticate).toHaveBeenCalledTimes(1);
    expect(w.fetchTimetable.mock.calls).toEqual(
      REMAINING_WEEKS.map((week) => ["test-token", "2026-2027", "HK01", week]),
    );
  });

  it("does not look back at weeks the student has already lived through", async () => {
    const w = await makeWatcher();

    // Sunday 25 Oct 2026 — week 43 is nearly over, but the portal answers per
    // week, so the current week is still fetched whole; 34–42 are not.
    await w.service.run(new Date("2026-10-25T04:00:00.000Z"));

    const weeks = w.fetchTimetable.mock.calls.map((c) => (c as unknown[])[3]);
    expect(weeks[0]).toBe(43);
    expect(weeks[weeks.length - 1]).toBe(52);
  });

  it("starts at the new term's opening week once the lookahead rolls over", async () => {
    const w = await makeWatcher();

    // Sunday 20 Dec 2026: HK01 has days left, but HK02 opens within the
    // two-week lookahead, so the sweep jumps to HK02's first week (53) rather
    // than re-reading HK01's tail.
    await w.service.run(new Date("2026-12-20T04:00:00.000Z"));

    const calls = w.fetchTimetable.mock.calls as unknown[][];
    expect(calls[0]).toEqual(["test-token", "2026-2027", "HK02", 53]);
    expect(calls[1]).toEqual(["test-token", "2026-2027", "HK02", 1]);
    expect(calls[calls.length - 1]).toEqual([
      "test-token",
      "2026-2027",
      "HK02",
      21,
    ]);
  });

  it("walks the portal job through its lifecycle", async () => {
    const w = await makeWatcher();

    await w.service.run(NOW);

    expect(w.db.jobStatusLog).toEqual(["PENDING", "PROCESSING", "COMPLETED"]);
    expect(w.db.items).toHaveLength(REMAINING_WEEKS.length);
    expect(w.db.items[0].url).toContain("tuan=34");
    expect(w.db.items[w.db.items.length - 1].url).toContain("tuan=52");
  });

  it("shares one digest across every week and the deletion pass, flushed once", async () => {
    const w = await makeWatcher();

    await w.service.run(NOW);

    const digests = new Set([
      ...(w.materialize.mock.calls as unknown[][]).map((c) => c[4]),
      ...(w.reconcileDeleted.mock.calls as unknown[][]).map((c) => c[5]),
    ]);
    expect(digests.size).toBe(1);
    expect([...digests][0]).toBeInstanceOf(SyncDigest);
    expect(w.flushDigest).toHaveBeenCalledTimes(1);
    expect(w.flushDigest).toHaveBeenCalledWith("u1", [...digests][0], NOW);
  });

  it("materializes the parsed meetings as PORTAL-sourced", async () => {
    const w = await makeWatcher();

    await w.service.run(NOW);

    const [userId, blocks, source] = w.materialize.mock.calls[0] as [
      string,
      { externalKey: string; type: string; durationMinutes: number }[],
      string,
    ];
    expect(userId).toBe("u1");
    expect(source).toBe("PORTAL");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      // Re-keyed by #56: section + DLU-local day + starting period.
      externalKey: "portal:lecture:99910AB100101:2026-08-17:1",
      legacyExternalKey: "portal:meeting:600001",
      type: "LECTURE",
    });
    // Invariant #3: a 4-period lecture is 220 raw minutes, snapped out to 225.
    expect(blocks[0].durationMinutes % 15).toBe(0);
  });

  it("keeps the parser's skip reasons on the job item", async () => {
    const w = await makeWatcher();

    await w.service.run(NOW);

    const body = JSON.parse(w.db.items[0].responseBody!) as {
      skipped: { ref: string; reason: string }[];
    };
    expect(body.skipped).toHaveLength(1);
    expect(body.skipped[0].ref).toBe("portal:lecture:99910AB100101");
    expect(body.skipped[0].reason).toContain("periods 5");
  });

  it("upserts the section catalog", async () => {
    const w = await makeWatcher();

    await w.service.run(NOW);

    expect(w.db.sections[0]).toMatchObject({
      scheduleStudyUnitId: "99910AB100101",
      curriculumId: "10AB1001",
      curriculumName: "Môn học Mẫu Một",
      yearStudy: "2026-2027",
      termId: "HK01",
      teacherName: "Nguyễn Văn A",
      roomId: "X01.01",
    });
  });

  it("fails the job when the portal rejects the stored credentials", async () => {
    const authenticate = jest
      .fn()
      .mockResolvedValue({ ok: false, reason: "INVALID_CREDENTIALS" });
    const w = await makeWatcher({ authenticate });

    await w.service.run(NOW);

    expect(w.db.jobStatusLog).toEqual(["PENDING", "PROCESSING", "FAILED"]);
    expect(w.db.items).toHaveLength(0);
  });

  it("carries on after one failed week", async () => {
    const fetchTimetable = jest
      .fn()
      .mockRejectedValueOnce(
        new Error("Portal request to /api/student/x failed (status 500)"),
      )
      .mockResolvedValue(TIMETABLE_ROWS);
    const w = await makeWatcher({ fetchTimetable });

    await w.service.run(NOW);

    expect(w.db.items.map((i) => i.status)).toEqual([
      "FAILED",
      ...REMAINING_WEEKS.slice(1).map(() => "COMPLETED"),
    ]);
    expect(w.db.items[0].statusCode).toBe(500);
    expect(w.db.jobs[0].status).toBe("COMPLETED");
    expect(w.materialize).toHaveBeenCalledTimes(REMAINING_WEEKS.length - 1);
  });
});

describe("TimetableWatcherService — the discovery gate", () => {
  it("fetches no timetable until discovery has covered the term, running it inline", async () => {
    const calls: string[] = [];
    const syncPortal = jest.fn().mockImplementation(() => {
      calls.push("discovery");
      return Promise.resolve({ ok: true, servedFromCache: false });
    });
    const fetchTimetable = jest.fn().mockImplementation(() => {
      calls.push("timetable");
      return Promise.resolve(TIMETABLE_ROWS);
    });
    const w = await makeWatcher({
      isDiscovered: jest.fn().mockResolvedValue(false),
      syncPortal,
      fetchTimetable,
    });

    await w.service.run(NOW);

    expect(syncPortal).toHaveBeenCalledTimes(1);
    expect(calls[0]).toBe("discovery");
    expect(calls.filter((c) => c === "timetable")).toHaveLength(
      REMAINING_WEEKS.length,
    );
    expect(w.isDiscovered).toHaveBeenCalledWith(
      "int-1",
      expect.objectContaining({ academicYear: "2026-2027", semester: "HK01" }),
    );
  });

  it("does not run discovery again when the term is already covered", async () => {
    const w = await makeWatcher();

    await w.service.run(NOW);

    expect(w.syncPortal).not.toHaveBeenCalled();
    expect(w.fetchTimetable).toHaveBeenCalled();
  });

  it("makes no timetable request and fails the pass when the inline discovery fails", async () => {
    const w = await makeWatcher({
      isDiscovered: jest.fn().mockResolvedValue(false),
      syncPortal: jest
        .fn()
        .mockResolvedValue({ ok: false, servedFromCache: false }),
    });

    const outcome = await w.service.syncOne(
      { integrationId: "int-1", userId: "u1" },
      NOW,
    );

    expect(outcome.ok).toBe(false);
    expect(w.authenticate).not.toHaveBeenCalled();
    expect(w.fetchTimetable).not.toHaveBeenCalled();
    expect(w.db.jobs).toHaveLength(0);
  });
});

describe("TimetableWatcherService — the occurrence cache (issue #56)", () => {
  /** Everything `decide()` needs in order to reach "cache". */
  const CACHEABLE = {
    confirmedSections: jest.fn().mockResolvedValue(["99910AB100101"]),
    timetableFreshness: jest
      .fn()
      .mockResolvedValue({ fresh: ["99910AB100101"], stale: [] }),
    timetableBlocks: jest.fn().mockResolvedValue([
      {
        externalKey: "portal:lecture:99910AB100101:2026-08-17:1",
        legacyExternalKey: null,
        title: "Môn học Mẫu Một",
        type: "LECTURE" as const,
        scheduledStartTime: new Date("2026-08-17T00:30:00.000Z"),
        durationMinutes: 225,
        location: "X01.01",
        note: "GV: Nguyễn Văn A",
        scheduleStudyUnitId: "99910AB100101",
      },
    ]),
  };

  /** A cacheable student, with the flag on. */
  const cacheOn = (over: Record<string, unknown> = {}) => ({
    env: { INGESTION_OCCURRENCE_CACHE_ENABLED: true },
    ...CACHEABLE,
    ...over,
  });

  beforeEach(() => jest.clearAllMocks());

  it("makes ZERO upstream requests when every section is cache-fresh", async () => {
    // Issue #56, acceptance criterion 8(a). Note `authenticate` too: a
    // cache-served pass must not even log in.
    const w = await makeWatcher(cacheOn());

    await w.service.run(NOW);

    expect(w.authenticate).not.toHaveBeenCalled();
    expect(w.fetchTimetable).not.toHaveBeenCalled();
    // …and the student's calendar was still written.
    expect(w.materialize).toHaveBeenCalledTimes(1);
    expect(w.timetableBlocks).toHaveBeenCalledTimes(1);
  });

  it("reads the cache from the start of the current week, like a walk", async () => {
    // A walk writes the whole current week, earlier days included; a student
    // first served from cache must not be missing those meetings.
    const w = await makeWatcher(cacheOn());

    await w.service.run(NOW);

    const [, window] = w.timetableBlocks.mock.calls[0] as [
      string[],
      { from: Date; to: Date },
    ];
    // Mon 17 Aug 2026 00:00 in Vietnam.
    expect(window.from).toEqual(new Date("2026-08-16T17:00:00.000Z"));
  });

  it("still writes a job row, so lastSyncedAt keeps moving", async () => {
    // A student kept current from the cache must not look like they stopped
    // syncing — IntegrationStatus is derived from these rows.
    const w = await makeWatcher(cacheOn());

    await w.service.run(NOW);

    expect(w.db.jobStatusLog).toEqual(["PENDING", "PROCESSING", "COMPLETED"]);
    expect(w.db.items).toHaveLength(1);
    // Not a URL: nothing was requested, and the job row should not imply it was.
    expect(w.db.items[0].url).toContain("cache:portal_timetable");
  });

  it("reports the pass as served from cache", async () => {
    const w = await makeWatcher(cacheOn());
    await expect(
      w.service.syncOne({ integrationId: "int-1", userId: "u1" }, NOW),
    ).resolves.toEqual({ ok: true, servedFromCache: true });
  });

  it("reconciles deletions from the cached set, which is a complete picture", async () => {
    const w = await makeWatcher(cacheOn());

    await w.service.run(NOW);

    expect(w.reconcileDeleted).toHaveBeenCalledWith(
      "u1",
      "PORTAL",
      ["LECTURE"],
      new Set(["portal:lecture:99910AB100101:2026-08-17:1"]),
      NOW,
      expect.anything(),
    );
  });

  it("walks when the flag is off, however fresh the cache looks", async () => {
    const w = await makeWatcher({ ...CACHEABLE });
    await w.service.run(NOW);
    expect(w.fetchTimetable).toHaveBeenCalled();
    expect(w.timetableBlocks).not.toHaveBeenCalled();
  });

  it("walks when the student has no confirmed sections", async () => {
    // An empty set is "we do not know", not "nothing to do".
    const w = await makeWatcher(
      cacheOn({ confirmedSections: jest.fn().mockResolvedValue([]) }),
    );
    await w.service.run(NOW);
    expect(w.fetchTimetable).toHaveBeenCalled();
  });

  it("walks the WHOLE term when even one section is stale", async () => {
    // The portal has no per-section endpoint, so one stale section costs the
    // full walk — which then warms every section for all the classmates.
    const w = await makeWatcher(
      cacheOn({
        confirmedSections: jest
          .fn()
          .mockResolvedValue(["99910AB100101", "99910AB100202"]),
        timetableFreshness: jest.fn().mockResolvedValue({
          fresh: ["99910AB100101"],
          stale: ["99910AB100202"],
        }),
      }),
    );

    await w.service.run(NOW);

    expect(w.fetchTimetable).toHaveBeenCalledTimes(REMAINING_WEEKS.length);
  });

  it("walks while the student still has pre-re-key lecture rows", async () => {
    // A cached occurrence cannot mint their old per-student
    // portal:meeting:<WeekScheduleID> key, so serving them would duplicate every
    // lecture and retire the originals. One walk adopts them; then this is zero.
    const w = await makeWatcher(cacheOn());
    w.db.setLegacySessionCount(12);

    await w.service.run(NOW);

    expect(w.fetchTimetable).toHaveBeenCalled();
    expect(w.timetableBlocks).not.toHaveBeenCalled();
  });

  it("walks on the periodic audit, however fresh everything is", async () => {
    const w = await makeWatcher(cacheOn());

    // A student who has been served from cache 7 times in a row.
    await w.service.syncOne(
      { integrationId: "int-1", userId: "u1", cacheHitStreak: 7 },
      NOW,
    );

    expect(w.fetchTimetable).toHaveBeenCalled();
  });

  it("records occurrences after a walk even with the flag off", async () => {
    // The fetch happened anyway, so warming the cache is free — and flipping the
    // flag on should find a warm cache, not a cold one.
    const w = await makeWatcher();

    await w.service.run(NOW);

    expect(w.recordTimetableWeek).toHaveBeenCalledTimes(REMAINING_WEEKS.length);
    expect(
      (
        w.recordTimetableWeek.mock.calls as [unknown, Record<string, unknown>][]
      )[0][1],
    ).toMatchObject({
      complete: true,
      isoWeek: REMAINING_WEEKS[0],
    });
    // …but nothing is pushed to other students while the flag is off.
    expect(w.fanOutTimetable).not.toHaveBeenCalled();
  });

  it("suppresses the cancellation pass when a week failed", async () => {
    // A 503 misread as "these classes were cancelled" would fan that mistake out
    // to every student in the section, not just this one.
    const w = await makeWatcher({
      fetchTimetable: jest
        .fn()
        .mockResolvedValueOnce(TIMETABLE_ROWS)
        .mockRejectedValue(new Error("DLU is unreachable")),
    });

    await w.service.run(NOW);

    for (const call of w.recordTimetableWeek.mock.calls as [
      unknown,
      Record<string, unknown>,
    ][]) {
      expect(call[1]).toMatchObject({ complete: false });
    }
  });

  it("fans a change out to classmates once the flag is on", async () => {
    const w = await makeWatcher({
      env: { INGESTION_OCCURRENCE_CACHE_ENABLED: true },
      // Force a walk, so there is something to record and fan out.
      confirmedSections: jest.fn().mockResolvedValue([]),
      recordTimetableWeek: jest.fn().mockResolvedValue({
        created: 0,
        changed: 1,
        unchanged: 0,
        canceledKeys: ["portal:lecture:99910AB100101:2026-08-24:1"],
        touchedIds: ["99910AB100101"],
      }),
    });

    await w.service.run(NOW);

    expect(w.fanOutTimetable).toHaveBeenCalledTimes(1);
    const [sectionIds, canceled, opts] = w.fanOutTimetable.mock.calls[0] as [
      string[],
      string[],
      { excludeUserId: string },
    ];
    expect(sectionIds).toEqual(["99910AB100101"]);
    expect(canceled).toContain("portal:lecture:99910AB100101:2026-08-24:1");
    // The walker's own rows were already written by the walk itself.
    expect(opts.excludeUserId).toBe("u1");
  });

  it("does not fan out when nothing changed", async () => {
    const w = await makeWatcher({
      env: { INGESTION_OCCURRENCE_CACHE_ENABLED: true },
      confirmedSections: jest.fn().mockResolvedValue([]),
    });

    await w.service.run(NOW);

    expect(w.fanOutTimetable).not.toHaveBeenCalled();
  });

  it("reports a failed cache read as a failed pass, so the next one walks", async () => {
    const w = await makeWatcher(
      cacheOn({
        timetableBlocks: jest.fn().mockRejectedValue(new Error("db gone")),
      }),
    );

    await expect(
      w.service.syncOne({ integrationId: "int-1", userId: "u1" }, NOW),
    ).resolves.toEqual({ ok: false, servedFromCache: false });
  });

  it("a failure to record the cache does not fail the student's own pass", async () => {
    // Their calendar is already written and correct; a cache that failed to
    // record simply stays stale, which costs a walk.
    const w = await makeWatcher({
      recordTimetableWeek: jest.fn().mockRejectedValue(new Error("db gone")),
    });

    await expect(
      w.service.syncOne({ integrationId: "int-1", userId: "u1" }, NOW),
    ).resolves.toMatchObject({ ok: true });
  });
});
