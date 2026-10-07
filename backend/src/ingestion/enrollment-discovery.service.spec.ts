import { ConfigService } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { IntegrationsService } from "../integrations/integrations.service";
import { LMSService } from "../lms/lms.service";
import { PortalAPIService } from "../portal/portal-api.service";
import { PrismaService } from "../prisma/prisma.service";
import { EnrollmentDiscoveryService } from "./enrollment-discovery.service";
import { IngestionJobsService } from "./ingestion-jobs.service";
import type { PortalRegistHistoryRow } from "./core/parse-regist-history";
import { IngestionScheduleService } from "./ingestion-schedule.service";

// ── in-memory Prisma double ────────────────────────────────────────────────

interface EnrollmentRow {
  id: string;
  userId: string;
  integrationId: string;
  scheduleStudyUnitId: string;
  yearStudy: string;
  termId: string;
  discoveredAt: Date;
  droppedAt: Date | null;
}

interface CourseEnrollmentRow {
  id: string;
  userId: string;
  integrationId: string;
  lmsCourseId: number;
  courseCategory: string | null;
  startDate: Date | null;
  hidden: boolean;
  currentTerm: boolean;
  discoveredAt: Date;
  droppedAt: Date | null;
}

function makePrismaDouble() {
  const jobs: { id: string; status: string }[] = [];
  const items: {
    id: string;
    url: string;
    status: string;
    responseBody: string | null;
  }[] = [];
  const sections: Record<string, unknown>[] = [];
  const courses: Record<string, unknown>[] = [];
  const enrollments: EnrollmentRow[] = [];
  const courseEnrollments: CourseEnrollmentRow[] = [];

  const jobTable = (prefix: string) => ({
    create: () => {
      const row = { id: `${prefix}${jobs.length + 1}`, status: "PENDING" };
      jobs.push(row);
      return Promise.resolve({ id: row.id });
    },
    update: (args: { where: { id: string }; data: { status: string } }) => {
      const row = jobs.find((j) => j.id === args.where.id)!;
      row.status = args.data.status;
      return Promise.resolve(row);
    },
  });

  const itemTable = () => ({
    create: (args: { data: { url: string; status: string } }) => {
      const row = {
        id: `i${items.length + 1}`,
        url: args.data.url,
        status: args.data.status,
        responseBody: null as string | null,
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
  });

  const client = {
    portalAPIJob: jobTable("j"),
    portalAPIJobItem: itemTable(),
    lmsSyncJob: jobTable("j"),
    lmsSyncJobItem: itemTable(),
    portalSection: {
      upsert: (args: {
        where: { scheduleStudyUnitId: string };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const existing = sections.find(
          (s) => s.scheduleStudyUnitId === args.where.scheduleStudyUnitId,
        );
        if (existing) {
          // `update: {}` must leave a walk-enriched row alone.
          Object.assign(existing, args.update);
          return Promise.resolve(existing);
        }
        sections.push({ ...args.create });
        return Promise.resolve(args.create);
      },
    },
    lmsCourse: {
      upsert: (args: {
        where: { lmsCourseId: number };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const existing = courses.find(
          (c) => c.lmsCourseId === args.where.lmsCourseId,
        );
        if (existing) {
          Object.assign(existing, args.update);
          return Promise.resolve(existing);
        }
        courses.push({ ...args.create });
        return Promise.resolve(args.create);
      },
    },
    portalSectionEnrollment: {
      upsert: (args: {
        where: {
          userId_scheduleStudyUnitId: {
            userId: string;
            scheduleStudyUnitId: string;
          };
        };
        create: Omit<EnrollmentRow, "id" | "droppedAt">;
        update: Partial<EnrollmentRow>;
      }) => {
        const key = args.where.userId_scheduleStudyUnitId;
        const existing = enrollments.find(
          (e) =>
            e.userId === key.userId &&
            e.scheduleStudyUnitId === key.scheduleStudyUnitId,
        );
        if (existing) {
          Object.assign(existing, args.update);
          return Promise.resolve(existing);
        }
        const row: EnrollmentRow = {
          id: `e${enrollments.length + 1}`,
          droppedAt: null,
          ...args.create,
        };
        enrollments.push(row);
        return Promise.resolve(row);
      },
      findMany: (args: {
        where: {
          userId: string;
          yearStudy?: string;
          termId?: string;
          droppedAt: null;
        };
      }) =>
        Promise.resolve(
          enrollments
            .filter(
              (e) =>
                e.userId === args.where.userId &&
                e.droppedAt === null &&
                (args.where.yearStudy === undefined ||
                  e.yearStudy === args.where.yearStudy) &&
                (args.where.termId === undefined ||
                  e.termId === args.where.termId),
            )
            .map((e) => ({
              id: e.id,
              scheduleStudyUnitId: e.scheduleStudyUnitId,
            })),
        ),
      updateMany: (args: {
        where: { id: { in: string[] } };
        data: { droppedAt: Date };
      }) => {
        let count = 0;
        for (const row of enrollments) {
          if (args.where.id.in.includes(row.id)) {
            row.droppedAt = args.data.droppedAt;
            count += 1;
          }
        }
        return Promise.resolve({ count });
      },
    },
    lmsCourseEnrollment: {
      upsert: (args: {
        where: { userId_lmsCourseId: { userId: string; lmsCourseId: number } };
        create: Omit<CourseEnrollmentRow, "id" | "droppedAt">;
        update: Partial<CourseEnrollmentRow>;
      }) => {
        const key = args.where.userId_lmsCourseId;
        const existing = courseEnrollments.find(
          (e) => e.userId === key.userId && e.lmsCourseId === key.lmsCourseId,
        );
        if (existing) {
          Object.assign(existing, args.update);
          return Promise.resolve(existing);
        }
        const row: CourseEnrollmentRow = {
          id: `ce${courseEnrollments.length + 1}`,
          droppedAt: null,
          ...args.create,
        };
        courseEnrollments.push(row);
        return Promise.resolve(row);
      },
      findMany: (args: {
        where: { userId: string; droppedAt: null; currentTerm?: boolean };
      }) =>
        Promise.resolve(
          courseEnrollments
            .filter(
              (e) =>
                e.userId === args.where.userId &&
                e.droppedAt === null &&
                (args.where.currentTerm === undefined ||
                  e.currentTerm === args.where.currentTerm),
            )
            .map((e) => ({ id: e.id, lmsCourseId: e.lmsCourseId })),
        ),
      updateMany: (args: {
        where: { id: { in: string[] } };
        data: { droppedAt: Date };
      }) => {
        let count = 0;
        for (const row of courseEnrollments) {
          if (args.where.id.in.includes(row.id)) {
            row.droppedAt = args.data.droppedAt;
            count += 1;
          }
        }
        return Promise.resolve({ count });
      },
    },
  };

  return {
    client,
    jobs,
    items,
    sections,
    courses,
    enrollments,
    courseEnrollments,
  };
}

// ── fixtures (deliberately fictional — never real DLU data) ────────────────

/** 26 Oct 2026, inside HK01 of the fictional 2026-2027 year. */
const NOW = new Date("2026-10-26T03:00:00.000Z");
const TARGET = { integrationId: "int1", userId: "u1" };

const ENV: Record<string, string | boolean> = {
  INGESTION_ENABLED: true,
  PORTAL_API_URL: "https://portal.example.test",
  DKHP_API_URL: "https://dkhp.example.test",
  LMS_URL: "https://lms.example.test",
  DLU_TZ: "Asia/Ho_Chi_Minh",
  INGESTION_LMS_TERM_FILTER: "shadow",
};

/** A registration event, carrying the staff id a real one repeats. */
function event(
  over: Partial<PortalRegistHistoryRow> = {},
): PortalRegistHistoryRow {
  return {
    CurriculumID: "99910AB100101",
    CurriculumName: "Môn học Mẫu Một ()",
    Status: 1,
    UpdateDate: "2026-06-09 09:50:34",
    YearStudy: "2026-2027",
    TermID: "HK01",
    ...({ UpdateStaff: "0000000" } as Partial<PortalRegistHistoryRow>),
    ...over,
  };
}

const SESSION = { cookie: "MoodleSession=abc", sesskey: "TESTSESSKEY" };

async function makeService(
  opts: {
    env?: Record<string, string | boolean>;
    authenticate?: jest.Mock;
    fetchRegistHistory?: jest.Mock;
    login?: jest.Mock;
    fetchEnrolledCourses?: jest.Mock;
    db?: ReturnType<typeof makePrismaDouble>;
  } = {},
) {
  const env = { ...ENV, ...(opts.env ?? {}) };
  const db = opts.db ?? makePrismaDouble();
  const authenticate =
    opts.authenticate ??
    jest.fn().mockResolvedValue({ ok: true, token: "TOK" });
  const fetchRegistHistory =
    opts.fetchRegistHistory ?? jest.fn().mockResolvedValue([event()]);
  const markDiscovered = jest.fn().mockResolvedValue(undefined);
  const login =
    opts.login ?? jest.fn().mockResolvedValue({ ok: true, session: SESSION });
  const fetchEnrolledCourses =
    opts.fetchEnrolledCourses ?? jest.fn().mockResolvedValue([]);
  const revealCredentials = jest
    .fn()
    .mockResolvedValue({ username: "test00001", password: "testpass123" });

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      EnrollmentDiscoveryService,
      // The real jobs service over the fake Prisma — the deliberate seam: only
      // the network is mocked, so the job/item lifecycle is genuinely exercised.
      IngestionJobsService,
      {
        provide: PrismaService,
        useValue: db.client,
      },
      {
        provide: ConfigService,
        useValue: { get: (n: string) => env[n] },
      },
      {
        provide: PortalAPIService,
        useValue: { authenticateDkhp: authenticate, fetchRegistHistory },
      },
      { provide: IngestionScheduleService, useValue: { markDiscovered } },
      { provide: LMSService, useValue: { login, fetchEnrolledCourses } },
      { provide: IntegrationsService, useValue: { revealCredentials } },
    ],
  }).compile();

  return {
    service: module.get(EnrollmentDiscoveryService),
    db,
    authenticate,
    fetchRegistHistory,
    markDiscovered,
    login,
    fetchEnrolledCourses,
    revealCredentials,
  };
}

describe("EnrollmentDiscoveryService — the kill switch", () => {
  it("does nothing at all when ingestion is disabled", async () => {
    const { service, db, revealCredentials } = await makeService({
      env: { INGESTION_ENABLED: false },
    });

    await expect(service.syncPortal(TARGET, NOW)).resolves.toEqual({
      ok: false,
      servedFromCache: false,
    });
    await expect(service.syncLms(TARGET, NOW)).resolves.toEqual({
      ok: false,
      servedFromCache: false,
    });

    expect(revealCredentials).not.toHaveBeenCalled();
    expect(db.jobs).toEqual([]);
  });
});

describe("EnrollmentDiscoveryService — syncPortal", () => {
  it("costs two requests: the DKHP sign-in and one history call", async () => {
    const { service, authenticate, fetchRegistHistory } = await makeService();

    const outcome = await service.syncPortal(TARGET, NOW);

    expect(outcome).toEqual({ ok: true, servedFromCache: false });
    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(fetchRegistHistory).toHaveBeenCalledTimes(1);
    expect(fetchRegistHistory).toHaveBeenCalledWith("TOK", "2026-2027", "HK01");
  });

  it("stamps the schedule row with the term a clean pass covered", async () => {
    const { service, markDiscovered } = await makeService();

    await service.syncPortal(TARGET, NOW);

    expect(markDiscovered).toHaveBeenCalledWith(
      "int1",
      expect.objectContaining({ academicYear: "2026-2027", semester: "HK01" }),
      NOW,
      // HK02's window opens a fortnight before it does; DKHP is not asked
      // again until then.
      expect.any(Date),
    );
    const reopensAt = (markDiscovered.mock.calls as unknown[][])[0][3] as Date;
    expect(reopensAt.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("writes the enrolment against the resolved term", async () => {
    const { service, db } = await makeService();

    await service.syncPortal(TARGET, NOW);

    expect(db.enrollments).toHaveLength(1);
    expect(db.enrollments[0]).toMatchObject({
      userId: "u1",
      integrationId: "int1",
      scheduleStudyUnitId: "99910AB100101",
      yearStudy: "2026-2027",
      termId: "HK01",
      discoveredAt: NOW,
      droppedAt: null,
    });
  });

  it("omits a section whose latest event is a cancellation", async () => {
    const { service, db } = await makeService({
      fetchRegistHistory: jest
        .fn()
        .mockResolvedValue([
          event(),
          event({ Status: 0, UpdateDate: "2026-07-14 16:16:59" }),
          event({ CurriculumID: "99910AB100202", Status: 1 }),
        ]),
    });

    await service.syncPortal(TARGET, NOW);

    expect(db.enrollments.map((e) => e.scheduleStudyUnitId)).toEqual([
      "99910AB100202",
    ]);
  });

  it("creates the catalog row the enrolment's foreign key needs", async () => {
    // Discovery runs before any walk on a new integration, so it cannot wait for
    // walk-sourced metadata to create PortalSection.
    const { service, db } = await makeService();

    await service.syncPortal(TARGET, NOW);

    expect(db.sections).toEqual([
      {
        scheduleStudyUnitId: "99910AB100101",
        curriculumId: "99910AB100101",
        curriculumName: "Môn học Mẫu Một",
        yearStudy: "2026-2027",
        termId: "HK01",
      },
    ]);
  });

  it("does not overwrite a catalog row a walk has already enriched", async () => {
    const db = makePrismaDouble();
    db.sections.push({
      scheduleStudyUnitId: "99910AB100101",
      curriculumName: "Môn học Mẫu Một",
      roomId: "X01.01",
      teacherName: "Nguyễn Văn A",
      groupNo: "01",
    });
    const { service } = await makeService({ db });

    await service.syncPortal(TARGET, NOW);

    expect(db.sections[0]).toMatchObject({
      roomId: "X01.01",
      teacherName: "Nguyễn Văn A",
      groupNo: "01",
    });
  });

  it("stamps droppedAt when a successful pass no longer lists a section", async () => {
    const db = makePrismaDouble();
    const { service } = await makeService({ db });
    await service.syncPortal(TARGET, NOW);
    expect(db.enrollments[0].droppedAt).toBeNull();

    // Next pass: the student cancelled it.
    const later = new Date(NOW.getTime() + 86_400_000);
    const { service: service2 } = await makeService({
      db,
      fetchRegistHistory: jest
        .fn()
        .mockResolvedValue([
          event(),
          event({ Status: 0, UpdateDate: "2026-07-14 16:16:59" }),
        ]),
    });
    await service2.syncPortal(TARGET, later);

    expect(db.enrollments[0].droppedAt).toEqual(later);
  });

  it("clears droppedAt when the student re-registers", async () => {
    const db = makePrismaDouble();
    db.enrollments.push({
      id: "e1",
      userId: "u1",
      integrationId: "int1",
      scheduleStudyUnitId: "99910AB100101",
      yearStudy: "2026-2027",
      termId: "HK01",
      discoveredAt: NOW,
      droppedAt: NOW,
    });

    const later = new Date(NOW.getTime() + 86_400_000);
    const { service } = await makeService({ db });
    await service.syncPortal(TARGET, later);

    expect(db.enrollments[0].droppedAt).toBeNull();
    expect(db.enrollments).toHaveLength(1);
  });

  it("NEVER narrows the set, or stamps the term, when the history call failed", async () => {
    // The rule the whole design rests on: "discovery is down" must not read as
    // "the student dropped everything".
    const db = makePrismaDouble();
    const { service } = await makeService({ db });
    await service.syncPortal(TARGET, NOW);
    expect(db.enrollments).toHaveLength(1);

    const later = new Date(NOW.getTime() + 86_400_000);
    const { service: service2, markDiscovered } = await makeService({
      db,
      fetchRegistHistory: jest
        .fn()
        .mockRejectedValue(new Error("DLU is unreachable")),
    });
    const outcome = await service2.syncPortal(TARGET, later);

    expect(outcome.ok).toBe(false);
    expect(db.enrollments[0].droppedAt).toBeNull();
    expect(markDiscovered).not.toHaveBeenCalled();
  });

  it("keeps the raw history body OFF the job item", async () => {
    // Each row carries the registering staff/student id, and responseBody is a
    // long-lived column. The section ids are the whole parse output.
    const { service, db } = await makeService();

    await service.syncPortal(TARGET, NOW);

    const item = db.items.find((i) => i.url.includes("getAllRegistHistory"));
    expect(item?.url).toBe(
      "https://dkhp.example.test/api/student/getAllRegistHistory",
    );
    expect(item?.responseBody).toBeTruthy();
    expect(item!.responseBody).not.toContain("0000000");
    expect(item!.responseBody).not.toContain("UpdateStaff");
    // …but the ids a diagnosis needs are there.
    expect(item!.responseBody).toContain("99910AB100101");
  });

  it("fails the job, not an item, when DKHP rejects the credentials", async () => {
    const { service, db, fetchRegistHistory } = await makeService({
      authenticate: jest
        .fn()
        .mockResolvedValue({ ok: false, reason: "INVALID_CREDENTIALS" }),
    });

    const outcome = await service.syncPortal(TARGET, NOW);

    expect(outcome.ok).toBe(false);
    expect(db.jobs[0].status).toBe("FAILED");
    expect(db.items).toEqual([]);
    expect(fetchRegistHistory).not.toHaveBeenCalled();
  });

  it("records the upstream status code on a failed history item", async () => {
    const { service, db } = await makeService({
      fetchRegistHistory: jest
        .fn()
        .mockRejectedValue(
          new Error(
            "Portal request to /getAllRegistHistory failed (status 403)",
          ),
        ),
    });

    await service.syncPortal(TARGET, NOW);

    const item = db.items.find((i) => i.url.includes("getAllRegistHistory"));
    expect(item).toMatchObject({ status: "FAILED", statusCode: 403 });
  });
});

describe("EnrollmentDiscoveryService — syncLms", () => {
  const course = (over: Record<string, unknown> = {}) => ({
    id: 20001,
    fullname: "Môn học Mẫu Một",
    shortname: "TESTCUR-IT-101",
    coursecategory: "Học kỳ 1",
    startdate: Math.floor(
      new Date("2026-09-01T00:00:00.000Z").getTime() / 1000,
    ),
    visible: true,
    hidden: false,
    ...over,
  });

  it("stores every enrolment with the filter's verdict per row", async () => {
    const { service, db } = await makeService({
      fetchEnrolledCourses: jest
        .fn()
        .mockResolvedValue([course(), course({ id: 20002, hidden: true })]),
    });

    const outcome = await service.syncLms(TARGET, NOW);

    expect(outcome).toEqual({ ok: true, servedFromCache: false });
    expect(
      db.courseEnrollments.map((e) => [e.lmsCourseId, e.currentTerm]),
    ).toEqual([
      [20001, true],
      // Recorded, not discarded: the filter is advisory until validated.
      [20002, false],
    ]);
  });

  it("creates the LmsCourse row the enrolment's foreign key needs", async () => {
    const { service, db } = await makeService({
      fetchEnrolledCourses: jest.fn().mockResolvedValue([course()]),
    });

    await service.syncLms(TARGET, NOW);

    expect(db.courses).toEqual([
      {
        lmsCourseId: 20001,
        fullName: "Môn học Mẫu Một",
        shortName: "TESTCUR-IT-101",
      },
    ]);
  });

  it("records the three filter signals for later inspection", async () => {
    const { service, db } = await makeService({
      fetchEnrolledCourses: jest
        .fn()
        .mockResolvedValue([course({ hidden: true })]),
    });

    await service.syncLms(TARGET, NOW);

    expect(db.courseEnrollments[0]).toMatchObject({
      courseCategory: "Học kỳ 1",
      startDate: new Date("2026-09-01T00:00:00.000Z"),
      hidden: true,
      currentTerm: false,
    });
  });

  it("puts the excluded set and its reasons on the job item", async () => {
    // The shadow-mode artefact: what the filter *would* have dropped, and why.
    const { service, db } = await makeService({
      fetchEnrolledCourses: jest
        .fn()
        .mockResolvedValue([course(), course({ id: 20002, hidden: true })]),
    });

    await service.syncLms(TARGET, NOW);

    expect(db.items[0].responseBody).toContain('"reason":"hidden"');
    expect(db.items[0].responseBody).toContain('"currentTerm":1');
  });

  it("drops an enrolment the student no longer has", async () => {
    const db = makePrismaDouble();
    const { service } = await makeService({
      db,
      fetchEnrolledCourses: jest.fn().mockResolvedValue([course()]),
    });
    await service.syncLms(TARGET, NOW);

    const later = new Date(NOW.getTime() + 86_400_000);
    const { service: service2 } = await makeService({
      db,
      fetchEnrolledCourses: jest.fn().mockResolvedValue([]),
    });
    await service2.syncLms(TARGET, later);

    expect(db.courseEnrollments[0].droppedAt).toEqual(later);
  });

  it("does not narrow the set when the fetch failed", async () => {
    const db = makePrismaDouble();
    const { service } = await makeService({
      db,
      fetchEnrolledCourses: jest.fn().mockResolvedValue([course()]),
    });
    await service.syncLms(TARGET, NOW);

    const { service: service2 } = await makeService({
      db,
      fetchEnrolledCourses: jest.fn().mockRejectedValue(new Error("boom")),
    });
    const outcome = await service2.syncLms(TARGET, new Date(NOW.getTime() + 1));

    expect(outcome.ok).toBe(false);
    expect(db.courseEnrollments[0].droppedAt).toBeNull();
  });

  it("fails the job when the LMS rejects the credentials", async () => {
    const { service, db } = await makeService({
      login: jest
        .fn()
        .mockResolvedValue({ ok: false, reason: "INVALID_CREDENTIALS" }),
    });

    const outcome = await service.syncLms(TARGET, NOW);

    expect(outcome.ok).toBe(false);
    expect(db.jobs[0].status).toBe("FAILED");
    expect(db.items).toEqual([]);
  });
});

describe("EnrollmentDiscoveryService — what the walk passes read", () => {
  it("confirmedSections returns only live registrations of the given term", async () => {
    const db = makePrismaDouble();
    const { service } = await makeService({ db });
    await service.syncPortal(TARGET, NOW);
    db.enrollments.push(
      {
        id: "e2",
        userId: "u1",
        integrationId: "int1",
        scheduleStudyUnitId: "99910AB100202",
        yearStudy: "2026-2027",
        termId: "HK01",
        discoveredAt: NOW,
        droppedAt: NOW,
      },
      {
        id: "e3",
        userId: "u1",
        integrationId: "int1",
        scheduleStudyUnitId: "99820AB100101",
        yearStudy: "2025-2026",
        termId: "HK02",
        discoveredAt: NOW,
        droppedAt: null,
      },
    );

    await expect(
      service.confirmedSections("u1", {
        academicYear: "2026-2027",
        termId: "HK01",
      }),
    ).resolves.toEqual(["99910AB100101"]);
  });

  it("confirmedCourses ignores the term verdict in shadow mode", async () => {
    // Erring wide costs a redundant fetch; erring narrow silently drops a real
    // course off a calendar.
    const db = makePrismaDouble();
    const { service } = await makeService({
      db,
      fetchEnrolledCourses: jest.fn().mockResolvedValue([
        { id: 20001, fullname: "A", coursecategory: "Học kỳ 1" },
        { id: 20002, fullname: "B", hidden: true },
      ]),
    });
    await service.syncLms(TARGET, NOW);

    await expect(service.confirmedCourses("u1")).resolves.toEqual([
      20001, 20002,
    ]);
  });

  it("confirmedCourses honours the verdict once the filter is enforced", async () => {
    const db = makePrismaDouble();
    const { service } = await makeService({
      db,
      fetchEnrolledCourses: jest.fn().mockResolvedValue([
        { id: 20001, fullname: "A", coursecategory: "Học kỳ 1" },
        { id: 20002, fullname: "B", hidden: true },
      ]),
    });
    await service.syncLms(TARGET, NOW);

    const { service: enforcing } = await makeService({
      db,
      env: { INGESTION_LMS_TERM_FILTER: "enforce" },
    });
    await expect(enforcing.confirmedCourses("u1")).resolves.toEqual([20001]);
  });
});
