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
  UndoBatchResponse,
  UpdateTaskResponse,
} from "@zenflow/shared";
import { Prisma, type Tag, type Task, type User } from "../../generated/prisma";
import { minutesToUtc } from "../common/utils";
import { PostgresErrorCode } from "../prisma/error-codes";
import { PrismaService } from "../prisma/prisma.service";
import { SchedulerService } from "../scheduler/scheduler.service";
import { toDisplaced } from "../scheduler/utils/displace";
import { buildSnapshot } from "../scheduler/utils/telemetry";
import {
  displayDayRange,
  sumWorkMinutes,
  viewDayRange,
} from "../scheduler/utils/horizon";
import { CreateTaskDto } from "./dto/create-task.dto";
import { ListTaskSuggestionsDto } from "./dto/list-task-suggestions.dto";
import { ListTasksDto } from "./dto/list-tasks.dto";
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
      const { finalTask, displaced } = await this.prisma.$transaction(
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

          // A brand-new task has no anchor (0 deviation cost — see edf.ts's
          // cost model), so it enters the SAME unified `reoptimize` pass as
          // every other pending task, `fixedTaskId` so its own CREATE event
          // (below) isn't double-logged as a collateral RESCHEDULED. Placing
          // it well can now legitimately nudge a far-out, cost-cheap-to-move
          // task out of the way — that's expected under the continuous cost
          // model, not a bug (the old "never displaces anything on create"
          // guarantee is gone along with the hard manual-freeze it depended
          // on). Only comes back `scheduledStartTime: null` / `conflict: true`
          // when the calendar is genuinely saturated for `MAX_SCAN_DAYS`.
          const { displaced: cascaded } = await this.scheduler.reoptimize(
            user.id,
            prefs,
            now,
            tx,
            { fixedTaskId: created.id },
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
          };
        },
      );

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
   * Metadata-only update: title/note/deadline/tags are saved immediately.
   *  - A `deadline` change is saved as-is; `deadlineChanged` is informational
   *    for the frontend.
   *  - A `tags` change runs the duration-corrector and, unless the user's
   *    `durationAdjustmentMode` is `"never"`, applies the corrected duration
   *    in the SAME write (no separate accept step).
   *
   * Either kind of change can leave the schedule needing a repack — a
   * tightened deadline or a longer duration can push the task's OWN
   * (unchanged) slot past its new deadline or into a neighbour — so this now
   * auto-resolves INLINE, in the same transaction, via
   * `SchedulerService.reoptimize`. The edited task's own placement is a
   * NORMAL member of that pass (no anchor-pinning): a tightened deadline that
   * no longer fits its current slot cost-forces it to relocate (to a slot
   * that respects the new deadline), while a loosened deadline correctly
   * leaves it exactly in place (zero deviation cost dominates). Skipped for
   * an unplaced task or one already past/in-progress.
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
    const touchTags = dto.tags !== undefined;
    const prefs = this.scheduler.prefsOf(user);

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
        const durationChanged =
          applyCorrection &&
          correction !== undefined &&
          correction.adjustedDuration !== target.durationMinutes;

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

        // Inline, same-transaction reoptimize: a deadline edit or an applied
        // duration correction can leave the task's OWN slot no longer
        // cost-optimal (past its new deadline, or overlapping a neighbor) —
        // a no-op when nothing actually needs to move. Skipped for an
        // unplaced task or one already past/in-progress.
        let displaced: DisplacedTask[] = [];
        let batchId: string | null | undefined;
        let finalTask = updated;
        if (
          (deadlineChanged || durationChanged) &&
          updated.scheduledStartTime &&
          updated.scheduledStartTime.getTime() > now.getTime()
        ) {
          const result = await this.scheduler.reoptimize(
            user.id,
            prefs,
            now,
            tx,
          );
          displaced = toDisplaced(result.displaced.filter((d) => d.id !== id));
          batchId = result.batchId;
          // The edit itself may have cost-forced THIS task to relocate too
          // (the bug this redesign fixes) — re-read it so the returned `task`
          // reflects its final slot, not the pre-reoptimize one.
          if (result.displaced.some((d) => d.id === id)) {
            finalTask = await tx.task.findUniqueOrThrow({
              where: { id },
              include: { tags: true },
            });
          }
        }

        return {
          task: this.toDto(finalTask),
          ...(deadlineChanged ? { deadlineChanged: true } : {}),
          ...(schedulingMeta ? { schedulingMeta } : {}),
          displaced,
          ...(batchId ? { batchId } : {}),
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

    // `SchedulerService.simulate` already falls back to an outside-hours /
    // past-deadline slot (see `edf.ts`'s `fallbackSlot`) when nothing fits
    // in-hours before the deadline, so `proposals` only comes back empty in
    // the rare genuinely-saturated-calendar case. The draft task has no
    // anchor, so it doesn't need the full cost-scored pool `scheduleAll`
    // builds for pending tasks — a single best fallback candidate suffices.
    const { proposals } = await this.scheduler.simulate(
      user.id,
      prefs,
      { durationMinutes: effectiveDuration, deadline, tags: cleanTags },
      now,
      getRerankK(deadline, this.scheduler.prefsOf(user), now),
    );

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
    };
  }

  /**
   * Undo one `reoptimize` auto-cascade: reverts every task it displaced back
   * to its prior slot/duration. Wires straight to `SchedulerService.
   * undoBatch`; throws 404 when `batchId` matches no `TaskEvent` for this
   * user (never existed / belongs to someone else).
   */
  async undoBatch(batchId: string, user: User): Promise<UndoBatchResponse> {
    const restored = await this.prisma.$transaction((tx) =>
      this.scheduler.undoBatch(user.id, batchId, tx),
    );
    if (restored.length === 0)
      throw new NotFoundException(
        `Cannot find reschedule batch with id ${batchId}`,
      );
    return { displaced: toDisplaced(restored) };
  }

  /**
   * Manual drag-to-reschedule: pins the task at the dropped slot
   * (`manuallyMoved: true` — kept for the "Manually placed" badge/telemetry
   * only; the cost model never reads it), then — same transaction — runs a
   * full `reoptimize` to push anything it now overlaps out of the way,
   * instead of leaving a bare `conflict: true`. The just-dropped slot is
   * naturally protected by the cost model (its anchor is now literally
   * `requested`, so re-moving it costs real deviation) without any special
   * pinning — but it's not IMMUNE: a genuinely cost-favorable eviction can
   * still relocate it again, which shows up in `displaced` like any other
   * collateral move.
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

      const prefs = this.scheduler.prefsOf(user);
      const { displaced, batchId } = await this.scheduler.reoptimize(
        user.id,
        prefs,
        now,
        tx,
      );

      const finalTask = await tx.task.findUniqueOrThrow({
        where: { id },
        include: { tags: true },
      });

      return {
        task: this.toDto(finalTask),
        displaced: toDisplaced(displaced.filter((d) => d.id !== id)),
        rationale: null,
        ...(batchId ? { batchId } : {}),
      };
    });
  }

  /**
   * Manual edge-resize: updates duration + pins `manuallyMoved: true`
   * (informational only — see `displace()`'s doc comment), then — same
   * transaction — the same full `reoptimize` `displace()` uses.
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

      const prefs = this.scheduler.prefsOf(user);
      const { displaced, batchId } = await this.scheduler.reoptimize(
        user.id,
        prefs,
        now,
        tx,
      );

      const finalTask = await tx.task.findUniqueOrThrow({
        where: { id },
        include: { tags: true },
      });

      return {
        task: this.toDto(finalTask),
        displaced: toDisplaced(displaced.filter((d) => d.id !== id)),
        ...(batchId ? { batchId } : {}),
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
   * Delete, then close whatever gap it left behind inline: every other
   * mutation already auto-reoptimizes the whole pending schedule in the same
   * transaction (CLAUDE.md invariant #2 redesign), so a delete — which can
   * free up a slot a later-deadline task would rather have — does the same
   * rather than leaving a stale gap for a separate confirm step that no
   * longer exists.
   */
  async remove(id: string, user: User, now: Date = new Date()): Promise<void> {
    try {
      const prefs = this.scheduler.prefsOf(user);
      await this.prisma.$transaction(async (tx) => {
        await tx.task.delete({ where: { id, userId: user.id } });
        await this.scheduler.reoptimize(user.id, prefs, now, tx);
      });
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
