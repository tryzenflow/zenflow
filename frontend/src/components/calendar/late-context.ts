import { createContext, useContext } from "react";

/**
 * Ids of the sessions the server flagged `late` (placed past their deadline,
 * #62). The shared calendar `Event` block doesn't carry the flag, so the
 * layout publishes the set and blocks/pills read it to paint the red style.
 */
export const LateSessionsContext = createContext<ReadonlySet<string>>(
  new Set(),
);

export function useIsLate(id: string): boolean {
  return useContext(LateSessionsContext).has(id);
}

/** Red late-state card treatment; merged after TASK_CARD_CLASSES via `cn()`. */
export const LATE_CARD_CLASSES =
  "bg-red-50/60 dark:bg-red-950/25 border-l-red-500 text-red-900 dark:text-red-100";
