/**
 * What kind of session this is.
 *
 * - `TASK` — flexible study work: has a `deadline`, placed on the calendar by
 *   the scheduling engine, freely draggable/resizable.
 * - `ASSIGNMENT` / `EXAM` / `LECTURE` — fixed events: the user (or an LMS/portal
 *   sync) pins a concrete `scheduledStartTime`; no `deadline`, not moved by the
 *   engine. May carry an `rrule` (a weekly lecture, a recurring lab).
 * - `DND` — a do-not-disturb block: fixed time, optional `rrule` recurrence,
 *   excluded from scheduling (the engine schedules *around* it).
 *
 * Every fixed type (`ASSIGNMENT` / `EXAM` / `LECTURE` / `DND`) may be recurring:
 * an `rrule` on its series expands into one virtual occurrence per date, and a
 * single occurrence can be deleted without touching the rest.
 */
export type SessionType = "TASK" | "ASSIGNMENT" | "EXAM" | "LECTURE" | "DND";

/** Where a session came from. */
export type SessionSource = "USER" | "LMS" | "PORTAL";

export interface Session {
  id: string;
  title: string;
  note: string | null;
  /** Always a positive multiple of 15. */
  durationMinutes: number;
  /**
   * ISO-8601 string. Present for `TASK`; `null` for the fixed types
   * (`ASSIGNMENT` / `EXAM` / `LECTURE` / `DND`).
   */
  deadline: string | null;
  type: SessionType;
  source: SessionSource;
  /** Free-form labels. */
  tags: string[];
  /**
   * ISO-8601 instant, or null when unscheduled. For fixed types it is set
   * directly by the client; for `TASK` the engine places it, and drag/resize
   * are plain field writes via `PATCH /sessions/:id`.
   */
  scheduledStartTime: string | null;
  /**
   * Set when this session belongs to a series — a recurring fixed session
   * (`DND` / `ASSIGNMENT` / `EXAM` / `LECTURE`), or a multi-session `TASK`
   * created with `sessionCount > 1`. For a recurring series this `Session` is
   * one *virtual occurrence*: its `id` is `"<seriesId>::<startISO>"`, not a
   * real row id, and edits/deletes on it are routed by the backend.
   */
  seriesId: string | null;
  /** The recurrence rule of this session's series, if any (RFC 5545 RRULE, bare — no `DTSTART`). */
  rrule: string | null;
  /** 1-based position within a `TASK` series (`null` outside a session-count series). */
  sessionIndex: number | null;
  /** Total session count of this session's `TASK` series (`null` otherwise). */
  sessionTotal: number | null;
  createdAt: string;
  updatedAt: string;
}

/** Create a flexible study task — engine-scheduled, deadline-driven. */
export interface CreateTaskInput {
  type: "TASK";
  title: string;
  note?: string | null;
  /** Positive multiple of 15. */
  durationMinutes: number;
  /** ISO-8601 deadline — required for a `TASK`; shared by every session of a series. */
  deadline: string;
  /**
   * Number of study sessions. Omitted or `1` → one ordinary task. `> 1` →
   * a `TASK` series: N linked `Session` rows sharing one `seriesId` and
   * `deadline`, each placed independently and spaced roughly evenly across
   * `now … deadline` (see `docs/scheduler/heuristic.md`).
   */
  sessionCount?: number;
  tags?: string[];
}

/** Create a fixed-time event the engine does not move. */
export interface CreateFixedSessionInput {
  type: "ASSIGNMENT" | "EXAM" | "LECTURE";
  title: string;
  note?: string | null;
  /** Positive multiple of 15 (the client derives it from start/end pickers). */
  durationMinutes: number;
  /** ISO-8601 instant — required; there is no deadline for a fixed session. */
  scheduledStartTime: string;
  /**
   * RFC 5545 RRULE — omit for a one-off. When set, `scheduledStartTime` is the
   * first occurrence and the series expands from there (a weekly lecture, a
   * recurring lab session).
   */
  rrule?: string | null;
  tags?: string[];
}

/** Create a do-not-disturb block, optionally recurring. */
export interface CreateDndInput {
  type: "DND";
  title: string;
  note?: string | null;
  durationMinutes: number;
  scheduledStartTime: string;
  /** RFC 5545 RRULE; omit for a one-off block. */
  rrule?: string | null;
  tags?: string[];
}

export type CreateSessionInput =
  | CreateTaskInput
  | CreateFixedSessionInput
  | CreateDndInput;

/**
 * Which occurrences a series-member update applies to (mirrors the delete
 * scopes, minus "this occurrence only" — a drag/resize/reschedule of a single
 * recurring fixed occurrence has no per-occurrence detach primitive, so
 * `"following"` is its finest granularity). Only meaningful when the PATCHed
 * session belongs to a series; omit for a one-off session or to keep today's
 * default (a materialized TASK sitting patches only itself; a recurring
 * occurrence re-anchors the whole series' time-of-day — see
 * `UpdateSessionDto`).
 */
export type UpdateScope = "occurrence" | "following" | "series";

/**
 * Generic metadata / reschedule / resize update — one endpoint
 * (`PATCH /sessions/:id`) covers all of it. Each field is a plain diff applied
 * directly.
 */
export interface UpdateSessionInput {
  title?: string;
  note?: string | null;
  durationMinutes?: number;
  /** ISO-8601 deadline (TASK only). Omit to leave unchanged. */
  deadline?: string;
  tags?: string[];
  scheduledStartTime?: string | null;
  /**
   * RFC 5545 RRULE — for a recurring fixed session (`DND` / `ASSIGNMENT` /
   * `EXAM` / `LECTURE`). Applies series-wide; clears the series' per-occurrence
   * deletions since the pattern changed. `null` drops the recurrence.
   */
  rrule?: string | null;
  /** Which series members a `scheduledStartTime`/`durationMinutes` change applies to. */
  scope?: UpdateScope;
  /**
   * With `scope: "following" | "series"`, leave any instance whose new
   * landing slot would overlap another session untouched instead of moving
   * it there. Ignored otherwise.
   */
  skipConflicting?: boolean;
}

export interface SessionsListResponse {
  sessions: Session[];
}

/**
 * Title-autocomplete suggestions: the user's existing sessions, newest first and
 * deduped by title, optionally filtered by the text typed so far. Each item is
 * a full {@link Session} so selecting one can populate the rest of the create form.
 */
export interface SessionSuggestionsResponse {
  suggestions: Session[];
}

/**
 * Creating a `TASK` places it into its single best empty slot between now and
 * its deadline (`docs/scheduler/heuristic.md`) — no other session is moved.
 * When `sessionCount > 1` the response also carries every session in
 * `sessions` (index order), with the top-level fields mirroring `sessions[0]`.
 * The shared `seriesId` on those rows groups the sessions' `CREATE` events;
 * reverting the batch = `DELETE /sessions/series/:seriesId`.
 */
export interface CreateSessionResponse extends Session {
  /** Present only for a `TASK` series create — all N sessions, `sessionIndex` order. */
  sessions?: Session[];
}

/**
 * Editing a `TASK`'s deadline re-places just that task (or, for a series
 * member, redistributes the series' still-upcoming sessions across the new
 * `now … deadline` window). No other session is moved.
 */
export interface UpdateSessionResponse extends Session {
  /** Present only when a `TASK` series was redistributed — its members in `sessionIndex` order. */
  sessions?: Session[];
  /** Ids left untouched by a `skipConflicting` update because their new landing slot conflicted. */
  skippedSessionIds?: string[];
}
export type SessionDetailResponse = Session;

/**
 * Result of `DELETE /sessions/:id`. `id` echoes what was deleted: a real row
 * id, or — when the id was a recurring occurrence ref (`"<seriesId>::<startISO>"`)
 * — that same ref, now added to the series' exception list so it stops
 * expanding.
 */
export interface RemoveSessionResponse {
  id: string;
}

/**
 * Result of a series-scoped delete:
 * - `DELETE /sessions/series/:seriesId` — the whole series;
 * - `DELETE /sessions/series/:seriesId/from/:sessionId` — that materialized
 *   `TASK` sitting + every later one (`sessionIndex` order), earlier ones kept;
 * - `DELETE /sessions/series/:seriesId/truncate?from=<ISO>` — a recurring
 *   (rrule) series: pull its `UNTIL` back to just before `from` ("this and all
 *   following"). `removedSessionIds` is empty here (occurrences are virtual);
 *   `seriesGone` is true if the cut left nothing and the series row was
 *   removed.
 */
export interface RemoveSessionSeriesResponse {
  seriesId: string;
  removedSessionIds: string[];
  seriesGone: boolean;
}

/**
 * Response for `GET /sessions/deadline-options`: the six deadline quick-action
 * chip values (see `docs/scheduler/heuristic.md`), each an ISO-8601 instant
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
