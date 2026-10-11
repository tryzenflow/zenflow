import { useFocusEffect } from "expo-router";
import { useCallback, useRef } from "react";

/**
 * Whether the screen this component lives in is the focused one. A ref, so a
 * focus change never re-renders the (large) calendar trees using it.
 *
 * Tab screens stay mounted after the first visit; session-mutation listeners
 * use this to skip revalidating while hidden. Nothing is lost: a mutation
 * expires the cache's freshness, so the focus-driven reload that runs when the
 * tab is shown again refetches then.
 */
export function useScreenFocusedRef() {
  const focused = useRef(true);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      return () => {
        focused.current = false;
      };
    }, []),
  );
  return focused;
}
