import { minutesToUtc } from "../../common/utils";
import { TIME_GRANULARITY } from "../../common/constants";

/**
 * Slot / work-window math for the EDF engine. All calendar reasoning is done in
 * the user's IANA timezone, then converted to absolute UTC instants for
 * comparison. A "slot" is a {@link TIME_GRANULARITY}-minute (15) block.
 */

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

export interface WorkWindow {
  /** epoch ms of workStart on this date */
  start: number;
  /** epoch ms of workEnd on this date */
  end: number;
}

/**
 * Effective schedulable minutes of a (possibly wrapping) window.
 * A window wraps past midnight iff `workEnd <= workStart`; in that case it runs
 * from `workStart` on day D to `workEnd` on day D+1.
 */
export function workWindowMinutes(workStart: number, workEnd: number): number {
  return workEnd > workStart ? workEnd - workStart : 1440 - workStart + workEnd;
}

/**
 * Absolute UTC bounds of a user's working window anchored to a given local
 * date. When the window wraps past midnight (`workEnd <= workStart`), `end`
 * lands on the next calendar day.
 */
export function workWindowFor(
  dateStr: string,
  workStart: number,
  workEnd: number,
  timezone: string,
): WorkWindow {
  const wraps = workEnd <= workStart;
  const endDateStr = wraps ? addDaysStr(dateStr, 1) : dateStr;
  return {
    start: minutesToUtc(dateStr, workStart, timezone).getTime(),
    end: minutesToUtc(endDateStr, workEnd, timezone).getTime(),
  };
}

/**
 * Total minutes of `candidate` that fall OUTSIDE every work-hours window it
 * touches. Scans a small band of calendar days around the candidate (one day before
 * through one day past its span) so a work window anchored the PRIOR day but
 * wrapping past midnight (`workEnd <= workStart`) is still accounted for,
 * unions every window's overlap with `candidate` (de-duplicating any overlap
 * between a wrapping window and the next day's own window), and returns the
 * leftover duration. 0 when `candidate` sits entirely inside work hours.
 */
export function minutesOutsideWorkWindow(
  candidate: Interval,
  prefs: {
    workStart: number;
    workEnd: number;
    workDays: number[];
    timezone: string;
  },
): number {
  const totalMs = candidate.end - candidate.start;
  if (totalMs <= 0) return 0;

  const spanDays = Math.ceil(totalMs / (24 * 60 * MS_PER_MINUTE)) + 2; // + a day of slack on each side
  const covered: Interval[] = [];
  let dateStr = addDaysStr(
    localDateStr(new Date(candidate.start), prefs.timezone),
    -1,
  );
  for (let i = 0; i < spanDays; i++) {
    if (prefs.workDays.includes(isoWeekday(dateStr))) {
      const win = workWindowFor(
        dateStr,
        prefs.workStart,
        prefs.workEnd,
        prefs.timezone,
      );
      const start = Math.max(win.start, candidate.start);
      const end = Math.min(win.end, candidate.end);
      if (start < end) covered.push({ start, end });
    }
    dateStr = addDaysStr(dateStr, 1);
  }

  covered.sort((a, b) => a.start - b.start);
  let coveredMs = 0;
  let mergedEnd = -Infinity;
  for (const c of covered) {
    const start = Math.max(c.start, mergedEnd);
    if (c.end > start) {
      coveredMs += c.end - start;
      mergedEnd = Math.max(mergedEnd, c.end);
    }
  }

  return Math.max(0, (totalMs - coveredMs) / MS_PER_MINUTE);
}

/**
 * Index into the flat 168-int signed preference matrix for an instant, using
 * 1-hour buckets: `(isoWeekday-1) * 24 + hour`, where `hour` is the wall-clock
 * hour (0…23). 7 days × 24 one-hour buckets = 168 cells.
 */
export function preferenceIndex(date: Date, timezone: string): number {
  const dateStr = localDateStr(date, timezone);
  const day = isoWeekday(dateStr) - 1; // 0=Mon … 6=Sun
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  return day * 24 + hour;
}
