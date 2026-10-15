import { forwardRef, Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { fromZonedTime } from "date-fns-tz";
import { UpstreamUnavailableError } from "../common/outbound-breaker";
import { IntegrationsService } from "../integrations/integrations.service";
import { LMSService, type LmsSession } from "../lms/lms.service";
import {
  ingestionLastSuccess,
  ingestionSignInFailures,
  ingestionUpstreamItems,
} from "../observability/metrics";
import { PrismaService } from "../prisma/prisma.service";
import type { UnitJobData } from "../queue/queues";
import { occurrencesFromLms } from "./core/occurrences";
import { parseMonthlyView } from "./core/parse-lms";
import { monthsWindow } from "./core/semester";
import { SyncDigest } from "./core/sync-digest";
import { EnrollmentDiscoveryService } from "./enrollment-discovery.service";
import { IngestionJobsService } from "./ingestion-jobs.service";
import { IngestionScheduleService } from "./ingestion-schedule.service";
import { MaterializerService } from "./materializer.service";
import {
  OccurrenceCacheService,
  type LmsWindow,
} from "./occurrence-cache.service";
import { OccurrenceFanoutService } from "./occurrence-fanout.service";
import type { WeekResult } from "./timetable-week.service";
import {
  errorMessage,
  isOccurrenceCacheEnabled,
  jobItemBody,
  positiveConfig,
  statusCodeOf,
} from "./watcher-support";

/** `YYYY-MM` of the month a job is addressed by, in the given zone. */
export function monthUnit(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/**
 * One LMS calendar month for one student: the body of an `lms-month` job.
 *
 * Reads the month from the shared cache when every confirmed course is fresh
 * and still matches what this student last saw; otherwise logs in and fetches
 * that month alone. The current and the next month are separate jobs.
 */
@Injectable()
export class LmsMonthService {
  private readonly logger = new Logger(LmsMonthService.name);
  private readonly tz: string;
  private readonly discoveryMaxAgeMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly lms: LMSService,
    @Inject(forwardRef(() => IntegrationsService))
    private readonly integrations: IntegrationsService,
    private readonly jobs: IngestionJobsService,
    private readonly materializer: MaterializerService,
    private readonly discovery: EnrollmentDiscoveryService,
    private readonly cache: OccurrenceCacheService,
    private readonly fanout: OccurrenceFanoutService,
    private readonly schedule: IngestionScheduleService,
  ) {
    this.tz = this.config.get<string>("DLU_TZ") ?? "Asia/Ho_Chi_Minh";
    this.discoveryMaxAgeMs = positiveConfig(
      this.config,
      "INGESTION_DISCOVERY_MAX_AGE_MS",
      48 * 60 * 60_000,
    );
  }

  async syncMonth(data: UnitJobData, now = new Date()): Promise<WeekResult> {
    const [year, month] = data.unit.split("-").map(Number);
    const anchor = fromZonedTime(`${data.unit}-01T12:00:00.000`, this.tz);
    const window = monthsWindow(anchor, this.tz, 1);

    const courseIds = await this.trustedCourses(
      data.integrationId,
      data.userId,
      now,
    );
    if (await this.canServeFromCache(data.userId, courseIds, window, now)) {
      return this.fromCache(data, courseIds ?? [], window, now);
    }
    return this.fromLms(data, year, month, window, courseIds, now);
  }

  private async canServeFromCache(
    userId: string,
    courseIds: number[] | null,
    window: LmsWindow,
    now: Date,
  ): Promise<boolean> {
    if (!isOccurrenceCacheEnabled(this.config)) return false;
    // Moodle enrolment lags until a subject starts: empty means "unknown".
    if (!courseIds || courseIds.length === 0) return false;
    const { stale } = await this.cache.lmsFreshness(userId, courseIds, {
      now,
      window,
    });
    return stale.length === 0;
  }

  private async fromCache(
    data: UnitJobData,
    courseIds: readonly number[],
    window: LmsWindow,
    now: Date,
  ): Promise<WeekResult> {
    const jobId = await this.jobs.startJob("LMS", data.integrationId);
    const itemId = await this.jobs.beginItem(
      "LMS",
      jobId,
      `cache:lms_calendar_month?month=${data.unit}&courses=${courseIds.length}`,
    );
    try {
      const digest = new SyncDigest(new Date());
      const from = now > window.from ? now : window.from;
      const blocks = await this.cache.lmsBlocks(courseIds, {
        from,
        to: window.to,
      });
      await this.materializer.materialize(
        data.userId,
        blocks,
        "LMS",
        now,
        digest,
      );
      // Activities of unconfirmed courses may have been shown by a live read;
      // the cache cannot speak for them, so they are kept.
      const unconfirmed = await this.cache.lmsKeysOutside(courseIds, {
        from,
        to: window.to,
      });
      await this.materializer.reconcileDeleted(
        data.userId,
        "LMS",
        ["ASSIGNMENT", "EXAM"],
        new Set([...blocks.map((b) => b.externalKey), ...unconfirmed]),
        now,
        digest,
        { from, to: window.to },
      );
      await this.materializer.flushDigest(data.userId, digest, now);
      await this.jobs.completeItem("LMS", itemId, {
        status: "COMPLETED",
        statusCode: null,
        responseBody: jobItemBody({
          body: { servedFromCache: true, blocks: blocks.length },
        }),
      });
      await this.jobs.finishJob("LMS", jobId, "COMPLETED");
      ingestionUpstreamItems.add(1, {
        operation: "lms_calendar_cached",
        status: "COMPLETED",
      });
      ingestionLastSuccess.record(now.getTime() / 1000, { provider: "LMS" });
      return { ok: true, fetched: false };
    } catch (error) {
      await this.jobs.completeItem("LMS", itemId, {
        status: "FAILED",
        statusCode: null,
        responseBody: jobItemBody({ error: errorMessage(error) }),
      });
      await this.jobs.finishJob("LMS", jobId, "COMPLETED");
      this.logger.warn(
        `Cached LMS month ${data.unit} failed for integration ${data.integrationId}: ${errorMessage(error)}`,
      );
      return { ok: false, fetched: false };
    }
  }

  private async fromLms(
    data: UnitJobData,
    year: number,
    month: number,
    window: LmsWindow,
    courseIds: number[] | null,
    now: Date,
  ): Promise<WeekResult> {
    const jobId = await this.jobs.startJob("LMS", data.integrationId);
    let session: LmsSession;
    try {
      const creds = await this.integrations.revealCredentials(
        data.userId,
        "LMS",
      );
      const login = await this.lms.login(creds.username, creds.password);
      if (!login.ok) {
        ingestionSignInFailures.add(1, { provider: "LMS", reason: "rejected" });
        await this.jobs.finishJob("LMS", jobId, "FAILED");
        return { ok: false, fetched: false };
      }
      session = login.session;
    } catch (error) {
      if (error instanceof UpstreamUnavailableError) {
        await this.jobs.discardJob("LMS", jobId);
        throw error;
      }
      ingestionSignInFailures.add(1, { provider: "LMS", reason: "error" });
      await this.jobs.finishJob("LMS", jobId, "FAILED");
      this.logger.error(
        `LMS sign-in failed for integration ${data.integrationId}: ${errorMessage(error)}`,
      );
      return { ok: false, fetched: false };
    }

    const url = `${this.config.get<string>("LMS_URL") ?? ""}/lib/ajax/service.php?info=core_calendar_get_calendar_monthly_view&year=${year}&month=${month}`;
    const itemId = await this.jobs.beginItem("LMS", jobId, url);
    try {
      const view = await this.lms.fetchMonthlyView(session, year, month);
      const parsed = parseMonthlyView(view, now);
      for (const course of parsed.courses) {
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
      const digest = new SyncDigest(new Date());
      await this.materializer.materialize(
        data.userId,
        parsed.items,
        "LMS",
        now,
        digest,
      );
      // A quiz that opens this month and closes next shows up here only as a
      // skipped lone open; its key counts as seen so it is not retired.
      const seen = new Set([
        ...parsed.items.map((i) => i.externalKey),
        ...parsed.skipped
          .map((s) => s.ref)
          .filter((ref) => ref.startsWith("lms:")),
      ]);
      await this.materializer.reconcileDeleted(
        data.userId,
        "LMS",
        ["ASSIGNMENT", "EXAM"],
        seen,
        now,
        digest,
        { from: now > window.from ? now : window.from, to: window.to },
      );
      await this.materializer.flushDigest(data.userId, digest, now);
      await this.recordAndFanOut(data, parsed.items, window, courseIds, now);
      await this.jobs.completeItem("LMS", itemId, {
        status: "COMPLETED",
        statusCode: 200,
        responseBody: jobItemBody({ body: view, skipped: parsed.skipped }),
      });
      await this.jobs.finishJob("LMS", jobId, "COMPLETED");
      ingestionUpstreamItems.add(1, {
        operation: "lms_calendar",
        status: "COMPLETED",
      });
      ingestionLastSuccess.record(now.getTime() / 1000, { provider: "LMS" });
      return { ok: true, fetched: true };
    } catch (error) {
      if (error instanceof UpstreamUnavailableError) {
        await this.jobs.discardJob("LMS", jobId);
        throw error;
      }
      await this.jobs.completeItem("LMS", itemId, {
        status: "FAILED",
        statusCode: statusCodeOf(error),
        responseBody: jobItemBody({ error: errorMessage(error) }),
      });
      await this.jobs.finishJob("LMS", jobId, "COMPLETED");
      ingestionUpstreamItems.add(1, {
        operation: "lms_calendar",
        status: "FAILED",
      });
      this.logger.warn(
        `LMS month ${data.unit} failed for integration ${data.integrationId}: ${errorMessage(error)}`,
      );
      throw error;
    }
  }

  private async recordAndFanOut(
    data: UnitJobData,
    items: Parameters<typeof occurrencesFromLms>[0],
    window: LmsWindow,
    courseIds: number[] | null,
    now: Date,
  ): Promise<void> {
    try {
      const occurrences = occurrencesFromLms(items);
      const outcome = await this.cache.recordLmsItems(occurrences, {
        now,
        complete: true,
        userId: data.userId,
        window,
        courseIds: courseIds ?? [],
        cacheable: occurrences.length === items.length,
      });
      if (!isOccurrenceCacheEnabled(this.config)) return;
      if (outcome.transitions.length === 0) return;
      await this.fanout.fanOutLms(outcome.transitions, {
        excludeUserId: data.userId,
        window: { from: now > window.from ? now : window.from, to: window.to },
        now,
      });
    } catch (error) {
      this.logger.warn(
        `Recording LMS month ${data.unit} failed for integration ${data.integrationId}: ${errorMessage(error)}`,
      );
    }
  }

  /** Confirmed courses, or `null` when discovery is too stale to trust. */
  private async trustedCourses(
    integrationId: string,
    userId: string,
    now: Date,
  ): Promise<number[] | null> {
    const discoveredAt = await this.schedule.lastSuccessAt(
      integrationId,
      "LMS_DISCOVERY",
    );
    if (
      !discoveredAt ||
      now.getTime() - discoveredAt.getTime() > this.discoveryMaxAgeMs
    ) {
      return null;
    }
    return this.discovery.confirmedCourses(userId);
  }
}
