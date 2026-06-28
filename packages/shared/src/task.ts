/** Lifecycle status of a task. */
export type TaskStatus = "PENDING" | "DONE" | "ABANDONED";

/** Append-only audit event types recorded for every scheduling change. */
export type TaskEventType =
  | "CREATE"
  | "MOVE"
  | "RESIZE"
  | "KEEP"
  | "COMPLETE"
  | "ABANDON";

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
  /**
   * The task's tag NAMES at event time. Captured per-event because a task's tags
   * can change afterward, so the current Task.tags join would reconstruct "tags
   * now," not "tags then" — Phase 2's per-tag duration bias needs the latter.
   */
  tags?: string[];
  /**
   * The slot the EDF engine had SUGGESTED before this edit (the pre-edit
   * `scheduledStartTime`). Present on MOVE/RESIZE so offline replay/IPS can
   * recover the suggestion the user overrode. Absent on CREATE/COMPLETE/etc.
   */
  suggestedStartTime?: string | null;
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
  /**
   * True when the task has no valid placement (no slot before its deadline) —
   * i.e. {@link scheduledStartTime} is null.
   */
  conflict: boolean;
  /** ISO-8601 placement assigned by the EDF engine, or null when unplaced. */
  scheduledStartTime: string | null;
  createdAt: string;
  updatedAt: string;
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
  /**
   * Task duration in minutes (positive multiple of 15). For non-fixed tasks this
   * is required. For fixed tasks you may omit it and provide `endTime` instead —
   * the server derives `durationMinutes` from `startTime` + `endTime`, handling
   * the cross-midnight case (`startTime > endTime`) as
   * `endTime + 1440 − startTime` rounded to the nearest 15-minute multiple.
   */
  durationMinutes?: number;
  deadline?: string | null;
  tags?: string[];
  fixed?: boolean;
  /** Minutes from midnight (0–1439); only meaningful when `fixed` is true. */
  startTime?: number;
  /**
   * Fixed-task end time in minutes from midnight (0–1439). Optional alternative
   * to `durationMinutes` for fixed tasks: when provided the server computes the
   * duration, correctly handling cross-midnight spans (`startTime > endTime`).
   * Ignored for non-fixed tasks.
   */
  endTime?: number;
  /**
   * 'YYYY-MM-DD' day the task was created from, in the user's tz. Fixed: the
   * exact anchor day. Flexible: the earliest day the engine may place it on.
   * Defaults to today.
   */
  startDate?: string;
  /**
   * Calendar view active when scheduling; drives the granularity of the
   * "schedule the next available period" overflow recovery option offered when
   * a task can't be placed before its deadline. Defaults to "day".
   */
  view?: "day" | "week" | "month";
  /**
   * ISO-8601 start of the active view window (inclusive). When provided the
   * backend surfaces a {@link SchedulingOverflow} when the task is placed outside
   * [viewStart, viewEnd], not only when it is unplaced.
   */
  viewStart?: string;
  /**
   * ISO-8601 end of the active view window (exclusive).
   */
  viewEnd?: string;
}

/** Metadata-only update; does not trigger rescheduling. */
export interface UpdateTaskInput {
  title?: string;
  note?: string | null;
  deadline?: string | null;
  tags?: string[];
}

/**
 * Title-autocomplete suggestions: the user's existing tasks, newest first and
 * deduped by title, optionally filtered by the text typed so far. Each item is
 * a full {@link Task} so selecting one can populate the rest of the create form.
 */
export interface TaskSuggestionsResponse {
  suggestions: Task[];
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
