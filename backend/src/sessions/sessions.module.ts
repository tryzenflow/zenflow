import { Module } from "@nestjs/common";
import { SessionsService } from "./sessions.service";
import { SessionCrudService } from "./session-crud.service";
import { SeriesService } from "./series.service";
import { SessionUpdateService } from "./session-update.service";
import { SessionsController } from "./sessions.controller";
import { PrismaModule } from "../prisma/prisma.module";
import { TagsModule } from "src/tags/tags.module";
import { SchedulerModule } from "../scheduler/scheduler.module";

@Module({
  imports: [PrismaModule, TagsModule, SchedulerModule],
  controllers: [SessionsController],
  providers: [
    SessionsService,
    SessionCrudService,
    SeriesService,
    SessionUpdateService,
  ],
  exports: [SessionsService],
})
export class SessionsModule {}
