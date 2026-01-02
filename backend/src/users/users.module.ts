import { Module } from "@nestjs/common";
import { UsersService } from "./users.service";
import { PrismaModule } from "../prisma/prisma.module";
import { UsersController } from "./users.controller";
import { UserPreferencesModule } from "src/prefs/prefs.module";
import { CategoriesModule } from "src/categories/categories.module";

@Module({
  imports: [PrismaModule, UserPreferencesModule, CategoriesModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
