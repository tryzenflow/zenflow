import { ConfigService } from "@nestjs/config";
import type { IntegrationsService } from "../integrations/integrations.service";
import type { PortalAPIService } from "../portal/portal-api.service";
import { PrismaService } from "../prisma/prisma.service";
import type { PortalTimetableRow } from "./core/parse-portal";
import { IngestionJobsService } from "./ingestion-jobs.service";
import type { MaterializerService } from "./materializer.service";
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
  };

  return { client, jobs, items, jobStatusLog, sections };
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

function makeWatcher(
  opts: {
    env?: Record<string, unknown>;
    authenticate?: jest.Mock;
    fetchTimetable?: jest.Mock;
    integrations?: { id: string; userId: string; timezone: string }[];
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
  const revealCredentials = jest
    .fn()
    .mockResolvedValue({ username: "sv0001", password: "pw" });

  const prisma = db.client as unknown as PrismaService;
  const service = new TimetableWatcherService(
    prisma,
    { get: (name: string) => env[name] } as unknown as ConfigService,
    { authenticate, fetchTimetable } as unknown as PortalAPIService,
    new IngestionJobsService(prisma),
    { materialize, reconcileDeleted } as unknown as MaterializerService,
    { revealCredentials } as unknown as IntegrationsService,
  );

  return {
    db,
    service,
    authenticate,
    fetchTimetable,
    materialize,
    reconcileDeleted,
  };
}

describe("TimetableWatcherService", () => {
  it("does nothing when INGESTION_ENABLED is off", async () => {
    const w = makeWatcher({ env: { INGESTION_ENABLED: false } });

    await expect(w.service.run(NOW)).resolves.toBe(0);
    expect(w.authenticate).not.toHaveBeenCalled();
    expect(w.db.jobs).toHaveLength(0);
  });

  it("resolves the term and asks for every week left in it", async () => {
    const w = makeWatcher();

    await expect(w.service.run(NOW)).resolves.toBe(1);

    // One sign-in for the whole sweep, not one per week.
    expect(w.authenticate).toHaveBeenCalledTimes(1);
    expect(w.fetchTimetable.mock.calls).toEqual(
      REMAINING_WEEKS.map((week) => ["test-token", "2026-2027", "HK01", week]),
    );
  });

  it("does not look back at weeks the student has already lived through", async () => {
    const w = makeWatcher();

    // Sunday 25 Oct 2026 — week 43 is nearly over, but the portal answers per
    // week, so the current week is still fetched whole; 34–42 are not.
    await w.service.run(new Date("2026-10-25T04:00:00.000Z"));

    const weeks = w.fetchTimetable.mock.calls.map((c) => (c as unknown[])[3]);
    expect(weeks[0]).toBe(43);
    expect(weeks[weeks.length - 1]).toBe(52);
  });

  it("starts at the new term's opening week once the lookahead rolls over", async () => {
    const w = makeWatcher();

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
    const w = makeWatcher();

    await w.service.run(NOW);

    expect(w.db.jobStatusLog).toEqual(["PENDING", "PROCESSING", "COMPLETED"]);
    expect(w.db.items).toHaveLength(REMAINING_WEEKS.length);
    expect(w.db.items[0].url).toContain("tuan=34");
    expect(w.db.items[w.db.items.length - 1].url).toContain("tuan=52");
  });

  it("materializes the parsed meetings as PORTAL-sourced", async () => {
    const w = makeWatcher();

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
      externalKey: "portal:meeting:600001",
      type: "LECTURE",
    });
    // Invariant #3: a 4-period lecture is 220 raw minutes, snapped out to 225.
    expect(blocks[0].durationMinutes % 15).toBe(0);
  });

  it("keeps the parser's skip reasons on the job item", async () => {
    const w = makeWatcher();

    await w.service.run(NOW);

    const body = JSON.parse(w.db.items[0].responseBody!) as {
      skipped: { ref: string; reason: string }[];
    };
    expect(body.skipped).toHaveLength(1);
    expect(body.skipped[0].ref).toBe("portal:meeting:600002");
    expect(body.skipped[0].reason).toContain("periods 5");
  });

  it("upserts the section catalog", async () => {
    const w = makeWatcher();

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
    const w = makeWatcher({ authenticate });

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
    const w = makeWatcher({ fetchTimetable });

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
