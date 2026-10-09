import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { ReminderSchedulerService } from "./reminder-scheduler.service";

/**
 * Worker-only reminder timers and delivery through `NotificationsService`.
 * `SchedulerRegistry` comes from the worker's global `ScheduleModule.forRoot()`.
 */
@Module({
  imports: [PrismaModule, NotificationsModule],
  providers: [ReminderSchedulerService],
})
export class RemindersWorkerModule {}
