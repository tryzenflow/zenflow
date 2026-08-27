import type { SessionCardState } from "@zenflow/shared";

export { deriveState, withOverlap, TASK_CARD_CLASSES } from "@zenflow/core";

/**
 * Month-grid pill background/left-accent classes per state — RN/NativeWind
 * sizing of `@zenflow/core`'s `TASK_CARD_CLASSES`, adapted for the Month
 * View's compact pill instead of a full day-timeline card.
 */
export const MONTH_PILL_CLASSES: Record<SessionCardState, string> = {
  fluid: "bg-brand-orange/[0.18] border-l-primary",
  overdue: "bg-rose-500/15 border-l-rose-500",
  conflict: "bg-amber-500/15 border-l-amber-500",
  // No extra `opacity-60` — the mockup dims completed pills purely via
  // `bg-muted` + muted-foreground text + line-through.
  completed: "bg-muted border-l-emerald-500",
};

/** Pill label text color per state, paired with {@link MONTH_PILL_CLASSES}. */
export const MONTH_PILL_TEXT_CLASSES: Record<SessionCardState, string> = {
  fluid: "text-brand-orange",
  overdue: "text-rose-600 dark:text-rose-300",
  conflict: "text-amber-700 dark:text-amber-300",
  completed: "text-muted-foreground line-through",
};
