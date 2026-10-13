import AsyncStorage from "@react-native-async-storage/async-storage";
import type { WidgetSnapshot } from "./widget-snapshot";

const KEY = "zenflow.widget.snapshot.v1";

export async function readWidgetSnapshot(): Promise<WidgetSnapshot | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (
      typeof value !== "object" ||
      value === null ||
      !("generatedAt" in value) ||
      typeof value.generatedAt !== "string" ||
      !("events" in value) ||
      !Array.isArray(value.events)
    ) return null;
    return value as WidgetSnapshot;
  } catch {
    return null;
  }
}

export async function writeWidgetSnapshot(snapshot: WidgetSnapshot | null) {
  if (snapshot) await AsyncStorage.setItem(KEY, JSON.stringify(snapshot));
  else await AsyncStorage.removeItem(KEY);
}

const CALENDAR_DATE_KEY = 'zenflow.widget.calendar-date.v1';

export async function readWidgetCalendarDate(): Promise<string | undefined> {
  const date = await AsyncStorage.getItem(CALENDAR_DATE_KEY).catch(() => null);
  return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;
}

export async function writeWidgetCalendarDate(date: string) {
  await AsyncStorage.setItem(CALENDAR_DATE_KEY, date);
}
