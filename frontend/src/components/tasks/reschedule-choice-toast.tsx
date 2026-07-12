import { toast } from "sonner";
import { ConfirmToastShell, shell } from "@/lib/scheduling-toasts";

/**
 * The 3-option manual-vs-auto reschedule choice (todo.md §Rescheduling
 * Design), shown instead of the plain 2-button confirm toast whenever the
 * affected cascade window contains at least one manually-moved task
 * (`hasManualTaskInWindow` in `@/utils/tasks`) — otherwise "only auto" and
 * "everyone" are behaviorally identical and the extra button would just be
 * noise.
 *
 * - "Only move auto-scheduled tasks" — the default/primary action; calls
 *   `rescheduleCascade` with `includeManual` omitted (manual tasks stay put).
 * - "Reschedule everyone" — calls `rescheduleCascade` with
 *   `includeManual: true` (manual tasks become eligible too; the backend
 *   auto-resolves conflicts and un-pins any it moves).
 * - "I'll do it myself" — no API call; fires `onDecline` if given (e.g.
 *   create falls back to overflow-recovery).
 */
export function showRescheduleChoiceToast({
  title,
  description,
  onOnlyAuto,
  onEveryone,
  onDecline,
}: {
  title: string;
  description: React.ReactNode;
  onOnlyAuto: () => void | Promise<void>;
  onEveryone: () => void | Promise<void>;
  onDecline?: () => void;
}) {
  const id = toast.custom(
    (toastId) =>
      shell(
        <ConfirmToastShell
          title={title}
          description={description}
          actions={[
            {
              label: "Only move auto-scheduled tasks",
              description:
                "Resolves the conflict by moving only tasks the scheduler placed automatically; anything you moved by hand stays put.",
              variant: "primary",
              onClick: () => {
                toast.dismiss(toastId);
                void onOnlyAuto();
              },
            },
            {
              label: "Reschedule everyone",
              description:
                "Moves every task in this window, including ones you moved by hand, to auto-resolve the conflict.",
              variant: "outline",
              onClick: () => {
                toast.dismiss(toastId);
                void onEveryone();
              },
            },
            {
              label: "I'll do it myself",
              description:
                "Leaves the conflict as-is — nothing is rescheduled.",
              variant: "ghost",
              onClick: () => {
                toast.dismiss(toastId);
                onDecline?.();
              },
            },
          ]}
        />,
      ),
    { duration: Infinity },
  );
  return id;
}
