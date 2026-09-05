import { MAX_TASK_SESSION_COUNT } from "@zenflow/core";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Largest `sessionCount` that can still fit back-to-back before
 * `deadlineISO` (issue #33) — mirrors `sessionSchema`'s feasibility
 * `superRefine` / the backend's `@IsFeasibleTaskWindow`, so nothing
 * `SessionCountField` offers can trip that check. `MAX_TASK_SESSION_COUNT`
 * when either input is missing (nothing to bound against yet); `0` only when
 * a deadline IS set and has already passed — genuinely nothing fits, which
 * the Deadline field's own error reports, not this one.
 */
export function maxFeasibleSessionCount(
  deadlineISO: string | undefined,
  durationMinutes: number | undefined,
): number {
  if (!deadlineISO || !durationMinutes) return MAX_TASK_SESSION_COUNT;
  const windowMs = Date.parse(deadlineISO) - Date.now();
  if (Number.isNaN(windowMs) || windowMs <= 0) return 0;
  return Math.max(
    0,
    Math.min(
      MAX_TASK_SESSION_COUNT,
      Math.floor(windowMs / (durationMinutes * 60_000)),
    ),
  );
}

/** Days from now until `deadlineISO`, rounded up (at least 1) — the span a
 * "N/day" chip (`SessionCountField`) spreads its sessions across. */
export function daysUntilDeadline(deadlineISO: string | undefined): number {
  if (!deadlineISO) return 1;
  const ms = Date.parse(deadlineISO) - Date.now();
  if (Number.isNaN(ms) || ms <= 0) return 1;
  return Math.max(1, Math.ceil(ms / MS_PER_DAY));
}

/**
 * A one-line description of the resulting placement cadence, for
 * `SessionCountField`'s caption. Grounded in `SeriesPlacer.placeSeries`
 * (docs/scheduler/heuristic.md → "Session series"): `seriesDayWindows` splits
 * the `days`-day span into `value` contiguous, non-overlapping buckets, so
 * each member is independently placed somewhere inside a window that's
 * roughly `days / value` days wide. That bucket width — not a literal "every
 * N days" calendar pattern, since placement within a bucket still follows
 * preference — is the one honest cadence number to show.
 */
export function sessionCadenceLabel(value: number, days: number): string {
  if (value <= 1) return "One session before the deadline.";
  const span = days > 0 ? days : 1;
  const gap = Math.max(1, Math.round(span / value));
  if (gap <= 1) return "One session every day until the deadline.";
  return `About every ${gap} days until the deadline.`;
}
