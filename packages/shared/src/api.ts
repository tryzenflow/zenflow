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

/** A recovery slot offered when a task can't be placed before its deadline. */
export interface OverflowOption {
  /** ISO-8601 start the task would be placed at if this option is chosen. */
  scheduledStartTime: string;
}

/**
 * Recovery options surfaced when the EDF engine can't place a created task
 * within working hours before its deadline (the task comes back unplaced).
 */
export interface SchedulingOverflow {
  /**
   * Earliest slot that ignores the working-hours window but still respects
   * occupied intervals; null when even off-hours room doesn't exist within the
   * scan horizon.
   */
  outsideHours: OverflowOption | null;
  /**
   * Earliest in-working-hours slot searching forward from the task's deadline,
   * ignoring the deadline bound; null when impossible (rare).
   */
  nextAvailable: OverflowOption | null;
}

export interface CreateTaskResponse {
  task: Task;
  schedulingMeta: SchedulingMeta;
  /** Tasks cascade-moved as a side effect of placing the new task. */
  displaced: DisplacedTask[];
  /**
   * Recovery options, populated when the created task couldn't be placed
   * before its deadline. Omitted/null when the task was placed successfully.
   */
  overflow?: SchedulingOverflow | null;
}

/** Response for `PATCH /tasks/:id` (metadata-only update). */
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
   * True when `deadline` actually changed on this update. The frontend uses
   * this (or an equivalent client-side diff) to decide whether to prompt for
   * a confirm-before-reschedule via `POST /tasks/reschedule-cascade`.
   */
  deadlineChanged?: boolean;
}

export interface DisplacedTask {
  taskId: string;
  newScheduledStartTime: string | null;
}

export interface RescheduleResponse {
  task: Task;
  /** Tasks cascade-moved as a side effect of the reschedule. */
  displaced: DisplacedTask[];
  /** Present when a preference-favoured slot drove the placement. */
  rationale?: SchedulingRationale | null;
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
