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
  /** Per-tag blended bias multiplier; 1.0 when no bias applied. */
  biasApplied?: number;
  /** User's typed estimate before correction (minutes). */
  estimatedDuration?: number;
  /** Active mode at create time (drives the FE toast behaviour). */
  durationAdjustmentMode?: DurationAdjustmentMode;
  /** Short reason naming the driving tag(s), e.g. "#backend ~30% longer". */
  durationReason?: string | null;
}

/** Granularity of the "next available period" overflow recovery option. */
export type OverflowGranularity = "day" | "week" | "month";

/** A recovery slot offered when a task can't be placed before its deadline. */
export interface OverflowOption {
  /** ISO-8601 start the task would be placed at if this option is chosen. */
  scheduledStartTime: string;
}

/** The "next available period" option, tagged with the period granularity. */
export interface NextAvailableOption extends OverflowOption {
  granularity: OverflowGranularity;
}

/**
 * Recovery options surfaced when the EDF engine can't place a created task
 * within working hours before its deadline (the task comes back unplaced).
 */
export interface SchedulingOverflow {
  /**
   * Earliest slot that ignores the working-hours window but still respects
   * occupied intervals and the task's deadline; null when even off-hours room
   * doesn't exist before the deadline.
   */
  outsideHours: OverflowOption | null;
  /**
   * Earliest in-working-hours slot in the next period (day/week/month per the
   * active view), ignoring the deadline; null when impossible (rare).
   */
  nextAvailable: NextAvailableOption | null;
}

export interface CreateTaskResponse {
  task: Task;
  schedulingMeta: SchedulingMeta;
  /**
   * Recovery options, populated ONLY when the created task is unplaced
   * (`task.scheduledStartTime === null`); otherwise omitted/null.
   */
  overflow?: SchedulingOverflow | null;
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

/** 7×96 signed preference matrix for the Insights heatmap. */
export interface PreferenceMatrixResponse {
  /** Flat 672-int row-major [day0..6][block0..95], signed scores. */
  matrix: number[];
  /** Grid dims so the FE doesn't hard-code them. */
  days: number; // 7
  blocks: number; // 96
}

export interface TaskDetailResponse {
  task: Task;
  events: TaskEvent[];
}
