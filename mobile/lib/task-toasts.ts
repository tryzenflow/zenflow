import { t } from "./i18n";
import { format } from "./i18n";
import type { ToastIcon, useToast } from "@/components/ui/toast";
import { placementQualifier, zonedDate } from "@zenflow/core";
import {
  type DisplacedSession,
  type InfeasiblePolicy,
  SCHEDULE_INFEASIBLE_CODE,
  type ScheduleInfeasibleError,
  type Session,
} from "@zenflow/shared";
import { isAxiosError } from "axios";
import { describeSaveError } from "./save-error";

export interface PlacementToastUser {
  timezone: string;
}

export type ToastFn = ReturnType<typeof useToast>["toast"];

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
  icon?: ToastIcon,
): void {
  const { title, description } = splitToastMessage(t(raw));
  toast({ title, description, variant, ...(icon && { icon }) });
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
  icon?: ToastIcon,
): void {
  const message = describeSaveError(error, fallback);
  // Only the generic fallback is known: add a next step so it isn't a dead end.
  showSplitToast(
    toast,
    message === fallback ? `${fallback}\n${t("Try again in a moment.")}` : message,
    "destructive",
    icon,
  );
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
      message: `${t("Task created")}\n${t("No time found before its deadline.")}`,
      variant: "success",
    };
  }

  const qualifier = placementQualifier(task, { timezone: user.timezone });
  const start = zonedDate(task.scheduledStartTime, user.timezone);
  // Date and time share the title (same shape as showMovedToast), so the date
  // is not left hanging below as a description.
  const when = `${format(start, "EEE, MMM d")}, ${format(start, "HH:mm")}`;
  const title =
    qualifier === "pastDeadline"
      ? t("Scheduled late for {when}", { when })
      : t("Scheduled for {when}", { when });
  return { message: title, variant: "success" };
}

const POLICY_LABEL: Record<InfeasiblePolicy, string> = {
  get ACCEPT_CONFLICTS() {
    return t("Accept conflicts");
  },
  get ACCEPT_LATE_DEADLINE() {
    return t("Accept late deadline");
  },
};

/** The 409 SCHEDULE_INFEASIBLE body when `error` is one, else null. */
export function getInfeasibleError(
  error: unknown,
): ScheduleInfeasibleError | null {
  if (!isAxiosError(error) || error.response?.status !== 409) return null;
  const body = error.response.data as Partial<ScheduleInfeasibleError>;
  return body?.code === SCHEDULE_INFEASIBLE_CODE
    ? (body as ScheduleInfeasibleError)
    : null;
}

/**
 * Run `attempt`; on a 409 SCHEDULE_INFEASIBLE show a toast with one action per
 * offered policy, each retrying via `attempt(policy)`. Results go to
 * `onSuccess`; any other failure (or a failed retry) goes to `onError`.
 */
export async function withInfeasibleRetry<T>(
  toast: ToastFn,
  attempt: (policy?: InfeasiblePolicy) => Promise<T>,
  onSuccess: (result: T) => void | Promise<void>,
  onError: (error: unknown) => void,
): Promise<void> {
  const retry = async (policy: InfeasiblePolicy) => {
    try {
      await onSuccess(await attempt(policy));
    } catch (e) {
      onError(e);
    }
  };
  let result: T;
  try {
    result = await attempt();
  } catch (error) {
    const infeasible = getInfeasibleError(error);
    if (!infeasible) return onError(error);
    // One toast offering every policy, not one toast per policy.
    const { title, description } = splitToastMessage(
      infeasible.message.split("\n").map((line) => t(line)).join("\n"),
    );
    // A decision, not a notice: nothing was saved yet, so it must not time
    // out from under the user.
    toast({
      title,
      description,
      variant: "warning",
      icon: "calendar-x",
      persistent: true,
      position: "bottom",
      actions: infeasible.options.map((policy) => ({
        label: t(POLICY_LABEL[policy]),
        onPress: () => void retry(policy),
      })),
    });
    return;
  }
  // A throw while handling a *successful* save (bad response shape, a
  // navigation error…) must still surface, not reject out of `handleSubmit`.
  try {
    await onSuccess(result);
  } catch (e) {
    onError(e);
  }
}

/** Info toast when the engine moved flexible tasks to make room. */
export function showDisplacedToast(
  toast: ToastFn,
  displaced: DisplacedSession[] | undefined,
): void {
  if (!displaced?.length) return;
  const n = displaced.length;
  toast({
    title: t("Moved {count} flexible tasks", { count: n }),
    description: t("To make room for the new session."),
    icon: "calendar-clock",
    duration: 4000,
  });
}

/** Info toast when "skip conflicting" left some series occurrences unmoved. */
export function showSkippedToast(
  toast: ToastFn,
  skippedSessionIds: string[] | undefined,
): void {
  if (!skippedSessionIds?.length) return;
  toast({
    title: t("Some sessions weren't moved"),
    description: t("{count} stayed put because the new slot conflicted.", {
      count: skippedSessionIds.length,
    }),
    icon: "calendar-clock",
    duration: 4000,
  });
}
