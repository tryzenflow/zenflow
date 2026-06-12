import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { fromZonedTime } from "date-fns-tz";
import { PrismaService } from "../prisma/prisma.service";
import { SchedulerService } from "../scheduler/scheduler.service";
import { Prisma, type Task, type Tag, type User } from "../../generated/prisma";
import { PostgresErrorCode } from "../prisma/error-codes";
import { minutesToUtc } from "../common/utils";
import { localDateStr } from "../scheduler/slot";
import {
  displayDayRange,
  viewDayRange,
  sumWorkMinutes,
} from "../scheduler/horizon";
import { CreateTaskDto } from "./dto/create-task.dto";
import { UpdateTaskDto } from "./dto/update-task.dto";
import { ListTasksDto } from "./dto/list-tasks.dto";
import type {
  CreateTaskResponse,
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
      scheduledStartTime: task.scheduledStartTime
        ? task.scheduledStartTime.toISOString()
        : null,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
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
    const { startDate, fixed, startTime, ...rest } = dto;
    const tz = user.timezone;
    const isFixed = fixed ?? false;
    const anchorDateStr = startDate ?? localDateStr(new Date(), tz);

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Resolve incoming tag NAMES → ids before connecting them to the task.
        const tagIds = await this.resolveTagIds(tx, user.id, rest.tags ?? []);

        // Fixed: anchored at its day + time-of-day. Flexible: persist the
        // create/view day as the EDF floor (start-of-day UTC). The packer only
        // consults this when the task has NO deadline — a deadline-bearing task
        // is scheduled from `now` by pure EDF urgency, ignoring the anchor.
        const fixedStart = isFixed
          ? minutesToUtc(anchorDateStr, startTime ?? 0, tz)
          : null;
        const schedulingAnchor = isFixed
          ? null
          : minutesToUtc(anchorDateStr, 0, tz);

        const created = await tx.task.create({
          data: {
            title: rest.title,
            note: rest.note ?? null,
            durationMinutes: rest.durationMinutes,
            deadline: rest.deadline ? new Date(rest.deadline) : null,
            tags: { connect: tagIds.map((id) => ({ id })) },
            fixed: isFixed,
            startTime: startTime ?? 0,
            userId: user.id,
            schedulingAnchor,
            scheduledStartTime: fixedStart,
            conflict: false,
          },
        });

        if (!isFixed) {
          // Deadline-aware insert + cascade: re-EDF the movable set so the new
          // task lands at its deadline rank (closer deadlines keep earlier
          // slots, later ones shift). Fixed, manually-moved and frozen past
          // tasks stay anchored.
          await this.scheduler.cascadeReschedule(user, tx);
        }

        const finalTask = await tx.task.findUniqueOrThrow({
          where: { id: created.id },
          include: { tags: true },
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

    const out: SharedTask[] = [];
    // Meta stays scoped to the FOCAL window: padded edge-day tasks are rendered
    // but must not inflate capacity/conflict figures.
    let totalAllocatedMinutes = 0;
    let conflictCount = 0;
    for (const t of tasks) {
      const placedAt = t.scheduledStartTime;
      // The EDF engine flags a conflict only when it finds no slot before the
      // deadline (placedAt null), so unplaced conflicts have no day — surface
      // them in every window. A placed task shows only in its own day; a manual
      // drag/resize can still leave a placed task overlapping (conflict true),
      // which is counted while it sits in the focal window.
      const unplaced = placedAt === null;
      const inDisplay =
        placedAt !== null && placedAt >= displayStart && placedAt <= displayEnd;
      if (inDisplay || unplaced) out.push(this.toDto(t));

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
    const fields = dto;
    // Scalar fields only — m2m tags are applied via the `set` relation op.
    const scalarData = {
      title: fields.title,
      note: fields.note,
      durationMinutes: fields.durationMinutes,
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

        const tagIds = touchTags
          ? await this.resolveTagIds(tx, user.id, fields.tags ?? [])
          : [];

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

        // A deadline change on a flexible task re-orders the movable set by EDF
        // (closer deadlines win earlier slots). Fixed / manually-moved / past
        // tasks stay anchored. No-op when the deadline is untouched, the task is
        // fixed, or the new deadline equals the old one.
        const deadlineChanged =
          scalarData.deadline !== undefined &&
          (scalarData.deadline?.getTime() ?? null) !==
            (target.deadline?.getTime() ?? null);
        // A duration change re-packs the movable set for BOTH fixed and
        // flexible tasks: a resized fixed block occupies more (or fewer) slots,
        // so the flexible tasks around it must move too.
        const durationChanged =
          fields.durationMinutes !== undefined &&
          fields.durationMinutes !== target.durationMinutes;
        if ((deadlineChanged && !updated.fixed) || durationChanged) {
          await this.scheduler.cascadeReschedule(user, tx);
          const rescheduled = await tx.task.findUniqueOrThrow({
            where: { id },
            include: { tags: true },
          });
          if (durationChanged) {
            // Audit the size change like the /resize endpoint does. Unlike a
            // manual edge-resize, the engine (not the user) picks the slot, so
            // it scores as an accepted placement (1.0), not an override (0.0).
            await tx.taskEvent.create({
              data: {
                taskId: id,
                userId: user.id,
                eventType: "RESIZE",
                oldSnapshot: {
                  scheduledStartTime: target.scheduledStartTime
                    ? target.scheduledStartTime.toISOString()
                    : null,
                  durationMinutes: target.durationMinutes,
                },
                newSnapshot: {
                  scheduledStartTime: rescheduled.scheduledStartTime
                    ? rescheduled.scheduledStartTime.toISOString()
                    : null,
                  durationMinutes: rescheduled.durationMinutes,
                },
                rewardScore: 1.0,
              },
            });
          }
          return this.toDto(rescheduled);
        }
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

  async remove(id: string, user: User): Promise<void> {
    try {
      const target = await this.prisma.task.findFirst({
        where: { id, userId: user.id },
      });
      if (!target)
        throw new NotFoundException(`Cannot find task with id ${id}`);

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
