import { minutesToUtc } from "../../common/utils";
import { TIME_GRANULARITY } from "../../common/constants";

export const MS_PER_MINUTE = 60_000;
export const SLOT_MS = TIME_GRANULARITY * MS_PER_MINUTE;

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

/** Advance a 'YYYY-MM-DD' string by `n` days (DST-safe, pure UTC math). */
export function addDaysStr(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
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
