import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { PrismaService } from "../prisma/prisma.service";
import type { LmsOccurrenceInput } from "./core/occurrences";
import {
  OccurrenceCacheService,
  type LmsWindow,
} from "./occurrence-cache.service";

/**
 * The Moodle divergence guard end to end (issue #56): several students recording
 * their own views through the real service, over an in-memory Prisma double,
 * and asking who may then be served from cache. The pure state machine has its
 * own tests in `core/occurrences.spec.ts`; these prove the service wires the
 * seen fingerprints, the cancellation and the coverage stamps around it.
 */

// ── a tiny in-memory Prisma double ─────────────────────────────────────────
//
// Just enough of Prisma's `where` language for this service: equality, `null`,
// `{ in }`, `{ notIn }` and `{ gte, lte }`.

type Row = Record<string, unknown>;

function fieldMatches(value: unknown, filter: unknown): boolean {
  if (filter === undefined) return true;
  if (filter === null) return value === null || value === undefined;
  if (filter instanceof Date) {
    return value instanceof Date && value.getTime() === filter.getTime();
  }
  if (typeof filter === "object") {
    const f = filter as Record<string, unknown>;
    if ("in" in f && !(f.in as unknown[]).includes(value)) return false;
    if ("notIn" in f && (f.notIn as unknown[]).includes(value)) return false;
    if ("not" in f && value === f.not) return false;
    const t = value instanceof Date ? value.getTime() : NaN;
    if ("gte" in f && !(t >= (f.gte as Date).getTime())) return false;
    if ("lte" in f && !(t <= (f.lte as Date).getTime())) return false;
    return true;
  }
  return value === filter;
}

function whereMatches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, f]) => fieldMatches(row[k], f));
}

function table(rows: Row[], uniqueKey: (where: Row) => (row: Row) => boolean) {
  let seq = 0;
  return {
    rows,
    findMany: ({ where }: { where?: Row } = {}) =>
      Promise.resolve(rows.filter((r) => whereMatches(r, where))),
    findUnique: ({ where }: { where: Row }) =>
      Promise.resolve(rows.find(uniqueKey(where)) ?? null),
    create: ({ data }: { data: Row }) => {
      const row = { id: `r${++seq}`, canceledAt: null, ...data };
      rows.push(row);
      return Promise.resolve(row);
    },
    update: ({ where, data }: { where: Row; data: Row }) => {
      const row = rows.find(uniqueKey(where));
      if (!row) throw new Error(`no row for ${JSON.stringify(where)}`);
      Object.assign(row, data);
      return Promise.resolve(row);
    },
    updateMany: ({ where, data }: { where: Row; data: Row }) => {
      const hit = rows.filter((r) => whereMatches(r, where));
      for (const r of hit) Object.assign(r, data);
      return Promise.resolve({ count: hit.length });
    },
    upsert: ({
      where,
      create,
      update,
    }: {
      where: Row;
      create: Row;
      update: Row;
    }) => {
      const row = rows.find(uniqueKey(where));
      if (row) Object.assign(row, update);
      else rows.push({ ...create });
      return Promise.resolve(row ?? create);
    },
  };
}

const byId = (where: Row) => (row: Row) => row.id === where.id;

function makeDb() {
  return {
    lmsCourse: table([], (w) => (r) => r.lmsCourseId === w.lmsCourseId),
    lmsCourseEnrollment: table([], byId),
    portalSection: table(
      [],
      (w) => (r) => r.scheduleStudyUnitId === w.scheduleStudyUnitId,
    ),
    portalSectionOccurrence: table([], (w) => {
      const k = w.scheduleStudyUnitId_meetingDate_periodId as Row | undefined;
      return k
        ? (r) =>
            r.scheduleStudyUnitId === k.scheduleStudyUnitId &&
            r.meetingDate === k.meetingDate &&
            r.periodId === k.periodId
        : byId(w);
    }),
    lmsCourseOccurrence: table([], (w) =>
      "externalKey" in w ? (r) => r.externalKey === w.externalKey : byId(w),
    ),
  };
}

async function makeCache() {
  const db = makeDb();
  const module = await Test.createTestingModule({
    providers: [
      OccurrenceCacheService,
      { provide: PrismaService, useValue: db },
      { provide: ConfigService, useValue: { get: () => undefined } },
    ],
  }).compile();
  return { db, cache: module.get(OccurrenceCacheService) };
}

// ── fixtures (deliberately fictional) ──────────────────────────────────────

const NOW = new Date("2026-10-26T03:00:00.000Z");
const LATER = new Date(NOW.getTime() + 10 * 60_000);

describe("OccurrenceCacheService — the Moodle divergence guard", () => {
  const COURSE = 90001;
  const WINDOW: LmsWindow = {
    from: new Date("2026-09-30T17:00:00.000Z"),
    to: new Date("2026-11-30T16:59:59.999Z"),
    scope: "lms:2026-10,2026-11",
  };

  function assign(over: Partial<LmsOccurrenceInput> = {}): LmsOccurrenceInput {
    return {
      lmsCourseId: COURSE,
      externalKey: "lms:assign:520001",
      type: "ASSIGNMENT",
      startsAt: new Date("2026-10-20T16:45:00.000Z"),
      durationMinutes: 15,
      title: "Bài tập 1",
      note: null,
      location: null,
      ...over,
    };
  }

  function enrolInCourse(db: ReturnType<typeof makeDb>, users: string[]) {
    db.lmsCourse.rows.push({
      lmsCourseId: COURSE,
      fullName: "Môn học Mẫu Một",
      shortName: "MHM1",
      occurrencesRefreshedAt: null,
      occurrencesThroughDate: null,
      occurrencesFingerprint: null,
      occurrencesFingerprintBy: null,
      occurrencesPriorFingerprint: null,
    });
    for (const u of users) {
      db.lmsCourseEnrollment.rows.push({
        id: `${u}:${COURSE}`,
        userId: u,
        lmsCourseId: COURSE,
        droppedAt: null,
        seenFingerprint: null,
      });
    }
  }

  const record = (
    cache: OccurrenceCacheService,
    userId: string,
    view: LmsOccurrenceInput[],
    now = NOW,
  ) =>
    cache.recordLmsItems(view, {
      now,
      complete: true,
      userId,
      window: WINDOW,
      courseIds: [COURSE],
      cacheable: true,
    });

  const servableLms = async (
    cache: OccurrenceCacheService,
    userId: string,
    window: LmsWindow = WINDOW,
  ) =>
    (
      await cache.lmsFreshness(userId, [COURSE], {
        now: LATER,
        window,
      })
    ).stale.length === 0;

  it("never hands one student's extension to a classmate", async () => {
    // "b" alone has the due date pushed back a week.
    const { db, cache } = await makeCache();
    enrolInCourse(db, ["a", "b"]);
    const extended = assign({ startsAt: new Date("2026-10-27T16:45:00.000Z") });

    await record(cache, "a", [assign()]);
    await record(cache, "b", [assign()]);
    const outcome = await record(cache, "b", [extended], LATER);

    // Not corroborated, so nothing to fan out…
    expect(outcome.transitions).toEqual([]);
    // …and "a" is not served the rows "b" just wrote: they walk.
    expect(await servableLms(cache, "a")).toBe(false);
  });

  it("serves a course a student has seen, window and all", async () => {
    const { db, cache } = await makeCache();
    enrolInCourse(db, ["a"]);

    await record(cache, "a", [assign()]);

    expect(await servableLms(cache, "a")).toBe(true);
    // A different window is a different view, even with identical rows.
    expect(
      await servableLms(cache, "a", {
        ...WINDOW,
        scope: "lms:2026-11,2026-12",
        to: new Date("2026-12-31T16:59:59.999Z"),
      }),
    ).toBe(false);
  });

  it("ignores activities outside the window it is scoped to", async () => {
    // A September row left over from an earlier walk must not make October's
    // view look different.
    const { db, cache } = await makeCache();
    enrolInCourse(db, ["a"]);
    const september = assign({
      externalKey: "lms:assign:510000",
      startsAt: new Date("2026-09-10T16:45:00.000Z"),
    });

    await record(cache, "a", [september, assign()]);

    expect(await servableLms(cache, "a")).toBe(true);
    expect(
      db.lmsCourseOccurrence.rows.find(
        (r) => r.externalKey === "lms:assign:510000",
      )?.canceledAt,
    ).toBeNull();
  });

  it("retires an in-window activity the next complete view no longer lists", async () => {
    const { db, cache } = await makeCache();
    enrolInCourse(db, ["a"]);
    const quiz = assign({ externalKey: "lms:quiz:530001", type: "EXAM" });

    await record(cache, "a", [assign(), quiz]);
    const outcome = await record(cache, "a", [assign()], LATER);

    expect(outcome.canceledKeys).toEqual(["lms:quiz:530001"]);
    expect(await servableLms(cache, "a")).toBe(true);
  });
});

describe("OccurrenceCacheService — timetable cancellation", () => {
  const SECTION = "SEC-1";
  const meeting = {
    scheduleStudyUnitId: SECTION,
    meetingDate: "2026-10-27",
    periodId: 3,
    isoWeek: 44,
    yearStudy: "2026-2027",
    termId: "1",
    numberOfPeriods: 3,
    startsAt: new Date("2026-10-27T01:00:00.000Z"),
    durationMinutes: 150,
    title: "Giải tích",
    roomId: "A1",
    teacherName: "T",
  } as never;

  it("cancels the last meeting of a section whose week came back empty", async () => {
    const { db, cache } = await makeCache();
    await cache.recordTimetableWeek([meeting], {
      isoWeek: 44,
      now: NOW,
      complete: true,
      throughDate: LATER,
      sectionIds: [SECTION],
    });

    // Week 44 now lists nothing at all for the section.
    const outcome = await cache.recordTimetableWeek([], {
      isoWeek: 44,
      now: LATER,
      complete: true,
      throughDate: LATER,
      sectionIds: [SECTION],
    });

    expect(outcome.canceledKeys).toHaveLength(1);
    expect(db.portalSectionOccurrence.rows[0].canceledAt).toEqual(LATER);
    // So fan-out can find the classmates even though nothing else changed.
    expect(outcome.touchedIds).toEqual([SECTION]);
  });

  it("keeps the meeting when the week is not known to be complete", async () => {
    const { cache } = await makeCache();
    await cache.recordTimetableWeek([meeting], {
      isoWeek: 44,
      now: NOW,
      complete: true,
      throughDate: LATER,
      sectionIds: [SECTION],
    });
    const outcome = await cache.recordTimetableWeek([], {
      isoWeek: 44,
      now: LATER,
      complete: false,
      throughDate: LATER,
      sectionIds: [SECTION],
    });
    expect(outcome.canceledKeys).toEqual([]);
  });
});

describe("OccurrenceCacheService — lmsKeysOutside", () => {
  it("returns live cached activities from courses outside the confirmed set", async () => {
    const { db, cache } = await makeCache();
    const at = new Date("2026-10-30T00:00:00.000Z");
    db.lmsCourseOccurrence.rows.push(
      {
        id: "a",
        lmsCourseId: 1,
        externalKey: "in",
        startsAt: at,
        canceledAt: null,
      },
      {
        id: "b",
        lmsCourseId: 2,
        externalKey: "out",
        startsAt: at,
        canceledAt: null,
      },
      {
        id: "c",
        lmsCourseId: 2,
        externalKey: "gone",
        startsAt: at,
        canceledAt: NOW,
      },
    );
    await expect(
      cache.lmsKeysOutside([1], {
        from: new Date("2026-10-01T00:00:00.000Z"),
        to: new Date("2026-11-30T00:00:00.000Z"),
      }),
    ).resolves.toEqual(["out"]);
  });
});
