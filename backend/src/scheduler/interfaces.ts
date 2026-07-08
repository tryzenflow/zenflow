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
  /**
   * A flexible task the user manually dragged/resized (or pinned via an
   * accepted overflow-recovery option). {@link scheduleAll} keeps its stored
   * `scheduledStartTime` and treats its slot as occupied space rather than
   * re-ordering it by deadline — the ONLY "don't move this" mechanism now that
   * fixed tasks are gone.
   */
  manuallyMoved: boolean;
  scheduledStartTime: Date | null;
  createdAt: Date;
  /**
   * The task's stored conflict flag. Used to pass a frozen past task's verdict
   * (and a manually-moved task's overlap verdict) through {@link scheduleAll}
   * untouched; defaults to false elsewhere.
   */
  conflict: boolean;
}

/**
 * Optional view-range scope for {@link scheduleAll} (the create/edit cascade).
 * When present, only non-manual tasks currently placed inside
 * `[viewStart, viewEnd)` — plus `includeTaskId` regardless of its placement —
 * are eligible to be re-positioned; everything else (out-of-range tasks, and
 * every `manuallyMoved` task) is frozen as occupied space. Omit for the
 * unscoped (full) re-pack — today's global behavior.
 */
export interface ScheduleScope {
  /** Inclusive UTC lower bound of the caller's active calendar view window. */
  viewStart: Date;
  /** Exclusive UTC upper bound of the caller's active calendar view window. */
  viewEnd: Date;
  /**
   * A task that must be treated as movable regardless of its current
   * placement (in/out of the view range, or unplaced) — the task the caller
   * is specifically trying to (re-)place, e.g. the task just created, or the
   * task under an explicit reschedule-cascade request.
   */
  includeTaskId?: string;
}

export interface Placement {
  id: string;
  scheduledStartTime: Date | null;
  conflict: boolean;
}
