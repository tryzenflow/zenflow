import { format, t } from "@/lib/i18n";
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
  toast(
    t("Moved to {when}", {
      when: format(opts.to, opts.withTime ? "EEE, MMM d · HH:mm" : "EEE, MMM d"),
    }),
    "success",
    { icon: "calendar-check" },
  );
}
