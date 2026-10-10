import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { MAX_REMINDER_MINUTES } from "@zenflow/shared";
import type { Prisma } from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { NotificationEvent } from "../notifications/types";
import {
  REMINDER_CATCH_UP_MS,
  buildReminderText,
  pickReminderStart,
  planReminder,
} from "../scheduler/core/reminder";
import { expandRrule } from "../scheduler/core/recurrence";
import { QueueService } from "../queue/queue.service";
import { NOTIFY_QUEUE } from "../queue/queues";
import { idempotencyKey } from "../queue/queue.types";

/**
 * Jobs are only armed for reminders firing within this window; the sweep arms
 * the rest as they come into range, which also picks up sessions that moved.
 */
export const ARM_HORIZON_MS = 24 * 60 * 60 * 1000;
const LOOKAHEAD_MS = ARM_HORIZON_MS + MAX_REMINDER_MINUTES * 60_000;

/** Delivery jitter window: a uniform 5-10 s delay, never earlier. */
export const REMINDER_JITTER_MIN_MS = 5_000;
export const REMINDER_JITTER_MAX_MS = 10_000;

/** Injection token for the jitter RNG (`() => [0, 1)`); defaults to `Math.random`. */
export const REMINDER_RANDOM = Symbol("REMINDER_RANDOM");

/** Job id of the delayed `notify:reminder` job for one reminder occurrence. */
export const reminderJobId = (id: string, startsAtMs: number): string =>
  idempotencyKey("reminder", id, startsAtMs);

const WITH_SESSION = {
  session: { include: { series: true, user: true } },
} satisfies Prisma.SessionReminderInclude;
type ReminderRow = Prisma.SessionReminderGetPayload<{
  include: typeof WITH_SESSION;
}>;

/**
 * Arms and fires session reminders on the `notify` queue (ADR-0007).
 *
 * Arming enqueues one delayed `reminder` job per reminder occurrence, job id
 * `reminder_<id>_<startMs>`, so arming again (the 5-minute sweep, a
 * `syncUser`) is a no-op. Nothing is cancelled: a deleted reminder, a moved
 * session or a stale job is dropped when it fires, because {@link fire}
 * re-reads the DB and only delivers if the plan is still valid for the start
 * it was armed for. A moved session is re-armed for its new start.
 *
 * {@link fire} claims the occurrence in the same transaction that writes the
 * notification row (`firedForStart`), so a retry or a second worker cannot
 * double-send; the push/SSE announce goes through `NotificationsService.notify`.
 * A recurring fixed series keeps its reminders on the representative row and
 * fires once per occurrence.
 */
@Injectable()
export class ReminderSchedulerService {
  private readonly logger = new Logger(ReminderSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly queue: QueueService,
    @Optional()
    @Inject(REMINDER_RANDOM)
    private readonly random: () => number = Math.random,
  ) {}

  // ---- arming -------------------------------------------------------------

  /** Arm everything due within {@link ARM_HORIZON_MS} (watcher: bootstrap + every 5 min). */
  async sweep(): Promise<void> {
    try {
      await this.syncScope();
    } catch (err) {
      this.logger.warn(`reminder sweep failed: ${(err as Error).message}`);
    }
  }

  /** Arm one user's reminders now (called after any session mutation). */
  async syncUser(userId: string): Promise<void> {
    try {
      await this.syncScope(userId);
    } catch (err) {
      this.logger.warn(`reminder sync failed: ${(err as Error).message}`);
    }
  }

  private async syncScope(userId?: string): Promise<void> {
    const now = new Date();
    const rows = await this.prisma.sessionReminder.findMany({
      where: {
        session: {
          type: { not: "DND" },
          deleted: false,
          ...(userId ? { userId } : {}),
          OR: [
            {
              scheduledStartTime: {
                gt: now,
                lte: new Date(now.getTime() + LOOKAHEAD_MS),
              },
            },
            { series: { rrule: { not: null } } },
          ],
        },
      },
      include: WITH_SESSION,
    });

    for (const row of rows) {
      const plan = this.planFor(row, now);
      if (!plan || plan.fireAt.getTime() - now.getTime() > ARM_HORIZON_MS) {
        continue;
      }
      await this.arm(row.id, plan.startsAt, plan.fireAt, now);
    }
  }

  private candidateStarts(row: ReminderRow, now: Date): Date[] {
    const s = row.session;
    if (!s.scheduledStartTime) return [];
    if (s.series?.rrule) {
      return expandRrule(
        s.series.rrule,
        s.scheduledStartTime,
        now,
        new Date(now.getTime() + LOOKAHEAD_MS),
        s.user.timezone,
        s.series.exdates,
      );
    }
    return [s.scheduledStartTime];
  }

  private planFor(
    row: ReminderRow,
    now: Date,
    catchUpMs: number = REMINDER_CATCH_UP_MS,
  ) {
    if (row.session.type === "DND" || row.session.deleted) return null;
    const start = pickReminderStart(
      this.candidateStarts(row, now),
      row.firedForStart,
      now,
    );
    return start
      ? planReminder(start, row.remindBeforeMinutes, now, catchUpMs)
      : null;
  }

  private async arm(
    id: string,
    startsAt: Date,
    fireAt: Date,
    now: Date,
  ): Promise<void> {
    await this.queue.enqueueBestEffort(
      NOTIFY_QUEUE,
      { type: "reminder", reminderId: id, startsAt: startsAt.toISOString() },
      {
        jobId: reminderJobId(id, startsAt.getTime()),
        delayMs: this.delayMs(startsAt, fireAt, now),
      },
    );
  }

  /**
   * Job delay: the time until `fireAt` plus a uniform 5-10 s jitter (spreads
   * push bursts), capped so delivery never lands after the session starts.
   */
  private delayMs(startsAt: Date, fireAt: Date, now: Date): number {
    const jitter =
      REMINDER_JITTER_MIN_MS +
      this.random() * (REMINDER_JITTER_MAX_MS - REMINDER_JITTER_MIN_MS);
    const base = Math.max(0, fireAt.getTime() - now.getTime());
    // 1 s margin: at the start instant the session counts as started.
    const untilStart = Math.max(0, startsAt.getTime() - now.getTime() - 1_000);
    return Math.min(base + jitter, untilStart);
  }

  // ---- firing -------------------------------------------------------------

  /**
   * The `notify:reminder` job body. Returns normally for every "nothing to
   * send" outcome; throws only on a real failure (DB), which BullMQ retries.
   */
  async fire(id: string, armedStart: number): Promise<void> {
    const now = new Date();
    const row = await this.prisma.sessionReminder.findUnique({
      where: { id },
      include: WITH_SESSION,
    });
    if (!row) return;
    // Allow for the arming jitter on top of the catch-up window.
    const plan = this.planFor(
      row,
      now,
      REMINDER_CATCH_UP_MS + REMINDER_JITTER_MAX_MS,
    );
    if (!plan) return; // moved into the past / deleted occurrence / DND
    if (plan.startsAt.getTime() !== armedStart) {
      // Session moved since arming: arm the new start, don't fire.
      if (plan.fireAt.getTime() - now.getTime() <= ARM_HORIZON_MS) {
        await this.arm(id, plan.startsAt, plan.fireAt, now);
      }
      return;
    }

    const s = row.session;
    const text = buildReminderText({
      sessionTitle: s.title,
      startsAt: plan.startsAt,
      now,
      timezone: s.user.timezone,
      location: s.location,
      type: s.type,
    });
    // Claim and row in one transaction: a failure after the claim cannot lose
    // the reminder, and a retry that sees the claim knows it was delivered.
    const notification = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.sessionReminder.updateMany({
        where: {
          id,
          OR: [
            { firedForStart: null },
            { firedForStart: { not: plan.startsAt } },
          ],
        },
        data: { firedForStart: plan.startsAt },
      });
      if (claimed.count === 0) return null;
      return this.notifications.create(
        s.userId,
        {
          eventName: "reminder.fired",
          title: text.title,
          content: text.content,
          sessionId: s.id,
          eventEndsAt: new Date(
            plan.startsAt.getTime() + s.durationMinutes * 60_000,
          ),
        },
        tx,
      );
    });
    if (!notification) return;
    // Awaited (with a short retry) so a transient queue blip does not lose
    // the push; a drop is repaired by `NotificationsService.reconcileRecent`.
    await this.notifications.announce(
      NotificationEvent.NEW_SESSION,
      notification,
    );

    // A recurring series: line up the next occurrence.
    if (s.series?.rrule) await this.syncUser(s.userId);
  }
}
