import type { TaskCardState } from "@zenflow/shared";

interface StateInput {
  status: string;
  conflict: boolean;
  deadline: string | null;
  scheduledStartTime: string | null;
  durationMinutes: number;
}

/**
 * Hand-synced RN port of `frontend/src/lib/task-card.ts`'s `deriveState` —
 * pure date-in/state-out logic with no DOM dependency, so it's the identical
 * function, just kept in `mobile/` rather than `@zenflow/core` for now (the
 * same situation `taskSchema` was in before RN migration Phase 5 hoisted it).
 * If this drifts from the frontend copy, that's tech debt to flag/hoist to
 * `@zenflow/core` — don't further fork the logic in a third place.
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
 * Month-grid pill background/left-accent classes per state — RN/NativeWind
 * sizing of `frontend/src/lib/task-card.ts`'s `TASK_CARD_CLASSES`, adapted
 * for the Month View's compact pill instead of a full day-timeline card.
 */
export const MONTH_PILL_CLASSES: Record<TaskCardState, string> = {
  fluid: "bg-brand-orange/[0.18] border-l-primary",
  overdue: "bg-rose-500/15 border-l-rose-500",
  conflict: "bg-amber-500/15 border-l-amber-500",
  completed: "bg-muted border-l-emerald-500 opacity-60",
};

/** Pill label text color per state, paired with {@link MONTH_PILL_CLASSES}. */
export const MONTH_PILL_TEXT_CLASSES: Record<TaskCardState, string> = {
  fluid: "text-brand-orange",
  overdue: "text-rose-600 dark:text-rose-300",
  conflict: "text-amber-700 dark:text-amber-300",
  completed: "text-muted-foreground line-through",
};
