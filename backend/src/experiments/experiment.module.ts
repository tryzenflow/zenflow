import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { ExperimentService } from "./experiment.service";

/**
 * A/B experiment plumbing for heuristic-vs-LinUCB scheduling
 * (`docs/scheduler/ab-testing.md`). Imported by `SessionsModule`.
 */
@Module({
  imports: [PrismaModule],
  providers: [ExperimentService],
  exports: [ExperimentService],
})
export class ExperimentModule {}
