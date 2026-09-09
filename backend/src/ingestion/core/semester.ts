import { fromZonedTime } from "date-fns-tz";
import {
  addDaysStr,
  DAY_MS,
  isoWeekday,
  localDateStr,
} from "../../scheduler/core/slot";

/**
 * DLU academic-calendar math.
 *
 * These values are **request parameters**, not scheduling inputs: the student
 * portal's timetable and exam endpoints are addressed by
 * `(academicYear, semester[, tuan])` — academic year, term, ISO week — and
 * there is no "give me everything current" call. So before a watcher can fetch
 * anything it has to work out which term "now" falls in, and — for the
 * timetable — which weeks that term spans.
 *
 * Pure: `now` is always a parameter, the timezone is always explicit (the
 * server does not run in `Asia/Ho_Chi_Minh`, so the host clock's month is not
 * the university's month around midnight at the turn of a term).
 */

/** The three DLU terms, as the portal spells them. */
export type TermId = "HK01" | "HK02" | "HK03";

/**
 * How far ahead of `now` a term is resolved.
 *
 * DLU publishes a term's timetable before the term opens, so resolving the
 * calendar strictly at `now` would leave a student staring at an empty
 * calendar over every changeover — the run on the last Sunday of December
 * would still be asking for semester 1. Looking two weeks ahead rolls the watchers
 * onto the new term while the outgoing one's rows are already stored, so the
 * switch is invisible.
 */
export const SEMESTER_LOOKAHEAD_WEEKS = 2;

/** The `(academicYear, semester)` pair the portal takes, plus the term's span. */
export interface ResolvedSemester {
  /** Academic year, `"2026-2027"`. */
  academicYear: string;
  /** Term id. */
  semester: TermId;
  /** First instant of the term — Monday 00:00 of its opening week, in `tz`. */
  startDate: Date;
  /** Last instant of the term — Sunday 23:59:59.999 of its final week, in `tz`. */
  endDate: Date;
}

/** Calendar year/month (1–12) of an instant in the given IANA timezone. */
function yearMonthIn(now: Date, tz: string): { year: number; month: number } {
  const [year, month] = localDateStr(now, tz).split("-").map(Number);
  return { year, month };
}

/** `'YYYY-MM-DD'` of the last day of `month` (1-based) in `year`. */
function lastDayOfMonthStr(year: number, month: number): string {
  // Day 0 of the *following* month is the last day of this one.
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

/** `'YYYY-MM-DD'` of the Monday opening the ISO week that holds `dateStr`. */
function isoWeekStartStr(dateStr: string): string {
  return addDaysStr(dateStr, 1 - isoWeekday(dateStr));
}

/**
 * Monday of the **last week** of `month` — the ISO week holding its last day.
 *
 * Every DLU term boundary is phrased that way ("the last week of July", "the
 * last week of December"), and such a week routinely straddles the month end:
 * the last week of July 2026 is Mon 27 Jul – Sun 2 Aug, which is equally "the
 * first week of August".
 */
function lastWeekStartStr(year: number, month: number): string {
  return isoWeekStartStr(lastDayOfMonthStr(year, month));
}

/**
 * The four week-boundaries of the academic year opening in `startYear`, as
 * `'YYYY-MM-DD'` Mondays. Each term runs up to, but not into, the next.
 */
function termBoundaries(startYear: number): Record<TermId | "end", string> {
  return {
    /** Last week of July — HK01 opens. */
    HK01: lastWeekStartStr(startYear, 7),
    /** Last week of December — HK01 closes, HK02 opens. */
    HK02: lastWeekStartStr(startYear, 12),
    /** Last week of May — HK02 closes, HK03 opens. */
    HK03: lastWeekStartStr(startYear + 1, 5),
    /** Last week of July again — HK03 closes on the week before it. */
    end: lastWeekStartStr(startYear + 1, 7),
  };
}

/** The instant a `'YYYY-MM-DD'` wall-clock day starts in timezone `tz`. */
function dayStartIn(dateStr: string, tz: string): Date {
  return fromZonedTime(`${dateStr}T00:00:00.000`, tz);
}

/**
 * Which `(academicYear, semester)` the instant `now` falls in, in timezone
 * `tz`, and the window that term covers.
 *
 * Terms, as DLU publishes them. Boundaries are *weeks*, not month ends, so a
 * `tuan` never has to be split across two terms:
 *  - **HK01** — the last week of July … the week before the last week of December
 *  - **HK02** — the last week of December … the week before the last week of May
 *  - **HK03** — the last week of May … the week before the last week of July
 *
 * The academic year is named for the calendar year its HK01 opens in, so the
 * Dec→Jan rollover does **not** change `academicYear`: December 2026 and
 * January 2027 are both `"2026-2027"`. The year only rolls where HK03 ends and
 * the next HK01 begins, in late July.
 *
 * `lookaheadWeeks` shifts the instant the term is *resolved* at (see
 * {@link SEMESTER_LOOKAHEAD_WEEKS}); it does not move the returned window, so
 * `startDate` is legitimately in the future for the last fortnight of a term.
 */
export function resolveSemester(
  now: Date,
  tz: string,
  lookaheadWeeks: number = SEMESTER_LOOKAHEAD_WEEKS,
): ResolvedSemester {
  const probe = localDateStr(
    new Date(now.getTime() + lookaheadWeeks * 7 * DAY_MS),
    tz,
  );
  const [probeYear] = probe.split("-").map(Number);

  // Before this July's HK01 opens we are still inside the year that opened
  // last July.
  const startYear =
    probe >= lastWeekStartStr(probeYear, 7) ? probeYear : probeYear - 1;
  const bounds = termBoundaries(startYear);

  // Plain string comparison: 'YYYY-MM-DD' sorts chronologically.
  const semester: TermId =
    probe < bounds.HK02 ? "HK01" : probe < bounds.HK03 ? "HK02" : "HK03";
  const nextStart =
    semester === "HK01"
      ? bounds.HK02
      : semester === "HK02"
        ? bounds.HK03
        : bounds.end;

  return {
    academicYear: `${startYear}-${startYear + 1}`,
    semester,
    startDate: dayStartIn(bounds[semester], tz),
    // A term ends the instant the next one opens.
    endDate: new Date(dayStartIn(nextStart, tz).getTime() - 1),
  };
}

/**
 * ISO-8601 week number (1–53) of a `'YYYY-MM-DD'` day.
 *
 * Standard ISO rule: the week a date belongs to is the week containing that
 * week's Thursday, and week 1 is the week containing 4 January. Computed with
 * pure `Date.UTC` arithmetic, so no DST or host-tz effects can leak in.
 */
function isoWeekOfStr(dateStr: string): number {
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));

  // Shift to the Thursday of this ISO week (Sunday counts as weekday 7).
  const weekday = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + 4 - weekday);

  // Week 1 is the week holding 1 January of the Thursday's year.
  const jan1 = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - jan1) / DAY_MS + 1) / 7);
}

/**
 * ISO-8601 week number (1–53) of `date` in timezone `tz` — the portal's `tuan`
 * parameter, and the `Week` field it echoes back.
 *
 * Verified against the captured timetable row: `Ngay: "17/08/2026"` carries
 * `Week: 34`, and 17 Aug 2026 is indeed the Monday of ISO week 34.
 */
export function isoWeek(date: Date, tz: string): number {
  return isoWeekOfStr(localDateStr(date, tz));
}

/**
 * Every `tuan` covering `[from, to]` in timezone `tz`, in calendar order.
 *
 * Week *numbers* cannot be enumerated arithmetically — they wrap 52 (or 53) →
 * 1 inside HK02, which straddles New Year — so this walks the calendar one
 * Monday at a time and reads each week's number off the date. The first entry
 * is the week `from` falls in even when `from` is mid-week: the portal answers
 * a whole week at a time, so a partial week still has to be fetched whole.
 *
 * Returns `[]` when `to` precedes the Monday of `from`'s week.
 */
export function isoWeeksBetween(from: Date, to: Date, tz: string): number[] {
  const last = localDateStr(to, tz);
  const weeks: number[] = [];
  for (
    let monday = isoWeekStartStr(localDateStr(from, tz));
    monday <= last;
    monday = addDaysStr(monday, 7)
  ) {
    weeks.push(isoWeekOfStr(monday));
  }
  return weeks;
}

/** A calendar year plus a **1-based** month (1 = January), as Moodle wants it. */
export interface CalendarMonth {
  year: number;
  month: number;
}

/**
 * The calendar month `now` falls in, in timezone `tz`, plus the `count - 1`
 * months that follow it.
 *
 * The LMS watcher fetches two: a quiz that opens on the 30th and closes on the
 * 2nd is a lone `open` event in one month's response and a complete
 * open/close pair in the next, so one month alone would silently drop it (see
 * `parse-lms.ts`). The timezone matters for the same reason it does in
 * `resolveSemester` — around midnight at a month boundary the server's month
 * and the university's month are different months.
 */
export function monthsFrom(
  now: Date,
  tz: string,
  count: number,
): CalendarMonth[] {
  const { year, month } = yearMonthIn(now, tz);
  const months: CalendarMonth[] = [];
  for (let i = 0; i < count; i++) {
    // Month indices are 1-based, so shift to 0-based for the divmod and back.
    const zeroBased = month - 1 + i;
    months.push({
      year: year + Math.floor(zeroBased / 12),
      month: (zeroBased % 12) + 1,
    });
  }
  return months;
}
