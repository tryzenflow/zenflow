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
import { Prisma, type Task, type Tag, type User } from "../../generated/prisma";
import { PostgresErrorCode } from "../prisma/error-codes";
import { minutesToUtc } from "../common/utils";
import { addDaysStr, localDateStr } from "../scheduler/slot";
import {
  displayDayRange,
  viewDayRange,
  sumWorkMinutes,
} from "../scheduler/horizon";
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

/** A Task row joined with its related Tag rows (the shape toDto consumes). */
type TaskWithTags = Task & { tags: Tag[] };

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduler: SchedulerService,
  ) {}

  /** Map a Prisma row to the shared API shape (dates → ISO strings). */
  private toDto(
    task: TaskWithTags,
    overrides?: Partial<SharedTask>,
  ): SharedTask {
    return {
      id: task.id,
      title: task.title,
      note: task.note,
      durationMinutes: task.durationMinutes,
      deadline: task.deadline ? task.deadline.toISOString() : null,
      // The wire format stays a string[] of tag NAMES; sort for stable output.
      tags: task.tags.map((t) => t.name).sort((a, b) => a.localeCompare(b)),
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

  /**
   * Resolve an incoming array of tag NAMES into Tag ids for this user, creating
   * any names that don't exist yet. Names are trimmed, emptied-dropped, and
   * deduped (exact). Runs inside the caller's transaction so tag creation is
   * atomic with the task write. Returns the resolved tag ids.
   */
  private async resolveTagIds(
    tx: Prisma.TransactionClient,
    userId: string,
    names: string[],
  ): Promise<string[]> {
    const cleaned = Array.from(
      new Set(names.map((n) => n.trim()).filter((n) => n.length > 0)),
    );
    if (cleaned.length === 0) return [];

    await tx.tag.createMany({
      data: cleaned.map((name) => ({ userId, name })),
      skipDuplicates: true,
    });
    const tags = await tx.tag.findMany({
      where: { userId, name: { in: cleaned } },
      select: { id: true },
    });
    return tags.map((t) => t.id);
  }

  async create(dto: CreateTaskDto, user: User): Promise<CreateTaskResponse> {
    const { startDate, fixed, startTime, view, rrule: rawRrule, ...rest } = dto;
    const tz = user.timezone;
    const isFixed = fixed ?? false;
    const rrule = rawRrule ?? "";
    const anchorDateStr = startDate ?? localDateStr(new Date(), tz);

    // A recurring task is materialized into one concrete row per occurrence day
    // within the active view's window (e.g. FREQ=DAILY across a week → 7 rows),
    // every row sharing the same rrule + seriesId but owning a distinct id. The
    // EDF engine then places each instance, confined to its own day.
    const tod = isFixed ? (startTime ?? 0) : user.workStart;
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
        const placed: TaskWithTags[] = [];

        // Resolve names → ids ONCE; every occurrence connects the same tags.
        const tagIds = await this.resolveTagIds(tx, user.id, rest.tags ?? []);

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
              tags: { connect: tagIds.map((id) => ({ id })) },
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
              // A recurring occurrence is pinned to its chosen day, which may be
              // a non-working day; place it within that day's work hours anyway.
              ignoreWorkDays: recurring,
            });
          }

          const finalTask = await tx.task.findUniqueOrThrow({
            where: { id: created.id },
            include: { tags: true },
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
    // Focal window: the actual view extent (month = 1st..last). Drives meta.
    const { startStr, endStr } = viewDayRange(dto.view, dto.date);
    const focalStart = fromZonedTime(`${startStr}T00:00:00`, tz);
    const focalEnd = fromZonedTime(`${endStr}T23:59:59.999`, tz);
    // Display window: what the frontend grid renders. For month this pads out
    // to whole Monday-started weeks so adjacent-month edge cells aren't blank;
    // for week/day it equals the focal window.
    const { startStr: displayStartStr, endStr: displayEndStr } =
      displayDayRange(dto.view, dto.date);
    const displayStart = fromZonedTime(`${displayStartStr}T00:00:00`, tz);
    const displayEnd = fromZonedTime(`${displayEndStr}T23:59:59.999`, tz);

    const where: Prisma.TaskWhereInput = { userId: user.id };
    if (dto.status && dto.status !== "all") where.status = dto.status;

    const tasks = await this.prisma.task.findMany({
      where,
      include: { tags: true },
    });

    // Recurring series are materialized at creation, so every occurrence is a
    // concrete row placed on its own day — there's no virtual expansion here.
    const out: SharedTask[] = [];
    // Meta stays scoped to the FOCAL month: padded edge-day tasks are rendered
    // but must not inflate capacity/conflict figures.
    let totalAllocatedMinutes = 0;
    let conflictCount = 0;
    for (const t of tasks) {
      const placedAt = t.scheduledStartTime;
      // A placed task (even a conflicting overlap) belongs to its own day only.
      // Truly unplaced tasks (no slot found) have no day, so surface them
      // everywhere as standing conflicts the user still needs to fix.
      const unplaced = placedAt === null;
      const inDisplay =
        placedAt !== null && placedAt >= displayStart && placedAt <= displayEnd;
      if (inDisplay || (t.conflict && unplaced)) out.push(this.toDto(t));

      const inFocal =
        placedAt !== null && placedAt >= focalStart && placedAt <= focalEnd;
      if (inFocal && !t.conflict) totalAllocatedMinutes += t.durationMinutes;
      if (t.conflict && (inFocal || unplaced)) conflictCount += 1;
    }

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
        conflictCount,
      },
    };
  }

  async findById(id: string, user: User): Promise<TaskDetailResponse> {
    const task = await this.prisma.task.findUnique({
      where: { id, userId: user.id },
      include: { tags: true },
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
    // Scalar metadata only — m2m tags are applied separately (updateMany can't
    // set relations).
    const scalarData = {
      title: fields.title,
      note: fields.note,
      deadline:
        fields.deadline === undefined
          ? undefined
          : fields.deadline === null
            ? null
            : new Date(fields.deadline),
    };
    const touchTags = fields.tags !== undefined;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const target = await tx.task.findFirst({
          where: { id, userId: user.id },
        });
        if (!target)
          throw new NotFoundException(`Cannot find task with id ${id}`);

        // Resolve names → ids ONCE before any per-row relation set.
        const tagIds = touchTags
          ? await this.resolveTagIds(tx, user.id, fields.tags ?? [])
          : [];

        // "This and following": apply the metadata to this occurrence and every
        // later sibling in the series; otherwise just this row.
        if (this.appliesToFollowing(scope, target)) {
          await tx.task.updateMany({
            where: this.followingWhere(user.id, target),
            data: scalarData,
          });
          // m2m `set` must be applied per-row (updateMany can't touch relations).
          if (touchTags) {
            const siblings = await tx.task.findMany({
              where: this.followingWhere(user.id, target),
              select: { id: true },
            });
            for (const s of siblings) {
              await tx.task.update({
                where: { id: s.id },
                data: { tags: { set: tagIds.map((id) => ({ id })) } },
              });
            }
          }
          const updated = await tx.task.findUniqueOrThrow({
            where: { id },
            include: { tags: true },
          });
          return this.toDto(updated);
        }

        const updated = await tx.task.update({
          where: { id },
          data: {
            ...scalarData,
            ...(touchTags
              ? { tags: { set: tagIds.map((id) => ({ id })) } }
              : {}),
          },
          include: { tags: true },
        });
        return this.toDto(updated);
      });
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
  private followingWhere(userId: string, target: Task): Prisma.TaskWhereInput {
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
    // The scheduler returns a bare Task (no relations); re-attach tags for the
    // DTO so the wire format keeps its name array.
    const withTags = await this.prisma.task.findUniqueOrThrow({
      where: { id: task.id },
      include: { tags: true },
    });
    return {
      task: this.toDto(withTags),
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
    // The scheduler returns a bare Task (no relations); re-attach tags for the
    // DTO so the wire format keeps its name array.
    const withTags = await this.prisma.task.findUniqueOrThrow({
      where: { id: task.id },
      include: { tags: true },
    });
    return {
      task: this.toDto(withTags),
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
          include: { tags: true },
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

  async remove(id: string, user: User, scope?: RecurrenceScope): Promise<void> {
    try {
      const target = await this.prisma.task.findFirst({
        where: { id, userId: user.id },
      });
      if (!target)
        throw new NotFoundException(`Cannot find task with id ${id}`);

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
