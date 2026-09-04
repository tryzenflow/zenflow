import type { Session } from "@zenflow/shared";

/**
 * In-memory, session-lifetime cache of each day's `listSessions("day", …)`
 * result, keyed by the `'YYYY-MM-DD'` day key.
 *
 * Purpose: stale-while-revalidate for the calendar timelines. A `DayTimeline`
 * seeds its `tasks` from here on mount, so a day the user has already seen
 * this session paints instantly (no loading skeleton) while a fresh fetch
 * runs in the background and updates both the state and this cache in place.
 *
 * Without it, paging back to an already-visited day in Week View remounts a
 * fresh `DayTimeline` that flashes the skeleton before its refetch resolves
 * — abrupt and, on a slow link, flaky-looking. This is only a display cache;
 * the backend stays the source of truth.
 *
 * Two extra guards on top of the raw cache keep rapid back-and-forth paging
 * from thrashing the network (the "swipe away, swipe back, watch it reload"
 * flicker):
 *   - each entry carries a `fetchedAt` stamp; `isDayCacheFresh` lets a caller
 *     skip the background revalidation when the data is only seconds old. A
 *     screen-focus refetch (`refreshKey`) bypasses this and always reloads.
 *   - `fetchDaySessions` de-dupes concurrent requests for the same day key so
 *     three pages mounting at once (or a fast double swipe) share one promise.
 *
 * Not persisted — dropped on app restart, which is fine: cold start already
 * shows the skeleton once and that is not the jarring case.
 */

interface DayCacheEntry {
  sessions: Session[];
  fetchedAt: number;
}

/** How long a cached day counts as "fresh" — a page mount within this window
 * of the last fetch reuses the cache with no background revalidation. Screen
 * focus (`refreshKey`) still forces a reload regardless. */
export const DAY_CACHE_TTL_MS = 30_000;

const cache = new Map<string, DayCacheEntry>();
const inFlight = new Map<string, Promise<Session[]>>();

export function getCachedDaySessions(dayKey: string): Session[] | undefined {
  return cache.get(dayKey)?.sessions;
}

export function setCachedDaySessions(
  dayKey: string,
  sessions: Session[],
): void {
  cache.set(dayKey, { sessions, fetchedAt: Date.now() });
}

/** True when `dayKey` is cached and the cache entry is younger than
 * {@link DAY_CACHE_TTL_MS}. */
export function isDayCacheFresh(dayKey: string): boolean {
  const entry = cache.get(dayKey);
  return entry != null && Date.now() - entry.fetchedAt < DAY_CACHE_TTL_MS;
}

/**
 * Fetch (or join an in-flight fetch of) a day's sessions through `loader`,
 * writing the result into the cache. Concurrent callers for the same `dayKey`
 * share one promise, so a settle that mounts a new page while the user flicks
 * back doesn't stack duplicate requests.
 */
export function fetchDaySessions(
  dayKey: string,
  loader: () => Promise<Session[]>,
): Promise<Session[]> {
  const existing = inFlight.get(dayKey);
  if (existing) return existing;
  const p = loader()
    .then((sessions) => {
      setCachedDaySessions(dayKey, sessions);
      return sessions;
    })
    .finally(() => {
      inFlight.delete(dayKey);
    });
  inFlight.set(dayKey, p);
  return p;
}

/** Drop everything — e.g. on logout, so the next user never sees stale days. */
export function clearDaySessionCache(): void {
  cache.clear();
  inFlight.clear();
}
