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
   * True when the task was manually dragged/resized (or pinned via an
   * accepted overflow-recovery option). PURELY INFORMATIONAL now — the
   * continuous cost model ({@link "./utils/edf".placementCost}) replaced the
   * old hard freeze this flag used to drive. `scheduleAll` never reads it to
   * decide what can move; every task's tolerance for being repositioned comes
   * from how far in the future its current `scheduledStartTime` (its
   * "anchor") sits, not from whether a human placed it there. The flag still
   * gets SET on a real drag/resize (`TasksService.displace`/`resize`) and is
   * surfaced to the frontend for the "Manually placed" badge/telemetry.
   */
  manuallyMoved: boolean;
  scheduledStartTime: Date | null;
  createdAt: Date;
  /**
   * The task's stored conflict flag. Used to pass a frozen past task's
   * verdict through {@link scheduleAll} untouched; defaults to false
   * elsewhere.
   */
  conflict: boolean;
}

export interface Placement {
  id: string;
  scheduledStartTime: Date | null;
  conflict: boolean;
  /**
   * Whether this placement is still the user's manual pin. A frozen (past)
   * task passes its existing flag through unchanged. For every other task:
   * true when the algorithm left it exactly where it already was (whatever
   * that flag's value was — an untouched auto-placement stays `false`, an
   * untouched drag stays `true`); false once the algorithm actually
   * relocated it to a different slot — it's no longer at the spot the user
   * (or a prior auto-placement) chose.
   */
  manuallyMoved: boolean;
  /**
   * The softmax first-choice probability {@link "./utils/reranker".rankByScores}
   * assigned to the chosen slot — the TRUE logging-policy propensity,
   * recorded for IPS/SNIPS off-policy replay (docs/heuristic.md §Phase 2).
   * Present whenever the pure core actually ran the re-ranker over ≥1
   * candidate for a placed (non-past) task; absent for frozen/unplaced tasks.
   */
  propensity?: number;
}
