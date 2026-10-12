import AsyncStorage from "@react-native-async-storage/async-storage";
import type { FileUsage } from "@zenflow/shared";

const key = (userId: string) => `file-usage.v1.${userId}`;

/** Last storage usage the server returned, so Settings can show it offline. */
export async function saveUsageCache(
  userId: string,
  usage: FileUsage,
): Promise<void> {
  try {
    await AsyncStorage.setItem(key(userId), JSON.stringify(usage));
  } catch {
    // Best effort.
  }
}

export async function loadUsageCache(
  userId: string,
): Promise<FileUsage | null> {
  try {
    const raw = await AsyncStorage.getItem(key(userId));
    const p = raw ? JSON.parse(raw) : null;
    return p &&
      typeof p.usedBytes === "number" &&
      typeof p.userQuotaBytes === "number"
      ? p
      : null;
  } catch {
    return null;
  }
}
