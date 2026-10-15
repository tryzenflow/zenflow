import { HttpException, Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "crypto";
import type { User } from "../../../generated/prisma";
import { PrismaService } from "../../prisma/prisma.service";
import { wouldConflict } from "./conflict-check";
import { DisplacementService } from "./displacement.service";
import { TaskPlacementService } from "./task-placement.service";

export interface RescheduleConflictsResult {
  rescheduled: { id: string; from: Date; to: Date }[];
  /** Still conflicting: no conflict-free slot, or `PINNED` (never moved). */
  failedSessionIds: string[];
  /** Undo handle for every move this call made. Absent when nothing moved. */
  undoGroupId?: string;
}

interface ConflictRow {
  id: string;
  seriesId: string | null;
  durationMinutes: number;
  deadline: Date;
  scheduledStartTime: Date;
  anchor: "AUTO" | "CHOSEN" | "PINNED";
}

/**
 * "Reschedule them all" for a sync-conflict notification (issue #62 D): every
 * listed task that still overlaps something is re-placed through the normal
 * placement path, earliest deadline first; `TASK` series sittings are
 * re-placed as a series to keep the per-day cap and sibling gap. Moves are recorded as
 * `SYSTEM_MOVE` under one undo group. Idempotent; unmovable tasks go to
 * `failedSessionIds`.
 *
 * The user's tap is the confirmation, so `CHOSEN` tasks re-place themselves
 * (no plan is asked). Other placements forbid moving a `CHOSEN` task
 * (ADR-0022, `chosenMoves: FORBID`), and a `PINNED` task is never moved: it
 * stays in `failedSessionIds` as a conflict.
 */
@Injectable()
export class ConflictRescheduleService {
  private readonly logger = new Logger(ConflictRescheduleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly placement: TaskPlacementService,
    private readonly displacement: DisplacementService,
  ) {}

  async rescheduleAll(
    user: User,
    sessionIds: string[],
    now: Date = new Date(),
  ): Promise<RescheduleConflictsResult> {
    const rows = (await this.prisma.session.findMany({
      where: {
        id: { in: sessionIds },
        userId: user.id,
        type: "TASK",
        deadline: { not: null },
        scheduledStartTime: { not: null },
        deleted: false,
      },
      select: {
        id: true,
        seriesId: true,
        durationMinutes: true,
        deadline: true,
        scheduledStartTime: true,
        anchor: true,
      },
      orderBy: { deadline: "asc" },
    })) as ConflictRow[];

    const result: RescheduleConflictsResult = {
      rescheduled: [],
      failedSessionIds: [],
    };
    const groupId = randomUUID();
    const conflicting: ConflictRow[] = [];
    for (const row of rows) {
      const stillConflicts = await wouldConflict(this.prisma, {
        userId: user.id,
        timezone: user.timezone,
        start: row.scheduledStartTime,
        durationMinutes: row.durationMinutes,
        excludeSessionIds: [row.id],
      });
      if (!stillConflicts) continue;
      if (row.anchor === "PINNED") {
        // Never moved: it stays a conflict for the user to resolve.
        result.failedSessionIds.push(row.id);
        continue;
      }
      conflicting.push(row);
    }

    const bySeries = new Map<string, ConflictRow[]>();
    const singles: ConflictRow[] = [];
    for (const row of conflicting) {
      if (!row.seriesId) {
        singles.push(row);
        continue;
      }
      const group = bySeries.get(row.seriesId) ?? [];
      group.push(row);
      bySeries.set(row.seriesId, group);
    }

    for (const [seriesId, group] of bySeries) {
      const ok = await this.respreadSeries(
        user,
        seriesId,
        group,
        now,
        result,
        groupId,
      );
      if (!ok) singles.push(...group);
    }
    for (const row of singles) {
      await this.placeOne(user, row, now, result, groupId);
    }
    if (result.rescheduled.length) result.undoGroupId = groupId;
    // Ids that vanished or were completed are simply not conflicts anymore.
    return result;
  }

  /**
   * Re-spread the series' upcoming sittings. `false` (nothing written) if any
   * sitting finds no slot; the caller then moves sittings one by one.
   */
  private async respreadSeries(
    user: User,
    seriesId: string,
    group: ConflictRow[],
    now: Date,
    result: RescheduleConflictsResult,
    groupId: string,
  ): Promise<boolean> {
    let plan: { id: string; from: Date | null; to: Date | null }[];
    try {
      plan = await this.placement.planSeriesRespread({
        user,
        seriesId,
        deadline: group[0].deadline,
        now,
      });
    } catch (err) {
      if (!(err instanceof HttpException)) throw err;
      this.logger.warn(
        `series ${seriesId} respread failed (${err.getStatus()}); moving sittings one by one`,
      );
      return false;
    }
    if (plan.length === 0 || plan.some((p) => p.to === null)) return false;

    const moves = plan
      .filter((p) => p.from !== null && p.to!.getTime() !== p.from.getTime())
      .map((p) => ({
        id: p.id,
        fromMs: (p.from as Date).getTime(),
        toMs: (p.to as Date).getTime(),
      }));
    // Sittings that had no start yet are simply scheduled (not a "move").
    const newlyPlaced = plan.filter((p) => p.from === null);
    if (newlyPlaced.length) {
      await this.prisma.$transaction(
        newlyPlaced.map((p) =>
          this.prisma.session.update({
            where: { id: p.id },
            data: { scheduledStartTime: p.to },
          }),
        ),
      );
    }
    const durations = await this.prisma.session.findMany({
      where: { id: { in: moves.map((m) => m.id) } },
      select: { id: true, durationMinutes: true },
    });
    const dur = new Map(durations.map((d) => [d.id, d.durationMinutes]));
    const applied = await this.displacement.applyMoves(
      user.id,
      moves,
      (id) => dur.get(id) ?? 15,
      groupId,
    );
    result.rescheduled.push(...applied);
    return true;
  }

  private async placeOne(
    user: User,
    row: ConflictRow,
    now: Date,
    result: RescheduleConflictsResult,
    groupId: string,
  ): Promise<void> {
    const from = row.scheduledStartTime;
    let to: Date | null;
    try {
      const placed = await this.placement.placeOnDeadlineChange({
        user,
        task: {
          id: row.id,
          durationMinutes: row.durationMinutes,
          deadline: row.deadline,
          prevStartMs: from.getTime(),
        },
        now,
        // It already has a start; don't move it onto another conflict.
        allowLastResort: false,
        // Only the user's own tap moves things here: a CHOSEN task is never
        // displaced by another one's placement (ADR-0022).
        chosenMoves: "FORBID",
        undoGroupId: groupId,
      });
      to = placed.scheduledStartTime;
    } catch (err) {
      if (!(err instanceof HttpException)) throw err;
      to = null;
    }
    if (!to || to.getTime() === from.getTime()) {
      // No slot: placement wrote nothing, so the task stays where it was.
      result.failedSessionIds.push(row.id);
      return;
    }
    await this.displacement.applyMoves(
      user.id,
      [{ id: row.id, fromMs: from.getTime(), toMs: to.getTime() }],
      () => row.durationMinutes,
      groupId,
    );
    result.rescheduled.push({ id: row.id, from, to });
  }
}
