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

/**
 * `data.source` on the system notification the SSE handler posts itself
 * (`hooks/use-notifications.ts`), so the foreground push listener can tell it
 * from a server push and not toast it a second time.
 */
export const LOCAL_NOTIFICATION_SOURCE = "sse-local";

// One backend notification reaches a foregrounded app twice — over the SSE
// stream and as a native push (`PushService` fans out the same event) — and
// both carry its `notificationId`. Whichever channel arrives first claims the
// id and is the only one presented; the other is swallowed.
const claimedBy = new Map<string, string>();
const CLAIM_CAP = 200;

/**
 * `true` if `owner` may present notification `id`: nobody claimed it yet, or
 * `owner` already did (the push handler and the push listener both see the
 * same push, so each passes the push's own request identifier as `owner`).
 */
export function claimNotification(
  id: string | undefined | null,
  owner: string,
): boolean {
  if (!id) return true;
  const current = claimedBy.get(id);
  if (current !== undefined) return current === owner;
  claimedBy.set(id, owner);
  if (claimedBy.size > CLAIM_CAP) {
    claimedBy.delete(claimedBy.keys().next().value as string);
  }
  return true;
}

/** Owner key for a native notification (its OS request identifier). */
export function pushOwner(n: Notifications.Notification): string {
  return `push:${n.request.identifier}`;
}

function notificationData(
  n: Notifications.Notification,
): Record<string, unknown> | undefined {
  return n.request.content.data as Record<string, unknown> | undefined;
}

/** The SSE handler's own system notification (never toasted again). */
export function isLocalNotification(n: Notifications.Notification): boolean {
  return notificationData(n)?.source === LOCAL_NOTIFICATION_SOURCE;
}

/** Backend `notificationId` a push/local notification carries, if any. */
export function notificationIdOf(
  n: Notifications.Notification,
): string | undefined {
  const id = notificationData(n)?.notificationId;
  return typeof id === "string" && id ? id : undefined;
}

/** How a foreground push is presented while the app is open. */
export function configureForegroundHandler(): void {
  // No native push on web (see file header) — `expo-notifications` has no
  // web shim for this call, and it runs at module scope (before any
  // Platform-gated effect), so an unguarded call here throws on import and
  // breaks the whole root layout's module evaluation on web.
  if (Platform.OS === "web") return;
  Notifications.setNotificationHandler({
    handleNotification: async (n) => {
      // A server push the SSE stream already presented (toast + its own
      // system notification) stays silent.
      const duplicate =
        !isLocalNotification(n) &&
        !claimNotification(notificationIdOf(n), pushOwner(n));
      return {
        shouldShowAlert: !duplicate,
        shouldPlaySound: !duplicate,
        shouldSetBadge: !duplicate,
      };
    },
  });
}

/** Android 8+ needs an explicit channel or notifications are dropped silently. */
export async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: "General",
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: "#f97316",
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
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
  if (status !== "granted") {
    const requested = await Notifications.requestPermissionsAsync();
    status = requested.status;
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
