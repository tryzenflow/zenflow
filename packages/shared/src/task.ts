import type { SchedulingMeta, SchedulingOverflow } from "./api";

/** Lifecycle status of a task. */
export type TaskStatus = "PENDING" | "DONE" | "ABANDONED";

/** Append-only audit event types recorded for every scheduling change. */
export type TaskEventType =
  | "CREATE"
  | "MOVE"
  | "RESIZE"
  | "KEEP"
  | "COMPLETE"
  | "ABANDON"
  | "RESCHEDULED";

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
  /** ISO-8601 deadline. Required — the view-scoped scheduling model is gone. */
  deadline: string;
  tags?: string[];
  /**
   * 'YYYY-MM-DD' day the task was created from, in the user's tz. Informational
   * only — the engine no longer anchors placement to it (every task is
   * flexible). Defaults to today.
   */
  startDate?: string;
}

/**
 * Body for `POST /tasks/simulate`: read-only dry-run of the scheduler for a
 * not-yet-created task. No DB write.
 */
export interface SimulateTaskInput {
  durationMinutes: number;
  deadline: string;
  tags?: string[];
}

export interface SimulateTaskResponse {
  schedulingMeta: SchedulingMeta;
  /** Populated when no feasible slot exists before the deadline. */
  overflow?: SchedulingOverflow | null;
}

/**
 * Metadata-only update: title/note/deadline/tags are saved immediately and the
 * task keeps its current slot — a `deadline` or `tags` change never
 * auto-cascades. A `tags` change also applies the Phase-2 per-tag duration
 * correction immediately (unless the user's `durationAdjustmentMode` is
 * `"never"`) and returns it as `schedulingMeta` (see `UpdateTaskResponse`) so
 * the frontend can surface what changed. Either kind of change can leave a
 * conflict in its wake, which the frontend resolves by prompting for
 * `POST /tasks/reschedule-cascade` if the task's own placement is still in
 * the future (see `RescheduleCascadeInput`).
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
 * Body for `POST /tasks/reschedule-cascade`: the shared confirm-before-
 * reschedule target for every trigger that can leave a schedule gap/conflict
 * behind — a deadline edit, a tags-driven duration change, or a delete. No
 * anchor task: every non-frozen task currently placed inside the window is
 * eligible to move. The frontend computes the window (todo.md §Rescheduling
 * Design: ±3 workdays around the affected task's current placement, clamped
 * to `now` and re-balanced into the future when the past side is clamped)
 * and only calls this endpoint when that task's own placement is still in
 * the future — a past/in-progress task's edit or delete never prompts.
 */
export interface RescheduleCascadeInput {
  /** ISO-8601 inclusive start of the window to cascade-reschedule within. */
  windowStart: string;
  /** ISO-8601 exclusive end of the cascade window. */
  windowEnd: string;
  /**
   * The 3-option manual-vs-auto reschedule choice (todo.md §Rescheduling
   * Design): when true, manually-moved tasks in the window are ALSO eligible
   * to move ("reschedule everyone"); when false/omitted, they stay frozen
   * ("reschedule only auto-scheduled tasks"). The third option ("do nothing")
   * needs no backend representation — the frontend simply doesn't call this
   * endpoint.
   */
  includeManual?: boolean;
}

/**
 * Response for `GET /tasks/deadline-options`: the six deadline quick-action
 * chip values (see `docs/heuristic.md` / todo.md), each an ISO-8601 instant
 * derived from `horizon.ts`'s `endOfPeriod` ceiling math relative to the
 * request's `anchor`.
 */
export interface DeadlineOptionsResponse {
  today: string;
  tomorrow: string;
  thisWeek: string;
  nextWeek: string;
  thisMonth: string;
  noRush: string;
}
