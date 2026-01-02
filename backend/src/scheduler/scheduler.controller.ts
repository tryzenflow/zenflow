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
    @Body() { scheduleDate, taskIds, keepManual }: ScheduleTasksDto,
  ) {
    const localMidnight = fromZonedTime(
      `${scheduleDate}T00:00:00`,
      user.timezone,
    );
    const day = localMidnight.getDay();

    const userPreference = await this.userPreferencesService.getByDay(
      user.id,
      day,
    );

    const tasks = await this.tasksService.findToSchedule(
      taskIds,
      user.id,
      scheduleDate,
      user.timezone,
      keepManual,
    );

    const toScheduleTasks: Task[] = tasks.map((task) => {
      const actualDuration =
        !keepManual || task.scheduledBlocks.length === 0
          ? task.duration
          : task.scheduledBlocks.reduce(
              (acc, block) =>
                acc +
                utcToMinutes(block.end, user.timezone) -
                utcToMinutes(block.start, user.timezone),
              0,
            );
      const maxSplits = keepManual
        ? task.scheduledBlocks.length
        : inferMaxSplits(task.duration);
      return {
        id: task.id,
        categoryId: task.categoryId ?? undefined,
        duration: actualDuration,
        energy: task.energy,
        priority: task.priority,
        title: task.title,
        maxSplits,
        deadline: task.deadline ?? undefined,
        fixedWindow: task.fixedWindow ?? undefined,
        preferredWindows: task.preferredWindows ?? undefined,
        scheduledBlocks: keepManual
          ? task?.scheduledBlocks.map((s) => ({
              taskId: task.id,
              splitIndex: s.splitIndex,
              start: utcToMinutes(s.start, user.timezone),
              end: utcToMinutes(s.end, user.timezone),
            }))
          : [],
      };
    });

    const request: ScheduleRequest = {
      userPreference: {
        energyBlocks: userPreference.energyBlocks.map((eb) => ({
          energy: eb.energy,
          interval: { start: eb.start, end: eb.end },
        })),
        minGapBetweenTasks: userPreference.minGapBetweenTasks,
      },
      tasks: toScheduleTasks,
    };

    const response = await firstValueFrom<ScheduleResponse>(
      this.schedulerService.Schedule(request),
    );

    if (!response.scheduledBlocks) {
      return {
        success: true,
        feasible: false,
        message: `Cannot find a feasible schedule on ${scheduleDate}`,
        data: [],
      };
    }

    const schedule = await this.schedulesService.schedule(
      scheduleDate,
      response.scheduledBlocks,
      user.timezone,
      user.id,
    );
    return {
      success: true,
      feasible: true,
      message: `Schedule tasks on ${scheduleDate} successfully`,
      data: schedule,
    };
  }
}
