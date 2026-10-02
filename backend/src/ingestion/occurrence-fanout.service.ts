import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { SyncDigest } from "./core/sync-digest";
import type { ParsedBlock } from "./core/types";
import { MaterializerService } from "./materializer.service";
import {
  OccurrenceCacheService,
  type UnitTransition,
} from "./occurrence-cache.service";

/**
 * Pushes a cached change out to every classmate (issue #56).
 *
 * When a walk discovers that a section's room moved, the students who share that
 * section have the same stale row on their calendars — and no reason to
 * re-fetch. This service takes the sections a walk just touched, finds everyone
 * **confirmed** in them, and updates their calendars with **zero upstream
 * requests**.
 *
 * ## Why it goes through `MaterializerService`
 *
 * It would be shorter to write an `updateMany` over the affected sessions. That
 * would be wrong, and the wrongness would be invisible until a student
 * complained: `materialize` is where "the student moved this, so their time
 * wins" (`lastMovedAt`), "the student deleted this, so never recreate it"
 * (`deleted`), the `[userId, externalKey]` idempotency guard and the
 * one-notification-per-type digest all live. A fan-out that bypassed it would
 * silently clobber every hand-moved lecture in the cohort — which is exactly the
 * thing issue #56 lists as an acceptance criterion. **Do not replace this with a
 * bulk write.**
 *
 * ## Fan-out direction and its bound
 *
 * `PortalSectionEnrollment` is indexed `[scheduleStudyUnitId, droppedAt]`
 * precisely for the reverse lookup here. A shared elective can carry ~19
 * students in the fixture set and more in reality, so the set is capped by
 * `INGESTION_FANOUT_MAX_STUDENTS` with a warning rather than silently truncated —
 * one tick must not turn into a thousand writes.
 *
 * Fan-out only ever reads occurrences for sections in a student's **own**
 * confirmed set, which is what makes "no student's schedule is ever inferred by
 * copying another student's" true by construction rather than by care.
 */

/** What one fan-out did. */
export interface FanoutSummary {
  /** Students whose calendars were visited. */
  students: number;
  created: number;
  updated: number;
  /** Kept as the student had moved them. */
  skippedMoved: number;
  /** Not recreated, because the student had deleted them. */
  skippedDeleted: number;
  /** Retired because upstream cancelled the activity. */
  removed: number;
}

const EMPTY: FanoutSummary = {
  students: 0,
  created: 0,
  updated: 0,
  skippedMoved: 0,
  skippedDeleted: 0,
  removed: 0,
};

@Injectable()
export class OccurrenceFanoutService {
  private readonly logger = new Logger(OccurrenceFanoutService.name);
  private readonly maxStudents: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly cache: OccurrenceCacheService,
    private readonly materializer: MaterializerService,
  ) {
    const raw = Number(this.config.get("INGESTION_FANOUT_MAX_STUDENTS"));
    this.maxStudents = Number.isFinite(raw) && raw > 0 ? raw : 200;
  }

  /**
   * Fan a portal timetable change out to the classmates of `sectionIds`.
   *
   * `excludeUserId` is the student whose walk produced the change — their own
   * rows were already written by that walk, so visiting them again would be pure
   * work for no change.
   */
  async fanOutTimetable(
    sectionIds: readonly string[],
    canceledKeys: readonly string[],
    opts: {
      excludeUserId: string;
      window: { from: Date; to: Date };
      now: Date;
    },
  ): Promise<FanoutSummary> {
    if (sectionIds.length === 0 && canceledKeys.length === 0) return EMPTY;

    const students = await this.classmates(sectionIds, opts.excludeUserId);
    if (students.length === 0) return EMPTY;

    const summary: FanoutSummary = { ...EMPTY, students: students.length };

    for (const userId of students) {
      // One digest per student: `SyncDigest`/`flushDigest` are per-user by
      // construction, so a section-wide change produces one notification per
      // affected student rather than one global one.
      const digest = new SyncDigest(new Date());

      // Only this student's own confirmed sections — never the whole touched set.
      const theirs = await this.theirSections(userId, sectionIds);
      if (theirs.length > 0) {
        const blocks = await this.cache.timetableBlocks(theirs, opts.window);
        const outcome = await this.materializer.materialize(
          userId,
          blocks,
          "PORTAL",
          opts.now,
          digest,
        );
        summary.created += outcome.created;
        summary.updated += outcome.updated;
        summary.skippedMoved += outcome.skippedMoved;
        summary.skippedDeleted += outcome.skippedDeleted;
      }

      if (canceledKeys.length > 0) {
        const recon = await this.materializer.retireExternalKeys(
          userId,
          "PORTAL",
          canceledKeys,
          opts.now,
          digest,
        );
        summary.removed += recon.deleted;
      }

      await this.materializer.flushDigest(userId, digest, opts.now);
    }

    if (summary.created + summary.updated + summary.removed > 0) {
      this.logger.log(
        `Timetable fan-out to ${summary.students} classmate(s): ` +
          `${summary.created} new, ${summary.updated} updated, ` +
          `${summary.removed} removed, ` +
          `${summary.skippedMoved} kept (student-moved)`,
      );
    }
    return summary;
  }

  /**
   * Fan corroborated Moodle changes out to the classmates they plausibly apply
   * to.
   *
   * An activity's view is not assumed to be the course's, so this only runs for a
   * transition two different students independently observed (`observeUnit`),
   * and only reaches the classmates whose own last view was exactly that
   * transition's `before`. That is where a per-user due-date extension would
   * otherwise leak to a whole course; it cannot, because one student's private
   * change is never corroborated by a second.
   *
   * Three deliberate omissions. It never creates rows: whether a student can
   * see an activity is decided by Moodle (group restrictions), not by course
   * enrolment, so it only updates activities already on their calendar. It
   * never retires rows: a wrongly retired session
   * is soft-deleted and so never re-created, a permanent loss, whereas a missed
   * removal is corrected by the student's own next walk. And it never touches a
   * recipient's seen fingerprint, so their next pass no longer matches the
   * cache and walks live — every fanned-out change is re-verified against what
   * that student actually sees.
   */
  async fanOutLms(
    transitions: readonly UnitTransition<number>[],
    opts: {
      excludeUserId: string;
      window: { from: Date; to: Date };
      now: Date;
    },
  ): Promise<FanoutSummary> {
    if (transitions.length === 0) return EMPTY;

    const recipients = new Map<string, number[]>();
    for (const { unitId, before } of transitions) {
      const rows = await this.prisma.lmsCourseEnrollment.findMany({
        where: {
          lmsCourseId: unitId,
          droppedAt: null,
          seenFingerprint: before,
          userId: { not: opts.excludeUserId },
        },
        select: { userId: true },
        take: this.maxStudents,
      });
      for (const { userId } of rows) {
        recipients.set(userId, [...(recipients.get(userId) ?? []), unitId]);
      }
    }

    return this.pushTo(recipients, "LMS", opts.now, async (units, userId) => {
      const blocks = await this.cache.lmsBlocks(units, opts.window);
      // Update-only. Course enrolment and a matching fingerprint say nothing
      // about whether *this* student can see an activity (group-restricted
      // content), so a fan-out never creates one — it only follows changes to
      // activities the student's own walk already put on their calendar. A new
      // activity reaches them on their next pass, which no longer matches the
      // cache and walks live.
      const owned = await this.prisma.session.findMany({
        where: {
          userId,
          source: "LMS",
          externalKey: { in: blocks.map((b) => b.externalKey) },
        },
        select: { externalKey: true },
      });
      const keys = new Set(owned.map((r) => r.externalKey));
      return blocks.filter((b) => keys.has(b.externalKey));
    });
  }

  /**
   * Materialize each recipient's own units from cache, one digest per student.
   * Creates and updates only — see {@link fanOutLms} for why never removals.
   */
  private async pushTo<T>(
    recipients: ReadonlyMap<string, T[]>,
    source: "PORTAL" | "LMS",
    now: Date,
    blocksFor: (units: T[], userId: string) => Promise<ParsedBlock[]>,
  ): Promise<FanoutSummary> {
    if (recipients.size === 0) return EMPTY;
    const summary: FanoutSummary = { ...EMPTY, students: recipients.size };
    for (const [userId, units] of recipients) {
      const digest = new SyncDigest(new Date());
      const outcome = await this.materializer.materialize(
        userId,
        await blocksFor(units, userId),
        source,
        now,
        digest,
      );
      summary.created += outcome.created;
      summary.updated += outcome.updated;
      summary.skippedMoved += outcome.skippedMoved;
      summary.skippedDeleted += outcome.skippedDeleted;
      await this.materializer.flushDigest(userId, digest, now);
    }
    if (summary.created + summary.updated > 0) {
      this.logger.log(
        `${source} fan-out to ${summary.students} classmate(s): ` +
          `${summary.created} new, ${summary.updated} updated, ` +
          `${summary.skippedMoved} kept (student-moved)`,
      );
    }
    return summary;
  }

  /**
   * Everyone confirmed in any of `sectionIds`, minus the walker.
   *
   * Capped, with a warning when the cap bites: silently truncating would make a
   * partial fan-out look like a complete one, and "some classmates got the room
   * change" is worse to debug than "the cap is too low".
   */
  private async classmates(
    sectionIds: readonly string[],
    excludeUserId: string,
  ): Promise<string[]> {
    if (sectionIds.length === 0) return [];
    const rows = await this.prisma.portalSectionEnrollment.findMany({
      where: {
        scheduleStudyUnitId: { in: [...sectionIds] },
        droppedAt: null,
        userId: { not: excludeUserId },
      },
      select: { userId: true },
      distinct: ["userId"],
      take: this.maxStudents + 1,
    });
    if (rows.length > this.maxStudents) {
      this.logger.warn(
        `Fan-out for ${sectionIds.length} section(s) hit the ` +
          `${this.maxStudents}-student cap; the remainder will pick the change ` +
          `up on their own next pass`,
      );
    }
    return rows.slice(0, this.maxStudents).map((r) => r.userId);
  }

  /** The subset of `sectionIds` this student is themselves confirmed in. */
  private async theirSections(
    userId: string,
    sectionIds: readonly string[],
  ): Promise<string[]> {
    const rows = await this.prisma.portalSectionEnrollment.findMany({
      where: {
        userId,
        scheduleStudyUnitId: { in: [...sectionIds] },
        droppedAt: null,
      },
      select: { scheduleStudyUnitId: true },
    });
    return rows.map((r) => r.scheduleStudyUnitId);
  }
}
