import { randomUUID } from "crypto";
import { Injectable } from "@nestjs/common";
import type { SchedulingRationale } from "@zenflow/shared";
import { PrismaService } from "../prisma/prisma.service";
import { Prisma, type TaskEventType } from "../../generated/prisma";
import type { EdfTask, Placement, SchedulerPrefs } from "./interfaces";
import {
  intervalOf,
  isPast,
  placeTask,
  type PlaceTaskResult,
} from "./utils/place";
import {
  repackWindow,
  selectCandidates,
  type OptimizeMode,
} from "./utils/optimize";
import { buildTierRationale } from "./utils/rationale";
import { MAX_SCAN_DAYS } from "./constants";
import {
  EVENT_REWARD,
  applyPreferenceDeltas,
  buildSnapshot,
  overlapsAnyTask,
  toEdfTask,
  type ConflictNeighbor,
} from "./utils/telemetry";
import { MS_PER_MINUTE, type Interval } from "./utils/slot";

/** Either a live `PrismaService` or an open `$transaction` client. */
type Db = PrismaService | Prisma.TransactionClient;

/** A tiered-placer result plus its always-non-null rationale. */
export interface PlacementOutcome extends PlaceTaskResult {
  rationale: SchedulingRationale;
}

/** Result of a direct (drag/resize) write + bounded conflict recheck. */
export interface DirectPlacementResult {
  conflict: boolean;
  /** The title of a task this placement now overlaps, if any. */
  conflictWithTitle?: string;
}

export interface OptimizeWindowResult {
  /** How many movable tasks actually moved. */
  count: number;
  /** How many tasks were locked (mode `"retainManual"` only; 0 otherwise). */
  fixedCount: number;
  /** How many movable tasks were considered but left unchanged. */
  unchangedCount: number;
  /** Null on a dry run, or when nothing moved. */
  batchId: string | null;
}

/**
 * The ONLY layer that touches Prisma or writes telemetry (CLAUDE.md invariant
 * #2). Every pure scheduling decision is delegated to `utils/place.ts`
 * (single-task tiered placement), `utils/optimize.ts` (the one multi-task,
 * explicit-opt-in action), `utils/reranker.ts`, and `utils/rationale.ts`;
 * this service loads rows, calls the pure core, diffs the result against
 * the DB, and persists.
 */
@Injectable()
export class SchedulerService {
  constructor(private readonly prisma: PrismaService) {}

  /** A just-written/vacated interval is rechecked this far BEFORE its own
   * start too, so a longer-duration neighbor that starts earlier but still
   * overlaps isn't missed by the indexed range query alone. A pragmatic,
   * bounded buffer — not an exhaustive guarantee for an arbitrarily long
   * neighbor, but far short of a global scan. */
  private static readonly NEIGHBOR_LOOKBACK_MS = 24 * 60 * 60 * 1000;

  /** Map a user's schedule columns to the pure core's {@link SchedulerPrefs}. */
  prefsOf(user: {
    workStart: number;
    workEnd: number;
    workDays: number[];
    timezone: string;
  }): SchedulerPrefs {
    return {
      workStart: user.workStart,
      workEnd: user.workEnd,
      workDays: user.workDays,
      timezone: user.timezone,
    };
  }

  /**
   * The set of occupied {@link Interval}s a single-task placement search must
   * route around: every PENDING task's current slot up to `ceiling` (a Tier-1/
   * 2 deadline, or the no-deadline `MAX_SCAN_DAYS` horizon) — unplaced tasks
   * contribute nothing (no interval to occupy). `excludeTaskId` (optional)
   * leaves the task BEING placed out of its own occupied set, for
   * {@link resolveInvalidPlacement} re-placing a task that already has a
   * (stale, about-to-change) `scheduledStartTime`.
   */
  private async loadOccupied(
    userId: string,
    db: Db,
    ceiling: Date,
    excludeTaskId?: string,
  ): Promise<Interval[]> {
    const rows = await db.task.findMany({
      where: {
        userId,
        status: { not: "DONE" },
        scheduledStartTime: { not: null, lte: ceiling },
        ...(excludeTaskId ? { id: { not: excludeTaskId } } : {}),
      },
      select: { scheduledStartTime: true, durationMinutes: true },
    });
    return rows
      .map((r) => intervalOf(r))
      .filter((iv): iv is Interval => iv !== null);
  }

  private toOutcome(
    placed: PlaceTaskResult,
    matrix: readonly number[],
    timezone: string,
  ): PlacementOutcome {
    return {
      ...placed,
      rationale: buildTierRationale(
        placed.tier,
        placed.interval,
        matrix,
        timezone,
      ),
    };
  }

  /**
   * Place a BRAND-NEW task (no anchor, nothing of its own to displace) via
   * `place.ts`'s Tier1→2→3 tiered search. Used by `TasksService.create`
   * ONLY — it only ever picks an already-free slot, never touches another
   * task.
   */
  async placeNewTask(
    userId: string,
    prefs: SchedulerPrefs,
    now: Date,
    task: EdfTask,
    db: Db = this.prisma,
  ): Promise<PlacementOutcome> {
    const occupied = await this.loadOccupied(userId, db, this.scanCeiling(now));
    const user = await db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { preferenceMatrix: true },
    });
    const placed = placeTask(task, now, prefs, occupied, user.preferenceMatrix);
    return this.toOutcome(placed, user.preferenceMatrix, prefs.timezone);
  }

  /**
   * The hard upper bound ANY single-task search can ever reach — Tier 3
   * (`findNextAvailableSlot`) deliberately IGNORES a task's own deadline, so
   * the occupied set `loadOccupied` builds must cover the full
   * `MAX_SCAN_DAYS` horizon regardless of `task.deadline`, never just bounded
   * to that deadline (a tighter bound would silently omit occupied space a
   * Tier-3 fallback could still land on).
   */
  private scanCeiling(now: Date): Date {
    return new Date(now.getTime() + MAX_SCAN_DAYS * 24 * 60 * 60 * 1000);
  }

  /**
   * Re-place a task whose OWN slot was just flagged broken by an edit
   * (`TasksService.update` set `conflict: true` because the new deadline/
   * duration no longer fits the unchanged slot). Used ONLY by the explicit
   * `POST /tasks/:id/reschedule/resolve` endpoint (Edit-accept) — never
   * automatically. Runs the exact same Tier1→2→3 search `placeNewTask` uses,
   * excluding the task's OWN (stale) current slot from the occupied set so it
   * doesn't block its own re-placement.
   */
  async resolveInvalidPlacement(
    userId: string,
    prefs: SchedulerPrefs,
    now: Date,
    task: EdfTask,
    db: Db = this.prisma,
  ): Promise<PlacementOutcome> {
    const occupied = await this.loadOccupied(
      userId,
      db,
      this.scanCeiling(now),
      task.id,
    );
    const user = await db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { preferenceMatrix: true },
    });
    const placed = placeTask(task, now, prefs, occupied, user.preferenceMatrix);
    return this.toOutcome(placed, user.preferenceMatrix, prefs.timezone);
  }

  /**
   * A BOUNDED conflict recheck around a single task's just-written interval
   * (`newInterval`) and/or its just-vacated one (`oldInterval`) — ONE indexed
   * range query (`@@index([userId, scheduledStartTime])`) instead of the old
   * global `recomputeConflicts` pairwise scan over the whole pending backlog.
   * Flags fresh overlaps around `newInterval`, clears stale ones that were
   * only true because of `oldInterval`, and writes every CHANGED neighbor
   * flag in one `persistPlacements` call. Returns this task's OWN conflict
   * verdict (`false` when `newInterval` is null — nothing of its own left to
   * conflict) plus the title(s) of whatever it now overlaps, for the
   * conflict-notice rationale.
   */
  private async markConflicts(
    userId: string,
    taskId: string,
    newInterval: Interval | null,
    oldInterval: Interval | null,
    db: Db,
  ): Promise<{ selfConflict: boolean; conflictingTitles: string[] }> {
    const ranges = [newInterval, oldInterval].filter(
      (iv): iv is Interval => iv !== null,
    );
    if (ranges.length === 0)
      return { selfConflict: false, conflictingTitles: [] };

    const rangeStart = new Date(
      Math.min(...ranges.map((r) => r.start)) -
        SchedulerService.NEIGHBOR_LOOKBACK_MS,
    );
    const rangeEnd = new Date(Math.max(...ranges.map((r) => r.end)));

    const neighbors = await db.task.findMany({
      where: {
        userId,
        status: { not: "DONE" },
        id: { not: taskId },
        scheduledStartTime: { gte: rangeStart, lte: rangeEnd },
      },
      select: {
        id: true,
        title: true,
        scheduledStartTime: true,
        durationMinutes: true,
        conflict: true,
        manuallyMoved: true,
      },
    });

    const selfConflict = overlapsAnyTask(newInterval, neighbors);
    const conflictingTitles = newInterval
      ? neighbors
          .filter((n) => {
            const iv = intervalOf(n);
            return iv
              ? iv.start < newInterval.end && newInterval.start < iv.end
              : false;
          })
          .map((n) => n.title)
      : [];

    const selfAsNeighbor: ConflictNeighbor[] = newInterval
      ? [
          {
            id: taskId,
            scheduledStartTime: new Date(newInterval.start),
            durationMinutes:
              (newInterval.end - newInterval.start) / MS_PER_MINUTE,
            conflict: selfConflict,
          },
        ]
      : [];

    const writes: Placement[] = [];
    for (const n of neighbors) {
      const nIv = intervalOf(n);
      const others = neighbors.filter((o) => o.id !== n.id);
      const stillConflicts = overlapsAnyTask(nIv, [
        ...others,
        ...selfAsNeighbor,
      ]);
      if (stillConflicts !== n.conflict) {
        writes.push({
          id: n.id,
          scheduledStartTime: n.scheduledStartTime,
          conflict: stillConflicts,
          manuallyMoved: n.manuallyMoved,
        });
      }
    }
    await this.persistPlacements(db, writes);

    return { selfConflict, conflictingTitles };
  }

  /**
   * Write the user's requested interval UNCONDITIONALLY — no search, no
   * eviction. Used by `TasksService.displace`/`resize`. Runs the bounded
   * {@link markConflicts} recheck around both the new AND the task's
   * previous interval, and writes the task's own row (interval + duration +
   * `manuallyMoved: true` + the resulting `conflict` flag) in one update.
   */
  async applyDirectPlacement(
    userId: string,
    task: {
      id: string;
      scheduledStartTime: Date | null;
      durationMinutes: number;
    },
    requestedInterval: Interval,
    db: Db = this.prisma,
  ): Promise<DirectPlacementResult> {
    const oldInterval = intervalOf(task);
    const durationMinutes = Math.round(
      (requestedInterval.end - requestedInterval.start) / MS_PER_MINUTE,
    );
    const { selfConflict, conflictingTitles } = await this.markConflicts(
      userId,
      task.id,
      requestedInterval,
      oldInterval,
      db,
    );
    await db.task.update({
      where: { id: task.id },
      data: {
        scheduledStartTime: new Date(requestedInterval.start),
        durationMinutes,
        manuallyMoved: true,
        conflict: selfConflict,
      },
    });
    return { conflict: selfConflict, conflictWithTitle: conflictingTitles[0] };
  }

  /**
   * Free a task's slot (used by `TasksService.remove`/`complete` — delete
   * doesn't write the row here since it's already gone; complete just flips
   * `status`). Runs the bounded {@link markConflicts} recheck around the
   * task's now-vacated interval ONLY (no new interval), clearing any
   * neighbor's conflict flag that was only true because of this task — never
   * anything else moves.
   */
  async freeSlot(
    userId: string,
    task: {
      id: string;
      scheduledStartTime: Date | null;
      durationMinutes: number;
    },
    db: Db = this.prisma,
  ): Promise<void> {
    const oldInterval = intervalOf(task);
    if (!oldInterval) return;
    await this.markConflicts(userId, task.id, null, oldInterval, db);
  }

  /**
   * The one explicit, opt-in, multi-task action: reflow every eligible task
   * in `[windowStart, windowEnd]` per `mode` (`optimize.ts`'s
   * `selectCandidates` + `repackWindow`). Tasks already in progress/past
   * within the window are frozen (echoed as occupied space, per `place.ts`'s
   * `isPast` — never offered to the pure core). Occupied space is seeded from
   * everything OUTSIDE the window too (bounded by `MAX_SCAN_DAYS`), so a
   * repacked task never lands on top of something the window doesn't cover.
   * `opts.dryRun` (preview) only counts; a real run writes every moved
   * placement in one batch, re-derives conflict flags across the window's
   * final projected set (bounded to just this window, not the whole
   * backlog — Optimize's own explicit, opt-in batch of work), and tags one
   * fresh `batchId` (undoable via `undoBatch`).
   */
  async optimizeWindow(
    userId: string,
    prefs: SchedulerPrefs,
    now: Date,
    windowStart: Date,
    windowEnd: Date,
    mode: OptimizeMode,
    db: Db = this.prisma,
    opts: { dryRun: boolean },
  ): Promise<OptimizeWindowResult> {
    const ceiling = this.scanCeiling(now);

    const windowRows = await db.task.findMany({
      where: {
        userId,
        status: { not: "DONE" },
        scheduledStartTime: { gte: windowStart, lte: windowEnd },
      },
      select: {
        id: true,
        durationMinutes: true,
        deadline: true,
        manuallyMoved: true,
        scheduledStartTime: true,
        createdAt: true,
        conflict: true,
      },
    });

    const frozenInWindow = windowRows.filter((r) => isPast(toEdfTask(r), now));
    const candidateRows = windowRows.filter((r) => !isPast(toEdfTask(r), now));

    const outsideRows = await db.task.findMany({
      where: {
        userId,
        status: { not: "DONE" },
        scheduledStartTime: { not: null },
        OR: [
          { scheduledStartTime: { lt: windowStart } },
          { scheduledStartTime: { gt: windowEnd, lte: ceiling } },
        ],
      },
      select: { scheduledStartTime: true, durationMinutes: true },
    });

    const outsideOccupied = outsideRows
      .map((r) => intervalOf(r))
      .filter((iv): iv is Interval => iv !== null);
    const frozenOccupied = frozenInWindow
      .map((r) => intervalOf(r))
      .filter((iv): iv is Interval => iv !== null);

    const candidates = selectCandidates(candidateRows.map(toEdfTask), mode);
    const user = await db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { preferenceMatrix: true },
    });
    const placements = repackWindow(
      candidates,
      [...outsideOccupied, ...frozenOccupied],
      now,
      prefs,
      user.preferenceMatrix,
      mode,
    );

    const rowById = new Map(candidateRows.map((r) => [r.id, r]));

    interface FinalTask {
      id: string;
      scheduledStartTime: Date | null;
      durationMinutes: number;
      conflict: boolean;
      manuallyMoved: boolean;
      moved: boolean;
    }
    const finalById = new Map<string, FinalTask>();
    for (const r of frozenInWindow) finalById.set(r.id, { ...r, moved: false });
    for (const f of candidates.fixed)
      finalById.set(f.id, { ...f, moved: false });

    const occurredAt = new Date();
    const batchId = randomUUID();
    const events: Prisma.TaskEventCreateManyArgs["data"] = [];
    let changedCount = 0;
    for (const p of placements) {
      const row = rowById.get(p.id)!;
      const prevTime = row.scheduledStartTime?.getTime() ?? null;
      const nextTime = p.interval?.start ?? null;
      const moved = prevTime !== nextTime;
      if (moved) changedCount += 1;
      const nextStart = p.interval ? new Date(p.interval.start) : null;
      finalById.set(p.id, {
        id: p.id,
        scheduledStartTime: nextStart,
        durationMinutes: row.durationMinutes,
        conflict: p.interval === null,
        manuallyMoved: false,
        moved,
      });
      if (moved && p.propensity !== undefined) {
        events.push({
          taskId: p.id,
          userId,
          eventType: "RESCHEDULED",
          oldSnapshot: buildSnapshot({
            scheduledStartTime: row.scheduledStartTime,
            durationMinutes: row.durationMinutes,
          }),
          newSnapshot: buildSnapshot(
            {
              scheduledStartTime: nextStart,
              durationMinutes: row.durationMinutes,
            },
            [],
            undefined,
            p.propensity,
          ),
          rewardScore: EVENT_REWARD.RESCHEDULED,
          occurredAt,
          batchId,
        });
      }
    }

    const fixedCount = candidates.fixed.length;
    const unchangedCount = candidates.movable.length - changedCount;

    if (opts.dryRun) {
      return { count: changedCount, fixedCount, unchangedCount, batchId: null };
    }

    // Bounded (window-scoped, not global) pairwise conflict recheck across
    // the FINAL projected set. Every movable placement is already guaranteed
    // non-overlapping by construction (repackWindow never returns a
    // colliding interval), so this only ever changes a FIXED/frozen task's
    // flag — e.g. a manually-locked task whose overlapping neighbor just
    // moved out of the way.
    const finalList = [...finalById.values()];
    const writes: Placement[] = [];
    for (const t of finalList) {
      const iv = intervalOf(t);
      const conflict = iv
        ? finalList.some((o) => o.id !== t.id && overlapsAnyTask(iv, [o]))
        : true;
      if (t.moved || conflict !== t.conflict) {
        writes.push({
          id: t.id,
          scheduledStartTime: t.scheduledStartTime,
          conflict,
          manuallyMoved: t.manuallyMoved,
        });
      }
    }
    await this.persistPlacements(db, writes);
    if (events.length > 0) await db.taskEvent.createMany({ data: events });

    return {
      count: changedCount,
      fixedCount,
      unchangedCount,
      batchId: changedCount > 0 ? batchId : null,
    };
  }

  /**
   * Write back every changed placement in ONE statement.
   *
   * A batch write (`optimizeWindow`, `undoBatch`, `markConflicts`) can touch
   * several rows in the same transaction, and this runs inside the caller's
   * interactive transaction — which Prisma pins to a single connection and
   * serializes. Issuing `task.update` per row therefore costs N sequential
   * round trips, which used to blow the 5s transaction budget in production
   * (P2028) once a user had enough tasks touched at once. One
   * `UPDATE … FROM (VALUES …)` keeps it at exactly one round trip regardless
   * of N.
   *
   * `updatedAt` is set here explicitly: Prisma's `@updatedAt` is applied by the
   * client on its own generated UPDATEs, so a raw statement has to maintain the
   * column itself or the row would keep a stale timestamp.
   */
  private async persistPlacements(db: Db, writes: Placement[]): Promise<void> {
    if (writes.length === 0) return;

    const tuples = writes.map(
      (p) =>
        Prisma.sql`(${p.id}::text, ${p.scheduledStartTime}::timestamp(3), ${p.conflict}::boolean, ${p.manuallyMoved}::boolean)`,
    );

    await db.$executeRaw`
      UPDATE "Task" AS t
      SET "scheduledStartTime" = v."scheduledStartTime",
          "conflict"           = v."conflict",
          "manuallyMoved"      = v."manuallyMoved",
          "updatedAt"          = NOW()
      FROM (VALUES ${Prisma.join(tuples)})
        AS v(id, "scheduledStartTime", "conflict", "manuallyMoved")
      WHERE t.id = v.id
    `;
  }

  /**
   * Reverts every task one batch (`optimizeWindow` or
   * `resolveInvalidPlacement`) moved, restored from each tagged RESCHEDULED
   * `TaskEvent`'s `oldSnapshot` (`scheduledStartTime`/`durationMinutes`).
   *
   * Pre-flight "touched since" check: for each task tagged with `batchId`,
   * look for any LATER `TaskEvent` for that same task NOT tagged with this
   * `batchId` — i.e. the user (or another mutation) acted on it again after
   * the auto-move this undo would revert. If any row was touched since AND
   * the caller hasn't already chosen a `strategy`, nothing is written and the
   * result carries `requiresConfirmation: true` + `touchedTaskIds`; the
   * caller resubmits with `"all"` (revert everything regardless) or
   * `"excludeTouched"` (revert only the untouched rows). Re-runs the bounded
   * conflict recheck on every reverted row afterward either way.
   *
   * `found: false` only when `batchId` matches no event for this user at all
   * (a genuine 404 upstream); a batch that resolves to an empty revert set
   * (e.g. every row was touched and the caller chose `"excludeTouched"`)
   * still comes back `found: true`.
   */
  async undoBatch(
    userId: string,
    batchId: string,
    db: Db = this.prisma,
    strategy?: "all" | "excludeTouched",
  ): Promise<{
    found: boolean;
    displaced: Placement[];
    requiresConfirmation?: boolean;
    touchedTaskIds?: string[];
  }> {
    const events = await db.taskEvent.findMany({
      where: { userId, batchId },
      select: { taskId: true, oldSnapshot: true, occurredAt: true },
    });
    if (events.length === 0) return { found: false, displaced: [] };

    const batchTimeByTask = new Map<string, Date>();
    for (const e of events) {
      const existing = batchTimeByTask.get(e.taskId);
      if (!existing || e.occurredAt < existing)
        batchTimeByTask.set(e.taskId, e.occurredAt);
    }
    const taskIds = [...batchTimeByTask.keys()];

    const laterEvents = await db.taskEvent.findMany({
      where: { userId, taskId: { in: taskIds }, NOT: { batchId } },
      select: { taskId: true, occurredAt: true },
    });
    const touchedTaskIds = [
      ...new Set(
        laterEvents
          .filter((e) => e.occurredAt > batchTimeByTask.get(e.taskId)!)
          .map((e) => e.taskId),
      ),
    ];

    if (touchedTaskIds.length > 0 && strategy === undefined) {
      return {
        found: true,
        displaced: [],
        requiresConfirmation: true,
        touchedTaskIds,
      };
    }

    const idsToRevert =
      strategy === "excludeTouched"
        ? taskIds.filter((id) => !touchedTaskIds.includes(id))
        : taskIds;

    interface OldSnap {
      scheduledStartTime?: string | null;
      durationMinutes?: number;
    }
    const restored = new Map<
      string,
      { scheduledStartTime: Date | null; durationMinutes: number }
    >();
    for (const e of events) {
      if (!idsToRevert.includes(e.taskId)) continue;
      const snap = (e.oldSnapshot ?? {}) as OldSnap;
      if (typeof snap.durationMinutes !== "number") continue; // defensive
      restored.set(e.taskId, {
        scheduledStartTime: snap.scheduledStartTime
          ? new Date(snap.scheduledStartTime)
          : null,
        durationMinutes: snap.durationMinutes,
      });
    }
    if (restored.size === 0) return { found: true, displaced: [] };

    // Capture the PRE-undo placement of every reverted row (for the bounded
    // conflict recheck below) before overwriting it.
    const preUndoRows = await db.task.findMany({
      where: { userId, id: { in: [...restored.keys()] } },
      select: { id: true, scheduledStartTime: true, durationMinutes: true },
    });
    const preUndoById = new Map(preUndoRows.map((r) => [r.id, r]));

    const tuples = [...restored.entries()].map(
      ([id, r]) =>
        Prisma.sql`(${id}::text, ${r.scheduledStartTime}::timestamp(3), ${r.durationMinutes}::int)`,
    );
    await db.$executeRaw`
      UPDATE "Task" AS t
      SET "scheduledStartTime" = v."scheduledStartTime",
          "durationMinutes"    = v."durationMinutes",
          "manuallyMoved"      = false,
          "updatedAt"          = NOW()
      FROM (VALUES ${Prisma.join(tuples)})
        AS v(id, "scheduledStartTime", "durationMinutes")
      WHERE t.id = v.id
    `;

    // Bounded conflict recheck per reverted row — its restore may resolve OR
    // reveal an overlap around either its old (pre-undo) or new (restored)
    // interval.
    const conflictWrites: Placement[] = [];
    const conflictByTask = new Map<string, boolean>();
    for (const [id, r] of restored) {
      const before = preUndoById.get(id);
      const oldInterval = before
        ? intervalOf({
            scheduledStartTime: before.scheduledStartTime,
            durationMinutes: before.durationMinutes,
          })
        : null;
      const newInterval = intervalOf({
        scheduledStartTime: r.scheduledStartTime,
        durationMinutes: r.durationMinutes,
      });
      const { selfConflict } = await this.markConflicts(
        userId,
        id,
        newInterval,
        oldInterval,
        db,
      );
      conflictByTask.set(id, selfConflict);
      conflictWrites.push({
        id,
        scheduledStartTime: r.scheduledStartTime,
        conflict: selfConflict,
        manuallyMoved: false,
      });
    }
    await this.persistPlacements(db, conflictWrites);

    return {
      found: true,
      displaced: [...restored.entries()].map(([id, r]) => ({
        id,
        scheduledStartTime: r.scheduledStartTime,
        conflict: conflictByTask.get(id) ?? false,
        manuallyMoved: false,
      })),
    };
  }

  /**
   * Record a telemetry event + (for the positive placement signals) nudge the
   * user's signed preference matrix. Reused by create/complete/drag/resize
   * call sites in `TasksService`.
   */
  async recordEvent(
    userId: string,
    taskId: string,
    eventType: TaskEventType,
    task: { scheduledStartTime: Date | null; durationMinutes: number },
    opts: {
      tags?: string[];
      suggestedStartTime?: Date | null;
      propensity?: number;
      oldSnapshot?: Prisma.InputJsonValue | null;
      occurredAt?: Date;
      previousScheduledStartTime?: Date | null;
      /** Tags this event as part of an undoable multi-task batch (optimizeWindow/resolveInvalidPlacement). */
      batchId?: string | null;
    } = {},
    db: Db = this.prisma,
  ): Promise<void> {
    const reward = EVENT_REWARD[eventType];
    await db.taskEvent.create({
      data: {
        taskId,
        userId,
        eventType,
        oldSnapshot: opts.oldSnapshot ?? Prisma.JsonNull,
        newSnapshot: buildSnapshot(
          task,
          opts.tags ?? [],
          opts.suggestedStartTime,
          opts.propensity,
        ),
        rewardScore: reward,
        occurredAt: opts.occurredAt ?? new Date(),
        ...(opts.batchId ? { batchId: opts.batchId } : {}),
      },
    });

    // Nudge the preference matrix on placement-acceptance signals, OR — when a
    // real drag/resize actually moved the slot — a two-sided dislike-old /
    // prefer-new nudge (docs/heuristic.md §Signals tracked: a genuine drag is
    // TWO signals at once).
    const previous = opts.previousScheduledStartTime;
    const twoSided =
      task.scheduledStartTime !== null &&
      previous != null &&
      previous.getTime() !== task.scheduledStartTime.getTime();
    const singleSidedEligible =
      eventType === "KEEP" || eventType === "COMPLETE" || eventType === "MOVE";

    if (task.scheduledStartTime && (twoSided || singleSidedEligible)) {
      // Read the CURRENT preferenceMatrix through the SAME `db` handle the
      // write below uses — not `this.prisma` — so a caller running inside a
      // transaction reads its own transaction-local view rather than the
      // possibly-stale committed one (the confirmed read/write race this
      // redesign fixes; see scheduler.service.spec.ts's fake-Prisma upgrade).
      const user = await db.user.findUniqueOrThrow({
        where: { id: userId },
        select: { preferenceMatrix: true, timezone: true },
      });
      const deltas = twoSided
        ? [
            { at: previous, delta: -1.0 },
            { at: task.scheduledStartTime, delta: 1.0 },
          ]
        : [{ at: task.scheduledStartTime, delta: reward }];
      const updated = applyPreferenceDeltas(
        user.preferenceMatrix,
        deltas,
        user.timezone,
      );
      await db.user.update({
        where: { id: userId },
        data: { preferenceMatrix: updated },
      });
    }
  }
}
