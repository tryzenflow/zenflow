import { useEffect, useRef, useState } from "react";

/** How long a skeleton stays up once shown, so a fast load doesn't flash it. */
export const MIN_SKELETON_MS = 450;

/**
 * `true` while `pending`, and for at least `minMs` after the skeleton first
 * appeared. A load that resolves in a few ms would otherwise swap the grid
 * in on the next frame — an empty-then-filled flicker; holding the skeleton
 * makes the swap one calm transition. Warm (cached) loads aren't `pending`,
 * so they stay instant.
 */
export function useMinSkeleton(pending: boolean, minMs = MIN_SKELETON_MS) {
  const [held, setHeld] = useState(pending);
  const shownAt = useRef(pending ? Date.now() : 0);

  useEffect(() => {
    if (pending) {
      if (!shownAt.current) shownAt.current = Date.now();
      setHeld(true);
      return;
    }
    if (!shownAt.current) {
      setHeld(false);
      return;
    }
    const wait = Math.max(0, minMs - (Date.now() - shownAt.current));
    const id = setTimeout(() => {
      shownAt.current = 0;
      setHeld(false);
    }, wait);
    return () => clearTimeout(id);
  }, [pending, minMs]);

  return pending || held;
}
