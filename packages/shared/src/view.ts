/** Active calendar view; drives the scheduling horizon. */
export type ViewMode = "day" | "week" | "month";

export const VIEW_MODES: ViewMode[] = ["day", "week", "month"];

/** Atomic scheduling unit, in minutes. */
export const SLOT_MINUTES = 15;

/** Minutes in a day. */
export const DAILY_HORIZON = 1440;

/** Number of 3-hour buckets per day (preference matrix granularity): 00–03, 03–06, 06–09, 09–12, 12–15, 15–18, 18–21, 21–24. */
export const PREFERENCE_SLOTS_PER_DAY = 8;

/**
 * Length of the flat SIGNED preference matrix: 7 days × 8 three-hour buckets
 * = 56 cells. Cells accumulate a signed score — keeps/moves-toward increment,
 * moves-away decrement; an empty cell sits at 0 (neutral), distinct from a
 * disliked cell.
 */
export const PREFERENCE_MATRIX_LENGTH = 7 * PREFERENCE_SLOTS_PER_DAY;

/** Time window within which the EDF engine may place a task. */
export interface SchedulingHorizon {
  /** ISO-8601 inclusive lower bound. */
  start: string;
  /** ISO-8601 exclusive upper bound. */
  end: string;
}
