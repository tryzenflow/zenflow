/**
 * The name a new account gets when none can be read from its email (a student
 * number such as `2012345@dlu.edu.vn` has no name in it). Clients treat it as
 * "not set yet" and ask for a real one.
 */
export const DEFAULT_USER_NAME = "New User";

/** Supported UI languages (wire form of the DB `Language` enum). */
export const LANGS = ["vi", "en"] as const;
export type Lang = (typeof LANGS)[number];

/** Allowed values of `defaultReminderMinutes` (0 = none). */
export const DEFAULT_REMINDER_CHOICES = [0, 5, 10, 15, 30, 60] as const;
export type DefaultReminderChoice = (typeof DEFAULT_REMINDER_CHOICES)[number];

/**
 * The time of day a user says they focus best, from onboarding. Seeds the
 * preference matrix (`scheduler/core/focus-band.ts`). Bands are local hours:
 * MORNING 08:00 to 12:00, AFTERNOON 12:00 to 17:00, EVENING 17:00 to 21:00,
 * LATE_NIGHT 21:00 to 02:00.
 */
export const FOCUS_BANDS = [
  "MORNING",
  "AFTERNOON",
  "EVENING",
  "LATE_NIGHT",
] as const;
export type FocusBand = (typeof FOCUS_BANDS)[number];

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

/**
 * The mobile "Getting started" checklist, in display order. Each step is ticked
 * off when the user does the thing (see `mobile/lib/checklist.ts`).
 */
export const CHECKLIST_STEPS = [
  "connect-dlu",
  "add-task",
  "finish-session",
] as const;
export type ChecklistStep = (typeof CHECKLIST_STEPS)[number];

/**
 * Retired checklist steps (the 7-step checklist before #245). Still valid
 * `seenTips` values so progress stored on the server keeps validating.
 */
export const LEGACY_TIP_IDS = [
  "switch-day",
  "create-task",
  "move-task",
  "block-actions",
  "open-month",
  "open-day",
  "move-day",
] as const;

/**
 * Everything stored in `User.seenTips`: the checklist steps the user has done,
 * plus `checklist-hidden` once they dismiss the checklist. Append-only, so it
 * follows the user across devices.
 */
export const TIP_IDS = [
  ...CHECKLIST_STEPS,
  ...LEGACY_TIP_IDS,
  "checklist-hidden",
] as const;
export type TipId = (typeof TIP_IDS)[number];

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
  /** Getting-started checklist steps done (and `checklist-hidden`); on any device. */
  seenTips: TipId[];
  /** Onboarding answer: when the user focuses best; null = not asked yet. */
  focusBand: FocusBand | null;
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
  /** Marks one checklist step done / the checklist hidden (appended once; idempotent, can't be unset). */
  seenTip?: TipId;
  /**
   * Onboarding answer. Seeds the preference matrix when it is still the default;
   * a learned matrix is left as it is.
   */
  focusBand?: FocusBand;
}
