import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { fromZonedTime } from "date-fns-tz";
import { PrismaService } from "../prisma/prisma.service";
import { SchedulerService } from "../scheduler/scheduler.service";
import { Prisma, type Task, type User } from "../../generated/prisma";
import { PostgresErrorCode } from "../prisma/error-codes";
import { minutesToUtc } from "../common/utils";
import { addDaysStr, localDateStr } from "../scheduler/slot";
import { viewDayRange, sumWorkMinutes } from "../scheduler/horizon";
import { occurrenceDays } from "./utils/recurrence";
import { CreateTaskDto } from "./dto/create-task.dto";
import { UpdateTaskDto } from "./dto/update-task.dto";
import { ListTasksDto } from "./dto/list-tasks.dto";
import type {
  CreateTaskResponse,
  RecurrenceScope,
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
      seriesId: task.seriesId,
      ...overrides,
    };
  }

  async create(
    dto: CreateTaskDto,
    user: User,
  ): Promise<CreateTaskResponse> {
    const { startDate, fixed, startTime, view, rrule: rawRrule, ...rest } = dto;
    const tz = user.timezone;
    const isFixed = fixed ?? false;
    const rrule = rawRrule ?? "";
    const anchorDateStr = startDate ?? localDateStr(new Date(), tz);

    // A recurring task is materialized into one concrete row per occurrence day
    // within the active view's window (e.g. FREQ=DAILY across a week → 7 rows),
    // every row sharing the same rrule + seriesId but owning a distinct id. The
    // EDF engine then places each instance, confined to its own day.
    const tod = isFixed ? startTime ?? 0 : user.workStart;
    // Recurrence never materializes past the deadline (the rrule's window may
    // run later than the task is due).
    const deadlineDateStr = rest.deadline
      ? localDateStr(new Date(rest.deadline), tz)
      : undefined;
    // Recurrence starts from "now", not the window start: when today falls
    // inside the active week/month, occurrences begin today — or tomorrow if
    // today's working hours are already over (bound by the work day's end).
    const now = new Date();
    const nowDateStr = localDateStr(now, tz);
    const todayWorkEnd = minutesToUtc(nowDateStr, user.workEnd, tz);
    const floorDateStr =
      now.getTime() >= todayWorkEnd.getTime()
        ? addDaysStr(nowDateStr, 1)
        : nowDateStr;
    const days = occurrenceDays(
      rrule,
      view ?? "day",
      anchorDateStr,
      tz,
      tod,
      user.workDays,
      deadlineDateStr,
      floorDateStr,
    );
    const seriesId = rrule ? randomUUID() : null;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const placed: Task[] = [];

        for (const dateStr of days) {
          // Fixed: anchored at its day + time-of-day. Flexible: the day bounds
          // the engine's search (earliest = day start, capped at day work-end).
          const fixedStart = isFixed
            ? minutesToUtc(dateStr, startTime ?? 0, tz)
            : null;

          const created = await tx.task.create({
            data: {
              title: rest.title,
              note: rest.note ?? null,
              durationMinutes: rest.durationMinutes,
              deadline: rest.deadline ? new Date(rest.deadline) : null,
              tags: rest.tags ?? [],
              fixed: isFixed,
              startTime: startTime ?? 0,
              rrule,
              seriesId,
              userId: user.id,
              scheduledStartTime: fixedStart,
              conflict: false,
            },
          });

          if (!isFixed) {
            // A recurring occurrence is confined to its own day; a plain task
            // keeps the open-ended forward search from its anchor day.
            const recurring = rrule !== "";
            const dayStart = minutesToUtc(dateStr, 0, tz);
            const dayWorkEnd = minutesToUtc(dateStr, user.workEnd, tz);
            const placementDeadline =
              created.deadline && created.deadline < dayWorkEnd
                ? created.deadline
                : dayWorkEnd;
            await this.scheduler.placeNewTask(user, created, tx, {
              earliest: recurring || startDate ? dayStart : undefined,
              placementDeadline: recurring ? placementDeadline : undefined,
              dayAnchor: recurring
                ? minutesToUtc(dateStr, user.workStart, tz)
                : undefined,
            });
          }

          const finalTask = await tx.task.findUniqueOrThrow({
            where: { id: created.id },
          });
          placed.push(finalTask);

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
        }

        // Surface the first occurrence as the primary result; the client
        // refetches the list to pick up the full series.
        const primary = placed[0];
        return {
          task: this.toDto(primary),
          schedulingMeta: {
            adjustedDuration: primary.durationMinutes,
            placedAt: primary.scheduledStartTime
              ? primary.scheduledStartTime.toISOString()
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

    // Recurring series are materialized at creation, so every occurrence is a
    // concrete row placed on its own day — there's no virtual expansion here.
    const out: SharedTask[] = [];
    for (const t of tasks) {
      const inWindow =
        t.scheduledStartTime !== null &&
        t.scheduledStartTime >= windowStart &&
        t.scheduledStartTime <= windowEnd;
      // A placed task (even a conflicting overlap) belongs to its own day only.
      // Truly unplaced tasks (no slot found) have no day, so surface them
      // everywhere as standing conflicts the user still needs to fix.
      const unplaced = t.scheduledStartTime === null;
      if (inWindow || (t.conflict && unplaced)) out.push(this.toDto(t));
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
    const { scope, ...fields } = dto;
    const data = {
      title: fields.title,
      note: fields.note,
      deadline:
        fields.deadline === undefined
          ? undefined
          : fields.deadline === null
            ? null
            : new Date(fields.deadline),
      tags: fields.tags,
    };
    try {
      const target = await this.prisma.task.findFirst({
        where: { id, userId: user.id },
      });
      if (!target) throw new NotFoundException(`Cannot find task with id ${id}`);

      // "This and following": apply the metadata to this occurrence and every
      // later sibling in the series; otherwise just this row.
      if (this.appliesToFollowing(scope, target)) {
        await this.prisma.task.updateMany({
          where: this.followingWhere(user.id, target),
          data,
        });
        const updated = await this.prisma.task.findUniqueOrThrow({
          where: { id },
        });
        return this.toDto(updated);
      }

      const updated = await this.prisma.task.update({ where: { id }, data });
      return this.toDto(updated);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
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

  /** True when a "following" mutation can fan out to series siblings. */
  private appliesToFollowing(
    scope: RecurrenceScope | undefined,
    target: Task,
  ): boolean {
    return (
      scope === "following" &&
      target.seriesId !== null &&
      target.scheduledStartTime !== null
    );
  }

  /** Match this occurrence and every later one in the same series. */
  private followingWhere(
    userId: string,
    target: Task,
  ): Prisma.TaskWhereInput {
    return {
      userId,
      seriesId: target.seriesId,
      // Non-null guaranteed by appliesToFollowing (guards both fields).
      scheduledStartTime: { gte: target.scheduledStartTime! },
    };
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

  async resize(
    id: string,
    requestedStartTime: string,
    durationMinutes: number,
    user: User,
  ) {
    // Edge-resize is a manual pin that also changes duration: place exactly
    // where dropped, allow overlaps as conflicts, never cascade other tasks.
    const { task, displaced } = await this.scheduler.resize(
      user,
      id,
      new Date(requestedStartTime),
      durationMinutes,
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

  async remove(
    id: string,
    user: User,
    scope?: RecurrenceScope,
  ): Promise<void> {
    try {
      const target = await this.prisma.task.findFirst({
        where: { id, userId: user.id },
      });
      if (!target) throw new NotFoundException(`Cannot find task with id ${id}`);

      // "This and following" removes this occurrence and every later sibling.
      if (this.appliesToFollowing(scope, target)) {
        await this.prisma.task.deleteMany({
          where: this.followingWhere(user.id, target),
        });
        return;
      }

      await this.prisma.task.delete({ where: { id } });
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
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
