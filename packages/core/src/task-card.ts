import type { TaskCardState } from "@zenflow/shared";

interface StateInput {
  status: string;
  conflict: boolean;
  deadline: string | null;
  scheduledStartTime: string | null;
  durationMinutes: number;
}

/**
 * Derive the visual card state for a task (see docs/design-system.md).
 *
 * A task is "overdue" both once its deadline has already passed AND when the
 * cost-based scheduler (backend/src/scheduler/utils/edf.ts) couldn't find room
 * before a tight deadline and placed it past it anyway — that placement is
 * itself an overdue result the moment it lands, not just once the clock
 * catches up to the deadline.
 */
export function deriveState(t: StateInput, now = new Date()): TaskCardState {
  if (t.status === "DONE") return "completed";
  if (t.conflict) return "conflict";
  if (t.deadline) {
    const deadlineMs = new Date(t.deadline).getTime();
    if (deadlineMs < now.getTime()) return "overdue";
    if (
      t.scheduledStartTime &&
      new Date(t.scheduledStartTime).getTime() + t.durationMinutes * 60_000 >
        deadlineMs
    )
      return "overdue";
  }
  return "fluid";
}

/**
 * Fold a manually-created overlap into a card's state. Two tasks scheduled on
 * top of each other are a conflict the engine didn't make, so they render with
 * the conflict treatment — unless the card is already done (a finished task can
 * sit under a live one without it being a real clash).
 */
export function withOverlap(
  state: TaskCardState,
  overlapping: boolean,
): TaskCardState {
  if (!overlapping || state === "completed") return state;
  return "conflict";
}

/** Semantic status classes — left-accent border + background per state. */
export const TASK_CARD_CLASSES: Record<TaskCardState, string> = {
  fluid: "glass-task border-l-primary",
  overdue:
    "bg-rose-50/40 dark:bg-rose-950/10 border-l-rose-500 text-rose-950 dark:text-rose-100",
  conflict:
    "bg-amber-50/40 dark:bg-amber-950/10 border-l-amber-500 text-amber-950 dark:text-amber-100",
  completed: "bg-muted border-l-emerald-500 opacity-60",
};
