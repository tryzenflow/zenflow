import { Module } from "@nestjs/common";
import { ConstraintsService } from "./constraints.service";
import { ConstraintsController } from "./constraints.controller";
import { PrismaModule } from "../prisma/prisma.module";

@Module({
  imports: [PrismaModule],
  controllers: [ConstraintsController],
  providers: [ConstraintsService],
  exports: [ConstraintsService],
})
export class ConstraintsModule {}
