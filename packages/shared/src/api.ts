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

export interface CreateTaskResponse {
  task: Task;
  schedulingMeta: SchedulingMeta;
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
