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
}

export interface User extends UserPreferences {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  updatedAt: string;
}

/** Partial update to a user's basic (non-scheduling) identity fields. */
export interface UpdateUserInput {
  name?: string;
}
