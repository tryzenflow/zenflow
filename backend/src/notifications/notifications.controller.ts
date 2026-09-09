import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Sse,
  UseGuards,
} from "@nestjs/common";
import { CookieAuthGuard } from "../auth/guards";
import { CurrentUser } from "../users/decorators/current-user.decorator";
import { Notification, type User } from "../../generated/prisma";
import { ListNotificationsDto } from "./dto/list-notifications.dto";
import { RaiseDevNotificationDto } from "./dto/raise-dev-notification.dto";
import { NotificationsService } from "./notifications.service";
import { NotificationEvent } from "./types";
import { filter, fromEvent, map } from "rxjs";

/**
 * The ingestion inbox — read + acknowledge only.
 *
 * Notifications are written by the DLU watchers, never by a client, so there is
 * no create or delete route. `GET /notifications` formally belongs to #31; it
 * lives here now because nothing else makes the rows the watchers write
 * reachable.
 */
@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}
  @Sse("stream")
  @UseGuards(CookieAuthGuard)
  async sendInApp(@CurrentUser() user: User) {
    return fromEvent(
      this.notifications.notificationEmitter,
      NotificationEvent.NEW_SESSION,
    ).pipe(
      filter((data) => (data as Notification).userId === user.id),
      map((data) => ({
        data: this.notifications.toNotificationDto(data as Notification),
      })),
    );
  }

  /**
   * Dev-only: raise fake ingestion notifications for `userId`, going through the
   * real `NotificationsService` so they hit the DB, the SSE stream above **and**
   * `PushService`. The emit runs in this process — which is why the test helper
   * is an HTTP call and not a standalone script (its own Nest context would emit
   * on a fresh in-memory emitter with no SSE listeners). 404s in production.
   * Driven by `scripts/send-test-notification.ts`. No auth guard: the script has
   * no session.
   */
  @Post("dev/raise")
  async devRaise(@Body() dto: RaiseDevNotificationDto) {
    if (process.env.NODE_ENV === "production") {
      throw new NotFoundException("Cannot POST /notifications/dev/raise");
    }
    const data = await this.notifications.raiseSamples(dto.userId, dto.count);
    return {
      success: true,
      message: `Raised ${data.length} notification(s)`,
      data,
    };
  }

  /** One page of the caller's inbox, newest first, plus the unread badge count. */
  @Get()
  @UseGuards(CookieAuthGuard)
  async list(@CurrentUser() user: User, @Query() dto: ListNotificationsDto) {
    const data = await this.notifications.list(user, dto);
    return {
      success: true,
      message: `Found ${data.notifications.length} notifications`,
      data,
    };
  }

  /** Mark one notification read. Idempotent; 404 if it is not the caller's. */
  @Patch(":id/read")
  @UseGuards(CookieAuthGuard)
  async markRead(@CurrentUser() user: User, @Param("id") id: string) {
    const data = await this.notifications.markRead(user, id);
    return { success: true, message: "Notification marked as read", data };
  }

  /** Record that the student acted on it. Idempotent; 404 if not theirs. */
  @Patch(":id/action-taken")
  @UseGuards(CookieAuthGuard)
  async markActionTaken(@CurrentUser() user: User, @Param("id") id: string) {
    const data = await this.notifications.markActionTaken(user, id);
    return { success: true, message: "Notification marked as acted on", data };
  }

  /** Dismiss (hard-delete) one notification. 404 if it is not the caller's. */
  @Delete(":id")
  @UseGuards(CookieAuthGuard)
  async remove(@CurrentUser() user: User, @Param("id") id: string) {
    const data = await this.notifications.remove(user, id);
    return { success: true, message: "Notification dismissed", data };
  }
}
