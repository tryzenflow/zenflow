/**
 * Session-lifetime shared vertical scroll position for the calendar day
 * timelines.
 *
 * The merged calendar screen (`app/(app)/index.tsx`) pages between days with a
 * 3-page window of live `DayTimeline`s. Each one owns its own `ScrollView`, so
 * without a shared anchor every day would keep whatever offset it was last
 * left at (or snap to "now"), and swiping Monday→Tuesday would jump the
 * viewport to a different time of day. Users read the week by scanning the
 * same hours across days, so the offset is shared: scroll Monday to ~5–9am and
 * every other day shows ~5–9am too.
 *
 * Stored as a **fraction** (0..1) of the timeline's total content height, not
 * a raw pixel offset, so a day the user has pinch-zoomed to a different
 * `hourHeight` still lands on the same wall-clock time.
 *
 * `null` until the first timeline positions itself (to "now" on today, on the
 * cold open). After that every scroll on the focused page writes here and the
 * off-screen neighbours follow via {@link subscribeTimelineScroll}.
 *
 * Not persisted — like the session cache it resets on app restart, where a
 * one-time "scroll to now" is the right behaviour anyway.
 */

let fraction: number | null = null;
const listeners = new Set<() => void>();

/** Ignore sub-pixel churn so a restore→notify→restore loop can't form. */
const EPSILON = 0.0005;

export function getTimelineScrollFraction(): number | null {
  return fraction;
}

/**
 * Record the focused timeline's scroll position (as a 0..1 fraction of its
 * content height). No-ops when the change is below {@link EPSILON}. Set
 * `notify` false to seed the value without waking subscribers — used for the
 * very first "scroll to now", where no other page needs to move yet.
 */
export function setTimelineScrollFraction(next: number, notify = true): void {
  const clamped = Math.min(1, Math.max(0, next));
  if (fraction != null && Math.abs(clamped - fraction) < EPSILON) return;
  fraction = clamped;
  if (notify) for (const l of listeners) l();
}

export function subscribeTimelineScroll(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Forget the shared position — e.g. on logout, alongside the session cache. */
export function resetTimelineScroll(): void {
  fraction = null;
}
