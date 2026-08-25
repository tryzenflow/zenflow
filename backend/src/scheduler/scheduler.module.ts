import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { MatrixDecayService } from "./matrix-decay.service";
import { AbandonedTasksService } from "./abandoned-tasks.service";

@Module({
  imports: [PrismaModule],
  providers: [MatrixDecayService, AbandonedTasksService],
})
export class SchedulerModule {}
