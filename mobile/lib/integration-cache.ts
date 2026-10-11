import AsyncStorage from "@react-native-async-storage/async-storage";
import type { IntegrationStatus } from "@zenflow/shared";

const key = (userId: string) => `integrations.v1.${userId}`;

/** Last integration status the server returned, so Settings can show it offline. */
export async function saveIntegrationCache(
  userId: string,
  integrations: IntegrationStatus[],
): Promise<void> {
  try {
    await AsyncStorage.setItem(key(userId), JSON.stringify(integrations));
  } catch {
    // Best effort.
  }
}

export async function loadIntegrationCache(
  userId: string,
): Promise<IntegrationStatus[] | null> {
  try {
    const raw = await AsyncStorage.getItem(key(userId));
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
