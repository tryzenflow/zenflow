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
 * Extra guards on top of the raw cache keep rapid back-and-forth paging and
 * plain screen-focus from thrashing the network (the "swipe away, swipe
 * back, watch it reload" flicker, and — worse — a network call on every
 * single tab switch even when nothing changed):
 *   - each entry carries a `fetchedAt` stamp; `isDayCacheFresh` lets a caller
 *     skip the background revalidation entirely when the data is only
 *     seconds old — including on a screen-focus refetch. A focus bump alone
 *     is NOT a "something changed" signal; only a real mutation is (see
 *     `notifySessionsMutated` below), so it must not force a reload on its
 *     own.
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

/** How long a cached day (or month — `month-page.tsx` reuses this constant)
 * counts as "fresh" — a page mount, or a plain screen-focus, within this
 * window of the last fetch reuses the cache with no background revalidation
 * at all. */
export const DAY_CACHE_TTL_MS = 30_000;

const cache = new Map<string, DayCacheEntry>();
const inFlight = new Map<string, Promise<Session[]>>();

/** Bumped by `notifySessionsMutated` every time a session is created,
 * updated, or deleted anywhere in the app. Callers that don't key off the
 * per-day cache (Month View's per-month fetch) can stash the epoch they last
 * fetched at and compare it here instead of re-deriving day keys. */
let mutationEpoch = 0;

export function getSessionMutationEpoch(): number {
  return mutationEpoch;
}

/**
 * Call after any successful session create/update/delete (wired once, in
 * `api/tasks.ts`, so every mutation call site gets this for free). Expires
 * every cached day's freshness — NOT its content — so the next time each day
 * is actually viewed it quietly revalidates in the background instead of
 * serving up to `DAY_CACHE_TTL_MS` of stale data. Keeping the stale payload
 * (instead of deleting it, like `clearDaySessionCache`) matters: a day whose
 * cache entry was deleted reads as "never fetched" and flashes the loading
 * skeleton on next view, even though nothing about that particular day
 * changed. Also bumps `mutationEpoch` for `month-page.tsx`'s equivalent
 * check.
 */
export function notifySessionsMutated(): void {
  mutationEpoch++;
  for (const entry of cache.values()) {
    entry.fetchedAt = 0;
  }
}

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

/**
 * Do two session lists render identically? A revalidation fetch (day or
 * month) almost always returns the same data it already had — without this
 * guard, blindly calling `setSessions(freshArray)` re-renders the whole
 * timeline/grid (a new array reference, so every derived `useMemo` and every
 * `SessionBlock`/pill remounts its memo) for no visible change, which reads
 * as a flicker. Compare only the fields the calendar views actually draw
 * from. Shared by `day-timeline.tsx` and `month-page.tsx`.
 */
export function sameSessions(a: Session[], b: Session[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.id !== y.id ||
      x.title !== y.title ||
      x.scheduledStartTime !== y.scheduledStartTime ||
      x.durationMinutes !== y.durationMinutes ||
      x.deadline !== y.deadline ||
      x.type !== y.type ||
      x.updatedAt !== y.updatedAt
    ) {
      return false;
    }
  }
  return true;
}
