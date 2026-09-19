import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { RemindersService } from "./reminders.service";

/**
 * Per-session reminders: persistence, the in-memory one-shot timers
 * (`SchedulerRegistry`) and delivery through `NotificationsService`.
 * `SchedulerRegistry` comes from the global `ScheduleModule.forRoot()`.
 */
@Module({
  imports: [PrismaModule, NotificationsModule],
  providers: [RemindersService],
  exports: [RemindersService],
})
export class RemindersModule {}
