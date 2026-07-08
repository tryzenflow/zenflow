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
import { RescheduleCascadeDto } from "./dto/reschedule-cascade.dto";
import type {
  CreateTaskResponse,
  RescheduleResponse,
  Task as SharedTask,
  TaskDetailResponse,
  TaskSuggestionsResponse,
  TasksListResponse,
  UpdateTaskResponse,
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
    const { view, viewStart, viewEnd, ...rest } = dto;
    const overflowView = view ?? "day";
    const viewWindowStart = viewStart ? new Date(viewStart) : undefined;
    const viewWindowEnd = viewEnd ? new Date(viewEnd) : undefined;

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

        // Every task is flexible now (no more fixed anchors): created unplaced,
        // then placed by the cascade below.
        const created = await tx.task.create({
          data: {
            title: rest.title,
            note: rest.note ?? null,
            durationMinutes: effectiveDuration,
            deadline: rest.deadline ? new Date(rest.deadline) : null,
            tags: { connect: tagIds.map((id) => ({ id })) },
            userId: user.id,
            scheduledStartTime: null,
            conflict: false,
          },
        });

        // Deadline-aware insert + view-scoped cascade: re-EDF the movable set —
        // non-manual tasks currently placed within [viewStart, viewEnd), plus
        // this newly-created task itself — so the new task lands at its
        // deadline rank while everything off-screen (and every manually-moved
        // task) stays frozen. Without explicit view bounds this falls back to
        // the unscoped (full) cascade.
        await this.scheduler.cascadeReschedule(
          user,
          tx,
          now,
          viewWindowStart,
          viewWindowEnd,
          created.id,
        );

        const finalTask = await tx.task.findUniqueOrThrow({
          where: { id: created.id },
          include: { tags: true },
        });

        // The stochastic logging policy's propensity for the slot it
        // auto-placed this task into — recorded so off-policy IPS/SNIPS can
        // divide by the TRUE propensity of the suggestion (docs/heuristic.md
        // §Evaluation). Null when unplaced / cold-start. Stored in the snapshot
        // JSON (no migration, no shared-type change).
        const propensity = await this.scheduler.placementPropensity(
          user,
          finalTask,
          tx,
          now,
        );
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
              ...(propensity !== null ? { propensity } : {}),
            },
            rewardScore: EVENT_REWARD.CREATE,
            occurredAt: now,
          },
        });

        // Surface recovery options when:
        //   (a) task is unplaced (no slot within working hours before its
        //       deadline) — the existing overflow-toast flow; OR
        //   (b) task was placed but landed OUTSIDE the active calendar view
        //       window supplied by the frontend (viewStart/viewEnd). This
        //       catches the silent-bump case where EDF places a deadline-bearing
        //       task on a day outside the user's current week/month view because
        //       every in-view slot was already occupied. Without explicit view
        //       bounds the behaviour is unchanged (placed tasks carry no overflow).
        const placedOutsideView =
          finalTask.scheduledStartTime !== null &&
          viewWindowStart !== undefined &&
          viewWindowEnd !== undefined &&
          (finalTask.scheduledStartTime.getTime() < viewWindowStart.getTime() ||
            finalTask.scheduledStartTime.getTime() >= viewWindowEnd.getTime());

        const overflow =
          finalTask.scheduledStartTime === null || placedOutsideView
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

  /**
   * Metadata-only update: title/note/deadline/tags are saved immediately and
   * the task KEEPS its current slot — this endpoint never cascades anymore.
   *  - A `deadline` change is saved as-is; `deadlineChanged` on the response
   *    tells the frontend a reschedule may be warranted so it can surface a
   *    confirm-before-reschedule toast (accepting it calls
   *    `rescheduleCascade`/`POST /tasks/:id/reschedule-cascade`).
   *  - A `tags` change runs the same duration-corrector `create()` uses (never
   *    applied here) and returns it as `schedulingMeta` so the frontend can
   *    drive its duration-adjustment toast; accepting it also goes through
   *    `reschedule-cascade` (with the accepted `durationMinutes`) if it needs
   *    a new slot.
   */
  async update(
    id: string,
    dto: UpdateTaskDto,
    user: User,
  ): Promise<UpdateTaskResponse> {
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

        const deadlineChanged =
          scalarData.deadline !== undefined &&
          (scalarData.deadline?.getTime() ?? null) !==
            (target.deadline?.getTime() ?? null);

        // Tag change → Phase-2 duration-corrector suggestion, NEVER auto-applied
        // here: the frontend decides (per `durationAdjustmentMode`) whether to
        // prompt, then calls `reschedule-cascade` with the accepted duration.
        let schedulingMeta: UpdateTaskResponse["schedulingMeta"];
        if (touchTags) {
          const newTagNames = updated.tags.map((t) => t.name);
          const correction = await this.scheduler.computeDurationCorrection(
            user.id,
            newTagNames,
            updated.durationMinutes,
            tx,
          );
          schedulingMeta = {
            adjustedDuration: correction.adjustedDuration,
            placedAt: updated.scheduledStartTime
              ? updated.scheduledStartTime.toISOString()
              : null,
            engine: "edf" as const,
            biasApplied: correction.biasApplied,
            estimatedDuration: correction.estimatedDuration,
            durationAdjustmentMode: user.durationAdjustmentMode,
            durationReason: correction.durationReason,
          };
        }

        return {
          task: this.toDto(updated),
          ...(schedulingMeta ? { schedulingMeta } : {}),
          ...(deadlineChanged ? { deadlineChanged } : {}),
        };
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

  /**
   * Explicitly trigger the view-scoped cascade for one task — the deadline-edit
   * confirm-before-reschedule flow, and the tag-driven duration-adjustment
   * accept flow (both share this endpoint; see `UpdateTaskResponse` /
   * `RescheduleCascadeDto`). When `durationMinutes` is supplied it is applied
   * BEFORE the cascade runs; the target task is always treated as movable
   * (`includeTaskId`) regardless of its current placement or the view bounds.
   */
  async rescheduleCascade(
    id: string,
    dto: RescheduleCascadeDto,
    user: User,
    now: Date = new Date(),
  ): Promise<RescheduleResponse> {
    const { viewStart, viewEnd, durationMinutes } = dto;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const target = await tx.task.findFirst({
          where: { id, userId: user.id },
        });
        if (!target)
          throw new NotFoundException(`Cannot find task with id ${id}`);

        if (
          durationMinutes !== undefined &&
          durationMinutes !== target.durationMinutes
        ) {
          await tx.task.update({ where: { id }, data: { durationMinutes } });
        }

        const displaced = await this.scheduler.cascadeReschedule(
          user,
          tx,
          now,
          viewStart ? new Date(viewStart) : undefined,
          viewEnd ? new Date(viewEnd) : undefined,
          id,
        );

        const withTags = await tx.task.findUniqueOrThrow({
          where: { id },
          include: { tags: true },
        });

        return {
          task: this.toDto(withTags),
          displaced: displaced
            .filter((d) => d.taskId !== id)
            .map((d) => ({
              taskId: d.taskId,
              newScheduledStartTime: d.newScheduledStartTime
                ? d.newScheduledStartTime.toISOString()
                : null,
            })),
          rationale: this.scheduler.rationaleFor(
            user,
            withTags.scheduledStartTime,
          ),
        };
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
        message: "Something went wrong when rescheduling a task",
      });
    }
  }

  async reschedule(
    id: string,
    requestedStartTime: string,
    user: User,
    now: Date = new Date(),
    viewStart?: string,
    viewEnd?: string,
  ) {
    // Drag-drop is a manual pin: place exactly where dropped, allow overlaps as
    // conflicts, and never cascade other tasks. The EDF engine only runs on
    // task create and preference edits — not on every drag.
    const { task, displaced, outsideViewPeriod } = await this.scheduler.pin(
      user,
      id,
      new Date(requestedStartTime),
      now,
      viewStart ? new Date(viewStart) : undefined,
      viewEnd ? new Date(viewEnd) : undefined,
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
      // Soft period flag: true when the drag landed outside the task's stored
      // view-period (day/week/month it was created in). The move is committed;
      // the frontend uses this to confirm cross-period moves with the user.
      outsideViewPeriod,
    };
  }

  /**
   * Apply a recovery option the user accepted from the create-overflow toast.
   * Re-derives the slot server-side (never trusts a client time), pins the
   * task via `manuallyMoved` so the next cascade keeps it, and records the
   * move. Mirrors {@link reschedule}'s RescheduleResponse shape.
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
    viewStart?: string,
    viewEnd?: string,
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
        // cleared via the now-independent overlap pass) and movable tasks reflow
        // into the freed slot. The just-completed DONE task is excluded — it is
        // no longer PENDING and keeps its own scheduledStartTime. View-scoped
        // when the caller supplies the current calendar view bounds; falls back
        // to the unscoped cascade otherwise.
        await this.scheduler.cascadeReschedule(
          user,
          tx,
          now,
          viewStart ? new Date(viewStart) : undefined,
          viewEnd ? new Date(viewEnd) : undefined,
        );
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
    viewStart?: string,
    viewEnd?: string,
    now: Date = new Date(),
  ): Promise<void> {
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
        // (conflict cleared via the now-independent overlap pass) and movable
        // tasks reflow into the freed slot — mirroring how create() cascades. A
        // cascade failure rolls back the delete. View-scoped when the caller
        // supplies the current calendar view bounds; falls back to the
        // unscoped cascade otherwise.
        await this.scheduler.cascadeReschedule(
          user,
          tx,
          now,
          viewStart ? new Date(viewStart) : undefined,
          viewEnd ? new Date(viewEnd) : undefined,
        );
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
