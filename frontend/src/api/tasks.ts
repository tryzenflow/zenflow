import type {
  CreateSessionInput,
  CreateSessionResponse,
  DeadlineOptionsResponse,
  RemoveSessionResponse,
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
 * over the returned `sessions` array.
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
 * One generic update endpoint covers metadata edits, drag-reschedule,
 * resize, and complete (`{ status: "DONE" }`) — there is no auto-placement
 * engine to recompute a cascade, so every field is a plain diff.
 */
export async function updateSession(
  id: string,
  input: UpdateSessionInput,
): Promise<UpdateSessionResponse> {
  const { data } = await api.patch(`/sessions/${id}`, input);
  return data.data;
}

export async function getSessionDetails(
  id: string,
): Promise<SessionDetailResponse> {
  const { data } = await api.get(`/sessions/${id}`);
  return data.data;
}

export async function removeSession(
  id: string,
): Promise<RemoveSessionResponse> {
  const { data } = await api.delete(`/sessions/${id}`);
  return data.data;
}
