import { t, setLanguage } from "./i18n";
import { updateBasicInfo } from "@/api/users";
import { useUserStore } from "@/hooks/use-user-store";
import { IANA_TIMEZONES } from "@/lib/timezones";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { DefaultReminderChoice, Lang } from "@zenflow/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type SyncedPatch,
  type TimezoneMode,
  deviceZoneDrift,
  modeForTimezone,
  patchToUpdateInput,
  storedMode,
  userToSyncedPrefs,
} from "./preferences-sync";

/**
 * Settings preferences. `language`, `timezone` and `defaultReminder` are
 * server-backed (`User.lang` / `timezone` / `defaultReminderMinutes`, via
 * `PATCH /users/update/basic-info`); the server user is the source of truth
 * and AsyncStorage only caches them for offline. `timezoneMode` is
 * device-local. ("Allow notifications" is not a preference: it is derived from
 * OS permission + server device registration, see
 * `hooks/use-notification-toggle.ts`.)
 */
export interface Preferences {
  language: Lang;
  /** Concrete IANA zone (the server value; never "device"). */
  timezone: string;
  /** "device" follows the phone's zone (re-synced on start); else explicit. */
  timezoneMode: TimezoneMode;
  /** Minutes before a session starts; 0 = no reminder. */
  defaultReminder: DefaultReminderChoice;
}

export const DEFAULT_PREFERENCES: Preferences = {
  language: "en",
  timezone: deviceTimezone(),
  timezoneMode: "device",
  defaultReminder: 10,
};

export const PREFERENCES_KEY = "preferences";

export const LANGUAGES: { value: Lang; label: string; flag: string }[] = [
  { value: "en", label: "English", flag: "🇬🇧" },
  { value: "vi", label: "Tiếng Việt", flag: "🇻🇳" },
];

export const REMINDERS: { value: DefaultReminderChoice; label: string }[] = [
  {
    value: 0,
    get label() {
      return t("None");
    },
  },
  {
    value: 5,
    get label() {
      return t("5 min before");
    },
  },
  {
    value: 10,
    get label() {
      return t("10 min before");
    },
  },
  {
    value: 15,
    get label() {
      return t("15 min before");
    },
  },
  {
    value: 30,
    get label() {
      return t("30 min before");
    },
  },
  {
    value: 60,
    get label() {
      return t("1 hour before");
    },
  },
];

export const TIMEZONES = [
  "Asia/Ho_Chi_Minh",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Asia/Kolkata",
  "Europe/London",
  "Europe/Paris",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Australia/Sydney",
  "UTC",
];

/**
 * Every selectable IANA timezone. Static (see `timezones.ts`) because Hermes
 * has no `Intl.supportedValuesOf` to enumerate them at runtime.
 */
export function allTimezones(): readonly string[] {
  return IANA_TIMEZONES;
}

export function deviceTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** The persisted timezone mode, or null if this device has never saved one. */
async function loadStoredMode(): Promise<TimezoneMode | null> {
  try {
    const raw = await AsyncStorage.getItem(PREFERENCES_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw);
    if (stored.timezoneMode === undefined && stored.timezone === undefined) {
      return null;
    }
    return storedMode(stored);
  } catch {
    return null;
  }
}

export async function loadPreferences(): Promise<Preferences> {
  try {
    const raw = await AsyncStorage.getItem(PREFERENCES_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const stored = JSON.parse(raw);
    const timezoneMode = storedMode(stored);
    const merged = { ...DEFAULT_PREFERENCES, ...stored, timezoneMode };
    // Legacy cache stored the "device" sentinel as the zone.
    if (merged.timezone === "device") merged.timezone = deviceTimezone();
    return merged;
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

async function savePreferences(next: Preferences) {
  try {
    await AsyncStorage.setItem(PREFERENCES_KEY, JSON.stringify(next));
  } catch {
    // Non-fatal — the in-memory value still applies this session.
  }
}

/** Edit accepted by `update`; `timezone` may be the "device" sentinel. */
export type PreferencesPatch = SyncedPatch;

export function usePreferences() {
  const user = useUserStore((s) => s.user);
  const updateUser = useUserStore((s) => s.updateUser);
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFERENCES);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const driftChecked = useRef(false);
  // PATCHes run one at a time so a slower, older response can't overwrite the
  // result of a newer edit.
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  // Hydrate from the server user (source of truth); cache for offline.
  useEffect(() => {
    let mounted = true;
    (async () => {
      const [stored, savedMode] = await Promise.all([
        loadPreferences(),
        loadStoredMode(),
      ]);
      if (!mounted) return;
      if (!user) {
        setLanguage(stored.language);
        setPrefs(stored);
        return;
      }
      // No saved mode (fresh install / cleared cache): don't assume "follow
      // the device" — that would overwrite a zone chosen on another device.
      // Infer it from whether the account's zone already matches this phone.
      const mode: TimezoneMode =
        savedMode ??
        (user.timezone === deviceTimezone() ? "device" : "explicit");
      const next = {
        ...stored,
        ...userToSyncedPrefs(user, mode),
      };
      setLanguage(next.language);
      setPrefs(next);
      void savePreferences(next);

      // Device mode: if the phone's zone moved, push it once per launch.
      if (driftChecked.current) return;
      driftChecked.current = true;
      const drift = savedMode
        ? deviceZoneDrift(user, next.timezoneMode, deviceTimezone())
        : null;
      if (drift) {
        try {
          updateUser(await updateBasicInfo({ timezone: drift }));
        } catch {
          // Offline — retried next launch.
          driftChecked.current = false;
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, [user, updateUser]);

  /**
   * Apply an edit. Server-backed fields are optimistic: rolled back if the
   * PATCH fails, in which case this resolves `false` (caller shows a toast).
   */
  const update = useCallback(
    async (patch: PreferencesPatch): Promise<boolean> => {
      const synced = patch;
      const previous = prefsRef.current;
      const mode = modeForTimezone(synced.timezone);
      const optimistic: Preferences = {
        ...previous,
        ...(synced.language !== undefined && { language: synced.language }),
        ...(synced.defaultReminder !== undefined && {
          defaultReminder: synced.defaultReminder,
        }),
        ...(synced.timezone !== undefined && {
          timezoneMode: mode as TimezoneMode,
          timezone:
            mode === "device" ? deviceTimezone() : (synced.timezone as string),
        }),
      };
      setLanguage(optimistic.language);
      setPrefs(optimistic);
      prefsRef.current = optimistic;

      const input = patchToUpdateInput(synced, deviceTimezone());
      if (Object.keys(input).length === 0) {
        await savePreferences({
          ...(await loadPreferences()),
          ...optimistic,
        });
        return true;
      }
      const run = async (): Promise<boolean> => {
        try {
          const updated = await updateBasicInfo(input);
          // Later edits are already applied optimistically; only take the
          // server's values for the fields this request changed.
          const latest = prefsRef.current;
          const server = userToSyncedPrefs(updated, latest.timezoneMode);
          const next: Preferences = {
            ...latest,
            ...(input.lang !== undefined && { language: server.language }),
            ...(input.defaultReminderMinutes !== undefined && {
              defaultReminder: server.defaultReminder,
            }),
            ...(input.timezone !== undefined && { timezone: server.timezone }),
          };
          setPrefs(next);
          prefsRef.current = next;
          await savePreferences(next);
          updateUser(updated);
          return true;
        } catch {
          // Roll back only this edit's fields, keeping any newer ones.
          const latest = prefsRef.current;
          const rolled: Preferences = {
            ...latest,
            ...(input.lang !== undefined && { language: previous.language }),
            ...(input.defaultReminderMinutes !== undefined && {
              defaultReminder: previous.defaultReminder,
            }),
            ...(input.timezone !== undefined && {
              timezone: previous.timezone,
              timezoneMode: previous.timezoneMode,
            }),
          };
          setLanguage(rolled.language);
          setPrefs(rolled);
          prefsRef.current = rolled;
          return false;
        }
      };
      const result = queue.current.then(run, run);
      queue.current = result;
      return result;
    },
    [updateUser],
  );

  return { prefs, update };
}
