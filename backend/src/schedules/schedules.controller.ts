import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { DateRangeDto } from "../common/dto/date-range.dto";
import { UpdateEventDto } from "./dto/update-schedule.dto";
import { SchedulesService } from "./schedules.service";
import { CookieAuthGuard } from "../auth/guards";
import { CurrentUser } from "../users/decorators/current-user.decorator";
import { type User } from "../../generated/prisma";

@Controller("schedules")
@UseGuards(CookieAuthGuard)
export class SchedulesController {
  constructor(private readonly schedulesService: SchedulesService) {}

  @Patch(":id")
  async update(
    @Param("id") id: string,
    @Body() updateScheduleDto: UpdateEventDto,
    @CurrentUser() user: User,
  ) {
    const updated = await this.schedulesService.update(
      id,
      updateScheduleDto,
      user.id,
      user.timezone,
    );
    return {
      success: true,
      message: "Update the scheduled task successfully",
      data: updated,
    };
  }

  @Delete(":id")
  async remove(@Param("id") id: string, @CurrentUser() user: User) {
    await this.schedulesService.remove(id, user.id);
    return { success: true, message: "Delete the scheduled task successfully" };
  }

  @Get()
  async findSchedules(
    @Query() findSchedulesDto: DateRangeDto,
    @CurrentUser() user: User,
  ) {
    const schedules = await this.schedulesService.findScheduledBlocks(
      user.id,
      findSchedulesDto,
      user.timezone,
    );
    return {
      success: true,
      message: `Found ${schedules.length} scheduled tasks between ${findSchedulesDto.start} and ${findSchedulesDto.end}`,
      data: schedules,
    };
  }
}
