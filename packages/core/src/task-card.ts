import type { SessionCardState, SessionType } from "@zenflow/shared";

interface StateInput {
  type: SessionType;
}

/**
 * Derive the visual card state for a session (see docs/design-system.md).
 *
 * The state is a pure function of the session `type` — there is no completion
 * or "overdue" lifecycle. Each fixed type gets its own colour so an
 * assignment, an exam and a lecture read as three different things rather than
 * one undifferentiated "fixed" slate; `DND` blocks get the muted
 * blocked-time treatment. A past-deadline session is NOT special-cased here —
 * it simply renders in its type colour. "conflict" isn't derived here either —
 * {@link withOverlap} folds it in afterward from a real client-side overlap
 * check.
 */
export function deriveState(t: StateInput): SessionCardState {
  switch (t.type) {
    case "DND":
      return "dnd";
    case "ASSIGNMENT":
      return "assignment";
    case "EXAM":
      return "exam";
    case "LECTURE":
      return "lecture";
    default:
      return "fluid"; // TASK — the only flexible, auto-scheduled type
  }
}

/**
 * Fold a manually-created overlap into a card's state. Two sessions scheduled
 * on top of each other are a conflict, so they render with the conflict
 * treatment — unless the card is a DND block (protected time can sit under a
 * live session without it being a clash).
 */
export function withOverlap(
  state: SessionCardState,
  overlapping: boolean,
): SessionCardState {
  if (!overlapping || state === "dnd") return state;
  return "conflict";
}

/** Semantic status classes — left-accent border + background per state. */
export const TASK_CARD_CLASSES: Record<SessionCardState, string> = {
  fluid: "glass-task border-l-primary",
  conflict:
    "bg-amber-50/40 dark:bg-amber-950/10 border-l-amber-500 text-amber-950 dark:text-amber-100",
  assignment:
    "bg-teal-50/50 dark:bg-teal-950/20 border-l-teal-500 text-teal-900 dark:text-teal-100",
  exam: "bg-rose-50/50 dark:bg-rose-950/20 border-l-rose-500 text-rose-900 dark:text-rose-100",
  lecture:
    "bg-sky-50/50 dark:bg-sky-950/20 border-l-sky-500 text-sky-900 dark:text-sky-100",
  // Blocked / protected time: a dashed slate accent + muted slate wash. The
  // mockup dresses this same slot with a diagonal hatch (`hatch-dnd`); the
  // apps keep it flat since neither RN nor the web card carries that utility.
  dnd: "bg-slate-100/60 dark:bg-slate-800/25 border-l-slate-400 [border-left-style:dashed]",
};
