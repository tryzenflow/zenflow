import { Dispatch, SetStateAction, useEffect } from "react";
import { ViewMode } from "@zenflow/shared";
import { isTypingTarget } from "@/utils/editing";
import { shiftDateByView } from "@/utils/navigation";

/**
 * Global calendar keyboard shortcuts:
 * - `d` / `w` / `m` switch to day / week / month view.
 * - `ArrowLeft` / `ArrowRight` step the cursor to the previous / next period
 *   at the active view's granularity (reusing {@link shiftDateByView}, the same
 *   logic the header's prev/next buttons use).
 *
 * All shortcuts no-op while the user is typing in an editable field
 * (see {@link isTypingTarget}) so input never doubles as a command.
 */
export function useViewShortcuts(
  view: ViewMode,
  setView: (v: ViewMode) => void,
  setDate: Dispatch<SetStateAction<Date>>,
) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;

      // Don't hijack browser/OS chords (e.g. Ctrl/Cmd+ArrowLeft).
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      switch (e.key) {
        case "d":
        case "D":
          setView("day");
          break;
        case "w":
        case "W":
          setView("week");
          break;
        case "m":
        case "M":
          setView("month");
          break;
        case "ArrowLeft":
          setDate((d) => shiftDateByView(d, view, "left"));
          break;
        case "ArrowRight":
          setDate((d) => shiftDateByView(d, view, "right"));
          break;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [view, setView, setDate]);
}
