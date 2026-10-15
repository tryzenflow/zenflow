import type { Session } from "./task";

/** Consecutive streak days that earn one freeze. */
export const STREAK_FREEZE_EVERY_DAYS = 7;
/** Most freezes a user can bank. */
export const STREAK_MAX_FREEZES = 2;

/**
 * A user's daily completion streak (`GET /users/me/streak`). A day counts when
 * at least one task (not a class, exam or do-not-disturb block) was completed on it, in the user's timezone. A missed
 * past day spends a banked freeze instead of breaking the streak; today never
 * breaks it.
 */
export interface Streak {
  /** Active days in the current streak (frozen days not counted). */
  current: number;
  longest: number;
  /** Banked freezes, 0 to {@link STREAK_MAX_FREEZES}. */
  freezesAvailable: number;
  /** Days (`YYYY-MM-DD`, user tz) in the current streak covered by a freeze. */
  frozenDays: string[];
  /** Last day (`YYYY-MM-DD`, user tz) with a completed session, or `null`. */
  lastActiveDay: string | null;
  /** At least one session completed today. */
  todayDone: boolean;
}

/** `data` of `GET /users/me/streak`. */
export type StreakResponse = Streak;

/**
 * `data` of `POST|DELETE /sessions/:id/complete` and `POST|DELETE /sessions/:id/skip`.
 * `session` carries the request id, so an occurrence keeps its `<seriesId>::<startISO>` id.
 */
export interface SessionCheckOffResponse {
  session: Session;
  streak: Streak;
}
