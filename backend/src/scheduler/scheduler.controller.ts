import {
  Body,
  Controller,
  Inject,
  OnModuleInit,
  Post,
  UseGuards,
} from "@nestjs/common";
import { type ClientGrpc } from "@nestjs/microservices";
import { fromZonedTime } from "date-fns-tz";
import { firstValueFrom } from "rxjs";
import { type User } from "../../generated/prisma";
import { CookieAuthGuard } from "../auth/guards";
import { UserPreferencesService } from "../prefs/prefs.service";
import { SchedulesService } from "../schedules/schedules.service";
import { TasksService } from "../tasks/tasks.service";
import { CurrentUser } from "../users/decorators/current-user.decorator";
import { SCHEDULER_PACKAGE, SCHEDULER_SERVICE } from "./constants";
import { ScheduleTasksDto } from "./dto/schedule-tasks.dto";
import { ScheduleRequest, ScheduleResponse, Task } from "./interfaces";
import { SchedulerService } from "./scheduler.service";
import { utcToMinutes } from "src/common/utils";
import { inferMaxSplits } from "src/tasks/utils/infer-max-splits";
import { differenceInMinutes } from "date-fns";

@Controller()
@UseGuards(CookieAuthGuard)
export class SchedulerController implements OnModuleInit {
  private schedulerService: SchedulerService;

  constructor(
    @Inject(SCHEDULER_PACKAGE) private client: ClientGrpc,
    private userPreferencesService: UserPreferencesService,
    private tasksService: TasksService,
    private schedulesService: SchedulesService,
  ) {}

  onModuleInit() {
    this.schedulerService =
      this.client.getService<SchedulerService>(SCHEDULER_SERVICE);
  }

  @Post("schedule")
  async schedule(
    @CurrentUser() user: User,
    @Body() { scheduleDate, keepManual, minTime }: ScheduleTasksDto,
  ) {
    const utcMidnight = fromZonedTime(
      `${scheduleDate}T00:00:00`,
      user.timezone,
    );
    const day = utcMidnight.getDay();

    const userPreference = await this.userPreferencesService.getByDay(
      user.id,
      day,
    );

    const tasks = await this.tasksService.findToSchedule(
      user.id,
      user.timezone,
      scheduleDate,
      keepManual,
      minTime,
    );
    console.log("tasks:", tasks);

    const toScheduleTasks: Task[] = tasks.map((task) => {
      const eventsAfterMinTime = task.events.filter(
        (e) =>
          e.end !== null && minTime <= utcToMinutes(e.start, user.timezone),
      );
      const actualDuration =
        !keepManual || eventsAfterMinTime.length === 0
          ? task.duration
          : eventsAfterMinTime.reduce(
              (acc, block) =>
                acc +
                (block.end
                  ? utcToMinutes(block.end, user.timezone) -
                    utcToMinutes(block.start, user.timezone)
                  : 0),
              0,
            );
      const maxSplits = keepManual
        ? task.events.length
        : inferMaxSplits(task.duration);

      const minutesDiff = task.deadline
        ? differenceInMinutes(task.deadline, utcMidnight)
        : undefined;
      return {
        id: task.id,
        categoryId: task.categoryId ?? undefined,
        duration: actualDuration,
        energy: task.energy,
        title: task.title,
        maxSplits,
        deadline: !minutesDiff || minutesDiff <= 0 ? undefined : minutesDiff,
        fixedWindow: task.fixedWindow ?? undefined,
        events: keepManual
          ? eventsAfterMinTime.map((e) => ({
              id: e.id,
              taskId: task.id,
              splitIndex: e.splitIndex,
              start: utcToMinutes(e.start, user.timezone),
              end: e.end ? utcToMinutes(e.end, user.timezone) : null,
            }))
          : [],
      };
    });

    const request: ScheduleRequest = {
      minTime,
      userPreference: {
        energyZones: userPreference.energyZones.map((eb) => ({
          level: eb.level,
          interval: { start: eb.start, end: eb.end },
        })),
        breakMinutes: userPreference.breakMinutes,
      },
      tasks: toScheduleTasks,
    };

    const response = await firstValueFrom<ScheduleResponse>(
      this.schedulerService.Schedule(request),
    );

    if (!response.events) {
      return {
        success: true,
        feasible: false,
        message: `Cannot find a feasible schedule on ${scheduleDate}`,
        data: [],
      };
    }

    await this.schedulesService.schedule(
      scheduleDate,
      response.events,
      user.timezone,
    );
    return {
      success: true,
      feasible: true,
      message: `Schedule tasks on ${scheduleDate} successfully`,
    };
  }
}
