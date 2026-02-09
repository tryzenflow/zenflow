import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Query,
  Patch,
} from "@nestjs/common";
import { TasksService } from "./tasks.service";
import { CreateTaskDto } from "./dto/create-task.dto";
import { UpdateTaskDto } from "./dto/update-task.dto";
import { CookieAuthGuard } from "../auth/guards";
import { CurrentUser } from "../users/decorators/current-user.decorator";
import { type User } from "../../generated/prisma";
import { DateRangeDto } from "../common/dto/date-range.dto";

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

  @Get("recurring")
  async findRecurringTasks(
    @CurrentUser() user: User,
    @Query() dateRangeDto: DateRangeDto,
  ) {
    const tasks = await this.tasksService.findRecurringTasks(
      user.id,
      user.timezone,
      dateRangeDto,
    );
    return {
      success: true,
      message: `Found ${tasks.length} recurring tasks`,
      data: tasks,
    };
  }

  @Get(":id/details")
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
}
