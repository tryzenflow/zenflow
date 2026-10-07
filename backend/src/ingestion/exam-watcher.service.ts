import { UpstreamUnavailableError } from "../common/outbound-breaker";
import { forwardRef, Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  ingestionLastSuccess,
  ingestionUpstreamItems,
} from "../observability/metrics";
import { IntegrationsService } from "../integrations/integrations.service";
import { PortalAPIService } from "../portal/portal-api.service";
import { PrismaService } from "../prisma/prisma.service";
import { parseExams } from "./core/parse-portal";
import { resolveSemester } from "./core/semester";
import { SyncDigest } from "./core/sync-digest";
import { IngestionJobsService } from "./ingestion-jobs.service";
import { MaterializerService } from "./materializer.service";
import {
  eachIntegrationTarget,
  errorMessage,
  FAILED_PASS,
  isIngestionEnabled,
  jobItemBody,
  statusCodeOf,
  type IntegrationTarget,
  type PassOutcome,
} from "./watcher-support";

/**
 * Syncs one student's exam schedule.
 *
 * The cheapest of the three watchers: `GET /api/student/exam` returns a whole
 * term in one response, so a pass costs exactly one request per student and
 * there is nothing to paginate and no delay to insert between requests.
 *
 * **No cron of its own.** Since issue #56 `IngestionTickerService` claims this
 * kind (`PORTAL_EXAM`) on a rolling schedule with target period
 * `INGESTION_EXAM_PERIOD_MS`. It previously shared one `@Cron` expression with
 * the timetable watcher, which quietly undid the deliberate stagger its own
 * docstring described: both fired at the same instant on behalf of the same
 * students. Under the rolling ticker they are separate kinds with separate
 * `nextDueAt`s, so the stagger is a property of the data rather than of two
 * cron strings staying in sync.
 *
 * A seasonal cadence — more often during the exam windows (Oct–Dec / Mar–May /
 * Jun–Jul), backing off outside them — is still deferred, but is now a change to
 * one config value rather than to a decorator.
 *
 * ## No cache, no fan-out
 *
 * An exam view may differ between classmates (a large section's rooms can be
 * split by student list), so every student fetches their own. Nothing here reads
 * or writes the shared occurrence cache.
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

  /**
   * Sync every connected student's exam schedule (or just `userId`'s).
   *
   * The manual `POST /integrations/PORTAL/sync` path since #56 — the background
   * pass comes through {@link syncOne} instead. Same code either way.
   */
  async run(now = new Date(), userId?: string): Promise<number> {
    if (!isIngestionEnabled(this.config)) return 0;
    return eachIntegrationTarget(this.prisma, "PORTAL", userId, (target) =>
      this.syncOne(target, now),
    );
  }

  /** One student's exam pass. The unit the rolling ticker claims. */
  async syncOne(target: IntegrationTarget, now: Date): Promise<PassOutcome> {
    const term = resolveSemester(now, this.dluTimezone);

    const jobId = await this.jobs.startJob("PORTAL", target.integrationId);

    const token = await this.signIn(target, jobId);
    if (!token) return FAILED_PASS;

    // Changes are announced once per item type at the end of the run.
    const digest = new SyncDigest(new Date());

    // One request, so one failure is a total failure — there is no partial
    // picture to salvage, unlike the week-by-week timetable walk.
    let ok = true;

    const { academicYear, semester } = term;
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
        now,
        digest,
      );

      // The whole term comes back in this one response, so a completed fetch is
      // a full picture: any ingested exam it no longer lists has been withdrawn.
      const seenKeys = new Set(parsed.items.map((item) => item.externalKey));
      const recon = await this.materializer.reconcileDeleted(
        target.userId,
        "PORTAL",
        ["EXAM"],
        seenKeys,
        now,
        digest,
      );

      await this.jobs.completeItem("PORTAL", itemId, {
        status: "COMPLETED",
        statusCode: 200,
        responseBody: jobItemBody({ body: rows, skipped: parsed.skipped }),
      });
      ingestionUpstreamItems.add(1, {
        operation: "portal_exam",
        status: "COMPLETED",
      });
      ingestionLastSuccess.record(now.getTime() / 1000, { provider: "PORTAL" });

      if (
        outcome.created +
          outcome.updated +
          outcome.skippedDeleted +
          outcome.skippedMoved +
          recon.deleted >
        0
      ) {
        this.logger.log(
          `Exam sync for integration ${target.integrationId}: ` +
            `${outcome.created} new, ${outcome.updated} updated, ` +
            `${outcome.skippedDeleted} skipped (student-deleted), ` +
            `${outcome.skippedMoved} kept (student-moved), ${recon.deleted} removed`,
        );
      }
    } catch (error) {
      if (error instanceof UpstreamUnavailableError) {
        // Nothing was requested and nothing succeeded: drop the run rather
        // than record a student failure; the ticker releases the claim.
        await this.jobs.discardJob("PORTAL", jobId);
        throw error;
      }
      // The item carries the failure; the job still completes, exactly as in
      // the multi-request watchers, so the two never disagree about what
      // `lastSyncStatus: COMPLETED` means.
      await this.jobs.completeItem("PORTAL", itemId, {
        status: "FAILED",
        statusCode: statusCodeOf(error),
        responseBody: jobItemBody({ error: errorMessage(error) }),
      });
      ingestionUpstreamItems.add(1, {
        operation: "portal_exam",
        status: "FAILED",
      });
      this.logger.warn(
        `Exam schedule failed for integration ${target.integrationId}: ${errorMessage(error)}`,
      );
      ok = false;
    }

    await this.materializer.flushDigest(target.userId, digest, now);

    await this.jobs.finishJob("PORTAL", jobId, "COMPLETED");

    return { ok, servedFromCache: false };
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
}
