import {
  BadRequestException,
  Body,
  Controller,
  Inject,
  OnModuleInit,
  Post,
  UseGuards,
} from "@nestjs/common";
import { SCHEDULER_PACKAGE, SCHEDULER_SERVICE } from "./constants";
import { type ClientGrpc } from "@nestjs/microservices";
import { SchedulerService } from "./scheduler.service";
import { ScheduleRequest, ScheduleResponse } from "./interfaces";
import { ConstraintsService } from "../constraints/constraints.service";
import { TasksService } from "../tasks/tasks.service";
import { CookieAuthGuard } from "../auth/guards";
import { CurrentUser } from "../users/decorators/current-user.decorator";
import { type User } from "../../generated/prisma";
import { ScheduleTasksDto } from "./dto/schedule-tasks.dto";
import { SchedulesService } from "../schedules/schedules.service";
import { utcToMinutes } from "./utils";
import { validatePreSchedule } from "./validators/pre-schedule";
import { firstValueFrom } from "rxjs";
import { addDays, endOfDay, startOfDay } from "date-fns";
import { extractDate } from "../schedules/utils";

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
    const constraints = await this.constraintsService.get(user.id);
    const nextDate = new Date(scheduleDate);
    nextDate.setDate(nextDate.getDate() + 1);

    const tasks = await this.tasksService.find(user.id, taskIds);

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
      })),
    };
    const errors = validatePreSchedule(request);
    if (errors.length > 0) throw new BadRequestException(errors);

    const response = await firstValueFrom<ScheduleResponse>(
      this.schedulerService.Schedule(request)
    );

    if (response.schedules.length === 0)
      return {
        feasible: false,
        schedule: await this.schedulesService.findSchedules(
          {
            start: scheduleDate,
            end: extractDate(addDays(new Date(scheduleDate), 1)),
          },
          user.timezone
        ),
      };
    const schedule = await this.schedulesService.schedule(
      new Date(scheduleDate),
      response,
      user.timezone
    );
    return { feasible: true, schedule };
  }
}
