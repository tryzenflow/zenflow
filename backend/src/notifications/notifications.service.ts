import { Injectable, NotFoundException } from "@nestjs/common";
import type {
  NotificationDto,
  NotificationKind,
  NotificationsListResponse,
  NotificationTopic,
} from "@zenflow/shared";
import {
  Prisma,
  type Notification,
  type SessionSource,
  type SessionType,
  type User,
} from "../../generated/prisma";
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

/**
 * Topic → (session type, source, default duration) used whenever a notification
 * auto-materializes a calendar session, in both {@link NotificationsService.create}
 * and {@link NotificationsService.raiseSamples}.
 */
function resolveSessionDefaults(topic: NotificationTopic): {
  type: SessionType;
  source: SessionSource;
  durationMinutes: number;
} {
  switch (topic) {
    case "EXAM":
      return { type: "EXAM", source: "PORTAL", durationMinutes: 120 };
    case "TIMETABLE":
      return { type: "LECTURE", source: "PORTAL", durationMinutes: 90 };
    case "ASSIGNMENT":
    default:
      return { type: "TASK", source: "LMS", durationMinutes: 90 };
  }
}

/** Strips the notification-title framing ("New assignment: ", "Updated: ") down to the underlying event/course title. */
function cleanNotificationTitle(title: string): string {
  return title
    .replace(/^New (assignment|exam): /i, "")
    .replace(/^Updated: /i, "")
    .trim();
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
    conflictSessionIds: row.conflictSessionIds ?? [],
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
    const db = tx ?? this.prisma;
    let sessionId = dto.sessionId;
    let eventEndsAt = dto.eventEndsAt;

    // Automatically create a calendar session/task if none is attached and kind is not DROP
    if (!sessionId && dto.kind !== "DROP" && db?.session) {
      try {
        const { type, source, durationMinutes } = resolveSessionDefaults(
          dto.topic,
        );
        const cleanTitle = cleanNotificationTitle(dto.title);

        const roomMatch = (dto.title + " " + dto.content).match(
          /(?:Room|Phòng)\s+([A-Za-z0-9-]+)/i,
        );
        const location = roomMatch ? roomMatch[0] : null;

        const now = new Date();
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(9, 0, 0, 0);

        let scheduledStartTime: Date = tomorrow;
        let deadline: Date | null = null;

        if (eventEndsAt) {
          scheduledStartTime = new Date(
            eventEndsAt.getTime() - durationMinutes * 60000,
          );
          if (type === "TASK" || type === "EXAM") {
            deadline = eventEndsAt;
          }
        } else {
          eventEndsAt = new Date(
            scheduledStartTime.getTime() + durationMinutes * 60000,
          );
          if (type === "TASK" || type === "EXAM") {
            deadline = eventEndsAt;
          }
        }

        const createdSession = await db.session.create({
          data: {
            userId,
            title: cleanTitle,
            type,
            source,
            location,
            durationMinutes,
            scheduledStartTime,
            deadline,
            note: dto.content,
          },
        });
        sessionId = createdSession.id;
      } catch (err) {
        console.warn("[notifications] Auto task creation failed:", err);
      }
    }

    const newNotification = await db.notification.create({
      data: {
        ...dto,
        sessionId,
        eventEndsAt,
        userId,
      },
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

    const now = new Date();
    // Schedule sample items starting from tomorrow
    const baseDate = new Date(now);
    baseDate.setMinutes(0, 0, 0);
    baseDate.setHours(baseDate.getHours() + 14);

    for (let i = 0; i < n; i++) {
      const sample = DEV_SAMPLES[i % DEV_SAMPLES.length];
      const sessionStart = new Date(
        baseDate.getTime() + i * 24 * 60 * 60 * 1000,
      );
      let sessionId: string | null = null;
      let eventEndsAt: Date | null = null;

      if (sample.kind !== "DROP") {
        const { type, source, durationMinutes } = resolveSessionDefaults(
          sample.topic,
        );
        let title = cleanNotificationTitle(sample.title).replace(
          / \(#\d+\)$/,
          "",
        );
        let location: string | null = null;
        let deadline: Date | null = null;

        if (sample.topic === "ASSIGNMENT") {
          deadline = new Date(sessionStart.getTime() + 4 * 60 * 60 * 1000);
          eventEndsAt = deadline;
        } else if (sample.topic === "EXAM") {
          location = "Room A305";
          deadline = new Date(sessionStart.getTime() + durationMinutes * 60000);
          eventEndsAt = deadline;
        } else if (sample.topic === "TIMETABLE") {
          if (sample.title.toLowerCase().includes("semester 1")) {
            title = "Computer Architecture";
            location = "Room C201";
          } else {
            location = "Room B210";
          }
          eventEndsAt = new Date(
            sessionStart.getTime() + durationMinutes * 60000,
          );
        }

        if (this.prisma?.session?.create) {
          const createdSession = await this.prisma.session.create({
            data: {
              userId,
              title: n > 1 ? `${title} (#${i + 1})` : title,
              type,
              source,
              location,
              durationMinutes,
              scheduledStartTime: sessionStart,
              deadline,
              note: sample.content,
            },
          });
          sessionId = createdSession.id;
        }
      }

      const row = await this.create(userId, {
        ...sample,
        title: n > 1 ? `${sample.title} (#${i + 1})` : sample.title,
        sessionId,
        eventEndsAt,
      });
      this.notify(NotificationEvent.NEW_SESSION, row);
      raised.push(toNotificationDto(row));
    }
    return raised;
  }

  /**
   * A sync-conflict row (`*_CONFLICT` topics, issue #62 D). Unlike
   * {@link create} it never materializes a calendar session - it points at the
   * user's own conflicting tasks via `conflictSessionIds`. The caller emits.
   */
  raiseConflict(
    userId: string,
    dto: {
      topic: NotificationTopic;
      title: string;
      content: string;
      conflictSessionIds: string[];
    },
  ): Promise<Notification> {
    return this.prisma.notification.create({
      data: {
        userId,
        topic: dto.topic,
        kind: "CHANGE",
        title: dto.title,
        content: dto.content,
        conflictSessionIds: dto.conflictSessionIds,
        sessionId: null,
        eventEndsAt: null,
      },
    });
  }

  /** The caller's own `*_CONFLICT` row, or 404. */
  async findConflict(user: User, id: string): Promise<Notification> {
    const row = await this.prisma.notification.findFirst({
      where: {
        id,
        userId: user.id,
        topic: {
          in: ["ASSIGNMENT_CONFLICT", "EXAM_CONFLICT", "TIMETABLE_CONFLICT"],
        },
      },
    });
    if (!row) {
      throw new NotFoundException(`Cannot find conflict notification ${id}`);
    }
    return row;
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
