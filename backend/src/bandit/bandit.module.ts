import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { BanditService } from "./bandit.service";
import { BanditArmStateRepository } from "./bandit-arm-state.repository";

/**
 * HTTP client + persistence for the Disjoint-LinUCB scheduler
 * (`docs/adr/0001-linucb-model-design.md`). `SchedulerModule` imports this for
 * `BanditScheduleService` and the delayed-feedback writers.
 */
@Module({
  imports: [PrismaModule],
  providers: [BanditService, BanditArmStateRepository],
  exports: [BanditService, BanditArmStateRepository],
})
export class BanditModule {}
