import { randomUUID } from "node:crypto";
import type {
  Prisma,
  TaskEventType,
  TaskStatus,
} from "../../../generated/prisma";
import type {
  CreateTaskInput,
  SchedulingOverflow,
  ViewMode,
} from "@zenflow/shared";
import {
  feasibleSlots,
  hasElapsed,
  intervalOf,
  isPast,
  scheduleAll,
  type SchedulerPrefs,
} from "../../scheduler/edf";
import { type Interval, SLOT_MS, localDateStr } from "../../scheduler/slot";
import {
  identityReRanker,
  preferenceMatrixReRanker,
  type SlotReRanker,
} from "../../scheduler/reranker";
import { hashSeed } from "../../scheduler/rng";
import {
  blendBias,
  correctDuration,
  maxBias,
} from "../../scheduler/duration-bias";
import { aggregateTagBias } from "../eval/tag-bias";
import type { DurationBiasMode, RerankerKind } from "../runner";
import {
  EVENT_REWARD,
  applyPreferenceDeltas,
  buildSnapshot,
  recomputeConflicts,
  toEdfTask,
} from "../../scheduler/telemetry";
import {
  findNextAvailableSlot,
  findSlotIgnoringWorkHours,
} from "../../scheduler/overflow";
import { periodRange } from "../../scheduler/horizon";
import { minutesToUtc, utcToMinutes } from "../../common/utils";
import { ABANDON_GRACE_MS, TIME_GRANULARITY } from "../../common/constants";

/**
 * In-memory mirror of the production task lifecycle (seed doc §0). The batched
 * simulator computes a whole year of telemetry in memory — calling the SAME pure
 * builders the services use (`scheduleAll`, `toEdfTask`, `buildSnapshot`,
 * `applyPreferenceDeltas`, `recomputeConflicts`, the overflow helpers) — then the
 * writer bulk-inserts the result. Going row-by-row through `TasksService` would
 * mean hundreds of thousands of sequential transactions; this keeps the exact
 * semantics while letting the writer flush in 50k-row batches.
 *
 * Each {@link PersonaState} owns one user's tasks, events, tag vocabulary, and the
 * signed preferenceMatrix accumulator. The methods reproduce, one-for-one, the
 * service operations the closed-loop runner drives (create / pin / resize /
 * complete / overflow / sweep) and the telemetry each emits.
 */

/** A task row held in memory (mirrors the Prisma `Task` columns we persist). */
export interface SimTask {
  id: string;
  title: string;
  note: string | null;
  durationMinutes: number;
  deadline: Date | null;
  fixed: boolean;
  startTime: number;
  status: TaskStatus;
  conflict: boolean;
  manuallyMoved: boolean;
  schedulingAnchor: Date | null;
  scheduledStartTime: Date | null;
  view: ViewMode | null;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
  /** Resolved tag ids on this task (→ the implicit M2M join rows). */
  tagIds: string[];
  /** Tag NAMES (sorted) — recorded on event snapshots ("tags then"). */
  tagNames: string[];
}

/** A TaskEvent row held in memory (the BigInt id is assigned by the DB). */
export interface SimEvent {
  eventType: TaskEventType;
  oldSnapshot: Prisma.InputJsonValue | null;
  newSnapshot: Prisma.InputJsonValue;
  rewardScore: number;
  occurredAt: Date;
  taskId: string;
  userId: string;
}

/** The minimal due-task shape the outcome settler reads. */
export interface DueTask {
  id: string;
  scheduledStartTime: Date | null;
  durationMinutes: number;
  deadline: Date | null;
}

const cleanTagNames = (names: string[]): string[] =>
  Array.from(new Set(names.map((n) => n.trim()).filter((n) => n.length > 0)));

const sortNames = (names: string[]): string[] =>
  [...names].sort((a, b) => a.localeCompare(b));

const snapStart = (d: Date): Date =>
  new Date(Math.round(d.getTime() / SLOT_MS) * SLOT_MS);

export class PersonaState {
  readonly tasks: SimTask[] = [];
  readonly events: SimEvent[] = [];
  matrix: number[] = [];
  /** name → tag id for this user (the `(userId, name)` unique vocabulary). */
  private readonly tagIdByName = new Map<string, string>();
  /**
   * Task IDs that were urgency-spike-moved during this run (§5.6).
   * Collected by the drive loop via urgency spike logic; exported to the
   * ground-truth sidecar so `computeMetrics` can decompose MAR.
   */
  readonly urgencyMovedIds = new Set<string>();

  constructor(
    readonly userId: string,
    readonly prefs: SchedulerPrefs,
    /** Tag names to pre-register so they exist even if never attached. */
    preTags: string[] = [],
    /**
     * Placement policy for this run/arm (eval Step 5). `identity` = Phase-1 EDF
     * earliest-fit; `phase2` = signed-matrix re-rank + per-tag duration
     * correction. Defaults to `identity` so existing runs are byte-for-byte
     * unchanged.
     */
    private readonly reranker: RerankerKind = "identity",
    /**
     * Multi-tag duration-bias resolution for the `phase2` arm (Step-8 ablation):
     * `blend` (default, sample-weighted) or `max` (Conservative Max-Bias). The
     * default keeps existing runs byte-for-byte unchanged.
     */
    private readonly durationBias: DurationBiasMode = "blend",
    /**
     * Softmax temperature for the `phase2` re-ranker. `undefined` → the core
     * default ({@link RERANKER_TEMPERATURE}); a tiny value recovers GREEDY
     * argmax Phase-2 (the pre-softmax behaviour, for the A/B comparison).
     */
    private readonly temperature?: number,
  ) {
    for (const name of cleanTagNames(preTags)) this.tagId(name);
  }

  /**
   * The re-ranker for THIS persona's current state. Phase-2 builds a fresh
   * {@link preferenceMatrixReRanker} from the matrix as it accumulates (so each
   * cascade sees the latest learned preference), exactly as the production
   * service would on a fresh `User` read; Phase-1 is the identity baseline.
   *
   * The base seed is the persona's userId hash (mirroring the production service
   * `phase2ReRanker`), so the SOFTMAX exploration is independent per persona but
   * stable per task — the re-ranker derives the per-task Gumbel seed from the
   * task id, so re-packs don't churn the sampled slot.
   */
  private reRanker(): SlotReRanker {
    return this.reranker === "phase2"
      ? preferenceMatrixReRanker(this.matrix, this.prefs.timezone, {
          seed: hashSeed(this.userId),
          temperature: this.temperature,
        })
      : identityReRanker;
  }

  /**
   * Phase-2 duration preprocessing: blend the per-tag bias aggregated from THIS
   * persona's telemetry so far, then ceil-correct the estimate to the grid. The
   * `identity` arm returns the estimate untouched. Pure-helper-driven
   * (`duration-bias.ts` + `eval/tag-bias.ts`), so it matches the production
   * corrector and the recovery estimator.
   */
  private correctEstimate(estimatedMin: number, tags: string[]): number {
    if (this.reranker !== "phase2" || tags.length === 0) return estimatedMin;
    const table = aggregateTagBias(
      this.events.map((e) => ({
        eventType: e.eventType,
        taskId: e.taskId,
        newSnapshot: e.newSnapshot as {
          durationMinutes?: number;
          tags?: string[];
        } | null,
      })),
    );
    const perTag = tags
      .map((t) => table.get(t))
      .filter((b): b is NonNullable<typeof b> => b !== undefined);
    if (perTag.length === 0) return estimatedMin;
    const bias =
      this.durationBias === "max" ? maxBias(perTag) : blendBias(perTag);
    return correctDuration(estimatedMin, bias);
  }

  /** All Tag rows for this user (id + name), for the bulk writer. */
  tagRows(): { id: string; name: string }[] {
    return Array.from(this.tagIdByName, ([name, id]) => ({ id, name }));
  }

  private tagId(name: string): string {
    let id = this.tagIdByName.get(name);
    if (!id) {
      id = randomUUID();
      this.tagIdByName.set(name, id);
    }
    return id;
  }

  private byId(taskId: string): SimTask | undefined {
    return this.tasks.find((t) => t.id === taskId);
  }

  private pending(): SimTask[] {
    return this.tasks.filter((t) => t.status === "PENDING");
  }

  /** EDF re-pack of every PENDING task (mirrors `cascadeReschedule`). */
  private cascade(now: Date): void {
    const pending = this.pending();
    const placements = scheduleAll(
      this.prefs,
      pending.map((t) => toEdfTask(t, this.prefs)),
      now,
      this.reRanker(),
    );
    const map = new Map(pending.map((t) => [t.id, t]));
    for (const p of placements) {
      const t = map.get(p.id);
      if (!t) continue;
      t.scheduledStartTime = p.scheduledStartTime;
      t.conflict = p.conflict;
    }
  }

  /** Occupied future intervals of OTHER placed PENDING tasks (overflow inputs). */
  private occupied(excludeId: string, now: Date): Interval[] {
    return this.pending()
      .filter((t) => t.id !== excludeId)
      .filter((t) => !isPast(t, now) || !hasElapsed(t, now))
      .map((t) => intervalOf(t))
      .filter((i): i is Interval => i !== null);
  }

  /** Feasible slots for a task (mirrors the runner's `computeFeasible`). */
  feasible(taskId: string, now: Date): Date[] {
    const task = this.byId(taskId);
    if (!task) return [];
    const occupied = this.pending()
      .filter((t) => t.id !== taskId && t.scheduledStartTime !== null)
      .map((t) => intervalOf(t))
      .filter((i): i is Interval => i !== null);
    const earliest = task.deadline
      ? undefined
      : (task.schedulingAnchor ?? undefined);
    return feasibleSlots(
      this.prefs,
      task.durationMinutes,
      task.deadline,
      occupied,
      now,
      earliest,
    );
  }

  /**
   * The Phase-2 softmax policy's first-choice propensity for `task`'s placed
   * slot — `π(scheduledStartTime | feasible set)` — mirroring the production
   * `SchedulerService.placementPropensity`. Returns `undefined` when the task is
   * unplaced or the slot fell outside the recomputed feasible set, so the CREATE
   * snapshot omits the field (matching production).
   */
  private placementPropensity(task: SimTask, now: Date): number | undefined {
    if (!task.scheduledStartTime) return undefined;
    const candidates = this.feasible(task.id, now);
    if (candidates.length === 0) return undefined;
    return this.reRanker().propensity(
      toEdfTask(task, this.prefs),
      candidates,
      task.scheduledStartTime,
    );
  }

  readTask(taskId: string): DueTask | undefined {
    const t = this.byId(taskId);
    return t
      ? {
          id: t.id,
          scheduledStartTime: t.scheduledStartTime,
          durationMinutes: t.durationMinutes,
          deadline: t.deadline,
        }
      : undefined;
  }

  /** Tag names for a task (used by task-splitting to seed the remainder task). */
  readTaskTags(taskId: string): string[] {
    return this.byId(taskId)?.tagNames ?? [];
  }

  /** PENDING tasks whose placed slot has passed by `cutoff`. */
  duePending(cutoff: Date): DueTask[] {
    return this.pending()
      .filter(
        (t) =>
          t.scheduledStartTime !== null &&
          t.scheduledStartTime.getTime() <= cutoff.getTime(),
      )
      .map((t) => ({
        id: t.id,
        scheduledStartTime: t.scheduledStartTime,
        durationMinutes: t.durationMinutes,
        deadline: t.deadline,
      }));
  }

  /** Arrival → create + EDF cascade + CREATE event. Mirrors `TasksService.create`. */
  create(
    input: CreateTaskInput,
    now: Date,
  ): {
    placedAt: Date | null;
    overflow: SchedulingOverflow | null;
    taskId: string;
  } {
    const tz = this.prefs.timezone;
    const isFixed = input.fixed ?? false;
    const overflowView = input.view ?? "day";
    const anchorDateStr = input.startDate ?? localDateStr(now, tz);

    const cleaned = cleanTagNames(input.tags ?? []);
    const tagIds = cleaned.map((n) => this.tagId(n));
    const tagNames = sortNames(cleaned);

    // Phase-2 duration preprocessing (ADR-0001 §2): bias-correct the estimate
    // BEFORE EDF sees it. The `identity` arm leaves it untouched.
    const durationMinutes = this.correctEstimate(
      input.durationMinutes,
      tagNames,
    );

    const fixedStart = isFixed
      ? minutesToUtc(anchorDateStr, input.startTime ?? 0, tz)
      : null;
    const schedulingAnchor = isFixed
      ? null
      : minutesToUtc(anchorDateStr, 0, tz);

    const task: SimTask = {
      id: randomUUID(),
      title: input.title,
      note: input.note ?? null,
      durationMinutes,
      deadline: input.deadline ? new Date(input.deadline) : null,
      fixed: isFixed,
      startTime: input.startTime ?? 0,
      status: "PENDING",
      conflict: false,
      manuallyMoved: false,
      schedulingAnchor,
      scheduledStartTime: fixedStart,
      view: isFixed ? null : overflowView,
      userId: this.userId,
      createdAt: now,
      updatedAt: now,
      tagIds,
      tagNames,
    };
    this.tasks.push(task);

    // Deadline-aware insert + cascade (the create-time EDF re-pack).
    this.cascade(now);

    // Record the stochastic logging policy's propensity for the auto-placed
    // slot (Phase-2 arm only) so the simulated telemetry carries the same
    // `propensity` field production writes — the value off-policy IPS divides by.
    const propensity =
      this.reranker === "phase2"
        ? this.placementPropensity(task, now)
        : undefined;
    this.events.push({
      eventType: "CREATE",
      oldSnapshot: null,
      newSnapshot: buildSnapshot(task, task.tagNames, undefined, propensity),
      rewardScore: EVENT_REWARD.CREATE,
      occurredAt: now,
      taskId: task.id,
      userId: this.userId,
    });

    const overflow =
      task.scheduledStartTime === null
        ? this.computeOverflow(task, overflowView, now)
        : null;
    return { placedAt: task.scheduledStartTime, overflow, taskId: task.id };
  }

  private computeOverflow(
    task: SimTask,
    view: NonNullable<CreateTaskInput["view"]>,
    now: Date,
  ): SchedulingOverflow {
    const tz = this.prefs.timezone;
    const occupied = this.occupied(task.id, now);
    const anchor =
      task.schedulingAnchor ?? minutesToUtc(localDateStr(now, tz), 0, tz);
    const { start: periodStart, end: periodEnd } = periodRange(
      anchor,
      view,
      tz,
      {
        workStart: this.prefs.workStart,
        workEnd: this.prefs.workEnd,
      },
    );
    const outside = findSlotIgnoringWorkHours(
      task.durationMinutes,
      task.deadline,
      occupied,
      now,
      periodStart,
      periodEnd,
    );
    const next = findNextAvailableSlot(
      this.prefs,
      task.durationMinutes,
      occupied,
      now,
      anchor,
      view,
    );
    return {
      outsideHours: outside
        ? { scheduledStartTime: outside.toISOString() }
        : null,
      nextAvailable: next
        ? { scheduledStartTime: next.toISOString(), granularity: view }
        : null,
    };
  }

  /** Accept a recovery option for an unplaced task. Mirrors `applyOverflowOption`. */
  resolveOverflow(
    taskId: string,
    choice: "outsideHours" | "nextAvailable",
    view: NonNullable<CreateTaskInput["view"]>,
    now: Date,
  ): boolean {
    const target = this.byId(taskId);
    if (!target || target.status !== "PENDING") return false;
    const tz = this.prefs.timezone;
    const occupied = this.occupied(taskId, now);
    const anchor =
      target.schedulingAnchor ?? minutesToUtc(localDateStr(now, tz), 0, tz);
    const { start: periodStart, end: periodEnd } = periodRange(
      anchor,
      view,
      tz,
      {
        workStart: this.prefs.workStart,
        workEnd: this.prefs.workEnd,
      },
    );
    const slot =
      choice === "outsideHours"
        ? findSlotIgnoringWorkHours(
            target.durationMinutes,
            target.deadline,
            occupied,
            now,
            periodStart,
            periodEnd,
          )
        : findNextAvailableSlot(
            this.prefs,
            target.durationMinutes,
            occupied,
            now,
            anchor,
            view,
          );
    if (!slot) return false;

    const prevStart = target.scheduledStartTime;
    const projected = this.pending().map((t) =>
      t.id === taskId ? { ...t, scheduledStartTime: slot } : t,
    );
    const conflictOf = recomputeConflicts(projected);
    for (const t of this.pending()) {
      t.conflict = conflictOf.get(t.id) ?? t.conflict;
    }
    target.scheduledStartTime = slot;
    target.fixed = true;
    target.startTime = utcToMinutes(slot, tz);

    this.events.push({
      eventType: "MOVE",
      oldSnapshot: buildSnapshot(
        {
          scheduledStartTime: prevStart,
          durationMinutes: target.durationMinutes,
        },
        target.tagNames,
        prevStart,
      ),
      newSnapshot: buildSnapshot(target, target.tagNames, prevStart),
      rewardScore: EVENT_REWARD.MOVE,
      occurredAt: now,
      taskId,
      userId: this.userId,
    });
    return true;
  }

  /** Manual drag-drop pin. Mirrors `SchedulerService.pin` (MOVE + signed matrix). */
  reschedule(taskId: string, requestedStart: Date, now: Date): void {
    const target = this.byId(taskId);
    if (!target || target.status !== "PENDING") return;
    const snapped = snapStart(requestedStart);
    const prevStart = target.scheduledStartTime;

    const projected = this.pending().map((t) =>
      t.id === taskId ? { ...t, scheduledStartTime: snapped } : t,
    );
    const conflictOf = recomputeConflicts(projected);
    for (const t of this.pending()) {
      t.conflict = conflictOf.get(t.id) ?? t.conflict;
    }
    target.scheduledStartTime = snapped;
    target.manuallyMoved = true;

    this.events.push({
      eventType: "MOVE",
      oldSnapshot: buildSnapshot(
        {
          scheduledStartTime: prevStart,
          durationMinutes: target.durationMinutes,
        },
        target.tagNames,
        prevStart,
      ),
      newSnapshot: buildSnapshot(target, target.tagNames, prevStart),
      rewardScore: EVENT_REWARD.MOVE,
      occurredAt: now,
      taskId,
      userId: this.userId,
    });

    // Signed preference update: +1 destination (move-toward), −1 vacated slot.
    const deltas: { at: Date; delta: number }[] = [{ at: snapped, delta: +1 }];
    if (prevStart && prevStart.getTime() !== snapped.getTime()) {
      deltas.push({ at: prevStart, delta: -1 });
    }
    this.matrix = applyPreferenceDeltas(
      this.matrix,
      deltas,
      this.prefs.timezone,
    );
  }

  /** Manual edge-resize. Mirrors `SchedulerService.resize` (RESIZE, no matrix). */
  resize(
    taskId: string,
    requestedStart: Date,
    durationMinutes: number,
    now: Date,
  ): void {
    const target = this.byId(taskId);
    if (!target || target.status !== "PENDING") return;
    const snappedStart = snapStart(requestedStart);
    const snappedDuration = Math.max(
      TIME_GRANULARITY,
      Math.round(durationMinutes / TIME_GRANULARITY) * TIME_GRANULARITY,
    );
    const prevStart = target.scheduledStartTime;
    const prevDur = target.durationMinutes;

    const projected = this.pending().map((t) =>
      t.id === taskId
        ? {
            ...t,
            scheduledStartTime: snappedStart,
            durationMinutes: snappedDuration,
          }
        : t,
    );
    const conflictOf = recomputeConflicts(projected);
    for (const t of this.pending()) {
      t.conflict = conflictOf.get(t.id) ?? t.conflict;
    }
    target.scheduledStartTime = snappedStart;
    target.durationMinutes = snappedDuration;
    target.manuallyMoved = true;

    this.events.push({
      eventType: "RESIZE",
      oldSnapshot: buildSnapshot(
        { scheduledStartTime: prevStart, durationMinutes: prevDur },
        target.tagNames,
        prevStart,
      ),
      newSnapshot: buildSnapshot(target, target.tagNames, prevStart),
      rewardScore: EVENT_REWARD.RESIZE,
      occurredAt: now,
      taskId,
      userId: this.userId,
    });
  }

  /** Mark a task done. Mirrors `TasksService.complete` (COMPLETE [+ KEEP] + cascade). */
  complete(taskId: string, now: Date): void {
    const target = this.byId(taskId);
    if (!target || target.status !== "PENDING") return;
    target.status = "DONE";

    this.events.push({
      eventType: "COMPLETE",
      oldSnapshot: null,
      newSnapshot: buildSnapshot(target, target.tagNames),
      rewardScore: EVENT_REWARD.COMPLETE,
      occurredAt: now,
      taskId,
      userId: this.userId,
    });

    // Positive KEEP signal when completed in the engine's suggested slot.
    if (!target.manuallyMoved && target.scheduledStartTime !== null) {
      this.events.push({
        eventType: "KEEP",
        oldSnapshot: null,
        newSnapshot: buildSnapshot(target, target.tagNames),
        rewardScore: EVENT_REWARD.KEEP,
        occurredAt: now,
        taskId,
        userId: this.userId,
      });
      this.matrix = applyPreferenceDeltas(
        this.matrix,
        [{ at: target.scheduledStartTime, delta: +1 }],
        this.prefs.timezone,
      );
    }

    // Re-settle the remaining PENDING set (the freed slot can reflow).
    this.cascade(now);
  }

  /** Abandon deadline-expired PENDING tasks. Mirrors `AbandonedTasksService.sweep`. */
  sweep(now: Date): void {
    const cutoff = now.getTime() - ABANDON_GRACE_MS;
    for (const t of this.tasks) {
      if (
        t.status === "PENDING" &&
        t.deadline !== null &&
        t.deadline.getTime() < cutoff
      ) {
        t.status = "ABANDONED";
        this.events.push({
          eventType: "ABANDON",
          oldSnapshot: null,
          newSnapshot: buildSnapshot(t, t.tagNames),
          rewardScore: EVENT_REWARD.ABANDON,
          occurredAt: now,
          taskId: t.id,
          userId: this.userId,
        });
      }
    }
  }
}
