import { Module } from "@nestjs/common";
import { SchedulerModule } from "../scheduler/scheduler.module";
import { QueueModule } from "../queue/queue.module";
import { PrismaModule } from "../prisma/prisma.module";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";
import { NotificationPubSub } from "./notification-pubsub.service";

@Module({
  imports: [PrismaModule, SchedulerModule, QueueModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationPubSub],
  exports: [NotificationsService],
})
export class NotificationsModule {}
