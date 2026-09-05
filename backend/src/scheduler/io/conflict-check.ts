import type { PrismaService } from "../../prisma/prisma.service";
import { periodRange } from "../core/horizon";
import { MS_PER_MINUTE, overlapsAny, SLOT_MS } from "../core/slot";
import { loadDayLoad } from "./day-load";

export interface WouldConflictArgs {
  userId: string;
  timezone: string;
  /** Candidate landing's start instant. */
  start: Date;
  durationMinutes: number;
  /** Real session rows to ignore (e.g. the series' own other members). */
  excludeSessionIds?: string[];
  /** A whole recurring series to ignore (its own other occurrences). */
  excludeSeriesId?: string;
}

/**
 * `true` iff `[start, start + durationMinutes)` overlaps anything already on
 * the user's calendar that local day. The shared primitive behind every
 * `skipConflicting` check (`SeriesService.updateSiblingTimeOfDay` /
 * `updateRecurringFollowing`, and the whole-series `PATCH` exdate-pruning
 * pass in `SessionUpdateService`).
 *
 * Built directly on {@link loadDayLoad} — this file does the day-boundary
 * resolution ({@link periodRange}) and the interval check
 * ({@link overlapsAny}); no new occupancy logic is introduced.
 * `excludeSessionIds`/`excludeSeriesId` keep a series from conflicting with
 * its own (other) members/occurrences. `occupiedLookaheadMs` mirrors the
 * placers' overhang handling so a candidate landing that runs past local
 * midnight still sees the blocks it would collide with the next morning.
 */
export async function wouldConflict(
  prisma: Pick<PrismaService, "session" | "sessionSeries">,
  args: WouldConflictArgs,
): Promise<boolean> {
  const {
    userId,
    timezone,
    start,
    durationMinutes,
    excludeSessionIds,
    excludeSeriesId,
  } = args;

  const { start: dayStart, end: dayEnd } = periodRange(start, "day", timezone);
  const durationMs = durationMinutes * MS_PER_MINUTE;
  // A candidate may start late in the day and run its full length past local
  // midnight — see the post-midnight blocks it must not collide with.
  const overhangMs = Math.max(0, durationMs - SLOT_MS);

  const { occupied } = await loadDayLoad(prisma, {
    userId,
    dayStart,
    dayEnd,
    timezone,
    excludeSessionIds,
    excludeSeriesId,
    occupiedLookaheadMs: overhangMs,
  });

  const startMs = start.getTime();
  return overlapsAny(occupied, startMs, startMs + durationMs);
}
