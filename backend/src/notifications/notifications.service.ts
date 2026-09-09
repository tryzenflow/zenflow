import { Injectable, NotFoundException } from "@nestjs/common";
import type {
  NotificationDto,
  NotificationKind,
  NotificationsListResponse,
  NotificationTopic,
} from "@zenflow/shared";
import { Prisma, type Notification, type User } from "../../generated/prisma";
import { PostgresErrorCode } from "../prisma/error-codes";
import { PrismaService } from "../prisma/prisma.service";
import { ListNotificationsDto } from "./dto/list-notifications.dto";
import { NotificationEvent } from "./types";
import { EventEmitter2 } from "@nestjs/event-emitter";

/**
 * One of each inbox row style, cycled by {@link NotificationsService.raiseSamples}
 * for the dev-only test trigger.
 */
const DEV_SAMPLES: CreateNotificationInput[] = [
  {
    topic: "ASSIGNMENT",
    kind: "NEW",
    title: "New assignment: Sorting Algorithms",
    content: "Added from your LMS. Plan the work that leads up to it.",
    sessionId: null,
    eventEndsAt: null,
  },
  {
    topic: "EXAM",
    kind: "NEW",
    title: "New exam: Midterm — Room A305",
    content: "Added from your portal. Plan revision sessions before it.",
    sessionId: null,
    eventEndsAt: null,
  },
  {
    topic: "TIMETABLE",
    kind: "NEW",
    title: "Timetable for semester 1 is available",
    content: "12 classes were added to your calendar.",
    sessionId: null,
    eventEndsAt: null,
  },
  {
    topic: "TIMETABLE",
    kind: "CHANGE",
    title: "Updated: Databases — Room B210",
    content: "The portal moved this class.",
    sessionId: null,
    eventEndsAt: null,
  },
  {
    topic: "TIMETABLE",
    kind: "DROP",
    title: "Lectures removed: Data Structures Lab",
    content: "These classes were taken off your DLU timetable.",
    sessionId: null,
    eventEndsAt: null,
  },
];

/** What the materializer passes to {@link NotificationsService.create}. */
export interface CreateNotificationInput {
  title: string;
  topic: NotificationTopic;
  kind: NotificationKind;
  sessionId: string | null;
  content: string;
  /** Fixed end instant of the session behind the row, or null (groups/drops). */
  eventEndsAt: Date | null;
}

/** Row → wire shape: instants become ISO-8601 strings, absences become `null`. */
function toNotificationDto(row: Notification): NotificationDto {
  return {
    id: row.id,
    topic: row.topic,
    kind: row.kind,
    title: row.title,
    content: row.content,
    sentAt: row.sentAt.toISOString(),
    readAt: row.readAt ? row.readAt.toISOString() : null,
    actionTakenAt: row.actionTakenAt ? row.actionTakenAt.toISOString() : null,
    eventEndsAt: row.eventEndsAt ? row.eventEndsAt.toISOString() : null,
    sessionId: row.sessionId,
  };
}

/**
 * The student's ingestion inbox.
 *
 * Rows are written by `ingestion/materializer.service.ts` when a watcher puts
 * something new (or newly changed) on the calendar; nothing here creates them.
 * The call to action is "plan work around this item", not "confirm this item" —
 * confirm/dismiss semantics belong to #31.
 */
@Injectable()
export class NotificationsService {
  readonly notificationEmitter: EventEmitter2 = new EventEmitter2();

  constructor(private readonly prisma: PrismaService) {}

  notify(event: string, payload: Notification) {
    this.notificationEmitter.emit(event, payload);
  }

  toNotificationDto(payload: Notification): NotificationDto {
    return toNotificationDto(payload);
  }

  async create(
    userId: string,
    dto: CreateNotificationInput,
    tx?: Prisma.TransactionClient,
  ): Promise<Notification> {
    const newNotification = await (tx ?? this.prisma).notification.create({
      data: { ...dto, userId },
    });

    return newNotification;
  }

  /**
   * Dev-only: write `count` fake rows (cycling {@link DEV_SAMPLES}) and emit
   * `NEW_SESSION` for each — exactly what the materializer does, so they reach
   * the SSE stream and `PushService`. Called from `POST /notifications/dev/raise`
   * so the emit runs in the API process; a standalone script has its own
   * in-memory emitter with no listeners.
   */
  async raiseSamples(userId: string, count = 1): Promise<NotificationDto[]> {
    const n = Math.max(1, Math.min(20, count));
    const raised: NotificationDto[] = [];
    for (let i = 0; i < n; i++) {
      const sample = DEV_SAMPLES[i % DEV_SAMPLES.length];
      const row = await this.create(userId, {
        ...sample,
        title: n > 1 ? `${sample.title} (#${i + 1})` : sample.title,
      });
      this.notify(NotificationEvent.NEW_SESSION, row);
      raised.push(toNotificationDto(row));
    }
    return raised;
  }

  /**
   * `DELETE /notifications/:id` — dismiss a row for good.
   *
   * Scoped to the caller (`userId` in the `where`), so another student's row is
   * a 404, never a 403; `P2025` from a stale id lands the same way. A hard
   * delete rather than a `dismissedAt` stamp: a dismissed inbox row carries no
   * signal worth keeping, and `readAt` / `actionTakenAt` already cover "seen"
   * and "acted on".
   */
  async remove(user: User, id: string): Promise<{ id: string }> {
    try {
      await this.prisma.notification.delete({
        where: { id, userId: user.id },
      });
      return { id };
    } catch (error) {
      if (this.isRecordNotFound(error)) {
        throw new NotFoundException(`Cannot find notification with id ${id}`);
      }
      throw error;
    }
  }

  /**
   * One page of the inbox, **newest first**.
   *
   * Ordering is by `sentAt` alone, deliberately independent of read state: the
   * client marks every shown row read as soon as the inbox opens, so an
   * unread-first order would reshuffle the list the instant it is looked at and
   * — with `take` in play — silently drop just-read rows off the page. Unread is
   * surfaced by row styling and by `unreadCount`, not by position.
   *
   * `unreadCount` deliberately counts the whole inbox rather than the page: it
   * drives the badge, which must not shrink as the user pages forward.
   */
  async list(
    user: User,
    dto: ListNotificationsDto,
  ): Promise<NotificationsListResponse> {
    const [rows, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId: user.id },
        orderBy: { sentAt: "desc" },
        take: dto.limit ?? 20,
        skip: dto.offset ?? 0,
      }),
      this.prisma.notification.count({
        where: { userId: user.id, readAt: null },
      }),
    ]);

    return { notifications: rows.map(toNotificationDto), unreadCount };
  }

  /** `PATCH /notifications/:id/read` — stamp `readAt`. Idempotent. */
  async markRead(user: User, id: string): Promise<NotificationDto> {
    return this.stamp(user, id, "readAt");
  }

  /**
   * `PATCH /notifications/:id/action-taken` — stamp `actionTakenAt`.
   *
   * Distinct from {@link markRead}: seeing a notification is not acting on it,
   * and the difference is exactly the signal that says whether the inbox is
   * useful.
   */
  async markActionTaken(user: User, id: string): Promise<NotificationDto> {
    return this.stamp(user, id, "actionTakenAt");
  }

  /**
   * Stamp one timestamp column, scoped to the caller.
   *
   * `userId` is part of the `where`, so another student's notification is
   * simply not found — a 404 rather than a 403, which is also what a caller
   * passing a stale id gets. Both arrive here as Prisma's `P2025`.
   *
   * Re-stamping keeps the first instant: "read at" should mean when they first
   * read it, not when they last scrolled past it.
   */
  private async stamp(
    user: User,
    id: string,
    column: "readAt" | "actionTakenAt",
  ): Promise<NotificationDto> {
    try {
      const row = await this.prisma.notification.update({
        where: { id, userId: user.id, [column]: null },
        data: { [column]: new Date() },
      });
      return toNotificationDto(row);
    } catch (error) {
      if (!this.isRecordNotFound(error)) throw error;
      // Either it is not this user's row, or it was already stamped. Tell the
      // two apart with a read rather than reporting a 404 for a repeat call.
      const existing = await this.prisma.notification.findFirst({
        where: { id, userId: user.id },
      });
      if (!existing) {
        throw new NotFoundException(`Cannot find notification with id ${id}`);
      }
      return toNotificationDto(existing);
    }
  }

  private isRecordNotFound(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === (PostgresErrorCode.RecordNotFound as string)
    );
  }
}
