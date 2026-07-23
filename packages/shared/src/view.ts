/** Active calendar view; drives the scheduling horizon. */
export type ViewMode = "day" | "week" | "month";

export const VIEW_MODES: ViewMode[] = ["day", "week", "month"];

/** Atomic scheduling unit, in minutes. */
export const SLOT_MINUTES = 15;

/** Minutes in a day. */
export const DAILY_HORIZON = 1440;

/** Number of 1-hour buckets per day (preference matrix granularity): 00–01, 01–02, …, 23–24. */
export const PREFERENCE_SLOTS_PER_DAY = 24;

/**
 * Length of the flat SIGNED preference matrix: 7 days × 24 one-hour buckets
 * = 168 cells. Cells accumulate a signed score — keeps/moves-toward increment,
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

/**
 * UI-facing cap on how wide an Optimize window a user can pick (the date-range
 * picker in the Optimize popover/sheet clamps to this). Distinct from — and
 * tighter than — the backend's own hard `MAX_SCAN_DAYS` (90) ceiling, which
 * `TasksService.optimizePreview`/`optimizeApply` still enforce server-side
 * regardless of what the picker allows.
 */
export const OPTIMIZE_UI_MAX_WINDOW_DAYS = 60;

/**
 * Above this many tasks in an Optimize preview, the UI shows a one-line count
 * confirm ("Reschedule ~84 tasks in this range?") before applying — Optimize
 * never renders a per-task diff, just a count-gated confirm.
 */
export const OPTIMIZE_LARGE_BATCH_THRESHOLD = 30;
