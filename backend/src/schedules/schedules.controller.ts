import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
import { isDateString } from "class-validator";
import { getDateOnlyString } from "./utils";

@Controller("schedules")
@UseGuards(CookieAuthGuard)
export class SchedulesController {
  constructor(private readonly schedulesService: SchedulesService) {}

  @Put(":year/:month/:day/tasks/:id/split/:split")
  update(
    @Param("id") id: string,
    @Param("split", ParseIntPipe) split: number,
    @Param("year", ParseIntPipe) year: number,
    @Param("month", ParseIntPipe) month: number,
    @Param("day", ParseIntPipe) day: number,
    @Body() updateScheduleDto: UpdateScheduleDto
  ) {
    const date = new Date(getDateOnlyString(year, month, day));
    return this.schedulesService.update(date, id, split, updateScheduleDto);
  }

  @Delete(":year/:month/:day/tasks/:id/split/:split")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param("year", ParseIntPipe) year: number,
    @Param("month", ParseIntPipe) month: number,
    @Param("day", ParseIntPipe) day: number,
    @Param("id") id: string,
    @Param("split", ParseIntPipe) split: number
  ) {
    const date = new Date(getDateOnlyString(year, month, day));
    return this.schedulesService.remove(date, id, split);
  }

  @Get()
  findSchedules(
    @Query() findSchedulesDto: FindSchedulesDto,
    @CurrentUser() user: User
  ) {
    return this.schedulesService.findSchedules(findSchedulesDto, user.timezone);
  }
}
