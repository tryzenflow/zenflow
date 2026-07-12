import { randomUUID } from "crypto";
import { Injectable } from "@nestjs/common";
import type { SchedulingRationale } from "@zenflow/shared";
import { PrismaService } from "../prisma/prisma.service";
import { Prisma, type TaskEventType } from "../../generated/prisma";
import type { EdfTask, Placement, SchedulerPrefs } from "./interfaces";
import {
  fallbackSlot,
  feasibleSlots,
  intervalOf,
  scheduleAll,
} from "./utils/edf";
import { MAX_SCAN_DAYS } from "./constants";
import { topN as rerankTopN } from "./utils/reranker";
import { buildRationale } from "./utils/rationale";
import {
  NEUTRAL_BIAS,
  blendBias,
  correctDuration,
  type TagBias,
} from "./utils/duration-bias";
import {
  EVENT_REWARD,
  applyPreferenceDeltas,
  buildSnapshot,
  recomputeConflicts,
  toEdfTask,
  type ConflictTask,
  type EdfSourceTask,
} from "./utils/telemetry";
import type { Interval } from "./utils/slot";

/** Either a live `PrismaService` or an open `$transaction` client. */
type Db = PrismaService | Prisma.TransactionClient;

/**
 * The ONLY layer that touches Prisma or writes telemetry (CLAUDE.md invariant
 * #2). Every pure scheduling decision is delegated to `edf.ts` / `reranker.ts`
 * / `rationale.ts` / `duration-bias.ts`; this service loads rows, calls the
 * pure core, diffs the result against the DB, and persists.
 */
@Injectable()
export class SchedulerService {
  constructor(private readonly prisma: PrismaService) {}

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
   * Aggregate this user's per-tag duration-bias evidence `{n, b}` from
   * COMPLETE/KEEP `TaskEvent` telemetry, pairing each outcome with its CREATE
   * estimate by taskId. Keyed by tag name so callers can attribute evidence
   * back to a specific tag. Single source of truth reused by both
   * {@link computeDurationCorrection} and `UsersService.getUserTagBias` (which
   * needs the tag names; `computeDurationCorrection` only needs the values).
   */
  async aggregateTagBias(
    userId: string,
    tags: string[],
    db: Db = this.prisma,
  ): Promise<Map<string, TagBias>> {
    if (tags.length === 0) return new Map();
    const wanted = new Set(tags);

    const events = await db.taskEvent.findMany({
      where: { userId, eventType: { in: ["CREATE", "COMPLETE", "KEEP"] } },
      select: { taskId: true, eventType: true, newSnapshot: true },
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
      const tgs = Array.isArray(snap.tags) ? snap.tags : [];
      if (dur === null) continue;
      if (e.eventType === "CREATE") {
        if (!estimateByTask.has(e.taskId)) estimateByTask.set(e.taskId, dur);
      } else {
        outcomes.push({ taskId: e.taskId, duration: dur, tags: tgs });
      }
    }

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
    return new Map(
      [...acc.entries()].map(([tag, { sum, n }]) => [tag, { n, b: sum / n }]),
    );
  }

  /**
   * ALWAYS computed (so the bias table keeps learning even in `never` mode) —
   * the CALLER decides whether to apply `adjustedDuration` based on the user's
   * `durationAdjustmentMode`.
   */
  async computeDurationCorrection(
    userId: string,
    tags: string[],
    estimatedMin: number,
    db: Db = this.prisma,
  ): Promise<{
    estimatedDuration: number;
    adjustedDuration: number;
    biasApplied: number;
    durationReason: string | null;
  }> {
    const perTag = await this.aggregateTagBias(userId, tags, db);
    const bias = blendBias([...perTag.values()]);
    const adjustedDuration = correctDuration(estimatedMin, bias);
    const durationReason =
      bias !== NEUTRAL_BIAS && tags.length > 0
        ? `#${tags[0]} ~${Math.round(Math.abs(bias - 1) * 100)}% ${
            bias > 1 ? "longer" : "shorter"
          }`
        : null;
    return {
      estimatedDuration: estimatedMin,
      adjustedDuration,
      biasApplied: bias,
      durationReason,
    };
  }

  /** This user's PENDING tasks, in the shape the pure core consumes. */
  private async loadPendingRows(
    userId: string,
    db: Db,
    ceiling: Date,
    now = new Date(),
  ): Promise<EdfSourceTask[]> {
    return db.task.findMany({
      where: {
        userId,
        status: { not: "DONE" },
        OR: [
          { scheduledStartTime: null },
          { scheduledStartTime: { gte: now, lte: ceiling } },
        ],
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
  }

  /**
   * The single cascade primitive behind every mutation: create, edit
   * (deadline/tags), drag, resize — every one of them now reoptimizes the
   * user's ENTIRE pending schedule inline, in the same transaction, rather
   * than asking for confirmation first. Loads this user's PENDING tasks (no
   * window ceiling beyond the existing {@link MAX_SCAN_DAYS} query bound —
   * there's no more window-scoped "narrow" vs. "wide" cascade, the continuous
   * cost model in `edf.ts` is what keeps an untouched schedule stable, not a
   * freeze window), runs the pure cost-aware EDF core, recomputes true
   * pairwise-overlap conflicts across the projected result, diffs against the
   * DB, and writes back every CHANGED row in one pass (including a bare
   * conflict-flag flip). Returns only the placements that actually moved or
   * lost their manual pin — what callers report as `displaced` — so a task
   * whose slot didn't change doesn't get reported as "moved to make room"
   * just because another task was dragged on/off of it.
   *
   * A fresh `batchId` is generated every call and stamped on every RESCHEDULED
   * event it writes, so {@link undoBatch} can always revert this call's
   * collateral moves — returned as `null` when nothing actually moved.
   * `opts.fixedTaskId` (optional) marks a task whose own placement decision is
   * the CALLER's to log (e.g. the just-created task's CREATE event) so it
   * isn't double-recorded here as a collateral RESCHEDULED — it's still
   * included in the returned `displaced` array; callers that don't want their
   * own task in that list filter it out themselves (see `TasksService.create`).
   */
  async reoptimize(
    userId: string,
    prefs: SchedulerPrefs,
    now: Date,
    db: Db = this.prisma,
    opts: { fixedTaskId?: string } = {},
  ): Promise<{ displaced: Placement[]; batchId: string | null }> {
    const loadCeiling = new Date(
      now.getTime() + MAX_SCAN_DAYS * 24 * 60 * 60 * 1000,
    );
    const rows = await this.loadPendingRows(userId, db, loadCeiling, now);
    const edfTasks = rows.map(toEdfTask);
    const user = await db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { preferenceMatrix: true },
    });
    const placements = scheduleAll(prefs, edfTasks, now, user.preferenceMatrix);

    const byId = new Map(rows.map((r) => [r.id, r]));
    const projected: ConflictTask[] = placements.map((p) => ({
      id: p.id,
      scheduledStartTime: p.scheduledStartTime,
      durationMinutes: byId.get(p.id)!.durationMinutes,
      conflict: p.conflict,
    }));
    const conflictOf = recomputeConflicts(projected);

    const batchId = randomUUID();
    const occurredAt = new Date();
    const events: Prisma.TaskEventCreateManyArgs["data"] = [];
    const changed: Placement[] = [];
    const writes: Placement[] = [];
    for (const p of placements) {
      const row = byId.get(p.id)!;
      const finalConflict = conflictOf.get(p.id) ?? p.conflict;
      const prevTime = row.scheduledStartTime?.getTime() ?? null;
      const nextTime = p.scheduledStartTime?.getTime() ?? null;
      const timeChanged = prevTime !== nextTime;
      const manualChanged = row.manuallyMoved !== p.manuallyMoved;
      const conflictChanged = row.conflict !== finalConflict;
      if (timeChanged || conflictChanged || manualChanged) {
        const placement: Placement = {
          id: p.id,
          scheduledStartTime: p.scheduledStartTime,
          conflict: finalConflict,
          manuallyMoved: p.manuallyMoved,
          propensity: p.propensity,
        };
        // Only report this placement to the caller (== a "displaced" entry,
        // shown to the user as "moved to make room") when the task actually
        // moved. A bare conflict-flag flip — e.g. dragging a different task
        // on/off of this one's slot — changes nothing about THIS task and
        // must still be persisted below, but surfacing it as "displaced"
        // would tell the user a task moved when it didn't.
        if (timeChanged || manualChanged) changed.push(placement);
        writes.push(placement);

        // The cost-aware core actually (re-)decided this task's placement —
        // every non-frozen, successfully-placed task always carries a
        // propensity now (the softmax mechanism runs over every candidate
        // pool, not just an in-hours tier) — log it, UNLESS it's
        // `opts.fixedTaskId`: that task's own placement decision is the
        // caller's to log (CREATE at `tasks.service.ts`) so it isn't
        // double-recorded here.
        const isCollateral = p.id !== opts.fixedTaskId;
        if (isCollateral && p.propensity !== undefined) {
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
                scheduledStartTime: p.scheduledStartTime,
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
    }
    await this.persistPlacements(db, writes);
    if (events.length > 0) await db.taskEvent.createMany({ data: events });
    return { displaced: changed, batchId: changed.length > 0 ? batchId : null };
  }

  /**
   * Write back every changed placement in ONE statement.
   *
   * A cascade can re-place every pending task in the scan horizon, and this
   * runs inside the caller's interactive transaction — which Prisma pins to a
   * single connection and serializes. Issuing `task.update` per row therefore
   * costs N sequential round trips, which is what blew the 5s transaction
   * budget in production (P2028) once a user had enough tasks to displace.
   * One `UPDATE … FROM (VALUES …)` keeps it at exactly one round trip
   * regardless of N.
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
   * Read-only dry-run of the scheduler for a not-yet-created task: never
   * writes to the DB. Builds `occupied` from the user's currently-placed
   * tasks, computes the draft task's feasible set, re-ranks it by the user's
   * preference matrix, and attaches a rationale per candidate. When Tier 1
   * (the in-hours-before-deadline feasible set) is empty, falls back to the
   * same Tier 2/3 deterministic fallback `scheduleAll` uses ({@link
   * fallbackSlot}) rather than returning zero proposals — a single
   * (un-ranked, rationale-less) proposal, since Tier 2/3 never had more than
   * one candidate to begin with.
   */
  async simulate(
    userId: string,
    prefs: SchedulerPrefs,
    draft: { durationMinutes: number; deadline: Date; tags?: string[] },
    now: Date,
    topN = 1,
  ): Promise<{
    proposals: {
      scheduledStartTime: Date;
      rationale: SchedulingRationale | null;
    }[];
  }> {
    // Tier 1 only ever needs occupied data up to `draft.deadline`, but the
    // Tier 2/3 fallback (see below) can scan well past it — load a horizon
    // that covers both, mirroring the `now + MAX_SCAN_DAYS` bound
    // `feasibleSlots`'s own no-deadline ceiling and `reoptimize`'s load use.
    const loadCeiling = new Date(
      Math.max(
        draft.deadline.getTime(),
        now.getTime() + MAX_SCAN_DAYS * 24 * 60 * 60 * 1000,
      ),
    );
    const rows = await this.loadPendingRows(
      userId,
      this.prisma,
      loadCeiling,
      now,
    );
    const occupied = rows
      .map((r) => intervalOf(toEdfTask(r)))
      .filter((iv): iv is Interval => iv !== null);

    const draftTask: EdfTask = {
      id: "__draft__",
      durationMinutes: draft.durationMinutes,
      deadline: draft.deadline,
      manuallyMoved: false,
      scheduledStartTime: null,
      createdAt: now,
      conflict: false,
    };

    const candidates = feasibleSlots(draftTask, now, prefs, occupied);
    if (candidates.length === 0) {
      const fallback = fallbackSlot(draftTask, now, occupied, prefs);
      return {
        proposals: fallback
          ? [{ scheduledStartTime: new Date(fallback.start), rationale: null }]
          : [],
      };
    }

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { preferenceMatrix: true },
    });
    const n = Math.max(1, Math.min(5, topN));
    const ranked = rerankTopN(
      candidates,
      user.preferenceMatrix,
      prefs.timezone,
      draftTask.id,
      n,
    );

    return {
      proposals: ranked.map((r) => ({
        scheduledStartTime: r.start,
        rationale: buildRationale(
          r.start,
          user.preferenceMatrix,
          prefs.timezone,
        ),
      })),
    };
  }

  /**
   * Reverts every task one `reoptimize` auto-cascade moved, restored from
   * each tagged RESCHEDULED `TaskEvent`'s `oldSnapshot`
   * (`scheduledStartTime`/`durationMinutes`) — writes every restored row in
   * ONE statement (never N sequential `task.update` calls — the same P2028
   * concern {@link persistPlacements}'s doc comment documents), then
   * re-derives true pairwise-overlap conflicts across this user's pending
   * tasks, since reverting a collateral task can reintroduce the very overlap
   * the auto-resolve had cleared. Returns `[]` (a no-op) when `batchId`
   * matches no event for this user.
   */
  async undoBatch(
    userId: string,
    batchId: string,
    db: Db = this.prisma,
  ): Promise<Placement[]> {
    const events = await db.taskEvent.findMany({
      where: { userId, batchId },
      select: { taskId: true, oldSnapshot: true },
    });
    if (events.length === 0) return [];

    interface OldSnap {
      scheduledStartTime?: string | null;
      durationMinutes?: number;
    }
    const restored = new Map<
      string,
      { scheduledStartTime: Date | null; durationMinutes: number }
    >();
    for (const e of events) {
      const snap = (e.oldSnapshot ?? {}) as OldSnap;
      if (typeof snap.durationMinutes !== "number") continue; // defensive
      restored.set(e.taskId, {
        scheduledStartTime: snap.scheduledStartTime
          ? new Date(snap.scheduledStartTime)
          : null,
        durationMinutes: snap.durationMinutes,
      });
    }
    if (restored.size === 0) return [];

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

    // Re-derive true pairwise-overlap conflicts across every PENDING task now
    // that the restore may have reintroduced an overlap the reoptimize call
    // had cleared (or cleared one it had introduced).
    const rows = await this.loadPendingRows(
      userId,
      db,
      new Date(Date.now() + MAX_SCAN_DAYS * 24 * 60 * 60 * 1000),
    );
    const projected: ConflictTask[] = rows.map((r) => ({
      id: r.id,
      scheduledStartTime: r.scheduledStartTime,
      durationMinutes: r.durationMinutes,
      conflict: r.conflict,
    }));
    const conflictOf = recomputeConflicts(projected);
    const conflictWrites: Placement[] = [];
    for (const r of rows) {
      const finalConflict = conflictOf.get(r.id) ?? r.conflict;
      if (finalConflict !== r.conflict) {
        conflictWrites.push({
          id: r.id,
          scheduledStartTime: r.scheduledStartTime,
          conflict: finalConflict,
          manuallyMoved: r.manuallyMoved,
        });
      }
    }
    await this.persistPlacements(db, conflictWrites);

    return [...restored.entries()].map(([id, r]) => ({
      id,
      scheduledStartTime: r.scheduledStartTime,
      conflict: conflictOf.get(id) ?? false,
      manuallyMoved: false,
    }));
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
      const user = await this.prisma.user.findUniqueOrThrow({
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
