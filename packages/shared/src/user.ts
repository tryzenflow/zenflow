/** Supported UI languages (wire form of the DB `Language` enum). */
export const LANGS = ["vi", "en"] as const;
export type Lang = (typeof LANGS)[number];

/** Allowed values of `defaultReminderMinutes` (0 = none). */
export const DEFAULT_REMINDER_CHOICES = [0, 5, 10, 15, 30, 60] as const;
export type DefaultReminderChoice = (typeof DEFAULT_REMINDER_CHOICES)[number];

/**
 * A user's scheduling preferences. Used to carry just `timezone` — the
 * working-window fields (workStart/workEnd/workDays) were dropped from
 * `User` with no replacement in the education-pivot migration
 * (20260823155537_add_education_pivot); the scheduler no longer constrains
 * placement to a configured working window.
 */
export interface UserPreferences {
  /** IANA timezone, e.g. "Asia/Ho_Chi_Minh". */
  timezone: string;
  /** UI language. Maps to the DB enum VI_VN / EN_US. */
  lang: Lang;
  /**
   * Lead time (minutes) of the reminder given to a new session when the
   * request omits `reminders`. One of {@link DEFAULT_REMINDER_CHOICES};
   * 0 = no default reminder. DND sessions never get one.
   */
  defaultReminderMinutes: DefaultReminderChoice;
}

export interface User extends UserPreferences {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  updatedAt: string;
  /** ISO time first-run onboarding was completed; null = show onboarding. */
  onboardedAt: string | null;
  /** User intent for native push notifications; in-app notifications are unaffected. */
  allowNotifications: boolean;
}

/** Partial update to a user's name and preferences. */
export interface UpdateUserInput {
  name?: string;
  /** Valid IANA zone. Affects only future scheduling/rendering. */
  timezone?: string;
  lang?: Lang;
  defaultReminderMinutes?: DefaultReminderChoice;
  /**
   * `true` marks onboarding complete (sets `onboardedAt` to now if still
   * null; idempotent — never moves an existing timestamp). Can't be unset.
   */
  onboarded?: true;
  /** Native push preference: false when the user turns it off or denies the OS prompt. */
  allowNotifications?: boolean;
}
