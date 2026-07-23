import { randomUUID } from "crypto";
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import type {
  CreateTaskResponse,
  OptimizeApplyResponse,
  OptimizePreviewResponse,
  OptimizeWindowInput,
  RemoveTaskResponse,
  RescheduleResponse,
  SchedulingMeta,
  SchedulingRationale,
  Task as SharedTask,
  TaskDetailResponse,
  TaskSuggestionsResponse,
  TasksListResponse,
  UndoBatchResponse,
  UpdateTaskResponse,
} from "@zenflow/shared";
import { Prisma, type Tag, type Task, type User } from "../../generated/prisma";
import { minutesToUtc } from "../common/utils";
import { PostgresErrorCode } from "../prisma/error-codes";
import { PrismaService } from "../prisma/prisma.service";
import { SchedulerService } from "../scheduler/scheduler.service";
import { toDisplaced } from "../scheduler/utils/displace";
import { buildTierRationale } from "../scheduler/utils/rationale";
import { buildSnapshot, toEdfTask } from "../scheduler/utils/telemetry";
import { MAX_SCAN_DAYS } from "../scheduler/constants";
import type { Interval } from "../scheduler/utils/slot";
import {
  displayDayRange,
  sumWorkMinutes,
  viewDayRange,
} from "../scheduler/utils/horizon";
import { CreateTaskDto } from "./dto/create-task.dto";
import { ListTaskSuggestionsDto } from "./dto/list-task-suggestions.dto";
import { ListTasksDto } from "./dto/list-tasks.dto";
import { UpdateTaskDto } from "./dto/update-task.dto";
import { OptimizeWindowDto } from "./dto/optimize-window.dto";

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

  /**
   * Create a single task, always EDF-placed via the narrow single-task
   * tiered placer (`SchedulerService.placeNewTask` → `place.ts`'s
   * `placeTask`). A brand-new task has nothing to displace — it only ever
   * picks an already-free slot (Tier1→2→3), coming back unplaced
   * (`conflict: true`) only when the calendar is genuinely saturated for
   * `MAX_SCAN_DAYS`. Never touches another task.
   */
  async create(
    dto: CreateTaskDto,
    user: User,
    now: Date = new Date(),
  ): Promise<CreateTaskResponse> {
    const prefs = this.scheduler.prefsOf(user);
    const deadline = new Date(dto.deadline);
    const cleanTags = (dto.tags ?? []).map((t) => t.trim()).filter(Boolean);

    // Phase-2 per-tag duration corrector. ALWAYS computed (so it always LEARNS,
    // even in `never` mode) but only APPLIED when the user's mode is not
    // `never`. Deliberately OUTSIDE the transaction below: it is a read-only
    // scan of up to 2000 historical TaskEvent rows (each carrying two JSON
    // snapshots), it takes no part in the write's atomicity, and leaving it
    // inside spent a large slice of the 5s interactive-transaction budget
    // before the first write even ran.
    const correction = await this.scheduler.computeDurationCorrection(
      user.id,
      cleanTags,
      dto.durationMinutes,
    );
    const applyCorrection = user.durationAdjustmentMode !== "never";
    const effectiveDuration = applyCorrection
      ? correction.adjustedDuration
      : dto.durationMinutes;

    try {
      const { finalTask, rationale } = await this.prisma.$transaction(
        async (tx) => {
          const tagIds = await this.resolveTagIds(tx, user.id, cleanTags);

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

          const placement = await this.scheduler.placeNewTask(
            user.id,
            prefs,
            now,
            toEdfTask(created),
            tx,
          );

          const finalTask = await tx.task.update({
            where: { id: created.id },
            data: {
              scheduledStartTime: placement.interval
                ? new Date(placement.interval.start)
                : null,
              conflict: placement.interval === null,
            },
            include: { tags: true },
          });

          const tagNames = finalTask.tags
            .map((t) => t.name)
            .sort((a, b) => a.localeCompare(b));
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
              propensity: placement.propensity,
            },
            tx,
          );

          return { finalTask, rationale: placement.rationale };
        },
      );

      const schedulingMeta: SchedulingMeta = {
        adjustedDuration: finalTask.durationMinutes,
        placedAt: finalTask.scheduledStartTime
          ? finalTask.scheduledStartTime.toISOString()
          : null,
        engine: "edf",
        rationale: rationale.summary,
        biasApplied: correction.biasApplied,
        estimatedDuration: correction.estimatedDuration,
        durationAdjustmentMode: user.durationAdjustmentMode,
        durationReason: correction.durationReason,
      };

      return {
        task: this.toDto(finalTask),
        schedulingMeta,
        // Create never displaces anything — the narrow single-task placer
        // only ever picks an already-free slot.
        displaced: [],
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

    // DB-level bound: only unplaced tasks (still surfaced as conflicts
    // regardless of window) or ones scheduled within the display window —
    // never every task the user has ever created.
    const where: Prisma.TaskWhereInput = {
      userId: user.id,
      OR: [
        { scheduledStartTime: null },
        { scheduledStartTime: { gte: displayStart, lte: displayEnd } },
      ],
    };
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
      out.push(this.toDto(t));

      const placedAt = t.scheduledStartTime;
      const unplaced = placedAt === null;
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
   * Metadata-only update: title/note/deadline/tags are saved immediately.
   * NEVER auto-searches for a new slot — the task's own placement is left
   * exactly where it is.
   *  - A `deadline` change is saved as-is; `deadlineChanged` is informational
   *    for the frontend.
   *  - A `tags` change runs the duration-corrector and, unless the user's
   *    `durationAdjustmentMode` is `"never"`, applies the corrected duration
   *    in the SAME write (no separate accept step).
   *
   * If the (unchanged) slot no longer fits the new deadline/duration, the
   * response's `rationale` explains it's now broken and the frontend/mobile
   * show an Accept/Decline toast — this is an "overdue" state (the task's
   * own slot vs. its own new deadline), NOT a double-booking, so it does
   * NOT set `conflict: true` (that flag is reserved for genuine pairwise
   * overlap, see `SchedulerService.markConflicts`). Accept calls the
   * separate `resolvePlacement` (below), which recomputes the same
   * own-slot-vs-own-deadline check to actually search for a new slot;
   * Decline leaves it as-is, resolvable later by a drag or Optimize.
   * Skipped for an unplaced task or one already past/in-progress.
   */
  async update(
    id: string,
    dto: UpdateTaskDto,
    user: User,
    now: Date = new Date(),
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
    try {
      return await this.prisma.$transaction(async (tx) => {
        const target = await tx.task.findFirst({
          where: { id, userId: user.id },
          include: { tags: true },
        });
        if (!target)
          throw new NotFoundException(`Cannot find task with id ${id}`);

        // `dto.tags` is the full current form value from both clients — it's
        // present on every save, even a title-only edit. Only treat tags as
        // "touched" if the requested set actually differs (order-insensitive)
        // from the task's current tag set; otherwise the duration corrector
        // must not run.
        const currentTagNames = new Set(target.tags.map((t) => t.name));
        const requestedTagNames = new Set(
          (dto.tags ?? []).map((t) => t.trim()).filter(Boolean),
        );
        const tagsSetChanged =
          currentTagNames.size !== requestedTagNames.size ||
          [...currentTagNames].some((name) => !requestedTagNames.has(name));
        const touchTags = dto.tags !== undefined && tagsSetChanged;

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
        const durationChanged =
          applyCorrection &&
          correction !== undefined &&
          correction.adjustedDuration !== target.durationMinutes;

        // Would the edit leave the task's OWN (unchanged) slot no longer
        // valid? Only relevant for a task that's still in the future.
        const newDeadline =
          scalarData.deadline !== undefined
            ? scalarData.deadline
            : target.deadline;
        const newDuration =
          applyCorrection && correction
            ? correction.adjustedDuration
            : target.durationMinutes;
        const stillFuture =
          target.scheduledStartTime !== null &&
          target.scheduledStartTime.getTime() > now.getTime();
        const invalidated =
          stillFuture &&
          (deadlineChanged || durationChanged) &&
          newDeadline !== null &&
          target.scheduledStartTime!.getTime() + newDuration * 60_000 >
            newDeadline.getTime();

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

        const rationale: SchedulingRationale | undefined = invalidated
          ? {
              summary: deadlineChanged
                ? "This task's slot no longer fits its new deadline — want to reschedule it?"
                : "This task's slot no longer fits its updated duration — want to reschedule it?",
            }
          : undefined;

        return {
          task: this.toDto(updated),
          ...(deadlineChanged ? { deadlineChanged: true } : {}),
          ...(schedulingMeta ? { schedulingMeta } : {}),
          displaced: [],
          ...(rationale ? { rationale } : {}),
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

  /**
   * Edit-accept: re-place a task `update()` just reported as broken (its own
   * slot no longer fits its own deadline/duration — recomputed here rather
   * than trusted from `conflict`, since `update()` deliberately does not set
   * `conflict: true` for this case). Explicit, opt-in — only ever called
   * from the frontend/mobile's Accept action on the offer-to-reschedule
   * toast, never automatically. A no-op (task returned as-is) when the
   * task isn't currently flagged conflicting AND its own slot still fits.
   */
  async resolvePlacement(
    id: string,
    user: User,
    now: Date = new Date(),
  ): Promise<RescheduleResponse> {
    const prefs = this.scheduler.prefsOf(user);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const target = await tx.task.findFirst({
          where: { id, userId: user.id },
          include: { tags: true },
        });
        if (!target)
          throw new NotFoundException(`Cannot find task with id ${id}`);

        // Genuine overlap conflicts are flagged via `target.conflict`. A
        // task whose OWN (unchanged) slot no longer fits its OWN deadline —
        // `update()`'s edit-invalidation case — is never persisted as
        // `conflict: true` (that's a distinct "overdue" state, not a
        // double-booking), so it's recomputed here instead of trusted from
        // the stale flag.
        const ownSlotInvalid =
          target.scheduledStartTime !== null &&
          target.scheduledStartTime.getTime() > now.getTime() &&
          target.deadline !== null &&
          target.scheduledStartTime.getTime() +
            target.durationMinutes * 60_000 >
            target.deadline.getTime();

        if (!target.conflict && !ownSlotInvalid) {
          return { task: this.toDto(target), displaced: [], rationale: null };
        }

        const placement = await this.scheduler.resolveInvalidPlacement(
          user.id,
          prefs,
          now,
          toEdfTask(target),
          tx,
        );

        const updated = await tx.task.update({
          where: { id },
          data: {
            scheduledStartTime: placement.interval
              ? new Date(placement.interval.start)
              : null,
            conflict: placement.interval === null,
          },
          include: { tags: true },
        });

        let batchId: string | null = null;
        if (placement.interval) {
          batchId = randomUUID();
          const tagNames = updated.tags
            .map((t) => t.name)
            .sort((a, b) => a.localeCompare(b));
          await this.scheduler.recordEvent(
            user.id,
            id,
            "RESCHEDULED",
            {
              scheduledStartTime: updated.scheduledStartTime,
              durationMinutes: updated.durationMinutes,
            },
            {
              tags: tagNames,
              occurredAt: now,
              oldSnapshot: buildSnapshot({
                scheduledStartTime: target.scheduledStartTime,
                durationMinutes: target.durationMinutes,
              }),
              propensity: placement.propensity,
              batchId,
            },
            tx,
          );
        }

        return {
          task: this.toDto(updated),
          displaced: [],
          rationale: placement.rationale,
          ...(batchId ? { batchId } : {}),
        };
      });
    } catch (error) {
      console.error(error);
      if (error instanceof NotFoundException) throw error;
      throw new InternalServerErrorException({
        success: false,
        message: "Something went wrong when resolving a task's placement",
      });
    }
  }

  /**
   * Undo one auto-move batch (`resolvePlacement`'s own RESCHEDULED event, or
   * an Optimize apply's batch). 404s when `batchId` matches no event for this
   * user; returns `{ requiresConfirmation, touchedTaskIds }` (without
   * writing) when the pre-flight "touched since" check finds a row that was
   * acted on again since — the caller resubmits with `strategy`.
   */
  async undoBatch(
    batchId: string,
    user: User,
    strategy?: "all" | "excludeTouched",
  ): Promise<UndoBatchResponse> {
    const result = await this.prisma.$transaction((tx) =>
      this.scheduler.undoBatch(user.id, batchId, tx, strategy),
    );
    if (!result.found)
      throw new NotFoundException(
        `Cannot find reschedule batch with id ${batchId}`,
      );
    if (result.requiresConfirmation) {
      return {
        displaced: [],
        requiresConfirmation: true,
        touchedTaskIds: result.touchedTaskIds,
      };
    }
    return { displaced: toDisplaced(result.displaced) };
  }

  /**
   * Manual drag-to-reschedule: writes the requested interval UNCONDITIONALLY
   * (`SchedulerService.applyDirectPlacement`) — no search, no eviction. If the
   * dropped slot now overlaps another task, BOTH are flagged `conflict: true`
   * (a bounded, indexed-range recheck) and the response's `rationale` names
   * the overlap; neither is auto-relocated. Resolvable later by a follow-up
   * drag or Optimize.
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

      const interval: Interval = {
        start: requested.getTime(),
        end: requested.getTime() + target.durationMinutes * 60_000,
      };
      const { conflictWithTitle } = await this.scheduler.applyDirectPlacement(
        user.id,
        target,
        interval,
        tx,
      );

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
      const rationale = buildTierRationale(
        "direct",
        interval,
        [],
        user.timezone,
        { conflictWithTitle },
      );

      return {
        task: this.toDto(finalTask),
        displaced: [],
        rationale,
      };
    });
  }

  /**
   * Manual edge-resize: same direct-write + bounded conflict recheck
   * `displace()` uses, over the task's own new span.
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

      const interval: Interval = {
        start: requested.getTime(),
        end: requested.getTime() + durationMinutes * 60_000,
      };
      const { conflictWithTitle } = await this.scheduler.applyDirectPlacement(
        user.id,
        target,
        interval,
        tx,
      );

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
      const rationale = buildTierRationale(
        "direct",
        interval,
        [],
        user.timezone,
        { conflictWithTitle },
      );

      return {
        task: this.toDto(finalTask),
        displaced: [],
        rationale,
      };
    });
  }

  /**
   * Mark DONE, then free its slot (`SchedulerService.freeSlot`) — a bounded
   * conflict-clear on whatever was ONLY conflicting with it. Nothing else
   * ever moves.
   */
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
        await this.scheduler.freeSlot(user.id, updated, tx);

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
   * Delete, then free the slot it leaves behind (`SchedulerService.
   * freeSlot`) — a bounded conflict-clear on whatever was ONLY conflicting
   * with it. No reoptimize, nothing else ever moves.
   */
  async remove(id: string, user: User): Promise<RemoveTaskResponse> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const target = await tx.task.findFirst({
          where: { id, userId: user.id },
        });
        if (!target)
          throw new NotFoundException(`Cannot find task with id ${id}`);
        await tx.task.delete({ where: { id, userId: user.id } });
        await this.scheduler.freeSlot(user.id, target, tx);
        return { displaced: [] };
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

  /** Validates + parses an Optimize window; the backend's own `MAX_SCAN_DAYS`
   * ceiling is enforced here regardless of what the client UI's picker
   * allows (`OPTIMIZE_UI_MAX_WINDOW_DAYS`, stricter, is a `packages/shared`
   * constant the FE/mobile pickers use). */
  private validateOptimizeWindow(dto: OptimizeWindowInput): {
    windowStart: Date;
    windowEnd: Date;
  } {
    const windowStart = new Date(dto.windowStart);
    const windowEnd = new Date(dto.windowEnd);
    if (
      Number.isNaN(windowStart.getTime()) ||
      Number.isNaN(windowEnd.getTime())
    )
      throw new BadRequestException("Invalid windowStart/windowEnd");
    if (windowEnd.getTime() <= windowStart.getTime())
      throw new BadRequestException("windowEnd must be after windowStart");
    const days =
      (windowEnd.getTime() - windowStart.getTime()) / (24 * 60 * 60 * 1000);
    if (days > MAX_SCAN_DAYS)
      throw new BadRequestException(
        `Optimize window cannot exceed ${MAX_SCAN_DAYS} days`,
      );
    return { windowStart, windowEnd };
  }

  /**
   * Optimize preview: a COUNT ONLY of how many tasks would move (no diff,
   * nothing written) — `SchedulerService.optimizeWindow(..., { dryRun: true
   * })`.
   */
  async optimizePreview(
    dto: OptimizeWindowDto,
    user: User,
    now: Date = new Date(),
  ): Promise<OptimizePreviewResponse> {
    const { windowStart, windowEnd } = this.validateOptimizeWindow(dto);
    const prefs = this.scheduler.prefsOf(user);
    const result = await this.scheduler.optimizeWindow(
      user.id,
      prefs,
      now,
      windowStart,
      windowEnd,
      dto.mode,
      this.prisma,
      { dryRun: true },
    );
    return {
      count: result.count,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
    };
  }

  /**
   * Optimize apply: recomputes server-side (never trusting the preview's
   * count as stale) and writes every moved task in one batch —
   * `SchedulerService.optimizeWindow(..., { dryRun: false })`.
   */
  async optimizeApply(
    dto: OptimizeWindowDto,
    user: User,
    now: Date = new Date(),
  ): Promise<OptimizeApplyResponse> {
    const { windowStart, windowEnd } = this.validateOptimizeWindow(dto);
    const prefs = this.scheduler.prefsOf(user);
    const result = await this.prisma.$transaction((tx) =>
      this.scheduler.optimizeWindow(
        user.id,
        prefs,
        now,
        windowStart,
        windowEnd,
        dto.mode,
        tx,
        { dryRun: false },
      ),
    );
    return {
      count: result.count,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      batchId: result.batchId,
      ...(dto.mode === "retainManual"
        ? {
            fixedCount: result.fixedCount,
            unchangedCount: result.unchangedCount,
          }
        : {}),
    };
  }
}
