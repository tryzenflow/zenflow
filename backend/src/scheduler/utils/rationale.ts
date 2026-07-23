import {
  PREFERENCE_MATRIX_LENGTH,
  PREFERENCE_SLOTS_PER_DAY,
  type SchedulingRationale,
} from "@zenflow/shared";
import { isoWeekday, localDateStr, type Interval } from "./slot";
import type { PlacementTier } from "./place";

/**
 * Pure "why this slot" summary builder (docs/heuristic.md §Phase 2 transparency
 * UI). `buildTierRationale` ALWAYS returns a non-null `SchedulingRationale` —
 * every placement (or direct manual move) now gets a one-line reason, tier-
 * aware for the automatic paths and conflict-aware for a direct drag/resize
 * that landed on an occupied slot.
 */

const DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** e.g. "3:00 PM Wed" — used by the conflict-notice / direct-move phrasing. */
function formatDayTime(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("hour")}:${get("minute")} ${get("dayPeriod")} ${get("weekday")}`;
}

/**
 * The dominant (highest-scoring, positive) hour-block cell on the weekday
 * `chosenStart` falls in, or `null` when the matrix is cold-start (empty/
 * wrong-length/all-zero) or that weekday has no liked block yet. Used by
 * `buildTierRationale`'s `tier1-preference` case; a `null` here falls back to
 * a generic preference phrase rather than ever returning null overall.
 */
function dominantCellSummary(
  chosenStart: Date,
  matrix: readonly number[],
  timezone: string,
): SchedulingRationale | null {
  const valid = matrix.length === PREFERENCE_MATRIX_LENGTH;
  if (!valid || matrix.every((v) => v === 0)) return null;

  const dateStr = localDateStr(chosenStart, timezone);
  const day = isoWeekday(dateStr) - 1; // 0=Mon … 6=Sun, matches preferenceIndex

  const dayCells: { day: number; block: number; score: number }[] = [];
  for (let block = 0; block < PREFERENCE_SLOTS_PER_DAY; block++) {
    const idx = day * PREFERENCE_SLOTS_PER_DAY + block;
    dayCells.push({ day, block, score: matrix[idx] });
  }

  const positive = dayCells.filter((c) => c.score > 0);
  if (positive.length === 0) return null; // nothing liked on this weekday

  const topCells = [...positive].sort((a, b) => b.score - a.score).slice(0, 3);
  const best = topCells[0];
  const preferredWindow = {
    startMin: best.block * 60,
    endMin: (best.block + 1) * 60,
  };

  const summary = `You usually keep tasks on ${DAY_NAMES[best.day]} around ${formatMinutes(
    preferredWindow.startMin,
  )}–${formatMinutes(preferredWindow.endMin)}.`;

  return { summary, preferredWindow, topCells };
}

/** `buildTierRationale`'s tier param — a `PlacementTier` (from a tiered
 * `placeTask` result) plus `"direct"` for a manual drag/resize's own
 * unconditional write (not tiered at all). */
export type RationaleTier = PlacementTier | "direct";

export interface TierRationaleOpts {
  /** Set when the placement lands on top of another task — produces the conflict-notice phrasing regardless of tier. */
  conflictWithTitle?: string;
  /** Set when a Tier-1 pick came from softmax exploration rather than the top-scored candidate. */
  usedExploration?: boolean;
}

/**
 * Build a human-readable "why here" rationale, tier-aware. `opts.
 * conflictWithTitle` takes priority over everything else — a drag/resize
 * landing on an occupied slot always gets the conflict-notice phrasing
 * regardless of `tier` (drag/resize don't go through the tiered placer at
 * all, so `tier` is `"direct"` for them). ALWAYS returns a non-null
 * `SchedulingRationale`.
 */
export function buildTierRationale(
  tier: RationaleTier,
  chosenInterval: Interval | null,
  matrix: readonly number[],
  timezone: string,
  opts: TierRationaleOpts = {},
): SchedulingRationale {
  if (opts.conflictWithTitle && chosenInterval) {
    return {
      summary: `Moved to ${formatDayTime(new Date(chosenInterval.start), timezone)} — overlaps with '${opts.conflictWithTitle}'.`,
    };
  }

  switch (tier) {
    case "direct":
      return chosenInterval
        ? {
            summary: `Moved to ${formatDayTime(new Date(chosenInterval.start), timezone)}.`,
          }
        : { summary: "Placement updated." };

    case "tier1-preference": {
      const pref = chosenInterval
        ? dominantCellSummary(new Date(chosenInterval.start), matrix, timezone)
        : null;
      if (!pref)
        return {
          summary: opts.usedExploration
            ? "Tried a slightly different time this time, based on your habits."
            : "Placed based on when you usually like to work.",
        };
      return opts.usedExploration
        ? {
            ...pref,
            summary: `${pref.summary} (tried something a little different this time.)`,
          }
        : pref;
    }

    case "tier1-earliest":
      return {
        summary: "Placed at the earliest available slot in your work hours.",
      };

    case "tier2":
      return {
        summary:
          "Your work hours were full, so this landed outside them to still meet the deadline.",
      };

    case "tier3":
      return {
        summary:
          "Every in-hours slot before the deadline was already taken — this is the earliest we could fit it, past the deadline.",
      };

    case "unplaced":
      return {
        summary:
          "Your calendar is fully booked — we couldn't find room for this yet.",
      };
  }
}
