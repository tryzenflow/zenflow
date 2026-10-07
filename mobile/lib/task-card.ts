import type { SessionCardState } from "@zenflow/shared";

export { deriveState, withOverlap, TASK_CARD_CLASSES } from "@zenflow/core";

/**
 * Month-grid pill background/outline classes per state — RN/NativeWind
 * sizing of `@zenflow/core`'s `TASK_CARD_CLASSES`, adapted for the Month
 * View's compact pill instead of a full day-timeline card. One colour per
 * session type so assignment / exam / lecture / DND are all distinguishable
 * at pill size (a hairline outline in the hue, dashed for DND); a flexible TASK keeps the brand-orange treatment.
 */
export const MONTH_PILL_CLASSES: Record<SessionCardState, string> = {
  fluid: "bg-brand-orange/[0.18] border-primary/50",
  conflict: "bg-warning/15 border-warning/50",
  assignment: "bg-teal-500/15 border-teal-500/50",
  exam: "bg-rose-500/15 border-rose-500/50",
  lecture: "bg-sky-500/15 border-sky-500/50",
  dnd: "bg-slate-500/15 border-slate-400/60 border-dashed",
};

/** Pill label text color per state, paired with {@link MONTH_PILL_CLASSES}. */
export const MONTH_PILL_TEXT_CLASSES: Record<SessionCardState, string> = {
  fluid: "text-primary-text",
  conflict: "text-warning",
  assignment: "text-teal-700 dark:text-teal-300",
  exam: "text-rose-600 dark:text-rose-300",
  lecture: "text-sky-700 dark:text-sky-300",
  dnd: "text-muted-foreground",
};
