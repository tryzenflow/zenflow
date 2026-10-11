import type { Href, useRouter } from "expo-router";

type Router = ReturnType<typeof useRouter>;

/**
 * `router.back()` with nothing to pop (cold deep link / push tap, or a repeated
 * close tap) raises "GO_BACK was not handled by any navigator". Fall back to
 * the calendar instead.
 */
export function safeBack(router: Router): void {
  if (router.canGoBack()) router.back();
  else router.replace("/" as Href);
}

/**
 * Leave a modal for the calendar. `replace("/")` from inside a modal swaps the
 * modal for a *second* `(app)` Tabs (the Week view then renders inside the
 * modal); `dismissTo` pops back to the one already underneath.
 */
export function goToCalendar(
  router: Router,
  params?: Record<string, string>,
): void {
  router.dismissTo({ pathname: "/", params } as Href);
}

const NAV_LOCK_MS = 600;
let lockedUntil = 0;

/**
 * Run a navigation at most once per `NAV_LOCK_MS`: a double tap otherwise
 * pushes the same modal twice (each mounts a full form + WebView).
 */
export function navigateOnce(go: () => void): boolean {
  const now = Date.now();
  if (now < lockedUntil) return false;
  lockedUntil = now + NAV_LOCK_MS;
  go();
  return true;
}

/** Test hook: the lock is module state shared across tests. */
export function resetNavLock(): void {
  lockedUntil = 0;
}
