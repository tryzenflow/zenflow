import { Module } from "@nestjs/common";
import { TasksService } from "./tasks.service";
import { TasksController } from "./tasks.controller";
import { PrismaModule } from "../prisma/prisma.module";
import { SchedulerModule } from "../scheduler/scheduler.module";

@Module({
  imports: [PrismaModule, SchedulerModule],
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
