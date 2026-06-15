import type { Task, TaskEvent } from "./task";

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

export interface SchedulingMeta {
  adjustedDuration: number;
  placedAt: string | null;
  engine: "edf";
  /** Phase-2+ bias multiplier; 1.0 in Phase 1. */
  biasApplied?: number;
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
}

export interface TaskDetailResponse {
  task: Task;
  events: TaskEvent[];
}
