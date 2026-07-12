import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import type {
  CreateTaskResponse,
  DisplacedTask,
  RescheduleResponse,
  SchedulingMeta,
  Task as SharedTask,
  SimulateTaskResponse,
  TaskDetailResponse,
  TaskSuggestionsResponse,
  TasksListResponse,
  UpdateTaskResponse,
} from "@zenflow/shared";
import { Prisma, type Tag, type Task, type User } from "../../generated/prisma";
import { minutesToUtc } from "../common/utils";
import { PostgresErrorCode } from "../prisma/error-codes";
import { PrismaService } from "../prisma/prisma.service";
import type { CascadeScope } from "../scheduler/interfaces";
import { SchedulerService } from "../scheduler/scheduler.service";
import { toDisplaced } from "../scheduler/utils/displace";
import { buildSnapshot } from "../scheduler/utils/telemetry";
import {
  displayDayRange,
  sumWorkMinutes,
  viewDayRange,
} from "../scheduler/utils/horizon";
import { toOverflow } from "../scheduler/utils/overflow";
import { CreateTaskDto } from "./dto/create-task.dto";
import { ListTaskSuggestionsDto } from "./dto/list-task-suggestions.dto";
import { ListTasksDto } from "./dto/list-tasks.dto";
import { RescheduleCascadeDto } from "./dto/reschedule-cascade.dto";
import type { OverflowChoice } from "./dto/resolve-overflow.dto";
import { SimulateTaskDto } from "./dto/simulate-task.dto";
import { UpdateTaskDto } from "./dto/update-task.dto";
import { getRerankK } from "./utils/rerank_k";

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
      startTime: task.startTime,
      manuallyMoved: task.manuallyMoved,
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
    const prefs = this.scheduler.prefsOf(user);
    const deadline = new Date(dto.deadline);
    const cleanTags = (dto.tags ?? []).map((t) => t.trim()).filter(Boolean);

    try {
      const { finalTask, displaced, correction } =
        await this.prisma.$transaction(async (tx) => {
          const tagIds = await this.resolveTagIds(tx, user.id, cleanTags);

          // Phase-2 per-tag duration corrector. ALWAYS computed (so it always
          // LEARNS, even in `never` mode) but only APPLIED when the user's
          // mode is not `never`.
          const correction = await this.scheduler.computeDurationCorrection(
            user.id,
            cleanTags,
            dto.durationMinutes,
            tx,
          );
          const applyCorrection = user.durationAdjustmentMode !== "never";
          const effectiveDuration = applyCorrection
            ? correction.adjustedDuration
            : dto.durationMinutes;

          const created = await tx.task.create({
            data: {
              title: dto.title,
              note: dto.note ?? null,
              durationMinutes: effectiveDuration,
              deadline,
              tags: { connect: tagIds.map((id) => ({ id })) },
              userId: user.id,
              scheduledStartTime: null,
              conflict: false,
            },
            include: { tags: true },
          });

          // Solo placement, never an auto-cascade: a zero-width window freezes
          // every already-placed task, so the new task can only land in
          // genuinely free space — it never silently displaces anything (same
          // "ask before moving other tasks" rule `rescheduleCascade` enforces
          // for edits/deletes). No `fixedTaskId` needed either: a brand-new
          // task starts `scheduledStartTime: null`, which `isInsideWindow`
          // always treats as movable regardless of scope. If this can't find
          // room before the deadline, `finalTask.scheduledStartTime` comes
          // back null and the frontend offers the same reschedule-cascade
          // confirm used elsewhere (falling back to overflow-recovery).
          const scope: CascadeScope = { windowStart: now, windowEnd: now };
          const cascaded = await this.scheduler.cascadeReschedule(
            user.id,
            prefs,
            scope,
            tx,
          );

          const finalTask = await tx.task.findUniqueOrThrow({
            where: { id: created.id },
            include: { tags: true },
          });

          const tagNames = finalTask.tags
            .map((t) => t.name)
            .sort((a, b) => a.localeCompare(b));
          const createdPlacement = cascaded.find((d) => d.id === created.id);
          await this.scheduler.recordEvent(
            user.id,
            finalTask.id,
            "CREATE",
            {
              scheduledStartTime: finalTask.scheduledStartTime,
              durationMinutes: finalTask.durationMinutes,
            },
            {
              tags: tagNames,
              occurredAt: now,
              propensity: createdPlacement?.propensity,
            },
            tx,
          );

          return {
            finalTask,
            displaced: cascaded.filter((d) => d.id !== created.id),
            correction,
          };
        });

      const overflow =
        finalTask.scheduledStartTime === null
          ? toOverflow(
              await this.scheduler.computeOverflowOptions(
                user.id,
                {
                  id: finalTask.id,
                  durationMinutes: finalTask.durationMinutes,
                  deadline: finalTask.deadline!,
                },
                prefs,
                now,
              ),
            )
          : null;

      const schedulingMeta: SchedulingMeta = {
        adjustedDuration: finalTask.durationMinutes,
        placedAt: finalTask.scheduledStartTime
          ? finalTask.scheduledStartTime.toISOString()
          : null,
        engine: "edf",
        biasApplied: correction.biasApplied,
        estimatedDuration: correction.estimatedDuration,
        durationAdjustmentMode: user.durationAdjustmentMode,
        durationReason: correction.durationReason,
      };

      return {
        task: this.toDto(finalTask),
        schedulingMeta,
        displaced: toDisplaced(displaced),
        overflow,
      };
    } catch (error) {
      console.error(error);
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === PostgresErrorCode.ForeignViolation)
          throw new BadRequestException({
            success: false,
            message: "Cannot create task: associated user does not exist",
          });
      }
      if (error instanceof BadRequestException) throw error;
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
    const focalStart = minutesToUtc(startStr, 0, tz);
    const focalEnd = minutesToUtc(endStr, 1439, tz);
    // Display window: what the frontend grid renders. For month this pads out
    // to whole Monday-started weeks so adjacent-month edge cells aren't blank;
    // for week/day it equals the focal window.
    const { startStr: displayStartStr, endStr: displayEndStr } =
      displayDayRange(dto.view, dto.date);
    const displayStart = minutesToUtc(displayStartStr, 0, tz);
    const displayEnd = minutesToUtc(displayEndStr, 1439, tz);

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

  /**
   * Metadata-only update: title/note/deadline/tags are saved immediately and
   * the task KEEPS its current slot — this endpoint never cascades.
   *  - A `deadline` change is saved as-is; `deadlineChanged` tells the
   *    frontend a reschedule may be warranted around the task's current
   *    placement (see `rescheduleCascade`).
   *  - A `tags` change runs the duration-corrector and, unless the user's
   *    `durationAdjustmentMode` is `"never"`, applies the corrected duration
   *    in the SAME write (no separate accept step). Either kind of change can
   *    leave the task's slot in conflict with its neighbours, which the
   *    frontend resolves the same way: a confirm-before-reschedule prompt
   *    that calls `rescheduleCascade`.
   */
  async update(
    id: string,
    dto: UpdateTaskDto,
    user: User,
  ): Promise<UpdateTaskResponse> {
    const scalarData = {
      title: dto.title,
      note: dto.note,
      deadline:
        dto.deadline === undefined
          ? undefined
          : dto.deadline === null
            ? null
            : new Date(dto.deadline),
    };
    const touchTags = dto.tags !== undefined;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const target = await tx.task.findFirst({
          where: { id, userId: user.id },
        });
        if (!target)
          throw new NotFoundException(`Cannot find task with id ${id}`);

        const deadlineChanged =
          dto.deadline !== undefined &&
          (dto.deadline === null
            ? target.deadline !== null
            : target.deadline?.toISOString() !==
              new Date(dto.deadline).toISOString());

        const tagIds = touchTags
          ? await this.resolveTagIds(tx, user.id, dto.tags ?? [])
          : [];

        // Computed BEFORE the write so an applied correction lands in the
        // same `tx.task.update` as the tag change itself, instead of a
        // separate deferred write.
        const correction = touchTags
          ? await this.scheduler.computeDurationCorrection(
              user.id,
              (dto.tags ?? []).map((t) => t.trim()).filter(Boolean),
              target.durationMinutes,
              tx,
            )
          : undefined;
        const applyCorrection =
          touchTags && user.durationAdjustmentMode !== "never";

        const updated = await tx.task.update({
          where: { id },
          data: {
            ...scalarData,
            ...(applyCorrection && correction
              ? { durationMinutes: correction.adjustedDuration }
              : {}),
            ...(touchTags
              ? { tags: { set: tagIds.map((id) => ({ id })) } }
              : {}),
          },
          include: { tags: true },
        });

        let schedulingMeta: SchedulingMeta | undefined;
        if (correction) {
          schedulingMeta = {
            adjustedDuration: updated.durationMinutes,
            placedAt: updated.scheduledStartTime
              ? updated.scheduledStartTime.toISOString()
              : null,
            engine: "edf",
            biasApplied: correction.biasApplied,
            estimatedDuration: correction.estimatedDuration,
            durationAdjustmentMode: user.durationAdjustmentMode,
            durationReason: correction.durationReason,
          };
        }

        return {
          task: this.toDto(updated),
          ...(deadlineChanged ? { deadlineChanged: true } : {}),
          ...(schedulingMeta ? { schedulingMeta } : {}),
        };
      });
    } catch (error) {
      console.error(error);
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

  async simulate(
    dto: SimulateTaskDto,
    user: User,
    now: Date = new Date(),
  ): Promise<SimulateTaskResponse> {
    const prefs = this.scheduler.prefsOf(user);
    const cleanTags = (dto.tags ?? []).map((t) => t.trim()).filter(Boolean);
    const correction = await this.scheduler.computeDurationCorrection(
      user.id,
      cleanTags,
      dto.durationMinutes,
    );
    const applyCorrection = user.durationAdjustmentMode !== "never";
    const effectiveDuration = applyCorrection
      ? correction.adjustedDuration
      : dto.durationMinutes;
    const deadline = new Date(dto.deadline);

    const { proposals } = await this.scheduler.simulate(
      user.id,
      prefs,
      { durationMinutes: effectiveDuration, deadline, tags: cleanTags },
      now,
      getRerankK(deadline, this.scheduler.prefsOf(user), now),
    );

    const overflow =
      proposals.length === 0
        ? toOverflow(
            await this.scheduler.computeOverflowOptions(
              user.id,
              {
                id: "__simulated__",
                durationMinutes: effectiveDuration,
                deadline,
              },
              prefs,
              now,
            ),
          )
        : null;

    const schedulingMeta: SchedulingMeta = {
      adjustedDuration: effectiveDuration,
      placedAt: proposals[0]?.scheduledStartTime.toISOString() ?? null,
      engine: "edf",
      rationale: proposals[0]?.rationale?.summary,
      biasApplied: correction.biasApplied,
      estimatedDuration: correction.estimatedDuration,
      durationAdjustmentMode: user.durationAdjustmentMode,
      durationReason: correction.durationReason,
    };

    return {
      schedulingMeta,
      overflow,
    };
  }

  /**
   * The shared confirm-before-reschedule target: a deadline edit, a
   * tags-driven duration change, and a delete can all leave the schedule in
   * conflict, and all three resolve it the same way — repack whatever's
   * movable inside a window the frontend computed (±3 workdays around the
   * affected task's placement; see `RescheduleCascadeInput`). No anchor task:
   * `cascadeReschedule` logs a RESCHEDULED event for every task it actually
   * moves, since none of them is `scope.fixedTaskId`.
   */
  async rescheduleCascade(
    dto: RescheduleCascadeDto,
    user: User,
  ): Promise<{ displaced: DisplacedTask[] }> {
    const prefs = this.scheduler.prefsOf(user);
    const scope: CascadeScope = {
      windowStart: new Date(dto.windowStart),
      windowEnd: new Date(dto.windowEnd),
      includeManual: dto.includeManual,
    };

    const cascaded = await this.prisma.$transaction((tx) =>
      this.scheduler.cascadeReschedule(user.id, prefs, scope, tx),
    );

    return { displaced: toDisplaced(cascaded) };
  }

  /** Wires the accepted overflow-recovery choice to `SchedulerService`. */
  async resolveOverflow(
    id: string,
    choice: OverflowChoice,
    user: User,
    now: Date = new Date(),
  ): Promise<RescheduleResponse> {
    const prefs = this.scheduler.prefsOf(user);
    const result = await this.scheduler.resolveOverflow(
      id,
      choice,
      user.id,
      prefs,
      now,
    );
    const finalTask = await this.prisma.task.findUniqueOrThrow({
      where: { id },
      include: { tags: true },
    });
    return {
      task: this.toDto(finalTask),
      displaced: toDisplaced(result.displaced),
      rationale: null,
    };
  }

  /**
   * Manual drag-to-reschedule: pins the task at the dropped slot
   * (`manuallyMoved: true`). Only this task moves — no cascade, so other
   * tasks' placement/conflict flags are never touched by a drag.
   */
  async displace(
    id: string,
    requestedStartTime: string,
    user: User,
    now: Date = new Date(),
  ): Promise<RescheduleResponse> {
    const requested = new Date(requestedStartTime);

    return this.prisma.$transaction(async (tx) => {
      const target = await tx.task.findFirst({
        where: { id, userId: user.id },
        include: { tags: true },
      });
      if (!target)
        throw new NotFoundException(`Cannot find task with id ${id}`);

      await tx.task.update({
        where: { id },
        data: {
          scheduledStartTime: requested,
          manuallyMoved: true,
          conflict: false,
        },
      });

      const tagNames = target.tags
        .map((t) => t.name)
        .sort((a, b) => a.localeCompare(b));
      await this.scheduler.recordEvent(
        user.id,
        id,
        "MOVE",
        {
          scheduledStartTime: requested,
          durationMinutes: target.durationMinutes,
        },
        {
          tags: tagNames,
          occurredAt: now,
          oldSnapshot: buildSnapshot({
            scheduledStartTime: target.scheduledStartTime,
            durationMinutes: target.durationMinutes,
          }),
          previousScheduledStartTime: target.scheduledStartTime,
        },
        tx,
      );

      const finalTask = await tx.task.findUniqueOrThrow({
        where: { id },
        include: { tags: true },
      });

      return {
        task: this.toDto(finalTask),
        displaced: [],
        rationale: null,
      };
    });
  }

  /**
   * Manual edge-resize: updates duration + pins `manuallyMoved: true`
   */
  async resize(
    id: string,
    requestedStartTime: string,
    durationMinutes: number,
    user: User,
    now: Date = new Date(),
  ): Promise<RescheduleResponse> {
    const requested = new Date(requestedStartTime);

    return this.prisma.$transaction(async (tx) => {
      const target = await tx.task.findUnique({
        where: { id, userId: user.id },
        include: { tags: true },
      });
      if (!target)
        throw new NotFoundException(`Cannot find task with id ${id}`);

      await tx.task.update({
        where: { id },
        data: {
          scheduledStartTime: requested,
          durationMinutes,
          manuallyMoved: true,
          conflict: false,
        },
      });

      const tagNames = target.tags
        .map((t) => t.name)
        .sort((a, b) => a.localeCompare(b));
      await this.scheduler.recordEvent(
        user.id,
        id,
        "RESIZE",
        { scheduledStartTime: requested, durationMinutes },
        {
          tags: tagNames,
          occurredAt: now,
          oldSnapshot: buildSnapshot({
            scheduledStartTime: target.scheduledStartTime,
            durationMinutes: target.durationMinutes,
          }),
          previousScheduledStartTime: target.scheduledStartTime,
        },
        tx,
      );

      const finalTask = await tx.task.findUniqueOrThrow({
        where: { id },
        include: { tags: true },
      });

      return {
        task: this.toDto(finalTask),
        displaced: [],
      };
    });
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
            rewardScore: 1.0,
            occurredAt: now,
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

  /**
   * Plain delete — never cascades. If the deleted task left a gap or
   * conflict behind, the frontend resolves it the same way as a
   * deadline/tags edit: a confirm-before-reschedule prompt that calls
   * {@link rescheduleCascade} with a window computed from the task's
   * (now-gone) placement.
   */
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
