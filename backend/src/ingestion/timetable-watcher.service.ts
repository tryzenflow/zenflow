import { forwardRef, Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron, CronExpression } from "@nestjs/schedule";
import { IntegrationsService } from "../integrations/integrations.service";
import { PortalAPIService } from "../portal/portal-api.service";
import { PrismaService } from "../prisma/prisma.service";
import { parseTimetable } from "./core/parse-portal";
import { isoWeeksBetween, resolveSemester } from "./core/semester";
import type { ParsedPortalSection } from "./core/types";
import { IngestionJobsService } from "./ingestion-jobs.service";
import { MaterializerService } from "./materializer.service";
import {
  eachIntegrationTarget,
  errorMessage,
  isIngestionEnabled,
  jobItemBody,
  sleep,
  statusCodeOf,
  type IntegrationTarget,
} from "./watcher-support";

/**
 * Daily sweep of every connected student's class timetable.
 *
 * Daily, not hourly: a published timetable moves a handful of times a term, so
 * an hourly poll would be almost entirely wasted requests against DLU. At 03:00
 * for the obvious reason — nobody is looking at their calendar, and the portal
 * is idle.
 *
 * The portal has no "give me the current week" call: the endpoint is addressed
 * by academic coordinates `(academicYear, semester, tuan)`, so every run first
 * resolves which term "now" falls in (`ingestion/core/semester.ts`) and then
 * walks **every remaining ISO week of that term**, so a student who looks
 * months ahead sees a populated calendar rather than an empty one.
 *
 * That is ~20 requests per student on the first run of a term, shrinking by one
 * a week as the term is consumed, spaced by `INGESTION_REQUEST_DELAY_MS`. Daily
 * and off-peak, it stays well inside what the portal serves a single logged-in
 * student, and re-fetching settled weeks is what lets a mid-term room or time
 * change actually land.
 *
 * Shape copied from `scheduler/io/matrix-decay.service.ts` — a thin `@Cron`
 * over a `run(now, userId?)` that takes its clock as a parameter, so
 * `POST /integrations/PORTAL/sync` runs the identical code for one student.
 */
@Injectable()
export class TimetableWatcherService {
  private readonly logger = new Logger(TimetableWatcherService.name);
  private readonly endpoint: string;
  private readonly dluTimezone: string;
  private readonly requestDelayMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly portal: PortalAPIService,
    private readonly jobs: IngestionJobsService,
    private readonly materializer: MaterializerService,
    @Inject(forwardRef(() => IntegrationsService))
    private readonly integrations: IntegrationsService,
  ) {
    this.endpoint = this.config.get<string>("PORTAL_API_URL") ?? "";
    this.dluTimezone = this.config.get<string>("DLU_TZ") ?? "Asia/Ho_Chi_Minh";
    this.requestDelayMs = Number(
      this.config.get("INGESTION_REQUEST_DELAY_MS") ?? 750,
    );
  }

  @Cron(CronExpression.EVERY_WEEKEND)
  async handleCron(): Promise<void> {
    const count = await this.run();
    if (count > 0) {
      this.logger.log(`Synced the timetable for ${count} student(s)`);
    }
  }

  /** Sync every connected student's timetable (or just `userId`'s). */
  async run(now = new Date(), userId?: string): Promise<number> {
    if (!isIngestionEnabled(this.config)) return 0;
    return eachIntegrationTarget(this.prisma, "PORTAL", userId, (target) =>
      this.syncUser(target, now),
    );
  }

  private async syncUser(target: IntegrationTarget, now: Date): Promise<void> {
    const jobId = await this.jobs.startJob("PORTAL", target.integrationId);

    const token = await this.signIn(target, jobId);
    if (!token) return;

    // The academic coordinates are a property of the university's calendar, so
    // they are resolved in DLU's timezone, never the student's.
    const { academicYear, semester, startDate, endDate } = resolveSemester(
      now,
      this.dluTimezone,
    );

    const from = now > startDate ? now : startDate;
    const weeks = isoWeeksBetween(from, endDate, this.dluTimezone);

    let created = 0;
    let updated = 0;
    let guarded = 0;
    let first = true;

    for (const week of weeks) {
      if (!first) await sleep(this.requestDelayMs);
      first = false;

      const url =
        `${this.endpoint}/api/student/DrawingStudentSchedules` +
        `?namhoc=${academicYear}&hocky=${semester}&tuan=${week}`;
      const itemId = await this.jobs.beginItem("PORTAL", jobId, url);

      try {
        const rows = await this.portal.fetchTimetable(
          token,
          academicYear,
          semester,
          week,
        );
        const parsed = parseTimetable(rows, this.wallClockTimezone());
        await this.upsertSections(parsed.sections);
        const outcome = await this.materializer.materialize(
          target.userId,
          parsed.items,
          "PORTAL",
        );
        created += outcome.created;
        updated += outcome.updated;
        guarded += outcome.guarded;

        await this.jobs.completeItem("PORTAL", itemId, {
          status: "COMPLETED",
          statusCode: 200,
          responseBody: jobItemBody({ body: rows, skipped: parsed.skipped }),
        });
      } catch (error) {
        await this.jobs.completeItem("PORTAL", itemId, {
          status: "FAILED",
          statusCode: statusCodeOf(error),
          responseBody: jobItemBody({ error: errorMessage(error) }),
        });
        this.logger.warn(
          `Timetable week ${week} failed for integration ` +
            `${target.integrationId}: ${errorMessage(error)}`,
        );
      }
    }

    await this.jobs.finishJob("PORTAL", jobId, "COMPLETED");

    if (created + updated + guarded > 0) {
      this.logger.log(
        `Timetable sync for integration ${target.integrationId}: ` +
          `${created} new, ${updated} updated, ${guarded} kept as edited`,
      );
    }
  }

  /**
   * The timezone the portal's `dd/MM/yyyy` + `07g30` wall-clock strings are
   * turned into instants in.
   *
   * Always `DLU_TZ`, never the student's own zone: "07g30" is a fact about a
   * classroom in Vietnam, so it is a property of the upstream data, not of
   * whoever is reading it. Parsing it in the viewer's zone would place the
   * class at the wrong instant for any student not set to Asia/Saigon — one
   * studying abroad, or mid-exchange. The user's timezone governs *rendering*
   * (invariant #5, `frontend/src/utils/tz.ts`), which happens later, off the
   * UTC instant stored here.
   */
  private wallClockTimezone(): string {
    return this.dluTimezone;
  }

  private async signIn(
    target: IntegrationTarget,
    jobId: string,
  ): Promise<string | null> {
    try {
      const creds = await this.integrations.revealCredentials(
        target.userId,
        "PORTAL",
      );
      const result = await this.portal.authenticate(
        creds.username,
        creds.password,
      );
      if (!result.ok) {
        await this.jobs.finishJob("PORTAL", jobId, "FAILED");
        this.logger.warn(
          `The portal rejected the stored credentials for integration ${target.integrationId}`,
        );
        return null;
      }
      return result.token;
    } catch (error) {
      await this.jobs.finishJob("PORTAL", jobId, "FAILED");
      this.logger.warn(
        `Portal sign-in failed for integration ${target.integrationId}: ${errorMessage(error)}`,
      );
      return null;
    }
  }

  /** Keep the cross-user `PortalSection` catalog current, deduped upstream-side. */
  private async upsertSections(
    sections: readonly ParsedPortalSection[],
  ): Promise<void> {
    for (const section of sections) {
      const { scheduleStudyUnitId, ...fields } = section;
      await this.prisma.portalSection.upsert({
        where: { scheduleStudyUnitId },
        create: { scheduleStudyUnitId, ...fields },
        update: fields,
      });
    }
  }
}
