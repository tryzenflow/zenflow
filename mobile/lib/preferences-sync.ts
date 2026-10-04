import {
  DEFAULT_REMINDER_CHOICES,
  type DefaultReminderChoice,
  LANGS,
  type Lang,
  type UpdateUserInput,
  type User,
} from "@zenflow/shared";

/**
 * Pure mapping between the Settings UI's preference shape and the API's
 * `User` / `UpdateUserInput`. RN-free so it can be unit-tested with Vitest
 * (`lib/__tests__/preferences-sync.test.ts`).
 */

/** "device" follows the phone's zone; "explicit" is a user-picked IANA zone. */
export type TimezoneMode = "device" | "explicit";

/** The picker's sentinel value for "follow the device". */
export const DEVICE_TIMEZONE = "device";

/** The three server-backed preferences, in their UI vocabulary. */
export interface SyncedPrefs {
  language: Lang;
  /** Concrete IANA zone (never "device"). */
  timezone: string;
  timezoneMode: TimezoneMode;
  defaultReminder: DefaultReminderChoice;
}

/** A UI edit: `timezone` may be the "device" sentinel. */
export interface SyncedPatch {
  language?: Lang;
  timezone?: string;
  defaultReminder?: DefaultReminderChoice;
}

export function isLang(v: unknown): v is Lang {
  return (LANGS as readonly unknown[]).includes(v);
}

export function isReminderChoice(v: unknown): v is DefaultReminderChoice {
  return (DEFAULT_REMINDER_CHOICES as readonly unknown[]).includes(v);
}

/** Resolve a UI timezone value ("device" or IANA) to a concrete IANA zone. */
export function resolveTimezone(value: string, deviceTz: string): string {
  return value === DEVICE_TIMEZONE ? deviceTz : value;
}

/** UI edit -> PATCH body. "device" is resolved; the backend rejects it. */
export function patchToUpdateInput(
  patch: SyncedPatch,
  deviceTz: string,
): UpdateUserInput {
  const input: UpdateUserInput = {};
  if (patch.language !== undefined) input.lang = patch.language;
  if (patch.defaultReminder !== undefined) {
    input.defaultReminderMinutes = patch.defaultReminder;
  }
  if (patch.timezone !== undefined) {
    input.timezone = resolveTimezone(patch.timezone, deviceTz);
  }
  return input;
}

/** Mode implied by an edit's timezone value; undefined if untouched. */
export function modeForTimezone(
  value: string | undefined,
): TimezoneMode | undefined {
  if (value === undefined) return undefined;
  return value === DEVICE_TIMEZONE ? "device" : "explicit";
}

/**
 * Server user -> synced prefs. The server is the source of truth for all
 * three values; only `timezoneMode` is local. In device mode the shown zone
 * is still the server's (it's re-synced separately, see `deviceZoneDrift`).
 */
export function userToSyncedPrefs(
  user: Pick<User, "timezone" | "lang" | "defaultReminderMinutes">,
  mode: TimezoneMode,
): SyncedPrefs {
  return {
    language: user.lang,
    timezone: user.timezone,
    timezoneMode: mode,
    defaultReminder: user.defaultReminderMinutes,
  };
}

/**
 * The zone to push on app start when in device mode and the phone's zone has
 * moved away from what the server has; null when nothing to sync.
 */
export function deviceZoneDrift(
  user: Pick<User, "timezone">,
  mode: TimezoneMode,
  deviceTz: string,
): string | null {
  return mode === "device" && user.timezone !== deviceTz ? deviceTz : null;
}

/** Normalise stored mode, migrating the legacy `timezone: "device"` value. */
export function storedMode(stored: {
  timezoneMode?: unknown;
  timezone?: unknown;
}): TimezoneMode {
  if (stored.timezoneMode === "device" || stored.timezoneMode === "explicit") {
    return stored.timezoneMode;
  }
  return stored.timezone === undefined || stored.timezone === DEVICE_TIMEZONE
    ? "device"
    : "explicit";
}

/** Value the timezone picker should highlight. */
export function timezonePickerValue(p: SyncedPrefs): string {
  return p.timezoneMode === "device" ? DEVICE_TIMEZONE : p.timezone;
}
