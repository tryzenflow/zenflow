import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
} from "@nestjs/common";
import { TasksService } from "./tasks.service";
import { CreateTaskDto } from "./dto/create-task.dto";
import { UpdateTaskDto } from "./dto/update-task.dto";
import { CookieAuthGuard } from "../auth/guards";
import { CurrentUser } from "../users/decorators/current-user.decorator";
import { type User } from "../../generated/prisma";
import { FindSchedulesDto } from "../schedules/dto/find-schedules.dto";

@Controller("tasks")
@UseGuards(CookieAuthGuard)
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post()
  async create(
    @Body() createTaskDto: CreateTaskDto,
    @CurrentUser() user: User,
  ) {
    const newTask = await this.tasksService.create(
      createTaskDto,
      user.id,
      user.timezone,
    );
    return {
      success: true,
      message: "Create new task successfully",
      data: newTask,
    };
  }

  @Get()
  async findAll(@CurrentUser() user: User, @Query() dto: FindSchedulesDto) {
    const tasks = await this.tasksService.find(user.id, dto);
    return {
      success: true,
      message: `Found ${tasks.length} tasks between ${dto.start} and ${dto.end}`,
      data: tasks,
    };
  }

  @Get("/schedule/none")
  async findUnscheduled(
    @CurrentUser() user: User,
    @Query() dto: FindSchedulesDto,
  ) {
    const groups = await this.tasksService.findUnscheduled(
      user.id,
      dto,
      user.timezone,
    );
    return {
      success: true,
      data: groups,
    };
  }

  @Get(":id")
  async findOne(@Param("id") id: string, @CurrentUser() user: User) {
    const task = await this.tasksService.findById(id, user.id);
    return { success: true, message: `Found one task`, data: task };
  }

  @Patch(":id")
  async update(
    @Param("id") id: string,
    @Body() updateTaskDto: UpdateTaskDto,
    @CurrentUser() user: User,
  ) {
    const updated = await this.tasksService.update(
      id,
      updateTaskDto,
      user.id,
      user.timezone,
    );
    return {
      success: true,
      data: updated,
      message: `Sucessfully updated task`,
    };
  }

  @Delete(":id")
  async remove(@Param("id") id: string, @CurrentUser() user: User) {
    await this.tasksService.remove(id, user.id);
    return { success: true, message: `Successfully delete task` };
  }
}
