import type { DailyPushKind, DailyPushSettings } from "@zenflow/shared";

/** A push is due for this long after its fire time; later sweeps skip it. */
export const DAILY_FIRE_WINDOW_MS = 60 * 60_000;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const isHhmm = (value: string): boolean => HHMM.test(value);

const DAY_MS = 24 * 3_600_000;

const formatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(tz, f);
  }
  return f;
}

/** Offset of `tz` from UTC at `instant`, in ms (east positive). */
export function zoneOffsetMs(instant: Date, tz: string): number {
  const parts: Record<string, number> = {};
  for (const p of partsFormatter(tz).formatToParts(instant)) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  const truncated = Math.floor(instant.getTime() / 1000) * 1000;
  return asUtc - truncated;
}

/** `YYYY-MM-DD` of `instant` on the wall clock of `tz`. */
export function localDateKey(instant: Date, tz: string): string {
  return formatDateParts(
    new Date(instant.getTime() + zoneOffsetMs(instant, tz)),
  );
}

function formatDateParts(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` shifted by `days` calendar days. */
export function addDays(localDate: string, days: number): string {
  return formatDateParts(
    new Date(Date.parse(`${localDate}T00:00:00Z`) + days * DAY_MS),
  );
}

/**
 * The UTC instant of wall-clock `hhmm` on `localDate` in `tz`. DST-safe: the
 * candidates come from the offsets either side of the day. A repeated
 * fall-back time resolves to its earlier occurrence; a time inside a
 * spring-forward gap shifts forward to the first instant after it.
 */
export function zonedToUtc(localDate: string, hhmm: string, tz: string): Date {
  const [y, m, d] = localDate.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, h, mi);
  const candidates = [
    wall - zoneOffsetMs(new Date(wall - DAY_MS), tz),
    wall - zoneOffsetMs(new Date(wall + DAY_MS), tz),
  ];
  const valid = candidates.filter(
    (t) => t + zoneOffsetMs(new Date(t), tz) === wall,
  );
  if (valid.length > 0) return new Date(Math.min(...valid));
  // Inside a gap: no candidate matches the wall clock, so take the later one.
  return new Date(Math.max(...candidates));
}

/** `HH:mm` wall-clock time of `instant` in `tz`. */
export function localTimeKey(instant: Date, tz: string): string {
  const shifted = new Date(instant.getTime() + zoneOffsetMs(instant, tz));
  return shifted.toISOString().slice(11, 16);
}

/** UTC bounds `[start, end)` of the local calendar day `localDate` in `tz`. */
export function dayBounds(
  localDate: string,
  tz: string,
): { start: Date; end: Date } {
  return {
    start: zonedToUtc(localDate, "00:00", tz),
    end: zonedToUtc(addDays(localDate, 1), "00:00", tz),
  };
}

export interface DuePush {
  kind: DailyPushKind;
  /** The local day the push is for (its idempotency key). */
  localDate: string;
  fireAt: Date;
}

/**
 * The pushes whose fire time has passed within the last
 * {@link DAILY_FIRE_WINDOW_MS}. Checks today and yesterday (local), so a push
 * for the previous evening still goes out just after midnight.
 */
export function duePushes(
  now: Date,
  tz: string,
  settings: DailyPushSettings,
): DuePush[] {
  const today = localDateKey(now, tz);
  const days = [addDays(today, -1), today];
  const kinds: [DailyPushKind, string | null][] = [
    ["morning", settings.morningBriefTime],
    ["evening", settings.eveningCheckinTime],
  ];
  const due: DuePush[] = [];
  for (const [kind, time] of kinds) {
    if (!time) continue;
    for (const localDate of days) {
      const fireAt = zonedToUtc(localDate, time, tz);
      const elapsed = now.getTime() - fireAt.getTime();
      if (elapsed >= 0 && elapsed < DAILY_FIRE_WINDOW_MS) {
        due.push({ kind, localDate, fireAt });
      }
    }
  }
  return due;
}
