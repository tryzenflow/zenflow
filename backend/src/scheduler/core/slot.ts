import { TIME_GRANULARITY } from "../../common/constants";

export const MS_PER_MINUTE = 60_000;
export const SLOT_MS = TIME_GRANULARITY * MS_PER_MINUTE;
export const DAY_MS = 24 * 60 * MS_PER_MINUTE;

/** A half-open occupied interval, in epoch milliseconds. */
export interface Interval {
  start: number;
  end: number;
}

/** 'YYYY-MM-DD' for the given instant in the user's timezone. */
export function localDateStr(date: Date, timezone: string): string {
  // en-CA yields ISO-style YYYY-MM-DD; honours the IANA zone.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * Local calendar day a `deadline` instant belongs to for scheduling purposes.
 * Currently unused by the placers (which scan every day up to the deadline),
 * kept as a tested helper for deadline-day math.
 *
 * `deadlineOptions` (`sessions/utils/deadline-options.ts`) computes every
 * quick-action deadline except "Today" as an EXCLUSIVE period ceiling:
 * midnight (00:00) of the day AFTER the intended last day — "Tomorrow" =
 * 00:00 tomorrow, "No rush"/"This month" = 00:00 on the 1st of a future
 * month, "This week"/"Next week" = 00:00 the following Monday. Calling
 * {@link localDateStr} directly on that instant resolves to the day
 * STARTING at that midnight — one day too late: repacking that day gives
 * the session a scheduling window of `[dayStart, deadline)` where
 * `dayStart === deadline`, a zero-width window `bestFreeSlot`
 * (`../heuristic.ts`) can never fill, so `optimize` silently skips the
 * session (by design — "skipped, not errored") and it stays unscheduled
 * forever, with no error surfaced anywhere.
 *
 * Stepping back 1ms lands on the correct, intended last day for any
 * deadline that falls exactly on a day boundary, and is a no-op for any
 * deadline at a real time-of-day within a day (e.g. "Today"'s
 * `anchor + 3h`, or a "Custom" pick).
 */
export function deadlineDayStr(deadline: Date, timezone: string): string {
  return localDateStr(new Date(deadline.getTime() - 1), timezone);
}

/** Advance a 'YYYY-MM-DD' string by `n` days (DST-safe, pure UTC math). */
export function addDaysStr(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

/** Whole calendar days between two 'YYYY-MM-DD' strings (`b − a`), pure UTC math. */
export function dayDiffStr(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round(
    (Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / DAY_MS,
  );
}

/** ISO weekday for a 'YYYY-MM-DD' string: 1=Mon … 7=Sun. */
export function isoWeekday(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun … 6=Sat
  return dow === 0 ? 7 : dow;
}

/** Round an instant up to the next 15-minute slot boundary. */
export function ceilToSlot(ms: number): number {
  return Math.ceil(ms / SLOT_MS) * SLOT_MS;
}

/** Round an instant down to the previous 15-minute slot boundary. */
export function floorToSlot(ms: number): number {
  return Math.floor(ms / SLOT_MS) * SLOT_MS;
}

/** True when [aStart,aEnd) overlaps any interval in `occupied`. */
export function overlapsAny(
  occupied: Interval[],
  aStart: number,
  aEnd: number,
): boolean {
  for (const o of occupied) {
    if (aStart < o.end && aEnd > o.start) return true;
  }
  return false;
}
