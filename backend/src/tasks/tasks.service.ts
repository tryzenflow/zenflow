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
import { EVENT_REWARD } from "../scheduler/telemetry";
import {
  displayDayRange,
  viewDayRange,
  sumWorkMinutes,
} from "../scheduler/horizon";
import { CreateTaskDto } from "./dto/create-task.dto";
import { UpdateTaskDto } from "./dto/update-task.dto";
import { ListTasksDto } from "./dto/list-tasks.dto";
import { ListTaskSuggestionsDto } from "./dto/list-task-suggestions.dto";
import { ResolveOverflowDto } from "./dto/resolve-overflow.dto";
import type {
  CreateTaskResponse,
  RescheduleResponse,
  Task as SharedTask,
  TaskDetailResponse,
  TaskSuggestionsResponse,
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

  async create(
    dto: CreateTaskDto,
    user: User,
    now: Date = new Date(),
  ): Promise<CreateTaskResponse> {
    const { startDate, fixed, startTime, view, ...rest } = dto;
    const tz = user.timezone;
    const isFixed = fixed ?? false;
    const overflowView = view ?? "day";
    const anchorDateStr = startDate ?? localDateStr(now, tz);

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Resolve incoming tag NAMES → ids before connecting them to the task.
        const tagIds = await this.resolveTagIds(tx, user.id, rest.tags ?? []);

        // Phase-2 per-tag duration corrector. ALWAYS computed (so it always
        // LEARNS, even in `never` mode) but only APPLIED when the user's mode is
        // not `never`. The corrected value is rounded up to the 15-min grid.
        const estimatedDuration = rest.durationMinutes;
        const cleanTags = (rest.tags ?? [])
          .map((t) => t.trim())
          .filter(Boolean);
        const correction = await this.scheduler.computeDurationCorrection(
          user.id,
          cleanTags,
          estimatedDuration,
          tx,
        );
        const applyCorrection = user.durationAdjustmentMode !== "never";
        const effectiveDuration = applyCorrection
          ? correction.adjustedDuration
          : estimatedDuration;

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
            durationMinutes: effectiveDuration,
            deadline: rest.deadline ? new Date(rest.deadline) : null,
            tags: { connect: tagIds.map((id) => ({ id })) },
            fixed: isFixed,
            startTime: startTime ?? 0,
            userId: user.id,
            schedulingAnchor,
            // Persist the active calendar view so the scheduler can bound a
            // flexible, no-deadline task to that period's working hours (it must
            // not silently roll past the viewed day/week/month). Null for fixed
            // tasks — they anchor at an exact time and aren't period-bounded.
            view: isFixed ? null : overflowView,
            scheduledStartTime: fixedStart,
            conflict: false,
          },
        });

        // Deadline-aware insert + cascade: re-EDF the movable set so the new
        // task lands at its deadline rank (closer deadlines keep earlier slots,
        // later ones shift). Fixed, manually-moved and frozen past tasks stay
        // anchored. A fixed task keeps its user-chosen slot but is still run
        // through the cascade so its time is checked for real overlap against
        // existing placed tasks — an overlapping fixed task (and the task it
        // overlaps) is flagged `conflict: true` instead of silently double-booked.
        await this.scheduler.cascadeReschedule(user, tx, now);

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
              // Tag NAMES at create time (sorted) — "tags then" for Phase-2.
              tags: finalTask.tags
                .map((t) => t.name)
                .sort((a, b) => a.localeCompare(b)),
            },
            rewardScore: EVENT_REWARD.CREATE,
            occurredAt: now,
          },
        });

        // When the new task came back unplaced (no slot within working hours
        // before its deadline), surface the two recovery options the frontend
        // prompts with. Placed tasks carry no overflow.
        const overflow =
          finalTask.scheduledStartTime === null
            ? await this.scheduler.computeOverflowOptions(
                user,
                finalTask,
                overflowView,
                tx,
                now,
              )
            : null;

        return {
          task: this.toDto(finalTask),
          schedulingMeta: {
            // The duration actually fed to EDF (corrected unless `never` mode).
            adjustedDuration: finalTask.durationMinutes,
            placedAt: finalTask.scheduledStartTime
              ? finalTask.scheduledStartTime.toISOString()
              : null,
            engine: "edf" as const,
            // Real Phase-2 metadata. `biasApplied` is the blended multiplier the
            // corrector LEARNED (even in `never` mode, where it isn't applied);
            // `estimatedDuration` is the user's typed value before correction.
            biasApplied: correction.biasApplied,
            estimatedDuration: correction.estimatedDuration,
            durationAdjustmentMode: user.durationAdjustmentMode,
            durationReason: applyCorrection ? correction.durationReason : null,
          },
          overflow,
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

  /**
   * Title-autocomplete suggestions for the create form: the user's existing
   * tasks, newest first, optionally filtered by the text typed so far. Recurring
   * / materialized rows share titles, so we dedupe by title (case-insensitive),
   * keeping the most-recent occurrence, and return up to `limit` distinct titles.
   * Read-only metadata — never touches the scheduler.
   */
  async suggestions(
    dto: ListTaskSuggestionsDto,
    user: User,
  ): Promise<TaskSuggestionsResponse> {
    const limit = dto.limit ?? 10;
    const q = dto.q?.trim();

    const where: Prisma.TaskWhereInput = { userId: user.id };
    if (q) where.title = { contains: q, mode: "insensitive" };

    // Over-fetch then dedupe in memory: duplicate titles (recurring series) can
    // otherwise flood the list, so a single page of distinct titles may need
    // several rows' worth of source data.
    const rows = await this.prisma.task.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { tags: true },
      take: limit * 5,
    });

    const seen = new Set<string>();
    const suggestions: SharedTask[] = [];
    for (const row of rows) {
      const key = row.title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      suggestions.push(this.toDto(row));
      if (suggestions.length >= limit) break;
    }

    return { suggestions };
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
    // Scalar metadata only — m2m tags are applied via the `set` relation op.
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
        if (deadlineChanged && !updated.fixed) {
          await this.scheduler.cascadeReschedule(user, tx);
          const rescheduled = await tx.task.findUniqueOrThrow({
            where: { id },
            include: { tags: true },
          });
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

  async reschedule(
    id: string,
    requestedStartTime: string,
    user: User,
    now: Date = new Date(),
  ) {
    // Drag-drop is a manual pin: place exactly where dropped, allow overlaps as
    // conflicts, and never cascade other tasks. The EDF engine only runs on
    // task create and preference edits — not on every drag.
    const { task, displaced } = await this.scheduler.pin(
      user,
      id,
      new Date(requestedStartTime),
      now,
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
      // Phase-2 transparency: surface WHY the slot is a good one when it lands in
      // a preference-favoured cell (null otherwise → FE shows no toast).
      rationale: this.scheduler.rationaleFor(user, withTags.scheduledStartTime),
    };
  }

  /**
   * Apply a recovery option the user accepted from the create-overflow toast.
   * Re-derives the slot server-side (never trusts a client time), pins the task
   * as a fixed anchor so the next cascade keeps it, and records the move.
   * Mirrors {@link reschedule}'s RescheduleResponse shape.
   */
  async resolveOverflow(
    id: string,
    dto: ResolveOverflowDto,
    user: User,
    now: Date = new Date(),
  ): Promise<RescheduleResponse> {
    // Ownership check up front so a cross-user id 404s before any mutation.
    const target = await this.prisma.task.findUnique({
      where: { id, userId: user.id },
      select: { id: true },
    });
    if (!target) throw new NotFoundException(`Cannot find task with id ${id}`);

    const { task, displaced } = await this.scheduler.applyOverflowOption(
      user,
      id,
      dto.choice,
      dto.view ?? "day",
      now,
    );
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
      rationale: this.scheduler.rationaleFor(user, withTags.scheduledStartTime),
    };
  }

  async resize(
    id: string,
    requestedStartTime: string,
    durationMinutes: number,
    user: User,
    now: Date = new Date(),
  ) {
    // Edge-resize is a manual pin that also changes duration: place exactly
    // where dropped, allow overlaps as conflicts, never cascade other tasks.
    const { task, displaced } = await this.scheduler.resize(
      user,
      id,
      new Date(requestedStartTime),
      durationMinutes,
      now,
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
      rationale: this.scheduler.rationaleFor(user, withTags.scheduledStartTime),
    };
  }

  async complete(
    id: string,
    user: User,
    now: Date = new Date(),
  ): Promise<SharedTask> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.task.update({
          where: { id, userId: user.id },
          data: { status: "DONE" },
          include: { tags: true },
        });
        // Tag NAMES at completion time (sorted) — recorded on the snapshot so the
        // Phase-2 per-tag duration bias has "tags then", not "tags now".
        const tagNames = updated.tags
          .map((t) => t.name)
          .sort((a, b) => a.localeCompare(b));
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
              tags: tagNames,
            },
            rewardScore: EVENT_REWARD.COMPLETE,
            occurredAt: now,
          },
        });
        // Positive KEEP signal: the task was completed in the slot the engine
        // SUGGESTED (it was never manually dragged/resized and it had a
        // placement). This is the +1 half of the signed preference matrix — an
        // accepted-unchanged placement is distinguishable from an untouched one.
        if (!updated.manuallyMoved && updated.scheduledStartTime !== null) {
          await this.scheduler.recordKeep(user, updated, tagNames, tx, now);
        }
        // Re-settle the remaining PENDING set: completing this task removes it as
        // a blocker, so any task that only overlapped it self-heals (conflict
        // cleared via the now-independent overlap pass) and flexible tasks reflow
        // into the freed slot. The just-completed DONE task is excluded — it is no
        // longer PENDING and keeps its own scheduledStartTime.
        await this.scheduler.cascadeReschedule(user, tx, now);
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
      await this.prisma.$transaction(async (tx) => {
        const target = await tx.task.findFirst({
          where: { id, userId: user.id },
        });
        if (!target)
          throw new NotFoundException(`Cannot find task with id ${id}`);

        await tx.task.delete({ where: { id } });

        // Re-settle the remaining PENDING set in the same transaction: the
        // deleted task is gone, so any task that only overlapped it self-heals
        // (conflict cleared via the now-independent overlap pass) and flexible
        // tasks reflow into the freed slot — mirroring how create() cascades. A
        // cascade failure rolls back the delete.
        await this.scheduler.cascadeReschedule(user, tx);
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
        message: "Something went wrong when deleting a task",
      });
    }
  }
}
