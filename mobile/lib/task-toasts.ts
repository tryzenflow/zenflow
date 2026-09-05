import type { useToast } from "@/components/ui/toast";
import { placementQualifier, zonedDate } from "@zenflow/core";
import type { Session } from "@zenflow/shared";
import { isAxiosError } from "axios";
import { format } from "date-fns";

export interface PlacementToastUser {
  timezone: string;
}

type ToastFn = ReturnType<typeof useToast>["toast"];

/**
 * Split a raw error/validation message into a short toast title + optional
 * description. A message that wants a two-part toast embeds a "\n" between
 * them (see e.g. the backend's `NO_FEASIBLE_SLOT_MESSAGE` /
 * `IsFeasibleTaskWindow`, and `sessionSchema`'s feasibility issue) — a plain
 * one-line message comes back unchanged, as a title with no description.
 * Exists so a long guidance sentence never renders as one wrapped, bold
 * line — a title + a calmer description line reads far better.
 */
export function splitToastMessage(raw: string): {
  title: string;
  description?: string;
} {
  const i = raw.indexOf("\n");
  if (i === -1) return { title: raw };
  return {
    title: raw.slice(0, i).trim(),
    description: raw.slice(i + 1).trim() || undefined,
  };
}

/** Show `raw` (optionally "\n"-split, see {@link splitToastMessage}) as a
 * `variant` toast, title + description instead of one long line. */
export function showSplitToast(
  toast: ToastFn,
  raw: string,
  variant: "success" | "destructive" | "warning" = "destructive",
): void {
  const { title, description } = splitToastMessage(raw);
  toast(title, variant, undefined, undefined, undefined, undefined, {
    description,
  });
}

/**
 * Extract a caught request's server-sent message (or `fallback`, for a
 * non-HTTP failure / an empty response) and show it as a destructive toast
 * via {@link showSplitToast}. The one-stop replacement for the
 * `isAxiosError(error) && ... ?.message` extraction every create/edit/delete
 * catch block here used to repeat inline.
 */
export function showErrorToast(
  toast: ToastFn,
  error: unknown,
  fallback: string,
): void {
  const raw =
    (isAxiosError(error) &&
      (error.response?.data as { message?: string } | undefined)?.message) ||
    fallback;
  showSplitToast(toast, raw, "destructive");
}

/**
 * Description line for the "Tip" toast shown occasionally after a create/edit,
 * nudging people toward the calendar's press-and-hold sheet (which now moves
 * *and* resizes) instead of always opening the form. Pair it with the title
 * "Tip" and the `"tip"` toast variant; gate every use behind
 * {@link shouldSurfaceRescheduleHint}.
 */
export const RESCHEDULE_HINT =
  "Press and hold a session on your calendar to move or resize it.";

// Bumped on every create/edit save this app run. Not persisted: a fresh run
// starts the cadence over, which is fine for a discovery hint.
let saveCount = 0;

/**
 * Should the {@link RESCHEDULE_HINT} toast be shown for this save? True on the
 * first save of the app run, then every 5th after — often enough to be seen,
 * rare enough not to annoy.
 */
export function shouldSurfaceRescheduleHint(): boolean {
  saveCount += 1;
  return saveCount === 1 || saveCount % 5 === 0;
}

/**
 * Compose the create/edit placement toast copy — the mobile "toast surface"
 * for auto-scheduling placement (RN migration Phase 5 / issue #20). The
 * auto-scheduling logic itself, and the richer Phase-2 rationale UI
 * (`frontend/src/components/tasks/rationale-toast.tsx`'s preferred-window /
 * top-cells breakdown), are both out of scope here — this only ports the
 * plain success/conflict messaging `create-task-dialog.tsx` already showed
 * via a one-line `toast.success`/`toast.warning` before any rationale data
 * is available, using the same `placementQualifier` signal (now hoisted to
 * `@zenflow/core` alongside `taskSchema`).
 */
export function placementToastMessage(
  task: Session,
  user: PlacementToastUser,
): { message: string; variant: "success" | "destructive" } {
  if (!task.scheduledStartTime) {
    // `POST /sessions` for a `TASK` runs the placement engine
    // (`TaskPlacementService.placeOnCreate`) and normally returns a real
    // `scheduledStartTime`; it comes back null only when the heuristic found
    // no slot before the deadline. That's not a hard failure — this used to
    // read as a destructive "couldn't be scheduled before its deadline" and
    // fired on *every* creation. Mirrors
    // `frontend/src/components/tasks/create-task-dialog.tsx`.
    return {
      message: `"${task.title}" created`,
      variant: "success",
    };
  }

  const qualifier = placementQualifier(task, { timezone: user.timezone });
  const suffix = qualifier === "pastDeadline" ? " — past its deadline" : "";

  const when = format(
    zonedDate(task.scheduledStartTime, user.timezone),
    "EEE MMM d, HH:mm",
  );
  return { message: `Scheduled for ${when}${suffix}`, variant: "success" };
}
