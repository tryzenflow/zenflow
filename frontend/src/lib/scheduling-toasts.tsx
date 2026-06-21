import { isAxiosError } from "axios";
import { toast } from "sonner";
import { Undo2 } from "lucide-react";
import { resizeTask } from "@/api/tasks";
import { errorToast } from "@/lib/toast";
import { formatMinutes } from "@/utils/time";
import { RationaleToast } from "@/components/tasks/rationale-toast";
import type { RescheduleResponse, SchedulingMeta, Task } from "@/types/phase2";

/** Wrap a custom toast body in the same popover shell the overflow toast uses. */
function shell(node: React.ReactNode) {
  return (
    <div className="w-full rounded-[var(--radius)] border border-border bg-popover p-4 shadow-lg">
      {node}
    </div>
  );
}

/**
 * Show the Phase-2 scheduling-rationale toast when a reschedule/resize/resolve
 * response carries one. No-op when `rationale` is null/absent, so callers can
 * pass any {@link RescheduleResponse} unconditionally.
 */
export function maybeShowRationaleToast(response: RescheduleResponse) {
  const rationale = response.rationale;
  if (!rationale) return;
  const id = toast.custom(
    (toastId) =>
      shell(
        <RationaleToast
          title={response.task.title}
          rationale={rationale}
          onDismiss={() => toast.dismiss(toastId)}
        />,
      ),
    { duration: 8000 },
  );
  return id;
}

/**
 * Resize a just-created task back to the user's typed estimate. Used by both the
 * `auto` Undo action and the `ask` "Keep estimate" action. Reverts at the task's
 * current placement (start unchanged) so only the duration changes.
 */
async function revertToEstimate(task: Task, estimatedDuration: number) {
  if (!task.scheduledStartTime) return; // unplaced — nothing to resize
  try {
    await resizeTask(task.id, task.scheduledStartTime, estimatedDuration);
  } catch (error) {
    errorToast(
      (isAxiosError(error) && error.response?.data?.message) ||
        "Couldn't restore your original duration",
    );
  }
}

/**
 * Drive the create-task duration-adjustment UX off `schedulingMeta`
 * (ADR Sequence 1). Returns the success message the caller should toast when no
 * adjustment behaviour took over (i.e. the default "created" toast still fires).
 *
 * - `auto`  → the corrected duration is already applied server-side; show a
 *   non-blocking toast with an **Undo** that resizes back to the estimate.
 * - `ask`   → blocking two-option toast (Accept corrected / Keep estimate);
 *   "Keep estimate" resizes back to the estimate.
 * - `never` → silent; the typed estimate was used.
 *
 * @param onAdjusted Called after an Undo / Keep so the caller can refetch the
 *   calendar to reflect the restored duration.
 * @returns true when an adjustment toast handled the UX (caller should skip its
 *   own "created" success toast); false when nothing was shown.
 */
export function handleDurationAdjustment(
  task: Task,
  meta: SchedulingMeta,
  onAdjusted: () => void,
): boolean {
  const mode = meta.durationAdjustmentMode;
  const estimated = meta.estimatedDuration;
  const adjusted = meta.adjustedDuration;

  // Nothing to surface: no mode, mode is "never", or the corrector left the
  // estimate unchanged (bias ≈ 1.0 → estimated === adjusted).
  if (
    !mode ||
    mode === "never" ||
    estimated == null ||
    estimated === adjusted
  ) {
    return false;
  }

  const longer = adjusted > estimated;
  const reason = meta.durationReason;
  const summary = `Adjusted ${formatMinutes(estimated)} → ${formatMinutes(
    adjusted,
  )}${longer ? " (you usually run longer)" : " (you usually finish sooner)"}.`;

  if (mode === "auto") {
    toast.custom(
      (id) =>
        shell(
          <div className="flex w-full flex-col gap-2.5">
            <div className="flex flex-col gap-0.5">
              <p className="text-sm font-semibold text-foreground">
                Duration adjusted for {task.title}
              </p>
              <p className="text-xs text-muted-foreground">{summary}</p>
              {reason && (
                <p className="font-mono text-[11px] text-muted-foreground">
                  {reason}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={async () => {
                toast.dismiss(id);
                await revertToEstimate(task, estimated);
                onAdjusted();
              }}
              className="inline-flex items-center gap-1.5 self-end rounded-md border border-border bg-muted/50 px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-muted"
            >
              <Undo2 className="size-3" /> Undo
            </button>
          </div>,
        ),
      { duration: 8000 },
    );
    return true;
  }

  // mode === "ask": blocking two-option toast.
  toast.custom(
    (id) =>
      shell(
        <div className="flex w-full flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-semibold text-foreground">
              Adjust the duration for this task?
            </p>
            <p className="text-xs text-muted-foreground">{summary}</p>
            {reason && (
              <p className="font-mono text-[11px] text-muted-foreground">
                {reason}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => toast.dismiss(id)}
              className="flex-1 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              Use {formatMinutes(adjusted)}
            </button>
            <button
              type="button"
              onClick={async () => {
                toast.dismiss(id);
                await revertToEstimate(task, estimated);
                onAdjusted();
              }}
              className="flex-1 rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
            >
              Keep {formatMinutes(estimated)}
            </button>
          </div>
        </div>,
      ),
    { duration: Infinity },
  );
  return true;
}
