import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import { Cron, CronExpression, SchedulerRegistry } from "@nestjs/schedule";
import {
  DEFAULT_REMINDER_MINUTES,
  MAX_REMINDER_MINUTES,
  MAX_REMINDERS_PER_SESSION,
} from "@zenflow/shared";
import type { Prisma, SessionType, User } from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { NotificationEvent } from "../notifications/types";
import {
  buildReminderText,
  normalizeReminderMinutes,
  pickReminderStart,
  planReminder,
} from "../scheduler/core/reminder";
import { expandRrule, parseOccurrenceId } from "../scheduler/core/recurrence";

/**
 * Timers are only armed for reminders firing within this window. It keeps
 * every delay far below the 32-bit `setTimeout` limit (~24.8 days); the sweep
 * re-arms the rest as they come into range.
 */
export const ARM_HORIZON_MS = 24 * 60 * 60 * 1000;
const LOOKAHEAD_MS = ARM_HORIZON_MS + MAX_REMINDER_MINUTES * 60_000;

export const reminderJobName = (id: string): string => `reminder:${id}`;

const WITH_SESSION = {
  session: { include: { series: true, user: true } },
} satisfies Prisma.SessionReminderInclude;
type ReminderRow = Prisma.SessionReminderGetPayload<{
  include: typeof WITH_SESSION;
}>;

interface Armed {
  userId: string;
  startsAt: number;
}

/**
 * I/O side of session reminders (the timing/copy maths is pure, in
 * `scheduler/core/reminder.ts`).
 *
 * Each reminder becomes a one-shot `SchedulerRegistry` timeout named
 * `reminder:<id>`. Timers are in-memory, so {@link sweep} (bootstrap + every 5
 * minutes) re-registers everything due within {@link ARM_HORIZON_MS} and drops
 * timers whose reminder is gone; the session facade calls {@link syncUser}
 * after every mutation so a create / move / delete takes effect immediately.
 * When a timer fires it re-reads the DB and only delivers if the plan is still
 * valid, so a missed hook can never send a stale reminder.
 *
 * Delivery reuses `NotificationsService` (row + `NEW_SESSION` emit -> SSE and
 * push). A recurring fixed series keeps its reminders on the representative
 * row and fires once per occurrence (`firedForStart`).
 */
@Injectable()
export class RemindersService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RemindersService.name);
  private readonly armed = new Map<string, Armed>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: SchedulerRegistry,
    private readonly notifications: NotificationsService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.sweep();
  }

  // ---- validation / persistence -------------------------------------------

  /** Requested minutes -> the list to store (default applied, normalized). */
  resolveForCreate(
    type: SessionType,
    requested: number[] | undefined,
  ): number[] {
    if (requested === undefined) {
      return type === "DND" ? [] : [DEFAULT_REMINDER_MINUTES];
    }
    this.assertValid(type, requested);
    return normalizeReminderMinutes(requested);
  }

  /** Service-side guard mirroring the DTO rules (max 2, no DND, sane range). */
  assertValid(type: SessionType, minutes: number[]): void {
    if (minutes.length > MAX_REMINDERS_PER_SESSION) {
      throw new BadRequestException(
        `A session can have at most ${MAX_REMINDERS_PER_SESSION} reminders.`,
      );
    }
    if (
      minutes.some(
        (m) => !Number.isInteger(m) || m < 0 || m > MAX_REMINDER_MINUTES,
      )
    ) {
      throw new BadRequestException(
        `Reminders must be whole minutes between 0 (at start) and ${MAX_REMINDER_MINUTES}.`,
      );
    }
    if (type === "DND" && minutes.length > 0) {
      throw new BadRequestException(
        "Do-not-disturb blocks cannot have reminders.",
      );
    }
    if (new Set(minutes).size !== minutes.length) {
      throw new BadRequestException("Reminders must be distinct.");
    }
  }

  /** Replace the reminders of every session in `sessionIds` with `minutes`. */
  async replace(sessionIds: string[], minutes: number[]): Promise<void> {
    if (sessionIds.length === 0) return;
    await this.prisma.$transaction([
      this.prisma.sessionReminder.deleteMany({
        where: { sessionId: { in: sessionIds } },
      }),
      this.prisma.sessionReminder.createMany({
        data: sessionIds.flatMap((sessionId) =>
          minutes.map((remindBeforeMinutes) => ({
            sessionId,
            remindBeforeMinutes,
          })),
        ),
      }),
    ]);
  }

  /**
   * Resolve what a `PATCH { reminders }` targets and validate it, *before* the
   * update runs. A materialized TASK series applies to every sitting; anything
   * else (incl. a recurring occurrence id -> its representative) to one row.
   */
  async resolveUpdateTargets(
    id: string,
    minutes: number[],
    user: User,
  ): Promise<{ sessionIds: string[]; minutes: number[] }> {
    const occ = parseOccurrenceId(id);
    const row = await this.prisma.session.findFirst({
      where: occ
        ? { seriesId: occ.seriesId, userId: user.id, deleted: false }
        : { id, userId: user.id, deleted: false },
      include: { series: true },
    });
    if (!row) throw new NotFoundException(`Cannot find session with id ${id}`);
    this.assertValid(row.type, minutes);

    const isTaskSeries = row.seriesId && !row.series?.rrule;
    const members = isTaskSeries
      ? await this.prisma.session.findMany({
          where: { seriesId: row.seriesId, userId: user.id, deleted: false },
          select: { id: true },
        })
      : [{ id: row.id }];
    return {
      sessionIds: members.map((m) => m.id),
      minutes: normalizeReminderMinutes(minutes),
    };
  }

  /**
   * After a series grew (new sittings have no reminder rows), copy an existing
   * sitting's reminders onto members that have none. An explicit "no
   * reminders" stays empty because the template is then empty too.
   */
  async propagateSeries(seriesId: string): Promise<void> {
    const members = await this.prisma.session.findMany({
      where: { seriesId, deleted: false },
      orderBy: { sessionIndex: "asc" },
      include: { reminders: true },
    });
    const template = members.find((m) => m.reminders.length > 0);
    if (!template) return;
    const minutes = template.reminders.map((r) => r.remindBeforeMinutes);
    const bare = members.filter((m) => m.reminders.length === 0);
    if (bare.length === 0) return;
    await this.prisma.sessionReminder.createMany({
      data: bare.flatMap((m) =>
        minutes.map((remindBeforeMinutes) => ({
          sessionId: m.id,
          remindBeforeMinutes,
        })),
      ),
    });
  }

  // ---- arming -------------------------------------------------------------

  @Cron(CronExpression.EVERY_5_MINUTES)
  async sweep(): Promise<void> {
    try {
      await this.syncScope();
    } catch (err) {
      this.logger.warn(`reminder sweep failed: ${(err as Error).message}`);
    }
  }

  /** Re-arm/cancel one user's timers now (called after any session mutation). */
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

    const wanted = new Set<string>();
    for (const row of rows) {
      const plan = this.planFor(row, now);
      if (!plan || plan.fireAt.getTime() - now.getTime() > ARM_HORIZON_MS) {
        continue;
      }
      wanted.add(row.id);
      this.arm(row.id, row.session.userId, plan.startsAt, plan.fireAt, now);
    }
    for (const [id, a] of [...this.armed]) {
      if (!wanted.has(id) && (!userId || a.userId === userId)) this.cancel(id);
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

  private planFor(row: ReminderRow, now: Date) {
    if (row.session.type === "DND") return null;
    const start = pickReminderStart(
      this.candidateStarts(row, now),
      row.firedForStart,
      now,
    );
    return start ? planReminder(start, row.remindBeforeMinutes, now) : null;
  }

  private arm(
    id: string,
    userId: string,
    startsAt: Date,
    fireAt: Date,
    now: Date,
  ): void {
    const existing = this.armed.get(id);
    if (existing && existing.startsAt === startsAt.getTime()) return;
    this.cancel(id);
    const timer = setTimeout(
      () => void this.fire(id, startsAt.getTime()),
      Math.max(0, fireAt.getTime() - now.getTime()),
    );
    timer.unref?.();
    this.registry.addTimeout(reminderJobName(id), timer);
    this.armed.set(id, { userId, startsAt: startsAt.getTime() });
  }

  /** Remove the timer for one reminder (no-op if absent). */
  cancel(id: string): void {
    const name = reminderJobName(id);
    if (this.registry.doesExist("timeout", name)) {
      this.registry.deleteTimeout(name);
    }
    this.armed.delete(id);
  }

  // ---- firing -------------------------------------------------------------

  /** Timer callback; exposed for tests. */
  async fire(id: string, armedStart: number): Promise<void> {
    this.cancel(id);
    try {
      const now = new Date();
      const row = await this.prisma.sessionReminder.findUnique({
        where: { id },
        include: WITH_SESSION,
      });
      if (!row) return;
      const plan = this.planFor(row, now);
      if (!plan) return; // moved into the past / deleted occurrence / DND
      if (plan.startsAt.getTime() !== armedStart) {
        // Session moved since arming: re-arm for the new start, don't fire.
        if (plan.fireAt.getTime() - now.getTime() <= ARM_HORIZON_MS) {
          this.arm(id, row.session.userId, plan.startsAt, plan.fireAt, now);
        }
        return;
      }

      // Claim this occurrence so a racing re-arm / restart can't double-send.
      const claimed = await this.prisma.sessionReminder.updateMany({
        where: {
          id,
          OR: [
            { firedForStart: null },
            { firedForStart: { not: plan.startsAt } },
          ],
        },
        data: { firedForStart: plan.startsAt },
      });
      if (claimed.count === 0) return;

      const s = row.session;
      const text = buildReminderText({
        sessionTitle: s.title,
        startsAt: plan.startsAt,
        now,
        timezone: s.user.timezone,
        location: s.location,
        type: s.type,
      });
      const notification = await this.notifications.create(s.userId, {
        topic: "REMINDER",
        eventType: "CREATED",
        eventName: "reminder.fired",
        title: text.title,
        content: text.content,
        sessionId: s.id,
        eventEndsAt: new Date(
          plan.startsAt.getTime() + s.durationMinutes * 60_000,
        ),
      });
      this.notifications.notify(NotificationEvent.NEW_SESSION, notification);

      // A recurring series: line up the next occurrence.
      if (s.series?.rrule) await this.syncUser(s.userId);
    } catch (err) {
      this.logger.warn(`reminder ${id} failed: ${(err as Error).message}`);
    }
  }
}
