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
export type TaskCardState = "fluid" | "overdue" | "conflict" | "completed";

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
  /**
   * Minutes from midnight of the last manually-pinned placement (informational
   * only; the scheduler never consults this — see {@link manuallyMoved}).
   */
  startTime: number;
  /**
   * True when the task was manually dragged/resized (or pinned via an
   * accepted overflow-recovery option) and so is anchored: the EDF engine
   * treats its slot as occupied space and never repositions it.
   */
  manuallyMoved: boolean;
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
  /** Task duration in minutes (always a positive multiple of 15, required). */
  durationMinutes: number;
  deadline?: string | null;
  tags?: string[];
  /**
   * 'YYYY-MM-DD' day the task was created from, in the user's tz. Informational
   * only — the engine no longer anchors placement to it (every task is
   * flexible). Defaults to today.
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

/**
 * Metadata-only update: title/note/deadline/tags are saved immediately and the
 * task keeps its current slot. A `deadline` change no longer auto-cascades — the
 * frontend surfaces a confirmation toast and, if accepted, calls
 * `POST /tasks/:id/reschedule-cascade` to actually re-place the movable set. A
 * `tags` change may return a `schedulingMeta` duration-adjustment suggestion
 * (see `UpdateTaskResponse`); accepting a new duration also goes through
 * `reschedule-cascade` (with `durationMinutes` set) if it needs a new slot.
 */
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
  /**
   * ISO-8601 start of the user's currently visible view window (inclusive).
   * When provided, `outsideViewPeriod` is computed against this window instead
   * of the task's stored creation period.
   */
  viewStart?: string;
  /** ISO-8601 end of the user's currently visible view window (exclusive). */
  viewEnd?: string;
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

/**
 * Body for `POST /tasks/:id/reschedule-cascade`: explicitly triggers the
 * view-scoped `cascadeReschedule` for this task (see the scheduler README) —
 * used after the user confirms a deadline-change reschedule prompt, or accepts
 * a tag-driven duration-adjustment suggestion that needs a new slot.
 */
export interface RescheduleCascadeInput {
  /**
   * ISO-8601 inclusive start of the caller's active calendar view window. Only
   * non-manual tasks currently placed inside `[viewStart, viewEnd)` (plus this
   * task) are eligible to move; everything else is frozen. Omit for the
   * unscoped (full) cascade.
   */
  viewStart?: string;
  /** ISO-8601 exclusive end of the active calendar view window. */
  viewEnd?: string;
  /**
   * When provided, applied to the task's `durationMinutes` BEFORE the cascade
   * runs — e.g. accepting a tag-driven duration-adjustment suggestion that
   * needs a new slot. Omit to reschedule at the task's current duration (e.g.
   * after a deadline edit).
   */
  durationMinutes?: number;
}
