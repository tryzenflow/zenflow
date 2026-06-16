/**
 * Pure, deterministic Earliest-Deadline-First scheduling core (Phase 1).
 * No I/O, no randomness — same inputs always produce the same schedule, which
 * makes this directly unit-testable. The NestJS SchedulerService wraps these
 * with persistence, audit events, and penalty-matrix telemetry.
 */

export interface SchedulerPrefs {
  workStart: number; // minutes from midnight
  workEnd: number;
  workDays: number[]; // ISO 1=Mon … 7=Sun
  timezone: string; // IANA
}

export interface EdfTask {
  id: string;
  durationMinutes: number;
  deadline: Date | null;
  fixed: boolean;
  /**
   * A flexible task the user manually dragged/resized. Anchored like {@link fixed}:
   * {@link scheduleAll} keeps its stored `scheduledStartTime` and treats its slot
   * as occupied space rather than re-ordering it by deadline.
   */
  manuallyMoved: boolean;
  /**
   * Per-task lower bound (floor) for the EDF packer: a UTC instant at the
   * start-of-day of the day the task was created from (user's tz). Consulted
   * ONLY for flexible tasks with NO deadline — they land on/after this day
   * rather than the first free slot from `now`. Deadline-bearing tasks ignore
   * it and are packed from `now` by pure EDF urgency. Null = no anchor (floor
   * collapses to `now`).
   */
  schedulingAnchor: Date | null;
  /**
   * Per-task UPPER bound (ceiling) for the EDF packer: the latest instant a
   * flexible task may be placed before. Distinct from {@link deadline} — this is
   * the END of the calendar period (day / ISO-week / month) the task was created
   * in, derived from {@link schedulingAnchor} + the stored view. Both the floor
   * ({@link schedulingAnchor}) and this ceiling apply to a no-deadline task, so
   * it lands within `[anchor, periodEnd]` and comes back unplaced (rather than
   * silently rolling into a later period) when it can't fit. Consulted ONLY when
   * the task has no user {@link deadline}; null/absent = unbounded (legacy /
   * deadline-bearing tasks). The service derives it; the pure core just reads it.
   */
  schedulingDeadline?: Date | null;
  scheduledStartTime: Date | null;
  createdAt: Date;
  /**
   * The task's stored conflict flag. Used to pass a frozen past task's verdict
   * (and a manually-moved task's overlap verdict) through {@link scheduleAll}
   * untouched; defaults to false elsewhere.
   */
  conflict: boolean;
}

export interface Placement {
  id: string;
  scheduledStartTime: Date | null;
  conflict: boolean;
}
