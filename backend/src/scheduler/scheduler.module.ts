import { ConflictRescheduleService } from "./io/conflict-reschedule.service";
import { DisplacementService } from "./io/displacement.service";
import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { BanditModule } from "../bandit/bandit.module";
import { ExperimentModule } from "../experiments/experiment.module";
import { MatrixDecayService } from "./io/matrix-decay.service";
import { RetainedSessionsService } from "./io/retained-sessions.service";
import { HeuristicPlacer } from "./io/heuristic-placer.service";
import { PlacementClient } from "./io/placement-client.service";
import { PlacementGateway } from "./io/placement-gateway.service";
import { FallbackPlacer } from "./io/fallback-placer.service";
import { PythonPlacer } from "./io/python-placer.service";
import { TaskPlacementService } from "./io/task-placement.service";
import { SchedulingFeedbackService } from "./io/scheduling-feedback.service";

/**
 * The scheduler:
 *  - `core/`  pure algorithm toolbox — calendar/recurrence/preference-write
 *             helpers plus the frozen heuristic fallback (`slot.ts`,
 *             `slot-score.ts`, `preference.ts`, `series-spread.ts`). No I/O,
 *             no clock, no randomness. All ranking lives in
 *             `services/bandit` (ADR-0003).
 *  - `io/`    the only Prisma / bandit-HTTP layer — `PythonPlacer` (calls
 *             `POST /v1/place`), `FallbackPlacer` (Python-down degraded
 *             driver, built on `HeuristicPlacer`), `day-load`, the delayed-
 *             reward feedback, and the two crons.
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
    PlacementClient,
    PlacementGateway,
    FallbackPlacer,
    PythonPlacer,
    TaskPlacementService,
    SchedulingFeedbackService,
    DisplacementService,
    ConflictRescheduleService,
  ],
  exports: [
    TaskPlacementService,
    SchedulingFeedbackService,
    DisplacementService,
    ConflictRescheduleService,
  ],
})
export class SchedulerModule {}
