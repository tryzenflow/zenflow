/**
 * `POST /scheduler/optimize` — trigger 4 from notes.md ("optimizing a session
 * between [start, end]"). Applies immediately (no separate preview step) and
 * returns a diff of everything the heuristic moved.
 */
export interface OptimizeInput {
  /** ISO-8601 instant — inclusive lower bound of the optimization window. */
  start: string;
  /** ISO-8601 instant — inclusive upper bound of the optimization window. */
  end: string;
}

/** One session the optimize pass actually moved. */
export interface OptimizeDiff {
  id: string;
  title: string;
  /** ISO-8601 instant, or null if the session had no prior placement. */
  oldScheduledStartTime: string | null;
  /** ISO-8601 instant. */
  newScheduledStartTime: string;
}

export interface OptimizeResponse {
  /** Shared by every `SessionEvent` this call wrote — pass to the undo endpoint. */
  batchId: string;
  diffs: OptimizeDiff[];
}

/** `POST /scheduler/optimize/undo/:batchId` — unconditionally reverts a batch. */
export interface UndoOptimizeResponse {
  batchId: string;
  /** Ids of the sessions actually reverted. */
  reverted: string[];
}
