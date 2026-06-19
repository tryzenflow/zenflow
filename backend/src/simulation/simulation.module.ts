import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { SchedulerModule } from "../scheduler/scheduler.module";
import { TasksModule } from "../tasks/tasks.module";
import { AbandonedTasksService } from "../scheduler/abandoned-tasks.service";

/**
 * Wires the real providers the simulator drives, for a STANDALONE Nest context
 * (no HTTP server). Imports `PrismaModule`, `SchedulerModule`, and `TasksModule`
 * so `TasksService`, `SchedulerService`, and `PrismaService` are injectable; the
 * `AbandonedTasksService` (not exported by SchedulerModule) is re-provided here
 * so the runner can call its sweep directly.
 */
@Module({
  imports: [PrismaModule, SchedulerModule, TasksModule],
  providers: [AbandonedTasksService],
})
export class SimulationModule {}
