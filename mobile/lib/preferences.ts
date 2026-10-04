import { updateBasicInfo } from "@/api/users";
import { useUserStore } from "@/hooks/use-user-store";
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
 * and AsyncStorage only caches them for offline. `timezoneMode` and
 * `notificationsEnabled` are device-local. (`notificationsEnabled`
 * additionally registers/revokes this device for push; see
 * `components/settings/preferences-section.tsx`.)
 */
export interface Preferences {
  language: Lang;
  /** Concrete IANA zone (the server value; never "device"). */
  timezone: string;
  /** "device" follows the phone's zone (re-synced on start); else explicit. */
  timezoneMode: TimezoneMode;
  /** Minutes before a session starts; 0 = no reminder. */
  defaultReminder: DefaultReminderChoice;
  notificationsEnabled: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  language: "en",
  timezone: deviceTimezone(),
  timezoneMode: "device",
  defaultReminder: 10,
  notificationsEnabled: true,
};

export const PREFERENCES_KEY = "preferences";

export const LANGUAGES: { value: Lang; label: string }[] = [
  { value: "en", label: "English" },
  { value: "vi", label: "Tiếng Việt" },
];

export const REMINDERS: { value: DefaultReminderChoice; label: string }[] = [
  { value: 0, label: "None" },
  { value: 5, label: "5 min before" },
  { value: 10, label: "10 min before" },
  { value: 15, label: "15 min before" },
  { value: 30, label: "30 min before" },
  { value: 60, label: "1 hour before" },
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

type IntlWithSupported = typeof Intl & {
  supportedValuesOf?: (key: "timeZone") => string[];
};

/**
 * Every IANA timezone the runtime knows. Falls back to the curated
 * `TIMEZONES` list on engines without `Intl.supportedValuesOf` (older Hermes).
 */
export function allTimezones(): string[] {
  try {
    const all = (Intl as IntlWithSupported).supportedValuesOf?.("timeZone");
    if (all?.length) return all.includes("UTC") ? all : [...all, "UTC"];
  } catch {
    // fall through to the curated list
  }
  return TIMEZONES;
}

export function deviceTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
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

/** Push opt-out flag, read by `syncPushRegistration` without a React context. */
export async function isPushEnabled(): Promise<boolean> {
  return (await loadPreferences()).notificationsEnabled;
}

/** Edit accepted by `update`; `timezone` may be the "device" sentinel. */
export type PreferencesPatch = SyncedPatch & { notificationsEnabled?: boolean };

export function usePreferences() {
  const user = useUserStore((s) => s.user);
  const setUser = useUserStore((s) => s.setUser);
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFERENCES);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const driftChecked = useRef(false);

  // Hydrate from the server user (source of truth); cache for offline.
  useEffect(() => {
    let mounted = true;
    (async () => {
      const stored = await loadPreferences();
      if (!mounted) return;
      if (!user) {
        setPrefs(stored);
        return;
      }
      const next = {
        ...stored,
        ...userToSyncedPrefs(user, stored.timezoneMode),
      };
      setPrefs(next);
      void savePreferences(next);

      // Device mode: if the phone's zone moved, push it once per launch.
      if (driftChecked.current) return;
      driftChecked.current = true;
      const drift = deviceZoneDrift(user, next.timezoneMode, deviceTimezone());
      if (drift) {
        try {
          setUser(await updateBasicInfo({ timezone: drift }));
        } catch {
          // Offline — retried next launch.
          driftChecked.current = false;
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, [user, setUser]);

  /**
   * Apply an edit. Server-backed fields are optimistic: rolled back if the
   * PATCH fails, in which case this resolves `false` (caller shows a toast).
   */
  const update = useCallback(
    async (patch: PreferencesPatch): Promise<boolean> => {
      const { notificationsEnabled, ...synced } = patch;
      const previous = prefsRef.current;
      const mode = modeForTimezone(synced.timezone);
      const optimistic: Preferences = {
        ...previous,
        ...(notificationsEnabled !== undefined && { notificationsEnabled }),
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
      try {
        const updated = await updateBasicInfo(input);
        // Keep the optimistic mode; take values from the server's response.
        const next = {
          ...optimistic,
          ...userToSyncedPrefs(updated, optimistic.timezoneMode),
        };
        setPrefs(next);
        prefsRef.current = next;
        await savePreferences(next);
        setUser(updated);
        return true;
      } catch {
        setPrefs(previous);
        prefsRef.current = previous;
        return false;
      }
    },
    [setUser],
  );

  return { prefs, update };
}
