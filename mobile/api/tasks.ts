import type {
  CreateSessionInput,
  CreateSessionResponse,
  DeadlineOptionsResponse,
  RemoveSessionResponse,
  RemoveSessionSeriesResponse,
  Session,
  SessionDetailResponse,
  SessionsListResponse,
  UpdateSessionInput,
  UpdateSessionResponse,
  ViewMode,
} from "@zenflow/shared";
import { format } from "date-fns";
import { api } from "./base";

/**
 * No `status` param — the backend doesn't filter by status (rejected as an
 * endpoint param); a caller that needs status filtering does it client-side
 * over the returned `tasks` array.
 */
export async function listSessions(
  view: ViewMode,
  date: Date,
): Promise<SessionsListResponse> {
  const { data } = await api.get("/sessions", {
    params: { view, date: format(date, "yyyy-MM-dd") },
  });
  return data.data;
}

export async function listSessionSuggestions(
  q: string,
  limit = 10,
): Promise<Session[]> {
  const { data } = await api.get("/sessions/suggestions", {
    params: { q, limit },
  });
  return data.data.suggestions;
}

export async function createSession(
  input: CreateSessionInput,
): Promise<CreateSessionResponse> {
  const { data } = await api.post("/sessions", input);
  return data.data;
}

/**
 * The six deadline quick-action chip values (Today/Tomorrow/This week/Next
 * week/This month/No rush), each an ISO-8601 instant derived from the
 * backend's `endOfPeriod` ceiling math relative to `anchor`.
 */
export async function getDeadlineOptions(
  anchor: string = new Date().toISOString(),
): Promise<DeadlineOptionsResponse> {
  const { data } = await api.get("/sessions/deadline-options", {
    params: { anchor },
  });
  return data.data;
}

/**
 * One generic update endpoint covers metadata edits, drag-reschedule, and
 * resize. A change to a scheduled TASK's start/duration is recorded server-
 * side as a `MOVE` signal; there is no completion state. Every field is a
 * plain diff.
 */
export async function updateSession(
  id: string,
  input: UpdateSessionInput,
): Promise<UpdateSessionResponse> {
  const { data } = await api.patch(
    `/sessions/${encodeURIComponent(id)}`,
    input,
  );
  return data.data;
}

export async function getSessionDetails(
  id: string,
): Promise<SessionDetailResponse> {
  const { data } = await api.get(`/sessions/${encodeURIComponent(id)}`);
  return data.data;
}

/**
 * Delete a session. For a recurring occurrence pass its `"<seriesId>::<start>"`
 * id — the backend excludes just that date (the rest of the series stays).
 */
export async function removeSession(
  id: string,
): Promise<RemoveSessionResponse> {
  const { data } = await api.delete(`/sessions/${encodeURIComponent(id)}`);
  return data.data;
}

/** Delete a whole recurring series (every occurrence + the series row). */
export async function removeSessionSeries(
  seriesId: string,
): Promise<RemoveSessionSeriesResponse> {
  const { data } = await api.delete(`/sessions/series/${seriesId}`);
  return data.data;
}

/**
 * "Delete this occurrence and every one after it" — the backend pulls the
 * series' RRULE `UNTIL` back to just before `fromStartISO` (or deletes the
 * whole series if that's on/before the first occurrence). Recurring (rrule)
 * series only — throws for a materialized TASK series, which has no rrule.
 */
export async function truncateSessionSeries(
  seriesId: string,
  fromStartISO: string,
): Promise<RemoveSessionSeriesResponse> {
  const { data } = await api.delete(`/sessions/series/${seriesId}/truncate`, {
    params: { from: fromStartISO },
  });
  return data.data;
}

/**
 * "Delete this sitting and every later one" for a materialized multi-sitting
 * TASK series — deletes `sessionId` and every session after it in
 * `sessionIndex` order, keeping earlier sittings (and the series row, unless
 * nothing is left). Materialized TASK series only — there's no `sessionId`
 * to anchor on for a recurring (rrule) series, which uses
 * `truncateSessionSeries` instead.
 */
export async function removeSeriesFrom(
  seriesId: string,
  sessionId: string,
): Promise<RemoveSessionSeriesResponse> {
  const { data } = await api.delete(
    `/sessions/series/${seriesId}/from/${sessionId}`,
  );
  return data.data;
}
