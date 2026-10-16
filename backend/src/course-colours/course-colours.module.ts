import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { CourseColoursController } from "./course-colours.controller";
import { CourseColoursService } from "./course-colours.service";

@Module({
  imports: [PrismaModule],
  controllers: [CourseColoursController],
  providers: [CourseColoursService],
})
export class CourseColoursModule {}
