import { zonedDate } from "@zenflow/core";
import type { SessionType } from "@zenflow/shared";
import { differenceInCalendarDays, format } from "date-fns";

/**
 * Per-session-type presentation — human label and the chip tint classes, keyed
 * by the raw {@link SessionType} (not the derived `SessionCardState`, so a
 * conflicting TASK still reads as a Task). The tints are the same palette
 * already used by `task-block.tsx`'s `stateClasses` and `lib/task-card.ts`'s
 * `MONTH_PILL_CLASSES` so a badge, a left-accent and a month pill all agree.
 *
 * The per-type icon lives in `components/calendar/session-type-badge.tsx` (it
 * pulls in `lucide-react-native`, which this RN-free module must not) — matched
 * to `components/tasks/form/session-type-tabs.tsx`.
 */
export interface SessionTypeMeta {
  label: string;
  /** `bg` + `border` for the badge chip. */
  badgeClass: string;
  /** Text + icon colour, paired with {@link badgeClass}. */
  textClass: string;
}

export const SESSION_TYPE_META: Record<SessionType, SessionTypeMeta> = {
  TASK: {
    label: "Task",
    badgeClass: "border-brand-orange/40 bg-brand-orange/15",
    textClass: "text-brand-orange",
  },
  ASSIGNMENT: {
    label: "Assignment",
    badgeClass: "border-teal-500/40 bg-teal-500/15",
    textClass: "text-teal-700 dark:text-teal-300",
  },
  EXAM: {
    label: "Exam",
    badgeClass: "border-rose-500/40 bg-rose-500/15",
    textClass: "text-rose-600 dark:text-rose-300",
  },
  LECTURE: {
    label: "Lecture",
    badgeClass: "border-sky-500/40 bg-sky-500/15",
    textClass: "text-sky-700 dark:text-sky-300",
  },
  DND: {
    label: "Do not disturb",
    badgeClass: "border-slate-400/40 bg-slate-500/15",
    textClass: "text-muted-foreground",
  },
};

/**
 * A deadline label that always carries the date — the bare `due 9:00 AM` it
 * replaces was ambiguous (which day?). Near-term deadlines read
 * `due today 9:00 AM` / `due tomorrow 9:00 AM`; anything else is
 * `due Mar 4, 9:00 AM`, with the year appended only when it differs from the
 * current one. All comparisons are in the user's timezone.
 */
export function formatDeadlineLabel(
  deadlineISO: string,
  tz: string,
  now: Date = new Date(),
): string {
  const due = zonedDate(deadlineISO, tz);
  const today = zonedDate(now, tz);
  const time = format(due, "h:mm a");
  const dayDiff = differenceInCalendarDays(due, today);

  if (dayDiff === 0) return `due today ${time}`;
  if (dayDiff === 1) return `due tomorrow ${time}`;

  const datePart =
    due.getFullYear() === today.getFullYear()
      ? format(due, "MMM d")
      : format(due, "MMM d yyyy");
  return `due ${datePart}, ${time}`;
}

/**
 * A terse deadline label for the inline "due" chip on a scheduled block — no
 * "due" prefix, no clock time unless the deadline falls on the reference day.
 * `ref` is the day the chip is shown against (the block's start), so the label
 * reads relative to where it's rendered, not wall-clock now:
 * - same day    → `3:00 PM`
 * - +1 day      → `tomorrow`
 * - this year   → `Mar 4`
 * - other year  → `Mar 4 2027`
 * All comparisons are in the user's timezone. A past-deadline block never
 * reaches this — the caller shows a "late" chip instead.
 */
export function formatDeadlineShort(
  deadlineISO: string,
  tz: string,
  ref: Date = new Date(),
): string {
  const due = zonedDate(deadlineISO, tz);
  const anchor = zonedDate(ref, tz);
  const dayDiff = differenceInCalendarDays(due, anchor);

  if (dayDiff === 0) return format(due, "h:mm a");
  if (dayDiff === 1) return "tomorrow";
  return due.getFullYear() === anchor.getFullYear()
    ? format(due, "MMM d")
    : format(due, "MMM d yyyy");
}
