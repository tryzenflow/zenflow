import { Module } from "@nestjs/common";
import { SchedulerService } from "./scheduler.service";
import { PrismaModule } from "../prisma/prisma.module";

@Module({
  imports: [PrismaModule],
  providers: [SchedulerService],
  exports: [SchedulerService],
})
export class SchedulerModule {}
