import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { SchedulerService } from "./scheduler.service";
import { MatrixDecayService } from "./matrix-decay.service";
import { AbandonedTasksService } from "./abandoned-tasks.service";

/**
 * Provides the ONLY I/O layer for the scheduler (`SchedulerService`), plus the
 * two background cron providers that were orphaned by the scheduler-core
 * deletion (`MatrixDecayService`, `AbandonedTasksService`) — both need no code
 * changes, just to be wired back into a module. `ScheduleModule.forRoot()` is
 * already registered globally in `AppModule`.
 */
@Module({
  imports: [PrismaModule],
  providers: [SchedulerService, MatrixDecayService, AbandonedTasksService],
  exports: [SchedulerService],
})
export class SchedulerModule {}
