import { ConfigService } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { PrismaService } from "../prisma/prisma.service";
import { MaterializerService } from "./materializer.service";
import { OccurrenceCacheService } from "./occurrence-cache.service";
import { OccurrenceFanoutService } from "./occurrence-fanout.service";

const NOW = new Date("2026-10-26T03:00:00.000Z");
const TERM_END = new Date("2026-12-20T16:59:59.999Z");
const WINDOW = { from: NOW, to: TERM_END };
const SECTION = "99910AB100101";
const OTHER_SECTION = "99910AB100202";

/** Confirmed registrations, the reverse index fan-out walks. */
interface Enrollment {
  userId: string;
  scheduleStudyUnitId: string;
  droppedAt: Date | null;
}

interface CourseEnrollment {
  userId: string;
  lmsCourseId: number;
  droppedAt: Date | null;
  seenFingerprint?: string | null;
}

/** Prisma's `field: value | { in: values }` filter, as the double reads it. */
function matches<T>(filter: T | { in: T[] } | undefined, value: T): boolean {
  if (filter === undefined) return true;
  if (typeof filter === "object" && filter !== null && "in" in filter) {
    return filter.in.includes(value);
  }
  return filter === value;
}

function makePrismaDouble(
  enrollments: Enrollment[] = [],
  courseEnrollments: CourseEnrollment[] = [],
) {
  const client = {
    portalSectionEnrollment: {
      findMany: (args: {
        where: {
          scheduleStudyUnitId: string | { in: string[] };
          droppedAt: null;
          userId?: string | { not: string };
        };
        distinct?: string[];
        take?: number;
      }) => {
        let rows = enrollments.filter(
          (e) =>
            matches(args.where.scheduleStudyUnitId, e.scheduleStudyUnitId) &&
            e.droppedAt === null,
        );
        const who = args.where.userId;
        if (typeof who === "string") {
          rows = rows.filter((e) => e.userId === who);
        } else if (who && "not" in who) {
          rows = rows.filter((e) => e.userId !== who.not);
        }
        if (args.distinct?.includes("userId")) {
          const seen = new Set<string>();
          rows = rows.filter((e) =>
            seen.has(e.userId) ? false : (seen.add(e.userId), true),
          );
        }
        if (args.take !== undefined) rows = rows.slice(0, args.take);
        return Promise.resolve(
          rows.map((e) => ({
            userId: e.userId,
            scheduleStudyUnitId: e.scheduleStudyUnitId,
          })),
        );
      },
    },
    lmsCourseEnrollment: {
      findMany: (args: {
        where: {
          lmsCourseId: number | { in: number[] };
          droppedAt: null;
          userId?: string | { not: string };
          seenFingerprint?: string;
        };
        distinct?: string[];
        take?: number;
      }) => {
        let rows = courseEnrollments.filter(
          (e) =>
            matches(args.where.lmsCourseId, e.lmsCourseId) &&
            matches(args.where.seenFingerprint, e.seenFingerprint ?? null) &&
            e.droppedAt === null,
        );
        const who = args.where.userId;
        if (typeof who === "string") {
          rows = rows.filter((e) => e.userId === who);
        } else if (who && "not" in who) {
          rows = rows.filter((e) => e.userId !== who.not);
        }
        if (args.distinct?.includes("userId")) {
          const seen = new Set<string>();
          rows = rows.filter((e) =>
            seen.has(e.userId) ? false : (seen.add(e.userId), true),
          );
        }
        if (args.take !== undefined) rows = rows.slice(0, args.take);
        return Promise.resolve(
          rows.map((e) => ({ userId: e.userId, lmsCourseId: e.lmsCourseId })),
        );
      },
    },
  };
  return { client };
}

/**
 * Typed views of the mock call tuples, so assertions on them stay type-checked
 * rather than sliding into `any`.
 */
type MaterializeCall = [string, unknown[], string, Date, object];
type BlocksCall = [string[], { from: Date; to: Date }];
type RetireCall = [string, string, string[], Date, object];

async function makeFanout(
  opts: {
    enrollments?: Enrollment[];
    courseEnrollments?: CourseEnrollment[];
    env?: Record<string, unknown>;
    materialize?: jest.Mock;
    retireExternalKeys?: jest.Mock;
    timetableBlocks?: jest.Mock;
  } = {},
) {
  const db = makePrismaDouble(opts.enrollments, opts.courseEnrollments);
  const materialize =
    opts.materialize ??
    jest.fn().mockResolvedValue({
      created: 0,
      updated: 1,
      unchanged: 0,
      skippedDeleted: 0,
      skippedMoved: 0,
    });
  const retireExternalKeys =
    opts.retireExternalKeys ?? jest.fn().mockResolvedValue({ deleted: 0 });
  const flushDigest = jest.fn().mockResolvedValue(undefined);
  const timetableBlocks =
    opts.timetableBlocks ??
    jest.fn().mockResolvedValue([{ externalKey: "portal:lecture:x" }]);
  const lmsBlocks = jest.fn().mockResolvedValue([]);

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      OccurrenceFanoutService,
      {
        provide: PrismaService,
        useValue: db.client,
      },
      {
        provide: ConfigService,
        useValue: {
          get: (n: string) => (opts.env ?? {})[n],
        },
      },
      {
        provide: OccurrenceCacheService,
        useValue: { timetableBlocks, lmsBlocks },
      },
      {
        provide: MaterializerService,
        useValue: { materialize, retireExternalKeys, flushDigest },
      },
    ],
  }).compile();

  return {
    service: module.get(OccurrenceFanoutService),
    materialize,
    retireExternalKeys,
    flushDigest,
    timetableBlocks,
    lmsBlocks,
  };
}

describe("OccurrenceFanoutService — fanOutTimetable", () => {
  it("visits every classmate except the student who walked", async () => {
    const { service, materialize } = await makeFanout({
      enrollments: [
        { userId: "walker", scheduleStudyUnitId: SECTION, droppedAt: null },
        { userId: "u2", scheduleStudyUnitId: SECTION, droppedAt: null },
        { userId: "u3", scheduleStudyUnitId: SECTION, droppedAt: null },
      ],
    });

    const summary = await service.fanOutTimetable([SECTION], [], {
      excludeUserId: "walker",
      window: WINDOW,
      now: NOW,
    });

    expect(summary.students).toBe(2);
    // The walker's own rows were already written by the walk itself.
    expect(
      (materialize.mock.calls as MaterializeCall[]).map((c) => c[0]),
    ).toEqual(["u2", "u3"]);
  });

  it("goes through materialize, which is what preserves a hand-moved row", async () => {
    // Issue #56 criterion: "a cache-discovered change fans out to every affected
    // student's Session without clobbering a hand-moved one." The preservation
    // itself lives in materialize (and is tested there); what matters here is
    // that fan-out routes through it rather than doing a bulk write.
    const materialize = jest.fn().mockResolvedValue({
      created: 0,
      updated: 1,
      unchanged: 0,
      skippedDeleted: 1,
      skippedMoved: 1,
    });
    const { service } = await makeFanout({
      enrollments: [
        { userId: "u2", scheduleStudyUnitId: SECTION, droppedAt: null },
        { userId: "u3", scheduleStudyUnitId: SECTION, droppedAt: null },
        { userId: "u4", scheduleStudyUnitId: SECTION, droppedAt: null },
      ],
      materialize,
    });

    const summary = await service.fanOutTimetable([SECTION], [], {
      excludeUserId: "walker",
      window: WINDOW,
      now: NOW,
    });

    expect(materialize).toHaveBeenCalledTimes(3);
    expect(summary).toMatchObject({
      students: 3,
      updated: 3,
      skippedMoved: 3,
      skippedDeleted: 3,
    });
  });

  it("gives each student their own digest, so each gets one notification", async () => {
    // SyncDigest is per-user by construction, so a section-wide change must not
    // collapse into one global notification.
    const { service, materialize, flushDigest } = await makeFanout({
      enrollments: [
        { userId: "u2", scheduleStudyUnitId: SECTION, droppedAt: null },
        { userId: "u3", scheduleStudyUnitId: SECTION, droppedAt: null },
      ],
    });

    await service.fanOutTimetable([SECTION], [], {
      excludeUserId: "walker",
      window: WINDOW,
      now: NOW,
    });

    expect(flushDigest).toHaveBeenCalledTimes(2);
    const digests = (materialize.mock.calls as MaterializeCall[]).map(
      (c) => c[4],
    );
    expect(digests[0]).not.toBe(digests[1]);
  });

  it("only ever reads a student's OWN confirmed sections", async () => {
    // The structural guarantee behind "no student's schedule is ever inferred by
    // copying another student's": u3 is in a different section, so even though
    // both sections were touched, u3's blocks come only from theirs.
    const { service, timetableBlocks } = await makeFanout({
      enrollments: [
        { userId: "u2", scheduleStudyUnitId: SECTION, droppedAt: null },
        { userId: "u3", scheduleStudyUnitId: OTHER_SECTION, droppedAt: null },
      ],
    });

    await service.fanOutTimetable([SECTION, OTHER_SECTION], [], {
      excludeUserId: "walker",
      window: WINDOW,
      now: NOW,
    });

    expect(
      (timetableBlocks.mock.calls as BlocksCall[]).map((c) => c[0]),
    ).toEqual([[SECTION], [OTHER_SECTION]]);
  });

  it("ignores a student who dropped the section", async () => {
    const { service, materialize } = await makeFanout({
      enrollments: [
        { userId: "u2", scheduleStudyUnitId: SECTION, droppedAt: null },
        { userId: "u3", scheduleStudyUnitId: SECTION, droppedAt: NOW },
      ],
    });

    await service.fanOutTimetable([SECTION], [], {
      excludeUserId: "walker",
      window: WINDOW,
      now: NOW,
    });

    expect(
      (materialize.mock.calls as MaterializeCall[]).map((c) => c[0]),
    ).toEqual(["u2"]);
  });

  it("retires a cancelled meeting from every classmate's calendar", async () => {
    const retireExternalKeys = jest.fn().mockResolvedValue({ deleted: 1 });
    const { service } = await makeFanout({
      enrollments: [
        { userId: "u2", scheduleStudyUnitId: SECTION, droppedAt: null },
        { userId: "u3", scheduleStudyUnitId: SECTION, droppedAt: null },
      ],
      retireExternalKeys,
    });

    const summary = await service.fanOutTimetable(
      [SECTION],
      ["portal:lecture:99910AB100101:2026-11-02:1"],
      { excludeUserId: "walker", window: WINDOW, now: NOW },
    );

    expect(retireExternalKeys).toHaveBeenCalledTimes(2);
    expect(
      (retireExternalKeys.mock.calls as RetireCall[])[0].slice(0, 3),
    ).toEqual(["u2", "PORTAL", ["portal:lecture:99910AB100101:2026-11-02:1"]]);
    expect(summary.removed).toBe(2);
  });

  it("fans a cancellation out even when no section content changed", async () => {
    // A cancelled class is a change with no surviving occurrence to carry it.
    const { service, retireExternalKeys } = await makeFanout({
      enrollments: [
        { userId: "u2", scheduleStudyUnitId: SECTION, droppedAt: null },
      ],
      retireExternalKeys: jest.fn().mockResolvedValue({ deleted: 1 }),
    });

    const summary = await service.fanOutTimetable(
      [SECTION],
      ["portal:lecture:99910AB100101:2026-11-02:1"],
      { excludeUserId: "walker", window: WINDOW, now: NOW },
    );

    expect(retireExternalKeys).toHaveBeenCalled();
    expect(summary.removed).toBe(1);
  });

  it("caps the fan-out rather than turning one tick into a thousand writes", async () => {
    const { service, materialize } = await makeFanout({
      enrollments: Array.from({ length: 10 }, (_, i) => ({
        userId: `u${i}`,
        scheduleStudyUnitId: SECTION,
        droppedAt: null,
      })),
      env: { INGESTION_FANOUT_MAX_STUDENTS: 3 },
    });

    const summary = await service.fanOutTimetable([SECTION], [], {
      excludeUserId: "walker",
      window: WINDOW,
      now: NOW,
    });

    expect(summary.students).toBe(3);
    expect(materialize).toHaveBeenCalledTimes(3);
  });

  it("does nothing when there is nothing to fan out", async () => {
    const { service, materialize } = await makeFanout();

    await expect(
      service.fanOutTimetable([], [], {
        excludeUserId: "walker",
        window: WINDOW,
        now: NOW,
      }),
    ).resolves.toMatchObject({ students: 0 });
    expect(materialize).not.toHaveBeenCalled();
  });

  it("does nothing when the walker is the section's only student", async () => {
    const { service, materialize } = await makeFanout({
      enrollments: [
        { userId: "walker", scheduleStudyUnitId: SECTION, droppedAt: null },
      ],
    });

    const summary = await service.fanOutTimetable([SECTION], [], {
      excludeUserId: "walker",
      window: WINDOW,
      now: NOW,
    });

    expect(summary.students).toBe(0);
    expect(materialize).not.toHaveBeenCalled();
  });
});

/**
 * Moodle fans out only CORROBORATED transitions, and only to classmates
 * whose own last view was the transition's `before` (issue #56 divergence guard).
 */
const OLD_VIEW = "scope#old";
const OTHER_VIEW = "scope#someone-elses";

describe("OccurrenceFanoutService — fanOutLms", () => {
  it("reaches only classmates whose last view was the one the change left", async () => {
    // u3 had already seen something different (their own extension, say), so a
    // change corroborated by two other students is not assumed to apply to them.
    const { service, materialize, lmsBlocks } = await makeFanout({
      courseEnrollments: [
        {
          userId: "walker",
          lmsCourseId: 20001,
          droppedAt: null,
          seenFingerprint: OLD_VIEW,
        },
        {
          userId: "u2",
          lmsCourseId: 20001,
          droppedAt: null,
          seenFingerprint: OLD_VIEW,
        },
        {
          userId: "u3",
          lmsCourseId: 20001,
          droppedAt: null,
          seenFingerprint: OTHER_VIEW,
        },
        {
          userId: "u4",
          lmsCourseId: 20001,
          droppedAt: null,
          seenFingerprint: null,
        },
      ],
    });

    const summary = await service.fanOutLms(
      [{ unitId: 20001, before: OLD_VIEW }],
      { excludeUserId: "walker", window: WINDOW, now: NOW },
    );

    expect(summary.students).toBe(1);
    expect(materialize).toHaveBeenCalledTimes(1);
    expect(materialize).toHaveBeenCalledWith(
      "u2",
      expect.anything(),
      "LMS",
      NOW,
      expect.anything(),
    );
    expect(lmsBlocks).toHaveBeenCalledWith([20001], WINDOW);
  });

  it("never retires anything — a wrong retirement could not be undone", async () => {
    const { service, retireExternalKeys } = await makeFanout({
      courseEnrollments: [
        {
          userId: "u2",
          lmsCourseId: 20001,
          droppedAt: null,
          seenFingerprint: OLD_VIEW,
        },
      ],
    });

    await service.fanOutLms([{ unitId: 20001, before: OLD_VIEW }], {
      excludeUserId: "walker",
      window: WINDOW,
      now: NOW,
    });

    expect(retireExternalKeys).not.toHaveBeenCalled();
  });

  it("skips a dropped enrolment", async () => {
    const { service, materialize } = await makeFanout({
      courseEnrollments: [
        {
          userId: "u2",
          lmsCourseId: 20001,
          droppedAt: NOW,
          seenFingerprint: OLD_VIEW,
        },
      ],
    });
    await service.fanOutLms([{ unitId: 20001, before: OLD_VIEW }], {
      excludeUserId: "walker",
      window: WINDOW,
      now: NOW,
    });
    expect(materialize).not.toHaveBeenCalled();
  });

  it("does nothing without a corroborated transition", async () => {
    const { service, materialize } = await makeFanout();
    await expect(
      service.fanOutLms([], {
        excludeUserId: "walker",
        window: WINDOW,
        now: NOW,
      }),
    ).resolves.toMatchObject({ students: 0 });
    expect(materialize).not.toHaveBeenCalled();
  });
});
