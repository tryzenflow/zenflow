import { localDateStr } from "../../scheduler/core/slot";

/**
 * DLU academic-calendar math.
 *
 * These values are **request parameters**, not scheduling inputs: the student
 * portal's timetable and exam endpoints are addressed by
 * `(namhoc, hocky[, tuan])` — academic year, term, ISO week — and there is no
 * "give me everything current" call. So before a watcher can fetch anything it
 * has to work out which term "now" falls in.
 *
 * Pure: `now` is always a parameter, the timezone is always explicit (the
 * server does not run in `Asia/Ho_Chi_Minh`, so the host clock's month is not
 * the university's month around midnight at the turn of a term).
 */

/** The three DLU terms, as the portal spells them. */
export type TermId = "HK01" | "HK02" | "HK03";

/** The `(namhoc, hocky)` pair the portal endpoints take. */
export interface ResolvedSemester {
  /** Academic year, `"2026-2027"`. */
  namhoc: string;
  /** Term id. */
  hocky: TermId;
}

/** Calendar year/month (1–12) of an instant in the given IANA timezone. */
function yearMonthIn(now: Date, tz: string): { year: number; month: number } {
  const [year, month] = localDateStr(now, tz).split("-").map(Number);
  return { year, month };
}

/**
 * Which `(namhoc, hocky)` the instant `now` falls in, in timezone `tz`.
 *
 * Terms (per `INTEGRATION_DOCS.md`):
 *  - **HK01** — August … December
 *  - **HK02** — January … May
 *  - **HK03** — June … July
 *
 * The academic year is named for the calendar year its HK01 starts in, so the
 * Dec→Jan rollover does **not** change `namhoc`: December 2026 and January
 * 2027 are both `"2026-2027"`. The year only rolls at the Jul→Aug boundary,
 * which is exactly where HK03 ends and the next HK01 begins.
 */
export function resolveSemester(now: Date, tz: string): ResolvedSemester {
  const { year, month } = yearMonthIn(now, tz);

  const hocky: TermId = month >= 8 ? "HK01" : month >= 6 ? "HK03" : "HK02";
  // month >= 8 → we are in the first half of the academic year; otherwise we
  // are in the tail of the one that started last August.
  const startYear = month >= 8 ? year : year - 1;

  return { namhoc: `${startYear}-${startYear + 1}`, hocky };
}

/**
 * ISO-8601 week number (1–53) of `date` in timezone `tz` — the portal's `tuan`
 * parameter, and the `Week` field it echoes back.
 *
 * Verified against the captured timetable row: `Ngay: "17/08/2026"` carries
 * `Week: 34`, and 17 Aug 2026 is indeed the Monday of ISO week 34.
 *
 * Standard ISO rule: the week a date belongs to is the week containing that
 * week's Thursday, and week 1 is the week containing 4 January. Computed with
 * pure `Date.UTC` arithmetic on the localized date parts, so no DST or host-tz
 * effects can leak in.
 */
export function isoWeek(date: Date, tz: string): number {
  const [year, month, day] = localDateStr(date, tz).split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));

  // Shift to the Thursday of this ISO week (Sunday counts as weekday 7).
  const isoWeekday = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + 4 - isoWeekday);

  // Week 1 is the week holding 1 January of the Thursday's year.
  const jan1 = Date.UTC(d.getUTCFullYear(), 0, 1);
  const daysSinceJan1 = (d.getTime() - jan1) / 86_400_000;
  return Math.ceil((daysSinceJan1 + 1) / 7);
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
