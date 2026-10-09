import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { ReminderSchedulerService } from "./reminder-scheduler.service";

/** Reminder arming + firing logic, shared by the watcher and the notify worker. */
@Module({
  imports: [PrismaModule, NotificationsModule],
  providers: [ReminderSchedulerService],
  exports: [ReminderSchedulerService],
})
export class RemindersSchedulerModule {}
