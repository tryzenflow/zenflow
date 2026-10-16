import type { SessionCardState } from "@zenflow/shared";
import { SESSION_TONE_CLASSES, SESSION_TONES, sessionTone } from "@zenflow/core";

export { deriveState, withOverlap, TASK_CARD_CLASSES } from "@zenflow/core";

/**
 * Month-grid pill fill and left accent per state: the tone tint sized for
 * the Month View's compact pill. Class strings live in `@zenflow/core`'s
 * palette, which the Tailwind content globs scan.
 */
export const MONTH_PILL_CLASSES: Record<SessionCardState, string> = {
  fluid: `${SESSION_TONE_CLASSES.task.tint} border-l-session-task`,
  conflict: `${SESSION_TONE_CLASSES.conflict.tint} border-l-session-conflict`,
  assignment: `${SESSION_TONE_CLASSES.assignment.tint} border-l-session-assignment`,
  exam: `${SESSION_TONE_CLASSES.exam.tint} border-l-session-exam`,
  lecture: `${SESSION_TONE_CLASSES.lecture.tint} border-l-session-lecture`,
  dnd: `${SESSION_TONE_CLASSES.dnd.tint} border-l-session-dnd [border-left-style:dashed]`,
};

/** Pill classes for a late or overdue session. */
export const MONTH_PILL_LATE_CLASSES = `${SESSION_TONE_CLASSES.late.tint} border-l-session-late`;

/** Pill label text color per state, paired with {@link MONTH_PILL_CLASSES}. */
export const MONTH_PILL_TEXT_CLASSES: Record<SessionCardState, string> = {
  fluid: SESSION_TONE_CLASSES.task.text,
  conflict: SESSION_TONE_CLASSES.conflict.text,
  assignment: SESSION_TONE_CLASSES.assignment.text,
  exam: SESSION_TONE_CLASSES.exam.text,
  lecture: SESSION_TONE_CLASSES.lecture.text,
  dnd: SESSION_TONE_CLASSES.dnd.text,
};

/** Label color for a month pill, late winning over the state. The drag ghost
 * floats in a rotated animated layer where `dark:` utilities rendered black
 * text, so it paints from explicit hex instead. */
export function pillTextColor(
  state: SessionCardState,
  late: boolean,
  dark: boolean,
): string {
  return SESSION_TONES[sessionTone(state, late)].ink[dark ? "dark" : "light"];
}
