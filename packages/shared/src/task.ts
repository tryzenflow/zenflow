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
   * Present only on virtually-expanded recurring occurrences returned by
   * GET /tasks. Holds the parent task id; {@link id} is a synthetic
   * per-occurrence id and must not be used for mutations in Phase 1.
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
}

/** Metadata-only update; does not trigger rescheduling. */
export interface UpdateTaskInput {
  title?: string;
  note?: string | null;
  deadline?: string | null;
  tags?: string[];
}

export interface RescheduleInput {
  /** ISO-8601 start the user dropped the task at (snapped to the 15-min grid). */
  requestedStartTime: string;
}
