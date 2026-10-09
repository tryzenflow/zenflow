import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  DEFAULT_REMINDER_MINUTES,
  MAX_REMINDER_MINUTES,
  MAX_REMINDERS_PER_SESSION,
} from "@zenflow/shared";
import type { SessionType, User } from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import {
  isReminderTooLate,
  normalizeReminderMinutes,
} from "../scheduler/core/reminder";
import { parseOccurrenceId } from "../scheduler/core/recurrence";

/** Result of {@link RemindersService.replace}. */
export interface ReplaceRemindersResult {
  /** Leads stored for every targeted session. */
  applied: number[];
  /** Leads dropped for at least one session (nominal time past / < 60 s away). */
  skipped: number[];
}

/**
 * API-side persistence and validation of session reminders (the timing/copy
 * maths is pure, in `scheduler/core/reminder.ts`). Timers are armed and fired
 * by the worker-only `ReminderSchedulerService` (ADR-0011).
 */
@Injectable()
export class RemindersService {
  constructor(private readonly prisma: PrismaService) {}

  // ---- validation / persistence -------------------------------------------

  /**
   * Requested minutes -> the list to store (default applied, normalized).
   * When `requested` is omitted, `defaultMinutes` (the user's
   * `defaultReminderMinutes`; 0 = none) yields a single reminder, never for DND.
   */
  resolveForCreate(
    type: SessionType,
    requested: number[] | undefined,
    defaultMinutes: number = DEFAULT_REMINDER_MINUTES,
  ): number[] {
    if (requested === undefined) {
      return type === "DND" || defaultMinutes === 0 ? [] : [defaultMinutes];
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

  /**
   * Set the reminders of every session in `sessionIds` to `minutes` as a
   * diff, keeping unchanged rows (and their `firedForStart`). New rows whose
   * nominal time is already past or under a minute away are not stored
   * (rather than firing immediately); they are reported in `skipped`.
   * Recurring series are exempt: their later occurrences are still ahead.
   */
  async replace(
    sessionIds: string[],
    minutes: number[],
    now: Date = new Date(),
  ): Promise<ReplaceRemindersResult> {
    if (sessionIds.length === 0) return { applied: minutes, skipped: [] };
    const wanted = new Set(minutes);
    const existing = await this.prisma.sessionReminder.findMany({
      where: { sessionId: { in: sessionIds } },
      select: { id: true, sessionId: true, remindBeforeMinutes: true },
    });
    const sessions = await this.prisma.session.findMany({
      where: { id: { in: sessionIds } },
      select: {
        id: true,
        scheduledStartTime: true,
        series: { select: { rrule: true } },
      },
    });
    const stale = existing.filter((r) => !wanted.has(r.remindBeforeMinutes));
    const kept = new Set(
      existing
        .filter((r) => wanted.has(r.remindBeforeMinutes))
        .map((r) => `${r.sessionId}:${r.remindBeforeMinutes}`),
    );
    const startOf = new Map<string, Date | null>(
      sessions.map((s): [string, Date | null] => [
        s.id,
        s.series?.rrule ? null : s.scheduledStartTime,
      ]),
    );
    const skipped = new Set<number>();
    const missing = sessionIds.flatMap((sessionId) =>
      minutes
        .filter((m) => !kept.has(`${sessionId}:${m}`))
        .filter((m) => {
          const start = startOf.get(sessionId);
          if (start && isReminderTooLate(start, m, now)) {
            skipped.add(m);
            return false;
          }
          return true;
        })
        .map((remindBeforeMinutes) => ({ sessionId, remindBeforeMinutes })),
    );
    const result = {
      applied: minutes.filter((m) => !skipped.has(m)),
      skipped: minutes.filter((m) => skipped.has(m)),
    };
    if (stale.length === 0 && missing.length === 0) return result;
    await this.prisma.$transaction([
      this.prisma.sessionReminder.deleteMany({
        where: { id: { in: stale.map((r) => r.id) } },
      }),
      this.prisma.sessionReminder.createMany({ data: missing }),
    ]);
    return result;
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
}
