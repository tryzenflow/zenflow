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
import { TasksService } from "../tasks/tasks.service";
import { CurrentUser } from "../users/decorators/current-user.decorator";
import { SCHEDULER_PACKAGE, SCHEDULER_SERVICE } from "./constants";
import { ScheduleTasksDto } from "./dto/schedule-tasks.dto";
import {
  ScheduleRequest,
  ScheduleResponse,
  Task,
  TaskSchedule,
} from "./interfaces";
import { SchedulerService } from "./scheduler.service";
import { validatePreSchedule } from "./validators/pre-schedule";
import { utcToMinutes, extractDate } from "../common/utils";
import { getAvailableHours } from "../constraints/utils";
import {
  getTaskDuration,
  getTaskEarliestStart,
  getTaskLatestEnd,
  getTaskMaxSplits,
} from "./utils";

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
    @Body() { scheduleDate, scheduleBased: schedulesBased }: ScheduleTasksDto
  ) {
    const weekday = new Date(scheduleDate).getDay();
    const constraints = await this.constraintsService.getByWeekday(
      user.id,
      weekday
    );

    const tasks = await this.tasksService.findToSchedule(scheduleDate, user.id);

    if (tasks.length === 0 || !constraints)
      throw new BadRequestException({
        success: false,
        feasible: false,
        message: "No tasks to schedule or no constraints for the given day",
        data: [],
      });

    const scheduleBasedTasks: Task[] = tasks.map((task) => ({
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
      schedules: task.schedules.map((s) => ({
        split: s.split,
        start: s.start
          ? utcToMinutes(new Date(s.start), user.timezone)
          : undefined,
        end: s.end ? utcToMinutes(new Date(s.end), user.timezone) : undefined,
      })),
    }));

    scheduleBasedTasks.forEach((t) => {
      t.duration = getTaskDuration(t, schedulesBased);
      t.earliestStart = getTaskEarliestStart(t, schedulesBased);
      t.latestEnd = getTaskLatestEnd(t, schedulesBased);
      t.maxSplits = getTaskMaxSplits(t, schedulesBased);
    });

    const request: ScheduleRequest = {
      scheduleBased: true,
      constraints: {
        availableHours: getAvailableHours(constraints.focusBlocks),
        batchSimilarTasks: constraints.batchSimilarTasks,
        focusBlocks: constraints.focusBlocks.map(({ level, ...interval }) => ({
          level,
          interval,
        })),
        maxDailyLoad: constraints.maxDailyLoad,
        minGapBetweenTasks: constraints.minGapBetweenTasks,
      },
      tasks: scheduleBasedTasks,
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
        message: `Cannot find a feasible schedule on ${scheduleDate}`,
        data: await this.schedulesService.findSchedules(
          {
            start: scheduleDate,
            end: extractDate(addDays(new Date(scheduleDate), 1)),
          },
          user.id,
          user.timezone
        ),
      };

    const scheduled = response.schedules!;

    const unscheduled: TaskSchedule[] = scheduleBasedTasks
      .filter(
        (task) =>
          !scheduled.some((s) => s.taskId === task.id) ||
          task.duration >
            scheduled.reduce((acc, s) => {
              if (
                s.start !== undefined &&
                s.end !== undefined &&
                s.taskId === task.id
              ) {
                acc += s.end - s.start;
              }
              return acc;
            }, 0)
      )
      .map((task) => ({
        taskId: task.id,
        split: scheduled.filter((s) => s.taskId === task.id).length,
      }));

    const schedule = await this.schedulesService.schedule(
      scheduleDate,
      [...response.schedules, ...unscheduled],
      user.timezone,
      user.id
    );
    return {
      success: true,
      feasible: true,
      message: `Schedule tasks on ${scheduleDate} successfully`,
      data: schedule,
    };
  }
}
