import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { ApnsSender } from "./apns.sender";
import { DevicesController } from "./devices.controller";
import { DevicesService } from "./devices.service";
import { FcmSender } from "./fcm.sender";
import { PushService } from "./push.service";

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [DevicesController],
  providers: [DevicesService, PushService, FcmSender, ApnsSender],
  exports: [PushService],
})
export class DevicesModule {}
