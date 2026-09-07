import { formatInTimeZone } from "date-fns-tz";

/**
 * Frontend port of the DLU academic-calendar math in
 * `backend/src/ingestion/core/semester.ts` — just enough of it to label a
 * notification with the term it belongs to, so the ingestion inbox can collapse
 * a whole semester of "New class" rows into one group instead of listing every
 * lecture.
 *
 * Kept deliberately in lock-step with the backend: term boundaries are *weeks*
 * (the ISO week holding the last day of July / December / May), the academic
 * year is named for the calendar year its HK01 opens in, and the resolve point
 * is nudged {@link LOOKAHEAD_WEEKS} ahead so the changeover is seamless.
 *
 * DLU's calendar is anchored to Indochina time, not the viewer's timezone — a
 * run just after midnight at a term boundary must still resolve to the
 * university's term — so the timezone here is fixed, not `user.timezone`.
 */

/** DLU runs on Indochina Time; the academic calendar is anchored to it. */
const DLU_TZ = "Asia/Ho_Chi_Minh";
const DAY_MS = 86_400_000;

/**
 * How far ahead of `now` a term is resolved — DLU publishes a term's timetable
 * before it opens, so without this a student would see an empty group over
 * every changeover. Mirrors `SEMESTER_LOOKAHEAD_WEEKS`.
 */
const LOOKAHEAD_WEEKS = 2;

/** The three DLU terms, as the portal spells them. */
export type TermId = "HK01" | "HK02" | "HK03";

export interface Semester {
  /** Stable grouping key, e.g. `"2026-2027::HK01"`. */
  key: string;
  term: TermId;
  /** Academic year, `"2026-2027"`. */
  academicYear: string;
  /** Human label for the inbox group, e.g. `"Fall 2026"`. */
  label: string;
  /**
   * `'YYYY-MM-DD'` of the Monday opening the term's first week — the calendar's
   * fallback target when the first lecture's real date can't be read.
   */
  startDate: string;
}

/** HK term → the season students call it, and which end of the academic year it lands on. */
const SEASON: Record<TermId, { name: string; yearOffset: 0 | 1 }> = {
  HK01: { name: "Fall", yearOffset: 0 },
  HK02: { name: "Spring", yearOffset: 1 },
  HK03: { name: "Summer", yearOffset: 1 },
};

/** `'YYYY-MM-DD'` of `date` in DLU's timezone. */
const ymd = (date: Date): string => formatInTimeZone(date, DLU_TZ, "yyyy-MM-dd");

/** ISO weekday 1..7 (Mon..Sun) of a `'YYYY-MM-DD'` day. */
function isoWeekday(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return wd === 0 ? 7 : wd;
}

/** `'YYYY-MM-DD'` shifted by `days`. */
function addDaysStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** `'YYYY-MM-DD'` of the last day of `month` (1-based) in `year`. */
function lastDayOfMonthStr(year: number, month: number): string {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

/** `'YYYY-MM-DD'` of the Monday opening the ISO week that holds `dateStr`. */
function isoWeekStartStr(dateStr: string): string {
  return addDaysStr(dateStr, 1 - isoWeekday(dateStr));
}

/** Monday of the ISO week holding the last day of `month` — every DLU term boundary. */
function lastWeekStartStr(year: number, month: number): string {
  return isoWeekStartStr(lastDayOfMonthStr(year, month));
}

/** The three term-opening Mondays of the academic year opening in `startYear`. */
function termBoundaries(startYear: number): Record<TermId, string> {
  return {
    HK01: lastWeekStartStr(startYear, 7),
    HK02: lastWeekStartStr(startYear, 12),
    HK03: lastWeekStartStr(startYear + 1, 5),
  };
}

/**
 * Which DLU semester the instant `at` falls in. Mirrors `resolveSemester` in
 * `backend/src/ingestion/core/semester.ts` (label only — the FE never needs the
 * term's date window).
 */
export function resolveSemester(at: Date): Semester {
  const probe = ymd(new Date(at.getTime() + LOOKAHEAD_WEEKS * 7 * DAY_MS));
  const [probeYear] = probe.split("-").map(Number);

  // Before this July's HK01 opens we are still in the year that opened last July.
  const startYear =
    probe >= lastWeekStartStr(probeYear, 7) ? probeYear : probeYear - 1;
  const bounds = termBoundaries(startYear);

  // Plain string comparison: 'YYYY-MM-DD' sorts chronologically.
  const term: TermId =
    probe < bounds.HK02 ? "HK01" : probe < bounds.HK03 ? "HK02" : "HK03";

  const academicYear = `${startYear}-${startYear + 1}`;
  const season = SEASON[term];
  return {
    key: `${academicYear}::${term}`,
    term,
    academicYear,
    label: `${season.name} ${startYear + season.yearOffset}`,
    startDate: bounds[term],
  };
}
