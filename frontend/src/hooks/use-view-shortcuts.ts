import { ViewMode } from "@/types/schedule";
import { useEffect } from "react";

export function useViewShortcuts(setView: (v: ViewMode) => void) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (
        e.target instanceof HTMLElement &&
        ["INPUT", "TEXTAREA"].includes(e.target.tagName)
      ) {
        return;
      }

      if (e.key === "d" || e.key === "D") setView("day");
      if (e.key === "w" || e.key === "W") setView("week");
      if (e.key === "m" || e.key === "M") setView("month");
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setView]);
}
