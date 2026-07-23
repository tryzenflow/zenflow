import type { Task, TaskEvent } from "./task";
import type { DurationAdjustmentMode } from "./user";

/** Standard success envelope used by the Zenflow API. */
export interface ApiSuccess<T> {
  success: true;
  message?: string;
  data: T;
}

/** Standard error envelope. */
export interface ApiError {
  success: false;
  message: string;
  statusCode?: number;
  /** Offending field name for validation errors. */
  field?: string;
}

export interface TasksMeta {
  totalAllocatedMinutes: number;
  totalWorkMinutes: number;
  conflictCount: number;
}

export interface TasksListResponse {
  tasks: Task[];
  meta: TasksMeta;
}

/** Why the engine put a task where it did (Phase-2 placement re-ranker). */
export interface SchedulingRationale {
  /** Human-readable summary, e.g. "You usually keep work in the morning". */
  summary: string;
  /** Dominant preferred work window (minutes-from-midnight), if any. */
  preferredWindow?: { startMin: number; endMin: number } | null;
  /** Top day×block cells that drove the pick (matrix coords + score). */
  topCells?: { day: number; block: number; score: number }[];
}

export interface SchedulingMeta {
  /** Corrected duration actually fed to EDF (rounded up to 15-min). */
  adjustedDuration: number;
  placedAt: string | null;
  engine: "edf";
  /**
   * One-line "why this slot" summary — `tierRationale.summary` from the
   * tiered placer (`place.ts`'s `placeTask` + `rationale.ts`'s
   * `buildTierRationale`), always populated whenever a placement happened.
   */
  rationale?: string;
  /** Per-tag blended bias multiplier; 1.0 when no bias applied. */
  biasApplied?: number;
  /** User's typed estimate before correction (minutes). */
  estimatedDuration?: number;
  /** Active mode at create time (drives the FE toast behaviour). */
  durationAdjustmentMode?: DurationAdjustmentMode;
  /** Short reason naming the driving tag(s), e.g. "#backend ~30% longer". */
  durationReason?: string | null;
}

export interface CreateTaskResponse {
  task: Task;
  schedulingMeta: SchedulingMeta;
  /**
   * Always empty. Create places the new task via the narrow single-task
   * tiered placer (`placeTask`) — it only ever picks an already-free slot,
   * never displacing an existing task. Kept for wire shape parity with the
   * other mutation responses.
   */
  displaced: DisplacedTask[];
}

/**
 * Response for `PATCH /tasks/:id` (metadata-only update). `update()` never
 * auto-searches for a new slot: title/note/deadline/tags save immediately,
 * and the task's OWN placement is left exactly where it is. If the new
 * deadline (or a tags-driven duration correction) leaves that unchanged slot
 * no longer valid, the same write flags `task.conflict: true` and this
 * response's `rationale` explains that the slot is now broken — the
 * frontend/mobile show an Accept/Decline toast; Accept calls
 * `POST /tasks/:id/reschedule/resolve` (a separate, explicit request) to
 * actually search for a new slot. `displaced`/`batchId` are always empty/null
 * here — editing metadata never moves any task, including this one.
 */
export interface UpdateTaskResponse {
  task: Task;
  /**
   * Present when `tags` changed on this update: the same duration-correction
   * data `POST /tasks` returns. The corrected duration is already applied to
   * `task` (unless the user's `durationAdjustmentMode` is `"never"`) — this
   * is informational, so the frontend can show what changed.
   */
  schedulingMeta?: SchedulingMeta;
  /**
   * True when `deadline` actually changed on this update. Purely
   * informational.
   */
  deadlineChanged?: boolean;
  /** Always empty — a metadata edit never moves any task. Kept for wire shape parity with the other mutation responses. */
  displaced: DisplacedTask[];
  /**
   * Present (non-null) when this edit just invalidated the task's own
   * (unchanged) slot — `task.conflict` flipped `true` in this same write.
   * Explains why, and prompts the offer-to-reschedule Accept/Decline flow
   * (Accept → `POST /tasks/:id/reschedule/resolve`). Absent when the edit
   * didn't touch scheduling validity.
   */
  rationale?: SchedulingRationale;
  /** Always null/omitted — a metadata edit never writes an undoable batch. */
  batchId?: string | null;
}

export interface DisplacedTask {
  taskId: string;
  newScheduledStartTime: string | null;
}

/**
 * Response for `DELETE /tasks/:id`. Deleting a task only ever frees its own
 * slot — it never searches for anywhere to move anything else. `displaced`
 * is always empty and `batchId` always null/omitted; kept for wire shape
 * parity with the other mutation responses (a neighbour that was ONLY
 * conflicting with the deleted task has its `conflict` flag bounded-cleared
 * server-side, but that's a flag flip, not a move, so it's never reported
 * here as "displaced").
 */
export interface RemoveTaskResponse {
  /** Always empty — delete never moves another task. */
  displaced: DisplacedTask[];
  /** Always null/omitted — delete never writes an undoable batch. */
  batchId?: string | null;
}

/**
 * Response for the drag (`PATCH /tasks/:id/reschedule`) and resize
 * (`PATCH /tasks/:id/resize`) endpoints. Both write the user's requested
 * interval UNCONDITIONALLY — no search, no eviction, nothing else ever
 * moves. If the dropped/resized slot now overlaps another task, BOTH tasks
 * are simply flagged `conflict: true` (a bounded, indexed-range recheck —
 * `SchedulerService`'s `markConflicts`) and `rationale` names the overlap;
 * neither is auto-relocated. `displaced` is therefore always empty and
 * `batchId` always null/omitted — kept for wire shape parity with the other
 * mutation responses.
 */
export interface RescheduleResponse {
  task: Task;
  /** Always empty — a drag/resize never moves another task. */
  displaced: DisplacedTask[];
  /**
   * Always populated: a one-line "why here" summary, or — when the dropped/
   * resized slot overlaps another task — the conflict-notice phrasing
   * naming that task.
   */
  rationale?: SchedulingRationale | null;
  /** Always null/omitted — a drag/resize never writes an undoable batch. */
  batchId?: string | null;
}

/** `POST /tasks/reschedule/undo/:batchId`'s optional body. */
export interface UndoBatchInput {
  /**
   * How to proceed when the pre-flight "touched since" check finds rows in
   * this batch that were edited again after the auto-move being undone:
   * `"all"` reverts every row in the batch regardless; `"excludeTouched"`
   * reverts only the untouched ones. Omitted on the FIRST attempt — if the
   * server finds any touched row it responds with `requiresConfirmation`
   * instead of writing anything, and the client resubmits with a strategy.
   */
  strategy?: "all" | "excludeTouched";
}

/**
 * Response for `POST /tasks/reschedule/undo/:batchId`: reverts every task one
 * `SchedulerService.optimizeWindow` (or `resolveInvalidPlacement`) batch
 * moved back to its prior slot/duration, restored from each RESCHEDULED
 * TaskEvent's `oldSnapshot`.
 */
export interface UndoBatchResponse {
  /** The set of tasks that moved (back). Empty when `requiresConfirmation` is true (nothing was written yet). */
  displaced: DisplacedTask[];
  /**
   * True when a pre-flight check found that one or more of this batch's
   * tasks were touched (moved/edited/completed) again since the batch ran —
   * nothing was written; resubmit with `{ strategy }` naming how to proceed.
   */
  requiresConfirmation?: boolean;
  /** Task ids the pre-flight check found touched since the batch ran. Present alongside `requiresConfirmation`. */
  touchedTaskIds?: string[];
}

/**
 * Body for `POST /tasks/optimize/preview` and `POST /tasks/optimize/apply` —
 * the one explicit, opt-in, multi-task scheduling action. `mode` picks how
 * `optimize.ts`'s `repackWindow` treats the window's tasks: `"full"` — every
 * task in the window is movable; `"retainManual"` — tasks the user manually
 * moved are locked at their current slot (even if invalid) and everything
 * else reflows around them; `"balanced"` — every task is movable (like
 * `"full"`), but each task's own near-tied Tier-1 candidates are biased
 * toward staying close to its current slot the nearer in time that slot is
 * (never a cross-task cost comparison).
 */
export interface OptimizeWindowInput {
  /** ISO-8601 inclusive lower bound of the window to reflow. */
  windowStart: string;
  /** ISO-8601 inclusive upper bound. `windowEnd - windowStart` is capped both client-side (`OPTIMIZE_UI_MAX_WINDOW_DAYS`) and server-side (the backend's own `MAX_SCAN_DAYS`, stricter). */
  windowEnd: string;
  mode: "full" | "retainManual" | "balanced";
}

/**
 * Response for `POST /tasks/optimize/preview`: a COUNT ONLY of how many tasks
 * would move if applied with this window/mode — Optimize deliberately never
 * renders a per-task diff. Nothing is written.
 */
export interface OptimizePreviewResponse {
  count: number;
  windowStart: string;
  windowEnd: string;
}

/**
 * Response for `POST /tasks/optimize/apply`: the window was recomputed
 * server-side (never trusting the preview's count as stale) and every moved
 * task was written in one batch tagged with `batchId`, undoable via the
 * existing `POST /tasks/reschedule/undo/:batchId`. `fixedCount`/
 * `unchangedCount` are present for `"retainManual"` so the frontend/mobile
 * can render "Fixed 12 · 2 left unchanged (manually placed)".
 */
export interface OptimizeApplyResponse {
  /** How many tasks actually moved. */
  count: number;
  windowStart: string;
  windowEnd: string;
  /** Null when `count` is 0 — nothing to undo. */
  batchId: string | null;
  /** `"retainManual"` only: how many tasks were locked at their current slot. */
  fixedCount?: number;
  /** `"retainManual"` only: how many movable tasks were considered but left unchanged (already cost-optimal). */
  unchangedCount?: number;
}

/** 7×24 signed preference matrix for the Insights heatmap. */
export interface PreferenceMatrixResponse {
  /** Flat 168-element float row-major [day0..6][block0..23], signed scores.
   * Values are floats (not integers) because the daily exponential decay
   * accumulates sub-integer precision; the FE normalises them for colour. */
  matrix: number[];
  /** Grid dims so the FE doesn't hard-code them. */
  days: number; // 7
  blocks: number; // 24
}

export interface TaskDetailResponse {
  task: Task;
  events: TaskEvent[];
}

/** One tag's learned duration multiplier. */
export interface TagBiasEntry {
  tag: string;
  /** Sample count (COMPLETE/KEEP events with this tag). Higher = more evidence. */
  n: number;
  /** Duration multiplier: actual ÷ estimated. 1.0 = no correction. */
  b: number;
}

/** Per-tag duration-multiplier summary for the Insights panel. */
export interface TagBiasResponse {
  /** All tags with ≥1 sample, sorted by n descending. */
  tags: TagBiasEntry[];
}
