import { placementQualifier, zonedDate } from "@zenflow/core";
import type { DayRescheduleDiff, Session } from "@zenflow/shared";
import { format } from "date-fns";

export interface PlacementToastUser {
  timezone: string;
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
    return {
      message: `"${task.title}" couldn't be scheduled before its deadline`,
      variant: "destructive",
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

/**
 * Compose the implicit same-day-reschedule toast copy. Creating a session, or
 * editing an existing session's `deadline`, now transparently repacks that
 * one calendar day's other pending sessions server-side (EDF + preference-
 * matrix placement, single-day window, no preview, no undo — see
 * `CreateSessionResponse`/`UpdateSessionResponse`'s optional `dayReschedule`
 * field in `@zenflow/shared`). This replaced the old explicit
 * `POST /scheduler/optimize` action entirely (see `mobile/README.md`). Same
 * one-line, count-and-go messaging pattern as `placementToastMessage` above —
 * returns `null` when nothing else moved, so the caller can skip showing a
 * second toast.
 */
export function dayRescheduleToastMessage(
  diffs: DayRescheduleDiff[],
): string | null {
  if (diffs.length === 0) return null;
  return `${diffs.length} other session${
    diffs.length === 1 ? "" : "s"
  } moved today`;
}
