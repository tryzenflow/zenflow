import { Module } from "@nestjs/common";
import { EnergyLearningService } from "./energy-learning.service";

@Module({
  providers: [EnergyLearningService],
  exports: [EnergyLearningService],
})
export class EnergyLearningModule {}
