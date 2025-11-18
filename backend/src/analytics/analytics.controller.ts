import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { AnalyticsService } from "./analytics.service";
import { FindSchedulesDto } from "../schedules/dto/find-schedules.dto";
import { CurrentUser } from "../users/decorators/current-user.decorator";
import { type User } from "../../generated/prisma";
import { CookieAuthGuard } from "../auth/guards";

@Controller("analytics")
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get("summary")
  @UseGuards(CookieAuthGuard)
  async getSummaryStatistics(
    @CurrentUser() user: User,
    @Query() query: FindSchedulesDto
  ) {
    return this.analyticsService.getDashboardSummary(
      user.id,
      user.timezone,
      query
    );
  }
}
