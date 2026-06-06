/** Active calendar view; drives the scheduling horizon. */
export type ViewMode = "day" | "week" | "month";

export const VIEW_MODES: ViewMode[] = ["day", "week", "month"];

/** Atomic scheduling unit, in minutes. */
export const SLOT_MINUTES = 15;

/** Minutes in a day. */
export const DAILY_HORIZON = 1440;

/** Number of half-hour slots per day (penalty matrix granularity). */
export const PENALTY_SLOTS_PER_DAY = 48;

/** Length of the flat penalty matrix: 7 days × 48 half-hour slots. */
export const PENALTY_MATRIX_LENGTH = 7 * PENALTY_SLOTS_PER_DAY;

/** Time window within which the EDF engine may place a task. */
export interface SchedulingHorizon {
  /** ISO-8601 inclusive lower bound. */
  start: string;
  /** ISO-8601 exclusive upper bound. */
  end: string;
}
