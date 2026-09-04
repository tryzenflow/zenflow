import type { SessionCardState } from "@zenflow/shared";

export { deriveState, withOverlap, TASK_CARD_CLASSES } from "@zenflow/core";

/**
 * Month-grid pill background/left-accent classes per state — RN/NativeWind
 * sizing of `@zenflow/core`'s `TASK_CARD_CLASSES`, adapted for the Month
 * View's compact pill instead of a full day-timeline card. One colour per
 * session type so assignment / exam / lecture / DND are all distinguishable
 * at pill size; a flexible TASK keeps the brand-orange treatment.
 */
export const MONTH_PILL_CLASSES: Record<SessionCardState, string> = {
  fluid: "bg-brand-orange/[0.18] border-l-primary",
  conflict: "bg-amber-500/15 border-l-amber-500",
  assignment: "bg-teal-500/15 border-l-teal-500",
  exam: "bg-rose-500/15 border-l-rose-500",
  lecture: "bg-sky-500/15 border-l-sky-500",
  dnd: "bg-slate-500/15 border-l-slate-400 [border-left-style:dashed]",
};

/** Pill label text color per state, paired with {@link MONTH_PILL_CLASSES}. */
export const MONTH_PILL_TEXT_CLASSES: Record<SessionCardState, string> = {
  fluid: "text-brand-orange",
  conflict: "text-amber-700 dark:text-amber-300",
  assignment: "text-teal-700 dark:text-teal-300",
  exam: "text-rose-600 dark:text-rose-300",
  lecture: "text-sky-700 dark:text-sky-300",
  dnd: "text-muted-foreground",
};
