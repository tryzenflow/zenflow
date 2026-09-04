import { SessionType } from "../../../generated/prisma";
import type { PrismaService } from "../../prisma/prisma.service";
import {
  emptyWorkloadByType,
  WORKLOAD_TYPES,
  type WorkloadType,
} from "../types/context-vector.types";
import type { DayLoad } from "../types/day-load.types";
import { expandRrule } from "../core/recurrence";
import { DAY_MS, type Interval } from "../core/slot";

/**
 * Loads, for ONE local calendar day, everything a placer must schedule around
 * plus the per-type workload already on that day. Shared by
 * {@link HeuristicScheduleService} (uses `occupied`) and
 * {@link BanditScheduleService} (uses both).
 *
 * `occupied` = fixed sessions (`ASSIGNMENT` / `EXAM` / `LECTURE`), standalone
 * `DND`, recurring `DND` occurrences (`expandRrule`), and every other already
 * placed `TASK` — minus any `excludeSessionIds` (the rows being (re)placed).
 * A session whose interval *overlaps* `[dayStart, dayEnd)` counts, even if it
 * started the previous evening and runs past midnight into this day — the query
 * looks a day back and keeps anything still running at `dayStart`.
 *
 * `occupiedLookaheadMs` extends only the `occupied` scan past `dayEnd` (not the
 * workload accounting, which stays keyed by the session's start day) so a
 * cross-midnight placement on this day can see the next morning's blocks it
 * must not collide with. Default `0` (legacy behaviour).
 *
 * This is the only I/O in the pure-core split (CLAUDE.md invariant 2); the math
 * lives in `heuristic.ts` / `context-vector.ts` / `arms.ts`. The `DayLoad`
 * return type lives in `day-load.types.ts`.
 */
export async function loadDayLoad(
  prisma: Pick<PrismaService, "session" | "sessionSeries">,
  args: {
    userId: string;
    dayStart: Date;
    dayEnd: Date;
    timezone: string;
    excludeSessionIds?: string[];
    occupiedLookaheadMs?: number;
  },
): Promise<DayLoad> {
  const {
    userId,
    dayStart,
    dayEnd,
    timezone,
    excludeSessionIds = [],
    occupiedLookaheadMs = 0,
  } = args;
  const dayStartMs = dayStart.getTime();
  const dayEndMs = dayEnd.getTime();
  const scanEnd = new Date(dayEndMs + occupiedLookaheadMs);

  const others = await prisma.session.findMany({
    where: {
      userId,
      ...(excludeSessionIds.length ? { id: { notIn: excludeSessionIds } } : {}),
      seriesId: null,
      // A day back so a session that began the previous night and runs into
      // this day is still returned; filtered to actual overlap below.
      scheduledStartTime: { gte: new Date(dayStartMs - DAY_MS), lte: scanEnd },
    },
    select: { scheduledStartTime: true, durationMinutes: true, type: true },
  });

  const occupied: Interval[] = [];
  const workloadByType = emptyWorkloadByType();

  const addWorkload = (type: unknown, durationMinutes: number) => {
    if ((WORKLOAD_TYPES as readonly string[]).includes(type as string)) {
      const w = workloadByType[type as WorkloadType];
      w.hours += durationMinutes / 60;
      w.count += 1;
    }
  };

  for (const o of others) {
    if (!o.scheduledStartTime) continue;
    const start = o.scheduledStartTime.getTime();
    const end = start + o.durationMinutes * 60_000;
    if (end <= dayStartMs) continue; // ended before this day — a stale left-neighbour
    occupied.push({ start, end });
    // Workload is "what this calendar day carries" — key it by the start day so
    // the lookahead sliver and the previous night's spillover don't inflate it.
    if (start >= dayStartMs && start < dayEndMs) {
      addWorkload((o as { type?: unknown }).type, o.durationMinutes);
    }
  }

  // Recurring DND blocks: one representative row per series, expanded to the
  // occurrences that land on this day.
  const dndSeries = await prisma.sessionSeries.findMany({
    where: { userId, type: SessionType.DND },
    include: {
      sessions: {
        select: { scheduledStartTime: true, durationMinutes: true },
        orderBy: { createdAt: "asc" },
        take: 1,
      },
    },
  });
  for (const series of dndSeries) {
    const rep = series.sessions[0];
    if (!series.rrule || !rep?.scheduledStartTime) continue;
    for (const occStart of expandRrule(
      series.rrule,
      rep.scheduledStartTime,
      // Same day-back / lookahead window as the session query above.
      new Date(dayStartMs - DAY_MS),
      scanEnd,
      timezone,
    )) {
      const start = occStart.getTime();
      const end = start + rep.durationMinutes * 60_000;
      if (end <= dayStartMs) continue;
      occupied.push({ start, end });
      if (start < dayStartMs || start >= dayEndMs) continue;
      addWorkload(SessionType.DND, rep.durationMinutes);
    }
  }

  return { occupied, workloadByType };
}
