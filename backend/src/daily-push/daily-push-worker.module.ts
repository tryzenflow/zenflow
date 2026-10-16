import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { DailyPushSweepService } from "./daily-push-sweep.service";

/**
 * Watcher-only sweep that queues the daily pushes. Delivery runs in the
 * notify worker (`DailyPushService.deliver`). `ScheduleModule` comes from the
 * watcher's global `ScheduleModule.forRoot()`.
 */
@Module({
  imports: [PrismaModule],
  providers: [DailyPushSweepService],
})
export class DailyPushWorkerModule {}
