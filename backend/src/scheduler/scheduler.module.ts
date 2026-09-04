import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { BanditModule } from "../bandit/bandit.module";
import { ExperimentModule } from "../experiments/experiment.module";
import { MatrixDecayService } from "./io/matrix-decay.service";
import { RetainedSessionsService } from "./io/retained-sessions.service";
import { HeuristicPlacer } from "./io/heuristic-placer.service";
import { BanditPlacer } from "./io/bandit-placer.service";
import { SeriesPlacer } from "./io/series-placer.service";
import { TaskPlacementService } from "./io/task-placement.service";
import { SchedulingFeedbackService } from "./io/scheduling-feedback.service";

/**
 * The scheduler:
 *  - `core/`  pure algorithm — scoring, ranking, arms, series math, context
 *             vector, recurrence, decay. No I/O, no clock, no randomness.
 *  - `io/`    the only Prisma / bandit-HTTP layer — the placers, `day-load`,
 *             the A/B facade, the delayed-reward feedback, and the two crons.
 *
 * `SessionsModule` consumes only {@link TaskPlacementService} (place a TASK /
 * series and persist it) and {@link SchedulingFeedbackService} (first-move
 * LinUCB reward).
 */
@Module({
  imports: [PrismaModule, BanditModule, ExperimentModule],
  providers: [
    MatrixDecayService,
    RetainedSessionsService,
    HeuristicPlacer,
    BanditPlacer,
    SeriesPlacer,
    TaskPlacementService,
    SchedulingFeedbackService,
  ],
  exports: [TaskPlacementService, SchedulingFeedbackService],
})
export class SchedulerModule {}
