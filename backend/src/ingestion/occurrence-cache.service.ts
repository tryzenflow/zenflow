import { ConfigService } from "@nestjs/config";
import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { portalLectureKey } from "./core/external-key";
import {
  blocksFromLmsOccurrences,
  blocksFromPortalOccurrences,
  isCoverageFresh,
  lmsFingerprint,
  lmsOccurrenceChanged,
  observeUnit,
  portalOccurrenceChanged,
  type LmsOccurrenceInput,
  type PortalOccurrenceInput,
} from "./core/occurrences";
import type { ParsedLmsItem, ParsedPortalItem } from "./core/types";

/**
 * The cross-student occurrence cache (issue #56).
 *
 * ## What it is for
 *
 * Every student in a section re-fetched the same term-scoped data. A measured
 * 150-student run issued 6,395 upstream requests against 21 distinct resources —
 * ~305x redundancy. This service holds each real, dated activity **once**, keyed
 * by the section or course rather than by the student, so whichever student a
 * tick happens to claim first warms the data for all of their classmates.
 *
 * ## The shape of the saving, stated honestly
 *
 * There is no per-section endpoint. `DrawingStudentSchedules` is addressed by
 * *student and week*; Moodle's monthly calendar is called with `courseid: 1`,
 * meaning "everything this user can see". So the cache can only ever be *filled*
 * by some student's whole walk, and it pays off **cohort-wise, not
 * section-wise**: one stale section forces that student's entire ~20-week walk,
 * which then warms every section they attend for everyone else in them. At the
 * fixture set's density (9-12 students per department core, up to 19 per
 * elective) the first student claimed walks and the rest read
 * the cache.
 *
 * ## Lectures are shared; Moodle activities are guarded
 *
 * A lecture meeting is the section's, so any student's walk speaks for every
 * classmate. A Moodle activity is shared by *key* but not necessarily by content
 * or visibility — per-user and per-group due-date overrides, group-restricted
 * activities. So {@link recordLmsItems} records each walker's view as a
 * fingerprint on their own enrolment row, and {@link lmsFreshness} serves a
 * student only while the cached rows still match *their own* last view. Fan-out
 * needs two students to have independently observed the same change. See
 * `observeUnit`.
 *
 * ## What it deliberately does not do
 *
 * It never writes a `Session`. Turning a cached occurrence into a student's
 * calendar row is `OccurrenceFanoutService`'s job, and it does it by handing
 * blocks to the same `MaterializerService.materialize` a live walk uses — so the
 * student-deleted rule, the `lastMovedAt` precedence, the `[userId,
 * externalKey]` idempotency and the notification digest are all inherited rather
 * than reimplemented.
 */

/** What one `record*` call changed. */
export interface RecordOutcome {
  created: number;
  /** Occurrences whose student-visible content differs from what was stored. */
  changed: number;
  unchanged: number;
  /** `externalKey`s a complete re-read no longer listed — cancelled activities. */
  canceledKeys: string[];
  /** Sections/courses with at least one created or changed occurrence. */
  touchedIds: string[];
}

const EMPTY_OUTCOME: RecordOutcome = {
  created: 0,
  changed: 0,
  unchanged: 0,
  canceledKeys: [],
  touchedIds: [],
};

/**
 * A unit whose change two different students have independently observed —
 * the only kind of LMS change that is fanned out. `before` is the view the
 * change moved away from; only classmates whose own last view was exactly that
 * receive it.
 */
export interface UnitTransition<T> {
  unitId: T;
  before: string;
}

/** {@link RecordOutcome} plus the corroborated transitions to fan out. */
export interface GuardedRecordOutcome<T> extends RecordOutcome {
  transitions: UnitTransition<T>[];
}

/**
 * The months one Moodle walk covered: `from`/`to` bound the instants, `scope`
 * names them so views of different windows never fingerprint equal.
 */
export interface LmsWindow {
  from: Date;
  to: Date;
  scope: string;
}

/** Which sections/courses may be served from cache, and which may not. */
export interface Freshness<T> {
  fresh: T[];
  stale: T[];
}

function withinWindow(at: Date, window: { from: Date; to: Date }): boolean {
  return (
    at.getTime() >= window.from.getTime() && at.getTime() <= window.to.getTime()
  );
}

@Injectable()
export class OccurrenceCacheService {
  private readonly logger = new Logger(OccurrenceCacheService.name);

  private readonly ttlMs: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    // One TTL for timetable and Moodle alike: past it, one student's live walk
    // refreshes the section/course and populates every classmate.
    const ttl = Number(config.get<number | string>("INGESTION_CACHE_TTL_MS"));
    this.ttlMs = Number.isFinite(ttl) && ttl > 0 ? ttl : 7 * 24 * 60 * 60_000;
  }

  // ── recording what a walk found ──────────────────────────────────────────

  /**
   * Store one week of one section's meetings, and stamp the section's coverage.
   *
   * `complete` must be false if **any** week of the walk failed. It gates the
   * cancellation pass for the same reason `allFetchesOk` gates
   * `reconcileDeleted`: a 503 on one week must not be read as "every class that
   * week was cancelled" — except here the mistake would fan out to every student
   * in the section, not just the one who fetched.
   */
  async recordTimetableWeek(
    occurrences: readonly PortalOccurrenceInput[],
    opts: { isoWeek: number; now: Date; complete: boolean; throughDate: Date },
  ): Promise<RecordOutcome> {
    const outcome: RecordOutcome = {
      ...EMPTY_OUTCOME,
      canceledKeys: [],
      touchedIds: [],
    };
    const touched = new Set<string>();

    for (const row of occurrences) {
      const existing = await this.prisma.portalSectionOccurrence.findUnique({
        where: {
          scheduleStudyUnitId_meetingDate_periodId: {
            scheduleStudyUnitId: row.scheduleStudyUnitId,
            meetingDate: row.meetingDate,
            periodId: row.periodId,
          },
        },
        select: {
          id: true,
          startsAt: true,
          durationMinutes: true,
          title: true,
          roomId: true,
          teacherName: true,
        },
      });

      const content = {
        numberOfPeriods: row.numberOfPeriods,
        isoWeek: row.isoWeek,
        yearStudy: row.yearStudy,
        termId: row.termId,
        startsAt: row.startsAt,
        durationMinutes: row.durationMinutes,
        title: row.title,
        roomId: row.roomId,
        teacherName: row.teacherName,
      };

      if (!existing) {
        await this.prisma.portalSectionOccurrence.create({
          data: {
            scheduleStudyUnitId: row.scheduleStudyUnitId,
            meetingDate: row.meetingDate,
            periodId: row.periodId,
            ...content,
            firstSeenAt: opts.now,
            lastSeenAt: opts.now,
          },
        });
        outcome.created += 1;
        touched.add(row.scheduleStudyUnitId);
        continue;
      }

      const changed = portalOccurrenceChanged(existing, row);
      await this.prisma.portalSectionOccurrence.update({
        where: { id: existing.id },
        data: {
          ...content,
          lastSeenAt: opts.now,
          // A re-listed meeting is the same meeting, not a new one.
          canceledAt: null,
        },
      });
      if (changed) {
        outcome.changed += 1;
        touched.add(row.scheduleStudyUnitId);
      } else {
        outcome.unchanged += 1;
      }
    }

    if (opts.complete) {
      outcome.canceledKeys = await this.cancelUnseenMeetings(
        occurrences,
        opts.isoWeek,
        opts.now,
      );
      await this.stampSectionCoverage(
        occurrences.map((o) => o.scheduleStudyUnitId),
        {
          timetableRefreshedAt: opts.now,
          timetableThroughDate: opts.throughDate,
        },
      );
    }

    outcome.touchedIds = [...touched];
    return outcome;
  }

  /**
   * Retire meetings of the sections we just read that this week's response no
   * longer lists, and return their `externalKey`s so fan-out can remove them
   * from every affected student's calendar.
   *
   * Scoped to `(section, isoWeek)`: only the weeks actually re-read are
   * candidates, so a walk that covers weeks 44-50 cannot retire week 51.
   */
  private async cancelUnseenMeetings(
    occurrences: readonly PortalOccurrenceInput[],
    isoWeek: number,
    now: Date,
  ): Promise<string[]> {
    const sectionIds = [
      ...new Set(occurrences.map((o) => o.scheduleStudyUnitId)),
    ];
    if (sectionIds.length === 0) return [];

    const seen = new Set(
      occurrences.map(
        (o) => `${o.scheduleStudyUnitId}|${o.meetingDate}|${o.periodId}`,
      ),
    );
    const candidates = await this.prisma.portalSectionOccurrence.findMany({
      where: {
        scheduleStudyUnitId: { in: sectionIds },
        isoWeek,
        canceledAt: null,
      },
      select: {
        id: true,
        scheduleStudyUnitId: true,
        meetingDate: true,
        periodId: true,
      },
    });

    const gone = candidates.filter(
      (row) =>
        !seen.has(
          `${row.scheduleStudyUnitId}|${row.meetingDate}|${row.periodId}`,
        ),
    );
    if (gone.length === 0) return [];

    await this.prisma.portalSectionOccurrence.updateMany({
      where: { id: { in: gone.map((row) => row.id) } },
      data: { canceledAt: now },
    });

    return gone.map((row) =>
      portalLectureKey({
        scheduleStudyUnitId: row.scheduleStudyUnitId,
        meetingDate: row.meetingDate,
        periodId: row.periodId,
      }),
    );
  }

  /**
   * Store one student's view of their Moodle courses under the divergence
   * guard, scoped to the fetched `window`
   * because a monthly calendar only speaks for the months it covered.
   *
   * `courseIds` is every course this walk speaks for (the items' plus the
   * student's confirmed ones), so a quiet course is recorded as a real, empty
   * view rather than never being covered.
   */
  async recordLmsItems(
    occurrences: readonly LmsOccurrenceInput[],
    opts: {
      now: Date;
      complete: boolean;
      userId: string;
      window: LmsWindow;
      courseIds: readonly number[];
      cacheable: boolean;
    },
  ): Promise<GuardedRecordOutcome<number>> {
    const outcome: GuardedRecordOutcome<number> = {
      ...EMPTY_OUTCOME,
      canceledKeys: [],
      touchedIds: [],
      transitions: [],
    };
    const touched = new Set<string>();

    for (const row of occurrences) {
      const existing = await this.prisma.lmsCourseOccurrence.findUnique({
        where: { externalKey: row.externalKey },
        select: {
          id: true,
          startsAt: true,
          durationMinutes: true,
          title: true,
          note: true,
          location: true,
        },
      });
      const content = {
        lmsCourseId: row.lmsCourseId,
        type: row.type,
        startsAt: row.startsAt,
        durationMinutes: row.durationMinutes,
        title: row.title,
        note: row.note,
        location: row.location,
      };

      if (!existing) {
        await this.prisma.lmsCourseOccurrence.create({
          data: {
            externalKey: row.externalKey,
            ...content,
            firstSeenAt: opts.now,
            lastSeenAt: opts.now,
          },
        });
        outcome.created += 1;
        touched.add(String(row.lmsCourseId));
        continue;
      }

      const changed = lmsOccurrenceChanged(existing, row);
      await this.prisma.lmsCourseOccurrence.update({
        where: { id: existing.id },
        data: { ...content, lastSeenAt: opts.now, canceledAt: null },
      });
      if (changed) {
        outcome.changed += 1;
        touched.add(String(row.lmsCourseId));
      } else {
        outcome.unchanged += 1;
      }
    }

    if (opts.complete) {
      const { window } = opts;
      const inWindow = occurrences.filter((o) =>
        withinWindow(o.startsAt, window),
      );
      const units = new Set([
        ...opts.courseIds,
        ...occurrences.map((o) => o.lmsCourseId),
      ]);
      const existing = await this.prisma.lmsCourse.findMany({
        where: { lmsCourseId: { in: [...units] } },
        select: {
          lmsCourseId: true,
          occurrencesFingerprint: true,
          occurrencesFingerprintBy: true,
          occurrencesPriorFingerprint: true,
        },
      });
      const seen = await this.prisma.lmsCourseEnrollment.findMany({
        where: { userId: opts.userId, lmsCourseId: { in: [...units] } },
        select: { lmsCourseId: true, seenFingerprint: true },
      });
      const seenBy = new Map(
        seen.map((s) => [s.lmsCourseId, s.seenFingerprint]),
      );

      for (const course of existing) {
        const id = course.lmsCourseId;
        const view = inWindow.filter((o) => o.lmsCourseId === id);
        outcome.canceledKeys.push(
          ...(await this.cancelUnseenLms(id, view, window, opts.now)),
        );

        const after = lmsFingerprint(window.scope, view);
        const before = seenBy.get(id) ?? null;
        const { next, corroborated } = observeUnit(
          {
            fingerprint: course.occurrencesFingerprint,
            by: course.occurrencesFingerprintBy,
            prior: course.occurrencesPriorFingerprint,
          },
          { userId: opts.userId, before, after },
        );
        await this.prisma.lmsCourse.update({
          where: { lmsCourseId: id },
          data: {
            occurrencesRefreshedAt: opts.now,
            occurrencesThroughDate: window.to,
            occurrencesFingerprint: next.fingerprint,
            occurrencesFingerprintBy: next.by,
            occurrencesPriorFingerprint: next.prior,
          },
        });
        if (corroborated && before !== null) {
          outcome.transitions.push({ unitId: id, before });
        }
        await this.prisma.lmsCourseEnrollment.updateMany({
          where: { userId: opts.userId, lmsCourseId: id },
          data: { seenFingerprint: opts.cacheable ? after : null },
        });
      }
    }

    outcome.touchedIds = [...touched];
    return outcome;
  }

  /** Retire a course's in-window activities this complete view no longer lists. */
  private async cancelUnseenLms(
    lmsCourseId: number,
    view: readonly LmsOccurrenceInput[],
    window: LmsWindow,
    now: Date,
  ): Promise<string[]> {
    const gone = await this.prisma.lmsCourseOccurrence.findMany({
      where: {
        lmsCourseId,
        canceledAt: null,
        startsAt: { gte: window.from, lte: window.to },
        externalKey: { notIn: view.map((o) => o.externalKey) },
      },
      select: { id: true, externalKey: true },
    });
    if (gone.length === 0) return [];
    await this.prisma.lmsCourseOccurrence.updateMany({
      where: { id: { in: gone.map((g) => g.id) } },
      data: { canceledAt: now },
    });
    return gone.map((g) => g.externalKey);
  }

  /** Stamp cache coverage onto the catalog rows a walk just refreshed. */
  private async stampSectionCoverage(
    sectionIds: readonly string[],
    data: {
      timetableRefreshedAt?: Date;
      timetableThroughDate?: Date;
    },
  ): Promise<void> {
    const ids = [...new Set(sectionIds)];
    if (ids.length === 0) return;
    await this.prisma.portalSection.updateMany({
      where: { scheduleStudyUnitId: { in: ids } },
      data,
    });
  }

  // ── freshness ────────────────────────────────────────────────────────────

  /**
   * Split a student's confirmed sections into "may be served from cache" and
   * "must be walked".
   *
   * A section nobody has cached yet is **stale**, not fresh — which is how the
   * issue's "a newly-registered section no other cached student has is still
   * discovered" criterion holds by construction.
   */
  async timetableFreshness(
    sectionIds: readonly string[],
    opts: { now: Date; throughDate: Date },
  ): Promise<Freshness<string>> {
    if (sectionIds.length === 0) return { fresh: [], stale: [] };
    const rows = await this.prisma.portalSection.findMany({
      where: { scheduleStudyUnitId: { in: [...sectionIds] } },
      select: {
        scheduleStudyUnitId: true,
        timetableRefreshedAt: true,
        timetableThroughDate: true,
      },
    });
    const byId = new Map(rows.map((r) => [r.scheduleStudyUnitId, r]));

    const fresh: string[] = [];
    const stale: string[] = [];
    for (const id of sectionIds) {
      const row = byId.get(id);
      const ok =
        !!row &&
        isCoverageFresh(
          {
            refreshedAt: row.timetableRefreshedAt,
            throughDate: row.timetableThroughDate,
          },
          opts.now,
          this.ttlMs,
          opts.throughDate,
        );
      (ok ? fresh : stale).push(id);
    }
    return { fresh, stale };
  }

  /** Which of `userId`'s Moodle courses may be served from cache over `window`. */
  async lmsFreshness(
    userId: string,
    courseIds: readonly number[],
    opts: { now: Date; window: LmsWindow },
  ): Promise<Freshness<number>> {
    if (courseIds.length === 0) return { fresh: [], stale: [] };
    const ids = [...courseIds];
    const { window } = opts;
    const [courses, seen, rows] = await Promise.all([
      this.prisma.lmsCourse.findMany({
        where: { lmsCourseId: { in: ids } },
        select: {
          lmsCourseId: true,
          occurrencesRefreshedAt: true,
          occurrencesThroughDate: true,
        },
      }),
      this.prisma.lmsCourseEnrollment.findMany({
        where: { userId, lmsCourseId: { in: ids } },
        select: { lmsCourseId: true, seenFingerprint: true },
      }),
      this.prisma.lmsCourseOccurrence.findMany({
        where: {
          lmsCourseId: { in: ids },
          canceledAt: null,
          startsAt: { gte: window.from, lte: window.to },
        },
      }),
    ]);
    const byId = new Map(courses.map((c) => [c.lmsCourseId, c]));
    const seenBy = new Map(seen.map((s) => [s.lmsCourseId, s.seenFingerprint]));

    const fresh: number[] = [];
    const stale: number[] = [];
    for (const id of courseIds) {
      const course = byId.get(id);
      const mine = seenBy.get(id) ?? null;
      const ok =
        !!course &&
        isCoverageFresh(
          {
            refreshedAt: course.occurrencesRefreshedAt,
            throughDate: course.occurrencesThroughDate,
          },
          opts.now,
          this.ttlMs,
          window.to,
        ) &&
        mine !== null &&
        lmsFingerprint(
          window.scope,
          rows
            .filter((r) => r.lmsCourseId === id)
            .map((r) => ({
              ...r,
              // Narrowed by parse-lms.ts, which only ever emits these two.
              type: r.type as "ASSIGNMENT" | "EXAM",
            })),
        ) === mine;
      (ok ? fresh : stale).push(id);
    }
    return { fresh, stale };
  }

  // ── reading, for fan-out and for a cache-served pass ─────────────────────

  /**
   * The lecture blocks for `sectionIds` inside `window`.
   *
   * Cancelled occurrences are excluded: they are not part of anyone's calendar
   * any more, and the cancellation travels separately as a `canceledKeys` list
   * so it can be retired rather than silently omitted.
   */
  async timetableBlocks(
    sectionIds: readonly string[],
    window: { from: Date; to: Date },
  ): Promise<ParsedPortalItem[]> {
    if (sectionIds.length === 0) return [];
    const rows = await this.prisma.portalSectionOccurrence.findMany({
      where: {
        scheduleStudyUnitId: { in: [...sectionIds] },
        canceledAt: null,
        startsAt: { gte: window.from, lte: window.to },
      },
      orderBy: { startsAt: "asc" },
    });
    return blocksFromPortalOccurrences(rows);
  }

  /**
   * The LMS blocks for `courseIds` inside `window`.
   *
   * Loads the catalog rows too, because a course's `fullName` becomes a tag on
   * the session — a cache-served student would otherwise silently lose the tag a
   * walked student gets.
   */
  async lmsBlocks(
    courseIds: readonly number[],
    window: { from: Date; to: Date },
  ): Promise<ParsedLmsItem[]> {
    if (courseIds.length === 0) return [];
    const [rows, courses] = await Promise.all([
      this.prisma.lmsCourseOccurrence.findMany({
        where: {
          lmsCourseId: { in: [...courseIds] },
          canceledAt: null,
          startsAt: { gte: window.from, lte: window.to },
        },
        orderBy: { startsAt: "asc" },
      }),
      this.prisma.lmsCourse.findMany({
        where: { lmsCourseId: { in: [...courseIds] } },
        select: { lmsCourseId: true, fullName: true, shortName: true },
      }),
    ]);
    return blocksFromLmsOccurrences(
      rows.map((row) => ({
        lmsCourseId: row.lmsCourseId,
        externalKey: row.externalKey,
        // Narrowed by parse-lms.ts, which only ever emits these two.
        type: row.type as "ASSIGNMENT" | "EXAM",
        startsAt: row.startsAt,
        durationMinutes: row.durationMinutes,
        title: row.title,
        note: row.note,
        location: row.location,
      })),
      new Map(
        courses.map((c) => [
          c.lmsCourseId,
          { fullName: c.fullName, shortName: c.shortName },
        ]),
      ),
    );
  }
}
