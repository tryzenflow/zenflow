import type { Session } from "./task";

/** Which way `GET /sessions/search` walks from the anchor or cursor. */
export type SessionSearchDirection = "forward" | "backward";

/** Query of `GET /sessions/search`. */
export interface SessionSearchQuery {
  /** Words matched against title, note text, location and tags; every word must match. Empty lists all sessions. */
  q?: string;
  /** ISO instant to start from when there is no cursor; defaults to now. */
  anchor?: string;
  /** Opaque `nextCursor` from the previous page in the same direction. */
  cursor?: string;
  /** `forward` returns sessions starting at or after the anchor, `backward` before it. Defaults to `forward`. */
  direction?: SessionSearchDirection;
  /** Page size, 1 to 50; defaults to 20. */
  limit?: number;
}

/**
 * One page of `GET /sessions/search`, always in ascending start order.
 * A recurring fixed series contributes its virtual occurrences (`<seriesId>::<startISO>` ids).
 */
export interface SessionSearchResponse {
  sessions: Session[];
  /** Pass as `cursor` with the same `direction` for the next page; `null` when there is none. */
  nextCursor: string | null;
}
