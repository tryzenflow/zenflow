import { Module } from "@nestjs/common";
import { SchedulerService } from "./scheduler.service";
import { AbandonedTasksService } from "./abandoned-tasks.service";
import { PrismaModule } from "../prisma/prisma.module";

@Module({
  imports: [PrismaModule],
  providers: [SchedulerService, AbandonedTasksService],
  exports: [SchedulerService],
})
export class SchedulerModule {}
