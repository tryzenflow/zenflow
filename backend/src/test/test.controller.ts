import {
  Body,
  Controller,
  Post,
  UseGuards,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { TestService } from "./test.service";
import { CookieAuthGuard } from "../auth/guards";
import { CurrentUser } from "../users/decorators/current-user.decorator";
import type { SessionType, User } from "../../generated/prisma";

/**
 * Test-only controller — registered conditionally in AppModule when
 * `NODE_ENV === "test"`. Never available in production.
 *
 * Provides endpoints for:
 * - resetting all test data (truncate)
 * - seeding deterministic tasks for Maestro E2E flows
 */
@ApiTags("test")
@Controller("test")
export class TestController {
  constructor(private readonly testService: TestService) {}

  /**
   * Truncate all user data tables. No auth required — this endpoint only
   * exists in test builds and is called before the first login of a run.
   */
  @Post("reset")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Reset all test data",
    description:
      "Truncates all user data tables. Only available when NODE_ENV=test.",
  })
  async reset() {
    await this.testService.resetDatabase();
    return { success: true, message: "Test data reset" };
  }

  /**
   * Seed a task for the authenticated test user. Requires a valid session
   * cookie (the caller must have completed OTP login first).
   */
  @Post("seed-task")
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(CookieAuthGuard)
  @ApiOperation({
    summary: "Seed a test task for the authenticated user",
    description:
      "Creates a session/task directly via Prisma. Only available when NODE_ENV=test.",
  })
  async seedTask(
    @CurrentUser() user: User,
    @Body()
    body: {
      title: string;
      type: SessionType;
      deadline: string;
      durationMinutes: number;
      sessionCount?: number;
      scheduledStartTime?: string;
    },
  ) {
    const result = await this.testService.seedTask(user.id, body);
    return { success: true, data: result };
  }
}
