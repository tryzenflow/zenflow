import type { SessionCardState } from "@zenflow/shared";

interface StateInput {
  status: string;
  deadline: string | null;
  scheduledStartTime: string | null;
  durationMinutes: number;
}

/**
 * Derive the visual card state for a task (see docs/design-system.md).
 *
 * There is no auto-placement engine anymore (CLAUDE.md — the EDF scheduler
 * was dropped), so "overdue" is purely a function of the task's own fields:
 * either its deadline has already passed, or it's scheduled to run past a
 * deadline it does have. "conflict" isn't derived here at all — it's folded
 * in afterward by {@link withOverlap} from a real client-side time-overlap
 * check, once layout has computed which blocks actually collide.
 */
export function deriveState(t: StateInput, now = new Date()): SessionCardState {
  if (t.status === "DONE") return "completed";
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
  state: SessionCardState,
  overlapping: boolean,
): SessionCardState {
  if (!overlapping || state === "completed") return state;
  return "conflict";
}

/** Semantic status classes — left-accent border + background per state. */
export const TASK_CARD_CLASSES: Record<SessionCardState, string> = {
  fluid: "glass-task border-l-primary",
  overdue:
    "bg-rose-50/40 dark:bg-rose-950/10 border-l-rose-500 text-rose-950 dark:text-rose-100",
  conflict:
    "bg-amber-50/40 dark:bg-amber-950/10 border-l-amber-500 text-amber-950 dark:text-amber-100",
  completed: "bg-muted border-l-emerald-500 opacity-60",
};
