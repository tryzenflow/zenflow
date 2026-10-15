import { Module } from "@nestjs/common";
import { StudentService } from "./student.service";
import { UsersService } from "./users.service";
import { PrismaModule } from "../prisma/prisma.module";
import { UsersController } from "./users.controller";

@Module({
  imports: [PrismaModule],
  controllers: [UsersController],
  providers: [UsersService, StudentService],
  exports: [UsersService],
})
export class UsersModule {}
