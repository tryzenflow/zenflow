import { Module } from "@nestjs/common";
import { DevicesModule } from "../devices/devices.module";
import { PrismaModule } from "../prisma/prisma.module";
import { DailyPushController } from "./daily-push.controller";
import { DailyPushService } from "./daily-push.service";

/** Morning brief and evening check-in: settings API and content. */
@Module({
  imports: [PrismaModule, DevicesModule],
  controllers: [DailyPushController],
  providers: [DailyPushService],
  exports: [DailyPushService],
})
export class DailyPushModule {}
