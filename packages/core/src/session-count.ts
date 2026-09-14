import { MAX_TASK_SESSION_COUNT } from "./tasks";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Largest `sessionCount` that can still fit back-to-back before `deadlineISO`
 * (a multi-sitting `TASK` series) — mirrors `sessionSchema`'s feasibility
 * `superRefine` and the backend's `@IsFeasibleTaskWindow`, so nothing the
 * session-count field offers can trip that check. Returns
 * `MAX_TASK_SESSION_COUNT` when either input is missing (nothing to bound
 * against yet); `0` only when a deadline IS set and has already passed.
 *
 * `from` is the window's start — defaults to `now`. The edit-mode session-
 * count field passes an adjusted "now" (see `effectiveNowForSessionCountEdit`)
 * so the ceiling reflects capacity that's actually still open to redistribute
 * into, not the already-spoken-for day of the sitting being edited.
 */
export function maxFeasibleSessionCount(
  deadlineISO: string | undefined,
  durationMinutes: number | undefined,
  from: Date = new Date(),
): number {
  if (!deadlineISO || !durationMinutes) return MAX_TASK_SESSION_COUNT;
  const windowMs = Date.parse(deadlineISO) - from.getTime();
  if (Number.isNaN(windowMs) || windowMs <= 0) return 0;
  return Math.max(
    0,
    Math.min(
      MAX_TASK_SESSION_COUNT,
      Math.floor(windowMs / (durationMinutes * 60_000)),
    ),
  );
}

/**
 * Days from `from` (defaults to `now`) until `deadlineISO`, rounded up (at
 * least 1) — the span the series is spread across.
 */
export function daysUntilDeadline(
  deadlineISO: string | undefined,
  from: Date = new Date(),
): number {
  if (!deadlineISO) return 1;
  const ms = Date.parse(deadlineISO) - from.getTime();
  if (Number.isNaN(ms) || ms <= 0) return 1;
  return Math.max(1, Math.ceil(ms / MS_PER_DAY));
}

/**
 * The "now" the edit-mode session-count field should bound its feasible-max
 * window off, given the schedule of the specific sitting currently open in
 * the edit form. That sitting's own day is already spoken for once it's
 * started or passed, so the next slice of open capacity for
 * redistributing/adding sittings starts a day later; a sitting that hasn't
 * started yet (or isn't scheduled at all) leaves `now` untouched.
 */
export function effectiveNowForSessionCountEdit(
  instance: { scheduledStartTime: string | null; durationMinutes: number },
  now: Date = new Date(),
): Date {
  if (!instance.scheduledStartTime) return now;
  const start = Date.parse(instance.scheduledStartTime);
  if (Number.isNaN(start) || start > now.getTime()) return now;
  return new Date(now.getTime() + MS_PER_DAY);
}

/**
 * A one-line description of the resulting placement cadence for the
 * session-count field's caption. `SeriesPlacer` splits the `days`-day span
 * into `value` contiguous, non-overlapping buckets, so each sitting lands
 * somewhere inside a window roughly `days / value` days wide — that bucket
 * width, not a literal calendar pattern, is the honest number to show.
 */
export function sessionCadenceLabel(value: number, days: number): string {
  if (value <= 1) return "One session before the deadline.";
  const span = days > 0 ? days : 1;
  const gap = Math.max(1, Math.round(span / value));
  if (gap <= 1) return "One session every day until the deadline.";
  return `About every ${gap} days until the deadline.`;
}
