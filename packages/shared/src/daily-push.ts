/** `HH:mm` (24-hour, user timezone) that a daily push fires at. */
export type DailyPushTime = string;

/** Daily push kinds: the morning brief and the evening check-in. */
export type DailyPushKind = "morning" | "evening";

/**
 * Push times (`GET|PUT /users/me/daily-push`). `null` = that push is off.
 * Both are off by default.
 */
export interface DailyPushSettings {
  morningBriefTime: DailyPushTime | null;
  eveningCheckinTime: DailyPushTime | null;
}

/** Body for `PUT /users/me/daily-push`. Each field is required; `null` turns that push off. */
export interface UpdateDailyPushInput {
  morningBriefTime: DailyPushTime | null;
  eveningCheckinTime: DailyPushTime | null;
}

/** Notification category of the evening check-in (iOS and Android action buttons). */
export const DAILY_CHECKIN_CATEGORY = "daily_checkin";
/** Action identifiers of the check-in buttons. */
export const DAILY_ACTION_DONE = "done";
export const DAILY_ACTION_MISSED = "missed";
/** Most session ids one check-in push carries (keeps the payload under 4 KB). */
export const DAILY_CHECKIN_MAX_SESSIONS = 12;
