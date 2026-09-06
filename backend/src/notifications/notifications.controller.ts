import {
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from "@nestjs/common";
import { CookieAuthGuard } from "../auth/guards";
import { CurrentUser } from "../users/decorators/current-user.decorator";
import { type User } from "../../generated/prisma";
import { ListNotificationsDto } from "./dto/list-notifications.dto";
import { NotificationsService } from "./notifications.service";

/**
 * The ingestion inbox — read + acknowledge only.
 *
 * Notifications are written by the DLU watchers, never by a client, so there is
 * no create or delete route. `GET /notifications` formally belongs to #31; it
 * lives here now because nothing else makes the rows the watchers write
 * reachable.
 */
@Controller("notifications")
@UseGuards(CookieAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /** One page of the caller's inbox, unread first, plus the unread badge count. */
  @Get()
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
  async markRead(@CurrentUser() user: User, @Param("id") id: string) {
    const data = await this.notifications.markRead(user, id);
    return { success: true, message: "Notification marked as read", data };
  }

  /** Record that the student acted on it. Idempotent; 404 if not theirs. */
  @Patch(":id/action-taken")
  async markActionTaken(@CurrentUser() user: User, @Param("id") id: string) {
    const data = await this.notifications.markActionTaken(user, id);
    return { success: true, message: "Notification marked as acted on", data };
  }
}
