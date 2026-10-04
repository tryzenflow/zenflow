import type { useToast } from "@/components/ui/toast";
import { placementQualifier, zonedDate } from "@zenflow/core";
import {
  type DisplacedSession,
  type InfeasiblePolicy,
  SCHEDULE_INFEASIBLE_CODE,
  type ScheduleInfeasibleError,
  SLOT_TAKEN_CODE,
  type Session,
  type SlotPickResponse,
  type SlotTakenError,
} from "@zenflow/shared";
import { isAxiosError } from "axios";
import { describeSaveError } from "./save-error";
import { format } from "date-fns";

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
  showSplitToast(toast, describeSaveError(error, fallback), "destructive");
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

const POLICY_LABEL: Record<InfeasiblePolicy, string> = {
  ACCEPT_CONFLICTS: "Accept conflicts",
  ACCEPT_LATE_DEADLINE: "Accept late deadline",
};

/** Per-policy button accent, matching the web toast's tints
 * (`frontend/src/lib/toast.tsx` `POLICY_COPY`): rose = overlap, sky = late. */
const POLICY_COLOR: Record<InfeasiblePolicy, { light: string; dark: string }> =
  {
    ACCEPT_CONFLICTS: { light: "#e11d48", dark: "#fb7185" },
    ACCEPT_LATE_DEADLINE: { light: "#0284c7", dark: "#38bdf8" },
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
 * The 409 SLOT_TAKEN body when `error` is one, else null (#58).
 *
 * Keys on `code`, NOT on `statusCode === 409` — the 409 is already spoken for
 * by SCHEDULE_INFEASIBLE, and matching the status alone would swallow a
 * concurrent edit's infeasibility prompt.
 *
 * Raised by `POST /sessions/:id/slot-pick` with `chose: "alternative"` when a
 * `TASK` series sitting's alternative now overlaps a sibling: the two plans'
 * ledgers are independent, so a sibling can move into the window between the
 * create response and the pick. Nothing was recorded, so the pick can still be
 * answered "primary" afterwards.
 */
export function getSlotTakenError(error: unknown): SlotTakenError | null {
  if (!isAxiosError(error) || error.response?.status !== 409) return null;
  const body = error.response.data as Partial<SlotTakenError>;
  return body?.code === SLOT_TAKEN_CODE ? (body as SlotTakenError) : null;
}

/**
 * Run `attempt`; on a 409 SCHEDULE_INFEASIBLE show a toast with one action per
 * offered policy, each retrying via `attempt(policy)`. Results go to
 * `onSuccess`; any other failure (or a failed retry) goes to `onError`.
 */
export async function withInfeasibleRetry<T>(
  toast: ToastFn,
  attempt: (policy?: InfeasiblePolicy) => Promise<T>,
  onSuccess: (result: T) => void,
  onError: (error: unknown) => void,
): Promise<void> {
  const retry = async (policy: InfeasiblePolicy) => {
    try {
      onSuccess(await attempt(policy));
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
    const { title, description } = splitToastMessage(infeasible.message);
    toast(title, "warning", 12000, "bottom", false, undefined, {
      description,
      actions: infeasible.options.map((policy) => ({
        label: POLICY_LABEL[policy],
        color: POLICY_COLOR[policy],
        onPress: () => void retry(policy),
      })),
    });
    return;
  }
  // A throw while handling a *successful* save (bad response shape, a
  // navigation error…) must still surface, not reject out of `handleSubmit`.
  try {
    onSuccess(result);
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
  toast(`Moved ${n} flexible task${n === 1 ? "" : "s"} to make room`, "default", 4000);
}

/**
 * Toast shown after the user picks the alternative slot in a divergent
 * placement (issue #41). Matches the mockup: "Moved to [time]" + "Thanks — noted for next time".
 */
export function showAlternativePickToast(
  toast: ToastFn,
  alternativeSlot: string,
  tz: string,
): void {
  const when = format(zonedDate(alternativeSlot, tz), "h:mm a 'on' EEE MMM d");
  toast("Moved to " + when, "success", 4000, "bottom", false, undefined, {
    description: "Thanks — noted for next time",
  });
}

/**
 * The dismissible post-create prompt for a `TASK` series whose sittings
 * diverged (issue #59). Every sitting is already scheduled at its primary by
 * the time this shows, so the copy has to say so — the prompt is an offer, not
 * a gate.
 *
 * Variant `"info"` is load-bearing: the toast provider only auto-dismisses
 * `success` toasts (`components/ui/toast.tsx`, `autoDismiss = !confirm &&
 * variant === "success"`), so an `info` prompt stays up until the user opens
 * it or closes it.
 */
export function showSeriesAlternativesPrompt(
  toast: ToastFn,
  count: number,
  total: number,
  onView: () => void,
): void {
  toast(
    `${count} sitting${count === 1 ? "" : "s"} ${count === 1 ? "has" : "have"} an alternative`,
    "tip",
    undefined,
    "bottom",
    false,
    {
      label: "View",
      onPress: onView,
      color: { light: "#f97316", dark: "#fb923c" },
      inline: true,
      mockup: true,
    },
    {
      description: `All ${total} are already scheduled — swap any you like`,
    },
  );
}

/**
 * The 409 SLOT_TAKEN toast. Destructive, and states plainly that nothing moved
 * — the series sheet reverts that one card to its primary and leaves the rest
 * of the list usable, so the user must not think the pick landed.
 */
export function showSlotTakenToast(toast: ToastFn): void {
  toast(
    "That time was just taken",
    "destructive",
    undefined,
    "bottom",
    false,
    undefined,
    {
      description:
        "It now overlaps another sitting of this task, so that one stayed put. Try another time, or keep it as scheduled.",
    },
  );
}

/**
 * Confirmation after a series sitting is actually moved (#59). Reads its copy
 * off the `SlotPickResponse` rather than the request, so it reflects what the
 * server recorded rather than what we asked for.
 *
 * Model identity is deliberately absent: the user never sees which policy
 * proposed what (same rule as #41).
 */
export function showSeriesPickToast(
  toast: ToastFn,
  picked: SlotPickResponse,
  tz: string,
): void {
  if (picked.chosenByUser !== "alternative") return;
  const at = picked.session.scheduledStartTime;
  if (!at) return;
  const when = format(zonedDate(at, tz), "h:mm a 'on' EEE MMM d");
  toast("Moved to " + when, "success", 4000, "bottom", false, undefined, {
    description: "Thanks — noted for next time",
  });
}

/**
 * Result of a "switch all" / "keep all" pass (#59). The caller uses
 * `Promise.allSettled`, so one 409 never rolls back the sittings that did land
 * — report both counts instead of failing silently.
 */
export function showBulkPickToast(
  toast: ToastFn,
  applied: number,
  failed: number,
): void {
  if (failed === 0) {
    toast(
      `Updated ${applied} sitting${applied === 1 ? "" : "s"}`,
      "success",
      4000,
      "bottom",
    );
    return;
  }
  toast(
    `${applied} updated, ${failed} couldn't be`,
    "warning",
    6000,
    "bottom",
    false,
    undefined,
    {
      description: "The ones that clashed with another sitting stayed where they are.",
    },
  );
}

