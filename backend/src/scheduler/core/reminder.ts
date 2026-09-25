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

/**
 * When to fire a reminder for `startsAt`. The nominal instant is
 * `startsAt - remindBeforeMinutes`; if that is already past but the session has
 * not started (the deadline-supersedes-reminder rule — a late-set "1 hour
 * before" for something starting in 20 min), it fires right now instead. A
 * session that already started yields `null`.
 */
export function planReminder(
  startsAt: Date,
  remindBeforeMinutes: number,
  now: Date,
): ReminderPlan | null {
  if (startsAt.getTime() <= now.getTime()) return null;
  const nominal = startsAt.getTime() - remindBeforeMinutes * MIN_MS;
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
        content: `Your exam starts at ${at}${where}. Time for a last look at your notes.`,
      };
    case "ASSIGNMENT":
      return {
        title: `Due in ${lead}: ${t}`,
        content: `${t} is due at ${at}. Make sure it's submitted before the deadline.`,
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
