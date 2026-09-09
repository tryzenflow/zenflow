import type { DevicePlatform, PushDataPayload } from "@zenflow/shared";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import type { Href } from "expo-router";
import { Platform } from "react-native";
import { registerDevice, unregisterDevice } from "@/api/devices";
import { debugLog } from "@/lib/debug-log";

/**
 * Native push plumbing for the direct-FCM/APNs backend (`backend/src/devices/`).
 *
 * We take the **raw** device token (`getDevicePushTokenAsync`), not an Expo
 * push token — the backend talks to FCM / APNs itself and never goes through
 * Expo's push service. That token is what `POST /devices` stores.
 *
 * All of this is a no-op on web (no native push) and on a simulator without a
 * push capability; every entry point fails soft.
 */

export const ANDROID_CHANNEL_ID = "default";

/** How a foreground push is presented while the app is open. */
export function configureForegroundHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/** Android 8+ needs an explicit channel or notifications are dropped silently. */
export async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: "General",
    importance: Notifications.AndroidImportance.DEFAULT,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  });
}

export interface NativePushToken {
  platform: DevicePlatform;
  token: string;
}

/**
 * Ask for permission (if not already decided) and return the raw FCM/APNs
 * token, or `null` when push isn't available or was denied. Safe to call on
 * every launch — the OS prompt only shows the first time.
 */
export async function getNativePushToken(): Promise<NativePushToken | null> {
  if (Platform.OS === "web") return null;
  // The iOS Simulator can't obtain an APNs token; an Android emulator with
  // Play Services can get an FCM token, so only hard-block the former.
  if (Platform.OS === "ios" && !Device.isDevice) {
    debugLog("push", "skipped: iOS simulator has no APNs");
    return null;
  }

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== "granted" && existing.canAskAgain) {
    status = (await Notifications.requestPermissionsAsync()).status;
  }
  if (status !== "granted") {
    debugLog("push", `permission not granted (${status})`);
    return null;
  }

  await ensureAndroidChannel();

  try {
    const devicePushToken = await Notifications.getDevicePushTokenAsync();
    const platform: DevicePlatform =
      devicePushToken.type === "ios" ? "IOS" : "ANDROID";
    return { platform, token: String(devicePushToken.data) };
  } catch (err) {
    // Missing google-services.json / APNs entitlement, no network, etc.
    debugLog("push", `getDevicePushTokenAsync failed: ${String(err)}`);
    return null;
  }
}

/**
 * Where a tapped notification should land. The backend's `PushDataPayload.url`
 * is web-shaped (`/calendar?session=…`), so route off `sessionId` instead and
 * reuse the same target the in-app inbox row uses.
 */
export function hrefFromPushData(
  data: Partial<PushDataPayload> | undefined,
): Href {
  const sessionId = data?.sessionId;
  if (sessionId) {
    return `/task/${encodeURIComponent(sessionId)}/edit` as Href;
  }
  return "/notifications" as Href;
}

/**
 * Get this device's token and register it with the backend. Call after login
 * and whenever the app comes to the foreground — the backend upserts, so
 * repeats are cheap. Returns the token that was registered, or `null`.
 */
export async function syncPushRegistration(): Promise<string | null> {
  const t = await getNativePushToken();
  if (!t) return null;
  try {
    await registerDevice(t.platform, t.token);
    debugLog("push", `registered ${t.platform} token …${t.token.slice(-6)}`);
    return t.token;
  } catch (err) {
    debugLog("push", `register failed: ${String(err)}`);
    return null;
  }
}

/**
 * Unregister this device (call on logout, before the session cookie is
 * cleared). Best-effort — a failure here must never block sign-out.
 */
export async function dropPushRegistration(): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    const devicePushToken = await Notifications.getDevicePushTokenAsync();
    await unregisterDevice(String(devicePushToken.data));
    debugLog("push", "unregistered this device");
  } catch (err) {
    debugLog("push", `unregister skipped: ${String(err)}`);
  }
}
