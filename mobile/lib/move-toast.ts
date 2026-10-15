import { format, t } from "./i18n";
import { UNDO_WINDOW_MS } from "./undo";
import type { useToast } from "@/components/ui/toast";

type Toast = ReturnType<typeof useToast>["toast"];

/**
 * Confirms a drag-and-drop or "Move to…" reschedule with a quiet "Moved to …".
 * `onUndo` adds an Undo button for the undo window.
 */
export function showMovedToast(
  toast: Toast,
  opts: { to: Date; withTime: boolean; onUndo?: () => void },
): void {
  const action = opts.onUndo
    ? { label: t("Undo"), onPress: opts.onUndo }
    : undefined;
  // Date and time both matter, so they share the title: "Moved to Tue, Oct 14, 09:00".
  const date = format(opts.to, "EEE, MMM d");
  toast({
    title: t("Moved to {when}", {
      when: opts.withTime ? `${date}, ${format(opts.to, "HH:mm")}` : date,
    }),
    variant: "success",
    icon: "calendar-check",
    duration: opts.onUndo ? UNDO_WINDOW_MS : undefined,
    action,
  });
}
