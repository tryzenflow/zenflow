import { ConfigService } from "@nestjs/config";
import type { IntegrationsService } from "../integrations/integrations.service";
import type { PortalAPIService } from "../portal/portal-api.service";
import { PrismaService } from "../prisma/prisma.service";
import type { PortalExamRow } from "./core/parse-portal";
import { ExamWatcherService } from "./exam-watcher.service";
import { IngestionJobsService } from "./ingestion-jobs.service";
import type { MaterializerService } from "./materializer.service";

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

function makePrismaDouble() {
  const jobs: JobRow[] = [];
  const items: ItemRow[] = [];
  const jobStatusLog: string[] = [];

  const client = {
    integration: {
      findMany: (args: { where: { userId?: string }; take: number }) =>
        Promise.resolve(
          args.where.userId && args.where.userId !== "u1"
            ? []
            : [
                {
                  id: "int-1",
                  userId: "u1",
                  user: { timezone: "Asia/Saigon" },
                },
              ],
        ),
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
  };

  return { client, jobs, items, jobStatusLog };
}

// ── fixtures (deliberately fictional — never real DLU data) ────────────────

/** 6 Sep 2026, 11:00 in Vietnam — HK01 of the 2026-2027 academic year. */
const NOW = new Date("2026-09-06T04:00:00.000Z");

const EXAM_ROWS: PortalExamRow[] = [
  {
    Examination: 500001,
    ScheduleStudyUnitID: "99910AB100101",
    CurriculumID: "10AB1001",
    CurriculumName: "Môn học Mẫu Một",
    NgayThi: "15/12/2026",
    GioThi: "07g30",
    ThoiLuong: "90",
    PhongThi: "X01.01",
    HinhThucThi: "Thi máy",
  },
  {
    // No usable date, so the parser drops it and says why.
    Examination: 500002,
    CurriculumName: "Môn học Mẫu Hai",
    NgayThi: "",
    GioThi: "07g30",
    ThoiLuong: "60",
  },
];

const ENV: Record<string, unknown> = {
  PORTAL_API_URL: "https://portal.example.test",
  DLU_TZ: "Asia/Ho_Chi_Minh",
  INGESTION_ENABLED: true,
};

function makeWatcher(
  opts: {
    env?: Record<string, unknown>;
    authenticate?: jest.Mock;
    fetchExams?: jest.Mock;
  } = {},
) {
  const db = makePrismaDouble();
  const env = { ...ENV, ...(opts.env ?? {}) };
  const authenticate =
    opts.authenticate ??
    jest.fn().mockResolvedValue({ ok: true, token: "test-token" });
  const fetchExams = opts.fetchExams ?? jest.fn().mockResolvedValue(EXAM_ROWS);
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
  const service = new ExamWatcherService(
    prisma,
    { get: (name: string) => env[name] } as unknown as ConfigService,
    { authenticate, fetchExams } as unknown as PortalAPIService,
    new IngestionJobsService(prisma),
    { materialize, reconcileDeleted } as unknown as MaterializerService,
    { revealCredentials } as unknown as IntegrationsService,
  );

  return {
    db,
    service,
    authenticate,
    fetchExams,
    materialize,
    reconcileDeleted,
  };
}

describe("ExamWatcherService", () => {
  it("does nothing when INGESTION_ENABLED is off", async () => {
    const w = makeWatcher({ env: { INGESTION_ENABLED: false } });

    await expect(w.service.run(NOW)).resolves.toBe(0);
    expect(w.authenticate).not.toHaveBeenCalled();
    expect(w.db.jobs).toHaveLength(0);
  });

  it("costs exactly one request: a whole term in one response", async () => {
    const w = makeWatcher();

    await expect(w.service.run(NOW)).resolves.toBe(1);

    expect(w.fetchExams.mock.calls).toEqual([
      ["test-token", "2026-2027", "HK01"],
    ]);
    expect(w.db.items).toHaveLength(1);
    expect(w.db.items[0].url).toContain("namhoc=2026-2027&hocky=HK01");
    expect(w.db.jobStatusLog).toEqual(["PENDING", "PROCESSING", "COMPLETED"]);
  });

  it("materializes the exams and records what it dropped", async () => {
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
      externalKey: "portal:exam:500001",
      type: "EXAM",
      durationMinutes: 90,
    });

    const body = JSON.parse(w.db.items[0].responseBody!) as {
      skipped: { ref: string }[];
    };
    expect(body.skipped.map((s) => s.ref)).toEqual(["portal:exam:500002"]);
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

  it("marks the item failed but still completes the job on a bad response", async () => {
    const fetchExams = jest
      .fn()
      .mockRejectedValue(
        new Error("Portal request to /api/student/exam failed (status 502)"),
      );
    const w = makeWatcher({ fetchExams });

    await w.service.run(NOW);

    expect(w.db.items[0]).toMatchObject({ status: "FAILED", statusCode: 502 });
    expect(w.db.jobs[0].status).toBe("COMPLETED");
    expect(w.materialize).not.toHaveBeenCalled();
  });

  it("narrows to one student for the manual trigger", async () => {
    const w = makeWatcher();

    await expect(w.service.run(NOW, "u2")).resolves.toBe(0);
    expect(w.db.jobs).toHaveLength(0);
  });
});
