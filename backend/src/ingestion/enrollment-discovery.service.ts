import { UpstreamUnavailableError } from "../common/outbound-breaker";
import { forwardRef, Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { IntegrationsService } from "../integrations/integrations.service";
import { LMSService, type LmsSession } from "../lms/lms.service";
import { ingestionUpstreamItems } from "../observability/metrics";
import { PortalAPIService } from "../portal/portal-api.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  allEnrolledCourses,
  classifyCurrentTerm,
  type DiscoveredCourse,
} from "./core/parse-enrolled-courses";
import {
  parseRegistHistory,
  type ConfirmedSection,
} from "./core/parse-regist-history";
import { discoveryReopensAt, resolveSemester } from "./core/semester";
import { IngestionJobsService } from "./ingestion-jobs.service";
import { IngestionScheduleService } from "./ingestion-schedule.service";
import {
  errorMessage,
  FAILED_PASS,
  isIngestionEnabled,
  jobItemBody,
  statusCodeOf,
  type IntegrationTarget,
  type PassOutcome,
} from "./watcher-support";

/**
 * Learns which sections and courses a student is **confirmed** in, without
 * walking their timetable (issue #56).
 *
 * ## Why this is its own service
 *
 * The walk passes answer "what does this student's week look like" and cost up
 * to ~22 requests. They can only be skipped if something else already knows
 * which sections the student is in — and that something must run on its own
 * cadence, ahead of them, with its own failure handling. Folding it into a
 * watcher would tie the cheap question to the expensive one.
 *
 * Per student:
 *  - portal: DKHP sign-in + one `getAllRegistHistory` call for the current
 *    term — 2 requests, once a term (`INGESTION_PORTAL_DISCOVERY_PERIOD_MS`,
 *    about a semester), and again when the term changes. The timetable walk
 *    will not fetch anything until this has succeeded for the current term.
 *  - LMS: the 3-request login dance + one or more `enrolled-courses` pages,
 *    daily.
 *
 * Traded against ~20 timetable requests a day per student, which is the whole
 * bet of #56.
 *
 * ## The one rule that must not be broken
 *
 * **A failed pass never narrows a student's confirmed set.** `droppedAt` is only
 * stamped by a pass that succeeded and genuinely no longer listed the section.
 * Combined with `IngestionSchedule.lastSuccessAt` and `lastSuccessTerm` not
 * advancing on failure, the failure mode of "discovery is down" is "the
 * timetable walk waits for it" or, on the LMS side, "every student gets a full
 * live walk", never "a student gets skipped with a stale set".
 *
 * Same 5-part skeleton as the three watchers, and the same
 * `IngestionJobsService` rows, so `IntegrationStatus.lastSyncedAt` /
 * `.lastSyncStatus` keep reflecting reality for a provider whose most recent
 * activity was a discovery pass.
 */
@Injectable()
export class EnrollmentDiscoveryService {
  private readonly logger = new Logger(EnrollmentDiscoveryService.name);
  private readonly dkhpEndpoint: string;
  private readonly lmsEndpoint: string;
  private readonly dluTimezone: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly portal: PortalAPIService,
    private readonly lms: LMSService,
    private readonly jobs: IngestionJobsService,
    private readonly schedule: IngestionScheduleService,
    // Circular by construction, exactly as in the watchers: ingestion needs
    // `revealCredentials`, integrations needs ingestion for the manual trigger.
    @Inject(forwardRef(() => IntegrationsService))
    private readonly integrations: IntegrationsService,
  ) {
    this.dkhpEndpoint = this.config.get<string>("DKHP_API_URL") ?? "";
    this.lmsEndpoint = this.config.get<string>("LMS_URL") ?? "";
    this.dluTimezone = this.config.get<string>("DLU_TZ") ?? "Asia/Ho_Chi_Minh";
  }

  // ── portal ───────────────────────────────────────────────────────────────

  /**
   * Discover one student's confirmed portal sections for the current term.
   *
   * DKHP `authenticate` → one `getAllRegistHistory` call → reconcile
   * `PortalSectionEnrollment`. A clean pass stamps the schedule row with the
   * term it covered, which is what the timetable gate reads.
   */
  async syncPortal(target: IntegrationTarget, now: Date): Promise<PassOutcome> {
    if (!isIngestionEnabled(this.config)) return FAILED_PASS;

    const jobId = await this.jobs.startJob("PORTAL", target.integrationId);
    const token = await this.signInDkhp(target, jobId);
    if (!token) return FAILED_PASS;

    // The academic coordinates are a property of the university's calendar, so
    // they are resolved in DLU's timezone, never the student's.
    const term = resolveSemester(now, this.dluTimezone);
    const url = `${this.dkhpEndpoint}/api/student/getAllRegistHistory`;
    const itemId = await this.jobs.beginItem("PORTAL", jobId, url);

    try {
      const rows = await this.portal.fetchRegistHistory(
        token,
        term.academicYear,
        term.semester,
      );
      const parsed = parseRegistHistory(rows, {
        academicYear: term.academicYear,
        termId: term.semester,
      });

      // The ONE place ingestion deliberately does not keep the raw upstream
      // body. Each history row carries the registering staff/student id, and
      // `responseBody` is a long-lived column read by anyone debugging a sync.
      // The section ids are the entire parse output, so recording them loses
      // nothing a diagnosis needs.
      await this.jobs.completeItem("PORTAL", itemId, {
        status: "COMPLETED",
        statusCode: 200,
        responseBody: jobItemBody({
          body: {
            note: "raw history body withheld — it carries staff/student ids (PII)",
            events: rows.length,
            scheduleStudyUnitIds: parsed.sections.map(
              (s) => s.scheduleStudyUnitId,
            ),
          },
          skipped: parsed.skipped,
        }),
      });
      ingestionUpstreamItems.add(1, {
        operation: "dkhp_regist_history",
        status: "COMPLETED",
      });

      // One request is the whole picture, so reconciling drops is safe.
      await this.recordSections(target, parsed.sections, term, now);
      await this.schedule.markDiscovered(
        target.integrationId,
        term,
        now,
        discoveryReopensAt(term),
      );

      await this.jobs.finishJob("PORTAL", jobId, "COMPLETED");
      this.logger.debug(
        `Portal discovery for integration ${target.integrationId}: ` +
          `${parsed.sections.length} confirmed section(s)`,
      );
      return { ok: true, servedFromCache: false };
    } catch (error) {
      if (error instanceof UpstreamUnavailableError) {
        // Nothing was requested and nothing succeeded: drop the run rather
        // than record a student failure; the ticker releases the claim.
        await this.jobs.discardJob("PORTAL", jobId);
        throw error;
      }
      await this.jobs.completeItem("PORTAL", itemId, {
        status: "FAILED",
        statusCode: statusCodeOf(error),
        responseBody: jobItemBody({ error: errorMessage(error) }),
      });
      ingestionUpstreamItems.add(1, {
        operation: "dkhp_regist_history",
        status: "FAILED",
      });
      this.logger.warn(
        `Registration history failed for integration ` +
          `${target.integrationId}: ${errorMessage(error)}`,
      );
      await this.jobs.finishJob("PORTAL", jobId, "COMPLETED");
      return FAILED_PASS;
    }
  }

  /**
   * Persist the confirmed section set.
   *
   * `PortalSectionEnrollment.scheduleStudyUnitId` has a foreign key onto
   * `PortalSection`, so discovery has to make sure the catalog row exists. It
   * writes the minimum it knows — the section id, its curriculum name and the
   * term — and leaves room, teacher, group and campus null; the timetable walk
   * fills those in when it next sees the section. That ordering is deliberate:
   * discovery runs *before* any walk on a new integration, so it cannot wait for
   * walk-sourced metadata to create the row.
   *
   * Sections the student had registered this term but the history no longer
   * lists as registered are marked dropped.
   */
  private async recordSections(
    target: IntegrationTarget,
    sections: readonly ConfirmedSection[],
    term: { academicYear: string; semester: string },
    now: Date,
  ): Promise<void> {
    for (const section of sections) {
      await this.prisma.portalSection.upsert({
        where: { scheduleStudyUnitId: section.scheduleStudyUnitId },
        create: {
          scheduleStudyUnitId: section.scheduleStudyUnitId,
          curriculumId: section.curriculumId,
          curriculumName: section.curriculumName ?? section.scheduleStudyUnitId,
          yearStudy: section.yearStudy,
          termId: section.termId,
        },
        // Never overwrite what the walk learned with the little the history
        // carries — a walk knows the room, the teacher and the group; the
        // history knows none of them, and `{}` here is what keeps a richer row
        // intact.
        update: {},
      });

      await this.prisma.portalSectionEnrollment.upsert({
        where: {
          userId_scheduleStudyUnitId: {
            userId: target.userId,
            scheduleStudyUnitId: section.scheduleStudyUnitId,
          },
        },
        create: {
          userId: target.userId,
          integrationId: target.integrationId,
          scheduleStudyUnitId: section.scheduleStudyUnitId,
          yearStudy: section.yearStudy,
          termId: section.termId,
          discoveredAt: now,
        },
        // A reappearance clears `droppedAt` rather than inserting a second row —
        // a student can re-register for a section they dropped.
        update: { discoveredAt: now, droppedAt: null },
      });
    }

    const seen = new Set(sections.map((s) => s.scheduleStudyUnitId));
    const live = await this.prisma.portalSectionEnrollment.findMany({
      where: {
        userId: target.userId,
        yearStudy: term.academicYear,
        termId: term.semester,
        droppedAt: null,
      },
      select: { id: true, scheduleStudyUnitId: true },
    });
    const gone = live.filter((row) => !seen.has(row.scheduleStudyUnitId));
    if (gone.length === 0) return;

    await this.prisma.portalSectionEnrollment.updateMany({
      where: { id: { in: gone.map((row) => row.id) } },
      data: { droppedAt: now },
    });
    this.logger.log(
      `Portal discovery: ${gone.length} section registration(s) dropped for ` +
        `integration ${target.integrationId}`,
    );
  }

  // ── LMS ──────────────────────────────────────────────────────────────────

  /**
   * Discover one student's confirmed Moodle courses.
   *
   * `login` → `enrolled-courses` (paginated) → classify → reconcile
   * `LmsCourseEnrollment`.
   */
  async syncLms(target: IntegrationTarget, now: Date): Promise<PassOutcome> {
    if (!isIngestionEnabled(this.config)) return FAILED_PASS;

    const jobId = await this.jobs.startJob("LMS", target.integrationId);
    const session = await this.signInLms(target, jobId);
    if (!session) return FAILED_PASS;

    const term = resolveSemester(now, this.dluTimezone);
    const url =
      `${this.lmsEndpoint}/lib/ajax/service.php` +
      `?info=core_course_get_enrolled_courses_by_timeline_classification`;
    const itemId = await this.jobs.beginItem("LMS", jobId, url);

    try {
      const raw = await this.lms.fetchEnrolledCourses(session);
      const classified = classifyCurrentTerm(raw, term);
      // Every course, filtered or not: the filter is advisory until it has been
      // checked against a real account, so what gets stored is the whole
      // enrolment plus a per-row verdict.
      const all = allEnrolledCourses(raw);
      const currentIds = new Set(classified.current.map((c) => c.lmsCourseId));

      await this.recordCourses(target, all, currentIds, now);

      await this.jobs.completeItem("LMS", itemId, {
        status: "COMPLETED",
        statusCode: 200,
        responseBody: jobItemBody({
          body: {
            total: all.length,
            currentTerm: classified.current.length,
            // The shadow-mode artefact: which signal would have dropped what.
            excluded: classified.excluded.map((c) => ({
              lmsCourseId: c.lmsCourseId,
              reason: c.reason,
            })),
            unknownCategory: classified.unknownCategory,
          },
        }),
      });
      ingestionUpstreamItems.add(1, {
        operation: "lms_enrolled_courses",
        status: "COMPLETED",
      });

      if (classified.excluded.length > 0 || classified.unknownCategory > 0) {
        // The line that has to read clean against a real account before
        // INGESTION_LMS_TERM_FILTER may be flipped to `enforce`.
        this.logger.debug(
          `LMS term filter (advisory) for integration ${target.integrationId}: ` +
            `${classified.current.length} current, ` +
            `${classified.excluded.length} excluded, ` +
            `${classified.unknownCategory} with an unrecognised category`,
        );
      }

      await this.jobs.finishJob("LMS", jobId, "COMPLETED");
      return { ok: true, servedFromCache: false };
    } catch (error) {
      if (error instanceof UpstreamUnavailableError) {
        // Nothing was requested and nothing succeeded: drop the run rather
        // than record a student failure; the ticker releases the claim.
        await this.jobs.discardJob("LMS", jobId);
        throw error;
      }
      await this.jobs.completeItem("LMS", itemId, {
        status: "FAILED",
        statusCode: statusCodeOf(error),
        responseBody: jobItemBody({ error: errorMessage(error) }),
      });
      ingestionUpstreamItems.add(1, {
        operation: "lms_enrolled_courses",
        status: "FAILED",
      });
      this.logger.warn(
        `Enrolled-course discovery failed for integration ` +
          `${target.integrationId}: ${errorMessage(error)}`,
      );
      await this.jobs.finishJob("LMS", jobId, "COMPLETED");
      return FAILED_PASS;
    }
  }

  /**
   * Persist the enrolment set, and the term filter's advisory verdict per row.
   *
   * Only reached on a successful fetch, so reconciling drops here is safe —
   * unlike the portal side, one request is the whole picture.
   */
  private async recordCourses(
    target: IntegrationTarget,
    courses: readonly DiscoveredCourse[],
    currentTermIds: ReadonlySet<number>,
    now: Date,
  ): Promise<void> {
    for (const course of courses) {
      // The FK target. Same rule as the portal side: write what we know, never
      // overwrite what the calendar walk learned.
      await this.prisma.lmsCourse.upsert({
        where: { lmsCourseId: course.lmsCourseId },
        create: {
          lmsCourseId: course.lmsCourseId,
          fullName: course.fullName,
          shortName: course.shortName,
        },
        update: {},
      });

      const fields = {
        courseCategory: course.courseCategory,
        startDate: course.startDate,
        hidden: course.hidden,
        currentTerm: currentTermIds.has(course.lmsCourseId),
        discoveredAt: now,
      };
      await this.prisma.lmsCourseEnrollment.upsert({
        where: {
          userId_lmsCourseId: {
            userId: target.userId,
            lmsCourseId: course.lmsCourseId,
          },
        },
        create: {
          userId: target.userId,
          integrationId: target.integrationId,
          lmsCourseId: course.lmsCourseId,
          ...fields,
        },
        update: { ...fields, droppedAt: null },
      });
    }

    const seen = new Set(courses.map((c) => c.lmsCourseId));
    const live = await this.prisma.lmsCourseEnrollment.findMany({
      where: { userId: target.userId, droppedAt: null },
      select: { id: true, lmsCourseId: true },
    });
    const gone = live.filter((row) => !seen.has(row.lmsCourseId));
    if (gone.length === 0) return;

    await this.prisma.lmsCourseEnrollment.updateMany({
      where: { id: { in: gone.map((row) => row.id) } },
      data: { droppedAt: now },
    });
    this.logger.log(
      `LMS discovery: ${gone.length} course enrolment(s) dropped for ` +
        `integration ${target.integrationId}`,
    );
  }

  // ── reads, for the walk passes ───────────────────────────────────────────

  /**
   * The sections a student is confirmed in for `term` — what a timetable or exam
   * pass may be served from cache for.
   *
   * Only live registrations (`droppedAt: null`), and only this term's, so last
   * term's sections can never keep a student on cached data.
   */
  async confirmedSections(
    userId: string,
    term: { academicYear: string; termId: string },
  ): Promise<string[]> {
    const rows = await this.prisma.portalSectionEnrollment.findMany({
      where: {
        userId,
        yearStudy: term.academicYear,
        termId: term.termId,
        droppedAt: null,
      },
      select: { scheduleStudyUnitId: true },
    });
    return rows.map((row) => row.scheduleStudyUnitId);
  }

  /**
   * The Moodle courses a student is confirmed in.
   *
   * `INGESTION_LMS_TERM_FILTER` decides whether the current-term verdict is
   * allowed to narrow this:
   *  - `shadow` (default) — every live enrolment, verdict ignored. The filter is
   *    recorded and metered but gates nothing, which is the state the issue
   *    requires until it has been checked against a real account.
   *  - `enforce` — only rows the filter called current-term.
   *  - `off` — same as shadow, but says so deliberately.
   *
   * Erring wide costs redundant fetches; erring narrow silently drops a real
   * course off a student's calendar. Wide is the safe default.
   */
  async confirmedCourses(userId: string): Promise<number[]> {
    const enforce =
      String(this.config.get("INGESTION_LMS_TERM_FILTER") ?? "shadow") ===
      "enforce";
    const rows = await this.prisma.lmsCourseEnrollment.findMany({
      where: {
        userId,
        droppedAt: null,
        ...(enforce ? { currentTerm: true } : {}),
      },
      select: { lmsCourseId: true },
    });
    return rows.map((row) => row.lmsCourseId);
  }

  // ── sign-in (identical contract to the watchers') ────────────────────────

  private async signInDkhp(
    target: IntegrationTarget,
    jobId: string,
  ): Promise<string | null> {
    try {
      const creds = await this.integrations.revealCredentials(
        target.userId,
        "PORTAL",
      );
      const result = await this.portal.authenticateDkhp(
        creds.username,
        creds.password,
      );
      if (!result.ok) {
        // A login failure fails the JOB, not an item: without a token there is
        // no request to attach the failure to, and `lastSyncStatus: FAILED` is
        // how the student learns their stored password went stale.
        await this.jobs.finishJob("PORTAL", jobId, "FAILED");
        this.logger.warn(
          `The portal rejected the stored credentials for integration ${target.integrationId}`,
        );
        return null;
      }
      return result.token;
    } catch (error) {
      if (error instanceof UpstreamUnavailableError) {
        await this.jobs.discardJob("PORTAL", jobId);
        throw error;
      }
      await this.jobs.finishJob("PORTAL", jobId, "FAILED");
      this.logger.warn(
        `Portal sign-in failed for integration ${target.integrationId}: ${errorMessage(error)}`,
      );
      return null;
    }
  }

  private async signInLms(
    target: IntegrationTarget,
    jobId: string,
  ): Promise<LmsSession | null> {
    try {
      const creds = await this.integrations.revealCredentials(
        target.userId,
        "LMS",
      );
      const result = await this.lms.login(creds.username, creds.password);
      if (!result.ok) {
        await this.jobs.finishJob("LMS", jobId, "FAILED");
        this.logger.warn(
          `The LMS rejected the stored credentials for integration ${target.integrationId}`,
        );
        return null;
      }
      return result.session;
    } catch (error) {
      if (error instanceof UpstreamUnavailableError) {
        await this.jobs.discardJob("LMS", jobId);
        throw error;
      }
      await this.jobs.finishJob("LMS", jobId, "FAILED");
      this.logger.warn(
        `LMS sign-in failed for integration ${target.integrationId}: ${errorMessage(error)}`,
      );
      return null;
    }
  }
}
