import { placementQualifier, zonedDate } from "@zenflow/core";
import type { Session } from "@zenflow/shared";
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
    // There is no auto-placement engine anymore (see CLAUDE.md / the
    // backend's EDF-scheduler removal) — `POST /sessions` never sets
    // `scheduledStartTime`, so a freshly created task always comes back
    // unscheduled. That's the normal, expected state, not a scheduling
    // failure — this used to read as a destructive "couldn't be scheduled
    // before its deadline" error and fired on *every* creation regardless
    // of whether a deadline was even set. Mirrors the identical fix already
    // made in `frontend/src/components/tasks/create-task-dialog.tsx`.
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
