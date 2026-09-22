import { Injectable, Logger } from "@nestjs/common";
import type { NotificationTopic } from "@zenflow/shared";
import type { SessionSource } from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { NotificationEvent } from "../notifications/types";
import {
  conflictCountLabel,
  findConflictingTaskIds,
} from "../scheduler/core/sync-conflicts";
import { DAY_MS } from "../scheduler/core/slot";
import type { IngestedSessionType } from "./core/types";

/** Sync-conflict topic + copy per ingested block type (timetable / exam / LMS). */
const CONFLICT_KINDS: Record<
  IngestedSessionType,
  { topic: NotificationTopic; label: string }
> = {
  LECTURE: { topic: "TIMETABLE_CONFLICT", label: "your timetable" },
  EXAM: { topic: "EXAM_CONFLICT", label: "your exam schedule" },
  ASSIGNMENT: { topic: "ASSIGNMENT_CONFLICT", label: "LMS" },
};

/** How far ahead of a sync a conflict is worth telling the user about. */
const CONFLICT_HORIZON_MS = 120 * DAY_MS;

/**
 * After a watcher run puts fixed blocks on the calendar, tells the student how
 * many of THEIR OWN scheduled tasks now overlap them ("After syncing ..., we
 * detected X conflicts with your own tasks. Reschedule them all?"). One
 * notification per source type (timetable / exam / LMS), raised through the
 * same `NEW_SESSION` emitter as every other inbox row (SSE + push). No-op when
 * nothing conflicts; deduped while an identical un-acted notification is open.
 * "Reschedule them all" is `POST /notifications/:id/reschedule-conflicts`.
 */
@Injectable()
export class SyncConflictsService {
  private readonly logger = new Logger(SyncConflictsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * @param since  the sync's start — only blocks written/updated at or after it
   *               are considered "just synced".
   * @returns the number of conflicting tasks reported (0 = nothing raised).
   */
  async detectAndNotify(args: {
    userId: string;
    source: SessionSource;
    type: IngestedSessionType;
    since: Date;
    now?: Date;
  }): Promise<number> {
    const { userId, source, type, since } = args;
    const now = args.now ?? new Date();
    const kind = CONFLICT_KINDS[type];

    const fixedRows = await this.prisma.session.findMany({
      where: {
        userId,
        source,
        type,
        deleted: false,
        updatedAt: { gte: since },
        scheduledStartTime: {
          gte: now,
          lte: new Date(now.getTime() + CONFLICT_HORIZON_MS),
        },
      },
      select: { scheduledStartTime: true, durationMinutes: true },
    });
    const fixed = fixedRows
      .filter((r) => r.scheduledStartTime)
      .map((r) => ({
        start: (r.scheduledStartTime as Date).getTime(),
        end:
          (r.scheduledStartTime as Date).getTime() + r.durationMinutes * 60_000,
      }));
    if (fixed.length === 0) return 0;

    const lo = Math.min(...fixed.map((f) => f.start)) - DAY_MS;
    const hi = Math.max(...fixed.map((f) => f.end));
    const tasks = await this.prisma.session.findMany({
      where: {
        userId,
        type: "TASK",
        source: "USER",
        deleted: false,
        scheduledStartTime: { gte: new Date(lo), lte: new Date(hi) },
      },
      select: { id: true, scheduledStartTime: true, durationMinutes: true },
    });
    const ids = findConflictingTaskIds(
      fixed,
      tasks
        .filter((t) => t.scheduledStartTime)
        .map((t) => ({
          id: t.id,
          startMs: (t.scheduledStartTime as Date).getTime(),
          durationMinutes: t.durationMinutes,
        })),
    );
    if (ids.length === 0) return 0;

    // Dedupe: an identical, still-open notification already covers this set.
    const open = await this.prisma.notification.findMany({
      where: { userId, topic: kind.topic, actionTakenAt: null },
      select: { conflictSessionIds: true },
    });
    const key = ids.join(",");
    if (open.some((n) => [...n.conflictSessionIds].sort().join(",") === key)) {
      return 0;
    }

    try {
      const row = await this.notifications.raiseConflict(userId, {
        topic: kind.topic,
        eventType: "CONFLICT",
        eventName: `sync_conflict.${type.toLowerCase()}`,
        title: `Schedule conflicts after syncing ${kind.label}`,
        content:
          `After syncing with ${kind.label}, we detected ` +
          `${conflictCountLabel(ids.length)} with your own tasks. ` +
          `Reschedule them all?`,
        conflictSessionIds: ids,
      });
      this.notifications.notify(NotificationEvent.NEW_SESSION, row);
    } catch (err) {
      this.logger.warn(
        `sync-conflict notification failed for user ${userId}: ${(err as Error).message}`,
      );
      return 0;
    }
    return ids.length;
  }
}
