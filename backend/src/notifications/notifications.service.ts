import { Injectable, NotFoundException } from "@nestjs/common";
import type {
  NotificationDto,
  NotificationsListResponse,
} from "@zenflow/shared";
import { Prisma, type Notification, type User } from "../../generated/prisma";
import { PostgresErrorCode } from "../prisma/error-codes";
import { PrismaService } from "../prisma/prisma.service";
import { ListNotificationsDto } from "./dto/list-notifications.dto";

/** Row → wire shape: instants become ISO-8601 strings, absences become `null`. */
function toNotificationDto(row: Notification): NotificationDto {
  return {
    id: row.id,
    topic: row.topic,
    title: row.title,
    content: row.content,
    sentAt: row.sentAt.toISOString(),
    readAt: row.readAt ? row.readAt.toISOString() : null,
    actionTakenAt: row.actionTakenAt ? row.actionTakenAt.toISOString() : null,
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
  constructor(private readonly prisma: PrismaService) {}

  /**
   * One page of the inbox, **unread first** and newest-first within that.
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
        orderBy: [
          { readAt: { sort: "asc", nulls: "first" } },
          { sentAt: "desc" },
        ],
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
