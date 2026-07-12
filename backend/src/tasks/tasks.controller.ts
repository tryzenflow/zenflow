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
import { SimulateTaskDto } from "./dto/simulate-task.dto";
import { UpdateTaskDto } from "./dto/update-task.dto";
import { ListTasksDto } from "./dto/list-tasks.dto";
import { ListTaskSuggestionsDto } from "./dto/list-task-suggestions.dto";
import { RescheduleTaskDto } from "./dto/reschedule-task.dto";
import { ResizeTaskDto } from "./dto/resize-task.dto";
import { DeadlineOptionsDto } from "./dto/deadline-options.dto";
import { CookieAuthGuard } from "../auth/guards";
import { CurrentUser } from "../users/decorators/current-user.decorator";
import { type User } from "../../generated/prisma";
import { deadlineOptions } from "./utils/deadline-options";

@Controller("tasks")
@UseGuards(CookieAuthGuard)
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post()
  async create(@Body() dto: CreateTaskDto, @CurrentUser() user: User) {
    const data = await this.tasksService.create(dto, user);
    return { success: true, message: "Task created", data };
  }

  @Post("simulate")
  async simulate(@Body() dto: SimulateTaskDto, @CurrentUser() user: User) {
    const data = await this.tasksService.simulate(dto, user);
    return { success: true, message: "Simulated placement", data };
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

  // NOTE: must precede @Get(":id") so "suggestions" isn't matched as an :id.
  @Get("suggestions")
  async suggestions(
    @Query() dto: ListTaskSuggestionsDto,
    @CurrentUser() user: User,
  ) {
    const data = await this.tasksService.suggestions(dto, user);
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
    const data = await this.tasksService.findById(id, user);
    return { success: true, message: "Found task", data };
  }

  @Patch(":id/reschedule")
  async reschedule(
    @Param("id") id: string,
    @Body() dto: RescheduleTaskDto,
    @CurrentUser() user: User,
  ) {
    const data = await this.tasksService.displace(
      id,
      dto.requestedStartTime,
      user,
    );
    return { success: true, message: "Task rescheduled", data };
  }

  @Patch(":id/resize")
  async resize(
    @Param("id") id: string,
    @Body() dto: ResizeTaskDto,
    @CurrentUser() user: User,
  ) {
    const data = await this.tasksService.resize(
      id,
      dto.requestedStartTime,
      dto.durationMinutes,
      user,
    );
    return { success: true, message: "Task resized", data };
  }

  // NOTE: a static "reschedule" prefix, distinct from the ":id/reschedule"
  // drag endpoint above — no route-matching ambiguity (different HTTP method
  // and path shape).
  @Post("reschedule/undo/:batchId")
  async undoBatch(
    @Param("batchId") batchId: string,
    @CurrentUser() user: User,
  ) {
    const data = await this.tasksService.undoBatch(batchId, user);
    return { success: true, message: "Reschedule undone", data };
  }

  @Patch(":id/complete")
  async complete(@Param("id") id: string, @CurrentUser() user: User) {
    const data = await this.tasksService.complete(id, user, new Date());
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
  async remove(@Param("id") id: string, @CurrentUser() user: User) {
    await this.tasksService.remove(id, user);
    return { success: true, message: "Task deleted" };
  }
}
