import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { SchedulerModule } from "./scheduler.module";
import { MatrixDecayService } from "./io/matrix-decay.service";
import { RetainedSessionsService } from "./io/retained-sessions.service";
import { SessionEventPartitionService } from "./io/session-event-partition.service";

/**
 * Worker-only scheduler crons (matrix decay, retained-sessions sweep, SessionEvent partition upkeep), kept out
 * of {@link SchedulerModule} so API processes register none (ADR-0011).
 */
@Module({
  imports: [PrismaModule, SchedulerModule],
  providers: [
    MatrixDecayService,
    RetainedSessionsService,
    SessionEventPartitionService,
  ],
})
export class SchedulerWorkerModule {}
