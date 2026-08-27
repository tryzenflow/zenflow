import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { MatrixDecayService } from "./matrix-decay.service";
import { AbandonedSessionsService } from "./abandoned-sessions.service";
import { DayRescheduleService } from "./day-reschedule.service";

@Module({
  imports: [PrismaModule],
  providers: [
    MatrixDecayService,
    AbandonedSessionsService,
    DayRescheduleService,
  ],
  exports: [DayRescheduleService],
})
export class SchedulerModule {}
