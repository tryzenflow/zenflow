import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { FindSchedulesDto } from "./dto/find-schedules.dto";
import { UpdateScheduleDto } from "./dto/update-schedule.dto";
import { SchedulesService } from "./schedules.service";
import { CookieAuthGuard } from "../auth/guards";
import { CurrentUser } from "../users/decorators/current-user.decorator";
import { type User } from "../../generated/prisma";
import { getDateOnlyString } from "../common/utils";

@Controller("schedules")
@UseGuards(CookieAuthGuard)
export class SchedulesController {
  constructor(private readonly schedulesService: SchedulesService) {}

  @Put(":year/:month/:day/tasks/:id/split/:split")
  async update(
    @Param("id") id: string,
    @Param("split", ParseIntPipe) split: number,
    @Param("year", ParseIntPipe) year: number,
    @Param("month", ParseIntPipe) month: number,
    @Param("day", ParseIntPipe) day: number,
    @Body() updateScheduleDto: UpdateScheduleDto,
    @CurrentUser() user: User
  ) {
    const date = getDateOnlyString(year, month, day);
    const updated = await this.schedulesService.update(
      date,
      id,
      split,
      updateScheduleDto,
      user.id,
      user.timezone
    );
    return {
      success: true,
      message: "Update the scheduled task successfully",
      data: updated,
    };
  }

  @Delete(":year/:month/:day/tasks/:id/split/:split")
  async remove(
    @Param("year", ParseIntPipe) year: number,
    @Param("month", ParseIntPipe) month: number,
    @Param("day", ParseIntPipe) day: number,
    @Param("id") id: string,
    @Param("split", ParseIntPipe) split: number,
    @CurrentUser() user: User
  ) {
    const date = getDateOnlyString(year, month, day);
    await this.schedulesService.remove(date, id, split, user.id);
    return { success: true, message: "Delete the scheduled task successfully" };
  }

  @Get()
  async findSchedules(
    @Query() findSchedulesDto: FindSchedulesDto,
    @CurrentUser() user: User
  ) {
    const schedules = await this.schedulesService.findSchedules(
      findSchedulesDto,
      user.id,
      user.timezone
    );
    return {
      success: true,
      message: `Found ${schedules.length} scheduled tasks between ${findSchedulesDto.start} and ${findSchedulesDto.end}`,
      data: schedules,
    };
  }
}
