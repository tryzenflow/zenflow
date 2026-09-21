import { Injectable } from "@nestjs/common";
import type { User } from "../../../generated/prisma";
import { PrismaService } from "../../prisma/prisma.service";
import { wouldConflict } from "./conflict-check";
import { DisplacementService } from "./displacement.service";
import { TaskPlacementService } from "./task-placement.service";

export interface RescheduleConflictsResult {
  rescheduled: { id: string; from: Date; to: Date }[];
  failedSessionIds: string[];
}

/**
 * "Reschedule them all" for a sync-conflict notification (issue #62 D): every
 * listed task that still overlaps something is re-placed through the normal
 * placement path (heuristic/LinUCB, then B's displacement), earliest deadline
 * first. Each successful move is recorded as a scheduler-initiated
 * `SYSTEM_MOVE` (reward 0 — never a user `MOVE`). Idempotent: tasks that no
 * longer conflict are left alone; a task that cannot be moved to a
 * conflict-free slot is reported in `failedSessionIds` and stays put.
 */
@Injectable()
export class ConflictRescheduleService {
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
    const rows = await this.prisma.session.findMany({
      where: {
        id: { in: sessionIds },
        userId: user.id,
        type: "TASK",
        deadline: { not: null },
        scheduledStartTime: { not: null },
      },
      select: {
        id: true,
        durationMinutes: true,
        deadline: true,
        scheduledStartTime: true,
      },
      orderBy: { deadline: "asc" },
    });

    const result: RescheduleConflictsResult = {
      rescheduled: [],
      failedSessionIds: [],
    };
    for (const row of rows) {
      const from = row.scheduledStartTime as Date;
      const stillConflicts = await wouldConflict(this.prisma, {
        userId: user.id,
        timezone: user.timezone,
        start: from,
        durationMinutes: row.durationMinutes,
        excludeSessionIds: [row.id],
      });
      if (!stillConflicts) continue;

      const placed = await this.placement.placeOnDeadlineChange({
        user,
        task: {
          id: row.id,
          durationMinutes: row.durationMinutes,
          deadline: row.deadline as Date,
          prevStartMs: from.getTime(),
        },
        now,
      });
      const to = placed.scheduledStartTime;
      if (!to || to.getTime() === from.getTime()) {
        result.failedSessionIds.push(row.id);
        continue;
      }
      await this.displacement.applyMoves(
        user.id,
        [{ id: row.id, fromMs: from.getTime(), toMs: to.getTime() }],
        () => row.durationMinutes,
      );
      result.rescheduled.push({ id: row.id, from, to });
    }
    // Ids that vanished or were completed are simply not conflicts anymore.
    return result;
  }
}
