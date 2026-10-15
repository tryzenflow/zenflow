import { checkOff } from "@/api/check-off";
import { useLanguage } from "@/hooks/use-language";
import { useToast } from "@/components/ui/toast";
import { t } from "@/lib/i18n";
import { showErrorToast } from "@/lib/task-toasts";
import { UNDO_WINDOW_MS } from "@/lib/undo";
import { useTodayStore } from "@/hooks/use-today";
import { useCallback } from "react";

export type CheckOffKind = "complete" | "skip";

/**
 * Marks a session done or skipped, or undoes it. Setting a state shows a toast
 * with Undo for the undo window. Resolves `true` when the server accepted it.
 */
export function useCheckOff() {
  useLanguage();
  const { toast } = useToast();

  return useCallback(
    async (
      session: { id: string; title: string },
      kind: CheckOffKind,
      on: boolean,
    ): Promise<boolean> => {
      const undo = async () => {
        try {
          const res = await checkOff(session.id, kind, !on);
          useTodayStore.getState().applyCheckOff(res);
        } catch (error) {
          showErrorToast(toast, error, t("Couldn't update session"), "calendar-x");
        }
      };
      try {
        const res = await checkOff(session.id, kind, on);
        useTodayStore.getState().applyCheckOff(res);
      } catch (error) {
        showErrorToast(toast, error, t("Couldn't update session"), "calendar-x");
        return false;
      }
      if (on) {
        toast({
          title: kind === "complete" ? t("Session done") : t("Session skipped"),
          variant: "success",
          icon: kind === "complete" ? "calendar-check" : "calendar-x",
          duration: UNDO_WINDOW_MS,
          action: { label: t("Undo"), onPress: () => void undo() },
        });
      }
      return true;
    },
    [toast],
  );
}
