import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { minutesToUtc } from "../../common/utils";
import { MAX_SCAN_DAYS, SCAN_CAP_DAYS } from "../constants";
import { loadDayLoads } from "./day-load";
import {
  bestFreeSlot,
  slotPreferenceScore,
  stabilityScore,
} from "../core/slot-score";
import { emptyWorkloadByType } from "../types/context-vector.types";
import type { DayLoad } from "../types/day-load.types";
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
  /** Max days scanned (default `MAX_SCAN_DAYS`; single-task placement passes `SCAN_CAP_DAYS`). */
  maxScanDays?: number;
  /**
   * Pre-fetched day loads keyed by local `dayStr`, covering every day this
   * call might scan. When given, the internal {@link loadDayLoads} read is
   * skipped entirely — used by `SeriesPlacer`, which fetches the union of
   * every series member's day range in one query up front (issue "batch
   * series-member scoring"). A `dayStr` missing from the map falls back to
   * an empty day (no occupancy) — callers must cover every day in the
   * scanned window. Additive/optional — single-task `placeTask` callers are
   * unaffected.
   */
  preloadedDayLoads?: Map<string, DayLoad>;
}

/**
 * FROZEN FALLBACK (ADR-0003): bug fixes only; behaviour changes belong in
 * services/bandit. (Still also the legacy-mode heuristic until phase 6.)
 *
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
      { extraOccupied, maxScanDays: SCAN_CAP_DAYS },
    );
    return best?.start ?? null;
  }

  /**
   * Scan a bounded local-day range and return the single best-scored free slot
   * (earliest start breaks ties), or `null`. `window` is already clamped by the
   * caller — this method scans at most `opts.maxScanDays` days from
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

    const dayStrs: string[] = [];
    for (
      let dayStr = window.firstDayStr;
      dayStr <= window.lastDayStr &&
      dayStrs.length < (opts.maxScanDays ?? MAX_SCAN_DAYS);
      dayStr = addDaysStr(dayStr, 1)
    ) {
      if (!opts.skipDay?.(dayStr)) dayStrs.push(dayStr);
    }
    const bounds = dayStrs.map((dayStr) => ({
      dayStr,
      dayStartMs: minutesToUtc(dayStr, 0, timezone).getTime(),
      dayEndMs: minutesToUtc(addDaysStr(dayStr, 1), 0, timezone).getTime(),
    }));
    // The task may overhang midnight by up to `duration - one slot`; one
    // batched range read covers every scanned day (issue #62 C) — unless the
    // caller already fetched the union across every series member's window
    // (issue "batch series-member scoring"), in which case we reuse that.
    const overhangMs = task.durationMinutes * MS_PER_MINUTE - SLOT_MS;
    const loads = opts.preloadedDayLoads
      ? bounds.map(
          (b): DayLoad =>
            opts.preloadedDayLoads!.get(b.dayStr) ?? {
              occupied: [],
              workloadByType: emptyWorkloadByType(),
            },
        )
      : await loadDayLoads(this.prisma, {
          userId,
          days: bounds,
          timezone,
          excludeSessionIds: [task.id],
          occupiedLookaheadMs: overhangMs,
        });

    let best: ScoredSlot | null = null;
    dayStrs.forEach((_, i) => {
      const slot = this.bestSlotOnDay(
        bounds[i],
        loads[i].occupied,
        task,
        timezone,
        preferenceMatrix,
        now,
        extraOccupied,
      );
      if (slot && (best === null || slot.score > best.score)) {
        best = slot;
      }
    });
    return best;
  }

  /** Best free slot on one local day (pure over the pre-loaded occupancy), or `null`. */
  private bestSlotOnDay(
    day: { dayStartMs: number; dayEndMs: number },
    occupied: Interval[],
    task: { durationMinutes: number; deadline: Date; prevStartMs?: number },
    timezone: string,
    preferenceMatrix: number[],
    now: Date,
    extraOccupied: Interval[],
  ): ScoredSlot | null {
    const dayStart = new Date(day.dayStartMs);
    const dayEnd = new Date(day.dayEndMs);

    // A task may START as late as 23:45 on this day and run its full length
    // past midnight — its own deadline is the only ceiling on the end. The
    // widest that overhang can be is `duration − one slot`.
    const overhangMs = task.durationMinutes * MS_PER_MINUTE - SLOT_MS;
    const deadlineMs = task.deadline.getTime();
    const startCeil = new Date(Math.min(deadlineMs, dayEnd.getTime()));
    const fitCeil = new Date(
      Math.min(deadlineMs, dayEnd.getTime() + overhangMs),
    );

    const windowStart = now.getTime() > dayStart.getTime() ? now : dayStart;

    const slot = bestFreeSlot(
      task.durationMinutes,
      [...occupied, ...extraOccupied],
      windowStart,
      startCeil,
      preferenceMatrix,
      timezone,
      fitCeil,
      task.prevStartMs,
    );
    if (!slot) return null;

    // Mirrors the total `bestFreeSlot` scored the winning slot on internally
    // (preference + stability), so cross-day comparison in `placeInWindow`
    // stays consistent with the within-day pick.
    const score =
      slotPreferenceScore(
        preferenceMatrix,
        slot.getTime(),
        slot.getTime() + task.durationMinutes * MS_PER_MINUTE,
        timezone,
      ) +
      (task.prevStartMs !== undefined
        ? stabilityScore(task.prevStartMs, slot.getTime())
        : 0);
    return { start: slot, score };
  }
}
