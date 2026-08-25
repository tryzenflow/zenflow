import { Module } from "@nestjs/common";
import { TasksService } from "./tasks.service";
import { TasksController } from "./tasks.controller";
import { PrismaModule } from "../prisma/prisma.module";
import { TagsModule } from "src/tags/tags.module";

@Module({
  imports: [PrismaModule, TagsModule],
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
