import { fromZonedTime, toZonedTime } from "date-fns-tz";

export function utcToMinutes(
  date: Date, // stored UTC date
  timezone: string // e.g. "Europe/Paris"
): number {
  const local = toZonedTime(date, timezone);
  return local.getHours() * 60 + local.getMinutes();
}

export function minutesToUtc(
  baseDate: Date,
  minutes: number,
  timezone: string
): Date {
  const clamped = Math.min(Math.max(0, minutes), 1439);
  const hours = Math.floor(clamped / 60);
  const mins = clamped % 60;

  // Build a local datetime in user's timezone
  const localDate = new Date(
    baseDate.getFullYear(),
    baseDate.getMonth(),
    baseDate.getDate(),
    hours,
    mins
  );

  // Convert to UTC for storage
  return fromZonedTime(localDate, timezone);
}
