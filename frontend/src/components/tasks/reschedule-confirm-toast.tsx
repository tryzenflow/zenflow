import { toast } from "sonner";
import { ConfirmToastShell, shell } from "@/lib/scheduling-toasts";

/**
 * The 2-button confirm-before-reschedule prompt (todo.md §Rescheduling
 * Design), shared by every trigger that can leave a schedule gap/conflict
 * behind — a deadline edit, a tags-driven duration change, or a delete.
 * Shown instead of {@link showRescheduleChoiceToast}'s 3-option variant when
 * nothing manually-moved sits in the affected window.
 */
export function showRescheduleConfirmToast({
  title,
  description,
  onConfirm,
  onDecline,
  declineLabel = "Not now",
}: {
  title: string;
  description: React.ReactNode;
  onConfirm: () => void | Promise<void>;
  /** Fired when "Not now" is picked — e.g. create falls back to overflow-recovery. */
  onDecline?: () => void;
  declineLabel?: string;
}) {
  const id = toast.custom(
    (toastId) =>
      shell(
        <ConfirmToastShell
          title={title}
          description={description}
          actions={[
            {
              label: "Reschedule",
              variant: "primary",
              onClick: () => {
                toast.dismiss(toastId);
                void onConfirm();
              },
            },
            {
              label: declineLabel,
              variant: "outline",
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
