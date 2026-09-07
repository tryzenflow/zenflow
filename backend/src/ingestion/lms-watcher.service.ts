import { forwardRef, Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron, CronExpression } from "@nestjs/schedule";
import { IntegrationsService } from "../integrations/integrations.service";
import { LMSService, type LmsSession } from "../lms/lms.service";
import { PrismaService } from "../prisma/prisma.service";
import { parseMonthlyView } from "./core/parse-lms";
import { monthsFrom } from "./core/semester";
import type { ParsedLmsCourse } from "./core/types";
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
 * Two: the current month and the next one. A quiz that opens on the 30th and
 * closes on the 2nd only ever appears as a complete open/close pair in one of
 * them — see `parse-lms.ts`.
 */
const MONTHS_PER_RUN = 2;

/**
 * Hourly sweep of every connected student's Moodle calendar.
 *
 * Hourly because an assignment deadline can be published or moved at any time
 * and a student who finds out an hour late still has time to react; the
 * timetable and exam schedules, which change a handful of times a term, get the
 * cheaper daily crons instead.
 *
 * Shape copied from `scheduler/io/matrix-decay.service.ts`: a thin `@Cron`
 * delegating to a `run(now, userId?)` that takes its clock as a parameter, so
 * the sweep is testable without waiting for an hour to elapse and so
 * `POST /integrations/LMS/sync` can run the identical code for one student.
 */
@Injectable()
export class LmsWatcherService {
  private readonly logger = new Logger(LmsWatcherService.name);
  private readonly endpoint: string;
  private readonly timezone: string;
  private readonly requestDelayMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly lms: LMSService,
    private readonly jobs: IngestionJobsService,
    private readonly materializer: MaterializerService,
    // Circular by construction: ingestion needs `revealCredentials`, and
    // `IntegrationsController` needs this watcher for the manual sync trigger.
    @Inject(forwardRef(() => IntegrationsService))
    private readonly integrations: IntegrationsService,
  ) {
    this.endpoint = this.config.get<string>("LMS_URL") ?? "";
    this.timezone = this.config.get<string>("DLU_TZ") ?? "Asia/Ho_Chi_Minh";
    this.requestDelayMs = Number(
      this.config.get("INGESTION_REQUEST_DELAY_MS") ?? 750,
    );
  }

  @Cron(CronExpression.EVERY_30_MINUTES)
  async handleCron(): Promise<void> {
    const count = await this.run();
    if (count > 0) {
      this.logger.log(`Synced the LMS calendar for ${count} student(s)`);
    }
  }

  /**
   * Sync every connected student's Moodle calendar (or just `userId`'s).
   *
   * Returns the number of integrations visited — not a write count. Per-run
   * counts belong to the job rows and the log, never to a return value a
   * controller could be tempted to serialize.
   */
  async run(now = new Date(), userId?: string): Promise<number> {
    if (!isIngestionEnabled(this.config)) return 0;
    return eachIntegrationTarget(this.prisma, "LMS", userId, (target) =>
      this.syncUser(target, now),
    );
  }

  /**
   * One student, one job: sign in once, then fetch each month with the same
   * session. DLU sessions expire quickly, so the session is held in a local for
   * the run and never cached — the cost is `1 login + N fetches`, not
   * `N × (login + fetch)`.
   */
  private async syncUser(target: IntegrationTarget, now: Date): Promise<void> {
    const jobId = await this.jobs.startJob("LMS", target.integrationId);

    const session = await this.signIn(target, jobId);
    if (!session) return;

    let created = 0;
    let updated = 0;
    let guarded = 0;
    let first = true;

    for (const { year, month } of monthsFrom(
      now,
      this.timezone,
      MONTHS_PER_RUN,
    )) {
      // Politeness for the baseline is deliberately this trivial: a fixed
      // pause between outbound requests, none before the first.
      if (!first) await sleep(this.requestDelayMs);
      first = false;

      const url =
        `${this.endpoint}/lib/ajax/service.php` +
        `?info=core_calendar_get_calendar_monthly_view&year=${year}&month=${month}`;
      const itemId = await this.jobs.beginItem("LMS", jobId, url);

      try {
        const view = await this.lms.fetchMonthlyView(session, year, month);
        const parsed = parseMonthlyView(view, now);
        await this.upsertCourses(parsed.courses);
        const outcome = await this.materializer.materialize(
          target.userId,
          parsed.items,
          "LMS",
        );
        created += outcome.created;
        updated += outcome.updated;
        guarded += outcome.guarded;

        await this.jobs.completeItem("LMS", itemId, {
          status: "COMPLETED",
          statusCode: 200,
          responseBody: jobItemBody({ body: view, skipped: parsed.skipped }),
        });
      } catch (error) {
        // One bad month does not abort the run: the other month may well have
        // come back fine, and the item row records exactly what went wrong.
        await this.jobs.completeItem("LMS", itemId, {
          status: "FAILED",
          statusCode: statusCodeOf(error),
          responseBody: jobItemBody({ error: errorMessage(error) }),
        });
        this.logger.warn(
          `LMS calendar ${year}-${month} failed for integration ` +
            `${target.integrationId}: ${errorMessage(error)}`,
        );
      }
    }

    await this.jobs.finishJob("LMS", jobId, "COMPLETED");

    if (created + updated + guarded > 0) {
      this.logger.log(
        `LMS sync for integration ${target.integrationId}: ` +
          `${created} new, ${updated} updated, ${guarded} kept as edited`,
      );
    }
  }

  /**
   * Sign in, or fail the whole job.
   *
   * A login failure is the one thing that fails the job rather than an item:
   * without a session there is no request to record, so there would be nothing
   * else to attach the failure to — and `IntegrationStatus.lastSyncStatus`
   * showing `FAILED` is precisely how the student learns their stored password
   * has gone stale.
   */
  private async signIn(
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
          `LMS rejected the stored credentials for integration ${target.integrationId}`,
        );
        return null;
      }
      return result.session;
    } catch (error) {
      await this.jobs.finishJob("LMS", jobId, "FAILED");
      this.logger.warn(
        `LMS sign-in failed for integration ${target.integrationId}: ${errorMessage(error)}`,
      );
      return null;
    }
  }

  /**
   * Keep the cross-user `LmsCourse` catalog current.
   *
   * Deduped on the Moodle course id, so several students on the same course
   * converge on one row; it exists so an ingested session can be traced back to
   * a human-readable course without re-fetching.
   */
  private async upsertCourses(
    courses: readonly ParsedLmsCourse[],
  ): Promise<void> {
    for (const course of courses) {
      await this.prisma.lmsCourse.upsert({
        where: { lmsCourseId: course.lmsCourseId },
        create: {
          lmsCourseId: course.lmsCourseId,
          fullName: course.fullName,
          shortName: course.shortName,
        },
        update: { fullName: course.fullName, shortName: course.shortName },
      });
    }
  }
}
