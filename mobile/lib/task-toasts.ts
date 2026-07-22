import { placementQualifier, zonedDate } from "@zenflow/core";
import type { Task } from "@zenflow/shared";
import { format } from "date-fns";

export interface PlacementToastUser {
  workStart: number;
  workEnd: number;
  workDays: number[];
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
  task: Task,
  user: PlacementToastUser,
): { message: string; variant: "success" | "destructive" } {
  if (task.conflict || !task.scheduledStartTime) {
    return {
      message: `"${task.title}" couldn't be scheduled before its deadline`,
      variant: "destructive",
    };
  }

  const qualifier = placementQualifier(task, user);
  const suffix =
    qualifier === "pastDeadline"
      ? " — past its deadline"
      : qualifier === "outsideHours"
        ? " — outside your usual work hours"
        : "";

  const when = format(
    zonedDate(task.scheduledStartTime, user.timezone),
    "EEE MMM d, HH:mm",
  );
  return { message: `Scheduled for ${when}${suffix}`, variant: "success" };
}
