/**
 * Shared shapes between the pure scheduler core (`place.ts`, `optimize.ts`)
 * and `SchedulerService`'s persistence layer. No I/O, no randomness here —
 * just types.
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
   * True when the task was manually dragged/resized. PURELY INFORMATIONAL
   * everywhere automatic — no automatic path (`place.ts`'s `placeTask`,
   * `SchedulerService.placeNewTask`/`resolveInvalidPlacement`) reads it to
   * decide what can move. The ONE place it gates real behavior is
   * `optimize.ts`'s `selectCandidates` in `"retainManual"` mode (explicit
   * user opt-in): a task with this flag set is locked at its current slot for
   * that one repack. The flag still gets SET on a real drag/resize
   * (`TasksService.displace`/`resize`) and is surfaced to the frontend for
   * the "Manually placed" badge/telemetry.
   */
  manuallyMoved: boolean;
  scheduledStartTime: Date | null;
  createdAt: Date;
  /** The task's stored conflict flag. */
  conflict: boolean;
}

/** The write-back envelope `SchedulerService` diffs against the DB and persists. */
export interface Placement {
  id: string;
  scheduledStartTime: Date | null;
  conflict: boolean;
  /**
   * Whether this placement is still the user's manual pin. `false` once a
   * task has been auto-placed/auto-relocated (`placeTask`, `optimizeWindow`)
   * — it's no longer at the spot the user (or a prior auto-placement) chose.
   * A direct drag/resize (`applyDirectPlacement`) always sets it `true`.
   */
  manuallyMoved: boolean;
  /**
   * The softmax first-choice probability {@link "./utils/reranker".rankByScores}
   * assigned to the chosen slot — the TRUE logging-policy propensity,
   * recorded for IPS/SNIPS off-policy replay (docs/heuristic.md §Phase 2).
   * Present whenever a Tier-1 candidate pool was actually re-ranked (`place.
   * ts`'s `placeTask`, `optimize.ts`'s `repackWindow`); absent for a Tier-2/3/
   * unplaced result or a direct manual placement.
   */
  propensity?: number;
}
