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
  UseInterceptors,
} from "@nestjs/common";
import { SessionsService } from "./sessions.service";
import { CreateSessionDto } from "./dto/create-session.dto";
import { UpdateSessionDto } from "./dto/update-session.dto";
import { SlotPickDto } from "./dto/slot-pick.dto";
import { ListSessionsDto } from "./dto/list-sessions.dto";
import { ListSessionSuggestionsDto } from "./dto/list-session-suggestions.dto";
import { DeadlineOptionsDto } from "./dto/deadline-options.dto";
import { SearchSessionsDto } from "./dto/search-sessions.dto";
import { SessionSearchService } from "./session-search.service";
import { SignNoteFilesInterceptor } from "./sign-note-files.interceptor";
import { CookieAuthGuard } from "../auth/guards";
import { CurrentUser } from "../users/decorators/current-user.decorator";
import { type User } from "../../generated/prisma";
import { deadlineOptions } from "./utils/deadline-options";
import { ConfirmPlacementDto } from "./dto/confirm-placement.dto";
import { PlacementPlanService } from "./placement-plan.service";
import { SessionAnchorService } from "./session-anchor.service";

@Controller("sessions")
@UseGuards(CookieAuthGuard)
@UseInterceptors(SignNoteFilesInterceptor)
export class SessionsController {
  constructor(
    private readonly sessionsService: SessionsService,
    private readonly searchService: SessionSearchService,
    private readonly placementPlans: PlacementPlanService,
    private readonly anchors: SessionAnchorService,
  ) {}

  // NOTE: must precede @Post(":id/...") routes so "placement" isn't matched as an :id.
  /** Apply a plan the scheduler asked to confirm (ADR-0022). Atomic. */
  @Post("placement/confirm")
  async confirmPlacement(
    @Body() dto: ConfirmPlacementDto,
    @CurrentUser() user: User,
  ) {
    const data = await this.placementPlans.confirm(user, dto.planId);
    return { success: true, message: "Placement confirmed", data };
  }

  /** Revert every move one undo group made (a drag, a cascade or a confirmed plan). */
  @Post("undo/:groupId")
  async undoPlacement(
    @Param("groupId") groupId: string,
    @CurrentUser() user: User,
  ) {
    const data = await this.placementPlans.undo(user, groupId);
    return {
      success: true,
      message: `Restored ${data.restored.length} session(s)`,
      data,
    };
  }

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

  // NOTE: must precede @Get(":id") so "search" isn't matched as an :id.
  @Get("search")
  async search(@Query() dto: SearchSessionsDto, @CurrentUser() user: User) {
    const data = await this.searchService.search(dto, user);
    return {
      success: true,
      message: `Found ${data.sessions.length} sessions`,
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

  /** Pin a task: the scheduler never moves it (ADR-0022). */
  @Post(":id/pin")
  async pin(@Param("id") id: string, @CurrentUser() user: User) {
    const data = await this.anchors.pin(id, user);
    return { success: true, message: "Session pinned", data };
  }

  /** Unpin a task: back to `AUTO`. */
  @Delete(":id/pin")
  async unpin(@Param("id") id: string, @CurrentUser() user: User) {
    const data = await this.anchors.unpin(id, user);
    return { success: true, message: "Session unpinned", data };
  }

  @Post(":id/slot-pick")
  async slotPick(
    @Param("id") id: string,
    @Body() dto: SlotPickDto,
    @CurrentUser() user: User,
  ) {
    const data = await this.sessionsService.slotPick(id, dto, user);
    return { success: true, message: "Slot pick recorded", data };
  }

  @Post(":id/complete")
  async complete(@Param("id") id: string, @CurrentUser() user: User) {
    const data = await this.sessionsService.setCheckOff(
      id,
      "complete",
      true,
      user,
    );
    return { success: true, message: "Session completed", data };
  }

  @Delete(":id/complete")
  async uncomplete(@Param("id") id: string, @CurrentUser() user: User) {
    const data = await this.sessionsService.setCheckOff(
      id,
      "complete",
      false,
      user,
    );
    return { success: true, message: "Completion undone", data };
  }

  @Post(":id/skip")
  async skip(@Param("id") id: string, @CurrentUser() user: User) {
    const data = await this.sessionsService.setCheckOff(id, "skip", true, user);
    return { success: true, message: "Session skipped", data };
  }

  @Delete(":id/skip")
  async unskip(@Param("id") id: string, @CurrentUser() user: User) {
    const data = await this.sessionsService.setCheckOff(
      id,
      "skip",
      false,
      user,
    );
    return { success: true, message: "Skip undone", data };
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

  // NOTE: must precede @Delete(":id") so "timetable-group" isn't matched as
  // an :id, same ordering constraint as the "series/..." routes above.
  @Delete("timetable-group/:sessionId/from")
  async removeTimetableGroupFrom(
    @Param("sessionId") sessionId: string,
    @CurrentUser() user: User,
  ) {
    const data = await this.sessionsService.removeTimetableGroupFrom(
      sessionId,
      user,
    );
    return {
      success: true,
      message: `Deleted ${data.removedSessionIds.length} sessions`,
      data,
    };
  }

  @Delete("timetable-group/:sessionId")
  async removeTimetableGroup(
    @Param("sessionId") sessionId: string,
    @CurrentUser() user: User,
  ) {
    const data = await this.sessionsService.removeTimetableGroup(
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
