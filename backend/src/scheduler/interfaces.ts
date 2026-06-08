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
