/** Active calendar view; drives the scheduling horizon. */
export type ViewMode = "day" | "week" | "month";

export const VIEW_MODES: ViewMode[] = ["day", "week", "month"];

/** Atomic scheduling unit, in minutes. */
export const SLOT_MINUTES = 15;

/** Minutes in a day. */
export const DAILY_HORIZON = 1440;

/** Number of 15-minute slots per day (preference matrix granularity). */
export const PREFERENCE_SLOTS_PER_DAY = 96;

/**
 * Length of the flat SIGNED preference matrix: 7 days × 96 fifteen-minute slots
 * = 672 cells, aligned to the slot grid (not downsampled to 30 minutes). Cells
 * accumulate a signed score — keeps/moves-toward increment, moves-away
 * decrement; an empty cell sits at 0 (neutral), distinct from a disliked cell.
 */
export const PREFERENCE_MATRIX_LENGTH = 7 * PREFERENCE_SLOTS_PER_DAY;

/** Time window within which the EDF engine may place a task. */
export interface SchedulingHorizon {
  /** ISO-8601 inclusive lower bound. */
  start: string;
  /** ISO-8601 exclusive upper bound. */
  end: string;
}
