import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { fromZonedTime } from "date-fns-tz";
import { UpstreamUnavailableError } from "../common/outbound-breaker";
import {
  ingestionLastSuccess,
  ingestionUpstreamItems,
} from "../observability/metrics";
import { PortalAPIService } from "../portal/portal-api.service";
import { PrismaService } from "../prisma/prisma.service";
import type { UnitJobData } from "../queue/queues";
import { occurrencesFromTimetable } from "./core/occurrences";
import { parseTimetable } from "./core/parse-portal";
import { isoWeek, resolveSemester } from "./core/semester";
import { SyncDigest } from "./core/sync-digest";
import { EnrollmentDiscoveryService } from "./enrollment-discovery.service";
import { IngestionJobsService } from "./ingestion-jobs.service";
import { MaterializerService } from "./materializer.service";
import { OccurrenceCacheService } from "./occurrence-cache.service";
import { OccurrenceFanoutService } from "./occurrence-fanout.service";
import { PortalSessionService } from "./portal-session.service";
import { SyncRunService, type RunNote } from "./sync-run.service";
import {
  errorMessage,
  isOccurrenceCacheEnabled,
  jobItemBody,
  statusCodeOf,
} from "./watcher-support";

const DAY_MS = 24 * 60 * 60_000;

/** `YYYY-MM-DD` of the Monday a week job is addressed by. */
export function weekUnit(monday: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(monday);
  return parts;
}

/** "HK02" -> "2". */
function termNumber(termId: string): string {
  return termId.replace(/^HK0?/, "");
}

/** "Sem 1 timetable is live", sent once per student after the term's start. */
function readyNote(semester: string, since: Date): RunNote {
  return {
    event: "timetable.ready",
    title: `Sem ${termNumber(semester)} timetable is live`,
    since,
  };
}

export interface WeekResult {
  ok: boolean;
  /** True when a live portal request was made. */
  fetched: boolean;
  /** Lectures created, and other rows updated or removed. */
  created?: number;
  changed?: number;
}

/**
 * One timetable week for one student: the body of a `portal-week` job.
 *
 * Reads the week from the shared occurrence cache when every confirmed section
 * has fresh coverage for it (and fans out nothing, there is nothing new);
 * otherwise fetches that week alone, records it into the cache and fans it out
 * to classmates. Sessions are written silently; the run raises one notice for
 * the first week that changed anything.
 */
@Injectable()
export class TimetableWeekService {
  private readonly logger = new Logger(TimetableWeekService.name);
  private readonly tz: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly portal: PortalAPIService,
    private readonly session: PortalSessionService,
    private readonly jobs: IngestionJobsService,
    private readonly materializer: MaterializerService,
    private readonly discovery: EnrollmentDiscoveryService,
    private readonly cache: OccurrenceCacheService,
    private readonly fanout: OccurrenceFanoutService,
    private readonly runs: SyncRunService,
  ) {
    this.tz = this.config.get<string>("DLU_TZ") ?? "Asia/Ho_Chi_Minh";
  }

  async syncWeek(data: UnitJobData, now = new Date()): Promise<WeekResult> {
    const weekStart = fromZonedTime(`${data.unit}T00:00:00.000`, this.tz);
    const weekEnd = new Date(weekStart.getTime() + 7 * DAY_MS - 1);
    // Resolved at the week's midweek day with no lookahead: the week, not
    // today, decides which term it belongs to.
    const term = resolveSemester(
      new Date(weekStart.getTime() + 3 * DAY_MS),
      this.tz,
      0,
    );
    const coords = { academicYear: term.academicYear, termId: term.semester };
    const sectionIds = await this.discovery.confirmedSections(
      data.userId,
      coords,
    );

    const outcome = (await this.canServeFromCache(
      data.userId,
      sectionIds,
      weekStart,
      weekEnd,
      now,
    ))
      ? await this.fromCache(data, sectionIds, weekStart, weekEnd, now)
      : await this.fromPortal(data, term, sectionIds, weekStart, weekEnd, now);

    const { created, other } = outcome.changes;
    // The first lectures of a term announce it right away; anything later is
    // worded once the whole run is summed (SyncRunService.settleIfComplete).
    if (outcome.ok && created > 0 && (await this.termWasEmpty(data, term))) {
      await this.runs.notifyOnce(
        data.runId,
        data.userId,
        readyNote(term.semester, term.startDate),
        now,
      );
    }
    return {
      ok: outcome.ok,
      fetched: outcome.fetched,
      created,
      changed: other,
    };
  }

  /** True when the student had no portal lectures in the term before this run began. */
  private async termWasEmpty(
    data: UnitJobData,
    term: { startDate: Date; endDate: Date },
  ): Promise<boolean> {
    const run = await this.prisma.syncRun.findUnique({
      where: { id: data.runId },
      select: { createdAt: true },
    });
    const before = await this.prisma.session.count({
      where: {
        userId: data.userId,
        source: "PORTAL",
        type: "LECTURE",
        scheduledStartTime: { gte: term.startDate, lte: term.endDate },
        createdAt: { lt: run?.createdAt ?? new Date() },
      },
    });
    return before === 0;
  }

  /** Everything the cache must satisfy before a week is read from it. */
  private async canServeFromCache(
    userId: string,
    sectionIds: readonly string[],
    weekStart: Date,
    weekEnd: Date,
    now: Date,
  ): Promise<boolean> {
    if (!isOccurrenceCacheEnabled(this.config)) return false;
    // "We do not know" (e.g. not registered yet) is never "nothing to do".
    if (sectionIds.length === 0) return false;
    // A student still on the pre-cache lecture key needs one live read so the
    // materializer can adopt those rows instead of duplicating them.
    const legacy = await this.prisma.session.count({
      where: {
        userId,
        source: "PORTAL",
        type: "LECTURE",
        externalKey: { startsWith: "portal:meeting:" },
      },
    });
    if (legacy > 0) return false;
    const { stale } = await this.cache.weekFreshness(sectionIds, {
      now,
      weekStart,
      weekEnd,
    });
    return stale.length === 0;
  }

  private async fromCache(
    data: UnitJobData,
    sectionIds: readonly string[],
    weekStart: Date,
    weekEnd: Date,
    now: Date,
  ): Promise<WeekOutcome> {
    const jobId = await this.jobs.startJob("PORTAL", data.integrationId);
    const itemId = await this.jobs.beginItem(
      "PORTAL",
      jobId,
      `cache:portal_timetable_week?week=${data.unit}&sections=${sectionIds.length}`,
    );
    try {
      const digest = new SyncDigest(new Date());
      const blocks = await this.cache.timetableBlocks(sectionIds, {
        from: weekStart,
        to: weekEnd,
      });
      const written = await this.materializer.materialize(
        data.userId,
        blocks,
        "PORTAL",
        now,
        digest,
      );
      const recon = await this.reconcileWeek(
        data.userId,
        new Set(blocks.map((b) => b.externalKey)),
        weekStart,
        weekEnd,
        now,
        digest,
      );
      await this.materializer.flushDigest(data.userId, digest, now, {
        silent: true,
      });
      await this.jobs.completeItem("PORTAL", itemId, {
        status: "COMPLETED",
        statusCode: null,
        responseBody: jobItemBody({
          body: { servedFromCache: true, blocks: blocks.length },
        }),
      });
      await this.jobs.finishJob("PORTAL", jobId, "COMPLETED");
      ingestionUpstreamItems.add(1, {
        operation: "portal_timetable_cached",
        status: "COMPLETED",
      });
      return {
        ok: true,
        fetched: false,
        changes: {
          created: written.created,
          other: written.updated + recon.deleted,
        },
      };
    } catch (error) {
      await this.jobs.completeItem("PORTAL", itemId, {
        status: "FAILED",
        statusCode: null,
        responseBody: jobItemBody({ error: errorMessage(error) }),
      });
      await this.jobs.finishJob("PORTAL", jobId, "COMPLETED");
      this.logger.warn(
        `Cached week ${data.unit} failed for integration ${data.integrationId}: ${errorMessage(error)}`,
      );
      return { ok: false, fetched: false, changes: { created: 0, other: 0 } };
    }
  }

  private async fromPortal(
    data: UnitJobData,
    term: { academicYear: string; semester: string; startDate: Date },
    sectionIds: readonly string[],
    weekStart: Date,
    weekEnd: Date,
    now: Date,
  ): Promise<WeekOutcome> {
    const jobId = await this.jobs.startJob("PORTAL", data.integrationId);
    let token: string | null;
    try {
      token = await this.session.token(data.userId);
    } catch (error) {
      if (error instanceof UpstreamUnavailableError) {
        await this.jobs.discardJob("PORTAL", jobId);
      }
      throw error;
    }
    if (!token) {
      await this.jobs.finishJob("PORTAL", jobId, "FAILED");
      return { ok: false, fetched: false, changes: { created: 0, other: 0 } };
    }

    const week = isoWeek(new Date(weekStart.getTime() + 3 * DAY_MS), this.tz);
    const url = `${this.portalBase()}/api/student/DrawingStudentSchedules?namhoc=${term.academicYear}&hocky=${term.semester}&tuan=${week}`;
    const itemId = await this.jobs.beginItem("PORTAL", jobId, url);
    try {
      const rows = await this.portal.fetchTimetable(
        token,
        term.academicYear,
        term.semester,
        week,
      );
      const parsed = parseTimetable(rows, this.tz);
      for (const section of parsed.sections) {
        const { scheduleStudyUnitId, ...fields } = section;
        await this.prisma.portalSection.upsert({
          where: { scheduleStudyUnitId },
          create: { scheduleStudyUnitId, ...fields },
          update: fields,
        });
      }
      const digest = new SyncDigest(new Date());
      const written = await this.materializer.materialize(
        data.userId,
        parsed.items,
        "PORTAL",
        now,
        digest,
      );
      // The response is the full picture of this week, so a lecture it no longer
      // lists inside the week is a cancellation.
      const recon = await this.reconcileWeek(
        data.userId,
        new Set(parsed.items.map((i) => i.externalKey)),
        weekStart,
        weekEnd,
        now,
        digest,
      );
      await this.materializer.flushDigest(data.userId, digest, now, {
        silent: true,
      });
      await this.recordAndFanOut(
        data,
        parsed.items,
        { ...term, week },
        sectionIds,
        weekStart,
        weekEnd,
        now,
      );
      await this.jobs.completeItem("PORTAL", itemId, {
        status: "COMPLETED",
        statusCode: 200,
        responseBody: jobItemBody({ body: rows, skipped: parsed.skipped }),
      });
      await this.jobs.finishJob("PORTAL", jobId, "COMPLETED");
      ingestionUpstreamItems.add(1, {
        operation: "portal_timetable",
        status: "COMPLETED",
      });
      ingestionLastSuccess.record(now.getTime() / 1000, { provider: "PORTAL" });
      return {
        ok: true,
        fetched: true,
        changes: {
          created: written.created,
          other: written.updated + recon.deleted,
        },
      };
    } catch (error) {
      if (error instanceof UpstreamUnavailableError) {
        await this.jobs.discardJob("PORTAL", jobId);
        throw error;
      }
      await this.jobs.completeItem("PORTAL", itemId, {
        status: "FAILED",
        statusCode: statusCodeOf(error),
        responseBody: jobItemBody({ error: errorMessage(error) }),
      });
      await this.jobs.finishJob("PORTAL", jobId, "COMPLETED");
      ingestionUpstreamItems.add(1, {
        operation: "portal_timetable",
        status: "FAILED",
      });
      this.logger.warn(
        `Timetable week ${data.unit} failed for integration ${data.integrationId}: ${errorMessage(error)}`,
      );
      // Retried by the queue; the unit is only marked failed on the last attempt.
      throw error;
    }
  }

  /** Cancellation pass limited to the week, and to now onward. */
  private reconcileWeek(
    userId: string,
    seen: ReadonlySet<string>,
    weekStart: Date,
    weekEnd: Date,
    now: Date,
    digest: SyncDigest,
  ) {
    return this.materializer.reconcileDeleted(
      userId,
      "PORTAL",
      ["LECTURE"],
      seen,
      now,
      digest,
      { from: now > weekStart ? now : weekStart, to: weekEnd },
    );
  }

  private async recordAndFanOut(
    data: UnitJobData,
    items: ReturnType<typeof parseTimetable>["items"],
    coords: {
      academicYear: string;
      semester: string;
      week: number;
      startDate: Date;
    },
    sectionIds: readonly string[],
    weekStart: Date,
    weekEnd: Date,
    now: Date,
  ): Promise<void> {
    try {
      const outcome = await this.cache.recordTimetableWeek(
        occurrencesFromTimetable(items, {
          isoWeek: coords.week,
          yearStudy: coords.academicYear,
          termId: coords.semester,
        }),
        {
          isoWeek: coords.week,
          now,
          complete: true,
          throughDate: weekEnd,
          sectionIds,
          weekStart,
        },
      );
      if (!isOccurrenceCacheEnabled(this.config)) return;
      if (outcome.touchedIds.length === 0 && outcome.canceledKeys.length === 0)
        return;
      await this.fanout.fanOutTimetable(
        outcome.touchedIds,
        outcome.canceledKeys,
        {
          excludeUserId: data.userId,
          window: { from: now > weekStart ? now : weekStart, to: weekEnd },
          now,
          silent: true,
          onCreated: async (classmateId) => {
            await this.runs.notifyOnce(
              null,
              classmateId,
              readyNote(coords.semester, coords.startDate),
            );
          },
        },
      );
    } catch (error) {
      // Best-effort: the student's own calendar is already correct, and a
      // classmate who missed the fan-out reads this week from cache or fetches it.
      this.logger.warn(
        `Recording week ${data.unit} failed for integration ${data.integrationId}: ${errorMessage(error)}`,
      );
    }
  }

  private portalBase(): string {
    return this.config.get<string>("PORTAL_API_URL") ?? "";
  }
}

interface WeekOutcome {
  ok: boolean;
  fetched: boolean;
  changes: { created: number; other: number };
}
