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
    const newTask = await this.tasksService.create(createTaskDto, user.id);
    return {
      success: true,
      message: "Create new task successfully",
      data: newTask,
    };
  }

  @Get()
  async findAll(@CurrentUser() user: User) {
    const tasks = await this.tasksService.find(user.id);
    return {
      success: true,
      message: `Found ${tasks.length} tasks`,
      data: tasks,
    };
  }

  @Get("/schedule/none")
  async findUnscheduled(@CurrentUser() user: User, @Query() dto: DateRangeDto) {
    const tasks = await this.tasksService.findUnscheduled(
      user.id,
      dto,
      user.timezone,
    );
    return {
      success: true,
      message: `Found ${tasks.length} unscheduled tasks between ${dto.start} and ${dto.end}`,
      data: tasks,
    };
  }

  @Get(":id")
  async findOne(
    @Param("id") id: string,
    @Query() query: DateRangeDto,
    @CurrentUser() user: User,
  ) {
    const task = await this.tasksService.findById(
      id,
      user.id,
      query,
      user.timezone,
    );
    return { success: true, message: `Found one task`, data: task };
  }

  @Patch(":id")
  async update(
    @Param("id") id: string,
    @Body() updateTaskDto: UpdateTaskDto,
    @CurrentUser() user: User,
  ) {
    const updated = await this.tasksService.update(id, updateTaskDto, user.id);
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
