import { Module } from "@nestjs/common";
import { SessionsService } from "./sessions.service";
import { SessionsController } from "./sessions.controller";
import { PrismaModule } from "../prisma/prisma.module";
import { TagsModule } from "src/tags/tags.module";
import { SchedulerModule } from "../scheduler/scheduler.module";

@Module({
  imports: [PrismaModule, TagsModule, SchedulerModule],
  controllers: [SessionsController],
  providers: [SessionsService],
  exports: [SessionsService],
})
export class SessionsModule {}
