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
 * Optional window scope for {@link scheduleAll} (the create/edit cascade). When
 * present, only non-manual tasks currently placed inside
 * `[windowStart, windowEnd)` — plus `includeTaskId` regardless of its
 * placement — are eligible to be re-positioned; everything else (out-of-window
 * tasks, and every `manuallyMoved` task) is frozen as occupied space. Omit for
 * the unscoped (full) re-pack.
 */
export interface CascadeScope {
  /** Inclusive UTC lower bound of the cascade window. */
  windowStart: Date;
  /** Exclusive UTC upper bound of the cascade window. */
  windowEnd: Date;
  /**
   * A task that must be treated as movable regardless of its current
   * placement (in/out of the window, or unplaced) — the task the caller is
   * specifically trying to (re-)place, e.g. the task just created, or the
   * task under an explicit reschedule-cascade request.
   */
  fixedTaskId?: string;
  /**
   * When true, manually-moved tasks in scope are ALSO eligible to be
   * repositioned (the "reschedule everyone, including manually-moved tasks"
   * option — todo.md §Rescheduling Design). Defaults to false: manually-moved
   * tasks stay frozen ("reschedule only auto-scheduled tasks"). Never
   * overrides the unconditional past/in-progress freeze.
   */
  includeManual?: boolean;
}

export interface Placement {
  id: string;
  scheduledStartTime: Date | null;
  conflict: boolean;
  /**
   * Whether this placement is still anchored. Frozen tasks pass their
   * existing flag through unchanged; a task the algorithm actually
   * (re-)positioned is always `false` — once it's been repositioned by
   * explicit user choice (`includeManual: true`), it's no longer anchored.
   */
  manuallyMoved: boolean;
  /**
   * The softmax first-choice probability {@link rankCandidates} assigned to
   * the chosen slot — the TRUE logging-policy propensity, recorded for
   * IPS/SNIPS off-policy replay (docs/heuristic.md §Phase 2). Present
   * whenever the pure core actually ran the re-ranker over ≥1 candidate for
   * a placed movable task (including cold-start uniform propensity); absent
   * for frozen/unplaced tasks.
   */
  propensity?: number;
}
