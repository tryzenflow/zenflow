import { Injectable } from "@nestjs/common";
import { MAX_SCAN_DAYS, SERIES_GAP_MINUTES } from "../constants";
import { seriesDayCap, seriesDayWindows } from "../core/series-spread";
import {
  addDaysStr,
  ceilToSlot,
  DAY_MS,
  localDateStr,
  MS_PER_MINUTE,
  type Interval,
} from "../core/slot";
import type {
  PlaceableTask,
  SeriesMemberInput,
  SeriesPlacementRow,
} from "../types/placement.types";
import { HeuristicPlacer } from "./heuristic-placer.service";

/**
 * FROZEN FALLBACK (ADR-0003): bug fixes only; behaviour changes belong in
 * services/bandit.
 *
 * The degraded-mode driver used when the Python `/v1/place` is unavailable
 * (timeout, breaker open, disabled, contract mismatch): the pre-#62 heuristic
 * only - overlap-weighted preference-matrix best-free-slot via
 * {@link HeuristicPlacer} and the frozen `core/slot.ts` / `slot-score.ts` /
 * `preference.ts` / `series-spread.ts`. It never displaces tasks, never
 * accepts conflicts, and never rolls the A/B policy. A miss is treated like a
 * Python `INFEASIBLE` (never a 503).
 */
@Injectable()
export class FallbackPlacer {
  constructor(private readonly heuristic: HeuristicPlacer) {}

  /** Best free slot for one `TASK` (`null` = nothing free before the deadline). */
  placeSingle(
    userId: string,
    task: PlaceableTask,
    timezone: string,
    preferenceMatrix: number[],
    now: Date,
  ): Promise<Date | null> {
    return this.heuristic.placeTask(
      userId,
      task,
      timezone,
      preferenceMatrix,
      now,
    );
  }

  /**
   * Heuristic-only series loop: one day-window per member, at most
   * `seriesDayCap` per day, siblings `SERIES_GAP_MINUTES` apart. Returns one row per
   * member (`null` start = no free slot before the deadline).
   */
  async placeSeries(
    userId: string,
    series: {
      members: SeriesMemberInput[];
      deadline: Date;
      fixedOccupied?: Interval[];
    },
    timezone: string,
    preferenceMatrix: number[],
    now: Date,
  ): Promise<SeriesPlacementRow[]> {
    const { members, deadline, fixedOccupied = [] } = series;
    const rows: SeriesPlacementRow[] = members.map((m) => ({
      id: m.id,
      scheduledStartTime: null,
    }));
    const next15Ms = ceilToSlot(now.getTime());
    if (members.length === 0 || next15Ms >= deadline.getTime()) return rows;

    const startDayStr = localDateStr(new Date(next15Ms), timezone);
    const daySpan = Math.min(
      Math.floor((deadline.getTime() - next15Ms) / DAY_MS),
      MAX_SCAN_DAYS - 1,
    );
    const windows = seriesDayWindows(daySpan, members.length);
    // Siblings block their slot plus the series gap on each side.
    const gapMs = SERIES_GAP_MINUTES * MS_PER_MINUTE;
    const block = (iv: Interval): Interval => ({
      start: iv.start - gapMs,
      end: iv.end + gapMs,
    });
    const siblings: Interval[] = fixedOccupied.map(block);
    const countByDay = new Map<string, number>();
    // Already-placed siblings count toward the per-day cap too.
    for (const iv of fixedOccupied) {
      const d = localDateStr(new Date(iv.start), timezone);
      countByDay.set(d, (countByDay.get(d) ?? 0) + 1);
    }
    const dayCap = seriesDayCap(daySpan, members.length);
    const capped = (d: string) => (countByDay.get(d) ?? 0) >= dayCap;
    const fullRange = { lo: 0, hi: daySpan };

    // Pass 0: own bucket. Pass 1: whole `now … deadline` range, capped per day.
    // Pass 2: no per-day cap.
    const passes: {
      range: (i: number) => { lo: number; hi: number };
      skipDay?: (d: string) => boolean;
    }[] = [
      {
        range: (i) => ({ lo: windows[i][0], hi: windows[i][1] }),
        skipDay: capped,
      },
      { range: () => fullRange, skipDay: capped },
      { range: () => fullRange },
    ];

    for (const pass of passes) {
      for (let i = 0; i < members.length; i++) {
        if (rows[i].scheduledStartTime) continue;
        const m = members[i];
        if (next15Ms + m.durationMinutes * MS_PER_MINUTE > deadline.getTime()) {
          continue;
        }
        const { lo, hi } = pass.range(i);
        const slot = await this.heuristic.placeInWindow(
          userId,
          { id: m.id, durationMinutes: m.durationMinutes, deadline },
          timezone,
          preferenceMatrix,
          now,
          {
            firstDayStr: addDaysStr(startDayStr, lo),
            lastDayStr: addDaysStr(startDayStr, hi),
          },
          { extraOccupied: [...siblings], skipDay: pass.skipDay },
        );
        if (!slot) continue;
        rows[i].scheduledStartTime = slot.start;
        const startMs = slot.start.getTime();
        siblings.push(
          block({
            start: startMs,
            end: startMs + m.durationMinutes * MS_PER_MINUTE,
          }),
        );
        const day = localDateStr(slot.start, timezone);
        countByDay.set(day, (countByDay.get(day) ?? 0) + 1);
      }
      if (rows.every((r) => r.scheduledStartTime)) break;
    }
    return rows;
  }
}
