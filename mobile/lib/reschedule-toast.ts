import { rescheduleConflicts } from "@/api/notifications";
import { t } from "./i18n";
import type { ToastFn } from "./task-toasts";

/**
 * "Reschedule" on a sync-conflict notification: re-places the clashing tasks,
 * toasts the outcome, never throws. Returns true when the call went through.
 */
export async function rescheduleWithToast(
  notificationId: string,
  toast: ToastFn,
): Promise<boolean> {
  try {
    const res = await rescheduleConflicts(notificationId);
    const ok = res.rescheduled.length;
    const failed = res.failedSessionIds.length;
    toast({
      title: failed
        ? t("Rescheduled {ok}, {failed} left", { ok, failed })
        : t("Rescheduled {count} tasks", { count: ok }),
      description: failed
        ? t("The rest still overlap. Move them by hand.")
        : undefined,
      variant: failed ? "warning" : "success",
      icon: failed ? "calendar-clock" : "calendar-check",
    });
    return true;
  } catch {
    toast({
      title: t("Couldn't reschedule tasks"),
      description: t("Try again in a moment."),
      variant: "destructive",
      icon: "calendar-x",
    });
    return false;
  }
}
