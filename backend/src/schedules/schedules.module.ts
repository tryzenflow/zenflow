import { Module } from "@nestjs/common";
import { SchedulesService } from "./schedules.service";
import { SchedulesController } from "./schedules.controller";
import { PrismaModule } from "../prisma/prisma.module";
import { EnergyLearningModule } from "src/energy-learning/energy-learning.module";
import { UserPreferencesModule } from "src/prefs/prefs.module";

@Module({
  imports: [PrismaModule, EnergyLearningModule, UserPreferencesModule],
  controllers: [SchedulesController],
  providers: [SchedulesService],
  exports: [SchedulesService],
})
export class SchedulesModule {}
