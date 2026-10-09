import { Module } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module";
import { ReminderSweepService } from "./reminder-sweep.service";
import { RemindersSchedulerModule } from "./reminders-scheduler.module";

/**
 * Watcher-only reminder arming (the 5-minute sweep). Firing is the notify
 * worker's `reminder` job. `ScheduleModule` comes from the watcher's global
 * `ScheduleModule.forRoot()`.
 */
@Module({
  imports: [RemindersSchedulerModule, NotificationsModule],
  providers: [ReminderSweepService],
})
export class RemindersWorkerModule {}
