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
        energyBlocks: constraints.energyBlocks.map(
          ({ energyLevel, ...interval }) => ({
            energyLevel: energyLevel,
            interval,
          })
        ),
        maxDailyLoad: constraints.maxDailyLoad,
        minGapBetweenTasks: constraints.minGapBetweenTasks,
      },
      tasks: tasks.map((task) => ({
        id: task.id,
        categoryId: task.categoryId ?? undefined,
        duration: task.duration,
        energyLevel: task.energyLevel,
        mandatory: task.mandatory,
        fixedStart: task.fixedStart ?? undefined,
        earliestStart: task.earliestStart ?? undefined,
        latestEnd: task.latestEnd ?? undefined,
        maxSplits: task.maxSplits,
        prerequisites: task.prerequisites.map((p) => p.id),
        priority: task.priority,
        splittable: task.splittable,
        title: task.title,
        deadline: task.deadline ?? undefined,
      })),
    };
    const errors = validatePreSchedule(request);
    if (errors.length > 0) throw new BadRequestException(errors);

    const response = await firstValueFrom<ScheduleResponse>(
      this.schedulerService.Schedule(request)
    );

    const saved = await this.schedulesService.create(
      new Date(scheduleDate),
      response,
      user.timezone
    );
    return saved;
  }
}
