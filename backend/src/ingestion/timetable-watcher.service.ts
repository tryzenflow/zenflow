import { forwardRef, Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  ingestionLastSuccess,
  ingestionUpstreamItems,
} from "../observability/metrics";
import { IntegrationsService } from "../integrations/integrations.service";
import { PortalAPIService } from "../portal/portal-api.service";
import { PrismaService } from "../prisma/prisma.service";
import { occurrencesFromTimetable } from "./core/occurrences";
import { parseTimetable } from "./core/parse-portal";
import { mustFullWalk } from "./core/schedule-plan";
import {
  isoWeeksBetween,
  isoWeekStart,
  resolveSemester,
} from "./core/semester";
import { SyncDigest } from "./core/sync-digest";
import type { ParsedPortalSection } from "./core/types";
import { IngestionJobsService } from "./ingestion-jobs.service";
import { MaterializerService } from "./materializer.service";
import { EnrollmentDiscoveryService } from "./enrollment-discovery.service";
import { IngestionScheduleService } from "./ingestion-schedule.service";
import { OccurrenceCacheService } from "./occurrence-cache.service";
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

/**
 * Syncs one student's class timetable.
 *
 * **No cron of its own.** Since issue #56 this watcher is driven by
 * `IngestionTickerService`, which claims the most-overdue students for the
 * `PORTAL_TIMETABLE` kind on a rolling schedule with target period
 * `INGESTION_TIMETABLE_PERIOD_MS` (24h by default). It used to be a single
 * `@Cron` whose firing swept the entire population at one instant — the same
 * daily volume, but concentrated in one window, which against a real portal
 * reads as a batch job rather than as students using a calendar.
 *
 * A daily-ish period, not hourly: a published timetable moves a handful of times
 * a term, so polling it hourly would be almost entirely wasted requests.
 *
 * The portal has no "give me the current week" call: the endpoint is addressed
 * by academic coordinates `(academicYear, semester, tuan)`, so every pass first
 * resolves which term "now" falls in (`ingestion/core/semester.ts`) and then
 * walks **every remaining ISO week of that term**, so a student who looks
 * months ahead sees a populated calendar rather than an empty one.
 *
 * That is ~20 requests per student on the first pass of a term, shrinking by one
 * a week as the term is consumed, spaced by `INGESTION_REQUEST_DELAY_MS`. There
 * is also no per-*section* endpoint — a week is addressed by student — which is
 * why the occurrence cache pays off cohort-wise rather than section-wise: one
 * stale section forces this student's whole walk, and that walk warms every
 * section they attend for all of their classmates.
 *
 * `run(now, userId?)` survives unchanged as the manual
 * `POST /integrations/PORTAL/sync` path, so there is still exactly one code
 * path doing the work.
 */
@Injectable()
export class TimetableWatcherService {
  private readonly logger = new Logger(TimetableWatcherService.name);
  private readonly endpoint: string;
  private readonly dluTimezone: string;
  private readonly requestDelayMs: number;
  private readonly fullWalkEvery: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly portal: PortalAPIService,
    private readonly jobs: IngestionJobsService,
    private readonly materializer: MaterializerService,
    @Inject(forwardRef(() => IntegrationsService))
    private readonly integrations: IntegrationsService,
    // The issue-#56 cache trio, consulted only through `decide()` and the
    // post-walk recording step — so the flag-off path is the pre-#56 code.
    private readonly discovery: EnrollmentDiscoveryService,
    private readonly cache: OccurrenceCacheService,
    private readonly fanout: OccurrenceFanoutService,
    private readonly schedule: IngestionScheduleService,
  ) {
    this.endpoint = this.config.get<string>("PORTAL_API_URL") ?? "";
    this.dluTimezone = this.config.get<string>("DLU_TZ") ?? "Asia/Ho_Chi_Minh";
    this.requestDelayMs = Number(
      this.config.get("INGESTION_REQUEST_DELAY_MS") ?? 750,
    );
    this.fullWalkEvery = positiveConfig(
      this.config,
      "INGESTION_FULL_WALK_EVERY",
      7,
    );
  }

  /**
   * Sync every connected student's timetable (or just `userId`'s).
   *
   * Since #56 the rolling ticker drives per-student passes directly through
   * {@link syncOne}, so this whole-population sweep exists for the manual
   * `POST /integrations/PORTAL/sync` trigger — one student, immediately. It is
   * deliberately the same code the background pass runs, narrowed by `userId`,
   * rather than a second path that could drift.
   */
  async run(now = new Date(), userId?: string): Promise<number> {
    if (!isIngestionEnabled(this.config)) return 0;
    return eachIntegrationTarget(this.prisma, "PORTAL", userId, (target) =>
      this.syncOne(target, now),
    );
  }

  /** One student's timetable pass. The unit the rolling ticker claims. */
  async syncOne(target: IntegrationTarget, now: Date): Promise<PassOutcome> {
    // The academic coordinates are a property of the university's calendar, so
    // they are resolved in DLU's timezone, never the student's.
    const term = resolveSemester(now, this.dluTimezone);

    // The gate: no timetable request is made for a student whose enrolment has
    // not been discovered for this term. Normally the ticker's discovery pass
    // got there first; if not (a new integration, a term change, a manual
    // sync), run it now, and if it fails there is nothing to fetch yet.
    if (!(await this.schedule.isDiscovered(target.integrationId, term))) {
      const discovered = await this.discovery.syncPortal(target, now);
      if (!discovered.ok) return FAILED_PASS;
    }

    // Can this pass be answered from the cross-student cache instead?
    const plan = await this.decide(target, now, term);
    if (plan.kind === "cache") {
      return this.serveFromCache(target, now, term, plan.sectionIds);
    }

    const jobId = await this.jobs.startJob("PORTAL", target.integrationId);

    const token = await this.signIn(target, jobId);
    if (!token) return FAILED_PASS;

    // Changes are announced once per item type at the end of the run.
    const digest = new SyncDigest(new Date());

    const { academicYear, semester, startDate, endDate } = term;

    const from = now > startDate ? now : startDate;
    const weeks = isoWeeksBetween(from, endDate, this.dluTimezone);

    let created = 0;
    let updated = 0;
    let skippedDeleted = 0;
    let skippedMoved = 0;
    let deleted = 0;
    let first = true;
    // Every meeting key the run saw, plus whether every week came back — the
    // deletion pass needs both, so a failed week is not read as "every class
    // that week was cancelled".
    const seenKeys = new Set<string>();
    let allFetchesOk = true;
    // Per-week occurrence rows, recorded after the walk so a failed week can
    // suppress the cancellation pass for every week at once.
    const weekResults: {
      week: number;
      occurrences: ReturnType<typeof occurrencesFromTimetable>;
    }[] = [];

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
          now,
          digest,
        );
        created += outcome.created;
        updated += outcome.updated;
        skippedDeleted += outcome.skippedDeleted;
        skippedMoved += outcome.skippedMoved;
        for (const item of parsed.items) seenKeys.add(item.externalKey);

        // Warm the cross-student cache with what this week's fetch found.
        // Deliberately NOT behind the cache flag: flipping the flag on should
        // find a warm, already-validated cache rather than a cold one that
        // doing full-cost walks anyway. Costs zero upstream
        // requests — the fetch happened regardless.
        weekResults.push({
          week,
          occurrences: occurrencesFromTimetable(parsed.items, {
            isoWeek: week,
            yearStudy: academicYear,
            termId: semester,
          }),
        });

        await this.jobs.completeItem("PORTAL", itemId, {
          status: "COMPLETED",
          statusCode: 200,
          responseBody: jobItemBody({ body: rows, skipped: parsed.skipped }),
        });
        ingestionUpstreamItems.add(1, {
          operation: "portal_timetable",
          status: "COMPLETED",
        });
      } catch (error) {
        allFetchesOk = false;
        await this.jobs.completeItem("PORTAL", itemId, {
          status: "FAILED",
          statusCode: statusCodeOf(error),
          responseBody: jobItemBody({ error: errorMessage(error) }),
        });
        ingestionUpstreamItems.add(1, {
          operation: "portal_timetable",
          status: "FAILED",
        });
        this.logger.warn(
          `Timetable week ${week} failed for integration ` +
            `${target.integrationId}: ${errorMessage(error)}`,
        );
      }
    }

    // Lectures upstream no longer lists for the rest of the term are cancelled
    // classes — retire them, but only if every week came back.
    if (allFetchesOk) {
      const recon = await this.materializer.reconcileDeleted(
        target.userId,
        "PORTAL",
        ["LECTURE"],
        seenKeys,
        now,
        digest,
      );
      deleted = recon.deleted;
      ingestionLastSuccess.record(now.getTime() / 1000, { provider: "PORTAL" });
    }

    await this.materializer.flushDigest(target.userId, digest, now);

    // Record the walk into the shared cache, then push whatever changed out to
    // the classmates who share those sections. `complete: allFetchesOk` is the
    // same discipline `reconcileDeleted` uses above and matters more here: a
    // 503 on one week misread as "these classes were cancelled" would fan that
    // mistake out to everyone in the section, not just this student.
    await this.recordAndFanOut(target, now, {
      weekResults,
      complete: allFetchesOk,
      throughDate: endDate,
    });
    await this.jobs.finishJob("PORTAL", jobId, "COMPLETED");

    if (created + updated + skippedDeleted + skippedMoved + deleted > 0) {
      this.logger.log(
        `Timetable sync for integration ${target.integrationId}: ` +
          `${created} new, ${updated} updated, ` +
          `${skippedMoved} kept (student-moved), ` +
          `${skippedDeleted} skipped (student-deleted), ${deleted} removed`,
      );
    }

    // `ok` is `allFetchesOk`, not "the job row completed": a pass survives one
    // failed week, but it must not then be treated as a complete picture.
    return { ok: allFetchesOk, servedFromCache: false };
  }

  /**
   * Store what the walk found in the cross-student cache, and fan any change out
   * to the classmates who share the affected sections.
   *
   * Recording is unconditional (it is free — the fetch already happened);
   * fanning out is behind the cache flag, because it writes other students'
   * `Session` rows.
   */
  private async recordAndFanOut(
    target: IntegrationTarget,
    now: Date,
    input: {
      weekResults: {
        week: number;
        occurrences: ReturnType<typeof occurrencesFromTimetable>;
      }[];
      complete: boolean;
      throughDate: Date;
    },
  ): Promise<void> {
    const touched = new Set<string>();
    const canceledKeys: string[] = [];

    try {
      for (const { week, occurrences } of input.weekResults) {
        const outcome = await this.cache.recordTimetableWeek(occurrences, {
          isoWeek: week,
          now,
          complete: input.complete,
          throughDate: input.throughDate,
        });
        for (const id of outcome.touchedIds) touched.add(id);
        canceledKeys.push(...outcome.canceledKeys);
      }
    } catch (error) {
      // Best-effort: the student's own calendar is already written and correct.
      // A cache that failed to record simply stays stale, which costs a walk.
      this.logger.warn(
        `Recording timetable occurrences failed for integration ` +
          `${target.integrationId}: ${errorMessage(error)}`,
      );
      return;
    }

    if (!isOccurrenceCacheEnabled(this.config)) return;
    if (touched.size === 0 && canceledKeys.length === 0) return;

    try {
      await this.fanout.fanOutTimetable([...touched], canceledKeys, {
        excludeUserId: target.userId,
        window: { from: now, to: input.throughDate },
        now,
      });
    } catch (error) {
      // Likewise best-effort: a classmate who missed the fan-out picks the
      // change up on their own next pass.
      this.logger.warn(
        `Timetable fan-out failed after integration ` +
          `${target.integrationId}: ${errorMessage(error)}`,
      );
    }
  }

  /**
   * Decide whether this pass has to walk, or may be served from the cache.
   *
   * Every branch below returns `"walk"`, which is the point: the only path to
   * `"cache"` is through all of them. Each `reason` becomes a metric label and a
   * log line, so a rollout can be debugged by asking "why did nobody get
   * cached?" rather than by reading this method again.
   */
  private async decide(
    target: IntegrationTarget,
    now: Date,
    term: { academicYear: string; semester: string; endDate: Date },
  ): Promise<
    { kind: "walk"; reason: string } | { kind: "cache"; sectionIds: string[] }
  > {
    // 1 — the rollout gate. Off means the pre-#56 behaviour, exactly.
    if (!isOccurrenceCacheEnabled(this.config)) {
      return { kind: "walk", reason: "cache-disabled" };
    }

    // 2 — the periodic audit. Without it a cohort could sit indefinitely on
    // occurrences that keep looking fresh, and a change to a section nobody
    // walks would never be noticed.
    if (
      mustFullWalk({
        cacheHitStreak: target.cacheHitStreak ?? 0,
        fullWalkEvery: this.fullWalkEvery,
      })
    ) {
      return { kind: "walk", reason: "periodic-audit" };
    }

    // 3 — are this student's rows still on the pre-#56 lecture key?
    //
    // A cached occurrence cannot mint a student's old per-student
    // `portal:meeting:<WeekScheduleID>` key, so serving such a student from
    // cache would insert a duplicate of every lecture and then let
    // `reconcileDeleted` retire the originals — losing their `lastMovedAt` and
    // announcing their whole timetable as cancelled. One live walk adopts the
    // rows (`MaterializerService.adoptLegacyKey`), after which this count is
    // zero forever. The check disappears with the legacy alias.
    const legacyRows = await this.prisma.session.count({
      where: {
        userId: target.userId,
        source: "PORTAL",
        type: "LECTURE",
        deleted: false,
        externalKey: { startsWith: "portal:meeting:" },
      },
    });
    if (legacyRows > 0) {
      return { kind: "walk", reason: "legacy-keys-pending" };
    }

    // 4 — which sections is the student confirmed in? Discovery has already
    // succeeded for this term (the gate in `syncOne`).
    const sectionIds = await this.discovery.confirmedSections(target.userId, {
      academicYear: term.academicYear,
      termId: term.semester,
    });
    // An empty set is not "nothing to do" — it is "we do not know", e.g. a
    // student who has not registered yet. Walk, and never skip.
    if (sectionIds.length === 0) {
      return { kind: "walk", reason: "no-confirmed-sections" };
    }

    // 5 — is every one of their sections cached,
    // through the whole remaining term? A section nobody has cached yet counts as stale, which is how a
    // newly-registered section is always discovered by a real fetch.
    const { stale } = await this.cache.timetableFreshness(sectionIds, {
      now,
      throughDate: term.endDate,
    });
    if (stale.length > 0) {
      // Note this forces the student's WHOLE walk, not just the stale section:
      // the portal has no per-section endpoint. That walk then warms every
      // section they attend for all of their classmates, which is why the
      // saving is cohort-shaped rather than section-shaped.
      return { kind: "walk", reason: "sections-stale" };
    }

    return { kind: "cache", sectionIds };
  }

  /**
   * Answer a pass entirely from the cache — **zero upstream requests**.
   *
   * Still writes a job and one synthetic item, because
   * `IntegrationStatus.lastSyncedAt` / `.lastSyncStatus` are derived from those
   * rows: a student whose calendar is being kept current from the cache must not
   * appear to have stopped syncing.
   */
  private async serveFromCache(
    target: IntegrationTarget,
    now: Date,
    term: { startDate: Date; endDate: Date },
    sectionIds: readonly string[],
  ): Promise<PassOutcome> {
    const jobId = await this.jobs.startJob("PORTAL", target.integrationId);
    const itemId = await this.jobs.beginItem(
      "PORTAL",
      jobId,
      // Not a URL, deliberately: nothing was requested. The `cache:` scheme
      // makes that obvious in the job row rather than implying a fetch.
      `cache:portal_timetable?sections=${sectionIds.length}`,
    );
    const digest = new SyncDigest(new Date());

    try {
      // From the Monday of the first week a walk would fetch, not from `now`:
      // a walk writes the whole current week, earlier days included, so a
      // student first served from cache must get those meetings too.
      const window = {
        from: isoWeekStart(
          now > term.startDate ? now : term.startDate,
          this.dluTimezone,
        ),
        to: term.endDate,
      };
      const blocks = await this.cache.timetableBlocks(sectionIds, window);
      const outcome = await this.materializer.materialize(
        target.userId,
        blocks,
        "PORTAL",
        now,
        digest,
      );
      // The cache holds every meeting of every confirmed section for the rest of
      // the term, so the block set IS the complete picture — the same condition
      // `allFetchesOk` guards on the walk path, which is what makes reconciling
      // deletions safe here too.
      const seenKeys = new Set(blocks.map((b) => b.externalKey));
      const recon = await this.materializer.reconcileDeleted(
        target.userId,
        "PORTAL",
        ["LECTURE"],
        seenKeys,
        now,
        digest,
      );

      await this.jobs.completeItem("PORTAL", itemId, {
        status: "COMPLETED",
        statusCode: null,
        responseBody: jobItemBody({
          body: {
            servedFromCache: true,
            sections: sectionIds.length,
            blocks: blocks.length,
            created: outcome.created,
            updated: outcome.updated,
            removed: recon.deleted,
          },
        }),
      });
      ingestionUpstreamItems.add(1, {
        operation: "portal_timetable_cached",
        status: "COMPLETED",
      });
      ingestionLastSuccess.record(now.getTime() / 1000, { provider: "PORTAL" });

      await this.materializer.flushDigest(target.userId, digest, now);
      await this.jobs.finishJob("PORTAL", jobId, "COMPLETED");

      this.logger.debug(
        `Timetable served from cache for integration ${target.integrationId}: ` +
          `${blocks.length} meeting(s) across ${sectionIds.length} section(s)`,
      );
      return { ok: true, servedFromCache: true };
    } catch (error) {
      await this.jobs.completeItem("PORTAL", itemId, {
        status: "FAILED",
        statusCode: null,
        responseBody: jobItemBody({ error: errorMessage(error) }),
      });
      await this.jobs.finishJob("PORTAL", jobId, "COMPLETED");
      this.logger.warn(
        `Cache-served timetable failed for integration ` +
          `${target.integrationId}: ${errorMessage(error)}`,
      );
      // A broken cache read must not look like a success: the pass is recorded
      // as failed, so `lastSuccessAt` stays put and the next pass walks.
      return FAILED_PASS;
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
