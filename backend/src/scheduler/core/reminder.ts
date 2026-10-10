/**
 * Session-reminder timing and copy — pure. No I/O, no clock: `now` is passed
 * in (see `reminders/reminders.service.ts` for the timers and delivery).
 */

const MIN_MS = 60_000;

export interface ReminderPlan {
  /** The occurrence start the reminder is about. */
  startsAt: Date;
  /** When to deliver it (never before `now`). */
  fireAt: Date;
}

/** Sort descending (earliest-firing first), drop duplicates. */
export function normalizeReminderMinutes(minutes: readonly number[]): number[] {
  return [...new Set(minutes)].sort((a, b) => b - a);
}

/**
 * The first candidate start that is still in the future and that this reminder
 * has not already fired for. `candidates` are occurrence starts (one entry for
 * a plain session, the upcoming occurrences for a recurring series).
 */
export function pickReminderStart(
  candidates: readonly Date[],
  firedForStart: Date | null,
  now: Date,
): Date | null {
  const sorted = [...candidates].sort((a, b) => a.getTime() - b.getTime());
  for (const c of sorted) {
    if (c.getTime() <= now.getTime()) continue; // already started -> skip
    if (firedForStart && firedForStart.getTime() === c.getTime()) continue;
    return c;
  }
  return null;
}

/** A reminder set on create/edit must fire at least this far in the future. */
export const MIN_REMINDER_LEAD_MS = MIN_MS;
/**
 * A reminder missed by at most this much still fires. It must exceed the
 * worker's 5-minute sweep, or a reminder saved just after a sweep (the worker
 * only sees API edits on the next one) could land past the window and be lost.
 */
export const REMINDER_CATCH_UP_MS = 6 * MIN_MS;

/**
 * Create/edit path: is a reminder `remindBeforeMinutes` before `startsAt` too
 * late to be worth storing? True when its nominal instant is already past or
 * within {@link MIN_REMINDER_LEAD_MS} of `now`.
 */
export function isReminderTooLate(
  startsAt: Date,
  remindBeforeMinutes: number,
  now: Date,
): boolean {
  const nominal = startsAt.getTime() - remindBeforeMinutes * MIN_MS;
  return nominal - now.getTime() < MIN_REMINDER_LEAD_MS;
}

/**
 * When to fire a reminder for `startsAt`. The nominal instant is
 * `startsAt - remindBeforeMinutes`. If it is still ahead, that is the fire
 * time. If it was missed by at most `catchUpMs` (restart / sweep catch-up) it
 * fires right now; anything older is dropped (`null`), as is a session that
 * already started.
 */
export function planReminder(
  startsAt: Date,
  remindBeforeMinutes: number,
  now: Date,
  catchUpMs: number = REMINDER_CATCH_UP_MS,
): ReminderPlan | null {
  if (startsAt.getTime() <= now.getTime()) return null;
  const nominal = startsAt.getTime() - remindBeforeMinutes * MIN_MS;
  if (now.getTime() - nominal > catchUpMs) return null;
  return {
    startsAt,
    fireAt: new Date(Math.max(nominal, now.getTime())),
  };
}

const plural = (n: number, unit: string): string =>
  `${n} ${unit}${n === 1 ? "" : "s"}`;

/** "1 hour", "30 minutes", "2 days", "1 hour 30 minutes". */
export function formatLeadTime(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return plural(m, "minute");
  if (m % 1440 === 0) return plural(m / 1440, "day");
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h >= 24) {
    const d = Math.floor(h / 24);
    const hh = h % 24;
    return hh === 0 && rest === 0
      ? plural(d, "day")
      : `${plural(d, "day")} ${plural(hh, "hour")}${rest ? ` ${plural(rest, "minute")}` : ""}`;
  }
  return rest === 0
    ? plural(h, "hour")
    : `${plural(h, "hour")} ${plural(rest, "minute")}`;
}

/** Wall-clock start in the user's zone, e.g. "Sat, 20 Sep, 14:00". */
export function formatStart(startsAt: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(startsAt);
}

export interface ReminderText {
  title: string;
  content: string;
}

/**
 * Notification copy. The lead in the title is the *actual* time left when the
 * reminder is delivered (rounded to a minute), which equals the configured
 * lead unless the reminder fired late. Exams, assignments and lectures (the
 * ingested types) get their own wording; everything else uses the generic
 * "<title> starts in …" form.
 */
export function buildReminderText(input: {
  sessionTitle: string;
  startsAt: Date;
  now: Date;
  timezone: string;
  location?: string | null;
  type?: string | null;
}): ReminderText {
  const left = Math.max(
    1,
    Math.round((input.startsAt.getTime() - input.now.getTime()) / MIN_MS),
  );
  const lead = formatLeadTime(left);
  const at = formatStart(input.startsAt, input.timezone);
  const where = input.location ? ` in ${input.location}` : "";
  const t = input.sessionTitle;
  switch (input.type) {
    case "EXAM":
      return {
        title: `Exam in ${lead}: ${t}`,
        content: `Starts at ${at}${where}. Good luck!`,
      };
    case "ASSIGNMENT":
      return {
        title: `Due in ${lead}: ${t}`,
        content: `Due at ${at}. Submit it now.`,
      };
    case "LECTURE":
      return {
        title: `Class in ${lead}: ${t}`,
        content: `${t} begins at ${at}${where}.`,
      };
    case "TASK":
      return {
        title: `Task starts in ${lead}: ${t}`,
        content: `${t} starts at ${at}${input.location ? ` at ${input.location}` : ""}.`,
      };
    default:
      return {
        title: `Event starts in ${lead}: ${t}`,
        content: `${t} starts at ${at}${input.location ? ` at ${input.location}` : ""}.`,
      };
  }
}
