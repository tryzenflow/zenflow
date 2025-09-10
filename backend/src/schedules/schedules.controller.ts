import {
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

@Controller("schedules")
@UseGuards(CookieAuthGuard)
export class SchedulesController {
  constructor(private readonly schedulesService: SchedulesService) {}

  @Put(":id/split/:split")
  update(
    @Param("id") id: string,
    @Param("split", ParseIntPipe) split: number,
    @Body() updateScheduleDto: UpdateScheduleDto
  ) {
    return this.schedulesService.update(id, split, updateScheduleDto);
  }

  @Delete(":id/split/:split")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param("id") id: string, @Param("split", ParseIntPipe) split: number) {
    return this.schedulesService.remove(id, split);
  }

  @Get()
  findSchedules(
    @Query() findSchedulesDto: FindSchedulesDto,
    @CurrentUser() user: User
  ) {
    return this.schedulesService.findSchedules(findSchedulesDto, user.timezone);
  }
}
