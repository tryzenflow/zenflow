import { forwardRef, Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron, CronExpression } from "@nestjs/schedule";
import { IntegrationsService } from "../integrations/integrations.service";
import { PortalAPIService } from "../portal/portal-api.service";
import { PrismaService } from "../prisma/prisma.service";
import { parseExams } from "./core/parse-portal";
import { resolveSemester } from "./core/semester";
import { IngestionJobsService } from "./ingestion-jobs.service";
import { MaterializerService } from "./materializer.service";
import {
  eachIntegrationTarget,
  errorMessage,
  isIngestionEnabled,
  jobItemBody,
  statusCodeOf,
  type IntegrationTarget,
} from "./watcher-support";

/**
 * Daily sweep of every connected student's exam schedule.
 *
 * The cheapest of the three watchers: `GET /api/student/exam` returns a whole
 * term in one response, so a run costs exactly one request per student and
 * there is nothing to paginate and no delay to insert between requests.
 *
 * At 04:00, an hour after the timetable cron, so the two daily sweeps do not
 * hit the portal at the same instant on behalf of the same students.
 *
 * A seasonal cadence — several times a week during the exam windows
 * (Oct–Dec / Mar–May / Jun–Jul) and backing off outside them — is deliberately
 * deferred; the pure parser and the job rows are already shaped so that becomes
 * a change to this one `@Cron` line rather than a rewrite.
 */
@Injectable()
export class ExamWatcherService {
  private readonly logger = new Logger(ExamWatcherService.name);
  private readonly endpoint: string;
  private readonly dluTimezone: string;

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
  }

  @Cron(CronExpression.EVERY_WEEK)
  async handleCron(): Promise<void> {
    const count = await this.run();
    if (count > 0) {
      this.logger.log(`Synced the exam schedule for ${count} student(s)`);
    }
  }

  /** Sync every connected student's exam schedule (or just `userId`'s). */
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

    const { academicYear, semester } = resolveSemester(now, this.dluTimezone);
    const url = `${this.endpoint}/api/student/exam?namhoc=${academicYear}&hocky=${semester}`;
    const itemId = await this.jobs.beginItem("PORTAL", jobId, url);

    try {
      const rows = await this.portal.fetchExams(token, academicYear, semester);
      // Always DLU_TZ: "07g30" describes a Vietnamese exam hall, so it belongs
      // to the upstream data, not to whoever reads it. The student's zone
      // governs rendering (invariant #5), off the UTC instant stored here.
      const parsed = parseExams(rows, this.dluTimezone);
      const outcome = await this.materializer.materialize(
        target.userId,
        parsed.items,
        "PORTAL",
      );

      await this.jobs.completeItem("PORTAL", itemId, {
        status: "COMPLETED",
        statusCode: 200,
        responseBody: jobItemBody({ body: rows, skipped: parsed.skipped }),
      });

      if (outcome.created + outcome.updated + outcome.guarded > 0) {
        this.logger.log(
          `Exam sync for integration ${target.integrationId}: ` +
            `${outcome.created} new, ${outcome.updated} updated, ` +
            `${outcome.guarded} kept as edited`,
        );
      }
    } catch (error) {
      // The item carries the failure; the job still completes, exactly as in
      // the multi-request watchers, so the two never disagree about what
      // `lastSyncStatus: COMPLETED` means.
      await this.jobs.completeItem("PORTAL", itemId, {
        status: "FAILED",
        statusCode: statusCodeOf(error),
        responseBody: jobItemBody({ error: errorMessage(error) }),
      });
      this.logger.warn(
        `Exam schedule failed for integration ${target.integrationId}: ${errorMessage(error)}`,
      );
    }

    await this.jobs.finishJob("PORTAL", jobId, "COMPLETED");
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
}
