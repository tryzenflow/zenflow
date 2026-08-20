import { isAxiosError } from "axios";
import { toast } from "sonner";
import { format } from "date-fns";
import { resolveTaskPlacement, undoBatch } from "@/api/tasks";
import { errorToast } from "@/lib/toast";
import { zonedDate } from "@/utils/tz";
import { RationaleToast } from "@/components/tasks/rationale-toast";
import { CascadeToast } from "@/components/tasks/cascade-toast";
import { cn } from "@/lib/utils";
import type { OptimizeApplyResponse } from "@zenflow/shared";
import type { SchedulingRationale, Task } from "@/types/phase2";

/** Wrap a custom toast body in the same popover shell the scheduling toasts use. */
export function shell(node: React.ReactNode) {
  return (
    <div className="w-full rounded-[var(--radius)] border border-border bg-popover p-4 shadow-lg">
      {node}
    </div>
  );
}

export interface ConfirmToastAction {
  label: string;
  onClick: () => void;
  /** `primary` (default) / `outline` / `ghost` — matches the button styles the
   * confirm-before-reschedule toasts have used since the Phase-2 rewrite. */
  variant?: "primary" | "outline" | "ghost";
  /** Optional one-line explanation of what this action does, shown under the
   * label when actions are stacked (see `stacked` below). */
  description?: string;
}

/**
 * Shared body for the confirm-before-reschedule family of toasts (deadline
 * change, tags change, delete gap-fill, manual-vs-auto reschedule choice):
 * a title + description, followed by 1-3 action buttons. Two actions lay out
 * as an even row (existing look); three or more stack vertically so labels
 * don't get cramped.
 */
export function ConfirmToastShell({
  title,
  description,
  actions,
}: {
  title: string;
  description: React.ReactNode;
  actions: ConfirmToastAction[];
}) {
  const stacked = actions.length > 2;
  return (
    <div className="flex font-sans w-full flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
      <div className={cn("flex gap-2", stacked ? "flex-col" : "items-center")}>
        {actions.map((action, i) => (
          <button
            key={i}
            type="button"
            onClick={action.onClick}
            className={cn(
              stacked ? "w-full flex flex-col items-start gap-0.5" : "flex-1",
              "rounded-md px-3 py-1.5 text-xs transition-colors",
              (!action.variant || action.variant === "primary") &&
                "bg-primary font-semibold text-primary-foreground hover:opacity-90",
              action.variant === "outline" &&
                "border border-border font-medium hover:bg-muted",
              action.variant === "ghost" &&
                "font-medium text-muted-foreground hover:bg-muted",
            )}
          >
            <span>{action.label}</span>
            {stacked && action.description && (
              <span
                className={cn(
                  "text-left text-[11px] font-normal leading-snug opacity-80",
                )}
              >
                {action.description}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Show the scheduling-rationale toast for any placement-affecting response —
 * create, an accepted edit-reschedule offer (`resolveTaskPlacement`), drag,
 * or resize. Every tiered placement now returns a rationale (no more
 * cold-start `null`), so this fires unconditionally whenever the caller has
 * one; still guarded on `rationale` being present so callers that pass a
 * possibly-undefined value (e.g. `schedulingMeta.rationale` before the
 * backend change lands) stay safe.
 *
 * `task` only needs `title`/`conflict` — passing a full `Task` (or the
 * `task` field of a {@link RescheduleResponse}-shaped response) works
 * unconditionally.
 */
export function maybeShowRationaleToast(input: {
  task: Pick<Task, "title" | "conflict">;
  rationale?: SchedulingRationale | string | null;
}) {
  const { task, rationale } = input;
  if (!rationale) return;
  const id = toast.custom(
    (toastId) =>
      shell(
        <RationaleToast
          title={task.title}
          rationale={rationale}
          conflict={task.conflict}
          onDismiss={() => toast.dismiss(toastId)}
        />,
      ),
    { duration: 8000 },
  );
  return id;
}

/**
 * Show the Edit "offer to reschedule" toast: a deadline/tags change left the
 * task's own (unchanged) slot invalid, so `PATCH /tasks/:id` flagged
 * `task.conflict: true` in the same write and returned a `rationale`
 * explaining why (`UpdateTaskResponse.rationale`) instead of auto-searching.
 * Decline (dismiss) leaves the task flagged — resolvable later by a manual
 * drag or Optimize. Accept calls `resolveTaskPlacement` (`POST
 * /tasks/:id/reschedule/resolve`), which re-runs the same Tier1→2→3 search
 * `createTask` uses and clears the flag on success; its response then drives
 * the normal {@link maybeShowRationaleToast}.
 */
export function showOfferToRescheduleToast(
  taskId: string,
  title: string,
  rationale: SchedulingRationale,
  onResolved: () => void,
) {
  toast.custom(
    (toastId) =>
      shell(
        <ConfirmToastShell
          title={`"${title}"'s new deadline broke its schedule`}
          description={rationale.summary}
          actions={[
            {
              label: "Find it a new slot",
              onClick: async () => {
                toast.dismiss(toastId);
                try {
                  const response = await resolveTaskPlacement(taskId);
                  onResolved();
                  maybeShowRationaleToast(response);
                } catch (error) {
                  errorToast(
                    (isAxiosError(error) && error.response?.data?.message) ||
                      "Couldn't reschedule it — try dragging it to a new slot.",
                  );
                }
              },
            },
            {
              label: "Leave it",
              variant: "outline",
              onClick: () => toast.dismiss(toastId),
            },
          ]}
        />,
      ),
    { duration: Infinity },
  );
}

/**
 * Show the cascade toast after an Optimize **apply** run
 * (`OptimizeApplyResponse`) — the only multi-task action left in the
 * redesigned scheduler. No-op when nothing moved or the response carries no
 * `batchId` (nothing to undo), so callers can pass any apply response
 * unconditionally.
 *
 * No longer called from create/update/delete or drag/resize: those mutations
 * can't produce collateral moves anymore (each is a narrow single-task
 * placement or a direct, unconditional write) — Optimize is the one explicit,
 * opt-in action that can touch more than one task.
 *
 * The toast id is keyed by `batchId` only to dedupe a literal duplicate fire
 * of the SAME batch (e.g. an accidental double-call) — it does not collapse
 * across distinct Optimize runs. Every apply gets its own fresh `batchId`, so
 * running Optimize again shortly after legitimately stacks another,
 * independently-undoable cascade toast; that's intended, not a bug to fix.
 */
export function maybeShowCascadeToast(
  response: OptimizeApplyResponse,
  tz: string,
  onUndone: () => void,
) {
  if (!response.count || !response.batchId) return;
  const batchId = response.batchId;
  const rangeLabel = `${format(zonedDate(response.windowStart, tz), "MMM d")} – ${format(
    zonedDate(response.windowEnd, tz),
    "MMM d",
  )}`;
  toast.custom(
    (toastId) =>
      shell(
        <CascadeToast
          count={response.count}
          rangeLabel={rangeLabel}
          fixedCount={response.fixedCount}
          unchangedCount={response.unchangedCount}
          onUndo={async () => {
            toast.dismiss(toastId);
            try {
              await undoBatch(batchId);
              onUndone();
            } catch (error) {
              errorToast(
                (isAxiosError(error) && error.response?.data?.message) ||
                  "Couldn't undo — the schedule may have changed since.",
              );
            }
          }}
          onDismiss={() => toast.dismiss(toastId)}
        />,
      ),
    { duration: 8000, id: `cascade:${batchId}` },
  );
}
