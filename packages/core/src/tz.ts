import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { isSameDay } from "date-fns";

/**
 * Timezone helpers for the calendar. The calendar reasons entirely in the
 * user's configured IANA timezone, never the device's. The trick: every
 * calendar `Date` carries the user-tz *wall clock* in its local fields (what
 * {@link toZonedTime} produces), so date-fns operations (isSameDay, addDays,
 * getDay, format, …) all work in user-tz space. Convert back to a real UTC
 * instant with {@link zonedWallClockToUtc} before sending to the API.
 */

/** "Now", with the user-tz wall clock in the Date's local fields. */
export const zonedNow = (tz: string): Date => toZonedTime(new Date(), tz);

/** A UTC instant (ISO string or Date) → user-tz wall clock in local fields. */
export const zonedDate = (iso: string | Date, tz: string): Date =>
  toZonedTime(new Date(iso), tz);

/**
 * Inverse of {@link zonedDate}: a Date whose local fields are a user-tz wall
 * clock → the real UTC instant it denotes.
 */
export const zonedWallClockToUtc = (wallClock: Date, tz: string): Date =>
  fromZonedTime(wallClock, tz);

/** True when `zonedDate` (already in user-tz space) falls on the user's today. */
export const isZonedToday = (zonedDate: Date, tz: string): boolean =>
  isSameDay(zonedDate, zonedNow(tz));

/** Short timezone label (e.g. "GMT+2", "PDT") for the user's tz. */
export const tzAbbrev = (tz: string): string =>
  new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" })
    .formatToParts(new Date())
    .find((p) => p.type === "timeZoneName")?.value ?? tz;
