import { hiddenVersion, subscribeHidden } from "@/lib/hidden-sessions";
import { useSyncExternalStore } from "react";

/** Changes whenever a delete hides or restores sessions, so lists re-filter. */
export function useHiddenVersion(): number {
  return useSyncExternalStore(subscribeHidden, hiddenVersion, hiddenVersion);
}
