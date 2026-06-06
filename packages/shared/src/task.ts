import type { ViewMode } from "./view";

/** Lifecycle status of a task. */
export type TaskStatus = "PENDING" | "DONE";

/** Append-only audit event types recorded for every scheduling change. */
export type TaskEventType = "CREATE" | "MOVE" | "RESIZE" | "COMPLETE";

/** Visual states a task card can render in (see design-system.md). */
export type TaskCardState =
  | "fluid"
  | "fixed"
  | "overdue"
  | "conflict"
  | "completed";

/** Snapshot stored on a {@link TaskEvent} for audit/replay. */
export interface TaskSnapshot {
  scheduledStartTime: string | null;
  durationMinutes: number;
}

export interface Task {
  id: string;
  title: string;
  note: string | null;
  /** Always a positive multiple of 15. */
  durationMinutes: number;
  /** ISO-8601 string, or null when the task has no deadline. */
  deadline: string | null;
  /** Free-form labels (Postgres text[]). */
  tags: string[];
  /** When true the task is an immovable anchor at {@link startTime}. */
  fixed: boolean;
  /** Minutes from midnight; only meaningful when {@link fixed} is true. */
  startTime: number;
  status: TaskStatus;
  /** True when the engine could not place the task before its deadline. */
  conflict: boolean;
  /** RFC 5545 recurrence rule, or "" when non-recurring. */
  rrule: string;
  /** ISO-8601 placement assigned by the EDF engine, or null when unplaced. */
  scheduledStartTime: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * Shared by every materialized occurrence of a recurring series; null for a
   * non-recurring task. Each occurrence is a real row with its own {@link id}
   * (safe to mutate); {@link seriesId} links siblings of the same series.
   */
  seriesId?: string | null;
}

export interface TaskEvent {
  /** BigInt serialized as a decimal string. */
  id: string;
  taskId: string;
  eventType: TaskEventType;
  oldSnapshot: TaskSnapshot | null;
  newSnapshot: TaskSnapshot;
  rewardScore: number;
  occurredAt: string;
}

export interface CreateTaskInput {
  title: string;
  note?: string | null;
  durationMinutes: number;
  deadline?: string | null;
  tags?: string[];
  fixed?: boolean;
  startTime?: number;
  /**
   * 'YYYY-MM-DD' day the task was created from, in the user's tz. Fixed: the
   * exact anchor day. Flexible: the earliest day the engine may place it on.
   * Defaults to today.
   */
  startDate?: string;
  rrule?: string;
  /**
   * Active calendar perspective the task was created from. Scopes recurrence
   * materialization to that window (week/month); omitted or "day" means a
   * single, non-recurring instance.
   */
  view?: ViewMode;
}

/**
 * How a mutation on one occurrence of a recurring series propagates:
 *  - "one"       → only this occurrence (the default; also used for one-offs)
 *  - "following" → this occurrence and every later one in the same series
 */
export type RecurrenceScope = "one" | "following";

/** Metadata-only update; does not trigger rescheduling. */
export interface UpdateTaskInput {
  title?: string;
  note?: string | null;
  deadline?: string | null;
  tags?: string[];
  /** Recurring series propagation; ignored for non-recurring tasks. */
  scope?: RecurrenceScope;
}

export interface RescheduleInput {
  /** ISO-8601 start the user dropped the task at (snapped to the 15-min grid). */
  requestedStartTime: string;
}

export interface ResizeInput {
  /**
   * ISO-8601 start (snapped to the 15-min grid). Unchanged from the original
   * for a bottom-edge resize; moved earlier for a top-edge resize.
   */
  requestedStartTime: string;
  /** New duration in minutes (positive multiple of 15). */
  durationMinutes: number;
}
