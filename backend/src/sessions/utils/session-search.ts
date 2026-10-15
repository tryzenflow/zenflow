import type { SessionSearchDirection } from "@zenflow/shared";

/** A point in the `(start, id)` order search pages walk. */
export interface SearchPosition {
  start: Date;
  id: string;
}

/** Days of virtual occurrences expanded past the cursor when stored rows run out. */
export const OCCURRENCE_WINDOW_DAYS = 365;

/**
 * `(start, id)` order. Ids compare by code unit, matching the SQL side's
 * `COLLATE "C"`; the anchor's empty id sorts before every real id.
 */
export function comparePositions(a: SearchPosition, b: SearchPosition): number {
  const dt = a.start.getTime() - b.start.getTime();
  if (dt !== 0) return dt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Whether `p` lies strictly past `cursor` in `direction`. */
export function isPast(
  p: SearchPosition,
  cursor: SearchPosition,
  direction: SessionSearchDirection,
): boolean {
  const c = comparePositions(p, cursor);
  return direction === "forward" ? c > 0 : c < 0;
}

export function encodeCursor(p: SearchPosition): string {
  return Buffer.from(
    JSON.stringify({ s: p.start.toISOString(), id: p.id }),
  ).toString("base64url");
}

/** `null` for a malformed cursor. */
export function decodeCursor(cursor: string): SearchPosition | null {
  try {
    const raw: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );
    if (typeof raw !== "object" || raw === null) return null;
    const { s, id } = raw as { s?: unknown; id?: unknown };
    if (typeof s !== "string" || typeof id !== "string") return null;
    const start = new Date(s);
    if (Number.isNaN(start.getTime())) return null;
    return { start, id };
  } catch {
    return null;
  }
}

/** Whitespace-separated words of `q`, lowercased and deduped; at most 8. */
export function searchTerms(q: string | undefined): string[] {
  if (!q) return [];
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return [...new Set(words)].slice(0, 8);
}

/** `%term%` for ILIKE, with `\`, `%` and `_` escaped. */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * Merge stored rows and virtual occurrences into one page in walk order.
 * `storedHasMore` means the stored query was cut at `limit`.
 */
export function mergePage<T extends SearchPosition>(
  stored: T[],
  occurrences: T[],
  limit: number,
  direction: SessionSearchDirection,
  storedHasMore: boolean,
): { page: T[]; hasMore: boolean } {
  const sign = direction === "forward" ? 1 : -1;
  const all = [...stored, ...occurrences].sort(
    (a, b) => sign * comparePositions(a, b),
  );
  return {
    page: all.slice(0, limit),
    hasMore: storedHasMore || all.length > limit,
  };
}
