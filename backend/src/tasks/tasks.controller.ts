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
import { TasksService } from "./tasks.service";
import { CreateTaskDto } from "./dto/create-task.dto";
import { UpdateTaskDto } from "./dto/update-task.dto";
import { ListTasksDto } from "./dto/list-tasks.dto";
import { RescheduleTaskDto } from "./dto/reschedule-task.dto";
import { CookieAuthGuard } from "../auth/guards";
import { CurrentUser } from "../users/decorators/current-user.decorator";
import { type User } from "../../generated/prisma";
import type { RecurrenceScope } from "@zenflow/shared";

@Controller("tasks")
@UseGuards(CookieAuthGuard)
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post()
  async create(@Body() dto: CreateTaskDto, @CurrentUser() user: User) {
    const data = await this.tasksService.create(dto, user);
    return { success: true, message: "Task created", data };
  }

  @Get()
  async list(@Query() dto: ListTasksDto, @CurrentUser() user: User) {
    const data = await this.tasksService.list(dto, user);
    return {
      success: true,
      message: `Found ${data.tasks.length} tasks`,
      data,
    };
  }

  @Get(":id")
  async findOne(@Param("id") id: string, @CurrentUser() user: User) {
    const data = await this.tasksService.findById(id, user);
    return { success: true, message: "Found task", data };
  }

  @Patch(":id/reschedule")
  async reschedule(
    @Param("id") id: string,
    @Body() dto: RescheduleTaskDto,
    @CurrentUser() user: User,
  ) {
    const data = await this.tasksService.reschedule(
      id,
      dto.requestedStartTime,
      user,
    );
    return { success: true, message: "Task rescheduled", data };
  }

  @Patch(":id/complete")
  async complete(@Param("id") id: string, @CurrentUser() user: User) {
    const data = await this.tasksService.complete(id, user);
    return { success: true, message: "Task completed", data };
  }

  @Patch(":id")
  async update(
    @Param("id") id: string,
    @Body() dto: UpdateTaskDto,
    @CurrentUser() user: User,
  ) {
    const data = await this.tasksService.update(id, dto, user);
    return { success: true, message: "Task updated", data };
  }

  @Delete(":id")
  async remove(
    @Param("id") id: string,
    @Query("scope") scope: RecurrenceScope | undefined,
    @CurrentUser() user: User,
  ) {
    await this.tasksService.remove(id, user, scope);
    return { success: true, message: "Task deleted" };
  }
}
