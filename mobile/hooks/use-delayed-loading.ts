import { useEffect, useRef, useState } from "react";

/** Wait this long before a skeleton appears. 0 = straight away: a cold load
 * always shows the skeleton briefly instead of data popping in from blank. */
export const SKELETON_DELAY_MS = 0;
/** Once shown, a skeleton stays at least this long, so it doesn't blink off. */
export const SKELETON_MIN_MS = 400;

/**
 * `true` only when `pending` has lasted past `delayMs`, and then for at least
 * `minMs`. With no delay (the default) a load that is pending on first render
 * shows the skeleton on that same render, so there is no blank frame before it.
 * Warm (cached) loads aren't `pending`, so they stay instant.
 */
export function useDelayedLoading(
  pending: boolean,
  { delayMs = SKELETON_DELAY_MS, minMs = SKELETON_MIN_MS } = {},
) {
  const [visible, setVisible] = useState(() => pending && delayMs <= 0);
  const shownAt = useRef(Date.now());

  useEffect(() => {
    if (pending) {
      if (visible) return;
      const show = () => {
        shownAt.current = Date.now();
        setVisible(true);
      };
      if (delayMs <= 0) {
        show();
        return;
      }
      const id = setTimeout(show, delayMs);
      return () => clearTimeout(id);
    }
    if (!visible) return;
    const wait = Math.max(0, minMs - (Date.now() - shownAt.current));
    const id = setTimeout(() => setVisible(false), wait);
    return () => clearTimeout(id);
  }, [pending, visible, delayMs, minMs]);

  return visible;
}
