import { forwardRef, Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  ingestionLastSuccess,
  ingestionUpstreamItems,
} from "../observability/metrics";
import { IntegrationsService } from "../integrations/integrations.service";
import { LMSService, type LmsSession } from "../lms/lms.service";
import { PrismaService } from "../prisma/prisma.service";
import { occurrencesFromLms } from "./core/occurrences";
import { parseMonthlyView } from "./core/parse-lms";
import { mustFullWalk } from "./core/schedule-plan";
import { monthsFrom, monthsWindow } from "./core/semester";
import { SyncDigest } from "./core/sync-digest";
import type { ParsedLmsCourse, ParsedLmsItem } from "./core/types";
import { EnrollmentDiscoveryService } from "./enrollment-discovery.service";
import { IngestionJobsService } from "./ingestion-jobs.service";
import { IngestionScheduleService } from "./ingestion-schedule.service";
import { MaterializerService } from "./materializer.service";
import {
  OccurrenceCacheService,
  type LmsWindow,
  type UnitTransition,
} from "./occurrence-cache.service";
import { OccurrenceFanoutService } from "./occurrence-fanout.service";
import {
  eachIntegrationTarget,
  errorMessage,
  FAILED_PASS,
  isIngestionEnabled,
  isOccurrenceCacheEnabled,
  jobItemBody,
  positiveConfig,
  sleep,
  statusCodeOf,
  type IntegrationTarget,
  type PassOutcome,
} from "./watcher-support";
import { NotificationsService } from "../notifications/notifications.service";

/**
 * Two: the current month and the next one. A quiz that opens on the 30th and
 * closes on the 2nd only ever appears as a complete open/close pair in one of
 * them — see `parse-lms.ts`.
 */
const MONTHS_PER_RUN = 2;

/**
 * Syncs one student's Moodle calendar.
 *
 * The most frequent of the three kinds — target period
 * `INGESTION_LMS_CALENDAR_PERIOD_MS`, an hour by default — because an
 * assignment deadline can be published or moved at any time and a student who
 * finds out an hour late still has time to react. The timetable and exam
 * schedules change a handful of times a term and get daily periods instead.
 *
 * **No cron of its own.** Since issue #56 `IngestionTickerService` claims this
 * kind (`LMS_CALENDAR`) on a rolling schedule. The decorator it replaced had
 * also drifted from its own docstring — it said hourly and was
 * `EVERY_30_MINUTES` — which is the sort of disagreement a target period in
 * config cannot have.
 *
 * ## Why the LMS cache is weaker than the portal's
 *
 * `core_calendar_get_calendar_monthly_view` is called with `courseid: 1`, the
 * *site* course, meaning "everything this user can see" — there is no
 * per-course calendar call anywhere in Moodle's AJAX surface. So the occurrence
 * cache here can only ever be *filled* by some student's own walk, and another
 * student may skip only when every course they are enrolled in was already
 * covered by someone else's walk.
 *
 * And it is guarded. Moodle has per-user and per-group due-date overrides and
 * group-restricted activities, so one student's view of a course is never
 * assumed to be a classmate's: a student is served only the view they last saw
 * themselves (the cached rows must still fingerprint to their own seen
 * fingerprint), and a change is fanned out only once two students have each
 * observed it — so one student's extension can never reach a whole course. See
 * `observeUnit` in `core/occurrences.ts`.
 */
@Injectable()
export class LmsWatcherService {
  private readonly logger = new Logger(LmsWatcherService.name);
  private readonly endpoint: string;
  private readonly timezone: string;
  private readonly requestDelayMs: number;
  private readonly discoveryMaxAgeMs: number;
  private readonly fullWalkEvery: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly lms: LMSService,
    private readonly jobs: IngestionJobsService,
    private readonly materializer: MaterializerService,
    private readonly notifications: NotificationsService,
    // Circular by construction: ingestion needs `revealCredentials`, and
    // `IntegrationsController` needs this watcher for the manual sync trigger.
    @Inject(forwardRef(() => IntegrationsService))
    private readonly integrations: IntegrationsService,
    private readonly discovery: EnrollmentDiscoveryService,
    private readonly cache: OccurrenceCacheService,
    private readonly fanout: OccurrenceFanoutService,
    private readonly schedule: IngestionScheduleService,
  ) {
    this.endpoint = this.config.get<string>("LMS_URL") ?? "";
    this.timezone = this.config.get<string>("DLU_TZ") ?? "Asia/Ho_Chi_Minh";
    this.requestDelayMs = Number(
      this.config.get("INGESTION_REQUEST_DELAY_MS") ?? 750,
    );
    this.discoveryMaxAgeMs = positiveConfig(
      this.config,
      "INGESTION_DISCOVERY_MAX_AGE_MS",
      48 * 60 * 60_000,
    );
    this.fullWalkEvery = positiveConfig(
      this.config,
      "INGESTION_FULL_WALK_EVERY",
      7,
    );
  }

  /**
   * Sync every connected student's Moodle calendar (or just `userId`'s).
   *
   * The manual `POST /integrations/LMS/sync` path since #56 — the background
   * pass comes through {@link syncOne} instead.
   *
   * Returns the number of integrations visited — not a write count. Per-pass
   * counts belong to the job rows and the log, never to a return value a
   * controller could be tempted to serialize.
   */
  async run(now = new Date(), userId?: string): Promise<number> {
    if (!isIngestionEnabled(this.config)) return 0;
    return eachIntegrationTarget(this.prisma, "LMS", userId, (target) =>
      this.syncOne(target, now),
    );
  }

  /**
   * One student's calendar pass — the unit the rolling ticker claims.
   *
   * Sign in once, then fetch each month with the same session. DLU sessions
   * expire quickly, so the session is held in a local for the pass and never
   * cached — the cost is `1 login + N fetches`, not `N × (login + fetch)`.
   */
  async syncOne(target: IntegrationTarget, now: Date): Promise<PassOutcome> {
    // The months this pass speaks for — the same two the walk below fetches.
    const window = monthsWindow(now, this.timezone, MONTHS_PER_RUN);

    const plan = await this.decide(target, now, window);
    if (plan.kind === "cache") {
      return this.serveFromCache(target, now, window, plan.courseIds);
    }

    const jobId = await this.jobs.startJob("LMS", target.integrationId);

    const session = await this.signIn(target, jobId);
    if (!session) return FAILED_PASS;

    // Changes are announced once per item type at the end of the run.
    const digest = new SyncDigest(new Date());

    let created = 0;
    let updated = 0;
    let skippedDeleted = 0;
    let skippedMoved = 0;
    let deleted = 0;
    let first = true;
    // Every externalKey any month of this run saw, and whether every fetch
    // succeeded — deletion reconciliation needs both (a missing month must not
    // read as "everything that month was cancelled").
    const seenKeys = new Set<string>();
    let allFetchesOk = true;
    // Every item across both months, for the cache. Items are keyed by Moodle
    // instance, so a quiz that shows up in both months is recorded once.
    const walked = new Map<string, ParsedLmsItem>();

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
          now,
          digest,
        );
        created += outcome.created;
        updated += outcome.updated;
        skippedDeleted += outcome.skippedDeleted;
        skippedMoved += outcome.skippedMoved;
        for (const item of parsed.items) {
          seenKeys.add(item.externalKey);
          walked.set(item.externalKey, item);
        }

        await this.jobs.completeItem("LMS", itemId, {
          status: "COMPLETED",
          statusCode: 200,
          responseBody: jobItemBody({ body: view, skipped: parsed.skipped }),
        });
        ingestionUpstreamItems.add(1, {
          operation: "lms_calendar",
          status: "COMPLETED",
        });
      } catch (error) {
        // One bad month does not abort the run: the other month may well have
        // come back fine, and the item row records exactly what went wrong.
        allFetchesOk = false;
        await this.jobs.completeItem("LMS", itemId, {
          status: "FAILED",
          statusCode: statusCodeOf(error),
          responseBody: jobItemBody({ error: errorMessage(error) }),
        });
        ingestionUpstreamItems.add(1, {
          operation: "lms_calendar",
          status: "FAILED",
        });
        this.logger.warn(
          `LMS calendar ${year}-${month} failed for integration ` +
            `${target.integrationId}: ${errorMessage(error)}`,
        );
      }
    }

    // Only retire vanished items when the whole window came back — otherwise a
    // failed month would delete every assignment it should have contained.
    if (allFetchesOk) {
      const recon = await this.materializer.reconcileDeleted(
        target.userId,
        "LMS",
        ["ASSIGNMENT", "EXAM"],
        seenKeys,
        now,
        digest,
      );
      deleted = recon.deleted;
      ingestionLastSuccess.record(now.getTime() / 1000, { provider: "LMS" });
    }

    await this.materializer.flushDigest(target.userId, digest, now);
    await this.recordAndFanOut(target, now, window, {
      items: [...walked.values()],
      complete: allFetchesOk,
    });
    await this.jobs.finishJob("LMS", jobId, "COMPLETED");

    if (created + updated + skippedDeleted + skippedMoved + deleted > 0) {
      this.logger.log(
        `LMS sync for integration ${target.integrationId}: ` +
          `${created} new, ${updated} updated, ` +
          `${skippedMoved} kept (student-moved), ` +
          `${skippedDeleted} skipped (student-deleted), ${deleted} removed`,
      );
    }

    return { ok: allFetchesOk, servedFromCache: false };
  }

  /**
   * Record this student's view of their courses into the shared cache, then
   * fan out any transition a classmate had already independently observed.
   * Recording is unconditional; fan-out is behind the cache flag.
   */
  private async recordAndFanOut(
    target: IntegrationTarget,
    now: Date,
    window: LmsWindow,
    input: { items: readonly ParsedLmsItem[]; complete: boolean },
  ): Promise<void> {
    const occurrences = occurrencesFromLms(input.items);
    let transitions: UnitTransition<number>[];
    try {
      const outcome = await this.cache.recordLmsItems(occurrences, {
        now,
        // A failed month must not be read as "every activity that month was
        // withdrawn" — the same discipline `reconcileDeleted` follows.
        complete: input.complete,
        userId: target.userId,
        window,
        // Confirmed courses with nothing in the window are a real "quiet
        // course" view, but only when discovery is fresh enough to name them.
        courseIds: (await this.trustedCourses(target, now)) ?? [],
        // An item with no course block cannot be cached, so a cache-served
        // view would miss it — and reconciling against that would retire it.
        cacheable: occurrences.length === input.items.length,
      });
      transitions = outcome.transitions;
    } catch (error) {
      // Best-effort: the student's own calendar is already written and correct.
      this.logger.warn(
        `Recording LMS occurrences failed for integration ` +
          `${target.integrationId}: ${errorMessage(error)}`,
      );
      return;
    }

    if (!isOccurrenceCacheEnabled(this.config)) return;
    if (transitions.length === 0) return;
    try {
      await this.fanout.fanOutLms(transitions, {
        excludeUserId: target.userId,
        window: { from: now, to: window.to },
        now,
      });
    } catch (error) {
      this.logger.warn(
        `LMS fan-out failed after integration ` +
          `${target.integrationId}: ${errorMessage(error)}`,
      );
    }
  }

  /** Confirmed courses, or `null` when discovery is too stale to trust. */
  private async trustedCourses(
    target: IntegrationTarget,
    now: Date,
  ): Promise<number[] | null> {
    const discoveredAt = await this.schedule.lastSuccessAt(
      target.integrationId,
      "LMS_DISCOVERY",
    );
    if (
      !discoveredAt ||
      now.getTime() - discoveredAt.getTime() > this.discoveryMaxAgeMs
    ) {
      return null;
    }
    return this.discovery.confirmedCourses(target.userId);
  }

  /**
   * Walk, or serve from cache? Every branch but the last returns `"walk"`, and
   * each `reason` is a log line.
   */
  private async decide(
    target: IntegrationTarget,
    now: Date,
    window: LmsWindow,
  ): Promise<
    { kind: "walk"; reason: string } | { kind: "cache"; courseIds: number[] }
  > {
    if (!isOccurrenceCacheEnabled(this.config)) {
      return { kind: "walk", reason: "cache-disabled" };
    }
    if (
      mustFullWalk({
        cacheHitStreak: target.cacheHitStreak ?? 0,
        fullWalkEvery: this.fullWalkEvery,
      })
    ) {
      return { kind: "walk", reason: "periodic-audit" };
    }

    const courseIds = await this.trustedCourses(target, now);
    if (courseIds === null) return { kind: "walk", reason: "discovery-stale" };
    // Moodle enrolment lags until a subject actually starts, so an empty set
    // is "we do not know yet", never "nothing to do".
    if (courseIds.length === 0) {
      return { kind: "walk", reason: "no-confirmed-courses" };
    }

    // Fresh coverage through the whole window AND the cached rows still exactly
    // this student's own last view — an override or group-only activity a
    // classmate sees differently makes the course stale for them.
    const { stale } = await this.cache.lmsFreshness(target.userId, courseIds, {
      now,
      window,
    });
    if (stale.length > 0) return { kind: "walk", reason: "courses-stale" };

    return { kind: "cache", courseIds };
  }

  /**
   * Answer a pass from the cache — **zero upstream requests**, not even the
   * four-step login. The job row and one synthetic item keep
   * `IntegrationStatus.lastSyncedAt` moving.
   *
   * Reconciles over `now … window.to`, which is exactly the materializer's LMS
   * reconcile window (`monthsWindow` and it both cover MONTHS_PER_RUN months),
   * and the cached view is by construction this student's own last one.
   */
  private async serveFromCache(
    target: IntegrationTarget,
    now: Date,
    window: LmsWindow,
    courseIds: readonly number[],
  ): Promise<PassOutcome> {
    const jobId = await this.jobs.startJob("LMS", target.integrationId);
    const itemId = await this.jobs.beginItem(
      "LMS",
      jobId,
      `cache:lms_calendar?courses=${courseIds.length}`,
    );
    const digest = new SyncDigest(new Date());

    try {
      const blocks = await this.cache.lmsBlocks(courseIds, {
        from: now,
        to: window.to,
      });
      const outcome = await this.materializer.materialize(
        target.userId,
        blocks,
        "LMS",
        now,
        digest,
      );
      const recon = await this.materializer.reconcileDeleted(
        target.userId,
        "LMS",
        ["ASSIGNMENT", "EXAM"],
        new Set(blocks.map((b) => b.externalKey)),
        now,
        digest,
      );

      await this.jobs.completeItem("LMS", itemId, {
        status: "COMPLETED",
        statusCode: null,
        responseBody: jobItemBody({
          body: {
            servedFromCache: true,
            courses: courseIds.length,
            blocks: blocks.length,
            created: outcome.created,
            updated: outcome.updated,
            removed: recon.deleted,
          },
        }),
      });
      ingestionUpstreamItems.add(1, {
        operation: "lms_calendar_cached",
        status: "COMPLETED",
      });
      ingestionLastSuccess.record(now.getTime() / 1000, { provider: "LMS" });

      await this.materializer.flushDigest(target.userId, digest, now);
      await this.jobs.finishJob("LMS", jobId, "COMPLETED");
      return { ok: true, servedFromCache: true };
    } catch (error) {
      await this.jobs.completeItem("LMS", itemId, {
        status: "FAILED",
        statusCode: null,
        responseBody: jobItemBody({ error: errorMessage(error) }),
      });
      await this.jobs.finishJob("LMS", jobId, "COMPLETED");
      this.logger.warn(
        `Cache-served LMS calendar failed for integration ` +
          `${target.integrationId}: ${errorMessage(error)}`,
      );
      return FAILED_PASS;
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
