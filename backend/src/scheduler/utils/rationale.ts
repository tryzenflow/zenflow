import {
  PREFERENCE_MATRIX_LENGTH,
  PREFERENCE_SLOTS_PER_DAY,
  type SchedulingRationale,
} from "@zenflow/shared";
import { isoWeekday, localDateStr } from "./slot";

/**
 * Pure "why this slot" summary builder (docs/heuristic.md §Phase 2 transparency
 * UI). Null on cold start (empty/wrong-length/all-zero matrix) — there's
 * nothing learned to attribute the placement to.
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

/**
 * Build a human-readable rationale for `chosenStart`, driven by the dominant
 * (highest-scoring, positive) hour-block cell on the weekday `chosenStart`
 * falls in. Returns null when the matrix is cold-start (empty, wrong length,
 * or all-zero) or when that specific weekday has no liked block yet.
 */
export function buildRationale(
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
