import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { StreaksController } from "./streaks.controller";
import { StreaksService } from "./streaks.service";

@Module({
  imports: [PrismaModule],
  controllers: [StreaksController],
  providers: [StreaksService],
  exports: [StreaksService],
})
export class StreaksModule {}
