import {
  PREFERENCE_SLOTS_PER_DAY,
  type SchedulingRationale,
} from "@zenflow/shared";
import { preferenceIndex } from "./slot";

/**
 * PURE rationale assembly (no I/O) for the Phase-2 transparency UI. Given the
 * user's signed 168-cell preference matrix and the instant a task was placed at,
 * derive a {@link SchedulingRationale}: the cell that drove the pick, the
 * surrounding preferred work window, and a human-readable summary. Lives here —
 * not in the service — so it is trivially unit-testable and shared by every
 * placement path (schedule / reschedule / resize / resolve-overflow).
 *
 * The matrix is row-major `[day0..6][block0..23]`. A cell's score is the signed
 * telemetry tally (keeps/moves-toward +1, moves-away −1, 0 = neutral). A
 * placement is only "preference-favoured" when its own cell scores STRICTLY
 * POSITIVE — a cold-start (all-zero) matrix or a neutral/disliked slot yields
 * `null`, so the FE shows no rationale toast for placements the engine didn't
 * actually steer.
 */

const DAYS = 7;
const BLOCKS = PREFERENCE_SLOTS_PER_DAY; // 24
const MS_PER_DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

/** Minutes-from-midnight of a 15-min block index (0…95). */
function blockToMinutes(block: number): number {
  return block * (1440 / BLOCKS);
}

/** "9:00 AM"-style label for minutes-from-midnight, in 12h form. */
function fmtMinutes(min: number): string {
  const h24 = Math.floor(min / 60) % 24;
  const m = min % 60;
  const ampm = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${m.toString().padStart(2, "0")} ${ampm}`;
}

/**
 * The contiguous run of strictly-positive cells on `day` that contains `block`,
 * as a [startBlock, endBlock) half-open block range. Used to widen a single
 * driving cell into the "preferred window" the user actually favours around it.
 */
function preferredRun(
  matrix: readonly number[],
  day: number,
  block: number,
): { startBlock: number; endBlock: number } {
  const base = day * BLOCKS;
  let start = block;
  while (start - 1 >= 0 && matrix[base + start - 1] > 0) start -= 1;
  let end = block;
  while (end + 1 < BLOCKS && matrix[base + end + 1] > 0) end += 1;
  return { startBlock: start, endBlock: end + 1 };
}

/**
 * Build the rationale for placing a task at `placedAt` (a UTC instant) given the
 * user's `matrix` and `timezone`. Returns `null` when the placement wasn't
 * preference-favoured (cold-start matrix, wrong length, or a non-positive cell)
 * — the FE then shows no toast.
 *
 * `topCells` is the small set of the highest-scoring positive cells on the
 * placed day/week so the heatmap toast can highlight what drove the pick.
 */
export function buildRationale(
  matrix: readonly number[] | null | undefined,
  placedAt: Date | null,
  timezone: string,
): SchedulingRationale | null {
  if (!placedAt) return null;
  if (!matrix || matrix.length !== DAYS * BLOCKS) return null;

  const idx = preferenceIndex(placedAt, timezone);
  if (idx < 0 || idx >= matrix.length) return null;
  const score = matrix[idx];
  if (score <= 0) return null; // neutral / disliked → not engine-steered

  const day = Math.floor(idx / BLOCKS);
  const block = idx % BLOCKS;

  const run = preferredRun(matrix, day, block);
  const startMin = blockToMinutes(run.startBlock);
  const endMin = blockToMinutes(run.endBlock);

  // Top positive cells on the placed day, score-descending then earliest-first,
  // capped to a handful for the toast/heatmap highlight.
  const base = day * BLOCKS;
  const topCells = Array.from({ length: BLOCKS }, (_, b) => ({
    day,
    block: b,
    score: matrix[base + b],
  }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || a.block - b.block)
    .slice(0, 3);

  const dayName = MS_PER_DAY_NAMES[day] ?? "this day";
  const summary = `You usually keep work around ${fmtMinutes(startMin)}–${fmtMinutes(
    endMin,
  )} on ${dayName}, so it was placed there.`;

  return {
    summary,
    preferredWindow: { startMin, endMin },
    topCells,
  };
}
