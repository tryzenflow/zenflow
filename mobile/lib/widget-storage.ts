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
