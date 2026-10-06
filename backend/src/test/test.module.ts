import { Module } from "@nestjs/common";
import { TestController } from "./test.controller";
import { TestService } from "./test.service";
import { PrismaModule } from "../prisma/prisma.module";

/**
 * Test-only module — conditionally imported in AppModule when
 * `NODE_ENV === "test"`. Provides `/test/reset` and `/test/seed-task`
 * endpoints for Maestro E2E flows.
 */
@Module({
  imports: [PrismaModule],
  controllers: [TestController],
  providers: [TestService],
})
export class TestModule {}
