/** How the per-tag duration corrector surfaces its adjustment to the user. */
export type DurationAdjustmentMode = "auto" | "ask" | "never";

/** A user's working-window configuration, in their own timezone. */
export interface UserPreferences {
  /** Minutes from midnight; default 540 (09:00). */
  workStart: number;
  /** Minutes from midnight; default 1020 (17:00). */
  workEnd: number;
  /** ISO weekdays (1=Mon … 7=Sun); default [1,2,3,4,5]. */
  workDays: number[];
  /** IANA timezone, e.g. "Asia/Ho_Chi_Minh". */
  timezone: string;
  /** Duration-corrector UX mode; default "auto". */
  durationAdjustmentMode: DurationAdjustmentMode;
}

export interface User extends UserPreferences {
  id: string;
  name: string;
  email: string;
  onboardingComplete: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UpdatePreferencesInput {
  workStart: number;
  workEnd: number;
  workDays: number[];
  timezone: string;
  /** Duration-corrector UX mode; optional (partial update). */
  durationAdjustmentMode?: DurationAdjustmentMode;
}

export type OnboardingInput = UpdatePreferencesInput;
