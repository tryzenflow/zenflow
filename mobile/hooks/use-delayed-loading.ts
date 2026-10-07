import { useEffect, useRef, useState } from "react";

/** Wait this long before a skeleton appears, so a quick load never flashes it. */
export const SKELETON_DELAY_MS = 200;
/** Once shown, a skeleton stays at least this long, so it doesn't blink off. */
export const SKELETON_MIN_MS = 400;

/**
 * `true` only when `pending` has lasted past `delayMs`, and then for at least
 * `minMs`. A load that resolves inside the delay never shows a skeleton; one
 * that outlasts it shows a calm skeleton instead of an empty-then-filled swap.
 * Warm (cached) loads aren't `pending`, so they stay instant.
 */
export function useDelayedLoading(
  pending: boolean,
  { delayMs = SKELETON_DELAY_MS, minMs = SKELETON_MIN_MS } = {},
) {
  const [visible, setVisible] = useState(false);
  const shownAt = useRef(0);

  useEffect(() => {
    if (pending) {
      if (visible) return;
      const id = setTimeout(() => {
        shownAt.current = Date.now();
        setVisible(true);
      }, delayMs);
      return () => clearTimeout(id);
    }
    if (!visible) return;
    const wait = Math.max(0, minMs - (Date.now() - shownAt.current));
    const id = setTimeout(() => setVisible(false), wait);
    return () => clearTimeout(id);
  }, [pending, visible, delayMs, minMs]);

  return visible;
}
