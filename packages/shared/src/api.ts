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
  /** The rationale behind the task placement */
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
  /** Tasks cascade-moved as a side effect of placing the new task. */
  displaced: DisplacedTask[];
}

/**
 * Response for `PATCH /tasks/:id` (metadata-only update). A deadline/duration
 * change that leaves the task's own slot no longer cost-optimal (past its new
 * deadline, or overlapping a neighbour) is now auto-resolved INLINE (same
 * request/transaction) via a full schedule reoptimize — `displaced`/`batchId`
 * surface what that repack did, if anything. `task` always reflects the
 * task's FINAL slot, even when the edit itself (e.g. a tightened deadline)
 * cost-forced its own placement to move.
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
   * informational — the inline reoptimize (see `displaced`/`batchId`) already
   * ran; there's no separate confirm step to gate.
   */
  deadlineChanged?: boolean;
  /** Tasks moved by the inline auto-resolve, if any ran (never includes this task itself). */
  displaced: DisplacedTask[];
  /**
   * Present when `displaced` is non-empty: groups the RESCHEDULED TaskEvents
   * the auto-resolve wrote, so the frontend can offer an undo via
   * `POST /tasks/reschedule/undo/:batchId`. Null/omitted when nothing moved.
   */
  batchId?: string | null;
}

export interface DisplacedTask {
  taskId: string;
  newScheduledStartTime: string | null;
}

/**
 * Response for the drag (`PATCH /tasks/:id/reschedule`) and resize
 * (`PATCH /tasks/:id/resize`) endpoints. A drag/resize that lands the pinned
 * task on top of another task now auto-resolves the overlap inline via a full
 * schedule reoptimize — `displaced`/`batchId` surface that. `task` always
 * reflects the dropped task's FINAL slot, which is usually exactly where it
 * was dropped (its just-set anchor is naturally cost-favoured to stay) but,
 * rarely, a genuinely cost-favourable eviction can move it again.
 */
export interface RescheduleResponse {
  task: Task;
  /** Tasks cascade-moved as a side effect of the reschedule (never includes this task itself). */
  displaced: DisplacedTask[];
  /** Present when a preference-favoured slot drove the placement. */
  rationale?: SchedulingRationale | null;
  /**
   * Present when `displaced` is non-empty: groups the RESCHEDULED TaskEvents
   * the inline auto-resolve wrote, so the frontend can offer an undo via
   * `POST /tasks/reschedule/undo/:batchId`. Null/omitted when nothing moved.
   */
  batchId?: string | null;
}

/**
 * Response for `POST /tasks/reschedule/undo/:batchId`: reverts every task one
 * `reoptimize` auto-cascade moved back to its prior slot/duration, restored
 * from each RESCHEDULED TaskEvent's `oldSnapshot`. Same shape as
 * `RescheduleResponse.displaced` — the set of tasks that moved (back).
 */
export interface UndoBatchResponse {
  displaced: DisplacedTask[];
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
