import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { RemindersService } from "./reminders.service";

/**
 * Per-session reminder persistence and validation, used by the API. Timers and
 * delivery live in {@link RemindersWorkerModule}.
 */
@Module({
  imports: [PrismaModule],
  providers: [RemindersService],
  exports: [RemindersService],
})
export class RemindersModule {}
