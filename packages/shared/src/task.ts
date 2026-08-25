/** Lifecycle status of a task. */
export type TaskStatus = "PENDING" | "DONE" | "ABANDONED";

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
   * ISO-8601 instant, or null when unscheduled. Set directly by the client —
   * there is no auto-placement engine; drag/resize/reschedule are plain field
   * writes via `PATCH /tasks/:id`.
   */
  scheduledStartTime: string | null;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskInput {
  title: string;
  note?: string | null;
  /** Task duration in minutes (always a positive multiple of 15, required). */
  durationMinutes: number;
  /** ISO-8601 deadline, or omitted/null for no deadline. */
  deadline?: string | null;
  tags?: string[];
  /** ISO-8601 instant, set directly by the client — no auto-placement. */
  scheduledStartTime?: string | null;
}

/**
 * Generic metadata/reschedule/resize/complete update — one endpoint
 * (`PATCH /tasks/:id`) covers all of it. Each field is a plain diff applied
 * directly; there is no cascade, conflict recompute, or displaced-tasks side
 * effect.
 */
export interface UpdateTaskInput {
  title?: string;
  note?: string | null;
  durationMinutes?: number;
  deadline?: string | null;
  tags?: string[];
  scheduledStartTime?: string | null;
  status?: TaskStatus;
}

export interface TasksListResponse {
  tasks: Task[];
}

/**
 * Title-autocomplete suggestions: the user's existing tasks, newest first and
 * deduped by title, optionally filtered by the text typed so far. Each item is
 * a full {@link Task} so selecting one can populate the rest of the create form.
 */
export interface TaskSuggestionsResponse {
  suggestions: Task[];
}

export type CreateTaskResponse = Task;
export type UpdateTaskResponse = Task;
export type TaskDetailResponse = Task;

export interface RemoveTaskResponse {
  id: string;
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
