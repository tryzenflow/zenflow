import { Module } from "@nestjs/common";
import { UserPreferencesService } from "./prefs.service";
import { UserPreferencesController } from "./prefs.controller";
import { PrismaModule } from "../prisma/prisma.module";

@Module({
  imports: [PrismaModule],
  controllers: [UserPreferencesController],
  providers: [UserPreferencesService],
  exports: [UserPreferencesService],
})
export class UserPreferencesModule {}
