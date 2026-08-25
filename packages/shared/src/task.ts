import type { DayRescheduleResult } from "./day-reschedule";

/** Lifecycle status of a task. */
export type SessionStatus = "PENDING" | "DONE" | "ABANDONED";

export interface Session {
  id: string;
  title: string;
  note: string | null;
  /** Always a positive multiple of 15. */
  durationMinutes: number;
  /**
   * ISO-8601 string. The DB column is NOT NULL (every session has a
   * deadline); kept nullable in the wire type for backward compatibility
   * with existing consumers.
   */
  deadline: string | null;
  /** Free-form labels (Postgres text[]). */
  tags: string[];
  /**
   * ISO-8601 instant, or null when unscheduled. Set directly by the client —
   * there is no auto-placement engine; drag/resize/reschedule are plain field
   * writes via `PATCH /tasks/:id`.
   */
  scheduledStartTime: string | null;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSessionInput {
  title: string;
  note?: string | null;
  /** Session duration in minutes (always a positive multiple of 15, required). */
  durationMinutes: number;
  /** ISO-8601 deadline — required (the DB column is NOT NULL). */
  deadline: string;
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
export interface UpdateSessionInput {
  title?: string;
  note?: string | null;
  durationMinutes?: number;
  /** ISO-8601 deadline. Omit to leave unchanged — the field itself is never nullable. */
  deadline?: string;
  tags?: string[];
  scheduledStartTime?: string | null;
  status?: SessionStatus;
}

export interface SessionsListResponse {
  sessions: Session[];
}

/**
 * Title-autocomplete suggestions: the user's existing tasks, newest first and
 * deduped by title, optionally filtered by the text typed so far. Each item is
 * a full {@link Session} so selecting one can populate the rest of the create form.
 */
export interface SessionSuggestionsResponse {
  suggestions: Session[];
}

/**
 * Creating a session (or, for update, editing its deadline) implicitly and
 * transparently repacks the affected calendar day — `dayReschedule` is only
 * present when that repack actually moved something.
 */
export interface CreateSessionResponse extends Session {
  dayReschedule?: DayRescheduleResult;
}
export interface UpdateSessionResponse extends Session {
  dayReschedule?: DayRescheduleResult;
}
export type SessionDetailResponse = Session;

export interface RemoveSessionResponse {
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
