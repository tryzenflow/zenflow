import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useState } from "react";

/**
 * Device-local settings preferences. No API — persisted in AsyncStorage only.
 * (`notificationsEnabled` additionally registers/revokes this device for push;
 * see `components/settings/preferences-section.tsx`.)
 */
export interface Preferences {
  language: string;
  /** IANA zone, or "device" to follow the phone's zone. */
  timezone: string;
  /** Minutes before a session starts; 0 = no reminder. */
  defaultReminder: number;
  notificationsEnabled: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  language: "en",
  timezone: "device",
  defaultReminder: 10,
  notificationsEnabled: true,
};

export const PREFERENCES_KEY = "preferences";

export const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "vi", label: "Tiếng Việt" },
];

export const REMINDERS = [
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

export function deviceTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export async function loadPreferences(): Promise<Preferences> {
  try {
    const raw = await AsyncStorage.getItem(PREFERENCES_KEY);
    return raw
      ? { ...DEFAULT_PREFERENCES, ...JSON.parse(raw) }
      : DEFAULT_PREFERENCES;
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

/** Push opt-out flag, read by `syncPushRegistration` without a React context. */
export async function isPushEnabled(): Promise<boolean> {
  return (await loadPreferences()).notificationsEnabled;
}

export function usePreferences() {
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFERENCES);

  useEffect(() => {
    let mounted = true;
    loadPreferences().then((p) => {
      if (mounted) setPrefs(p);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const update = useCallback(async (patch: Partial<Preferences>) => {
    // Merge against what's stored, not stale state, so quick edits don't clobber.
    const next = { ...(await loadPreferences()), ...patch };
    setPrefs(next);
    try {
      await AsyncStorage.setItem(PREFERENCES_KEY, JSON.stringify(next));
    } catch {
      // Non-fatal — the in-memory value still applies this session.
    }
  }, []);

  return { prefs, update };
}
