import { Injectable, NotFoundException } from "@nestjs/common";
import {
  DAILY_CHECKIN_CATEGORY,
  DAILY_CHECKIN_MAX_SESSIONS,
  type DailyPushSettings,
  type UpdateDailyPushInput,
} from "@zenflow/shared";
import type { User } from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import { type DeliverOptions, PushService } from "../devices/push.service";
import type { PushMessage } from "../devices/types";
import {
  briefCounts,
  expandDayItems,
  BRIEF_TYPES,
  pendingCheckIn,
  type DayItem,
  type DayRow,
  type OccurrenceStates,
  occurrenceStateKey,
} from "./core/day";
import { dayBounds, localTimeKey } from "./core/time";
import {
  dailyBriefCopy,
  dailyCheckinCopy,
} from "../notifications/localize-notification";

const DAY_MS = 24 * 3_600_000;
const PUSH_URL = "/calendar";

/**
 * Morning brief and evening check-in (issue #255). Settings live on `User`;
 * the sweep (`DailyPushSweepService`) queues one job per due push, and
 * {@link deliver} builds the message from that day's sessions when the job
 * runs.
 *
 * A push with nothing to report (no sessions, or nothing left to check in)
 * sends nothing.
 */
@Injectable()
export class DailyPushService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

  async getSettings(userId: string): Promise<DailyPushSettings> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { morningBriefTime: true, eveningCheckinTime: true },
    });
    if (!user) throw new NotFoundException("Cannot find user");
    return {
      morningBriefTime: user.morningBriefTime,
      eveningCheckinTime: user.eveningCheckinTime,
    };
  }

  async updateSettings(
    user: User,
    input: UpdateDailyPushInput,
  ): Promise<DailyPushSettings> {
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        morningBriefTime: input.morningBriefTime,
        eveningCheckinTime: input.eveningCheckinTime,
      },
      select: { morningBriefTime: true, eveningCheckinTime: true },
    });
    return {
      morningBriefTime: updated.morningBriefTime,
      eveningCheckinTime: updated.eveningCheckinTime,
    };
  }

  /** The day's sessions (brief types, including recurring occurrences). */
  async loadDay(
    userId: string,
    tz: string,
    localDate: string,
  ): Promise<DayItem[]> {
    const { start, end } = dayBounds(localDate, tz);
    // A session that started yesterday can still overlap the day.
    const lookBack = new Date(start.getTime() - DAY_MS);
    const rows = (await this.prisma.session.findMany({
      where: {
        userId,
        deleted: false,
        type: { in: [...BRIEF_TYPES] },
        OR: [
          { scheduledStartTime: { gte: lookBack, lt: end } },
          { series: { rrule: { not: null } } },
        ],
      },
      select: {
        id: true,
        title: true,
        type: true,
        scheduledStartTime: true,
        durationMinutes: true,
        completedAt: true,
        skipped: true,
        seriesId: true,
        series: { select: { rrule: true, exdates: true } },
      },
    })) as DayRow[];

    const occurrences = await this.prisma.sessionOccurrenceState.findMany({
      where: { userId, occurrenceStart: { gte: lookBack, lt: end } },
      select: {
        seriesId: true,
        occurrenceStart: true,
        completedAt: true,
        skipped: true,
      },
    });
    const states: OccurrenceStates = new Map(
      occurrences.map((o) => [
        occurrenceStateKey(o.seriesId, o.occurrenceStart),
        { completedAt: o.completedAt, skipped: o.skipped },
      ]),
    );

    return expandDayItems(rows, states, start, end, tz);
  }

  /** Build and send one daily push. Runs in the notify worker. */
  async deliver(
    userId: string,
    kind: "morning" | "evening",
    localDate: string,
    opts: DeliverOptions,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        timezone: true,
        lang: true,
        morningBriefTime: true,
        eveningCheckinTime: true,
      },
    });
    if (!user) return;
    // The user may have switched this push off after the job was queued.
    const time =
      kind === "morning" ? user.morningBriefTime : user.eveningCheckinTime;
    if (!time) return;

    const items = await this.loadDay(userId, user.timezone, localDate);

    const msg =
      kind === "morning"
        ? this.briefMessage(items, user.timezone, user.lang)
        : this.checkInMessage(items, user.lang);
    if (!msg) return;
    await this.push.sendMessage(userId, () => msg, opts);
  }

  /** Morning brief message, or `null` when the day has nothing on it. */
  briefMessage(
    items: DayItem[],
    tz: string,
    lang: string | undefined,
  ): PushMessage | null {
    const { classes, blocks, first } = briefCounts(items);
    if (!first) return null;
    const copy = dailyBriefCopy(
      {
        classes,
        blocks,
        firstTitle: first.title,
        firstTime: localTimeKey(first.start, tz),
      },
      lang,
    );
    return {
      title: copy.title,
      body: copy.body,
      data: this.dataFor("daily.morning"),
      tone: "default",
      category: null,
    };
  }

  /**
   * Evening check-in message carrying the pending session ids for the action
   * buttons, or `null` when nothing is left to check in.
   */
  checkInMessage(
    items: DayItem[],
    lang: string | undefined,
  ): PushMessage | null {
    const pending = pendingCheckIn(items).slice(0, DAILY_CHECKIN_MAX_SESSIONS);
    if (pending.length === 0) return null;
    const copy = dailyCheckinCopy(lang);
    return {
      title: copy.title,
      body: copy.body,
      data: this.dataFor("daily.evening"),
      tone: "default",
      category: DAILY_CHECKIN_CATEGORY,
      extra: {
        categoryId: DAILY_CHECKIN_CATEGORY,
        sessionIds: pending.map((i) => i.id).join(","),
      },
    };
  }

  private dataFor(eventName: string) {
    return {
      notificationId: "",
      eventName,
      sessionId: "",
      url: PUSH_URL,
    };
  }
}
