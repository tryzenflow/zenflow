import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { SessionsService } from "./sessions.service";
import { CreateSessionDto } from "./dto/create-session.dto";
import { UpdateSessionDto } from "./dto/update-session.dto";
import { ListSessionsDto } from "./dto/list-sessions.dto";
import { ListSessionSuggestionsDto } from "./dto/list-session-suggestions.dto";
import { DeadlineOptionsDto } from "./dto/deadline-options.dto";
import { CookieAuthGuard } from "../auth/guards";
import { CurrentUser } from "../users/decorators/current-user.decorator";
import { type User } from "../../generated/prisma";
import { deadlineOptions } from "./utils/deadline-options";

@Controller("sessions")
@UseGuards(CookieAuthGuard)
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Post()
  async create(@Body() dto: CreateSessionDto, @CurrentUser() user: User) {
    const data = await this.sessionsService.create(dto, user);
    return { success: true, message: "Session created", data };
  }

  @Get()
  async list(@Query() dto: ListSessionsDto, @CurrentUser() user: User) {
    const data = await this.sessionsService.list(dto, user);
    return {
      success: true,
      message: `Found ${data.sessions.length} sessions`,
      data,
    };
  }

  // NOTE: must precede @Get(":id") so "suggestions" isn't matched as an :id.
  @Get("suggestions")
  async suggestions(
    @Query() dto: ListSessionSuggestionsDto,
    @CurrentUser() user: User,
  ) {
    const data = await this.sessionsService.suggestions(dto, user);
    return {
      success: true,
      message: `Found ${data.suggestions.length} suggestions`,
      data,
    };
  }

  // NOTE: must precede @Get(":id") so "deadline-options" isn't matched as an :id.
  @Get("deadline-options")
  deadlineOptions(@Query() dto: DeadlineOptionsDto, @CurrentUser() user: User) {
    const data = deadlineOptions(dto.anchor, user);
    return { success: true, message: "Deadline options", data };
  }

  @Get(":id")
  async findOne(@Param("id") id: string, @CurrentUser() user: User) {
    const data = await this.sessionsService.findById(id, user);
    return { success: true, message: "Found session", data };
  }

  @Patch(":id")
  async update(
    @Param("id") id: string,
    @Body() dto: UpdateSessionDto,
    @CurrentUser() user: User,
  ) {
    const data = await this.sessionsService.update(id, dto, user);
    return { success: true, message: "Session updated", data };
  }

  // NOTE: must precede @Delete(":id") so "series" isn't matched as an :id.
  @Delete("series/:seriesId")
  async removeSeries(
    @Param("seriesId") seriesId: string,
    @CurrentUser() user: User,
  ) {
    const data = await this.sessionsService.removeSeries(seriesId, user);
    return {
      success: true,
      message: `Deleted ${data.removedSessionIds.length} sessions`,
      data,
    };
  }

  // "Delete this occurrence and all following" for a recurring (rrule) series:
  // pulls the rrule's UNTIL back to just before `?from=<ISO instant>`.
  @Delete("series/:seriesId/truncate")
  async truncateSeriesFrom(
    @Param("seriesId") seriesId: string,
    @Query("from") from: string,
    @CurrentUser() user: User,
  ) {
    const data = await this.sessionsService.truncateSeriesFrom(
      seriesId,
      from,
      user,
    );
    return { success: true, message: "Series truncated", data };
  }

  @Delete("series/:seriesId/from/:sessionId")
  async removeSeriesFrom(
    @Param("seriesId") seriesId: string,
    @Param("sessionId") sessionId: string,
    @CurrentUser() user: User,
  ) {
    const data = await this.sessionsService.removeSeriesFrom(
      seriesId,
      sessionId,
      user,
    );
    return {
      success: true,
      message: `Deleted ${data.removedSessionIds.length} sessions`,
      data,
    };
  }

  @Delete(":id")
  async remove(@Param("id") id: string, @CurrentUser() user: User) {
    const data = await this.sessionsService.remove(id, user);
    return { success: true, message: "Session deleted", data };
  }
}
