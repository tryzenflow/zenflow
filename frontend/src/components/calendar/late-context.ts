import { createContext, useContext } from "react";

/**
 * Ids of the sessions the server flagged `late` (placed past their deadline,
 * #62). The shared calendar `Event` block doesn't carry the flag, so the
 * layout publishes the set and blocks/pills read it to paint the late style.
 */
export const LateSessionsContext = createContext<ReadonlySet<string>>(
  new Set(),
);

export function useIsLate(id: string): boolean {
  return useContext(LateSessionsContext).has(id);
}

/** Cherry late-state card treatment; merged after TASK_CARD_CLASSES via `cn()`. */
export { LATE_CARD_CLASSES } from "@zenflow/core";
