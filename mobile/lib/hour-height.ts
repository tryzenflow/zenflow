import AsyncStorage from "@react-native-async-storage/async-storage";
import { HOUR_HEIGHT_DEFAULT, clampHourHeight } from "./day-grid";

/**
 * The pinch-chosen hour height, shared by every open day page and kept across
 * launches. Best effort: a failed read or write keeps the in-memory value.
 */
const KEY = "day-grid.hour-height.v1";

let current = HOUR_HEIGHT_DEFAULT;
let loaded = false;
const listeners = new Set<() => void>();

export function getHourHeight(): number {
  return current;
}

export function subscribeHourHeight(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function apply(next: number): boolean {
  const clamped = clampHourHeight(Math.round(next));
  if (clamped === current) return false;
  current = clamped;
  for (const l of listeners) l();
  return true;
}

/** Commit a pinch level and persist it. */
export function setHourHeight(next: number): void {
  if (!apply(next)) return;
  AsyncStorage.setItem(KEY, String(current)).catch(() => {});
}

/** Read the saved level once per launch. */
export async function loadHourHeight(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const n = raw == null ? Number.NaN : Number(raw);
    if (Number.isFinite(n)) apply(n);
  } catch {
    // Keep the default.
  }
}
