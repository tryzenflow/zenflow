import { Module } from "@nestjs/common";
import { SessionsService } from "./sessions.service";
import { SessionCrudService } from "./session-crud.service";
import { SeriesService } from "./series.service";
import { SessionUpdateService } from "./session-update.service";
import { SlotPickService } from "./slot-pick.service";
import { SessionsController } from "./sessions.controller";
import { PrismaModule } from "../prisma/prisma.module";
import { TagsModule } from "../tags/tags.module";
import { RemindersModule } from "../reminders/reminders.module";
import { FilesModule } from "../files/files.module";
import { SchedulerModule } from "../scheduler/scheduler.module";

@Module({
  imports: [
    PrismaModule,
    TagsModule,
    SchedulerModule,
    RemindersModule,
    FilesModule,
  ],
  controllers: [SessionsController],
  providers: [
    SessionsService,
    SessionCrudService,
    SeriesService,
    SessionUpdateService,
    SlotPickService,
  ],
  exports: [SessionsService],
})
export class SessionsModule {}
