import {
  DAILY_ACTION_DONE,
  DAILY_ACTION_MISSED,
  DAILY_CHECKIN_CATEGORY,
  DAILY_CHECKIN_MAX_SESSIONS,
  type DailyPushKind,
  type DailyPushTime,
} from "@zenflow/shared";

/** Times a push gets when the user first switches it on. */
export const DEFAULT_DAILY_TIMES: Record<DailyPushKind, DailyPushTime> = {
  morning: "07:00",
  evening: "21:00",
};

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** A `HH:mm` string as a Date on `base`'s day (for the time picker). */
export function timeToDate(hhmm: DailyPushTime, base: Date = new Date()): Date {
  const match = HHMM.exec(hhmm);
  const d = new Date(base);
  d.setHours(match ? Number(match[1]) : 0, match ? Number(match[2]) : 0, 0, 0);
  return d;
}

/** The `HH:mm` of a Date from the time picker. */
export function dateToTime(d: Date): DailyPushTime {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * Session ids from a check-in push's `sessionIds` data key (comma-separated).
 * Empty, duplicate and surplus entries are dropped.
 */
export function checkInSessionIds(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  const ids = raw
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  return [...new Set(ids)].slice(0, DAILY_CHECKIN_MAX_SESSIONS);
}

export type CheckInAction = "done" | "missed";

/** The check-in action for a notification button's identifier, or `null`. */
export function checkInActionOf(identifier: string): CheckInAction | null {
  if (identifier === DAILY_ACTION_DONE) return "done";
  if (identifier === DAILY_ACTION_MISSED) return "missed";
  return null;
}

/** `true` for a notification that carries the evening check-in buttons. */
export function isCheckInCategory(categoryId: unknown): boolean {
  return categoryId === DAILY_CHECKIN_CATEGORY;
}
