import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { minutesToUtc } from "../../common/utils";
import { MAX_SCAN_DAYS } from "../constants";
import { loadDayLoad } from "./day-load";
import { bestFreeSlot, slotPreferenceScore } from "../core/slot-score";
import type {
  PlaceableTask,
  PlacementWindow,
  ScoredSlot,
} from "../types/placement.types";
import {
  addDaysStr,
  ceilToSlot,
  localDateStr,
  MS_PER_MINUTE,
  SLOT_MS,
  type Interval,
} from "../core/slot";

/** Extra hard blocks + a per-day veto for a windowed placement. */
export interface PlaceInWindowOpts {
  /** Intervals to schedule around on top of the day's own occupancy. */
  extraOccupied?: Interval[];
  /** Return `true` to skip a candidate day entirely (e.g. a per-day series cap). */
  skipDay?: (dayStr: string) => boolean;
}

/**
 * Policy A — the preference-matrix placer, restricted to placing **only the
 * session in hand**: it never repacks a day or moves another session
 * (`docs/scheduler/reranking.md`, `docs/scheduler/heuristic.md`). It is the
 * heuristic half of the LinUCB A/B experiment and the default placement path.
 *
 * The only Prisma I/O here is loading each candidate day's `occupied`
 * intervals via {@link loadDayLoad}; the scoring math is the pure
 * {@link bestFreeSlot} / {@link slotPreferenceScore} in `core/slot-score.ts`
 * (CLAUDE.md invariant 2).
 */
@Injectable()
export class HeuristicPlacer {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Place one `TASK` into its single best empty 15-minute slot anywhere in
   * `[next_15min(now), deadline]`, scored by the preference matrix (highest
   * overlap-weighted score wins; earliest start breaks ties). A slot may start
   * before a day's midnight boundary and run past it into the next morning (up
   * to the deadline). `extraOccupied` are extra hard blocks to schedule around
   * (e.g. a series' already-placed siblings). Returns `null` when nothing free
   * fits before the deadline.
   */
  async placeTask(
    userId: string,
    task: PlaceableTask,
    timezone: string,
    preferenceMatrix: number[],
    now: Date,
    extraOccupied: Interval[] = [],
  ): Promise<Date | null> {
    const next15Ms = ceilToSlot(now.getTime());
    const deadlineMs = task.deadline.getTime();
    const durationMs = task.durationMinutes * MS_PER_MINUTE;
    if (next15Ms + durationMs > deadlineMs) return null;

    const window: PlacementWindow = {
      firstDayStr: localDateStr(new Date(next15Ms), timezone),
      lastDayStr: localDateStr(new Date(deadlineMs - 1), timezone),
    };
    const best = await this.placeInWindow(
      userId,
      task,
      timezone,
      preferenceMatrix,
      now,
      window,
      { extraOccupied },
    );
    return best?.start ?? null;
  }

  /**
   * Scan a bounded local-day range and return the single best-scored free slot
   * (earliest start breaks ties), or `null`. `window` is already clamped by the
   * caller — this method scans at most {@link MAX_SCAN_DAYS} days from
   * `firstDayStr` and never past `lastDayStr`. Used directly by the series
   * placer, which clamps each member's window and vetoes full days via
   * `opts.skipDay`.
   */
  async placeInWindow(
    userId: string,
    task: PlaceableTask,
    timezone: string,
    preferenceMatrix: number[],
    now: Date,
    window: PlacementWindow,
    opts: PlaceInWindowOpts = {},
  ): Promise<ScoredSlot | null> {
    const extraOccupied = opts.extraOccupied ?? [];
    let best: ScoredSlot | null = null;
    let scanned = 0;
    for (
      let dayStr = window.firstDayStr;
      dayStr <= window.lastDayStr && scanned < MAX_SCAN_DAYS;
      dayStr = addDaysStr(dayStr, 1), scanned++
    ) {
      if (opts.skipDay?.(dayStr)) continue;
      const slot = await this.bestSlotOnDay(
        userId,
        dayStr,
        task,
        timezone,
        preferenceMatrix,
        now,
        [task.id],
        extraOccupied,
      );
      if (slot && (best === null || slot.score > best.score)) {
        best = slot;
      }
    }
    return best;
  }

  /** Best free slot on one local day, with its preference score, or `null`. */
  private async bestSlotOnDay(
    userId: string,
    dayStr: string,
    task: { durationMinutes: number; deadline: Date },
    timezone: string,
    preferenceMatrix: number[],
    now: Date,
    excludeSessionIds: string[],
    extraOccupied: Interval[],
  ): Promise<ScoredSlot | null> {
    const dayStart = minutesToUtc(dayStr, 0, timezone);
    const dayEnd = minutesToUtc(addDaysStr(dayStr, 1), 0, timezone);

    // A task may START as late as 23:45 on this day and run its full length
    // past midnight — its own deadline is the only ceiling on the end. The
    // widest that overhang can be is `duration − one slot`.
    const overhangMs = task.durationMinutes * MS_PER_MINUTE - SLOT_MS;
    const deadlineMs = task.deadline.getTime();
    const startCeil = new Date(Math.min(deadlineMs, dayEnd.getTime()));
    const fitCeil = new Date(
      Math.min(deadlineMs, dayEnd.getTime() + overhangMs),
    );

    const { occupied } = await loadDayLoad(this.prisma, {
      userId,
      dayStart,
      dayEnd,
      timezone,
      excludeSessionIds,
      // See the post-midnight blocks a straddling placement must clear.
      occupiedLookaheadMs: overhangMs,
    });

    const windowStart = now.getTime() > dayStart.getTime() ? now : dayStart;

    const slot = bestFreeSlot(
      task.durationMinutes,
      [...occupied, ...extraOccupied],
      windowStart,
      startCeil,
      preferenceMatrix,
      timezone,
      fitCeil,
    );
    if (!slot) return null;

    const score = slotPreferenceScore(
      preferenceMatrix,
      slot.getTime(),
      slot.getTime() + task.durationMinutes * MS_PER_MINUTE,
      timezone,
    );
    return { start: slot, score };
  }
}
