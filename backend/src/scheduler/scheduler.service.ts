import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { Prisma, type Task, type User } from "../../generated/prisma";
import {
  type OverflowGranularity,
  type SchedulingOverflow,
} from "@zenflow/shared";
import {
  type EdfTask,
  feasibleSlots,
  hasElapsed,
  intervalOf,
  isPast,
  scheduleAll,
  type ScheduleScope,
  type SchedulerPrefs,
} from "./edf";
import { hashSeed } from "./rng";
import { type Interval, SLOT_MS, localDateStr } from "./slot";
import {
  EVENT_REWARD,
  applyPreferenceDeltas,
  buildSnapshot,
  recomputeConflicts,
  toEdfTask,
} from "./telemetry";
import { findNextAvailableSlot, findSlotIgnoringWorkHours } from "./overflow";
import { periodRange } from "./horizon";
import { minutesToUtc } from "../common/utils";
import { TIME_GRANULARITY } from "../common/constants";
import { preferenceMatrixReRanker, type SlotReRanker } from "./reranker";
import { blendBias, correctDuration, type TagBias } from "./duration-bias";
import { buildRationale } from "./rationale";

/** The corrected-duration outcome assembled for the create-task response. */
export interface DurationCorrection {
  estimatedDuration: number;
  adjustedDuration: number;
  biasApplied: number;
  /** Short reason naming the driving tag(s); null when no bias applied. */
  durationReason: string | null;
}

type PrismaTx = Prisma.TransactionClient;

export interface DisplacedTask {
  taskId: string;
  newScheduledStartTime: Date | null;
}

@Injectable()
export class SchedulerService {
  constructor(private readonly prisma: PrismaService) {}

  private prefsOf(user: User): SchedulerPrefs {
    return {
      workStart: user.workStart,
      workEnd: user.workEnd,
      workDays: user.workDays,
      timezone: user.timezone,
    };
  }

  /**
   * Build the Phase-2 placement re-ranker from the user's signed 168-cell
   * (7 days × 24 one-hour buckets) float preference matrix. The pure
   * {@link preferenceMatrixReRanker} (owned by the ml-engineer) re-ranks EDF's
   * feasible slots via SOFTMAX/BOLTZMANN exploration (the Gumbel-top trick) —
   * a pure permutation with a recorded propensity, so the logging policy is
   * stochastic and off-policy IPS is well-defined (docs/heuristic.md
   * §Evaluation). A cold-start / all-equal matrix degenerates to deterministic
   * EDF earliest-fit, so a fresh user keeps byte-for-byte Phase-1 behaviour.
   *
   * Invariant #2 (refined): the core may use randomness only via an injected
   * seed. The matrix, the temperature, and the per-USER base seed are all
   * computed HERE (the service) and passed INTO the pure core; the re-ranker
   * itself derives a STABLE per-task seed from the task id (not `now`), so a
   * re-pack on an unrelated cascade doesn't churn the sampled slot.
   */
  private phase2ReRanker(user: User): SlotReRanker {
    // The pure re-ranker degrades to identity for a cold-start / all-equal
    // matrix internally, so we hand it the raw column.
    return preferenceMatrixReRanker(user.preferenceMatrix, user.timezone, {
      seed: hashSeed(user.id),
    });
  }

  /**
   * The stochastic logging policy's first-choice propensity for the slot a
   * just-created task was auto-placed into — `π(placedAt | feasible set)` under
   * the Phase-2 softmax re-ranker. Recomputes the single task's `feasibleSlots`
   * (O(one task), pure, cheap) around the OTHER pending tasks, then reads the
   * pure {@link SlotReRanker.propensity}. This is the value persisted on the
   * CREATE snapshot so off-policy IPS divides by the TRUE propensity of the
   * logged decision. Returns `null` when the task is unplaced (no decision to
   * score) or the placed slot fell outside the recomputed feasible set.
   */
  async placementPropensity(
    user: User,
    task: Task,
    tx: PrismaTx,
    now: Date = new Date(),
  ): Promise<number | null> {
    if (!task.scheduledStartTime) return null;
    const prefs = this.prefsOf(user);
    const tasks = await this.pendingTasks(user.id, tx);
    const occupied = this.occupiedIntervals(tasks, task.id, now);
    const edf = this.toEdf(task);
    const candidates = feasibleSlots(
      prefs,
      edf.durationMinutes,
      edf.deadline,
      occupied,
      now,
    );
    if (candidates.length === 0) return null;
    return this.phase2ReRanker(user).propensity(
      edf,
      candidates,
      task.scheduledStartTime,
    );
  }

  /**
   * Aggregate the per-tag duration-bias table `{ b, n }` from `TaskEvent`
   * telemetry for the given tag NAMES. `b` is the rolling mean of
   * `actual ÷ estimated` and `n` the sample count, drawn from COMPLETE/KEEP
   * events whose snapshot carries the tag (tags are captured per-event). This is
   * the I/O half of the corrector (it reads Prisma); the pure blend math lives
   * in {@link blendBias}/{@link correctDuration}. Returns one sample per tag the
   * task actually carries that has ≥1 observation; tags with no history are
   * dropped (no signal). `never` mode still calls this so the heatmap/analytics
   * learn — application is gated by the caller.
   *
   * Estimated vs actual: the CREATE event records the typed estimate; COMPLETE
   * records the duration the task was completed at. We approximate `actual` as
   * the task's duration at completion and `estimated` as its duration at create,
   * both already on the snapshot, so a resized-then-completed task contributes a
   * real ratio. Tags absent from the snapshot are skipped.
   */
  private async aggregateTagBias(
    userId: string,
    tagNames: string[],
    tx: PrismaTx,
  ): Promise<Map<string, TagBias>> {
    const wanted = new Set(tagNames.map((t) => t.trim()).filter(Boolean));
    if (wanted.size === 0) return new Map();

    // Pull the recent outcome events for this user; the per-event snapshot holds
    // the tag names + duration at the event time. We pair each COMPLETE/KEEP
    // (actual) with the matching CREATE (estimate) by task id.
    const events = await tx.taskEvent.findMany({
      where: {
        userId,
        eventType: { in: ["CREATE", "COMPLETE", "KEEP"] },
      },
      select: {
        taskId: true,
        eventType: true,
        newSnapshot: true,
      },
      orderBy: { occurredAt: "desc" },
      take: 2000,
    });

    type Snap = { durationMinutes?: number; tags?: string[] };
    const estimateByTask = new Map<string, number>();
    const outcomes: { taskId: string; duration: number; tags: string[] }[] = [];

    for (const e of events) {
      const snap = (e.newSnapshot ?? {}) as Snap;
      const dur =
        typeof snap.durationMinutes === "number" ? snap.durationMinutes : null;
      const tags = Array.isArray(snap.tags) ? snap.tags : [];
      if (dur === null) continue;
      if (e.eventType === "CREATE") {
        if (!estimateByTask.has(e.taskId)) estimateByTask.set(e.taskId, dur);
      } else {
        outcomes.push({ taskId: e.taskId, duration: dur, tags });
      }
    }

    // sum of ratios + count, per tag, over tasks we have both an estimate and an
    // outcome for. ratio = actual / estimated (>1 ⇒ tag runs long).
    const acc = new Map<string, { sum: number; n: number }>();
    for (const o of outcomes) {
      const estimated = estimateByTask.get(o.taskId);
      if (!estimated || estimated <= 0) continue;
      const ratio = o.duration / estimated;
      for (const tag of o.tags) {
        if (!wanted.has(tag)) continue;
        const cur = acc.get(tag) ?? { sum: 0, n: 0 };
        cur.sum += ratio;
        cur.n += 1;
        acc.set(tag, cur);
      }
    }

    const out = new Map<string, TagBias>();
    for (const [tag, { sum, n }] of acc) {
      if (n > 0) out.set(tag, { n, b: sum / n });
    }
    return out;
  }

  /**
   * Compute the duration correction for a task carrying `tagNames` with the
   * user's typed `estimatedDuration`. Aggregates per-tag bias from telemetry,
   * blends it (sample-weighted, via the pure {@link blendBias}) and rounds the
   * corrected duration up to the 15-min grid (pure {@link correctDuration}).
   * Returns the estimate, the corrected duration, the blended multiplier, and a
   * short human reason naming the driving tag(s) — or a 1.0 / no-reason result
   * when there's no signal. The CORRECTOR ALWAYS RUNS (so it always learns);
   * whether the corrected value is fed to EDF is gated by the user's mode at the
   * call site.
   */
  async computeDurationCorrection(
    userId: string,
    tagNames: string[],
    estimatedDuration: number,
    tx: PrismaTx,
  ): Promise<DurationCorrection> {
    const table = await this.aggregateTagBias(userId, tagNames, tx);
    const samples = [...table.values()];
    const bias = blendBias(samples);
    const adjustedDuration = correctDuration(estimatedDuration, bias);

    let durationReason: string | null = null;
    if (samples.length > 0 && adjustedDuration !== estimatedDuration) {
      // Name the tag with the most extreme multiplier as the driver.
      let driverTag: string | null = null;
      let driverB = 1;
      for (const [tag, s] of table) {
        if (Math.abs(s.b - 1) > Math.abs(driverB - 1)) {
          driverB = s.b;
          driverTag = tag;
        }
      }
      if (driverTag) {
        const pct = Math.round(Math.abs(driverB - 1) * 100);
        const dir = driverB >= 1 ? "longer" : "shorter";
        durationReason = `#${driverTag} ~${pct}% ${dir}`;
      }
    }

    return {
      estimatedDuration,
      adjustedDuration,
      biasApplied: bias,
      durationReason,
    };
  }

  /**
   * PURE-helper-backed rationale for a placement at `placedAt`, from the user's
   * matrix. Null when the placement wasn't preference-favoured (cold-start /
   * neutral slot) so the FE shows no rationale toast.
   */
  rationaleFor(user: User, placedAt: Date | null) {
    return buildRationale(user.preferenceMatrix, placedAt, user.timezone);
  }

  /**
   * Map a Prisma row to the pure-core {@link EdfTask}. Now a thin passthrough —
   * there is no more per-task creation-day anchor/period-ceiling to derive
   * (fixed tasks and `schedulingAnchor`/`view` are gone; see docs/heuristic.md).
   * Kept as a named method so call sites read the same either way.
   */
  private toEdf(task: Task): EdfTask {
    return toEdfTask(task);
  }

  /**
   * The live working set for EDF placement: PENDING tasks only. Completed
   * (`DONE`) and deadline-expired (`ABANDONED`) tasks must NEVER re-enter
   * placement — an abandoned task re-appearing in `scheduleAll`'s movable set
   * was the mechanism behind a previously-placed, unrelated task silently
   * moving/duplicating-looking after an unconnected create (todo.md bug #6).
   */
  private pendingTasks(userId: string, tx: PrismaTx) {
    return tx.task.findMany({ where: { userId, status: "PENDING" } });
  }

  /**
   * Deadline-aware (re-)placement after a flexible task is created, completed,
   * deleted, or has a confirmed deadline/tags change. Runs the EDF re-pack
   * around the anchors (manually-moved tasks, frozen past tasks, and — with a
   * `viewStart`/`viewEnd` scope — everything outside that view range) so the
   * movable set lands at its EDF rank: tasks with closer deadlines keep their
   * earlier slots and only later ones cascade. Mutates the rows; runs inside
   * the caller's transaction. Returns the tasks whose placement/conflict
   * verdict actually changed (id + new slot), so callers that need a
   * `RescheduleResponse`-shaped "displaced" list can build one directly.
   *
   * **View-scoped cascade (the blast-radius fix for todo.md bugs #1/#5).** When
   * `viewStart`/`viewEnd` are supplied, only non-manual tasks currently placed
   * inside `[viewStart, viewEnd)` — plus `includeTaskId` regardless of its
   * placement (the task the caller is specifically trying to place, e.g. a
   * just-created task or the target of an explicit reschedule-cascade request)
   * — are eligible to move; every other task (out of view, or `manuallyMoved`
   * regardless of range) is frozen as occupied space. Omitting the bounds falls
   * back to the unscoped (full) re-pack — the only remaining callers of that
   * fallback are background/no-view-context paths (e.g. a preference-change
   * recompute with no calendar view open), which is a deliberate exception, not
   * an oversight.
   *
   * Ordering is by deadline (then createdAt), floored at `now` for every
   * movable task (no more per-task creation-day anchor). A task that finds no
   * slot before its deadline is left unplaced (`scheduledStartTime: null`) and
   * flagged as a conflict.
   */
  async cascadeReschedule(
    user: User,
    tx: PrismaTx,
    now = new Date(),
    viewStart?: Date,
    viewEnd?: Date,
    includeTaskId?: string,
  ): Promise<DisplacedTask[]> {
    const tasks = await this.pendingTasks(user.id, tx);
    const prefs = this.prefsOf(user);
    const scope: ScheduleScope | undefined =
      viewStart && viewEnd ? { viewStart, viewEnd, includeTaskId } : undefined;
    // Phase-2 live wiring: re-rank EDF-feasible slots by the user's preference
    // matrix on the real (non-simulation) scheduling path. The matrix is read
    // here and passed INTO the pure core; a cold-start matrix degenerates to
    // identity, so a fresh user is byte-for-byte Phase-1.
    const placements = scheduleAll(
      prefs,
      tasks.map((t) => this.toEdf(t)),
      now,
      this.phase2ReRanker(user),
      scope,
    );
    const before = new Map(tasks.map((t) => [t.id, t]));
    const displaced: DisplacedTask[] = [];
    for (const p of placements) {
      const prev = before.get(p.id);
      if (!prev) continue;
      const unchanged =
        (prev.scheduledStartTime?.getTime() ?? null) ===
          (p.scheduledStartTime?.getTime() ?? null) &&
        prev.conflict === p.conflict;
      if (unchanged) continue;
      await tx.task.update({
        where: { id: p.id },
        data: {
          scheduledStartTime: p.scheduledStartTime,
          conflict: p.conflict,
        },
      });
      displaced.push({
        taskId: p.id,
        newScheduledStartTime: p.scheduledStartTime,
      });
    }
    return displaced;
  }

  /**
   * Full deterministic re-EDF of every PENDING task (e.g. after a work-hours /
   * preference change). Deliberately UNSCOPED (no view bounds) — a background
   * preference update has no "current calendar view" to bound the blast radius
   * to, so it falls back to the documented full-cascade exception.
   */
  async rescheduleAll(user: User, now = new Date()): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.cascadeReschedule(user, tx, now);
    });
  }

  /**
   * Occupied intervals the overflow recovery slots must avoid: every OTHER
   * PENDING task that is placed and still occupies future time (mirrors how the
   * EDF packer builds its `occupied` set). Fully-elapsed past tasks occupy no
   * future time and are excluded; the `excludeId` task itself is excluded so it
   * doesn't block its own re-placement.
   */
  private occupiedIntervals(
    tasks: Task[],
    excludeId: string,
    now: Date,
  ): Interval[] {
    return tasks
      .filter((t) => t.id !== excludeId)
      .filter((t) => !isPast(t, now) || !hasElapsed(t, now))
      .map((t) => intervalOf(t))
      .filter((i): i is Interval => i !== null);
  }

  /**
   * The anchor a task's overflow recovery options are computed relative to:
   * the start-of-day of `now`, in the user's tz. There is no more per-task
   * creation-day anchor to prefer (fixed tasks and `schedulingAnchor` are
   * gone) — every recovery option is period-relative to "today", not to the
   * exact instant `now`.
   */
  private overflowAnchor(timezone: string, now: Date): Date {
    return minutesToUtc(localDateStr(now, timezone), 0, timezone);
  }

  /**
   * Compute the two recovery options offered when the EDF engine couldn't place
   * `task` (it came back unplaced) — relative to "today"'s period (the viewed
   * day/week/month containing `now`):
   *  - `outsideHours`: earliest off-(working)-hours slot INSIDE the anchor
   *    period window `[periodStart, periodEnd)`, at/after `now`, respecting
   *    occupied and any user deadline. Null when no off-hours slot fits the
   *    period (e.g. the period has ended).
   *  - `nextAvailable`: earliest in-working-hours slot in the NEXT period after
   *    the anchor period (next day/week/month), ignoring the deadline.
   *
   * Loads the user's prefs + the other PENDING tasks' occupied intervals and
   * delegates to the pure helpers. Pure-core stays `now`+explicit-inputs driven;
   * this wrapper only does the I/O (period bounds derived from `now`).
   */
  async computeOverflowOptions(
    user: User,
    task: Task,
    view: OverflowGranularity,
    tx: PrismaTx,
    now = new Date(),
  ): Promise<SchedulingOverflow> {
    const prefs = this.prefsOf(user);
    const tasks = await this.pendingTasks(user.id, tx);
    const occupied = this.occupiedIntervals(tasks, task.id, now);

    const anchor = this.overflowAnchor(prefs.timezone, now);
    const { start: periodStart, end: periodEnd } = periodRange(
      anchor,
      view,
      prefs.timezone,
      { workStart: prefs.workStart, workEnd: prefs.workEnd },
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
      prefs,
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

  /**
   * Apply a chosen overflow recovery option to an unplaced task. The slot is
   * recomputed server-side (the client-supplied time is never trusted), the
   * task is pinned there as `manuallyMoved` (so the next
   * {@link cascadeReschedule} can't move it back into the unplaced state —
   * the same anchoring mechanism a manual drag/resize uses, now that fixed
   * tasks are gone), conflicts are recomputed pairwise, and a MOVE audit event
   * is recorded. Runs in its own transaction like the other mutations. The
   * recompute is period-relative to "today" (see {@link overflowAnchor}) so
   * the chosen slot lands in the SAME window that was offered. Throws
   * {@link BadRequestException} when the chosen option is no longer feasible
   * (recompute returns null).
   */
  async applyOverflowOption(
    user: User,
    taskId: string,
    choice: "outsideHours" | "nextAvailable",
    view: OverflowGranularity,
    now = new Date(),
  ): Promise<{ task: Task; displaced: DisplacedTask[] }> {
    return this.prisma.$transaction(async (tx) => {
      const tasks = await this.pendingTasks(user.id, tx);
      const target = tasks.find((t) => t.id === taskId);
      if (!target) throw new NotFoundException(`Cannot find task ${taskId}`);

      const prefs = this.prefsOf(user);
      const occupied = this.occupiedIntervals(tasks, taskId, now);
      const anchor = this.overflowAnchor(prefs.timezone, now);
      const { start: periodStart, end: periodEnd } = periodRange(
        anchor,
        view,
        prefs.timezone,
        { workStart: prefs.workStart, workEnd: prefs.workEnd },
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
              prefs,
              target.durationMinutes,
              occupied,
              now,
              anchor,
              view,
            );

      if (!slot) {
        throw new BadRequestException({
          success: false,
          message:
            choice === "outsideHours"
              ? "No off-hours slot is available before the deadline anymore"
              : "No slot is available in the next period anymore",
        });
      }

      // Pin via `manuallyMoved` at the recomputed slot — the same anchoring
      // mechanism a manual drag/resize uses. This makes the placement sticky:
      // scheduleAll treats it as an anchor and never re-EDFs it back to unplaced.
      const projected = tasks.map((t) =>
        t.id === taskId ? { ...t, scheduledStartTime: slot } : t,
      );
      const conflictOf = this.recomputeConflicts(projected);

      const before = new Map(tasks.map((t) => [t.id, t]));
      const displaced: DisplacedTask[] = [];
      let updatedTarget = target;

      for (const t of tasks) {
        const isTarget = t.id === taskId;
        const nextStart = isTarget ? slot : t.scheduledStartTime;
        const nextConflict = conflictOf.get(t.id) ?? t.conflict;
        const startUnchanged =
          (t.scheduledStartTime?.getTime() ?? null) ===
          (nextStart?.getTime() ?? null);
        if (startUnchanged && t.conflict === nextConflict && !isTarget)
          continue;

        const updated = await tx.task.update({
          where: { id: t.id },
          data: {
            scheduledStartTime: nextStart,
            conflict: nextConflict,
            ...(isTarget ? { manuallyMoved: true } : {}),
          },
        });
        if (isTarget) {
          updatedTarget = updated;
          const prev = before.get(t.id)!;
          const tags = await this.tagNamesOf(t.id, tx);
          await tx.taskEvent.create({
            data: {
              taskId: t.id,
              userId: user.id,
              eventType: "MOVE",
              oldSnapshot: this.snapshot(prev, tags, prev.scheduledStartTime),
              newSnapshot: this.snapshot(
                updated,
                tags,
                prev.scheduledStartTime,
              ),
              rewardScore: EVENT_REWARD.MOVE, // user accepted a recovery option
              occurredAt: now,
            },
          });
        } else {
          displaced.push({
            taskId: t.id,
            newScheduledStartTime: updated.scheduledStartTime,
          });
        }
      }

      return { task: updatedTarget, displaced };
    });
  }

  /**
   * Manual drag-drop placement. Pins `taskId` at the snapped `requestedStart`
   * exactly where the user dropped it — no cascade, nothing else moves. Any
   * resulting time overlap is allowed and surfaced as a conflict; conflicts are
   * recomputed pairwise across all pending tasks so they self-heal when a task
   * is dragged back off another. The EDF engine only runs on create/pref edits.
   *
   * Also performs a SOFT period check: if the snapped slot falls outside the
   * task's stored view-period bounds (the day/week/month it was created in) the
   * move is still committed, but `outsideViewPeriod: true` is included in the
   * return value so the caller can surface a confirmation prompt to the frontend.
   */
  async pin(
    user: User,
    taskId: string,
    requestedStart: Date,
    now: Date = new Date(),
    viewStart?: Date,
    viewEnd?: Date,
  ): Promise<{
    task: Task;
    displaced: DisplacedTask[];
    outsideViewPeriod: boolean;
  }> {
    return this.prisma.$transaction(async (tx) => {
      // Ownership check: look up the task directly (no status filter) so the
      // 404 reflects true absence/wrong-user rather than a stale PENDING-only
      // query. The original code relied on pendingTasks() — a DONE task owned by
      // this user was missing from that set, producing a spurious 404 while the
      // PATCH /tasks/:id edit endpoint (which uses findFirst with no status
      // filter) found it fine.
      const target = await tx.task.findUnique({
        where: { id: taskId, userId: user.id },
      });
      if (!target) throw new NotFoundException(`Cannot find task ${taskId}`);

      const pendingRows = await this.pendingTasks(user.id, tx);
      // Merge the target into the working set if it isn't already PENDING (e.g.
      // it's DONE). The conflict-recompute loop needs to see the dragged task so
      // its placement is updated; other non-PENDING tasks are not included (they
      // don't participate in future EDF scheduling).
      const tasks = pendingRows.some((t) => t.id === taskId)
        ? pendingRows
        : [...pendingRows, target];

      // Snap to the 15-minute grid the calendar drops onto.
      const snapped = new Date(
        Math.round(requestedStart.getTime() / SLOT_MS) * SLOT_MS,
      );

      // Soft period validation: check whether the snapped slot falls outside the
      // user's current view window. When the caller supplies explicit view bounds
      // (the frontend's currently visible day/week/month), use those directly so
      // the check reflects WHERE THE USER IS NOW, not where the task was created.
      // There is no more per-task stored creation period to fall back to (fixed
      // tasks and `schedulingAnchor`/`view` are gone), so without explicit bounds
      // there's nothing to compare against — default to false (no false
      // positives).
      const outsideViewPeriod: boolean =
        viewStart && viewEnd
          ? snapped.getTime() < viewStart.getTime() ||
            snapped.getTime() >= viewEnd.getTime()
          : false;

      // Project the move, then recompute every task's conflict from real
      // time-overlap (a placed task clashes if it overlaps another placed task).
      const projected = tasks.map((t) =>
        t.id === taskId ? { ...t, scheduledStartTime: snapped } : t,
      );
      const conflictOf = this.recomputeConflicts(projected);

      const before = new Map(tasks.map((t) => [t.id, t]));
      const displaced: DisplacedTask[] = [];
      let updatedTarget = target;

      for (const t of tasks) {
        const isTarget = t.id === taskId;
        const nextStart = isTarget ? snapped : t.scheduledStartTime;
        const nextConflict = conflictOf.get(t.id) ?? t.conflict;
        const startUnchanged =
          (t.scheduledStartTime?.getTime() ?? null) ===
          (nextStart?.getTime() ?? null);
        // The target is now anchored even if it didn't visibly move (snapped to
        // the same slot): the user's drop pins it against future EDF re-packs.
        const becomesAnchor = isTarget && !t.manuallyMoved;
        if (startUnchanged && t.conflict === nextConflict && !becomesAnchor)
          continue;

        const updated = await tx.task.update({
          where: { id: t.id },
          data: {
            scheduledStartTime: nextStart,
            conflict: nextConflict,
            ...(isTarget ? { manuallyMoved: true } : {}),
          },
        });
        if (t.id === taskId) {
          updatedTarget = updated;
          const prev = before.get(t.id)!;
          const tags = await this.tagNamesOf(t.id, tx);
          await tx.taskEvent.create({
            data: {
              taskId: t.id,
              userId: user.id,
              eventType: "MOVE",
              oldSnapshot: this.snapshot(prev, tags, prev.scheduledStartTime),
              newSnapshot: this.snapshot(
                updated,
                tags,
                prev.scheduledStartTime,
              ),
              rewardScore: EVENT_REWARD.MOVE, // user override
              occurredAt: now,
            },
          });
        } else {
          displaced.push({
            taskId: t.id,
            newScheduledStartTime: updated.scheduledStartTime,
          });
        }
      }

      // Telemetry: the user overrode the engine's choice for this slot. Signed
      // preference update — the VACATED slot is disliked (-1, move-away) and the
      // DESTINATION slot is preferred (+1, move-toward). When the task wasn't
      // placed before (no vacated slot), only the move-toward signal applies.
      const deltas: { at: Date; delta: number }[] = [
        { at: snapped, delta: +1 },
      ];
      if (
        target.scheduledStartTime &&
        target.scheduledStartTime.getTime() !== snapped.getTime()
      ) {
        deltas.push({ at: target.scheduledStartTime, delta: -1 });
      }
      await this.applyPreference(user, deltas, tx);

      return { task: updatedTarget, displaced, outsideViewPeriod };
    });
  }

  /**
   * Manual edge-resize. Pins `taskId` at the snapped start with the new
   * duration exactly as the user dragged it — no cascade, nothing else moves.
   * Conflicts are recomputed pairwise from real time-overlap across all pending
   * tasks (the new size may create or clear an overlap), mirroring {@link pin}.
   * Records a RESIZE audit event for the target.
   */
  async resize(
    user: User,
    taskId: string,
    requestedStart: Date,
    durationMinutes: number,
    now: Date = new Date(),
  ): Promise<{ task: Task; displaced: DisplacedTask[] }> {
    return this.prisma.$transaction(async (tx) => {
      const tasks = await this.pendingTasks(user.id, tx);
      const target = tasks.find((t) => t.id === taskId);
      if (!target) throw new NotFoundException(`Cannot find task ${taskId}`);

      // Snap start and duration to the 15-minute grid the calendar drops onto.
      const snappedStart = new Date(
        Math.round(requestedStart.getTime() / SLOT_MS) * SLOT_MS,
      );
      const snappedDuration = Math.max(
        TIME_GRANULARITY,
        Math.round(durationMinutes / TIME_GRANULARITY) * TIME_GRANULARITY,
      );

      // Project the resize, then recompute every task's conflict from real
      // time-overlap (a placed task clashes if it overlaps another placed task).
      const projected = tasks.map((t) =>
        t.id === taskId
          ? {
              ...t,
              scheduledStartTime: snappedStart,
              durationMinutes: snappedDuration,
            }
          : t,
      );
      const conflictOf = this.recomputeConflicts(projected);

      const before = new Map(tasks.map((t) => [t.id, t]));
      const displaced: DisplacedTask[] = [];
      let updatedTarget = target;

      for (const t of tasks) {
        const nextConflict = conflictOf.get(t.id) ?? t.conflict;
        if (t.id === taskId) {
          const updated = await tx.task.update({
            where: { id: t.id },
            data: {
              scheduledStartTime: snappedStart,
              durationMinutes: snappedDuration,
              conflict: nextConflict,
              manuallyMoved: true,
            },
          });
          updatedTarget = updated;
          const prev = before.get(t.id)!;
          const tags = await this.tagNamesOf(t.id, tx);
          await tx.taskEvent.create({
            data: {
              taskId: t.id,
              userId: user.id,
              eventType: "RESIZE",
              oldSnapshot: this.snapshot(prev, tags, prev.scheduledStartTime),
              newSnapshot: this.snapshot(
                updated,
                tags,
                prev.scheduledStartTime,
              ),
              rewardScore: EVENT_REWARD.RESIZE, // user override
              occurredAt: now,
            },
          });
        } else {
          // Only conflict can change for the others — the resize never moves them.
          if (t.conflict === nextConflict) continue;
          const updated = await tx.task.update({
            where: { id: t.id },
            data: { conflict: nextConflict },
          });
          displaced.push({
            taskId: t.id,
            newScheduledStartTime: updated.scheduledStartTime,
          });
        }
      }

      return { task: updatedTarget, displaced };
    });
  }

  /**
   * Recompute each task's conflict flag from pure time-overlap across the
   * `projected` set: a placed task clashes if it overlaps any other placed task,
   * anywhere in the window. Conflict detection is now-INDEPENDENT — elapsed,
   * in-progress, and past tasks all participate, so a manual pin/drag onto an
   * already-elapsed block surfaces a conflict and a past overlap self-heals once
   * the overlap is gone. Drives the manual {@link pin}/{@link resize} drops.
   * Placement is unaffected here (those methods only write the target's slot);
   * unplaced tasks keep the engine's verdict.
   */
  private recomputeConflicts(
    projected: {
      id: string;
      scheduledStartTime: Date | null;
      durationMinutes: number;
      conflict: boolean;
    }[],
  ): Map<string, boolean> {
    return recomputeConflicts(projected);
  }

  /**
   * Build a {@link TaskSnapshot} for a TaskEvent. Records the slot + duration,
   * plus the task's tag NAMES at event time (`tags`, captured per-event because
   * a task's tags can change later) and — on MOVE/RESIZE — the EDF-suggested
   * slot the user overrode (`suggestedStartTime`, the pre-edit
   * `scheduledStartTime`). `tags` is threaded in by the caller, which holds the
   * loaded Tag rows; the scheduler never re-queries them.
   */
  private snapshot(
    task: Task,
    tags: string[] = [],
    suggestedStartTime?: Date | null,
  ): Prisma.InputJsonValue {
    return buildSnapshot(task, tags, suggestedStartTime);
  }

  /**
   * The tag NAMES of a task, loaded fresh inside `tx` for event snapshots. Kept
   * here so the MOVE/RESIZE/overflow writers can record "tags then" without the
   * caller pre-joining them. Sorted for stable output.
   */
  private async tagNamesOf(taskId: string, tx: PrismaTx): Promise<string[]> {
    const rows = await tx.tag.findMany({
      where: { tasks: { some: { id: taskId } } },
      select: { name: true },
    });
    return rows.map((r) => r.name).sort((a, b) => a.localeCompare(b));
  }

  /**
   * Apply signed deltas to the user's 7×96 preference matrix in one update.
   * Each entry is `{ at, delta }`: a positive delta marks a liked/kept block
   * (move-toward / accepted), a negative delta a disliked block (move-away).
   * The matrix is seeded lazily to all-zero when it isn't the expected length,
   * and out-of-range indices are skipped. Transactional with the caller.
   */
  private async applyPreference(
    user: User,
    deltas: { at: Date; delta: number }[],
    tx: PrismaTx,
  ) {
    if (deltas.length === 0) return;
    const matrix = applyPreferenceDeltas(
      user.preferenceMatrix,
      deltas,
      user.timezone,
    );
    await tx.user.update({
      where: { id: user.id },
      data: { preferenceMatrix: matrix },
    });
  }

  /**
   * Record the positive KEEP signal for a task completed in the slot the engine
   * suggested (the user left the EDF placement untouched). Emits a KEEP
   * TaskEvent and increments (+1) the user's preference matrix at that slot —
   * the "prefers this interval" half of the signed matrix the heuristic spec
   * mandates (docs/heuristic.md). The caller must only invoke this when the task
   * is NOT `manuallyMoved` and has a non-null `scheduledStartTime`; `tags` are
   * the task's tag names at event time. Runs inside the caller's transaction.
   */
  async recordKeep(
    user: User,
    task: Task,
    tags: string[],
    tx: PrismaTx,
    now: Date = new Date(),
  ): Promise<void> {
    if (!task.scheduledStartTime) return;
    await tx.taskEvent.create({
      data: {
        taskId: task.id,
        userId: user.id,
        eventType: "KEEP",
        oldSnapshot: Prisma.JsonNull,
        newSnapshot: this.snapshot(task, tags),
        rewardScore: EVENT_REWARD.KEEP, // accepted-unchanged: positive placement signal
        occurredAt: now,
      },
    });
    await this.applyPreference(
      user,
      [{ at: task.scheduledStartTime, delta: +1 }],
      tx,
    );
  }
}
