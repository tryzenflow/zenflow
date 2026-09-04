import { RRule } from "rrule";
import { fromZonedTime, toZonedTime } from "date-fns-tz";

/**
 * The `Session.id` a virtual (rrule-expanded) occurrence is surfaced under on
 * the wire: the series id and the occurrence's exact UTC instant, joined by
 * `::`. Real session rows use a bare uuid, so the separator is unambiguous.
 */
export function occurrenceId(seriesId: string, start: Date): string {
  return `${seriesId}::${start.toISOString()}`;
}

/**
 * Inverse of {@link occurrenceId}. Returns `null` for a plain (non-synthetic)
 * id, so callers can `?? fall through` to the normal single-row path.
 */
export function parseOccurrenceId(
  id: string,
): { seriesId: string; startISO: string } | null {
  const sep = id.indexOf("::");
  if (sep <= 0) return null;
  const seriesId = id.slice(0, sep);
  const startISO = id.slice(sep + 2);
  const d = new Date(startISO);
  // Require a strict, round-trippable ISO instant so a stray "::" in some other
  // id shape can't be mistaken for an occurrence ref.
  if (Number.isNaN(d.getTime()) || d.toISOString() !== startISO) return null;
  return { seriesId, startISO };
}

/**
 * Expand a session series' RRULE into concrete occurrence start instants.
 *
 * Pure — no I/O, no clock. `dtstart` is the real UTC instant of the first
 * occurrence (the representative `Session.scheduledStartTime`); `rrule` is the
 * bare `RRULE:` line (no `DTSTART`). Occurrences are computed on the calendar
 * the user sees (`timezone`), so a weekly 09:00 block stays at 09:00 wall-clock
 * across DST changes rather than drifting by the offset delta.
 *
 * `exdates` are occurrence instants (ISO strings) the user has deleted
 * individually — they are filtered out of the result.
 *
 * Returns the occurrence starts whose instant falls in `[rangeStart, rangeEnd)`.
 */
export function expandRrule(
  rrule: string,
  dtstart: Date,
  rangeStart: Date,
  rangeEnd: Date,
  timezone: string,
  exdates: string[] = [],
): Date[] {
  const excluded = new Set(
    exdates.map((e) => {
      const t = new Date(e).getTime();
      return Number.isNaN(t) ? e : String(t);
    }),
  );
  const options = RRule.parseString(rrule);
  // Anchor the rule at the wall-clock of `dtstart` in the user's zone, encoded
  // into a naive (UTC-fields-are-wall-clock) Date so `rrule` — which is
  // timezone-blind — walks the right calendar days and times.
  const rule = new RRule({ ...options, dtstart: toNaive(dtstart, timezone) });

  // Widen the query window by a day on each side so an occurrence near the
  // boundary isn't dropped by the naive/real offset before the exact filter.
  const DAY_MS = 24 * 60 * 60 * 1000;
  const naiveOccurrences = rule.between(
    new Date(toNaive(rangeStart, timezone).getTime() - DAY_MS),
    new Date(toNaive(rangeEnd, timezone).getTime() + DAY_MS),
    true,
  );

  return naiveOccurrences
    .map((occ) => fromNaive(occ, timezone))
    .filter(
      (d) =>
        d.getTime() >= rangeStart.getTime() &&
        d.getTime() < rangeEnd.getTime() &&
        !excluded.has(String(d.getTime())),
    )
    .sort((a, b) => a.getTime() - b.getTime());
}

/**
 * Return `rrule` with its `UNTIL` set to `until` (any existing `UNTIL` /
 * `COUNT` bound is replaced). Used to "delete this and every following
 * occurrence" — the series simply stops before `until`. `until` is encoded as
 * the RFC 5545 UTC form `YYYYMMDDTHHMMSSZ`; the caller passes the instant just
 * before the first occurrence to drop.
 */
export function rruleWithUntil(rrule: string, until: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  const stamp =
    `${p(until.getUTCFullYear(), 4)}${p(until.getUTCMonth() + 1)}${p(until.getUTCDate())}` +
    `T${p(until.getUTCHours())}${p(until.getUTCMinutes())}${p(until.getUTCSeconds())}Z`;
  const parts = rrule
    .replace(/^RRULE:/i, "")
    .split(";")
    .filter((s) => s && !/^UNTIL=/i.test(s) && !/^COUNT=/i.test(s));
  parts.push(`UNTIL=${stamp}`);
  return parts.join(";");
}

/**
 * Return `anchor`'s calendar day (in `timezone`) at `desired`'s wall-clock
 * time-of-day. Used when a recurring series is edited on one occurrence: the
 * user can shift the *time* ("move my 9am lecture to 10am" → every occurrence
 * moves) but the series' first-occurrence *date* stays put, so no occurrences
 * are dropped by moving the rrule anchor forward.
 */
export function reanchorTimeOfDay(
  anchor: Date,
  desired: Date,
  timezone: string,
): Date {
  const a = toZonedTime(anchor, timezone);
  const d = toZonedTime(desired, timezone);
  a.setHours(d.getHours(), d.getMinutes(), d.getSeconds(), 0);
  return fromZonedTime(a, timezone);
}

/** The first occurrence at or after `dtstart` — used to place the representative row. */
export function firstOccurrence(
  rrule: string,
  dtstart: Date,
  timezone: string,
): Date {
  const rule = new RRule({
    ...RRule.parseString(rrule),
    dtstart: toNaive(dtstart, timezone),
  });
  const naive = rule.after(toNaive(dtstart, timezone), true);
  return naive ? fromNaive(naive, timezone) : dtstart;
}

/** Real instant → naive Date whose UTC fields hold its `timezone` wall-clock. */
function toNaive(date: Date, timezone: string): Date {
  const z = toZonedTime(date, timezone);
  return new Date(
    Date.UTC(
      z.getFullYear(),
      z.getMonth(),
      z.getDate(),
      z.getHours(),
      z.getMinutes(),
      z.getSeconds(),
    ),
  );
}

/** Naive Date (UTC fields = wall-clock) → the real instant in `timezone`. */
function fromNaive(naive: Date, timezone: string): Date {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  const wall =
    `${p(naive.getUTCFullYear(), 4)}-${p(naive.getUTCMonth() + 1)}-${p(naive.getUTCDate())}` +
    `T${p(naive.getUTCHours())}:${p(naive.getUTCMinutes())}:${p(naive.getUTCSeconds())}`;
  return fromZonedTime(wall, timezone);
}
