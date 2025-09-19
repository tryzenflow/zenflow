import {
  BadRequestException,
  Body,
  Controller,
  Inject,
  OnModuleInit,
  Post,
  UseGuards,
} from "@nestjs/common";
import { type ClientGrpc } from "@nestjs/microservices";
import { addDays } from "date-fns";
import { firstValueFrom } from "rxjs";
import { type User } from "../../generated/prisma";
import { CookieAuthGuard } from "../auth/guards";
import { ConstraintsService } from "../constraints/constraints.service";
import { SchedulesService } from "../schedules/schedules.service";
import { extractDate } from "../schedules/utils";
import { TasksService } from "../tasks/tasks.service";
import { CurrentUser } from "../users/decorators/current-user.decorator";
import { SCHEDULER_PACKAGE, SCHEDULER_SERVICE } from "./constants";
import { ScheduleTasksDto } from "./dto/schedule-tasks.dto";
import { ScheduleRequest, ScheduleResponse } from "./interfaces";
import { SchedulerService } from "./scheduler.service";
import { validatePreSchedule } from "./validators/pre-schedule";
import { utcToMinutes } from "./utils";

@Controller()
@UseGuards(CookieAuthGuard)
export class SchedulerController implements OnModuleInit {
  private schedulerService: SchedulerService;

  constructor(
    @Inject(SCHEDULER_PACKAGE) private client: ClientGrpc,
    private constraintsService: ConstraintsService,
    private tasksService: TasksService,
    private schedulesService: SchedulesService
  ) {}

  onModuleInit() {
    this.schedulerService =
      this.client.getService<SchedulerService>(SCHEDULER_SERVICE);
  }

  @Post("schedule")
  async schedule(
    @CurrentUser() user: User,
    @Body() { scheduleDate, taskIds }: ScheduleTasksDto
  ) {
    const weekday = new Date(scheduleDate).getDay();
    const constraints = await this.constraintsService.getByWeekday(
      user.id,
      weekday
    );

    const tasks = await this.tasksService.findToSchedule(
      { scheduleDate, taskIds },
      user.id
    );

    if (tasks.length === 0 || !constraints)
      throw new BadRequestException({
        success: false,
        message: "No tasks to schedule or no constraints for the given day",
      });

    const request: ScheduleRequest = {
      constraints: {
        availableHours: constraints.availableHours,
        batchSimilarTasks: constraints.batchSimilarTasks,
        focusBlocks: constraints.focusBlocks.map(({ level, ...interval }) => ({
          level,
          interval,
        })),
        maxDailyLoad: constraints.maxDailyLoad,
        minGapBetweenTasks: constraints.minGapBetweenTasks,
      },
      tasks: tasks.map((task) => ({
        id: task.id,
        categoryId: task.categoryId ?? undefined,
        duration: task.duration,
        focus: task.focus,
        mandatory: task.mandatory,
        earliestStart: task.earliestStart ?? undefined,
        latestEnd: task.latestEnd ?? undefined,
        maxSplits: task.maxSplits,
        prerequisites: task.prerequisites.map((p) => p.id),
        priority: task.priority,
        title: task.title,
        deadline: task.deadline ?? undefined,
        schedules: task.schedules
          .filter((s) => s.start && s.end)
          .map((s) => ({
            split: s.split,
            start: utcToMinutes(new Date(s.start!), user.timezone),
            end: utcToMinutes(new Date(s.end!), user.timezone),
          })),
      })),
    };
    const errors = validatePreSchedule(request);
    if (errors.length > 0) throw new BadRequestException(errors);

    const response = await firstValueFrom<ScheduleResponse>(
      this.schedulerService.Schedule(request)
    );

    if (!response.schedules || response?.schedules?.length === 0)
      return {
        success: true,
        feasible: false,
        schedule: await this.schedulesService.findSchedules(
          {
            start: scheduleDate,
            end: extractDate(addDays(new Date(scheduleDate), 1)),
          },
          user.id,
          user.timezone
        ),
      };

    const unscheduledTasks = taskIds.filter(
      (id) => !response.schedules!.some((s) => s.taskId === id)
    );
    const schedule = await this.schedulesService.schedule(
      new Date(scheduleDate),
      [
        ...response.schedules,
        ...unscheduledTasks.map((id) => ({ split: 0, taskId: id })),
      ],
      user.timezone,
      user.id
    );
    return { success: true, feasible: true, schedule };
  }
}
