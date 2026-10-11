import { format, t } from "./i18n";
import type { useToast } from "@/components/ui/toast";

type Toast = ReturnType<typeof useToast>["toast"];

/**
 * Confirms a drag-and-drop reschedule. A quiet "Moved to …" every time; the
 * very first move (the checklist step just ticked) gets a warmer toast that
 * also says why dragging is worth it.
 */
export function showMovedToast(
  toast: Toast,
  opts: { first: boolean; to: Date; withTime: boolean },
): void {
  if (opts.first) {
    toast({
      title: t("Nice! You moved a task."),
      description: t("Zenflow learns from every move to place tasks better."),
      variant: "success",
      icon: "sparkles",
      duration: 5000,
    });
    return;
  }
  // Date and time both matter, so they share the title: "Moved to Tue, Oct 14, 09:00".
  const date = format(opts.to, "EEE, MMM d");
  toast({
    title: t("Moved to {when}", {
      when: opts.withTime ? `${date}, ${format(opts.to, "HH:mm")}` : date,
    }),
    variant: "success",
    icon: "calendar-check",
  });
}
