import { format } from "date-fns";
import { zonedDate, zonedWallClockToUtc } from "./tz";

/**
 * Wall-clock ⇄ true-UTC-instant conversions for the fixed-time session forms.
 * Every calendar `Date` in the apps carries the user-tz wall clock in its local
 * fields (CLAUDE.md §5 / `tz.ts`); these helpers are the boundary where a
 * form's `date` / `startTime` strings cross to and from a real `Z` instant for
 * the API. Shared by both clients' create screens and "Move to…" dialogs.
 */

const HHMM_MAX = 23 * 60 + 45;

function minutesToHhmm(minutes: number): string {
  const m = Math.max(0, Math.min(minutes, HHMM_MAX));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(
    m % 60,
  ).padStart(2, "0")}`;
}

/**
 * `date` (`yyyy-MM-dd`) + `startTime` (`HH:mm`), read as `tz` wall clock → the
 * real UTC ISO instant they denote.
 */
export function combineToUtc(
  date: string,
  startTime: string,
  tz: string,
): string {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = startTime.split(":").map(Number);
  const wall = new Date(y, mo - 1, d, h, mi, 0, 0);
  return zonedWallClockToUtc(wall, tz).toISOString();
}

/**
 * Inverse of {@link combineToUtc}: a real UTC ISO instant → the `tz` calendar
 * date + time-of-day it falls on, as the form-field strings.
 */
export function splitZoned(
  iso: string,
  tz: string,
): { date: string; startTime: string } {
  const wall = zonedDate(iso, tz);
  return {
    date: format(wall, "yyyy-MM-dd"),
    startTime: format(wall, "HH:mm"),
  };
}

/**
 * `HH:mm` advanced by `delta` minutes, clamped to `max` (default 23:45 — the
 * latest 15-min-grid start). Seeds a fixed session's end time from its start.
 */
export function shiftHhmm(hhmm: string, delta: number, max = "23:45"): string {
  const [h, m] = hhmm.split(":").map(Number);
  const [mh, mm] = max.split(":").map(Number);
  return minutesToHhmm(Math.min(h * 60 + m + delta, mh * 60 + mm));
}
