import { Injectable, Logger } from "@nestjs/common";
import type { IngestionSyncKind, SyncRun } from "../../generated/prisma";
import { localizeNotification } from "../notifications/localize-notification";
import { NotificationsService } from "../notifications/notifications.service";
import { NotificationEvent } from "../notifications/types";
import { PrismaService } from "../prisma/prisma.service";
import {
  IngestionScheduleService,
  type ClaimedTarget,
} from "./ingestion-schedule.service";
import { errorMessage } from "./watcher-support";

/** A run whose jobs have not all reported after this long is closed as failed. */
export const STALE_RUN_MS = 30 * 60_000;

export interface StartRunInput {
  integrationId: string;
  kind: IngestionSyncKind;
  /** "<year>-<term>" for a timetable, "calendar" for LMS. */
  scope: string;
  units: readonly string[];
  claim: ClaimedTarget;
}

export interface UnitReport {
  ok: boolean;
  /** True when a live request was made for this unit. */
  fetched: boolean;
}

/**
 * Tracks a fan-out pass (a term split into week jobs, or an LMS calendar split
 * into month jobs) so the schedule row is settled once every unit finished, and
 * so at most one notification is raised per pass.
 */
@Injectable()
export class SyncRunService {
  private readonly logger = new Logger(SyncRunService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly schedule: IngestionScheduleService,
    private readonly notifications: NotificationsService,
  ) {}

  async start(input: StartRunInput): Promise<SyncRun> {
    return this.prisma.syncRun.create({
      data: {
        integrationId: input.integrationId,
        kind: input.kind,
        scope: input.scope,
        totalUnits: input.units.length,
        scheduleId: input.claim.scheduleId,
        claimedAt: input.claim.claimedAt,
        dueAt: input.claim.dueAt,
        cacheHitStreak: input.claim.cacheHitStreak,
        units: { create: input.units.map((unit) => ({ unit })) },
      },
    });
  }

  /** Drop a run whose jobs could not be enqueued; the caller releases the claim. */
  async discard(runId: string): Promise<void> {
    await this.prisma.syncRun.deleteMany({ where: { id: runId } });
  }

  /**
   * Record one unit's outcome. The job that settles the last pending unit wins
   * a compare-and-set on `finishedAt` and settles the schedule row.
   */
  async report(
    runId: string,
    unit: string,
    result: UnitReport,
    now = new Date(),
  ): Promise<void> {
    await this.prisma.syncRunUnit.updateMany({
      where: { runId, unit, status: "PENDING" },
      data: { status: result.ok ? "DONE" : "FAILED", fetched: result.fetched },
    });
    await this.settleIfComplete(runId, now);
  }

  /**
   * Raise the run's single notification. Only the first caller per run wins;
   * later weeks and months stay silent.
   */
  async notifyOnce(
    runId: string | null,
    userId: string,
    note: { event: "timetable.ready" | "timetable.changed"; title: string },
    now = new Date(),
  ): Promise<boolean> {
    if (runId) {
      const { count } = await this.prisma.syncRun.updateMany({
        where: { id: runId, notifiedAt: null },
        data: { notifiedAt: now },
      });
      if (count !== 1) return false;
    }
    try {
      // "Available" is announced once per student and term, across runs and
      // across fan-out, so a classmate whose weeks arrived by fan-out is told
      // too. Two jobs can race to announce the same term to the same student;
      // a transaction-scoped advisory try-lock lets exactly one through and the
      // loser skips instead of waiting (the winner is already writing the row).
      const row = await this.prisma.$transaction(async (tx) => {
        const key = `notice:${userId}:${note.event}:${note.title}`;
        const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(hashtext(${key})) AS locked`;
        if (!locked) return null;
        if (note.event === "timetable.ready") {
          const existing = await tx.notification.findFirst({
            where: {
              userId,
              eventName: note.event,
              // Stored localised, so match the Vietnamese form as well.
              title: {
                in: [
                  note.title,
                  localizeNotification(
                    { eventName: note.event, title: note.title, content: "" },
                    "VI_VN",
                  ).title,
                ],
              },
            },
            select: { id: true },
          });
          if (existing) return null;
        }
        return this.notifications.create(
          userId,
          {
            sessionId: null,
            title: note.title,
            content:
              note.event === "timetable.ready"
                ? "You may not see every week yet. We're still syncing."
                : "See what changed.",
            eventEndsAt: null,
            materializeSession: false,
            eventName: note.event,
          },
          tx,
        );
      });
      if (!row) return false;
      this.notifications.notify(NotificationEvent.NEW_SESSION, row);
    } catch (error) {
      this.logger.warn(`Could not raise ${note.event}: ${errorMessage(error)}`);
      return false;
    }
    return true;
  }

  /**
   * Close runs whose jobs vanished (removed, stalled out of retention): pending
   * units count as failed so the claim is handed back and the row is due again.
   */
  async sweepStale(now = new Date(), limit = 20): Promise<number> {
    const cutoff = new Date(now.getTime() - STALE_RUN_MS);
    const stale = await this.prisma.syncRun.findMany({
      where: { finishedAt: null, createdAt: { lt: cutoff } },
      select: { id: true },
      take: limit,
    });
    for (const { id } of stale) {
      await this.prisma.syncRunUnit.updateMany({
        where: { runId: id, status: "PENDING" },
        data: { status: "FAILED" },
      });
      await this.settleIfComplete(id, now);
    }
    return stale.length;
  }

  /** Delete finished runs older than `olderThanMs`. */
  async prune(now = new Date(), olderThanMs = 7 * 24 * 60 * 60_000) {
    await this.prisma.syncRun.deleteMany({
      where: {
        finishedAt: { not: null },
        createdAt: { lt: new Date(now.getTime() - olderThanMs) },
      },
    });
  }

  private async settleIfComplete(runId: string, now: Date): Promise<void> {
    const pending = await this.prisma.syncRunUnit.count({
      where: { runId, status: "PENDING" },
    });
    if (pending > 0) return;
    const { count } = await this.prisma.syncRun.updateMany({
      where: { id: runId, finishedAt: null },
      data: { finishedAt: now },
    });
    if (count !== 1) return;

    const [run, failed, fetched] = await Promise.all([
      this.prisma.syncRun.findUnique({ where: { id: runId } }),
      this.prisma.syncRunUnit.count({ where: { runId, status: "FAILED" } }),
      this.prisma.syncRunUnit.count({ where: { runId, fetched: true } }),
    ]);
    if (!run?.scheduleId) return;
    const ok = failed === 0;
    try {
      await this.prisma.syncRun.update({
        where: { id: runId },
        data: { servedFromCache: fetched === 0 },
      });
      await this.schedule.recordOutcome(run.scheduleId, {
        ok,
        servedFromCache: ok && fetched === 0,
        now,
      });
      // A failed run hands the claim back so the row is due on the next tick.
      if (!ok && run.claimedAt && run.dueAt) {
        await this.schedule.releaseClaim({
          scheduleId: run.scheduleId,
          integrationId: run.integrationId,
          userId: "",
          cacheHitStreak: run.cacheHitStreak,
          dueAt: run.dueAt,
          claimedAt: run.claimedAt,
        });
      }
    } catch (error) {
      this.logger.warn(`Could not settle run ${runId}: ${errorMessage(error)}`);
    }
  }
}
