import { ConfigService } from "@nestjs/config";
import type { IntegrationsService } from "../integrations/integrations.service";
import type { LMSService } from "../lms/lms.service";
import type { NotificationsService } from "../notifications/notifications.service";
import { PrismaService } from "../prisma/prisma.service";
import type { MoodleMonthlyView } from "./core/parse-lms";
import { IngestionJobsService } from "./ingestion-jobs.service";
import { LmsWatcherService } from "./lms-watcher.service";
import type { MaterializerService } from "./materializer.service";

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
              location: null,
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

function makeWatcher(
  opts: {
    integrations?: { id: string; userId: string; timezone: string }[];
    env?: Record<string, unknown>;
    login?: jest.Mock;
    fetchMonthlyView?: jest.Mock;
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
  const revealCredentials = jest
    .fn()
    .mockResolvedValue({ username: "sv0001", password: "pw" });

  const prisma = db.client as unknown as PrismaService;
  const service = new LmsWatcherService(
    prisma,
    { get: (name: string) => env[name] } as unknown as ConfigService,
    { login, fetchMonthlyView } as unknown as LMSService,
    new IngestionJobsService(prisma),
    { materialize, reconcileDeleted } as unknown as MaterializerService,
    { notify: jest.fn(), create: jest.fn() } as unknown as NotificationsService,
    { revealCredentials } as unknown as IntegrationsService,
  );

  return {
    db,
    service,
    login,
    fetchMonthlyView,
    materialize,
    reconcileDeleted,
    revealCredentials,
  };
}

describe("LmsWatcherService", () => {
  describe("the INGESTION_ENABLED gate", () => {
    it("does nothing at all when the kill switch is off", async () => {
      const w = makeWatcher({ env: { INGESTION_ENABLED: false } });

      await expect(w.service.run(NOW)).resolves.toBe(0);

      expect(w.revealCredentials).not.toHaveBeenCalled();
      expect(w.login).not.toHaveBeenCalled();
      expect(w.db.jobs).toHaveLength(0);
    });

    it("honours the string form the raw env hands back", async () => {
      const w = makeWatcher({ env: { INGESTION_ENABLED: "false" } });

      await expect(w.service.run(NOW)).resolves.toBe(0);
      expect(w.db.jobs).toHaveLength(0);
    });
  });

  describe("a healthy run", () => {
    it("logs in once and fetches the current month and the next", async () => {
      const w = makeWatcher();

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
      const w = makeWatcher();

      await w.service.run(NOW);

      expect(w.db.jobStatusLog).toEqual(["PENDING", "PROCESSING", "COMPLETED"]);
      expect(w.db.jobs[0]).toMatchObject({
        integrationId: "int-1",
        status: "COMPLETED",
      });
    });

    it("records one item per request, with its url and raw body", async () => {
      const w = makeWatcher();

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
      const w = makeWatcher();

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
      const w = makeWatcher();

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
      const w = makeWatcher({ fetchMonthlyView });

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
      const w = makeWatcher({ login });

      await w.service.run(NOW);

      expect(w.db.jobStatusLog).toEqual(["PENDING", "PROCESSING", "FAILED"]);
      expect(w.db.items).toHaveLength(0);
      expect(w.fetchMonthlyView).not.toHaveBeenCalled();
    });

    it("fails the job when DLU is unreachable at login", async () => {
      const login = jest
        .fn()
        .mockRejectedValue(new Error("DLU LMS is unreachable"));
      const w = makeWatcher({ login });

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
      const w = makeWatcher({
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
      const w = makeWatcher({
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
