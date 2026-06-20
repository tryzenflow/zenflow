import { Module } from "@nestjs/common";
import { SchedulerService } from "./scheduler.service";
import { AbandonedTasksService } from "./abandoned-tasks.service";
import { MatrixDecayService } from "./matrix-decay.service";
import { PrismaModule } from "../prisma/prisma.module";

@Module({
  imports: [PrismaModule],
  providers: [SchedulerService, AbandonedTasksService, MatrixDecayService],
  exports: [SchedulerService],
})
export class SchedulerModule {}
