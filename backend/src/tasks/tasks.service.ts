import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { fromZonedTime } from "date-fns-tz";
import { PrismaService } from "../prisma/prisma.service";
import { SchedulerService } from "../scheduler/scheduler.service";
import { Prisma, type Task, type User } from "../../generated/prisma";
import { PostgresErrorCode } from "../prisma/error-codes";
import { minutesToUtc } from "../common/utils";
import { localDateStr } from "../scheduler/slot";
import { viewDayRange, sumWorkMinutes } from "../scheduler/horizon";
import { expandRecurring } from "./utils/expand-recurring";
import { CreateTaskDto } from "./dto/create-task.dto";
import { UpdateTaskDto } from "./dto/update-task.dto";
import { ListTasksDto } from "./dto/list-tasks.dto";
import type {
  CreateTaskResponse,
  Task as SharedTask,
  TaskDetailResponse,
  TasksListResponse,
} from "@zenflow/shared";

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduler: SchedulerService,
  ) {}

  /** Map a Prisma row to the shared API shape (dates → ISO strings). */
  private toDto(task: Task, overrides?: Partial<SharedTask>): SharedTask {
    return {
      id: task.id,
      title: task.title,
      note: task.note,
      durationMinutes: task.durationMinutes,
      deadline: task.deadline ? task.deadline.toISOString() : null,
      tags: task.tags,
      fixed: task.fixed,
      startTime: task.startTime,
      status: task.status,
      conflict: task.conflict,
      rrule: task.rrule,
      scheduledStartTime: task.scheduledStartTime
        ? task.scheduledStartTime.toISOString()
        : null,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
      seriesId: null,
      ...overrides,
    };
  }

  async create(
    dto: CreateTaskDto,
    user: User,
  ): Promise<CreateTaskResponse> {
    const { startDate, fixed, startTime, ...rest } = dto;
    const tz = user.timezone;

    // A fixed task is anchored immediately at its chosen day + time-of-day.
    // A flexible task uses the same day (the calendar view it was created from)
    // as the earliest placement bound, so the engine schedules it on/after that
    // day rather than at the first open slot from now.
    let fixedStart: Date | null = null;
    let earliest: Date | undefined;
    if (fixed) {
      const day = startDate ?? localDateStr(new Date(), tz);
      fixedStart = minutesToUtc(day, startTime ?? 0, tz);
    } else if (startDate) {
      earliest = minutesToUtc(startDate, 0, tz);
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.task.create({
          data: {
            title: rest.title,
            note: rest.note ?? null,
            durationMinutes: rest.durationMinutes,
            deadline: rest.deadline ? new Date(rest.deadline) : null,
            tags: rest.tags ?? [],
            fixed: fixed ?? false,
            startTime: startTime ?? 0,
            rrule: rest.rrule ?? "",
            userId: user.id,
            scheduledStartTime: fixedStart,
            conflict: false,
          },
        });

        if (!created.fixed) {
          await this.scheduler.placeNewTask(user, created, tx, earliest);
        }

        const finalTask = await tx.task.findUniqueOrThrow({
          where: { id: created.id },
        });

        await tx.taskEvent.create({
          data: {
            taskId: finalTask.id,
            userId: user.id,
            eventType: "CREATE",
            oldSnapshot: Prisma.JsonNull,
            newSnapshot: {
              scheduledStartTime: finalTask.scheduledStartTime
                ? finalTask.scheduledStartTime.toISOString()
                : null,
              durationMinutes: finalTask.durationMinutes,
            },
            rewardScore: 1.0,
          },
        });

        return {
          task: this.toDto(finalTask),
          schedulingMeta: {
            adjustedDuration: finalTask.durationMinutes,
            placedAt: finalTask.scheduledStartTime
              ? finalTask.scheduledStartTime.toISOString()
              : null,
            engine: "edf" as const,
            biasApplied: 1.0,
          },
        };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === PostgresErrorCode.ForeignViolation)
          throw new BadRequestException({
            success: false,
            message: "Cannot create task: associated user does not exist",
          });
      }
      throw new InternalServerErrorException({
        success: false,
        message: "Something went wrong when creating a task",
      });
    }
  }

  async list(dto: ListTasksDto, user: User): Promise<TasksListResponse> {
    const tz = user.timezone;
    const { startStr, endStr } = viewDayRange(dto.view, dto.date);
    const windowStart = fromZonedTime(`${startStr}T00:00:00`, tz);
    const windowEnd = fromZonedTime(`${endStr}T23:59:59.999`, tz);

    const where: Prisma.TaskWhereInput = { userId: user.id };
    if (dto.status && dto.status !== "all") where.status = dto.status;

    const tasks = await this.prisma.task.findMany({ where });

    const out: SharedTask[] = [];
    for (const t of tasks) {
      if (t.rrule) {
        for (const start of expandRecurring(t, windowStart, windowEnd, tz)) {
          out.push(
            this.toDto(t, {
              id: `${t.id}__${start.toISOString()}`,
              seriesId: t.id,
              scheduledStartTime: start.toISOString(),
            }),
          );
        }
      } else {
        const inWindow =
          t.scheduledStartTime !== null &&
          t.scheduledStartTime >= windowStart &&
          t.scheduledStartTime <= windowEnd;
        // A placed task (even a conflicting overlap) belongs to its own day
        // only. Truly unplaced tasks (no slot found) have no day, so surface
        // them everywhere as standing conflicts the user still needs to fix.
        const unplaced = t.scheduledStartTime === null;
        if (inWindow || (t.conflict && unplaced)) out.push(this.toDto(t));
      }
    }

    const totalAllocatedMinutes = out.reduce(
      (sum, t) =>
        sum + (t.scheduledStartTime && !t.conflict ? t.durationMinutes : 0),
      0,
    );

    return {
      tasks: out,
      meta: {
        totalAllocatedMinutes,
        totalWorkMinutes: sumWorkMinutes(
          startStr,
          endStr,
          user.workStart,
          user.workEnd,
          user.workDays,
        ),
        conflictCount: out.filter((t) => t.conflict).length,
      },
    };
  }

  async findById(id: string, user: User): Promise<TaskDetailResponse> {
    const task = await this.prisma.task.findUnique({
      where: { id, userId: user.id },
    });
    if (!task) throw new NotFoundException(`Cannot find task with id ${id}`);

    const events = await this.prisma.taskEvent.findMany({
      where: { taskId: id, userId: user.id },
      orderBy: { occurredAt: "desc" },
      take: 20,
    });

    return {
      task: this.toDto(task),
      events: events.map((e) => ({
        id: e.id.toString(),
        taskId: e.taskId,
        eventType: e.eventType,
        oldSnapshot:
          e.oldSnapshot as unknown as TaskDetailResponse["events"][number]["oldSnapshot"],
        newSnapshot:
          e.newSnapshot as unknown as TaskDetailResponse["events"][number]["newSnapshot"],
        rewardScore: e.rewardScore,
        occurredAt: e.occurredAt.toISOString(),
      })),
    };
  }

  async update(
    id: string,
    dto: UpdateTaskDto,
    user: User,
  ): Promise<SharedTask> {
    try {
      const updated = await this.prisma.task.update({
        where: { id, userId: user.id },
        data: {
          title: dto.title,
          note: dto.note,
          deadline:
            dto.deadline === undefined
              ? undefined
              : dto.deadline === null
                ? null
                : new Date(dto.deadline),
          tags: dto.tags,
        },
      });
      return this.toDto(updated);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === PostgresErrorCode.RecordNotFound
      )
        throw new NotFoundException(`Cannot find task with id ${id}`);
      throw new InternalServerErrorException({
        success: false,
        message: "Something went wrong when updating a task",
      });
    }
  }

  async reschedule(id: string, requestedStartTime: string, user: User) {
    // Drag-drop is a manual pin: place exactly where dropped, allow overlaps as
    // conflicts, and never cascade other tasks. The EDF engine only runs on
    // task create and preference edits — not on every drag.
    const { task, displaced } = await this.scheduler.pin(
      user,
      id,
      new Date(requestedStartTime),
    );
    return {
      task: this.toDto(task),
      displaced: displaced.map((d) => ({
        taskId: d.taskId,
        newScheduledStartTime: d.newScheduledStartTime
          ? d.newScheduledStartTime.toISOString()
          : null,
      })),
    };
  }

  async complete(id: string, user: User): Promise<SharedTask> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.task.update({
          where: { id, userId: user.id },
          data: { status: "DONE" },
        });
        await tx.taskEvent.create({
          data: {
            taskId: updated.id,
            userId: user.id,
            eventType: "COMPLETE",
            oldSnapshot: Prisma.JsonNull,
            newSnapshot: {
              scheduledStartTime: updated.scheduledStartTime
                ? updated.scheduledStartTime.toISOString()
                : null,
              durationMinutes: updated.durationMinutes,
            },
            rewardScore: 1.0,
          },
        });
        return this.toDto(updated);
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === PostgresErrorCode.RecordNotFound
      )
        throw new NotFoundException(`Cannot find task with id ${id}`);
      throw new InternalServerErrorException({
        success: false,
        message: "Something went wrong when completing a task",
      });
    }
  }

  async remove(id: string, user: User): Promise<void> {
    try {
      await this.prisma.task.delete({ where: { id, userId: user.id } });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === PostgresErrorCode.RecordNotFound
      )
        throw new NotFoundException(`Cannot find task with id ${id}`);
      throw new InternalServerErrorException({
        success: false,
        message: "Something went wrong when deleting a task",
      });
    }
  }
}
