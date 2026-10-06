import { useSyncExternalStore } from "react";
import { getLanguage, subscribeLanguage } from "@/lib/i18n";

/** Subscribe display components without remounting navigation or losing form edits. */
export function useLanguage() {
  return useSyncExternalStore(subscribeLanguage, getLanguage, getLanguage);
}
